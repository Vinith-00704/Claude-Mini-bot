import { expect, mock, test } from 'claude-code/testing'

import { applyOp, normalizeConfig, sameChoices } from '../shared/config.mjs'

// A stand-in for the companion runtime, behind the mod's own `$.fs` and `$.http`,
// that follows the runtime's rules for configuration (the same shared file) and
// keeps a prompt queue. Nothing sits beneath the plugin in a test, so each hook
// here answers for the engine: a call on `$` is answered `{ value }`.
type Options = {
  running: boolean
  legacy?: boolean
  /** A companion that has the prompt queue but not the slash-command list (version 2). */
  noCommandList?: boolean
  stored?: unknown
  unsent?: boolean
  /** The version on this computer, and the one on GitHub (null: GitHub cannot be reached). */
  installed?: string
  latest?: string | null
  /** The model the session runs on (what `$.session.model()` answers). */
  model?: string
}

const world = async ($: any, on: any, options: Options) => {
  let running = options.running
  const requests: { method: string; path: string; body: any }[] = []
  const prompts: any[] = []
  const submitted: any[] = []
  const asked: any[] = []
  const commands: string[][] = []
  const urls: string[] = []
  let sessionModel = options.model ?? 'claude-opus-5-5'
  let runtimeConfig: any = normalizeConfig(undefined)
  const permissions: any = Object.fromEntries(
    ['screen', 'microphone', 'computer'].map(k => [k, { granted: false, grantedAt: null, active: false, activeSince: null }]),
  )
  let indicator: any = { visible: false, kinds: [] }
  let session: any = null

  const setConfig = (next: unknown) => {
    const normalized: any = normalizeConfig(next)
    if (!sameChoices(normalized, runtimeConfig)) runtimeConfig = { ...normalized, revision: runtimeConfig.revision + 1 }
  }
  const state = () => ({
    running: true,
    version: options.legacy ? 1 : options.noCommandList ? 2 : 3,
    pid: 1,
    startedAt: 0,
    config: runtimeConfig,
    overlay: { visible: runtimeConfig.visible, driver: 'none', isAttached: false },
    permissions,
    indicator,
    activity: { phase: 'idle', id: null, detail: '', source: 'claude' },
    voice: { state: 'idle', error: null, heard: null },
    session,
    bridge: { connected: true, queued: prompts.length },
  })

  const store = new Map<string, unknown>()
  if (options.stored !== undefined) store.set('config', options.stored)
  if (options.unsent) store.set('unsent', true)
  const config = () => store.get('config') as any

  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  // Nobody answers a dialog in a test; what it asked is kept for the test to read.
  on('tool.call', { tool: 'AskUserQuestion' }, (_: any, e: any) => {
    asked.push(e)
    return { deny: 'nobody here' }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: any, e: any) => {
    submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  // Programs the mod runs (the speech installer): nothing is installed in a test, so a check says "not set up".
  on('process.run', (_: any, e: any) => {
    commands.push(e.argv ?? e.command ?? e.args)
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  on('session.model', () => ({ value: sessionModel }))
  // The bottom of a model request: nothing is asked of a model in a test.
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  mock.env(on, { MINI_BOT_HOME: '/mb' })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'mini-bot' } }))
  // Claude Code's own commands, as far as the bot is concerned: a few that print, and one that only opens a panel.
  const ran: { command: string; args: string }[] = []
  let commandNames = ['mini-bot', 'cost', 'compact', 'model', 'review']
  on('command.list', () => ({
    value: commandNames.map(name => ({ name, description: `the ${name} command`, source: name === 'mini-bot' ? 'plugin' : 'builtin' })),
  }))
  on('command.run', (_: any, e: any) => {
    ran.push({ command: e.command, args: e.args })
    return e.command === 'cost' ? { text: 'Total cost: $0.12' } : {}
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', (_: any, e: any) => {
    if (String(e.path).endsWith('plugin.json')) return { value: JSON.stringify({ name: 'mini-bot', version: options.installed ?? '0.1.0' }) }
    if (!running) throw new Error('ENOENT')
    return { value: JSON.stringify({ pid: 1, port: 4711, token: 'secret' }) }
  })
  on('http.fetch', (_: any, e: any) => {
    if (new URL(e.url).hostname === 'raw.githubusercontent.com') {
      urls.push(e.url)
      if (options.latest == null) return { value: { status: 404, ok: false, headers: {}, text: '' } }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: 'mini-bot', version: options.latest }) } }
    }
    const path = new URL(e.url).pathname
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    requests.push({ method, path, body })
    expect(e.init?.headers?.authorization).toBe('Bearer secret')
    const reply = (status: number, payload: unknown) => ({
      value: { status, ok: status < 300, headers: {}, text: JSON.stringify(payload) },
    })
    if (path === '/v1/health') return reply(200, { ok: true })
    if (path === '/v1/config' && method === 'PUT') setConfig(body)
    else if (path === '/v1/session') session = { ...body, ageMs: 0, switched: null }
    else if (path === '/v1/visibility') setConfig({ ...runtimeConfig, visible: body.visible })
    else if (path === '/v1/prompts/claim') {
      if (options.legacy) return reply(404, { error: 'no such route' })
      return reply(200, { prompts: prompts.splice(0), revision: runtimeConfig.revision, version: 2 })
    } else if (path === '/v1/shutdown') running = false
    return reply(200, state())
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  requests.length = 0
  const run = async (args: string) => (await $.command.run({ command: 'mini-bot', args })).text as string
  /** One second passes: the mod asks the companion for prompts. */
  const tick = async () => {
    await clock.advance(1000)
    await clock.settle()
  }
  const activity = () => requests.filter(r => r.path === '/v1/activity').map(r => r.body)
  return {
    run,
    commands,
    ran,
    setCommandNames: (names: string[]) => (commandNames = names),
    /** What the bot was last told its `/` list is. */
    listed: () => requests.filter(r => r.path === '/v1/commands').map(r => r.body.commands as any[]),
    urls,
    setModel: (id: string) => (sessionModel = id),
    tick,
    requests,
    config,
    asked,
    prompts,
    submitted,
    activity,
    permissions,
    setIndicator: (next: any) => (indicator = next),
    runtime: () => runtimeConfig,
    /** What the floating UI does: one named change straight to the runtime's copy. */
    floatingChange: (op: unknown) => {
      const result: any = applyOp(runtimeConfig, op)
      if ('error' in result) throw new Error(result.error)
      setConfig(result.config)
    },
    setRunning: (value: boolean) => (running = value),
    store,
  }
}

