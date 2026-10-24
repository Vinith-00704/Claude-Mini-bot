// Companion access: screen, microphone and computer control.
//
// This is the companion's own access and nothing else. It never reads or
// writes Claude Code's permission rules; those stay where Claude Code keeps
// them.
//
// A grant needs an explicit confirmation from the caller, and it lives only as
// long as this runtime process: a restarted runtime starts with nothing
// granted. A capture can only run while its access is granted, and revoking
// the access ends the capture in the same step.

export const KINDS = ['screen', 'microphone', 'computer']

const blank = () => ({ granted: false, grantedAt: null, active: false, activeSince: null })

export class Permissions {
  #state = Object.fromEntries(KINDS.map(kind => [kind, blank()]))
  #now

  constructor({ now = Date.now } = {}) {
    this.#now = now
  }

  #entry(kind) {
    if (!KINDS.includes(kind)) {
      throw Object.assign(new Error(`unknown access "${kind}"`), { status: 404 })
    }
    return this.#state[kind]
  }

  grant(kind, { confirmed } = {}) {
    const entry = this.#entry(kind)
    if (confirmed !== true) {
      throw Object.assign(new Error('granting needs explicit confirmation'), { status: 403 })
    }
    if (!entry.granted) {
      entry.granted = true
      entry.grantedAt = this.#now()
    }
  }

  revoke(kind) {
    this.#entry(kind)
    this.#state[kind] = blank()
  }

  startCapture(kind) {
    const entry = this.#entry(kind)
    if (!entry.granted) {
      throw Object.assign(new Error(`${kind} access is not granted`), { status: 403 })
    }
    if (!entry.active) {
      entry.active = true
      entry.activeSince = this.#now()
    }
  }

  stopCapture(kind) {
    const entry = this.#entry(kind)
    entry.active = false
    entry.activeSince = null
  }

  /** Ends every running capture. Grants are kept. */
  stopAllCaptures() {
    for (const kind of KINDS) this.stopCapture(kind)
  }

  /** Ends every capture and drops every grant. */
  revokeAll() {
    for (const kind of KINDS) this.revoke(kind)
  }

  activeKinds() {
    return KINDS.filter(kind => this.#state[kind].active)
  }

  snapshot() {
    return Object.fromEntries(KINDS.map(kind => [kind, { ...this.#state[kind] }]))
  }
}
