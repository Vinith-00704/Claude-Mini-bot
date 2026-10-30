// Computer control: the gatekeeper between Claude Code's tools and the overlay's hands.
//
// Claude Code asks, through the mod's tools; the person answers, in the bot; the
// overlay looks and acts. Nothing here moves the mouse. This decides whether each
// step may happen, asks the person when the rules say so, and keeps the log.
//
// Every request from Claude Code gets a ticket and waits here for its answer (the
// mod polls the ticket), so a step that needs the person's yes simply takes as
// long as they do. Steps run one at a time, in the order they were asked.
//
// Control is one task long. It starts only with the person's yes in the bot, and
// ends when Claude says it is done, when the turn ends, when the person stops it
// (the bot, the stop key, the tray), when access is revoked, after a few idle
// minutes, or when the companion stops. Whatever ended it, nothing carries over.

import { appName, CONTROL_LEVELS } from '../../shared/config.mjs'

// Programs no setting unlocks, as appName spells them.
// Where Claude Code runs, so Claude can never answer its own permission prompts or type commands around them;
// sign-in and security screens; password managers; and the tools that end programs or change the system.
export const ALWAYS_BLOCKED = [
  'windowsterminal', 'wt', 'openconsole', 'conhost', 'cmd', 'powershell', 'pwsh', 'powershell_ise', 'wsl', 'bash',
  'mintty', 'alacritty', 'wezterm-gui', 'hyper', 'tabby', 'warp', 'claude', 'code', 'code - insiders', 'cursor',
  'windsurf', 'antigravity', 'antigravity ide', 'agy', 'kiro', 'trae', 'void', 'vscodium', 'zed', 'positron', 'idea64', 'pycharm64', 'webstorm64', 'rider64', 'clion64', 'goland64', 'phpstorm64', 'rubymine64',
  'consent', 'credentialuibroker', 'logonui', 'lockapp', 'sechealthui', 'securityhealthhost', 'securityhealthsystray',
  'taskmgr', 'regedit', 'mmc', 'msconfig', 'gpedit',
  '1password', 'bitwarden', 'keepass', 'keepassxc', 'lastpass', 'dashlane', 'nordpass', 'keeper', 'keepersecurity',
  'roboform', 'enpass', 'proton pass',
]

// What people call an app, and the program that is.
const ALIASES = {
  'microsoft edge': 'msedge', edge: 'msedge', 'google chrome': 'chrome', 'mozilla firefox': 'firefox',
  word: 'winword', 'microsoft word': 'winword', 'microsoft excel': 'excel', powerpoint: 'powerpnt',
  'microsoft powerpoint': 'powerpnt', 'new outlook': 'olk', 'file explorer': 'explorer', 'windows explorer': 'explorer',
  paint: 'mspaint', settings: 'systemsettings', 'windows settings': 'systemsettings', calculator: 'calculatorapp',
  teams: 'ms-teams', 'microsoft teams': 'ms-teams', 'snipping tool': 'snippingtool', photos: 'photos',
}

