import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createAutostart, launcherSource } from '../lib/autostart.mjs'
import { Keeper, sessionEnv } from '../lib/keeper.mjs'
import { parseWhen, nextAfter, Routines } from '../lib/routines.mjs'
import { createRuntime, OFF_FLAG } from '../lib/runtime.mjs'

const stubOverlay = () => ({ name: 'test', start() {}, stop() {}, isAttached: true })

// A stand-in for Claude Code's process: nothing is started, and what was asked is noted.
const fakeSession = () => {
  const launched = []
  const stopped = []
  const dead = new Set()
  return {
    launched,
    stopped,
    die: pid => dead.add(pid),
    options: {
      launch: async request => {
        launched.push(request)
        return { ok: true, pid: 1000 + launched.length }
      },
      stopProcess: async pid => {
        stopped.push(pid)
        dead.add(pid)
      },
      isProcess: async pid => !dead.has(pid),
    },
  }
}

const fakeAutostart = () => {
  const calls = []
  let on = false
  return {
    calls,
    isOn: async () => on,
    refresh: async () => {},
    enable: async () => { calls.push('enable'); on = true; return { ok: true, message: 'on' } },
    disable: async () => { calls.push('disable'); on = false; return { ok: true, message: 'off' } },
  }
}

let dir
let runtime
let api
let asOverlay
let session
let autostart

const boot = async (extra = {}) => {
  session = fakeSession()
  autostart = fakeAutostart()
  runtime = createRuntime({ dataDir: dir, overlay: stubOverlay(), autostart, keeperOptions: session.options, ...extra })
  const { url, token } = await runtime.start()
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  api = call
  asOverlay = (method, path, body) => call(method, path, body, { 'x-mini-bot-overlay': runtime.overlayKey })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mini-bot-assistant-'))
  await boot()
})

afterEach(async () => {
  await runtime.stop()
  await rm(dir, { recursive: true, force: true })
})

const settle = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms))
const state = async () => (await api('GET', '/v1/state')).body
const claim = (id, role = 'terminal', name = 'project') => api('POST', '/v1/prompts/claim', { bridge: { id, role, name } })

/** Answers the question up now, as the person's click in the bot does. */
const answerCard = async choice => {
  const { card } = await state()
  assert.ok(card, 'a question is up')
  return asOverlay('POST', '/v1/cards/answer', { id: card.id, choice })
}

// ---- questions in the bot ----

test('only the bot can answer a question: having the token is not enough', async () => {
  const { body } = await api('POST', '/v1/cards/ask', { kind: 'permission', text: 'May I?', options: [{ id: 'allow', label: 'Allow', primary: true }, { id: 'deny', label: 'Deny' }] })
  const { card } = await state()
  assert.equal(card.text, 'May I?')
  assert.equal((await api('POST', '/v1/cards/answer', { id: card.id, choice: 'allow' })).status, 403)
  assert.equal((await api('GET', `/v1/cards/ticket?id=${body.ticket}&wait=0`)).body.done, false)
  assert.equal((await asOverlay('POST', '/v1/cards/answer', { id: card.id, choice: 'nonsense' })).status, 400)
  assert.equal((await asOverlay('POST', '/v1/cards/answer', { id: card.id, choice: 'allow' })).status, 200)
  const done = await api('GET', `/v1/cards/ticket?id=${body.ticket}&wait=2000`)
  assert.deepEqual([done.body.done, done.body.choice], [true, 'allow'])
  assert.equal((await state()).card, null)
})

test('questions come one at a time, in the order asked, and one left unanswered says so', async () => {
  const yes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  const first = await api('POST', '/v1/cards/ask', { text: 'First', options: yes, waitMs: 30 })
  await api('POST', '/v1/cards/ask', { text: 'Second', options: yes })
  assert.equal((await state()).card.text, 'First')
  await settle(60)
  assert.equal((await api('GET', `/v1/cards/ticket?id=${first.body.ticket}&wait=0`)).body.choice, 'timeout')
  assert.equal((await state()).card.text, 'Second')
  assert.equal((await api('POST', '/v1/cards/ask', { text: 'One choice', options: [{ id: 'a', label: 'A' }] })).status, 400)
})

