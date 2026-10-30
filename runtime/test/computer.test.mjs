import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { checkStep, parseKeys } from '../lib/computer.mjs'
import { createRuntime } from '../lib/runtime.mjs'

// A stand-in for the overlay process: attached, drawing nothing. The tests play its part over the interface.
const stubOverlay = () => ({ name: 'test', start() {}, stop() {}, isAttached: true })

let dir
let runtime
let api
let asOverlay

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mini-bot-computer-'))
  runtime = createRuntime({ dataDir: dir, overlay: stubOverlay() })
  const { url, token } = await runtime.start()
  const call = async (method, path, body, extra = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  api = call
  asOverlay = (method, path, body) => call(method, path, body, { 'x-mini-bot-overlay': runtime.overlayKey })
})

afterEach(async () => {
  await runtime.stop()
  await rm(dir, { recursive: true, force: true })
})

const settle = () => new Promise(resolve => setTimeout(resolve, 15))

/** The ticket's answer, once it is there. */
const result = async ticket => {
  for (;;) {
    const reply = await api('GET', `/v1/computer/ticket?id=${ticket}&wait=2000`)
    assert.equal(reply.status, 200)
    if (reply.body.done) return reply.body
  }
}

/** The ticket's answer if it is already there, else null (without waiting). */
const peek = async ticket => {
  const reply = await api('GET', `/v1/computer/ticket?id=${ticket}&wait=0`)
  return reply.body.done ? reply.body : null
}

/** The next job the overlay is given. */
const nextJob = async () => {
  for (let i = 0; i < 200; i++) {
    const { body } = await asOverlay('POST', '/v1/computer/jobs')
    if (body.jobs.length) return body.jobs[0]
    await settle()
  }
  throw new Error('no job came')
}

const question = async () => {
  for (let i = 0; i < 200; i++) {
    const { body } = await api('GET', '/v1/state')
    if (body.computer.question) return body.computer.question
    await settle()
  }
  throw new Error('no question came')
}

const answer = async choice => {
  const q = await question()
  const reply = await asOverlay('POST', '/v1/computer/answer', { id: q.id, choice })
  assert.equal(reply.status, 200)
  return q
}

const excel = { window: { pid: 400, process: 'EXCEL', title: 'Book1 - Excel', elevated: false, own: false }, element: { name: 'Save', type: 'button', isPassword: false }, point: { x: 10, y: 20 } }

/** Control granted for Excel and Notepad, at a level. */
const granted = async (level = 'step') => {
  // "Allow, don't ask" is offered only to a person who chose it in the settings.
  if (level === 'free') await api('POST', '/v1/config/apply', { op: 'settings', patch: { computer: { level: 'free' } } })
  const { body } = await api('POST', '/v1/computer/start', { task: 'Make a chart from the sales sheet', apps: ['Excel', 'notepad.exe'] })
  await answer(level)
  const done = await result(body.ticket)
  assert.equal(done.granted, true)
  return done
}

/** One step: the probe is answered as `probe` says; returns the ticket. */
const step = async (args, probe = excel) => {
  const { status, body } = await api('POST', '/v1/computer/act', { why: 'to save the work', ...args })
  assert.equal(status, 200, JSON.stringify(body))
  const job = await nextJob()
  assert.equal(job.kind, 'probe')
  await asOverlay('POST', '/v1/computer/result', { id: job.id, ok: true, data: probe })
  return body.ticket
}

/** The overlay carries out the next act job. */
const performs = async (data = { image: 'x' }) => {
  const job = await nextJob()
  assert.equal(job.kind, 'act')
  await asOverlay('POST', '/v1/computer/result', { id: job.id, ok: true, data })
  return job
}

test('a step is checked before anything is asked of anyone', () => {
  assert.throws(() => checkStep({ action: 'click', x: 1, y: 2 }), /why/)
  assert.throws(() => checkStep({ action: 'hover', why: 'x' }), /action is one of/)
  assert.throws(() => checkStep({ action: 'click', why: 'x' }), /x and y/)
  assert.throws(() => checkStep({ action: 'type', why: 'x', text: 'a\u0007b' }), /control characters/)
  assert.throws(() => checkStep({ action: 'keys', why: 'x', keys: 'ctrl+hyper+s' }), /one combination/)
  assert.deepEqual(checkStep({ action: 'scroll', why: 'x', element: 3, direction: 'down' }), { action: 'scroll', why: 'x', important: false, lookAfter: true, element: 3, direction: 'down', amount: 3 })
  assert.equal(parseKeys('control+shift+n'), 'Ctrl+Shift+N')
  assert.equal(parseKeys('Return'), 'Enter')
  assert.equal(parseKeys('alt+f4'), 'Alt+F4')
  assert.equal(parseKeys('pgdn'), 'PageDown')
})

