// What the person has allowed for good, until they take it back: listening for the bot's name, full access
// to the mouse and keyboard, and the microphone button. Unlike the grants in permissions.mjs these survive a
// restart, because a companion that starts with the PC has nobody to ask.
//
// Turning one on takes the person's own answer in the bot (the runtime only calls `set(.., true)` from the
// overlay's routes). Turning one off takes nothing: anyone may lower the trust, nobody but the person may raise it.

import { readFile, rename, writeFile } from 'node:fs/promises'

export const TRUST_KINDS = ['listen', 'full', 'mic']

export class Trust {
  #file
  #state = { listen: false, full: false, mic: false }

  constructor({ file }) {
    this.#file = file
  }

  async load() {
    try {
      const stored = JSON.parse(await readFile(this.#file, 'utf8'))
      for (const kind of TRUST_KINDS) this.#state[kind] = stored?.[kind] === true
    } catch {
      // Nothing stored, or nothing readable: nothing is allowed.
    }
  }

  get(kind) {
    return this.#state[kind] === true
  }

  set(kind, value) {
    if (!TRUST_KINDS.includes(kind)) throw Object.assign(new Error('no such permission'), { status: 400 })
    this.#state[kind] = value === true
    const temp = `${this.#file}.${process.pid}.tmp`
    void writeFile(temp, JSON.stringify(this.#state))
      .then(() => rename(temp, this.#file))
      .catch(() => {})
  }

  snapshot() {
    return { ...this.#state }
  }
}