test('hide keeps the companion connected, remembers the choice, and show restores it', async ($, on) => {
  const { run, requests, config } = await world($, on, { running: true })
  expect(await run('hide')).toMatch(/hidden and still connected/)
  expect(requests.find(r => r.path === '/v1/visibility')?.body).toEqual({ visible: false })
  expect(requests.some(r => r.path === '/v1/shutdown')).toBe(false)
  expect(config().visible).toBe(false)

  expect(await run('show')).toMatch(/back where you left it/)
  expect(config().visible).toBe(true)
})

test('hide works with the companion stopped, says so, and is sent when it starts', async ($, on) => {
  const { run, requests, config, store, setRunning, tick, runtime } = await world($, on, { running: false })
  expect(await run('hide')).toMatch(/not running/)
  expect(requests).toEqual([])
  expect(config().visible).toBe(false)
  expect(store.get('unsent')).toBe(true)
  setRunning(true)
  await tick()
  expect(runtime().visible).toBe(false)
  expect(store.get('unsent')).toBe(false)
})

test('hiding says the access indicator stays on while something is in use', async ($, on) => {
  const { run, permissions, setIndicator } = await world($, on, { running: true })
  permissions.microphone = { granted: true, grantedAt: 1, active: true, activeSince: 2 }
  setIndicator({ visible: true, kinds: ['microphone'] })
  expect(await run('hide')).toMatch(/indicator stays on while microphone is in use/)
  expect(await run('status')).toMatch(/Microphone: ACTIVE/)
})