test('control starts only with the person\'s yes in the bot, and a no leaves nothing granted', async () => {
  assert.equal((await api('POST', '/v1/computer/start', { task: 'x', apps: [] })).status, 400)
  assert.match((await api('POST', '/v1/computer/start', { task: 'x', apps: ['WindowsTerminal'] })).body.error, /never be controlled/)
  assert.match((await api('POST', '/v1/computer/start', { task: 'x', apps: ['keepass'] })).body.error, /never be controlled/)
  // Steps before a grant are refused.
  const early = await api('POST', '/v1/computer/act', { action: 'click', x: 1, y: 1, why: 'x' })
  assert.match((await result(early.body.ticket)).error, /Control has ended|computer_start/)

  const { body } = await api('POST', '/v1/computer/start', { task: 'Tidy the desktop', apps: ['explorer'] })
  const q = await question()
  assert.equal(q.kind, 'grant')
  assert.match(q.text, /Tidy the desktop/)
  assert.match(q.text, /Explorer/)
  assert.match(q.text, /Ctrl\+Alt\+Esc stops it/)
  assert.deepEqual(q.options.map(o => o.id), ['step', 'important', 'deny'])
  assert.equal((await api('GET', '/v1/state')).body.computer.status, 'asking')
  await answer('deny')
  const done = await result(body.ticket)
  assert.equal(done.granted, false)
  const state = (await api('GET', '/v1/state')).body
  assert.equal(state.permissions.computer.granted, false)
  assert.equal(state.computer.status, 'off')
})

test('only the bot itself can answer for the person, and computer capture cannot be started by hand', async () => {
  await api('POST', '/v1/computer/start', { task: 'x', apps: ['notepad'] })
  const q = await question()
  assert.equal((await api('POST', '/v1/computer/answer', { id: q.id, choice: 'step' })).status, 403)
  assert.equal((await api('POST', '/v1/computer/answer', { id: q.id, choice: 'step' }, { 'x-mini-bot-overlay': 'guess' })).status, 403)
  assert.equal((await api('POST', '/v1/computer/jobs')).status, 403)
  assert.equal((await api('POST', '/v1/computer/resume')).status, 403)
  assert.equal((await asOverlay('POST', '/v1/computer/answer', { id: q.id, choice: 'yes please' })).status, 400)
  await api('POST', '/v1/permissions/computer/grant', { confirmed: true })
  assert.equal((await api('POST', '/v1/permissions/computer/capture/start')).status, 403)
})

test('step by step: the person sees each step, with its app and target, before it happens', async () => {
  await granted('step')
  const state = (await api('GET', '/v1/state')).body
  assert.deepEqual(state.indicator.kinds, ['computer'])
  assert.deepEqual(state.computer.apps, ['excel', 'notepad'])

  const ticket = await step({ action: 'click', x: 10, y: 20 })
  const q = await answer('allow')
  assert.equal(q.kind, 'confirm')
  assert.match(q.text, /^Click "Save" in Excel\?\nto save the work$/)
  assert.deepEqual(q.point, { x: 10, y: 20 })
  const job = await performs({ image: 'after' })
  assert.equal(job.args.expectPid, 400)
  const done = await result(ticket)
  assert.equal(done.ok, true)
  assert.equal(done.did, 'Click "Save" in Excel')
  assert.equal(done.image, 'after')
  assert.equal((await api('GET', '/v1/state')).body.computer.actions, 1)

  // Skipped: nothing is done, and Claude is told not to go around it.
  const skipped = await step({ action: 'type', text: 'hello' })
  await answer('skip')
  const said = await result(skipped)
  assert.equal(said.skipped, true)
  assert.match(said.error, /said no/)
  const log = (await api('GET', '/v1/computer/log')).body.entries.map(e => e.kind)
  assert.deepEqual(log, ['start', 'act', 'skipped'])
})

