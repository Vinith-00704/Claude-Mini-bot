import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { noOverlay } from '../lib/overlay.mjs'
import { createRuntime } from '../lib/runtime.mjs'

let dir
let runtime
let api
let clock

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mini-bot-'))
  clock = { t: 1_000_000 }
  runtime = createRuntime({ dataDir: dir, overlay: noOverlay(), now: () => clock.t })
  const { url, token } = await runtime.start()
  api = async (method, path, body, headers = { authorization: `Bearer ${token}` }) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
})

afterEach(async () => {
  await runtime.stop()
  await rm(dir, { recursive: true, force: true })
})

const grantAndStart = async kind => {
  await api('POST', `/v1/permissions/${kind}/grant`, { confirmed: true })
  return api('POST', `/v1/permissions/${kind}/capture/start`, {})
}

test('refuses requests without the token, with a wrong one, or from a browser', async () => {
  assert.equal((await api('GET', '/v1/state', undefined, {})).status, 401)
  assert.equal((await api('GET', '/v1/state', undefined, { authorization: 'Bearer nope' })).status, 401)
  const withOrigin = { authorization: `Bearer ${runtime.token}`, origin: 'https://evil.example' }
  assert.equal((await api('GET', '/v1/state', undefined, withOrigin)).status, 403)
  assert.equal((await api('GET', '/v1/health')).status, 200)
})

test('runtime.json carries the port and token and goes away on stop', async () => {
  const info = JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8'))
  assert.equal(info.token, runtime.token)
  assert.equal(info.version, 2)
  await runtime.stop()
  await assert.rejects(stat(join(dir, 'runtime.json')))
})

test('hiding keeps the position and showing restores it', async () => {
  await api('POST', '/v1/overlay/position', { x: 120, y: 340 })
  const hidden = await api('POST', '/v1/visibility', { visible: false })
  assert.equal(hidden.body.overlay.visible, false)
  const active = hidden.body.config.profiles[0]
  assert.deepEqual(active.position, { anchor: 'custom', x: 120, y: 340 })
  const shown = await api('POST', '/v1/visibility', { visible: true })
  assert.equal(shown.body.overlay.visible, true)
  assert.deepEqual(shown.body.config.profiles[0].position, { anchor: 'custom', x: 120, y: 340 })
})

test('a drag is saved on the active bot only', async () => {
  await api('POST', '/v1/config/apply', { op: 'create', name: 'Pixel' })
  const moved = await api('POST', '/v1/overlay/position', { x: 5, y: 6 })
  const [mini, pixel] = moved.body.config.profiles
  assert.deepEqual(pixel.position, { anchor: 'custom', x: 5, y: 6 })
  assert.deepEqual(mini.position, { anchor: 'bottom-right' })
})

test('config changes count revisions; sending the same choices again does not', async () => {
  const first = (await api('GET', '/v1/state')).body.config
  const renamed = await api('POST', '/v1/config/apply', { op: 'rename', id: 'default', name: 'Sparky' })
  assert.equal(renamed.body.config.revision, first.revision + 1)
  const again = await api('PUT', '/v1/config', renamed.body.config)
  assert.equal(again.body.config.revision, first.revision + 1)
})

test('profile changes over the interface follow the same rules as typed ones', async () => {
  assert.equal((await api('POST', '/v1/config/apply', { op: 'create', name: 'mini' })).status, 400)
  assert.equal((await api('POST', '/v1/config/apply', { op: 'delete', id: 'default' })).status, 400)
  assert.equal((await api('POST', '/v1/config/apply', { op: 'update', patch: { appearance: { opacity: 5 } } })).status, 400)
  assert.equal((await api('POST', '/v1/config/apply', { op: 'update', patch: { avatar: 'dragon' } })).status, 400)
  assert.equal((await api('POST', '/v1/config/apply', { op: 'nonsense' })).status, 400)
  const ok = await api('POST', '/v1/config/apply', { op: 'update', patch: { name: 'Sparky', avatar: 'cat', appearance: { opacity: 70, skin: 'ocean' } } })
  assert.equal(ok.status, 200)
  const bot = ok.body.config.profiles[0]
  assert.deepEqual([bot.name, bot.avatar, bot.appearance.opacity, bot.appearance.skin], ['Sparky', 'cat', 70, 'ocean'])
  const second = await api('POST', '/v1/config/apply', { op: 'create', name: 'Pixel' })
  assert.equal(second.body.config.activeProfileId, 'pixel')
  const back = await api('POST', '/v1/config/apply', { op: 'select', id: 'default' })
  assert.equal(back.body.config.activeProfileId, 'default')
  const gone = await api('POST', '/v1/config/apply', { op: 'delete', id: 'pixel' })
  assert.equal(gone.body.config.profiles.length, 1)
})