test('granting access needs a person to approve, and without one nothing is granted', async ($, on) => {
  const { run, requests } = await world($, on, { running: true })
  expect(await run('permissions grant screen')).toMatch(/nothing was granted/)
  expect(requests.some(r => r.path.includes('/grant'))).toBe(false)
})

test('revoking needs no approval and ends the access', async ($, on) => {
  const { run, requests } = await world($, on, { running: true })
  expect(await run('permissions revoke screen')).toMatch(/revoked/)
  expect(requests.map(r => r.path)).toContain('/v1/permissions/screen/revoke')
  await run('permissions revoke all')
  expect(requests.filter(r => r.path.endsWith('/revoke'))).toHaveLength(4)
})

test('stop asks only the companion to shut down', async ($, on) => {
  const { run, requests } = await world($, on, { running: true })
  expect(await run('stop')).toMatch(/Mini Bot stopped.*Claude Code is untouched/)
  const paths = requests.map(r => r.path)
  expect(paths.filter(p => p === '/v1/shutdown')).toHaveLength(1)
  expect(paths.every(p => p.startsWith('/v1/') && !p.includes('/permissions/') && p !== '/v1/visibility')).toBe(true)
  expect(await run('stop')).toMatch(/not running/)
})

test('changing a setting changes the active bot and pushes the new look', async ($, on) => {
  const { run, requests, config } = await world($, on, { running: true })
  expect(await run('set opacity 5')).toMatch(/whole number from 20 to 100/)
  expect(await run('set opacity 70')).toMatch(/Opacity is now 70%/)
  const push = requests.filter(r => r.path === '/v1/config').at(-1)
  expect(push?.body.profiles[0].appearance.opacity).toBe(70)
  expect(config().profiles[0].appearance.opacity).toBe(70)
})

test('switching bots changes the config and nothing about the session', async ($, on) => {
  const { run, requests, config, submitted } = await world($, on, { running: true })
  expect(await run('bot new Biscuit')).toMatch(/Created Biscuit/)
  expect(await run('bot use Mini')).toMatch(/Switched to Mini/)
  expect(config().activeProfileId).toBe('default')
  // Only the companion was told, and the session was never asked to do anything.
  expect(new Set(requests.map(r => r.path))).toEqual(new Set(['/v1/health', '/v1/config', '/v1/state']))
  expect(submitted).toEqual([])
})

test('switch and create work as their own commands', async ($, on) => {
  const { run, config } = await world($, on, { running: true })
  expect(await run('create Maple')).toMatch(/Created Maple/)
  expect(config().activeProfileId).toBe('maple')
  expect(await run('switch mini')).toMatch(/Switched to Mini/)
  expect(await run('switch Nobody')).toMatch(/No bot called "Nobody"/)
  expect(config().activeProfileId).toBe('default')
})

test('deleting a bot needs confirmation, and without it the bot stays', async ($, on) => {
  const { run, config } = await world($, on, { running: true })
  expect(await run('bot new Biscuit')).toMatch(/Created Biscuit/)
  expect(await run('bot delete Biscuit')).toMatch(/nothing was deleted/)
  expect(config().profiles).toHaveLength(2)
})

test('an unknown subcommand shows the help', async ($, on) => {
  const { run } = await world($, on, { running: true })
  expect(await run('dance')).toMatch(/Unknown option "dance"[\s\S]*\/mini-bot start \| stop[\s\S]*floating bot works without these/)
})