// Words that mark a step as important: it sends, deletes, pays, submits, installs or cannot be undone.
const IMPORTANT_WORDS = /\b(send|delete|remove|erase|discard|don'?t save|buy|purchase|order|pay|payment|checkout|submit|confirm|install|uninstall|format|publish|post|transfer|sign out|log ?out|empty|reset|overwrite|replace all|permanently|accept|agree)\b/i
// Keys that close, delete or send.
const IMPORTANT_KEYS = new Set(['Alt+F4', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+F4', 'Delete', 'Shift+Delete', 'Ctrl+Enter', 'Ctrl+Shift+Enter', 'Alt+S'])

export const ACTIONS = ['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'keys', 'focus']
const POINTER = new Set(['click', 'double_click', 'right_click', 'move', 'drag', 'scroll'])
const KEY_NAMES = new Set([
  'enter', 'tab', 'esc', 'space', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'up', 'down',
  'left', 'right', 'menu', 'plus', 'minus', 'comma', 'period', 'slash',
])
const KEY_ALIASES = { return: 'enter', escape: 'esc', del: 'delete', ins: 'insert', pgup: 'pageup', pgdn: 'pagedown', apps: 'menu' }
const MODS = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win', windows: 'Win' }

const GRANT_WAIT_MS = 2 * 60 * 1000
const CONFIRM_WAIT_MS = 2 * 60 * 1000
const PAUSE_WAIT_MS = 5 * 60 * 1000
const IDLE_MS = 3 * 60 * 1000
const JOB_MS = 20 * 1000
const TICKET_KEEP_MS = 10 * 60 * 1000

const fail = (status, error) => Object.assign(new Error(error), { status })
const printable = text => typeof text === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)

/** A key combination as Claude writes it ("ctrl+shift+n", "Enter") in its one spelling ("Ctrl+Shift+N"), or null. */
export const parseKeys = raw => {
  const parts = String(raw ?? '').trim().toLowerCase().split('+').map(p => p.trim())
  const typed = parts.pop() ?? ''
  const key = KEY_ALIASES[typed] ?? typed
  if (!(/^[a-z0-9]$/.test(key) || /^f([1-9]|1\d|2[0-4])$/.test(key) || KEY_NAMES.has(key))) return null
  const mods = new Set()
  for (const p of parts) {
    if (!(p in MODS)) return null
    mods.add(MODS[p])
  }
  const name = key.length === 1 || /^f\d/.test(key) ? key.toUpperCase() : key === 'pageup' ? 'PageUp' : key === 'pagedown' ? 'PageDown' : key[0].toUpperCase() + key.slice(1)
  return [...['Ctrl', 'Alt', 'Shift', 'Win'].filter(m => mods.has(m)), name].join('+')
}

/** Why a key combination is never sent, or null. They act on Windows itself, or on other programs' shortcuts, not on the app at hand. */
const forbiddenKeys = (keys, reserved) => {
  if (keys.includes('Win')) return 'Windows-key shortcuts act on Windows itself, not on the app'
  if (keys.startsWith('Ctrl+Alt+')) return 'Ctrl+Alt shortcuts belong to other programs (the bot\'s own stop and hide keys among them)'
  if (['Alt+Tab', 'Alt+Esc', 'Ctrl+Esc', 'Ctrl+Shift+Esc', 'Alt+Shift+Tab'].includes(keys)) return 'it switches programs or opens system screens; use the focus action to switch apps'
  if (reserved.includes(keys)) return 'it is one of the bot\'s own shortcuts'
  return null
}

/** A run of digits shaped like a card number (13 to 19 digits that pass the Luhn check). */
const looksLikeCard = text => {
  for (const match of String(text).matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    let sum = 0
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i])
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
      sum += d
    }
    if (sum % 10 === 0) return true
  }
  return false
}

const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

/** The checked and cleaned form of a step Claude asked for, or a 400 saying what is wrong with it. */
export const checkStep = raw => {
  const s = typeof raw === 'object' && raw !== null ? raw : {}
  if (!ACTIONS.includes(s.action)) throw fail(400, `action is one of: ${ACTIONS.join(', ')}`)
  const why = typeof s.why === 'string' ? s.why.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
  if (!why || !printable(why)) throw fail(400, 'why is a short description of the step, for the person')
  const step = { action: s.action, why, important: s.important === true, lookAfter: s.lookAfter !== false }
  if (POINTER.has(s.action)) {
    if (int(s.element, 1, 500)) step.element = s.element
    else if (int(s.x, 0, 20000) && int(s.y, 0, 20000)) Object.assign(step, { x: s.x, y: s.y })
    else throw fail(400, 'give x and y (pixels in the last screenshot) or element (a number from the last element list)')
  }
  if (s.action === 'drag') {
    if (!(int(s.toX, 0, 20000) && int(s.toY, 0, 20000))) throw fail(400, 'drag needs toX and toY')
    Object.assign(step, { toX: s.toX, toY: s.toY })
  }
  if (s.action === 'scroll') {
    if (!['up', 'down', 'left', 'right'].includes(s.direction)) throw fail(400, 'direction is up, down, left or right')
    step.direction = s.direction
    step.amount = int(s.amount, 1, 30) ? s.amount : 3
  }
  if (s.action === 'type') {
    if (typeof s.text !== 'string' || s.text.length === 0 || s.text.length > 4000) throw fail(400, 'text is 1 to 4000 characters')
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s.text)) throw fail(400, 'text may hold new lines and tabs, no other control characters')
    step.text = s.text
  }
  if (s.action === 'keys') {
    const keys = parseKeys(s.keys)
    if (!keys) throw fail(400, 'keys is one combination such as "ctrl+s", "enter", "shift+tab" or "f5"')
    step.keys = keys
    step.repeat = int(s.repeat, 1, 20) ? s.repeat : 1
  }
  if (s.action === 'focus') {
    if (typeof s.window !== 'string' || !s.window.trim() || s.window.length > 120 || !printable(s.window)) throw fail(400, 'window is a program name or part of a window title')
    step.window = s.window.trim()
  }
  return step
}

