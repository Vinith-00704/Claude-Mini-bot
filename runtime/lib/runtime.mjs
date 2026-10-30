// The companion runtime: the control interface over the configuration,
// visibility, permissions, the prompt queue and the overlay driver. Claude Code
// itself is never touched from here.

import { createServer } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { applyOp, normalizeConfig, sameChoices } from '../../shared/config.mjs'
import { Activity, Voice } from './activity.mjs'
import { check, newToken, sameToken } from './auth.mjs'
import { Commands } from './commands.mjs'
import { Computer } from './computer.mjs'
import { Permissions } from './permissions.mjs'
import { Prompts } from './prompts.mjs'
import { Session } from './session.mjs'
import { indicatorFor, isVisible } from './visibility.mjs'

// 2: configuration owned here, prompt queue, activity and voice state.
// 3: the list of slash commands for the bot's `/` picker.
// 4: computer control.
export const VERSION = 4
const MAX_BODY = 64 * 1024
// The list of slash commands is the one long request: a session with many skills makes it so.
// So is the overlay's report of a look or a step, which carries a picture of the screen.
const MAX_BODY_BY_ROUTE = { 'POST /v1/commands': 256 * 1024, 'POST /v1/computer/result': 12 * 1024 * 1024 }
// Screenshots and the computer-control log are kept a week, then removed when the runtime next starts.
const SCREENSHOT_DAYS = 7
// The entries of the last control session kept in memory for /mini-bot log.
const LOG_KEEP = 400

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

export const createRuntime = ({ dataDir, overlay, onExit = () => {}, now = Date.now }) => {
  const token = newToken()
  // A second secret, handed only to the overlay process and never written to disk: the person's answers in the
  // bot (allow, skip, stop, take over) need it, so nothing that can read runtime.json can answer for them.
  const overlayKey = newToken()
  const permissions = new Permissions({ now })
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
  const prompts = new Prompts({ now, checkImage: isScreenshot, checkPath: kindOfPath })
  // Things asked for from Claude Code that the overlay carries out (taking a screenshot).
  const requests = { screenshot: 0 }
  // Whether Windows gave the overlay the hide/show shortcut ({ combo, ok }); another program may already own it.
  let hotkeyReport = null
  const startedAt = now()
  const infoFile = join(dataDir, 'runtime.json')
  const cacheFile = join(dataDir, 'runtime-state.json')
  let config = normalizeConfig(undefined)
  computer = new Computer({ now, permissions, activity, config: () => config, isOverlayAttached: () => overlay.isAttached, log: logControl })
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
    config = { ...normalized, revision: config.revision + 1 }
    void persist()
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
    indicator: indicatorFor(permissions),
    activity: activity.snapshot(),
    voice: voice.snapshot(),
    session: session.snapshot(),
    computer: computer.snapshot(),
    // Only a report about the shortcut now chosen counts; one about a shortcut since changed is old news.
    hotkey: hotkeyReport && hotkeyReport.combo === config.hotkey.toggle ? { ...hotkeyReport } : null,
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
      activity.set({ phase: 'sending', id: item.id, detail: 'Sending to Claude Code', source: 'bot', preview: null })
      return { id: item.id, state: state() }
    },
    'POST /v1/prompts/claim': () => ({ prompts: prompts.claim(), revision: config.revision, version: VERSION }),
    'POST /v1/overlay/request': body => {
      if (body.action !== 'screenshot') throw fail(400, 'action is screenshot')
      requests.screenshot += 1
      return state()
    },
    'POST /v1/activity': body => {
      activity.set(body)
      return state()
    },
    // The overlay says whether the shortcut it was given is now registered.
    'POST /v1/overlay/hotkey': body => {
      if (typeof body.combo !== 'string' || body.combo.length > 40 || typeof body.ok !== 'boolean') throw fail(400, 'combo is text and ok is true or false')
      hotkeyReport = { combo: body.combo, ok: body.ok }
      return state()
    },
    // The Claude Code side says which model the session runs on and at what effort. Shown, never acted on.
    'POST /v1/session': body => {
      session.set(body)
      return state()
    },
    // The Claude Code side says which slash commands exist; the overlay reads them for its picker.
    'POST /v1/commands': body => {
      commands.set(body.commands)
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
    'POST /v1/shutdown': () => {
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
    server = createServer((req, res) => void handle(req, res))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    port = server.address().port
    await writeAtomic(infoFile, JSON.stringify({ pid: process.pid, port, token, startedAt, version: VERSION }))
    overlay.start({ url: url(), token, overlayKey })
    return { port, token, url: url() }
  }

  // Stopping the runtime ends every capture and drops every grant first, then
  // closes the overlay: nothing the companion was allowed to watch outlives it.
  const stop = async () => {
    if (isStopping) return
    isStopping = true
    computer.stop({ reason: 'the companion stopped' })
    permissions.revokeAll()
    voice.stop()
    overlay.stop()
    await new Promise(resolve => (server ? server.close(resolve) : resolve()))
    server?.closeAllConnections?.()
    await rm(infoFile, { force: true })
    onExit()
  }

  return { start, stop, state, permissions, prompts, activity, computer, get token() { return token }, get overlayKey() { return overlayKey } }
}