// ---- what stays on until taken back ----

test('turning on listening or full access takes the person\'s click, and turning it off takes nothing', async () => {
  for (const what of ['listen', 'full']) {
    assert.equal((await api('POST', '/v1/trust/ask', { what })).status, 200)
    assert.equal((await state()).trust[what], false, 'asking does not turn it on')
    assert.equal((await answerCard('no')).status, 200)
    assert.equal((await state()).trust[what], false, 'no means no')
    await api('POST', '/v1/trust/ask', { what })
    await answerCard('yes')
    await settle()
    assert.equal((await state()).trust[what], true)
    await api('POST', '/v1/trust/off', { what })
    assert.equal((await state()).trust[what], false)
  }
  assert.equal((await api('POST', '/v1/trust/ask', { what: 'everything' })).status, 400)
  // There is no way in but the question: the microphone's own route is the overlay's alone.
  assert.equal((await api('POST', '/v1/trust/mic')).status, 403)
})

test('what was allowed for good survives a restart, with the microphone granted, and revoking the microphone takes it back', async () => {
  await api('POST', '/v1/trust/ask', { what: 'listen' })
  await answerCard('yes')
  await settle(30)
  await runtime.stop()
  await boot()
  const s = await state()
  assert.equal(s.trust.listen, true)
  assert.equal(s.permissions.microphone.granted, true)
  assert.equal(s.permissions.computer.granted, false, 'everything else starts with nothing granted')
  await api('POST', '/v1/permissions/microphone/revoke')
  const after = await state()
  assert.deepEqual([after.trust.listen, after.trust.mic, after.permissions.microphone.granted], [false, false, false])
})

test('listening for the name shows as standby, not as the microphone being captured', async () => {
  const on = await api('POST', '/v1/voice', { state: 'standby' })
  assert.deepEqual(on.body.indicator, { visible: false, kinds: [], standby: true })
  await api('POST', '/v1/permissions/microphone/grant', { confirmed: true })
  const talking = await api('POST', '/v1/permissions/microphone/capture/start')
  assert.deepEqual(talking.body.indicator.kinds, ['microphone'])
})

// ---- which session the bot talks to ----

test('a prompt goes to the terminal in use, else to Mini\'s own session, and only one of them gets it', async () => {
  await claim('main-1', 'main', 'Mini')
  await claim('term-1')
  await api('POST', '/v1/prompts', { text: 'for the terminal' })
  assert.deepEqual((await claim('main-1', 'main', 'Mini')).body.prompts, [])
  assert.deepEqual((await claim('term-1')).body.prompts.map(p => p.text), ['for the terminal'])
  const listed = (await state()).sessions
  assert.deepEqual(listed.map(s => [s.id, s.role, s.target]), [['main-1', 'main', false], ['term-1', 'terminal', true]])
})

test('a terminal left unused does not get the bot\'s prompts while Mini\'s own session is there', async () => {
  let time = Date.now()
  await runtime.stop()
  await boot({ now: () => time })
  await claim('term-1')
  time += 40 * 60 * 1000
  await claim('main-1', 'main', 'Mini')
  await claim('term-1')
  await api('POST', '/v1/prompts', { text: 'for mini' })
  assert.deepEqual((await claim('term-1')).body.prompts, [])
  assert.deepEqual((await claim('main-1', 'main', 'Mini')).body.prompts.map(p => p.text), ['for mini'])
  // A turn the person starts in the terminal says that is where they are working.
  await api('POST', '/v1/activity', { phase: 'thinking', source: 'claude', session: 'term-1' })
  assert.equal((await state()).sessions.find(s => s.target).id, 'term-1')
})