const checkLook = raw => {
  const s = typeof raw === 'object' && raw !== null ? raw : {}
  const look = { elements: s.elements !== false }
  if (s.monitor !== undefined) {
    if (!int(s.monitor, 1, 16)) throw fail(400, 'monitor is a number from the list of monitors')
    look.monitor = s.monitor
  }
  if (s.window !== undefined) {
    if (typeof s.window !== 'string' || s.window.length > 120 || !printable(s.window)) throw fail(400, 'window is a program name or part of a window title')
    look.window = s.window.trim()
  }
  if (s.waitSeconds !== undefined) {
    if (!(typeof s.waitSeconds === 'number' && s.waitSeconds >= 0 && s.waitSeconds <= 10)) throw fail(400, 'waitSeconds is 0 to 10')
    look.waitMs = Math.round(s.waitSeconds * 1000)
  }
  return look
}

// How a person names a program, where its name is not that already.
const FRIENDLY = {
  excel: 'Excel', winword: 'Word', powerpnt: 'PowerPoint', outlook: 'Outlook', olk: 'Outlook', msedge: 'Edge', chrome: 'Chrome',
  explorer: 'File Explorer', mspaint: 'Paint', systemsettings: 'Settings', calculatorapp: 'Calculator', 'ms-teams': 'Teams',
  snippingtool: 'Snipping Tool', onenote: 'OneNote',
}

const label = name => FRIENDLY[name] ?? name.replace(/(^|[ ._-])([a-z])/g, (_, a, b) => a + b.toUpperCase())

const quote = text => {
  const one = String(text).replace(/\s+/g, ' ')
  return `"${one.length > 60 ? one.slice(0, 57) + '...' : one}"`
}

/** The step as the person reads it in the confirmation: "Click "Save" in Notepad". */
const describe = (step, probe) => {
  const app = probe?.window ? label(appName(probe.window.process) ?? probe.window.process) : 'the app'
  const what = probe?.element?.name ? quote(probe.element.name) : null
  switch (step.action) {
    case 'click': return `Click ${what ?? 'here'} in ${app}`
    case 'double_click': return `Double-click ${what ?? 'here'} in ${app}`
    case 'right_click': return `Right-click ${what ?? 'here'} in ${app}`
    case 'move': return `Point at ${what ?? 'this spot'} in ${app}`
    case 'drag': return `Drag in ${app}`
    case 'scroll': return `Scroll ${step.direction} in ${app}`
    case 'type': return `Type ${quote(step.text)} in ${app}`
    case 'keys': return `Press ${step.keys}${step.repeat > 1 ? ` ${step.repeat} times` : ''} in ${app}`
    case 'focus': return `Switch to ${app}`
    default: return step.action
  }
}

export class Computer {
  #now
  #permissions
  #activity
  #config
  #isOverlayAttached
  #log
  #timers
  #seq = 0
  #session = null
  #last = null
  #question = null
  #jobs = []
  #pendingJobs = new Map()
  #tickets = new Map()
  #held = []
  #queue = Promise.resolve()
  #idleTimer = null

  constructor({ now = Date.now, permissions, activity, config, isOverlayAttached = () => true, log = () => {}, timers = { set: setTimeout, clear: clearTimeout } }) {
    this.#now = now
    this.#permissions = permissions
    this.#activity = activity
    this.#config = config
    this.#isOverlayAttached = isOverlayAttached
    this.#log = log
    this.#timers = timers
  }