test('resizing the panel is saved on the active bot, within the limits', async () => {
  const fresh = (await api('GET', '/v1/state')).body.config.profiles[0]
  assert.deepEqual(fresh.panel, { width: 380, replyHeight: 150, autoFit: false })
  for (const bad of [{ width: 100, replyHeight: 150 }, { width: 380, replyHeight: 9000 }, { width: 380.5, replyHeight: 150 }, { width: 'wide', replyHeight: 150 }, {}]) {
    assert.equal((await api('POST', '/v1/config/apply', { op: 'resize', ...bad })).status, 400)
  }
  const resized = await api('POST', '/v1/config/apply', { op: 'resize', width: 520, replyHeight: 300 })
  assert.equal(resized.status, 200)
  assert.deepEqual(resized.body.config.profiles[0].panel, { width: 520, replyHeight: 300, autoFit: false })
  const grown = await api('POST', '/v1/config/apply', { op: 'update', patch: { panel: { autoFit: true } } })
  assert.deepEqual(grown.body.config.profiles[0].panel, { width: 520, replyHeight: 300, autoFit: true })
  assert.equal((await api('POST', '/v1/config/apply', { op: 'update', patch: { panel: { autoFit: 'yes' } } })).status, 400)
  // A second bot starts with the default size, and the first keeps its own.
  const second = await api('POST', '/v1/config/apply', { op: 'create', name: 'Pixel' })
  assert.deepEqual(second.body.config.profiles[1].panel, { width: 380, replyHeight: 150, autoFit: false })
  assert.equal(second.body.config.profiles[0].panel.width, 520)
  await api('POST', '/v1/config/apply', { op: 'delete', id: 'pixel' })
})

test('first-run setup: the name is optional and finishing is remembered', async () => {
  assert.equal((await api('GET', '/v1/state')).body.config.onboarded, false)
  const done = await api('POST', '/v1/config/apply', { op: 'settings', patch: { onboarded: true } })
  assert.equal(done.body.config.onboarded, true)
  assert.equal(done.body.config.profiles[0].name, 'Mini')
})

test('granting needs explicit confirmation', async () => {
  assert.equal((await api('POST', '/v1/permissions/screen/grant', {})).status, 403)
  assert.equal((await api('POST', '/v1/permissions/screen/grant', { confirmed: 'yes' })).status, 403)
  const ok = await api('POST', '/v1/permissions/screen/grant', { confirmed: true })
  assert.equal(ok.body.permissions.screen.granted, true)
  assert.equal((await api('POST', '/v1/permissions/telepathy/grant', { confirmed: true })).status, 404)
})

test('a capture needs a grant, and revoking ends it', async () => {
  assert.equal((await api('POST', '/v1/permissions/microphone/capture/start', {})).status, 403)
  const live = await grantAndStart('microphone')
  assert.equal(live.body.permissions.microphone.active, true)
  const revoked = await api('POST', '/v1/permissions/microphone/revoke', {})
  assert.equal(revoked.body.permissions.microphone.granted, false)
  assert.equal(revoked.body.permissions.microphone.active, false)
  assert.equal(revoked.body.indicator.visible, false)
})