test('the person can choose the session, and what other sessions report does not reach the bot', async () => {
  await claim('main-1', 'main', 'Mini')
  await claim('term-1')
  assert.equal((await api('POST', '/v1/prompts/target', { id: 'nobody' })).status, 404)
  const chosen = await api('POST', '/v1/prompts/target', { id: 'main-1' })
  assert.deepEqual(chosen.body.sessions.find(s => s.target), { id: 'main-1', role: 'main', name: 'Mini', target: true, pinned: true })
  await api('POST', '/v1/activity', { phase: 'working', detail: 'Bash', session: 'term-1' })
  assert.equal((await state()).activity.phase, 'idle')
  await api('POST', '/v1/activity', { phase: 'working', detail: 'Read', session: 'main-1' })
  assert.equal((await state()).activity.detail, 'Read')
})

test('asking to stop reaches only the session the bot talks to, once', async () => {
  await claim('main-1', 'main', 'Mini')
  await claim('term-1')
  await api('POST', '/v1/prompts/abort')
  assert.equal((await claim('main-1', 'main', 'Mini')).body.abort, false)
  assert.equal((await claim('term-1')).body.abort, true)
  assert.equal((await claim('term-1')).body.abort, false)
})

test('a session from before there could be several still gets prompts', async () => {
  await api('POST', '/v1/prompts/claim', {})
  await api('POST', '/v1/prompts', { text: 'hello' })
  assert.deepEqual((await api('POST', '/v1/prompts/claim', {})).body.prompts.map(p => p.text), ['hello'])
})

// ---- Mini's own session ----

test('Mini\'s own session starts only once asked for, in its own folder, with its instructions, and without skipping permissions', async () => {
  assert.equal(session.launched.length, 0)
  const on = await api('POST', '/v1/assistant', { on: true })
  assert.equal(on.body.config.assistant.session, true)
  await settle(40)
  assert.equal(session.launched.length, 1)
  const { cwd, args, env } = session.launched[0]
  assert.equal(cwd, join(dir, 'home'))
  assert.match(await readFile(join(cwd, 'CLAUDE.md'), 'utf8'), /You are Mini/)
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'auto')
  assert.equal(args.join(' ').includes('skip-permissions'), false)
  assert.equal(args.join(' ').includes('bypass'), false)
  assert.equal(env.MINI_BOT_ROLE, 'main')
  assert.equal((await state()).assistant.status, 'starting')
  await claim('main-1', 'main', 'Mini')
  assert.equal((await state()).assistant.status, 'running')
})

test('an edited instructions file is left as it is', async () => {
  await api('POST', '/v1/assistant', { on: true })
  await settle(40)
  const file = join(dir, 'home', 'CLAUDE.md')
  await writeFile(file, 'mine')
  await runtime.keeper.restart()
  assert.equal(await readFile(file, 'utf8'), 'mine')
})

test('a prompt waits for Mini\'s session and wakes it, and with no session wanted it is refused', async () => {
  assert.equal((await api('POST', '/v1/prompts', { text: 'nobody home' })).status, 503)
  await api('POST', '/v1/assistant', { on: true })
  await settle(40)
  await runtime.keeper.stop()
  await settle()
  assert.equal(session.launched.length, 1)
  const sent = await api('POST', '/v1/prompts', { text: 'wake up' })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.state.activity.detail, 'Waking up Claude Code')
  await settle(40)
  assert.equal(session.launched.length, 2)
  assert.deepEqual((await claim('main-1', 'main', 'Mini')).body.prompts.map(p => p.text), ['wake up'])
})

test('turning the session off closes that session and nothing else, and stopping the companion does too', async () => {
  await api('POST', '/v1/assistant', { on: true })
  await settle(40)
  await api('POST', '/v1/assistant', { on: false })
  await settle(40)
  assert.deepEqual(session.stopped, [1001])
  await api('POST', '/v1/assistant', { on: true })
  await settle(40)
  await runtime.stop()
  assert.deepEqual(session.stopped, [1001, 1002])
  assert.equal(existsSync(join(dir, 'assistant.json')), false)
})

