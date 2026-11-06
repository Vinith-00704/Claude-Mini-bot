// The companion runtime: the control interface over the configuration,
// visibility, permissions, the prompt queue and the overlay driver. Claude Code
// itself is never touched from here.

import { createServer } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { activeProfile, applyOp, normalizeConfig, sameChoices } from '../../shared/config.mjs'
import { Activity, Voice } from './activity.mjs'
import { check, newToken, sameToken } from './auth.mjs'
import { createAutostart } from './autostart.mjs'
import { Cards } from './cards.mjs'
import { Commands } from './commands.mjs'
import { Computer } from './computer.mjs'
import { Keeper } from './keeper.mjs'
import { Permissions } from './permissions.mjs'
import { Prompts } from './prompts.mjs'
import { Routines } from './routines.mjs'
import { Session } from './session.mjs'
import { Trust } from './trust.mjs'
import { indicatorFor, isVisible } from './visibility.mjs'

// 2: configuration owned here, prompt queue, activity and voice state.
// 3: the list of slash commands for the bot's `/` picker.
// 4: computer control.
// 5: Mini's own session, several sessions at once, questions in the bot, routines, full access, listening.
export const VERSION = 5
const MAX_BODY = 64 * 1024
// The list of slash commands is the one long request: a session with many skills makes it so.
// So is the overlay's report of a look or a step, which carries a picture of the screen.
const MAX_BODY_BY_ROUTE = { 'POST /v1/commands': 256 * 1024, 'POST /v1/computer/result': 12 * 1024 * 1024 }
// Screenshots and the computer-control log are kept a week, then removed when the runtime next starts.
const SCREENSHOT_DAYS = 7
// The entries of the last control session kept in memory for /mini-bot log.
const LOG_KEEP = 400
// Mini's own session starts this long after the PC does, once the rush of programs at sign-in has passed.
const PC_START_DELAY_MS = 20 * 1000
const ROUTINE_CHECK_MS = 15 * 1000
// Said by a routine: kept this long for the overlay to pick up.
const ANNOUNCE_KEEP_MS = 2 * 60 * 1000
// The file that says the person turned Mini off: a new Claude Code session leaves it off until they turn it on.
export const OFF_FLAG = 'turned-off'

const fail = (status, error) => Object.assign(new Error(error), { status })

const readJson = async (req, limit = MAX_BODY) => {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw fail(413, 'body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw fail(400, 'body is not JSON')
  }
}

const writeAtomic = async (file, text) => {
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, text)
  await rename(temp, file)
}

