// Prompts typed or spoken into the floating bot, waiting for Claude Code.
//
// The bot never talks to a model. It puts what the person typed here, and the
// Claude Code side picks it up and submits it as an ordinary prompt of the
// ongoing session, under Claude Code's own permissions. The bot refuses new
// prompts while nothing on the Claude Code side is picking them up, unless
// Mini's own session is on its way to do so.
//
// Several Claude Code sessions can be connected at once, and a prompt goes to one
// of them: the session the person chose, else the terminal they are working in
// (one that has been in use lately), else Mini's own session in the background.

import { randomUUID } from 'node:crypto'

export const MAX_PROMPT = 8000
const MAX_QUEUED = 5
const MAX_ATTACHMENTS = 14   // a few screenshots, and up to MAX_FILES dropped files or folders
const MAX_FILES = 10
const MAX_PATH = 400
// Claude Code asks for new prompts about once a second. Silence for longer
// than this means it is not there.
const BRIDGE_TTL_MS = 15_000
// A terminal left open and unused does not get the bot's prompts when Mini's own session is there to take them.
const TERMINAL_IN_USE_MS = 30 * 60 * 1000
const MAX_NAME = 60
// Long enough that a PC waking from sleep does not make every terminal look newly in use.
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000

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
  #canWait
  #bridges = new Map()
  #pinned = null
  #abortAsked = false

  /**
   * `checkImage(path)` answers whether a path is an image this companion made (a screenshot it saved);
   * `checkPath(path)` whether a path is a real file or folder: 'file', 'folder' or null;
   * `canWait()` whether a prompt may wait for a session that is on its way (Mini's own).
   */
  constructor({ now = Date.now, checkImage = () => false, checkPath = () => null, canWait = () => false } = {}) {
    this.#now = now
    this.#checkImage = checkImage
    this.#checkPath = checkPath
    this.#canWait = canWait
  }

  get isBridgeAlive() {
    return this.#now() - this.#lastClaimAt <= BRIDGE_TTL_MS
  }

  #alive() {
    const now = this.#now()
    return [...this.#bridges.values()].filter(b => now - b.lastSeen <= BRIDGE_TTL_MS)
  }

  /** Whether Mini's own session is picking up prompts. */
  get isMainAlive() {
    return this.#alive().some(b => b.role === 'main')
  }

  /** The session the bot talks to now, or null. */
  target() {
    const alive = this.#alive()
    const pinned = alive.find(b => b.id === this.#pinned)
    if (pinned) return pinned
    const now = this.#now()
    const terminals = alive.filter(b => b.role !== 'main').sort((a, b) => b.lastActive - a.lastActive)
    const main = alive.find(b => b.role === 'main')
    if (!main) return terminals[0] ?? null
    return terminals[0] && now - terminals[0].lastActive <= TERMINAL_IN_USE_MS ? terminals[0] : main
  }

  /** The person chooses the session (null: back to the usual choice). */
  pin(id) {
    if (id !== null && !this.#alive().some(b => b.id === id)) throw fail(404, 'that session is not connected')
    this.#pinned = id
  }

  /** The person (or a turn they started there) is using this session. */
  noteActive(id) {
    const bridge = this.#bridges.get(id)
    if (bridge) bridge.lastActive = this.#now()
  }

  /** Whether a report from this session is about the one the bot talks to. A session that does not say who it is counts. */
  isTarget(id) {
    return typeof id !== 'string' || id === '' || this.target()?.id === id
  }

  /** The connected sessions, for the bot's menu and /mini-bot status. */
  sessions() {
    const target = this.target()
    return this.#alive()
      .sort((a, b) => (a.role === 'main' ? -1 : 0) - (b.role === 'main' ? -1 : 0) || b.lastActive - a.lastActive)
      .map(b => ({ id: b.id, role: b.role, name: b.name, target: b.id === target?.id, pinned: b.id === this.#pinned }))
  }

  /** Mini's own session has been closed, so nothing waits on its last word for the time it takes to look gone. */
  forgetMain() {
    for (const [key, b] of this.#bridges) if (b.role === 'main') this.#bridges.delete(key)
  }

  /** The person asked to stop what Claude is doing: said to the session the next time it asks for prompts. */
  askAbort() {
    this.#abortAsked = true
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
    if (this.#alive().length === 0 && !this.isBridgeAlive && !this.#canWait()) throw fail(503, 'Claude Code is not connected. Open a Claude Code session with the Mini Bot mod loaded, or run /mini-bot assistant on for one in the background.')
    if (this.#queue.length >= MAX_QUEUED) throw fail(429, 'Too many prompts are waiting. Let Claude Code catch up.')
    const item = { id: randomUUID(), text: clean, source: source === 'voice' || source === 'routine' ? source : 'text', attachments: images, at: this.#now() }
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

  /**
   * Hands over everything waiting to the session it is for, with whether the person asked to stop. Asking at all is the sign
   * that the session is there. `bridge` says who is asking (`{ id, role, name, pid }`); a session from before there could be
   * several says nothing, and is taken for a terminal.
   */
  claim(bridge) {
    const now = this.#now()
    this.#lastClaimAt = now
    const id = typeof bridge?.id === 'string' && bridge.id !== '' ? bridge.id.slice(0, 64) : 'unnamed'
    const known = this.#bridges.get(id)
    this.#bridges.set(id, {
      id,
      role: bridge?.role === 'main' ? 'main' : 'terminal',
      name: typeof bridge?.name === 'string' ? bridge.name.replace(/[^\x20-\x7e]/g, '').slice(0, MAX_NAME) : known?.name ?? '',
      lastSeen: now,
      lastActive: known?.lastActive ?? now,
    })
    for (const [key, b] of this.#bridges) if (now - b.lastSeen > FORGET_AFTER_MS) this.#bridges.delete(key)
    if (this.target()?.id !== id) return { prompts: [], abort: false }
    const prompts = this.#queue
    const abort = this.#abortAsked
    this.#queue = []
    this.#abortAsked = false
    return { prompts, abort }
  }
}