test('the same conversation is picked up when the session restarts; a new model or permission mode restarts it', async () => {
  await api('POST', '/v1/assistant', { on: true })
  await settle(40)
  await claim('abc-session', 'main', 'Mini')
  await api('POST', '/v1/config/apply', { op: 'settings', patch: { assistant: { model: 'haiku' } } })
  await settle(40)
  assert.equal(session.launched.length, 2)
  const { args } = session.launched[1]
  assert.equal(args[args.indexOf('--resume') + 1], 'abc-session')
  assert.equal(args[args.indexOf('--model') + 1], 'haiku')
  assert.equal((await api('POST', '/v1/config/apply', { op: 'settings', patch: { assistant: { permissions: 'bypassPermissions' } } })).status, 400, 'skipping permission checks is not a choice')
  assert.equal((await api('POST', '/v1/config/apply', { op: 'settings', patch: { assistant: { model: 'x y; rm -rf' } } })).status, 400)
})

test('the keeper says when the session may be waiting for the person, and brings a dead one back, but not for ever', async () => {
  let time = 1000
  const timers = []
  const fake = fakeSession()
  let connected = false
  const keeper = new Keeper({
    dataDir: dir,
    config: () => ({ assistant: { session: true, model: '', permissions: 'auto' } }),
    trust: { get: () => false },
    isConnected: () => connected,
    now: () => time,
    timers: { set: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t }, clear: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } },
    env: {},
    ...fake.options,
  })
  await keeper.begin()
  assert.equal(fake.launched.length, 1)
  const fire = async () => {
    const due = timers.splice(0)
    for (const t of due) t.fn()
    await settle(5)
  }
  await fire()
  assert.equal(keeper.snapshot().status, 'starting')
  time += 60 * 1000
  await fire()
  assert.equal(keeper.snapshot().status, 'needs-you')
  connected = true
  await fire()
  assert.equal(keeper.snapshot().status, 'running')
  connected = false
  for (let n = 0; n < 4; n++) {
    fake.die(1000 + fake.launched.length)
    await fire()
    await fire()
  }
  assert.equal(keeper.snapshot().status, 'failed')
  assert.equal(fake.launched.length, 4)
  await keeper.retry()
  assert.equal(fake.launched.length, 5)
  timers.length = 0
})

test('the session does not inherit what would make Claude Code think it is inside another session', () => {
  const env = sessionEnv({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: 'y', MINI_BOT_HOME: 'z' })
  assert.deepEqual(env, { PATH: 'x', CLAUDE_CONFIG_DIR: 'y', MINI_BOT_HOME: 'z', MINI_BOT_ROLE: 'main' })
})

// ---- on and off ----

test('turning off is remembered until the companion starts again; the session ending on its own is not', async () => {
  await api('POST', '/v1/shutdown', { off: true })
  await settle(120)
  assert.equal(existsSync(join(dir, OFF_FLAG)), true)
  await boot()
  assert.equal(existsSync(join(dir, OFF_FLAG)), false)
  await api('POST', '/v1/shutdown', {})
  await settle(120)
  assert.equal(existsSync(join(dir, OFF_FLAG)), false)
  await boot()
})

test('starting with the PC is the person\'s choice, and the session waits for the rush at sign-in', async () => {
  assert.equal((await state()).assistant.startsWithPc, false)
  assert.equal((await api('POST', '/v1/autostart', {})).status, 400)
  assert.equal((await api('POST', '/v1/autostart', { on: true })).body.state.assistant.startsWithPc, true)
  assert.deepEqual(autostart.calls, ['enable'])
  await api('POST', '/v1/autostart', { on: false })
  assert.deepEqual(autostart.calls, ['enable', 'disable'])
})

test('the person is asked once, after the first-run question, and saying yes sets it all up', async () => {
  assert.equal((await state()).card, null, 'not before the bot has been named')
  await api('POST', '/v1/config/apply', { op: 'settings', patch: { onboarded: true } })
  const { card } = await state()
  assert.equal(card.kind, 'setup')
  await answerCard('yes')
  await settle(40)
  const s = await state()
  assert.deepEqual([s.config.assistant.session, s.config.assistant.offered], [true, true])
  assert.deepEqual(autostart.calls, ['enable'])
  assert.equal(session.launched.length, 1)
  // Listening is its own question.
  assert.equal(s.card.kind, 'trust-listen')
  await answerCard('no')
  await runtime.stop()
  await boot()
  assert.equal((await state()).card, null, 'not asked again')
})