test('the menu shows the five choices in order, never more than four options at a time', async ($, on) => {
  const { run, asked } = await world($, on, { running: true })
  expect(await run('')).toMatch(/Menu closed/)
  const question = asked[0].questions[0]
  expect(question.options.map((o: any) => o.label)).toEqual(['Hide / Unhide', 'Settings', 'Permissions', 'More…'])
  expect(question.question).toMatch(/Mini · running · visible/)
})

// ---- the floating bot: prompts in, activity out ----

test('a prompt typed into the bot is submitted as an ordinary prompt of this session', async ($, on) => {
  const { prompts, submitted, tick } = await world($, on, { running: true })
  prompts.push({ id: 'p1', text: 'what is 2+2?', source: 'text', at: 0 })
  await tick()
  expect(submitted).toHaveLength(1)
  expect(submitted[0].text).toBe('what is 2+2?')
  expect(submitted[0].origin).toMatchObject({ kind: 'plugin', asUser: true })
})

test('nothing is submitted when the bot has nothing to say', async ($, on) => {
  const { submitted, tick, requests } = await world($, on, { running: true })
  await tick()
  await tick()
  expect(submitted).toEqual([])
  expect(requests.filter(r => r.path === '/v1/prompts/claim').length).toBeGreaterThan(0)
})

// ---- slash commands typed into the bot ----

