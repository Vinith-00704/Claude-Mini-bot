// Prompts typed or spoken into the floating bot, waiting for Claude Code.
//
// The bot never talks to a model. It puts what the person typed here, and the
// Claude Code side picks it up and submits it as an ordinary prompt of the
// ongoing session, under Claude Code's own permissions. The bot refuses new
// prompts while nothing on the Claude Code side is picking them up.

import { randomUUID } from 'node:crypto'

export const MAX_PROMPT = 8000
const MAX_QUEUED = 5
const MAX_ATTACHMENTS = 4
// Claude Code asks for new prompts about once a second. Silence for longer
// than this means it is not there.
const BRIDGE_TTL_MS = 15_000

const fail = (status, error) => Object.assign(new Error(error), { status })

export class Prompts {
  #now
  #queue = []
  #lastClaimAt = 0
  #checkImage

  /** `checkImage(path)` answers whether a path is an image this companion made (a screenshot it saved). */
  constructor({ now = Date.now, checkImage = () => false } = {}) {
    this.#now = now
    this.#checkImage = checkImage
  }

  get isBridgeAlive() {
    return this.#now() - this.#lastClaimAt <= BRIDGE_TTL_MS
  }

  get lastClaimAt() {
    return this.#lastClaimAt
  }

  get size() {
    return this.#queue.length
  }

  enqueue({ text, source, attachments } = {}) {
    const clean = typeof text === 'string' ? text.trim() : ''
    const images = this.#images(attachments)
    if (clean === '' && images.length === 0) throw fail(400, 'Type something to send.')
    if (clean.length > MAX_PROMPT) throw fail(413, `Prompts are ${MAX_PROMPT} characters at most.`)
    if (!this.isBridgeAlive) throw fail(503, 'Claude Code is not connected. Open a Claude Code session with the Mini Bot mod loaded.')
    if (this.#queue.length >= MAX_QUEUED) throw fail(429, 'Too many prompts are waiting. Let Claude Code catch up.')
    const item = { id: randomUUID(), text: clean, source: source === 'voice' ? 'voice' : 'text', attachments: images, at: this.#now() }
    this.#queue.push(item)
    return item
  }

  // Only screenshots the companion itself saved can ride along with a prompt: never
  // an arbitrary path, so nothing else on the computer can be slipped into Claude's view.
  #images(attachments) {
    if (attachments === undefined || attachments === null) return []
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw fail(400, `At most ${MAX_ATTACHMENTS} attachments.`)
    return attachments.map(a => {
      if (a?.type !== 'image' || typeof a.path !== 'string' || !this.#checkImage(a.path)) throw fail(400, 'That attachment is not a screenshot taken by Mini Bot.')
      return { type: 'image', path: a.path }
    })
  }

  /** Hands over everything waiting. Asking at all is the sign that Claude Code is there. */
  claim() {
    this.#lastClaimAt = this.#now()
    const items = this.#queue
    this.#queue = []
    return items
  }
}