test('saying not now to the offer changes nothing, and is not asked again', async () => {
  await api('POST', '/v1/config/apply', { op: 'settings', patch: { onboarded: true } })
  await answerCard('no')
  await settle()
  const s = await state()
  assert.deepEqual([s.config.assistant.session, s.config.assistant.offered], [false, true])
  assert.deepEqual(autostart.calls, [])
  assert.equal(s.card, null)
})

test('the launcher finds the installed plugin afresh, and has no secrets in it', async () => {
  const source = launcherSource()
  assert.match(source, /installed_plugins\.json/)
  assert.match(source, /--pc-start/)
  assert.match(source, /MINI_BOT_HOME: here/)
  const calls = []
  const made = createAutostart({ dataDir: dir, nodePath: 'C:\\node\\node.exe', env: { MINI_BOT_RUN_VALUE: 'test value', SystemRoot: 'C:\\Windows' }, exec: async (file, args) => { calls.push([file, ...args]); return { ok: true, stdout: '' } } })
  assert.equal((await made.enable()).ok, true)
  const added = calls.find(c => c[1] === 'add')
  assert.equal(added[0], 'reg')
  assert.equal(added[added.indexOf('/v') + 1], 'test value')
  assert.match(added[added.indexOf('/d') + 1], /start-mini/)
  assert.equal(calls.some(c => c[0] === 'powershell.exe'), false, 'a test keeps its hands off the Start menu')
  assert.match((await readFile(join(dir, 'start-mini.vbs'))).toString('utf16le'), /WScript\.Shell/)
  assert.ok(existsSync(join(dir, 'start-mini.mjs')))
  await made.disable()
  assert.equal(calls.at(-1)[1], 'delete')
})

// ---- routines ----

test('times are read the way people write them', () => {
  const now = new Date(2026, 10, 6, 10, 0, 0).getTime()
  assert.equal(parseWhen('in 20 minutes', now).once, now + 20 * 60000)
  assert.equal(parseWhen('in 2 hours', now).once, now + 2 * 3600000)
  assert.equal(new Date(parseWhen('17:30', now).once).getHours(), 17)
  assert.equal(new Date(parseWhen('at 5pm', now).once).getHours(), 17)
  assert.equal(new Date(parseWhen('09:00', now).once).getDate(), 7, 'a time already gone today means tomorrow')
  assert.deepEqual(parseWhen('daily 09:00', now), { hour: 9, minute: 0, days: [0, 1, 2, 3, 4, 5, 6] })
  assert.deepEqual(parseWhen('weekdays 18:30', now), { hour: 18, minute: 30, days: [1, 2, 3, 4, 5] })
  assert.deepEqual(parseWhen('mon,thu 08:15', now), { hour: 8, minute: 15, days: [1, 4] })
  for (const bad of ['', 'soon', 'daily', '25:00', 'someday 09:00', '2020-01-01 10:00', 'in 0 minutes']) assert.equal(parseWhen(bad, now), null, bad)
  // 6 November 2026 is a Friday; weekdays at 09:00 next comes round on Monday the 9th.
  assert.equal(new Date(nextAfter({ hour: 9, minute: 0, days: [1, 2, 3, 4, 5] }, now)).getDate(), 9)
})

test('a reminder is added with no question and says its words when due; once it has gone off it is gone', async () => {
  let time = Date.now()
  await runtime.stop()
  await boot({ now: () => time })
  const added = await api('POST', '/v1/routines', { kind: 'say', text: 'Stretch', when: 'in 5 minutes' })
  assert.equal(added.body.routine.text, 'Stretch')
  assert.equal((await state()).routines, 1)
  const routines = new Routines({ file: join(dir, 'other.json'), now: () => time })
  assert.equal(routines.due().length, 0)
  const live = runtime.routines
  time += 6 * 60000
  assert.deepEqual(live.due().map(r => r.text), ['Stretch'])
  assert.equal(live.list().length, 0)
})