test('hiding never hides an active capture indicator', async () => {
  await grantAndStart('screen')
  await grantAndStart('microphone')
  const hidden = await api('POST', '/v1/visibility', { visible: false })
  assert.equal(hidden.body.overlay.visible, false)
  assert.equal(hidden.body.indicator.visible, true)
  assert.deepEqual(hidden.body.indicator.kinds, ['screen', 'microphone'])
  const pushed = await api('PUT', '/v1/config', { ...hidden.body.config, visible: false })
  assert.equal(pushed.body.indicator.visible, true)
})

test('shutdown ends captures and drops grants', async () => {
  await grantAndStart('screen')
  await runtime.stop()
  const snapshot = runtime.permissions.snapshot()
  assert.equal(snapshot.screen.active, false)
  assert.equal(snapshot.screen.granted, false)
})

test('a new runtime restores the configuration but no grants', async () => {
  await api('POST', '/v1/config/apply', { op: 'update', patch: { name: 'Sparky' } })
  await api('POST', '/v1/visibility', { visible: false })
  await api('POST', '/v1/overlay/position', { x: 9, y: 8 })
  await api('POST', '/v1/permissions/computer/grant', { confirmed: true })
  await new Promise(r => setTimeout(r, 100))
  await runtime.stop()
  const next = createRuntime({ dataDir: dir, overlay: noOverlay() })
  await next.start()
  try {
    const state = next.state()
    assert.equal(state.config.profiles[0].name, 'Sparky')
    assert.equal(state.overlay.visible, false)
    assert.deepEqual(state.config.profiles[0].position, { anchor: 'custom', x: 9, y: 8 })
    assert.equal(state.permissions.computer.granted, false)
  } finally {
    await next.stop()
  }
})

test('rejects non-object config and oversized bodies', async () => {
  assert.equal((await api('PUT', '/v1/config', [1])).status, 400)
  assert.equal((await api('POST', '/v1/visibility', { visible: 'no' })).status, 400)
  assert.equal((await api('POST', '/v1/overlay/position', { x: 'a', y: 1 })).status, 400)
  assert.equal((await api('PUT', '/v1/config', { blob: 'x'.repeat(70 * 1024) })).status, 413)
})

test('prompts are refused while Claude Code is not picking them up', async () => {
  const refused = await api('POST', '/v1/prompts', { text: 'hello' })
  assert.equal(refused.status, 503)
  assert.match(refused.body.error, /Claude Code is not connected/)
  assert.equal((await api('GET', '/v1/state')).body.bridge.connected, false)
})

test('a prompt waits for Claude Code, is handed over once, and shows as sending', async () => {
  await api('POST', '/v1/prompts/claim', {})
  assert.equal((await api('GET', '/v1/state')).body.bridge.connected, true)
  const sent = await api('POST', '/v1/prompts', { text: '  what is 2+2?  ', source: 'voice' })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.state.activity.phase, 'sending')
  assert.equal(sent.body.state.activity.source, 'bot')
  assert.equal(sent.body.state.bridge.queued, 1)
  const claimed = await api('POST', '/v1/prompts/claim', {})
  assert.deepEqual(claimed.body.prompts.map(p => [p.text, p.source]), [['what is 2+2?', 'voice']])
  assert.equal((await api('POST', '/v1/prompts/claim', {})).body.prompts.length, 0)
})

test('Claude Code going quiet makes the bot refuse prompts again', async () => {
  await api('POST', '/v1/prompts/claim', {})
  clock.t += 20_000
  assert.equal((await api('POST', '/v1/prompts', { text: 'hello' })).status, 503)
})

test('prompts are validated: not empty, not huge, not piling up', async () => {
  await api('POST', '/v1/prompts/claim', {})
  assert.equal((await api('POST', '/v1/prompts', { text: '   ' })).status, 400)
  assert.equal((await api('POST', '/v1/prompts', { text: 'x'.repeat(8001) })).status, 413)
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/v1/prompts', { text: `p${i}` })).status, 200)
  assert.equal((await api('POST', '/v1/prompts', { text: 'one too many' })).status, 429)
})