test('a Claude Code command typed into the bot runs as a command, and its output comes back to the bot', async ($, on) => {
  const { prompts, submitted, ran, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c1', text: '/cost', source: 'text', at: 0 })
  await tick()
  expect(ran).toEqual([{ command: 'cost', args: '' }])
  expect(submitted).toEqual([])
  const last = activity().at(-1)
  expect([last.phase, last.source, last.id]).toEqual(['completed', 'bot', 'c1'])
  expect(last.preview).toEqual({ text: 'Total cost: $0.12', isError: false })
})

test('a command with arguments gets them, and one that prints nothing says where to look', async ($, on) => {
  const { prompts, ran, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c2', text: '/compact  keep the plan ', source: 'text', at: 0 })
  await tick()
  expect(ran).toEqual([{ command: 'compact', args: 'keep the plan' }])
  expect(activity().at(-1).preview.text).toMatch(/\/compact ran\. .* in Claude Code/)
})

test('/mini-bot typed into the bot runs the mini-bot command here', async ($, on) => {
  const { prompts, ran, submitted, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c3', text: '/mini-bot hide', source: 'text', at: 0 })
  await tick()
  expect(ran).toEqual([])
  expect(submitted).toEqual([])
  expect(activity().at(-1).preview.text).toMatch(/hidden and still connected/)
})

test('a slash that names no command is not sent, since Claude Code would read it as one', async ($, on) => {
  const { prompts, ran, submitted, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c4', text: '/tmp is full, why?', source: 'text', at: 0 })
  prompts.push({ id: 'c5', text: '/etc/hosts what is this', source: 'text', at: 0 })
  await tick()
  expect(ran).toEqual([])
  expect(submitted).toEqual([])
  expect(activity().map(a => [a.phase, a.id]).sort()).toEqual([['error', 'c4'], ['error', 'c5']])
  expect(activity()[0].preview.text).toMatch(/Start with a word/)
})

test('commands that change what the bot promises never to touch are refused', async ($, on) => {
  const { prompts, ran, submitted, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c6', text: '/model opus', source: 'text', at: 0 })
  await tick()
  expect(ran).toEqual([])
  expect(submitted).toEqual([])
  expect(activity().at(-1).preview).toEqual({ text: expect.stringMatching(/Run it in Claude Code itself/), isError: true })
})

test('spoken words and prompts with attachments never run a command', async ($, on) => {
  const { prompts, ran, submitted, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'c7', text: '/cost', source: 'voice', at: 0 })
  prompts.push({ id: 'c8', text: '/review', source: 'text', attachments: [{ type: 'file', path: 'C:\\a.txt', kind: 'file', direct: true }], at: 0 })
  prompts.push({ id: 'c9', text: 'what does /cost do?', source: 'voice', at: 0 })
  await tick()
  expect(ran).toEqual([])
  expect(activity().filter(a => a.phase === 'error').map(a => a.id).sort()).toEqual(['c7', 'c8'])
  expect(submitted.map(s => s.text)).toEqual(['what does /cost do?'])
})

test('the bot is told which commands exist, for its / list, without the ones it refuses', async ($, on) => {
  const { tick, listed } = await world($, on, { running: true })
  await tick()
  expect(listed()).toHaveLength(1)
  const names = listed()[0]!.map(c => c.name)
  expect(names.slice(0, 3)).toEqual(['mini-bot', 'mini-bot hide', 'mini-bot show'])
  expect(names).toEqual(expect.arrayContaining(['cost', 'compact', 'review', 'mini-bot status']))
  expect(names).not.toContain('model')
  const set = listed()[0]!.find(c => c.name === 'mini-bot set')
  expect(set).toMatchObject({ source: 'bot', takesArgs: true })
  expect(listed()[0]!.find(c => c.name === 'cost')).toMatchObject({ description: 'the cost command', source: 'builtin' })
})

test('the list is sent again only when the commands change, and a new plugin shows up within seconds', async ($, on) => {
  const { tick, listed, setCommandNames } = await world($, on, { running: true })
  await tick()
  for (let i = 0; i < 10; i++) await tick()
  expect(listed()).toHaveLength(1)
  setCommandNames(['mini-bot', 'cost', 'my-new-skill'])
  for (let i = 0; i < 5; i++) await tick()
  expect(listed()).toHaveLength(2)
  expect(listed()[1]!.map(c => c.name)).toContain('my-new-skill')
  expect(listed()[1]!.map(c => c.name)).not.toContain('review')
})

test('/mini-bot status says when the companion is too old to list commands', async ($, on) => {
  const { tick, run } = await world($, on, { running: true, noCommandList: true })
  await tick()
  expect(await run('status')).toMatch(/before the bot could list slash commands[\s\S]*\/mini-bot stop, then \/mini-bot start/)
})

test('/mini-bot status says nothing about the list when the companion has it', async ($, on) => {
  const { tick, run } = await world($, on, { running: true })
  await tick()
  expect(await run('status')).not.toMatch(/list slash commands/)
})

test('activity follows the real turn, and the reply is sent only for a turn the bot started', async ($, on) => {
  const { prompts, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 'p1', text: 'what is 2+2?', source: 'voice', at: 0 })
  await tick()
  await $.turn.start({ turnId: 't1', text: 'what is 2+2?' })
  await $.tool.call({ tool: 'Bash', command: 'echo 4' })
  await $.turn.complete({ turnId: 't1', answer: '  It is 4.  ', durationMs: 5, isAborted: false, reason: 'answer' })
  const phases = activity().map(a => [a.phase, a.source, a.detail ?? ''])
  expect(phases).toEqual([
    ['thinking', 'bot', ''],
    ['working', 'bot', 'Bash'],
    ['thinking', 'bot', ''],
    ['completed', 'bot', ''],
  ])
  expect(activity().at(-1).preview).toEqual({ text: 'It is 4.', isError: false })
  expect(activity().at(-1).id).toBe('p1')
})

test('a turn the person started in Claude Code is reported as a state, never as text', async ($, on) => {
  const { tick, activity } = await world($, on, { running: true })
  await tick()
  await $.turn.start({ turnId: 't2', text: 'something private' })
  await $.turn.complete({ turnId: 't2', answer: 'a private answer', durationMs: 5, isAborted: false, reason: 'answer' })
  expect(activity().map(a => [a.phase, a.source])).toEqual([
    ['thinking', 'claude'],
    ['completed', 'claude'],
  ])
  expect(JSON.stringify(activity())).not.toMatch(/private/)
})

test('a failed or interrupted turn is shown as such', async ($, on) => {
  const { tick, activity, prompts } = await world($, on, { running: true })
  prompts.push({ id: 'p9', text: 'go', source: 'text', at: 0 })
  await tick()
  await $.turn.start({ turnId: 't3', text: 'go' })
  await $.turn.complete({ turnId: 't3', answer: '', durationMs: 5, isAborted: false, reason: 'error' })
  const last = activity().at(-1)
  expect(last.phase).toBe('error')
  expect(last.preview).toEqual({ text: 'Claude Code could not finish that.', isError: true })
  await $.turn.start({ turnId: 't4', text: 'again' })
  await $.turn.complete({ turnId: 't4', answer: '', durationMs: 5, isAborted: true, reason: 'aborted' })
  expect(activity().at(-1).phase).toBe('idle')
})

test('subagent turns do not change what the bot shows', async ($, on) => {
  const { tick, activity } = await world($, on, { running: true })
  await tick()
  await $.turn.start({ turnId: 't5', text: 'delegated', agentId: 'sub1' })
  await $.turn.complete({ turnId: 't5', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer', agentId: 'sub1' })
  expect(activity()).toEqual([])
})

test('an older companion is told apart, with what to do about it', async ($, on) => {
  const { tick, run } = await world($, on, { running: true, legacy: true })
  await tick()
  expect(await run('status')).toMatch(/older version[\s\S]*\/mini-bot stop, then \/mini-bot start/)
})

// ---- the two copies of the settings ----

test('a change made in the floating bot is adopted here', async ($, on) => {
  const { floatingChange, tick, config, run } = await world($, on, { running: true })
  floatingChange({ op: 'update', patch: { name: 'Maple', avatar: 'cat' } })
  floatingChange({ op: 'settings', patch: { visible: false } })
  await tick()
  expect(config().profiles[0]).toMatchObject({ name: 'Maple', avatar: 'cat' })
  expect(config().visible).toBe(false)
  expect(await run('status')).toMatch(/hidden\. Active bot: Maple \(cat/)
})

test('a floating-bot rename and a typed command in a row both stick', async ($, on) => {
  const { floatingChange, tick, run, runtime } = await world($, on, { running: true })
  floatingChange({ op: 'update', patch: { name: 'Maple' } })
  await tick()
  await run('set skin ocean')
  expect(runtime().profiles[0]).toMatchObject({ name: 'Maple' })
  expect(runtime().profiles[0].appearance.skin).toBe('ocean')
})

test('a change made while the companion was down is sent, and wins', async ($, on) => {
  const { run, setRunning, tick, runtime } = await world($, on, { running: false })
  await run('set opacity 70')
  setRunning(true)
  await tick()
  expect(runtime().profiles[0].appearance.opacity).toBe(70)
})

test('a fresh companion never wipes the settings the person already has', async ($, on) => {
  const stored = normalizeConfig({
    revision: 5,
    activeProfileId: 'keeper',
    profiles: [{ id: 'keeper', name: 'Keeper', avatar: 'ghost' }],
    onboarded: true,
  })
  const { setRunning, tick, runtime, config } = await world($, on, { running: false, stored })
  setRunning(true)
  await tick()
  expect(runtime().profiles[0]).toMatchObject({ name: 'Keeper', avatar: 'ghost' })
  expect(config().profiles[0].name).toBe('Keeper')
})

// ---- screenshots ----

test('a screenshot rides along as a file Claude can open, with the question first', async ($, on) => {
  const { prompts, submitted, tick } = await world($, on, { running: true })
  prompts.push({ id: 's1', text: 'what is wrong with this dialog?', source: 'text', at: 0, attachments: [{ type: 'image', path: 'C:\shots\screenshot-1.png' }] })
  await tick()
  expect(submitted[0].text).toBe(
    'what is wrong with this dialog?\n\nScreenshot from Mini Bot (an image file; open it with the Read tool): C:\shots\screenshot-1.png',
  )
})

test('a screenshot sent with no words asks Claude to take a look', async ($, on) => {
  const { prompts, submitted, tick, activity } = await world($, on, { running: true })
  prompts.push({ id: 's2', text: '', source: 'text', at: 0, attachments: [{ type: 'image', path: 'C:\shots\a.png' }] })
  await tick()
  expect(submitted[0].text).toMatch(/^Take a look at this screenshot\.\n\nScreenshot from Mini Bot/)
  // The turn it starts is still recognised as the bot's own.
  await $.turn.start({ turnId: 't9', text: submitted[0].text })
  expect(activity().at(-1)).toMatchObject({ phase: 'thinking', source: 'bot', id: 's2' })
})

test('dropped files and folders ride along as paths, each told how to be opened', async ($, on) => {
  const { prompts, submitted, tick } = await world($, on, { running: true })
  prompts.push({
    id: 'f1',
    text: 'what do these say?',
    source: 'text',
    at: 0,
    attachments: [
      { type: 'file', path: 'C:\docs\report.pdf', kind: 'file', direct: true },
      { type: 'file', path: 'C:\docs\data.zip', kind: 'file', direct: false },
      { type: 'file', path: 'C:\docs\src', kind: 'folder', direct: true },
    ],
  })
  await tick()
  expect(submitted[0].text).toBe(
    [
      'what do these say?',
      '',
      'File from Mini Bot (open it with the Read tool): C:\docs\report.pdf',
      'File from Mini Bot (the Read tool may not open this type; use a command or script if you need what is inside): C:\docs\data.zip',
      'Folder from Mini Bot (list what is inside it, then open what matters): C:\docs\src',
    ].join('\n'),
  )
})

test('files sent with no words ask Claude to take a look', async ($, on) => {
  const { prompts, submitted, tick } = await world($, on, { running: true })
  prompts.push({ id: 'f2', text: '', source: 'text', at: 0, attachments: [{ type: 'file', path: 'C:\a.pdf', kind: 'file', direct: true }] })
  prompts.push({ id: 'f3', text: '', source: 'text', at: 0, attachments: [{ type: 'file', path: 'C:\src', kind: 'folder', direct: true }] })
  prompts.push({
    id: 'f4',
    text: '',
    source: 'text',
    at: 0,
    attachments: [
      { type: 'image', path: 'C:\shots\a.png' },
      { type: 'file', path: 'C:\a.pdf', kind: 'file', direct: true },
    ],
  })
  await tick()
  await tick()
  await tick()
  expect(submitted.map(s => s.text.split('\n')[0])).toEqual([
    'Take a look at this file.',
    'Take a look at this folder.',
    'Take a look at the attachments.',
  ])
})

test('/mini-bot screenshot asks the floating bot to start a snip', async ($, on) => {
  const { run, requests } = await world($, on, { running: true })
  expect(await run('screenshot')).toMatch(/Select an area on screen/)
  expect(requests.find(r => r.path === '/v1/overlay/request')?.body).toEqual({ action: 'screenshot' })
})

test('/mini-bot screenshot says so when the bot is not running', async ($, on) => {
  const { run, requests } = await world($, on, { running: false })
  expect(await run('snip')).toMatch(/not running/)
  expect(requests).toEqual([])
})

test('/mini-bot speech says which recognizer is in use and downloads nothing without a yes', async ($, on) => {
  const { run, commands } = await world($, on, { running: true })
  expect(await run('speech')).toMatch(/basic recognizer[\s\S]*\/mini-bot speech install/)
  expect(commands.length).toBe(1)
  expect(String(commands[0])).toMatch(/install\.ps1.*-Check/)
  // Nobody answers the question in a test, so the installer is never started.
  expect(await run('speech install')).toMatch(/needs someone at the prompt/)
  expect(commands.length).toBe(1)
  expect(await run('speech install huge')).toMatch(/base \| small/)
  expect(await run('help')).toMatch(/\/mini-bot speech/)
})

test('/mini-bot update compares the installed version with GitHub and gives the update commands', async ($, on) => {
  const newer = await world($, on, { running: false, installed: '0.1.0', latest: '0.1.10' })
  const text = await newer.run('update')
  expect(text).toMatch(/0\.1\.0 is installed; version 0\.1\.10 is available/)
  expect(text).toMatch(/claude plugin marketplace update claude-mini-bot[\s\S]*claude plugin update mini-bot/)
  expect(newer.urls).toEqual(['https://raw.githubusercontent.com/Vinith-00704/Claude-Mini-bot/HEAD/.claude-plugin/plugin.json'])
  expect(await newer.run('help')).toMatch(/\/mini-bot update/)
})

test('/mini-bot update says when it is up to date', async ($, on) => {
  const { run } = await world($, on, { running: false, installed: '0.2.0', latest: '0.2.0' })
  expect(await run('update')).toBe('Mini Bot 0.2.0 is installed and up to date.')
})

test('/mini-bot update still gives the commands when GitHub cannot be reached', async ($, on) => {
  const { run } = await world($, on, { running: false, installed: '0.2.0', latest: null })
  expect(await run('update')).toMatch(/Could not check GitHub[\s\S]*claude plugin update mini-bot/)
})

// ---- the model and effort the session runs on ----

const sessionPosts = (requests: { method: string; path: string; body: any }[]) =>
  requests.filter(r => r.path === '/v1/session').map(r => r.body)

const step = async ($: any, input: Record<string, unknown>) => {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, messageCount: 1, ...input })) void _
}

test('the model and effort of each request are told to the bot, and a subagent is left out', async ($, on) => {
  const { requests, tick } = await world($, on, { running: true })
  await tick()
  // On connecting, the session's model is known but not yet its effort.
  expect(sessionPosts(requests)).toEqual([{ model: 'claude-opus-5-5', name: 'Opus 5.5', effort: null }])
  requests.length = 0

  await step($, { model: 'claude-opus-5-5', effort: 'high' })
  await tick()
  expect(sessionPosts(requests)).toEqual([{ model: 'claude-opus-5-5', name: 'Opus 5.5', effort: 'high' }])
  requests.length = 0

  // Nothing new, nothing sent; a subagent's own model is not the session's.
  await step($, { model: 'claude-opus-5-5', effort: 'high' })
  await step($, { model: 'claude-haiku-5-5', effort: 'low', agentId: 'sub1' })
  await tick()
  expect(sessionPosts(requests)).toEqual([])

  await step($, { model: 'claude-sonnet-5-5', effort: 'medium' })
  await tick()
  expect(sessionPosts(requests)).toEqual([{ model: 'claude-sonnet-5-5', name: 'Sonnet 5.5', effort: 'medium' }])
})

test('a model chosen with /model is noticed between requests, and an alias is not mistaken for a switch', async ($, on) => {
  const { requests, tick, setModel } = await world($, on, { running: true })
  await tick()
  await step($, { model: 'claude-opus-5-5', effort: 'high' })
  requests.length = 0

  // The session names the same model by its alias: no change.
  setModel('opus')
  for (let i = 0; i < 5; i++) await tick()
  expect(sessionPosts(requests)).toEqual([])

  setModel('claude-sonnet-5-5')
  for (let i = 0; i < 5; i++) await tick()
  // Its effort is not known until a request says so.
  expect(sessionPosts(requests)).toEqual([{ model: 'claude-sonnet-5-5', name: 'Sonnet 5.5', effort: null }])
})

test('/mini-bot status says which model the session runs on', async ($, on) => {
  const { run, tick } = await world($, on, { running: true })
  expect(await run('status')).not.toMatch(/Session model/)
  await tick()
  expect(await run('status')).toMatch(/Session model: Opus 5.5./)
  await step($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await tick()
  expect(await run('status')).toMatch(/Session model: Opus 5.5, effort xhigh./)
})