test('a routine that gives Claude a prompt needs the person\'s yes in the bot before it exists', async () => {
  const asked = await api('POST', '/v1/routines', { kind: 'ask', text: 'Brief me on my day', when: 'daily 09:00' })
  assert.ok(asked.body.ticket)
  assert.equal((await api('GET', '/v1/routines')).body.routines.length, 0)
  assert.match((await state()).card.text, /Brief me on my day/)
  await answerCard('yes')
  const done = await api('GET', `/v1/cards/ticket?id=${asked.body.ticket}&wait=2000`)
  assert.equal(done.body.routine.when, 'daily 09:00')
  const again = await api('POST', '/v1/routines', { kind: 'ask', text: 'Delete everything', when: 'daily 10:00' })
  await answerCard('no')
  const refused = await api('GET', `/v1/cards/ticket?id=${again.body.ticket}&wait=2000`)
  assert.equal(refused.body.routine, undefined)
  assert.equal((await api('GET', '/v1/routines')).body.routines.length, 1)
})

test('routines are checked, kept across a restart and removed by number', async () => {
  for (const bad of [{ kind: 'run', text: 'x', when: '10:00' }, { kind: 'say', text: '', when: '10:00' }, { kind: 'say', text: 'x', when: 'whenever' }, { kind: 'say', text: '/model opus', when: '10:00' }]) {
    assert.equal((await api('POST', '/v1/routines', bad)).status, 400, JSON.stringify(bad))
  }
  await api('POST', '/v1/routines', { kind: 'say', text: 'Later', when: 'in 3 hours' })
  await api('POST', '/v1/routines', { kind: 'say', text: 'Sooner', when: 'in 1 hour' })
  await settle(30)
  await runtime.stop()
  await boot()
  const { routines } = (await api('GET', '/v1/routines')).body
  assert.deepEqual(routines.map(r => r.text), ['Sooner', 'Later'])
  assert.equal((await api('POST', '/v1/routines/remove', { which: '1' })).body.removed.text, 'Sooner')
  assert.equal((await api('POST', '/v1/routines/remove', { which: '9' })).status, 404)
})

// ---- full access, looking and pointing ----

const job = async () => {
  for (let i = 0; i < 200; i++) {
    const { body } = await asOverlay('POST', '/v1/computer/jobs')
    if (body.jobs.length) return body.jobs[0]
    await settle(5)
  }
  throw new Error('no job came')
}
const finish = (id, data) => asOverlay('POST', '/v1/computer/result', { id, ok: true, data })
const ticket = async id => {
  for (;;) {
    const { body } = await api('GET', `/v1/computer/ticket?id=${id}&wait=2000`)
    if (body.done) return body
  }
}
const giveFullAccess = async () => {
  await api('POST', '/v1/trust/ask', { what: 'full' })
  await answerCard('yes')
  await settle()
}
const window = process => ({ window: { process, title: 't', pid: 7, own: false, elevated: false }, point: { x: 1, y: 1 } })

test('with full access a task starts with no question, in any app, and no step is asked about', async () => {
  await giveFullAccess()
  const start = await api('POST', '/v1/computer/start', { task: 'Do the thing', apps: ['notepad'] })
  const granted = await ticket(start.body.ticket)
  assert.deepEqual([granted.granted, granted.apps], [true, ['any app']])
  assert.equal((await state()).computer.full, true)
  const act = await api('POST', '/v1/computer/act', { action: 'click', why: 'send it', x: 1, y: 1, important: true })
  const probe = await job()
  assert.equal(probe.kind, 'probe')
  await finish(probe.id, window('outlook'))
  const doing = await job()
  assert.equal(doing.kind, 'act')
  assert.equal((await state()).computer.question, null)
  await finish(doing.id, {})
  assert.equal((await ticket(act.body.ticket)).ok, true)
})