test('ask before important steps: ordinary steps just happen, sending and deleting are asked', async () => {
  await granted('important')
  const plain = await step({ action: 'click', x: 1, y: 1 }, { ...excel, element: { name: 'Insert', type: 'tab' } })
  await performs()
  assert.equal((await result(plain)).ok, true)

  const send = await step({ action: 'click', x: 1, y: 1 }, { ...excel, element: { name: 'Send', type: 'button' } })
  const q = await answer('allow')
  assert.match(q.text, /^Important: Click "Send" in Excel/)
  assert.equal(q.important, true)
  await performs()
  assert.equal((await result(send)).ok, true)

  const close = await step({ action: 'keys', keys: 'alt+f4' })
  assert.match((await answer('allow')).text, /Press Alt\+F4 in Excel/)
  await performs()
  await result(close)

  // Claude's own word that a step matters is enough.
  const flagged = await step({ action: 'click', x: 1, y: 1, important: true }, { ...excel, element: { name: 'OK', type: 'button' } })
  assert.match((await answer('allow')).text, /^Important:/)
  await performs()
  await result(flagged)
})

test('the hard limits hold whatever the level', async () => {
  await granted('free')
  const refused = async (args, probe, pattern) => {
    const said = await result(await step(args, probe))
    assert.equal(said.refused, true, JSON.stringify(said))
    assert.match(said.error, pattern)
  }
  await refused({ action: 'click', x: 1, y: 1 }, { ...excel, window: { ...excel.window, process: 'chrome' } }, /chrome is not one of the apps allowed/)
  await refused({ action: 'click', x: 1, y: 1 }, { ...excel, window: { ...excel.window, own: true } }, /Mini Bot itself/)
  await refused({ action: 'type', text: 'yes' }, { ...excel, window: { ...excel.window, process: 'WindowsTerminal' } }, /never controlled/)
  await refused({ action: 'click', x: 1, y: 1 }, { ...excel, window: { ...excel.window, elevated: true } }, /administrator/)
  await refused({ action: 'type', text: 'hunter2' }, { ...excel, element: { name: 'Password', isPassword: true } }, /password field/)
  await refused({ action: 'type', text: 'card 4111 1111 1111 1111 exp' }, excel, /card number/)
  await refused({ action: 'keys', keys: 'win+r' }, excel, /Windows-key/)
  await refused({ action: 'keys', keys: 'ctrl+alt+esc' }, excel, /Ctrl\+Alt shortcuts/)
  await refused({ action: 'keys', keys: 'alt+tab' }, excel, /focus action/)
  await refused({ action: 'drag', x: 1, y: 1, toX: 5, toY: 5 }, { ...excel, toWindow: { pid: 999, process: 'explorer' } }, /another program/)
  // Nothing refused was done, and each refusal is in the log.
  const state = (await api('GET', '/v1/state')).body
  assert.equal(state.computer.actions, 0)
  assert.equal((await api('GET', '/v1/computer/log')).body.entries.filter(e => e.kind === 'refused').length, 10)
})

test('the person takes over by moving the mouse: steps wait until they hand control back', async () => {
  await granted('free')
  await asOverlay('POST', '/v1/computer/pause', { reason: 'mouse' })
  assert.equal((await api('GET', '/v1/state')).body.computer.status, 'paused')
  const { body } = await api('POST', '/v1/computer/act', { action: 'click', x: 1, y: 1, why: 'x' })
  await settle()
  assert.equal(await peek(body.ticket), null)
  assert.equal((await asOverlay('POST', '/v1/computer/jobs')).body.jobs.length, 0)
  await asOverlay('POST', '/v1/computer/resume')
  const job = await nextJob()
  assert.equal(job.kind, 'probe')
  await asOverlay('POST', '/v1/computer/result', { id: job.id, ok: true, data: excel })
  await performs()
  assert.equal((await result(body.ticket)).ok, true)
})

test('a pause is not taken from the person answering a question', async () => {
  await granted('step')
  const ticket = await step({ action: 'click', x: 1, y: 1 })
  await question()
  assert.equal((await asOverlay('POST', '/v1/computer/pause', { reason: 'click' })).body.computer.status, 'running')
  await answer('allow')
  await performs()
  assert.equal((await result(ticket)).ok, true)
})