  #id(prefix) {
    this.#seq += 1
    return `${prefix}${this.#seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }

  #after(ms, fn) {
    const handle = this.#timers.set(fn, ms)
    handle?.unref?.()
    return handle
  }

  #cancel(handle) {
    if (handle) this.#timers.clear(handle)
  }

  // ---- tickets: how a long step reaches the mod ----

  #ticket(work) {
    const id = this.#id('t')
    const entry = { done: false, value: undefined, at: this.#now(), promise: null }
    entry.promise = work.then(
      value => Object.assign(entry, { done: true, value }),
      error => Object.assign(entry, { done: true, value: { ok: false, error: error.message ?? String(error) } }),
    )
    this.#tickets.set(id, entry)
    for (const [key, old] of this.#tickets) if (old.done && this.#now() - old.at > TICKET_KEEP_MS) this.#tickets.delete(key)
    return id
  }

  /** The answer to a ticket, once it is there: waits up to `ms` for it, then says it is not done yet. */
  async wait(id, ms) {
    const entry = this.#tickets.get(String(id))
    if (!entry) throw fail(404, 'no such ticket')
    if (!entry.done) {
      let timer
      await Promise.race([entry.promise, new Promise(resolve => (timer = this.#after(Math.max(0, Math.min(Number(ms) || 0, 25000)), resolve)))])
      this.#cancel(timer)
    }
    if (!entry.done) return { done: false }
    this.#tickets.delete(String(id))
    return { done: true, ...entry.value }
  }

  /** One step at a time, in the order asked: two steps never race for the mouse. */
  #serial(fn) {
    const run = this.#queue.then(fn, fn)
    this.#queue = run.catch(() => {})
    return run
  }

  // ---- the overlay's side: jobs ----

  #job(kind, args) {
    if (!this.#isOverlayAttached()) return Promise.reject(fail(409, 'the bot\'s window is not running'))
    const id = this.#id('j')
    // Typing goes a character at a time, so a long text gets longer (about 12 ms a character, with room to spare).
    const allowed = JOB_MS + (kind === 'act' && typeof args.text === 'string' ? args.text.length * 15 : 0)
    return new Promise((resolve, reject) => {
      const timer = this.#after(allowed, () => {
        this.#pendingJobs.delete(id)
        this.#jobs = this.#jobs.filter(j => j.id !== id)
        reject(fail(504, 'the bot did not answer in time'))
      })
      this.#pendingJobs.set(id, { resolve, reject, timer })
      this.#jobs.push({ id, kind, args })
    })
  }

  /** The overlay takes what there is to do. */
  claimJobs() {
    const jobs = this.#jobs
    this.#jobs = []
    return { jobs }
  }

  /** The overlay says how a job went. */
  finishJob(body) {
    const pending = this.#pendingJobs.get(String(body?.id))
    if (!pending) return { ok: false }
    this.#pendingJobs.delete(String(body.id))
    this.#cancel(pending.timer)
    if (body.ok === false) pending.reject(fail(422, typeof body.error === 'string' ? body.error.slice(0, 300) : 'the step failed'))
    else pending.resolve(typeof body.data === 'object' && body.data !== null ? body.data : {})
    return { ok: true }
  }

  // ---- questions for the person ----

  #ask(kind, text, options, extra = {}, waitMs = CONFIRM_WAIT_MS) {
    return new Promise(resolve => {
      const id = this.#id('q')
      const timer = this.#after(waitMs, () => this.#settle(id, 'timeout'))
      this.#question = { id, kind, text, options, ...extra, resolve, timer }
    })
  }

  #settle(id, choice) {
    const q = this.#question
    if (!q || q.id !== id) return false
    this.#question = null
    this.#cancel(q.timer)
    q.resolve(choice)
    return true
  }

  /** The person's answer, from the bot. */
  answer(body) {
    const q = this.#question
    if (!q || q.id !== body?.id) throw fail(409, 'that question is no longer open')
    if (!q.options.some(o => o.id === body.choice)) throw fail(400, 'not one of the choices')
    this.#settle(q.id, body.choice)
    return { ok: true }
  }

  // ---- control ----

  #resolveApps(apps) {
    if (!Array.isArray(apps) || apps.length === 0 || apps.length > 8) throw fail(400, 'apps lists 1 to 8 programs Claude may use, such as "excel" or "notepad"')
    const names = []
    for (const raw of apps) {
      const typed = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      const name = appName(ALIASES[typed] ?? typed)
      if (!name) throw fail(400, `"${String(raw).slice(0, 40)}" is not a program name`)
      if (!names.includes(name)) names.push(name)
    }
    return names
  }

  /** Claude asks to control the PC for one task. The person answers in the bot. */
  start(body) {
    const task = typeof body?.task === 'string' ? body.task.replace(/\s+/g, ' ').trim() : ''
    if (!task || task.length > 300 || !printable(task)) throw fail(400, 'task says in a sentence what Claude will do (300 characters at most)')
    const apps = this.#resolveApps(body.apps)
    const config = this.#config()
    const blocked = apps.filter(a => ALWAYS_BLOCKED.includes(a) || config.computer.blockedApps.includes(a))
    if (blocked.length) throw fail(403, `${blocked.join(', ')} can never be controlled${blocked.some(a => ALWAYS_BLOCKED.includes(a)) ? ' (Claude Code runs there, or it guards passwords, security or the system)' : ' (the person blocked it)'}`)
    if (!this.#isOverlayAttached()) throw fail(409, 'the bot\'s window is not running: /mini-bot start')
    return this.#ticket(this.#serial(() => this.#grant(task, apps)))
  }

  async #grant(task, apps) {
    if (this.#session) {
      const same = this.#session.task === task && apps.every(a => this.#session.apps.includes(a))
      if (same) return { ok: true, granted: true, level: this.#session.level, apps: this.#session.apps, note: 'Control was already granted for this task.' }
      return { ok: false, granted: false, error: 'Control is already granted for another task. Call computer_stop first.' }
    }
    const config = this.#config()
    const first = config.computer.level
    const second = first === 'step' ? 'important' : 'step'
    const labels = { step: 'Allow, ask me each step', important: 'Allow, ask before important steps', free: "Allow, don't ask" }
    const names = apps.map(label).join(', ')
    const text = `Claude wants to use your mouse and keyboard to: ${task}\nApps: ${names}. You'll see each step happen; moving your mouse pauses it, and ${config.computer.stopKey} stops it.`
    const choice = await this.#ask('grant', text, [
      { id: first, label: labels[first], primary: true },
      { id: second, label: labels[second] },
      { id: 'deny', label: 'Deny' },
    ], {}, GRANT_WAIT_MS)
    if (!CONTROL_LEVELS.includes(choice)) {
      const why = { timeout: 'no answer', stopped: 'stopped before an answer' }[choice] ?? 'the person said no'
      this.#log({ kind: 'denied', task, apps, why })
      const error = {
        timeout: 'The person did not answer. Do not ask again unless they want you to.',
        stopped: 'Control was stopped before the person answered.',
      }[choice] ?? 'The person said no. Do not try to control the computer for this; ask how they want to go on.'
      return { ok: false, granted: false, error }
    }
    this.#permissions.grant('computer', { confirmed: true })
    this.#permissions.startCapture('computer')
    const at = this.#now()
    this.#session = { id: this.#id('s'), task, apps, level: choice, status: 'running', startedAt: at, actions: 0, actionLimit: config.computer.maxActions, timeLimitMs: config.computer.maxMinutes * 60000 }
    this.#touch()
    this.#activity.set({ phase: 'working', id: null, detail: 'Using your PC', source: 'claude' })
    this.#log({ kind: 'start', task, apps, level: choice })
    return { ok: true, granted: true, level: choice, apps }
  }

  #touch() {
    this.#cancel(this.#idleTimer)
    this.#idleTimer = this.#after(IDLE_MS, () => this.stop({ reason: 'nothing happened for 3 minutes' }))
  }

  /** Waits while the person has taken over. Returns a reason when the step cannot go on. */
  async #whenRunning() {
    const s = this.#session
    if (!s) return 'Control has ended. Call computer_start to ask again if the person wants you to go on.'
    if (s.status === 'running') return null
    const resumed = await new Promise(resolve => {
      const timer = this.#after(PAUSE_WAIT_MS, () => resolve(false))
      this.#held.push(ok => {
        this.#cancel(timer)
        resolve(ok)
      })
    })
    if (!this.#session) return 'Control has ended. Call computer_start to ask again if the person wants you to go on.'
    return resumed ? null : 'The person took over and has not handed control back. Wait for them; do not try other ways around it.'
  }

  /** At the action or time limit the person decides whether it goes on. */
  async #withinLimits() {
    const s = this.#session
    const overActions = s.actions >= s.actionLimit
    const overTime = this.#now() - s.startedAt >= s.timeLimitMs
    if (!overActions && !overTime) return null
    const config = this.#config()
    const text = overActions
      ? `Claude has taken ${s.actions} steps on: ${s.task}\nLet it go on for up to ${config.computer.maxActions} more?`
      : `Claude has been using your PC for ${Math.round((this.#now() - s.startedAt) / 60000)} minutes on: ${s.task}\nLet it go on for ${config.computer.maxMinutes} more minutes?`
    const choice = await this.#ask('limit', text, [{ id: 'more', label: 'Keep going', primary: true }, { id: 'stop', label: 'Stop' }])
    if (choice !== 'more') {
      this.stop({ reason: 'the person stopped it at the limit' })
      return 'The person stopped at the limit. Tell them where you got to.'
    }
    if (overActions) s.actionLimit = s.actions + config.computer.maxActions
    if (overTime) s.timeLimitMs = this.#now() - s.startedAt + config.computer.maxMinutes * 60000
    return null
  }

  /** Why a step may not happen there, or null. */
  #refusal(step, probe) {
    const w = probe?.window
    if (!w) return 'there is no window there'
    if (w.own) return 'that is the Mini Bot itself, which Claude never operates'
    const name = appName(w.process) ?? String(w.process).toLowerCase()
    if (ALWAYS_BLOCKED.includes(name)) return `${w.process} is never controlled (Claude Code runs there, or it guards passwords, security or the system)`
    if (this.#config().computer.blockedApps.includes(name)) return `the person blocked ${w.process}`
    if (w.elevated) return `${w.process} runs as administrator; Windows does not let other programs operate it, and the bot never asks for administrator rights`
    if (!this.#session.apps.includes(name)) return `${name} is not one of the apps allowed for this task (${this.#session.apps.join(', ')}). If you need it, call computer_stop and ask again with it listed`
    if (probe.toWindow && probe.toWindow.pid !== w.pid) return 'a drag may not end in another program'
    if (step.action === 'type' && probe.element?.isPassword) return 'that is a password field. Ask the person to type it themselves'
    if (step.action === 'type' && looksLikeCard(step.text)) return 'that looks like a card number. Ask the person to type it themselves'
    if (step.action === 'keys') {
      const bad = forbiddenKeys(step.keys, [this.#config().computer.stopKey, this.#config().hotkey.toggle])
      if (bad) return `${step.keys} is not sent: ${bad}`
    }
    return null
  }

  #isImportant(step, probe) {
    if (step.important) return true
    if (step.action === 'keys' && IMPORTANT_KEYS.has(step.keys)) return true
    if (step.action === 'type') return false
    return IMPORTANT_WORDS.test(probe?.element?.name ?? '') || IMPORTANT_WORDS.test(step.why)
  }

  /** Claude asks to see the screen. */
  look(body) {
    const look = checkLook(body)
    return this.#ticket(this.#serial(async () => {
      const held = await this.#whenRunning()
      if (held) return { ok: false, error: held }
      this.#touch()
      const seen = await this.#job('look', look)
      return { ok: true, ...seen }
    }))
  }

  /** Claude asks to take one step. */
  act(body) {
    const step = checkStep(body)
    return this.#ticket(this.#serial(() => this.#step(step)))
  }

  async #step(step) {
    const held = await this.#whenRunning()
    if (held) return { ok: false, error: held }
    this.#touch()
    const limit = await this.#withinLimits()
    if (limit) return { ok: false, error: limit }
    const s = this.#session
    const probe = await this.#job('probe', step)
    const refused = this.#refusal(step, probe)
    const what = describe(step, probe)
    const target = { process: probe?.window?.process ?? null, title: probe?.window?.title ?? null, element: probe?.element?.name ?? null }
    if (refused) {
      this.#log({ kind: 'refused', action: step.action, what, why: step.why, target, reason: refused })
      return { ok: false, refused: true, error: `Not done: ${refused}.` }
    }
    const important = this.#isImportant(step, probe)
    if (s.level === 'step' || (s.level === 'important' && important)) {
      const text = `${important ? 'Important: ' : ''}${what}?\n${step.why}`
      const choice = await this.#ask('confirm', text, [
        { id: 'allow', label: 'Allow', primary: true },
        { id: 'skip', label: 'Skip' },
        { id: 'stop', label: 'Stop' },
      ], { important, point: probe?.point ?? null })
      if (choice === 'stop') {
        this.stop({ reason: 'the person stopped it' })
        return { ok: false, error: 'The person stopped computer control. Tell them where you got to.' }
      }
      if (choice !== 'allow') {
        this.#log({ kind: 'skipped', action: step.action, what, why: step.why, target })
        return { ok: false, skipped: true, error: choice === 'timeout' ? 'The person did not answer, so the step was not taken. Wait for them.' : 'The person said no to this step. Do not try it another way; ask them what they want instead.' }
      }
      const stillHeld = await this.#whenRunning()
      if (stillHeld) return { ok: false, error: stillHeld }
    }
    if (!this.#session) return { ok: false, error: 'Control has ended.' }
    const done = await this.#job('act', { ...step, expectPid: probe.window.pid, expectToPid: probe.toWindow?.pid ?? null })
    s.actions += 1
    this.#touch()
    this.#activity.set({ phase: 'working', id: null, detail: `Using your PC: ${what}`, source: 'claude' })
    this.#log({ kind: 'act', action: step.action, what, why: step.why, target, text: step.action === 'type' ? step.text.slice(0, 80) : undefined })
    return { ok: true, did: what, ...done }
  }

  /** The person took over (moved the mouse or pressed a key). Steps wait until they hand control back. */
  pause(body) {
    const s = this.#session
    if (!s || s.status !== 'running' || this.#question) return { ok: false }
    s.status = 'paused'
    this.#log({ kind: 'paused', reason: typeof body?.reason === 'string' ? body.reason.slice(0, 80) : 'the person took over' })
    return { ok: true }
  }

  resume() {
    const s = this.#session
    if (!s || s.status !== 'paused') return { ok: false }
    s.status = 'running'
    this.#touch()
    this.#log({ kind: 'resumed' })
    for (const go of this.#held.splice(0)) go(true)
    return { ok: true }
  }

  /** Ends control, whoever asks: Claude when done, the turn ending, the person, the limits. */
  stop(body = {}) {
    const reason = typeof body.reason === 'string' && body.reason ? body.reason.slice(0, 120) : 'Claude finished'
    const summary = typeof body.summary === 'string' ? body.summary.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    if (this.#question?.kind === 'grant') this.#settle(this.#question.id, 'stopped')
    const s = this.#session
    if (!s) return { ok: true, wasRunning: false }
    this.#session = null
    if (this.#question) this.#settle(this.#question.id, 'stop')
    this.#cancel(this.#idleTimer)
    for (const go of this.#held.splice(0)) go(false)
    for (const [id, pending] of this.#pendingJobs) {
      this.#cancel(pending.timer)
      pending.reject(fail(409, 'control ended'))
      this.#pendingJobs.delete(id)
    }
    this.#jobs = []
    this.#permissions.stopCapture('computer')
    this.#permissions.revoke('computer')
    this.#last = { task: s.task, apps: s.apps, actions: s.actions, endedReason: reason, summary, endedAt: this.#now() }
    this.#log({ kind: 'end', task: s.task, actions: s.actions, reason, summary })
    return { ok: true, wasRunning: true, actions: s.actions }
  }

  get isRunning() {
    return this.#session !== null
  }

  snapshot() {
    const s = this.#session
    const q = this.#question
    return {
      status: s ? s.status : q?.kind === 'grant' ? 'asking' : 'off',
      task: s?.task ?? null,
      apps: s?.apps ?? [],
      level: s?.level ?? null,
      actions: s?.actions ?? 0,
      elapsedMs: s ? this.#now() - s.startedAt : 0,
      question: q ? { id: q.id, kind: q.kind, text: q.text, options: q.options.map(({ id, label, primary }) => ({ id, label, primary: primary === true })), important: q.important === true, point: q.point ?? null } : null,
      jobs: this.#jobs.length,
      last: this.#last,
    }
  }
}