test('full access does not unlock what is never controlled', async () => {
  await giveFullAccess()
  assert.equal((await api('POST', '/v1/computer/start', { task: 'x', apps: ['powershell'] })).status, 403)
  await ticket((await api('POST', '/v1/computer/start', { task: 'Do it', apps: ['notepad'] })).body.ticket)
  for (const [process, step, pattern] of [
    ['antigravity', { action: 'click', why: 'w', x: 1, y: 1 }, /never controlled/],
    ['1password', { action: 'click', why: 'w', x: 1, y: 1 }, /never controlled/],
    ['notepad', { action: 'keys', why: 'w', keys: 'win+r' }, /Windows-key/],
    ['notepad', { action: 'keys', why: 'w', keys: 'ctrl+alt+esc' }, /Ctrl\+Alt/],
    ['notepad', { action: 'type', why: 'w', text: '4242 4242 4242 4242' }, /card number/],
  ]) {
    const asked = await api('POST', '/v1/computer/act', step)
    const probe = await job()
    await finish(probe.id, window(process))
    assert.match((await ticket(asked.body.ticket)).error, pattern)
  }
  const typed = await api('POST', '/v1/computer/act', { action: 'type', why: 'w', text: 'secret' })
  const probe = await job()
  await finish(probe.id, { ...window('notepad'), element: { isPassword: true } })
  assert.match((await ticket(typed.body.ticket)).error, /password field/)
})

test('taking full access back ends control at once, and asks again next time', async () => {
  await giveFullAccess()
  await ticket((await api('POST', '/v1/computer/start', { task: 'Do it', apps: ['notepad'] })).body.ticket)
  assert.equal((await state()).computer.status, 'running')
  await api('POST', '/v1/trust/off', { what: 'full' })
  const s = await state()
  assert.equal(s.computer.status, 'off')
  assert.equal(s.computer.last.endedReason, 'full access was turned off')
  await api('POST', '/v1/computer/start', { task: 'Again', apps: ['notepad'] })
  await settle()
  assert.equal((await state()).computer.question.kind, 'grant')
  await api('POST', '/v1/computer/stop', {})
})

test('a look at the screen is asked about once for that look, and shows on the indicator while it is taken', async () => {
  const asked = await api('POST', '/v1/screen/look', {})
  await settle()
  const { question } = (await state()).computer
  assert.equal(question.kind, 'screen')
  await asOverlay('POST', '/v1/computer/answer', { id: question.id, choice: 'allow' })
  const look = await job()
  assert.equal(look.kind, 'look')
  assert.deepEqual((await state()).indicator.kinds, ['screen'])
  await finish(look.id, { image: 'abc', width: 10, height: 10 })
  const seen = await ticket(asked.body.ticket)
  assert.equal(seen.image, 'abc')
  const after = await state()
  assert.deepEqual(after.indicator.kinds, [])
  assert.equal(after.permissions.screen.granted, false, 'nothing is left granted')
  const refused = await api('POST', '/v1/screen/look', {})
  await settle()
  await asOverlay('POST', '/v1/computer/answer', { id: (await state()).computer.question.id, choice: 'deny' })
  assert.match((await ticket(refused.body.ticket)).error, /said no/)
})

test('with full access a look needs no question; pointing only draws', async () => {
  await giveFullAccess()
  const asked = await api('POST', '/v1/screen/look', {})
  const look = await job()
  assert.equal((await state()).computer.question, null)
  await finish(look.id, {})
  await ticket(asked.body.ticket)
  assert.equal((await api('POST', '/v1/screen/point', { label: 'here' })).status, 400)
  const point = await api('POST', '/v1/screen/point', { x: 5, y: 6, label: '  Click   here  ', seconds: 500 })
  const drawn = await job()
  assert.deepEqual([drawn.kind, drawn.args], ['point', { x: 5, y: 6, label: 'Click here', seconds: 12 }])
  await finish(drawn.id, {})
  assert.equal((await ticket(point.body.ticket)).ok, true)
})