test('the stop key ends control at once: the waiting step is not done, access is gone, the indicator is off', async () => {
  await granted('step')
  const ticket = await step({ action: 'click', x: 1, y: 1 })
  await question()
  await asOverlay('POST', '/v1/computer/halt', { reason: 'the stop key' })
  const said = await result(ticket)
  assert.equal(said.ok, false)
  assert.match(said.error, /stopped/)
  const state = (await api('GET', '/v1/state')).body
  assert.equal(state.computer.status, 'off')
  assert.equal(state.computer.question, null)
  assert.equal(state.permissions.computer.granted, false)
  assert.equal(state.indicator.visible, false)
  assert.equal(state.computer.last.endedReason, 'the stop key')
  // And a later step is refused.
  const late = await api('POST', '/v1/computer/act', { action: 'click', x: 1, y: 1, why: 'x' })
  assert.match((await result(late.body.ticket)).error, /Control has ended/)
})

test('turning computer access off in the permissions ends control', async () => {
  await granted('free')
  await api('POST', '/v1/permissions/computer/revoke')
  assert.equal((await api('GET', '/v1/state')).body.computer.status, 'off')
})

test('Claude ends control with a summary; the log is on disk', async () => {
  await granted('free')
  const t = await step({ action: 'click', x: 1, y: 1 })
  await performs()
  await result(t)
  const stopped = await api('POST', '/v1/computer/stop', { summary: 'Added the chart.' })
  assert.deepEqual(stopped.body, { ok: true, wasRunning: true, actions: 1 })
  const { body } = await api('GET', '/v1/computer/log')
  assert.deepEqual(body.entries.map(e => e.kind), ['start', 'act', 'end'])
  assert.equal(body.last.summary, 'Added the chart.')
  const files = await readdir(join(dir, 'computer-log'))
  assert.equal(files.length, 1)
  const lines = (await readFile(join(dir, 'computer-log', files[0]), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(lines.map(l => l.kind), ['start', 'act', 'end'])
})

test('at the action limit the person decides whether it goes on', async () => {
  await api('POST', '/v1/config/apply', { op: 'settings', patch: { computer: { maxActions: 10 } } })
  await granted('free')
  for (let i = 0; i < 10; i++) {
    const t = await step({ action: 'click', x: 1, y: 1 })
    await performs()
    await result(t)
  }
  const { body } = await api('POST', '/v1/computer/act', { action: 'click', x: 1, y: 1, why: 'x' })
  const q = await answer('more')
  assert.equal(q.kind, 'limit')
  assert.match(q.text, /10 steps/)
  const job = await nextJob()
  await asOverlay('POST', '/v1/computer/result', { id: job.id, ok: true, data: excel })
  await performs()
  assert.equal((await result(body.ticket)).ok, true)
})

test('steps asked at the same time run one after the other', async () => {
  await granted('free')
  const a = await api('POST', '/v1/computer/act', { action: 'click', x: 1, y: 1, why: 'first' })
  const b = await api('POST', '/v1/computer/act', { action: 'click', x: 2, y: 2, why: 'second' })
  const first = await nextJob()
  assert.equal(first.args.why, 'first')
  // The second waits until the first has finished.
  assert.equal((await asOverlay('POST', '/v1/computer/jobs')).body.jobs.length, 0)
  await asOverlay('POST', '/v1/computer/result', { id: first.id, ok: true, data: excel })
  await performs()
  await result(a.body.ticket)
  const second = await nextJob()
  assert.equal(second.args.why, 'second')
  await asOverlay('POST', '/v1/computer/result', { id: second.id, ok: true, data: excel })
  await performs()
  assert.equal((await result(b.body.ticket)).ok, true)
})

test('a look waits for the overlay and passes back what it saw', async () => {
  await granted('step')
  const { body } = await api('POST', '/v1/computer/look', { monitor: 1, waitSeconds: 1 })
  const job = await nextJob()
  assert.equal(job.kind, 'look')
  assert.deepEqual(job.args, { elements: true, monitor: 1, waitMs: 1000 })
  await asOverlay('POST', '/v1/computer/result', { id: job.id, ok: true, data: { image: 'abc', width: 1280, height: 720 } })
  const seen = await result(body.ticket)
  assert.equal(seen.image, 'abc')
  // A failure in the overlay reaches Claude as an error, not a hang.
  const again = await api('POST', '/v1/computer/look', {})
  const job2 = await nextJob()
  await asOverlay('POST', '/v1/computer/result', { id: job2.id, ok: false, error: 'capture failed' })
  assert.match((await result(again.body.ticket)).error, /capture failed/)
})