test('activity follows what Claude Code reports, and settles back to idle', async () => {
  await api('POST', '/v1/prompts/claim', {})
  const { body } = await api('POST', '/v1/prompts', { text: 'go' })
  const id = body.id
  for (const phase of ['thinking', 'working']) {
    const now = await api('POST', '/v1/activity', { phase, id, source: 'bot', detail: phase === 'working' ? 'Bash' : '' })
    assert.equal(now.body.activity.phase, phase)
  }
  const done = await api('POST', '/v1/activity', { phase: 'completed', id, source: 'bot', preview: { text: 'four' } })
  assert.equal(done.body.activity.phase, 'completed')
  assert.equal(done.body.activity.preview.text, 'four')
  clock.t += 11_000
  const later = (await api('GET', '/v1/state')).body.activity
  assert.equal(later.phase, 'idle')
  assert.equal(later.preview.text, 'four')
  await api('POST', '/v1/prompts', { text: 'next' })
  assert.equal((await api('GET', '/v1/state')).body.activity.preview, null)
  assert.equal((await api('POST', '/v1/activity', { phase: 'dancing' })).status, 400)
})

test('the session says which model it runs on, and a changed model is noticed', async () => {
  assert.equal((await api('GET', '/v1/state')).body.session, null)
  const first = await api('POST', '/v1/session', { model: 'claude-opus-5-5', name: 'Opus 5.5', effort: 'high' })
  assert.equal(first.status, 200)
  assert.deepEqual(first.body.session, { model: 'claude-opus-5-5', name: 'Opus 5.5', effort: 'high', ageMs: 0, switched: null })
  // A new effort alone is not a switch.
  clock.t += 2000
  const harder = await api('POST', '/v1/session', { model: 'claude-opus-5-5', name: 'Opus 5.5', effort: 'max' })
  assert.equal(harder.body.session.effort, 'max')
  assert.equal(harder.body.session.switched, null)
  // The same thing again changes nothing, not even how long it has been so.
  clock.t += 1000
  assert.equal((await api('POST', '/v1/session', { model: 'claude-opus-5-5', name: 'Opus 5.5', effort: 'max' })).body.session.ageMs, 1000)
  const other = await api('POST', '/v1/session', { model: 'claude-sonnet-5-5', name: 'Sonnet 5.5', effort: null })
  assert.deepEqual(other.body.session.switched, { from: 'Opus 5.5', to: 'Sonnet 5.5', ageMs: 0 })
  assert.equal(other.body.session.effort, null)
  clock.t += 3000
  assert.equal((await api('GET', '/v1/state')).body.session.switched.ageMs, 3000)
})

test('the session report is checked and cleaned', async () => {
  for (const body of [{}, { model: '' }, { model: 42 }, { model: 'x', effort: 'extreme' }, { model: 'x', effort: 3 }]) {
    assert.equal((await api('POST', '/v1/session', body)).status, 400, JSON.stringify(body))
  }
  const odd = await api('POST', '/v1/session', { model: 'weird\u0000\nmodel', name: 'A'.repeat(200) })
  assert.equal(odd.body.session.model, 'weirdmodel')
  assert.equal(odd.body.session.name.length, 40)
  assert.equal((await api('POST', '/v1/session', { model: 'x' }, {})).status, 401)
})

test('the bot reports listening only as the microphone state allows', async () => {
  assert.equal((await api('POST', '/v1/voice', { state: 'shouting' })).status, 400)
  await grantAndStart('microphone')
  const listening = await api('POST', '/v1/voice', { state: 'listening' })
  assert.equal(listening.body.voice.state, 'listening')
  const stopped = await api('POST', '/v1/permissions/microphone/capture/stop', {})
  assert.equal(stopped.body.voice.state, 'idle')
  assert.equal(stopped.body.indicator.visible, false)
})

test('a screenshot the companion saved can ride along with a prompt, even with no text', async () => {
  await api('POST', '/v1/prompts/claim', {})
  const dir = (await api('GET', '/v1/state')).body.paths.screenshots
  const shot = join(dir, 'shot-1.png')
  await writeFile(shot, 'png')
  const sent = await api('POST', '/v1/prompts', { text: '', attachments: [{ type: 'image', path: shot }] })
  assert.equal(sent.status, 200)
  const [claimed] = (await api('POST', '/v1/prompts/claim', {})).body.prompts
  assert.deepEqual(claimed.attachments, [{ type: 'image', path: shot }])
})

