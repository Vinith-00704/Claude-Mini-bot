// Prompts typed or spoken into the floating bot, waiting for Claude Code.
//
// The bot never talks to a model. It puts what the person typed here, and the
// Claude Code side picks it up and submits it as an ordinary prompt of the
// ongoing session, under Claude Code's own permissions. The bot refuses new
// prompts while nothing on the Claude Code side is picking them up.

import { randomUUID } from 'node:crypto'

export const MAX_PROMPT = 8000
const MAX_QUEUED = 5
const MAX_ATTACHMENTS = 14   // a few screenshots, and up to MAX_FILES dropped files or folders
const MAX_FILES = 10
const MAX_PATH = 400
// Claude Code asks for new prompts about once a second. Silence for longer
// than this means it is not there.
const BRIDGE_TTL_MS = 15_000

const fail = (status, error) => Object.assign(new Error(error), { status })

export const isLocalPath = path =>
  typeof path === 'string' &&
  path.length <= MAX_PATH &&
  /^[A-Za-z]:\\/.test(path) &&
  !/[\u0000-\u001f\u007f]/.test(path) &&
  !path.split('\\').includes('..')

export class Prompts {
  #now
  #queue = []
  #lastClaimAt = 0
  #checkImage
  #checkPath

  /**
   * `checkImage(path)` answers whether a path is an image this companion made (a screenshot it saved);
   * `checkPath(path)` whether a path is a real file or folder: 'file', 'folder' or null.
   */
  constructor({ now = Date.now, checkImage = () => false, checkPath = () => null } = {}) {
    this.#now = now
    this.#checkImage = checkImage
    this.#checkPath = checkPath
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
    const images = this.#attachments(attachments)
    if (clean === '' && images.length === 0) throw fail(400, 'Type something to send.')
    if (clean.length > MAX_PROMPT) throw fail(413, `Prompts are ${MAX_PROMPT} characters at most.`)
    if (!this.isBridgeAlive) throw fail(503, 'Claude Code is not connected. Open a Claude Code session with the Mini Bot mod loaded.')
    if (this.#queue.length >= MAX_QUEUED) throw fail(429, 'Too many prompts are waiting. Let Claude Code catch up.')
    const item = { id: randomUUID(), text: clean, source: source === 'voice' ? 'voice' : 'text', attachments: images, at: this.#now() }
    this.#queue.push(item)
    return item
  }

  // What can ride along with a prompt is a screenshot the companion itself saved, or the path of a
  // file or folder the person dropped on the bot. The bot only ever passes a path on: it never reads,
  // copies or moves the file, and Claude Code opens it under its own permissions. Paths are plain
  // local ones (a drive letter, no network shares, no `..`, nothing that could carry a new line).
  #attachments(attachments) {
    if (attachments === undefined || attachments === null) return []
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw fail(400, `At most ${MAX_ATTACHMENTS} attachments.`)
    let files = 0
    return attachments.map(a => {
      if (a?.type === 'image') {
        if (typeof a.path !== 'string' || !this.#checkImage(a.path)) throw fail(400, 'That attachment is not a screenshot taken by Mini Bot.')
        return { type: 'image', path: a.path }
      }
      if (a?.type === 'file') {
        if (++files > MAX_FILES) throw fail(400, `At most ${MAX_FILES} files at a time.`)
        if (!isLocalPath(a.path)) throw fail(400, 'Only files and folders on this computer can be attached (a full path with a drive letter).')
        const kind = this.#checkPath(a.path)
        if (kind === null) throw fail(400, 'That file or folder was not found.')
        return { type: 'file', path: a.path, kind, direct: a.direct !== false }
      }
      throw fail(400, 'That kind of attachment is not supported.')
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
