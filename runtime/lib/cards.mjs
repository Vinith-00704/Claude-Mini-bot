// Questions for the person, in the bot: one at a time, in the order asked. Whoever asks gets a ticket and waits
// on it; only the overlay can answer (the route needs the overlay key), so nothing that reads runtime.json can
// answer for the person. Computer control asks its own step-by-step questions in computer.mjs; these are the rest:
// Claude Code's permission asks from Mini's own session, turning on full access or listening, adding a routine.

const fail = (status, error) => Object.assign(new Error(error), { status })

const MAX_TEXT = 600
const TICKET_KEEP_MS = 10 * 60 * 1000

export class Cards {
  #now
  #timers
  #seq = 0
  #queue = []
  #tickets = new Map()

  constructor({ now = Date.now, timers = { set: setTimeout, clear: clearTimeout } } = {}) {
    this.#now = now
    this.#timers = timers
  }

  /**
   * Puts a question up. `options` are `{ id, label, primary? }`, two or three of them. `waitMs` is how long before it
   * answers itself with 'timeout' (none: it waits for ever). Resolves the id of the choice.
   */
  ask({ kind, text, options, waitMs }) {
    const clean = typeof text === 'string' ? text.slice(0, MAX_TEXT) : ''
    if (clean.trim() === '') throw fail(400, 'a question has text')
    if (!Array.isArray(options) || options.length < 2 || options.length > 3) throw fail(400, 'a question has two or three answers')
    const list = options.map(o => ({ id: String(o.id).slice(0, 40), label: String(o.label).slice(0, 60), primary: o.primary === true }))
    return new Promise(resolve => {
      const id = `c${(this.#seq += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const card = { id, kind: typeof kind === 'string' ? kind.slice(0, 20) : 'question', text: clean, options: list, resolve, timer: null }
      if (waitMs) {
        card.timer = this.#timers.set(() => this.#settle(id, 'timeout'), waitMs)
        card.timer?.unref?.()
      }
      this.#queue.push(card)
    })
  }

  /**
   * A question asked over the interface: the answer waits on a ticket, as computer control's do.
   * `after(choice)` can act on the answer here, where nothing outside can pretend it was given; what it returns goes with the answer.
   */
  askTicket(question, after = () => ({})) {
    const id = `k${(this.#seq += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const entry = { done: false, value: undefined, at: this.#now(), promise: null }
    entry.promise = this.ask(question).then(choice => {
      let extra = {}
      try {
        extra = after(choice) ?? {}
      } catch (error) {
        extra = { error: error.message ?? String(error) }
      }
      return Object.assign(entry, { done: true, value: { choice, ...extra } })
    })
    this.#tickets.set(id, entry)
    for (const [key, old] of this.#tickets) if (old.done && this.#now() - old.at > TICKET_KEEP_MS) this.#tickets.delete(key)
    return id
  }

  async wait(id, ms) {
    const entry = this.#tickets.get(String(id))
    if (!entry) throw fail(404, 'no such ticket')
    if (!entry.done) {
      let timer
      await Promise.race([entry.promise, new Promise(resolve => { timer = this.#timers.set(resolve, Math.max(0, Math.min(Number(ms) || 0, 25000))); timer?.unref?.() })])
      this.#timers.clear(timer)
    }
    if (!entry.done) return { done: false }
    this.#tickets.delete(String(id))
    return { done: true, ...entry.value }
  }

  #settle(id, choice) {
    const index = this.#queue.findIndex(c => c.id === id)
    if (index < 0) return false
    const [card] = this.#queue.splice(index, 1)
    if (card.timer) this.#timers.clear(card.timer)
    card.resolve(choice)
    return true
  }

  /** The person's answer, from the bot. */
  answer(body) {
    const card = this.#queue.find(c => c.id === body?.id)
    if (!card) throw fail(409, 'that question is no longer open')
    if (!card.options.some(o => o.id === body.choice)) throw fail(400, 'not one of the choices')
    this.#settle(card.id, body.choice)
    return { ok: true }
  }

  /** Takes every question of a kind down, answering it 'stopped'. */
  dismiss(kind) {
    for (const card of this.#queue.filter(c => c.kind === kind)) this.#settle(card.id, 'stopped')
  }

  /** Takes everything down: the companion is stopping. */
  clear() {
    for (const card of [...this.#queue]) this.#settle(card.id, 'stopped')
  }

  /** The question to show now, if any. */
  current() {
    const card = this.#queue[0]
    return card ? { id: card.id, kind: card.kind, text: card.text, options: card.options } : null
  }
}