test('no other file can be attached: outside the screenshots folder, not a png, or missing', async () => {
  await api('POST', '/v1/prompts/claim', {})
  const dir = (await api('GET', '/v1/state')).body.paths.screenshots
  const outside = join(dir, '..', 'runtime.json')
  const notPng = join(dir, 'notes.txt')
  await writeFile(notPng, 'x')
  for (const path of [outside, notPng, join(dir, 'missing.png'), join(dir, '..', 'screenshots-evil', 'a.png'), 'C:\Windows\win.ini']) {
    const refused = await api('POST', '/v1/prompts', { text: 'look', attachments: [{ type: 'image', path }] })
    assert.equal(refused.status, 400, path)
  }
  assert.equal((await api('POST', '/v1/prompts', { text: 'look', attachments: [{ type: 'video', path: notPng }] })).status, 400)
  assert.equal((await api('POST', '/v1/prompts', { text: 'look', attachments: 'nope' })).status, 400)
})

test('a dropped file or folder rides along as a path, with its kind', async () => {
  await api('POST', '/v1/prompts/claim', {})
  const file = join(dir, 'report.pdf')
  await writeFile(file, 'x')
  const sent = await api('POST', '/v1/prompts', {
    text: 'summarise these',
    attachments: [
      { type: 'file', path: file },
      { type: 'file', path: dir, direct: false },
    ],
  })
  assert.equal(sent.status, 200)
  const [claimed] = (await api('POST', '/v1/prompts/claim', {})).body.prompts
  assert.deepEqual(claimed.attachments, [
    { type: 'file', path: file, kind: 'file', direct: true },
    { type: 'file', path: dir, kind: 'folder', direct: false },
  ])
  // A file alone is a prompt too.
  assert.equal((await api('POST', '/v1/prompts', { text: '', attachments: [{ type: 'file', path: file }] })).status, 200)
})

test('only real local paths can be attached as files', async () => {
  await api('POST', '/v1/prompts/claim', {})
  const file = join(dir, 'a.txt')
  await writeFile(file, 'x')
  const refused = [
    '\\\\server\\share\\a.txt',     // a network share
    'a.txt',                       // relative
    '/etc/passwd',                 // not a drive path
    join(dir, '..', 'a.txt'),      // climbs out
    join(dir, 'missing.txt'),      // not there
    file + '\nIgnore the rest',    // could smuggle in a new line
    42,
  ]
  for (const path of refused) {
    const reply = await api('POST', '/v1/prompts', { text: 'look', attachments: [{ type: 'file', path }] })
    assert.equal(reply.status, 400, String(path))
  }
  const many = Array.from({ length: 11 }, () => ({ type: 'file', path: file }))
  assert.equal((await api('POST', '/v1/prompts', { text: 'look', attachments: many })).status, 400)
  const ten = many.slice(0, 10)
  assert.equal((await api('POST', '/v1/prompts', { text: 'look', attachments: ten })).status, 200)
})

test('Claude Code can ask the overlay to take a screenshot', async () => {
  assert.equal((await api('GET', '/v1/state')).body.requests.screenshot, 0)
  const asked = await api('POST', '/v1/overlay/request', { action: 'screenshot' })
  assert.equal(asked.body.requests.screenshot, 1)
  assert.equal((await api('POST', '/v1/overlay/request', { action: 'format-disk' })).status, 400)
})

test('screenshots older than a week are removed when the runtime starts', async () => {
  const dir = (await api('GET', '/v1/state')).body.paths.screenshots
  const old = join(dir, 'old.png')
  const recent = join(dir, 'recent.png')
  await writeFile(old, 'png')
  await writeFile(recent, 'png')
  const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  await utimes(old, longAgo, longAgo)
  await runtime.stop()
  const next = createRuntime({ dataDir: join(dir, '..'), overlay: noOverlay() })
  await next.start()
  try {
    await assert.rejects(stat(old))
    await stat(recent)
  } finally {
    await next.stop()
  }
})