export const createRuntime = ({ dataDir, overlay, onExit = () => {}, now = Date.now, autostart = createAutostart({ dataDir }), keeperOptions = {}, startedByPc = false }) => {
  const token = newToken()
  // A second secret, handed only to the overlay process and never written to disk: the person's answers in the
  // bot (allow, skip, stop, take over) need it, so nothing that can read runtime.json can answer for them.
  const overlayKey = newToken()
  const permissions = new Permissions({ now })
  const trust = new Trust({ file: join(dataDir, 'trust.json') })
  const cards = new Cards({ now })
  const activity = new Activity({ now })
  const voice = new Voice()
  const session = new Session({ now })
  const commands = new Commands()
  const computerLogDir = resolve(join(dataDir, 'computer-log'))
  let controlLog = []
  const logControl = entry => {
    const line = { at: new Date(now()).toISOString(), ...entry }
    if (entry.kind === 'start') controlLog = []
    controlLog = [...controlLog, line].slice(-LOG_KEEP)
    const day = line.at.slice(0, 10)
    void appendFile(join(computerLogDir, `${day}.jsonl`), JSON.stringify(line) + '\n').catch(() => {})
  }
  // Built below the configuration it reads, at its first use.
  let computer = null
  const screenshotsDir = resolve(join(dataDir, 'screenshots'))
  const isScreenshot = path => {
    const full = resolve(path)
    return full.toLowerCase().startsWith((screenshotsDir + sep).toLowerCase()) && full.toLowerCase().endsWith('.png') && existsSync(full)
  }
  // A dropped file or folder: whether it is there, and which it is. Only its existence is looked at, never its contents.
  const kindOfPath = path => {
    try {
      const info = statSync(path)
      return info.isDirectory() ? 'folder' : info.isFile() ? 'file' : null
    } catch {
      return null
    }
  }
  // Built below the configuration it reads, at its first use.
  let keeper = null
  const prompts = new Prompts({ now, checkImage: isScreenshot, checkPath: kindOfPath, canWait: () => keeper.isWanted })
  const routines = new Routines({ file: join(dataDir, 'routines.json'), now })
  let announcement = null
  let routineTimer = null
  let offered = false
  let pcStart = false
  // Things asked for from Claude Code that the overlay carries out (taking a screenshot).
  const requests = { screenshot: 0 }
  // Whether Windows gave the overlay the hide/show shortcut ({ combo, ok }); another program may already own it.
  let hotkeyReport = null
  // The same for the other shortcuts, by name.
  const keyReports = {}
  const startedAt = now()
  const infoFile = join(dataDir, 'runtime.json')
  const cacheFile = join(dataDir, 'runtime-state.json')
  let config = normalizeConfig(undefined)
  computer = new Computer({ now, permissions, activity, config: () => config, isFull: () => trust.get('full'), isOverlayAttached: () => overlay.isAttached, log: logControl })
  keeper = new Keeper({
    dataDir,
    config: () => config,
    trust,
    isConnected: () => prompts.isMainAlive,
    onClosed: () => prompts.forgetMain(),
    botName: () => activeProfile(config).name,
    now,
    ...keeperOptions,
  })
  let server = null
  let port = 0
  let isStopping = false

  const persist = () => writeAtomic(cacheFile, JSON.stringify({ config })).catch(() => {})
  const url = () => `http://127.0.0.1:${port}`

  // The configuration is a copy of what the person chose. A change that leaves
  // the choices as they were does not count as a revision, so the Claude Code
  // side re-sending its copy on every connect does not look like an edit.
  const setConfig = next => {
    const normalized = normalizeConfig(next)
    if (sameChoices(normalized, config)) return
    const was = config.assistant
    config = { ...normalized, revision: config.revision + 1 }
    void persist()
    // The person asked for Mini's own session, or no longer wants it; a new model or mode takes effect at a restart.
    const now_ = config.assistant
    if (now_.session !== was.session) {
      if (now_.session) void keeper.retry()
      else void keeper.stop()
    } else if (now_.session && (now_.model !== was.model || now_.permissions !== was.permissions)) void keeper.restart()
    maybeOffer()
  }

  // ---- what the person allows, in the bot ----

  const ANSWER_YES = { id: 'yes', label: 'Turn it on', primary: true }
  const ANSWER_NO = { id: 'no', label: 'Not now' }
  const TRUST_QUESTIONS = {
    listen: () => `Let ${activeProfile(config).name} listen for its name all the time, so you can just say "Hey ${activeProfile(config).name}"?\nYour microphone stays on, and a small mark on your screen says so the whole time. Listening happens on this PC: nothing leaves it until you say the name, and then only what you say to it goes to Claude. You can turn it off any time.`,
    full: () => `Give Claude full access to your mouse and keyboard?\nClaude Code's session can then use any app without asking you first or asking about each step, including sending and deleting, so a mistake will not be stopped by a question. You still see it working, moving your mouse pauses it, ${config.computer.stopKey} stops it, and every step is logged. It stays on until you turn it off. It can never use terminals and code editors, password managers, sign-in or security screens, administrator windows or password fields.`,
  }

  /** Puts up the question that turns one of them on. Only the person's own click in the bot can answer it. */
  const askTrust = kind => {
    if (!TRUST_QUESTIONS[kind]) throw fail(400, 'what is listen or full')
    if (!overlay.isAttached) throw fail(409, 'the bot is not on the screen to ask you')
    if (trust.get(kind)) return
    cards.dismiss(`trust-${kind}`)
    void cards.ask({ kind: `trust-${kind}`, text: TRUST_QUESTIONS[kind](), options: [ANSWER_YES, ANSWER_NO] }).then(choice => {
      if (choice !== 'yes') return
      trust.set(kind, true)
      if (kind === 'listen') permissions.grant('microphone', { confirmed: true })
      // A session with full access works across every drive, which is set when it starts.
      if (kind === 'full' && config.assistant.session && ['idle', 'completed', 'error'].includes(activity.snapshot().phase)) void keeper.restart()
    })
  }

  /** Taking one back needs nothing, and takes effect at once. */
  const dropTrust = kind => {
    trust.set(kind, false)
    if (kind === 'listen') voice.stop()
    if (kind === 'full' && computer.snapshot().status !== 'off') computer.stop({ reason: 'full access was turned off' })
  }

  /** The one time the person is asked whether they want Mini as an always-on assistant. */
  function maybeOffer() {
    if (offered || config.assistant.offered || !config.onboarded || !overlay.isAttached || process.platform !== 'win32') return
    offered = true
    const name = activeProfile(config).name
    void cards.ask({
      kind: 'setup',
      text: `Make ${name} your always-on assistant?\n${name} would start with your PC and keep its own Claude Code session running in the background, so you can talk to it any time with no terminal open. It uses your Claude plan only when you ask it something. You can turn it off any time.`,
      options: [{ id: 'yes', label: 'Set it up', primary: true }, { id: 'no', label: 'Not now' }],
    }).then(async choice => {
      if (choice === 'stopped') return
      const patch = { offered: true, ...(choice === 'yes' ? { session: true } : {}) }
      const applied = applyOp(config, { op: 'settings', patch: { assistant: patch } })
      if (!('error' in applied)) setConfig(applied.config)
      if (choice !== 'yes') return
      const done = await autostart.enable()
      pcStart = done.ok
      askTrust('listen')
    })
  }

  // ---- routines ----

  const fireRoutines = () => {
    for (const routine of routines.due()) {
      if (routine.kind === 'say') {
        announcement = { id: routine.id + '-' + now(), text: routine.text, at: now() }
        continue
      }
      try {
        const item = prompts.enqueue({ text: routine.text, source: 'routine' })
        announcement = { id: item.id, text: `Running your routine: ${routine.text}`, at: now(), quiet: true }
        activity.set({ phase: 'sending', id: item.id, detail: 'Running a routine', source: 'bot', preview: null })
        void keeper.ensure()
      } catch (error) {
        announcement = { id: routine.id + '-' + now(), text: `A routine could not run: ${routine.text} (${error.message})`, at: now() }
      }
    }
    if (announcement && now() - announcement.at > ANNOUNCE_KEEP_MS) announcement = null
  }

  const endVoiceIfMicStopped = () => {
    if (!permissions.snapshot().microphone.active) voice.stop()
  }

  const state = () => ({
    running: true,
    version: VERSION,
    pid: process.pid,
    startedAt,
    config,
    overlay: { visible: isVisible(config), driver: overlay.name, isAttached: overlay.isAttached },
    permissions: permissions.snapshot(),
    indicator: indicatorFor(permissions, voice.snapshot().state === 'standby'),
    trust: trust.snapshot(),
    assistant: { ...keeper.snapshot(), startsWithPc: pcStart },
    sessions: prompts.sessions(),
    card: cards.current(),
    announcement,
    routines: routines.list().length,
    activity: activity.snapshot(),
    voice: voice.snapshot(),
    session: session.snapshot(),
    computer: computer.snapshot(),
    // Only a report about the shortcut now chosen counts; one about a shortcut since changed is old news.
    hotkey: hotkeyReport && hotkeyReport.combo === config.hotkey.toggle ? { ...hotkeyReport } : null,
    keys: { ...keyReports },
    commands: commands.summary(),
    bridge: { connected: prompts.isBridgeAlive, queued: prompts.size },
    paths: { screenshots: screenshotsDir, computerLog: computerLogDir },
    requests: { ...requests },
  })

  const change = op => {
    const result = applyOp(config, op)
    if ('error' in result) throw fail(400, result.error)
    setConfig(result.config)
    return { ...state(), message: result.message }
  }

  // The routes only the overlay may call: they carry the person's answers.
  const fromOverlay = ctx => {
    if (!sameToken(ctx.overlayKey, overlayKey)) throw fail(403, 'only the bot itself can answer for the person')
  }

  const routes = {
    'GET /v1/health': () => ({ ok: true, version: VERSION, pid: process.pid }),
    'GET /v1/state': () => state(),
    // The Claude Code side sends its whole copy (on connect, and after a change made there).
    'PUT /v1/config': body => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail(400, 'config must be an object')
      setConfig(body)
      return state()
    },
    // The floating UI asks for one named change at a time.
    'POST /v1/config/apply': body => change(body),
    'POST /v1/visibility': body => {
      if (typeof body.visible !== 'boolean') throw fail(400, 'visible must be true or false')
      return change({ op: 'settings', patch: { visible: body.visible } })
    },
    'POST /v1/overlay/position': body => change({ op: 'move', x: body.x, y: body.y }),
    'POST /v1/prompts': body => {
      const item = prompts.enqueue(body)
      const waking = prompts.target() === null
      activity.set({ phase: 'sending', id: item.id, detail: waking ? 'Waking up Claude Code' : 'Sending to Claude Code', source: 'bot', preview: null })
      if (waking) void keeper.ensure()
      return { id: item.id, state: state() }
    },
    'POST /v1/prompts/claim': body => {
      const claimed = prompts.claim(body.bridge)
      if (body.bridge?.role === 'main') keeper.noteSession(body.bridge.id, body.bridge.pid)
      return { ...claimed, revision: config.revision, version: VERSION }
    },
    // The person asked to stop what Claude is doing, from the bot.
    'POST /v1/prompts/abort': () => {
      prompts.askAbort()
      return state()
    },
    // The person chose which session the bot talks to (null: back to the usual choice).
    'POST /v1/prompts/target': body => {
      prompts.pin(typeof body.id === 'string' ? body.id : null)
      return state()
    },
    'POST /v1/overlay/request': body => {
      if (body.action !== 'screenshot') throw fail(400, 'action is screenshot')
      requests.screenshot += 1
      return state()
    },
    'POST /v1/activity': body => {
      // A turn the person started in a terminal says that is the session they are using.
      if (typeof body.session === 'string' && body.phase === 'thinking' && body.source !== 'bot') prompts.noteActive(body.session)
      if (prompts.isTarget(body.session)) activity.set(body)
      return state()
    },
    // The overlay says whether the shortcut it was given is now registered.
    'POST /v1/overlay/hotkey': body => {
      if (typeof body.combo !== 'string' || body.combo.length > 40 || typeof body.ok !== 'boolean') throw fail(400, 'combo is text and ok is true or false')
      if (typeof body.name === 'string' && ['talk', 'look'].includes(body.name)) keyReports[body.name] = { combo: body.combo, ok: body.ok }
      else hotkeyReport = { combo: body.combo, ok: body.ok }
      return state()
    },
    // The Claude Code side says which model the session runs on and at what effort. Shown, never acted on.
    'POST /v1/session': body => {
      if (prompts.isTarget(body.session)) session.set(body)
      return state()
    },
    // The Claude Code side says which slash commands exist; the overlay reads them for its picker.
    'POST /v1/commands': body => {
      if (prompts.isTarget(body.session)) commands.set(body.commands)
      return state()
    },
    'GET /v1/commands': () => commands.snapshot(),
    'POST /v1/voice': body => {
      voice.set(body)
      return state()
    },
    // Computer control. Claude Code's side asks and polls its tickets; the overlay claims the work and reports
    // back; the person's answers come from the overlay alone.
    'POST /v1/computer/start': body => ({ ticket: computer.start(body) }),
    'POST /v1/computer/look': body => ({ ticket: computer.look(body) }),
    'POST /v1/computer/act': body => ({ ticket: computer.act(body) }),
    'GET /v1/computer/ticket': (_body, ctx) => computer.wait(ctx.query.get('id'), Number(ctx.query.get('wait') ?? 0)),
    'POST /v1/computer/stop': body => computer.stop(body),
    'GET /v1/computer/log': () => ({ entries: controlLog, folder: computerLogDir, last: computer.snapshot().last }),
    'POST /v1/computer/jobs': (_body, ctx) => (fromOverlay(ctx), computer.claimJobs()),
    'POST /v1/computer/result': (body, ctx) => (fromOverlay(ctx), computer.finishJob(body)),
    'POST /v1/computer/answer': (body, ctx) => (fromOverlay(ctx), computer.answer(body), state()),
    'POST /v1/computer/pause': (body, ctx) => (fromOverlay(ctx), computer.pause(body), state()),
    'POST /v1/computer/resume': (_body, ctx) => (fromOverlay(ctx), computer.resume(), state()),
    'POST /v1/computer/halt': (body, ctx) => (fromOverlay(ctx), computer.stop({ reason: typeof body.reason === 'string' ? body.reason : 'the person stopped it' }), state()),
    // A look at the screen, and pointing at something on it, without taking control.
    'POST /v1/screen/look': body => ({ ticket: computer.screenLook(body) }),
    'POST /v1/screen/point': body => ({ ticket: computer.point(body) }),
    // Questions for the person. Anyone with the token may ask; only the overlay can answer.
    'POST /v1/cards/ask': body => ({ ticket: cards.askTicket({ kind: body.kind, text: body.text, options: body.options, waitMs: Number.isFinite(body.waitMs) ? body.waitMs : undefined }) }),
    'GET /v1/cards/ticket': (_body, ctx) => cards.wait(ctx.query.get('id'), Number(ctx.query.get('wait') ?? 0)),
    'POST /v1/cards/answer': (body, ctx) => (fromOverlay(ctx), cards.answer(body), state()),
    // Turning on what stays on (listening, full access) goes through a question in the bot; turning it off goes through nothing.
    'POST /v1/trust/ask': body => (askTrust(body.what), state()),
    'POST /v1/trust/off': body => (dropTrust(body.what), state()),
    // The person pressed Allow on the microphone question in the panel.
    'POST /v1/trust/mic': (_body, ctx) => (fromOverlay(ctx), trust.set('mic', true), state()),
    // Starting with the PC, and Mini's own session.
    'POST /v1/autostart': async body => {
      if (typeof body.on !== 'boolean') throw fail(400, 'on is true or false')
      const done = body.on ? await autostart.enable() : await autostart.disable()
      if (done.ok) pcStart = body.on
      return { ...done, state: state() }
    },
    'POST /v1/assistant': async body => {
      if (typeof body.on === 'boolean') {
        const applied = applyOp(config, { op: 'settings', patch: { assistant: { session: body.on, offered: true } } })
        if ('error' in applied) throw fail(400, applied.error)
        setConfig(applied.config)
      }
      if (body.restart === true) await keeper.restart()
      return state()
    },
    // Routines. A reminder is only words. One that gives Claude a prompt later runs by itself, so the person says yes in the bot first.
    'GET /v1/routines': () => ({ routines: routines.list() }),
    'POST /v1/routines': body => {
      const checked = routines.check(body)
      if (checked.kind === 'say') return { routine: routines.add(checked) }
      if (!overlay.isAttached) throw fail(409, 'the bot is not on the screen to ask you')
      const ticket = cards.askTicket({
        kind: 'routine',
        text: `Add a routine that runs by itself?\n"${checked.text}"\nWhen: ${String(body.when).slice(0, 60)}`,
        options: [{ id: 'yes', label: 'Add it', primary: true }, { id: 'no', label: 'No' }],
        waitMs: 2 * 60 * 1000,
      }, choice => (choice === 'yes' ? { routine: routines.add(checked) } : {}))
      return { ticket }
    },
    'POST /v1/routines/remove': body => ({ removed: routines.remove(body.which) }),
    'POST /v1/shutdown': body => {
      // Turned off by the person: a new Claude Code session leaves it off until they turn it on.
      if (body.off === true) void writeFile(join(dataDir, OFF_FLAG), String(now())).catch(() => {})
      setTimeout(() => void stop(), 50)
      return { ok: true }
    },
  }

  const permissionRoute = (method, path, body) => {
    const match = /^\/v1\/permissions\/([a-z]+)\/(grant|revoke|capture\/start|capture\/stop)$/.exec(path)
    if (method !== 'POST' || match === null) return undefined
    const [, kind, action] = match
    if (action === 'grant') permissions.grant(kind, body)
    else if (action === 'revoke') permissions.revoke(kind)
    else if (action === 'capture/start') {
      // Computer control starts only through a task the person allowed in the bot.
      if (kind === 'computer') throw fail(403, 'computer control starts with a task the person allows in the bot')
      permissions.startCapture(kind)
    } else permissions.stopCapture(kind)
    // Taking computer access away, or stopping it, ends control at once.
    if (kind === 'computer' && action !== 'grant') computer.stop({ reason: 'computer access was turned off' })
    if (kind === 'microphone' && action === 'revoke') {
      // Turned off in the bot's menu or /mini-bot: that takes back what was allowed for good, too.
      trust.set('mic', false)
      trust.set('listen', false)
      voice.stop()
    }
    endVoiceIfMicStopped()
    return state()
  }

  const handle = async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    }
    try {
      const refused = check(req, { token, port })
      if (refused) return send(refused.status, { error: refused.error })
      const where = new URL(req.url ?? '/', url())
      const path = where.pathname
      const method = req.method ?? 'GET'
      const route = routes[`${method} ${path}`]
      const body = method === 'GET' ? {} : await readJson(req, MAX_BODY_BY_ROUTE[`${method} ${path}`])
      const ctx = { query: where.searchParams, overlayKey: String(req.headers['x-mini-bot-overlay'] ?? '') }
      const answer = await (route ? route(body, ctx) : permissionRoute(method, path, body))
      if (answer === undefined) return send(404, { error: 'no such route' })
      send(200, answer)
    } catch (error) {
      send(error.status ?? 500, { error: error.status ? error.message : 'internal error' })
    }
  }

  const pruneScreenshots = async () => {
    const cutoff = now() - SCREENSHOT_DAYS * 24 * 60 * 60 * 1000
    for (const [dir, name] of [
      ...(await readdir(screenshotsDir).catch(() => [])).map(n => [screenshotsDir, n]),
      ...(await readdir(computerLogDir).catch(() => [])).map(n => [computerLogDir, n]),
    ]) {
      const file = join(dir, name)
      const info = await stat(file).catch(() => null)
      if (info && info.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true })
    }
  }

  const start = async () => {
    await mkdir(dataDir, { recursive: true })
    await mkdir(screenshotsDir, { recursive: true })
    await mkdir(computerLogDir, { recursive: true })
    await pruneScreenshots()
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      config = normalizeConfig(cached.config)
    } catch {}
    await trust.load()
    await routines.load()
    await rm(join(dataDir, OFF_FLAG), { force: true }).catch(() => {})
    // What the person allowed for good is theirs across a restart; everything else starts with nothing granted.
    if (trust.get('mic') || trust.get('listen')) permissions.grant('microphone', { confirmed: true })
    server = createServer((req, res) => void handle(req, res))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    port = server.address().port
    await writeAtomic(infoFile, JSON.stringify({ pid: process.pid, port, token, startedAt, version: VERSION }))
    overlay.start({ url: url(), token, overlayKey })
    pcStart = await autostart.isOn().catch(() => false)
    void autostart.refresh().catch(() => {})
    void keeper.begin({ delayMs: startedByPc ? PC_START_DELAY_MS : 0 }).catch(() => {})
    routineTimer = setInterval(fireRoutines, ROUTINE_CHECK_MS)
    routineTimer.unref?.()
    maybeOffer()
    return { port, token, url: url() }
  }

  // Stopping the runtime ends every capture and drops every grant first, then
  // closes the overlay: nothing the companion was allowed to watch outlives it.
  const stop = async () => {
    if (isStopping) return
    isStopping = true
    if (routineTimer) clearInterval(routineTimer)
    computer.stop({ reason: 'the companion stopped' })
    permissions.revokeAll()
    voice.stop()
    cards.clear()
    await keeper.shutdown().catch(() => {})
    overlay.stop()
    await new Promise(resolve => (server ? server.close(resolve) : resolve()))
    server?.closeAllConnections?.()
    await rm(infoFile, { force: true })
    onExit()
  }

  return { start, stop, state, permissions, prompts, activity, computer, keeper, routines, trust, cards, get token() { return token }, get overlayKey() { return overlayKey } }
}
