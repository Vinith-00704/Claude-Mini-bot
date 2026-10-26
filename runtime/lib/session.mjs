// What the Claude Code session runs on: the model, and how hard it is asked to think.
//
// Only the Claude Code side reports this, and it is only ever shown: nothing here
// changes the session. The runtime keeps the latest value and notices when the model
// changes, so the floating bot can say "switched from X to Y" for a moment.

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const fail = (status, error) => Object.assign(new Error(error), { status })

// Plain printable text only, so nothing odd can reach the overlay's label.
const printable = (value, max) =>
  typeof value === 'string' ? value.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''

export class Session {
  #now
  #info = null
  #switch = null

  constructor({ now = Date.now } = {}) {
    this.#now = now
  }

  /** `{ model, name?, effort? }`: the resolved model id, a short name for it, and the effort level (null when it has none). */
  set(body) {
    const model = printable(body?.model, 80)
    if (model === '') throw fail(400, 'model is required')
    const name = printable(body.name, 40) || model
    const effort = body.effort ?? null
    if (effort !== null && !EFFORTS.includes(effort)) throw fail(400, `effort is one of ${EFFORTS.join(', ')}, or null`)
    const previous = this.#info
    if (previous && previous.name === name && previous.effort === effort && previous.model === model) return
    // A different model (not just a different effort) is a switch worth saying so.
    if (previous && previous.name !== name) this.#switch = { from: previous.name, to: name, at: this.#now() }
    this.#info = { model, name, effort, since: this.#now() }
  }

  /** null until the session has said what it runs on. Ages are given in milliseconds, so no clocks have to agree. */
  snapshot() {
    if (this.#info === null) return null
    const now = this.#now()
    return {
      model: this.#info.model,
      name: this.#info.name,
      effort: this.#info.effort,
      ageMs: now - this.#info.since,
      switched: this.#switch ? { from: this.#switch.from, to: this.#switch.to, ageMs: now - this.#switch.at } : null,
    }
  }
}
