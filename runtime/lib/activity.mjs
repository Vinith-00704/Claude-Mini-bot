// What Claude Code is doing, as the floating bot shows it.
//
// The Claude Code side reports each change as it happens (a turn starting, a
// tool running, a turn ending), so what the bot shows is real activity and not
// a guess. The runtime only holds the latest report.

export const PHASES = ['idle', 'sending', 'thinking', 'working', 'completed', 'error']

// A finished or failed turn settles back to idle on its own, so the bot does
// not look busy for ever. The response preview stays until the next prompt.
const SETTLE_MS = 10_000
const MAX_DETAIL = 120
const MAX_PREVIEW = 1200

const fail = (status, error) => Object.assign(new Error(error), { status })

export class Activity {
  #now
  #current = { phase: 'idle', id: null, detail: '', source: 'claude', updatedAt: 0 }
  #preview = null

  constructor({ now = Date.now } = {}) {
    this.#now = now
  }

  /** `preview` is `{ text, isError }` for a turn the bot started; `undefined` leaves it, `null` clears it. */
  set({ phase, id = null, detail = '', source = 'claude', preview } = {}) {
    if (!PHASES.includes(phase)) throw fail(400, `phase is one of: ${PHASES.join(', ')}`)
    this.#current = {
      phase,
      id: typeof id === 'string' ? id.slice(0, 64) : null,
      detail: typeof detail === 'string' ? detail.slice(0, MAX_DETAIL) : '',
      source: source === 'bot' ? 'bot' : 'claude',
      updatedAt: this.#now(),
    }
    if (preview === null) this.#preview = null
    else if (preview !== undefined) {
      this.#preview = { text: String(preview.text ?? '').slice(0, MAX_PREVIEW), isError: preview.isError === true, id: this.#current.id }
    }
  }

  snapshot() {
    const settled = (this.#current.phase === 'completed' || this.#current.phase === 'error') && this.#now() - this.#current.updatedAt > SETTLE_MS
    return { ...this.#current, phase: settled ? 'idle' : this.#current.phase, preview: this.#preview }
  }
}

/** The microphone side of the bot: whether it is listening, and the last thing it heard or why it could not. */
export class Voice {
  #state = { state: 'idle', error: null, heard: null }

  set({ state, error = null, heard = null } = {}) {
    if (state !== 'idle' && state !== 'listening') throw fail(400, 'state is idle or listening')
    this.#state = {
      state,
      error: typeof error === 'string' ? error.slice(0, 300) : null,
      heard: typeof heard === 'string' ? heard.slice(0, 2000) : null,
    }
  }

  stop() {
    this.#state = { ...this.#state, state: 'idle' }
  }

  snapshot() {
    return { ...this.#state }
  }
}
