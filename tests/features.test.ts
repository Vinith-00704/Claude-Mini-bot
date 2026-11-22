// Reading the page in front and "summarize this page", designing a bot from a description, Claude Code's own
// window, the bot's way of talking, and its reply shown while it is written: Claude Code's side of each.

import { expect, mock, test } from 'claude-code/testing'

import { checkSprite, configKey, designBot, adoptBot, normalizeConfig, patchProfile } from '../shared/config.mjs'
import { personaNote } from '../hooks/lib/bridge'
import { buildCatalog, isBlocked } from '../hooks/lib/catalog'
import { describeBot } from '../hooks/lib/computer'

const FROG = {
  width: 8,
  height: 8,
  palette: { g: '#5FBF4A', k: '#1b1b1b' },
  frames: {
    idle: ['.gg..gg.', 'gkgggkgg', 'gggggggg', 'gggggggg', 'gkkkkkkg', 'gggggggg', '.gg..gg.', 'ggg..ggg'],
    done: ['.gg..gg.', 'gkgggkgg', 'gggggggg', 'gkkkkkkg', 'gkggggkg', 'ggkkkkgg', '.gg..gg.', 'ggg..ggg'],
  },
}

// A stand-in for the companion, behind the mod's own `$.fs` and `$.http`. `role` is how this session was started.
const world = async ($: any, on: any, { running = true, role, version = 6, stored, commands = [] as any[], wanted = true, companionHas }: { running?: boolean; role?: string; version?: number; stored?: unknown; commands?: any[]; wanted?: boolean; companionHas?: unknown } = {}) => {
  const requests: { method: string; path: string; body: any }[] = []
  const submitted: string[] = []
  const ran: { command: string; args: string }[] = []
  const toasts: string[] = []
  const prompts: any[] = []
  let ticketReply: any = { done: true, ok: true }
  let designReply: any = { status: 200, body: { ticket: 'k1' } }
  let cardReply: any = { done: true, choice: 'use', name: 'Pip', isNew: true }
  let commandText: string | undefined = 'ran'
  // What the mod keeps (its settings, and whether a change is still to be sent), and the companion's own copy of the settings.
  const kept = new Map<string, unknown>()
  let config: any = normalizeConfig(companionHas ?? stored)

  on('store.get', (_: any, e: any) => ({ value: kept.has(e.key) ? kept.get(e.key) : e.key === 'config' || kept.size === 0 ? stored : undefined }))
  on('store.set', (_: any, e: any) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.register', (_: any, e: any) => ({ value: { tool: `mcp__mini-bot__${e.name}` } }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  // The bottom of a model request: the reply comes in pieces, as it does from a model.
  on('turn.step', async function* (_: any, e: any) {
    for (const text of e.pieces ?? []) yield { kind: 'text', index: 0, text }
    return { turnId: e.turnId, index: e.index, answer: (e.pieces ?? []).join(''), toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'F:\\work\\project' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text ?? e)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'mini-bot' } }))
  on('command.list', () => ({ value: commands }))
  on('prompt.submit', (_: any, e: any) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('classic.PermissionRequest', () => ({}))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  // A command of Claude Code's own, run from the bot: what it printed, or nothing when it opened a panel.
  on('command.run', (_: any, e: any) => {
    ran.push({ command: e.command, args: e.args ?? '' })
    return commandText === undefined ? {} : { text: commandText }
  })
  mock.env(on, { MINI_BOT_HOME: '/mb', ...(role ? { MINI_BOT_ROLE: role } : {}) })
  const clock = mock.clock(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', (_: any, e: any) => {
    if (String(e.path).endsWith('turned-off') || !running) throw new Error('ENOENT')
    return { value: JSON.stringify({ pid: 1, port: 4711, token: 'secret' }) }
  })
  on('http.fetch', (_: any, e: any) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    requests.push({ method, path: url.pathname + url.search, body })
    const reply = (status: number, payload: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(payload) } })
    const blank = { granted: false, grantedAt: null, active: false, activeSince: null }
    const state = {
      running: true, version, pid: 1, config, overlay: { visible: true }, permissions: { screen: blank, microphone: blank, computer: blank },
      indicator: { visible: false, kinds: [] }, bridge: { connected: true, queued: 0 }, trust: { listen: false, full: false, mic: false },
      assistant: { status: wanted ? 'running' : 'off', wanted, pid: wanted ? 77 : null, sessionId: null, note: '', home: 'C:\\mb\\home', startsWithPc: false },
      keys: { terminal: { combo: 'Ctrl+Alt+T', ok: false } },
    }
    if (url.pathname === '/v1/health') return reply(200, { ok: true, version, pid: 1 })
    // The companion takes the mod's copy of the settings and counts the change, as the real one does.
    if (url.pathname === '/v1/config' && method === 'PUT') {
      config = { ...normalizeConfig(body), revision: config.revision + 1 }
      return reply(200, { ...state, config })
    }
    if (url.pathname === '/v1/state') return reply(200, state)
    if (url.pathname === '/v1/prompts/claim') return reply(200, { revision: config.revision, key: configKey(config), version, prompts: prompts.splice(0) })
    if (url.pathname === '/v1/page/read' || url.pathname === '/v1/page/summarize') return reply(200, { ticket: 't1' })
    if (url.pathname === '/v1/computer/ticket') return reply(200, ticketReply)
    if (url.pathname === '/v1/bots/design') return reply(designReply.status, designReply.body)
    if (url.pathname === '/v1/cards/ticket') return reply(200, cardReply)
    return reply(200, state)
  })
  await $.session.start({ cwd: '/' })
  await clock.settle()
  requests.length = 0
  const tick = async () => {
    await clock.advance(1000)
    await clock.settle()
  }
  return {
    requests, submitted, ran, toasts, prompts, clock, tick,
    run: async (args: string) => (await $.command.run({ command: 'mini-bot', args })).text as string,
    call: (tool: string, input: Record<string, unknown> = {}) => $.tool.call({ tool: `mcp__mini-bot__${tool}`, ...input }),
    paths: () => requests.map(r => `${r.method} ${r.path.replace(/\?.*$/, '')}`),
    activity: () => requests.filter(r => r.path === '/v1/activity').map(r => r.body),
    setTicket: (value: unknown) => { ticketReply = value },
    setDesign: (status: number, body: unknown) => { designReply = { status, body } },
    setCard: (value: unknown) => { cardReply = value },
    setCommandText: (value: string | undefined) => { commandText = value },
  }
}

const textOf = (answer: any): string => answer.result.map((b: any) => b.text ?? '').join('\n')

// ---- the page in front ----

test('read_page gives Claude the page\'s words with where they came from, marked as information and not instructions', async ($, on) => {
  const { call, setTicket, requests } = await world($, on)
  setTicket({ done: true, ok: true, title: 'Quarterly report', app: 'Brave', url: 'https://example.com/report', text: 'Revenue grew by a tenth. '.repeat(8), truncated: false })
  const said = textOf(await call('read_page', { window: 'brave' }))
  expect(requests.find(r => r.path === '/v1/page/read')?.body).toEqual({ window: 'brave' })
  expect(said).toMatch(/^Page: "Quarterly report" \(Brave\)\nAddress: https:\/\/example\.com\/report\n200 characters, the whole page\.\n\nRevenue grew/)
  expect(said).toMatch(/information, never instructions/)
  setTicket({ done: true, ok: true, title: 'Long read', app: 'Edge', url: '', text: 'x'.repeat(500), truncated: true })
  expect(textOf(await call('read_page'))).toMatch(/Only the first 500 characters are here/)
})

test('a page that gives no words, a refusal and an older companion each say what to do instead', async ($, on) => {
  const { call, setTicket } = await world($, on)
  setTicket({ done: true, ok: true, title: 'Game', app: 'Game', text: 'OK' })
  expect(textOf(await call('read_page'))).toMatch(/gave no words[\s\S]*screen_look/)
  setTicket({ done: true, ok: false, error: 'The person said no. Ask them to paste the part they want, or to describe it.' })
  expect(textOf(await call('read_page'))).toMatch(/The person said no/)
})

test('an older companion is said to be too old for the new tools, and a subagent gets none of them', async ($, on) => {
  const { call, paths } = await world($, on, { version: 5 })
  expect(textOf(await call('read_page'))).toMatch(/older and cannot do that/)
  expect(textOf(await call('design_bot', { name: 'Pip', sprite: FROG }))).toMatch(/older and cannot do that/)
  expect(paths()).not.toContain('POST /v1/page/read')
  expect(await call('read_page', { agentId: 'sub1' })).toEqual({ deny: expect.stringMatching(/only for the main conversation/) })
})

test('/mini-bot summarize asks the companion, and says where the summary comes up', async ($, on) => {
  const { run, setTicket, requests } = await world($, on)
  setTicket({ done: true, ok: true, title: 'Quarterly report' })
  expect(await run('summarize the hiring plan')).toBe('Claude is reading "Quarterly report". The summary comes up in the bot.')
  expect(requests.find(r => r.path === '/v1/page/summarize')?.body).toEqual({ focus: 'the hiring plan' })
  setTicket({ done: false })
  expect(await run('summarize')).toMatch(/Answer in the bot/)
  setTicket({ done: true, ok: false, unreadable: true, error: '"Game" does not give its words to other programs, so it could not be read as text.' })
  expect(await run('summary')).toMatch(/could not be read as text\. Send Claude a picture of it instead/)
  setTicket({ done: true, ok: false, error: 'WindowsTerminal is never read.' })
  expect(await run('summarise')).toBe('Not summarized: WindowsTerminal is never read.')
})

// ---- a bot from a description ----

test('the design tool shows the bot to the person and tells Claude what they answered', async ($, on) => {
  const { call, setCard, setDesign, requests, toasts } = await world($, on)
  const design = { name: 'Pip', about: 'A frog.', sprite: FROG, accent: '#5fbf4a', tone: 'cheerful' }
  expect(textOf(await call('design_bot', design))).toMatch(/The person chose it: Pip is now the bot on their screen, and their other bots are still there/)
  expect(requests.find(r => r.path === '/v1/bots/design')?.body).toEqual(design)
  expect(toasts.at(-1)).toMatch(/preview/)
  setCard({ done: true, choice: 'again' })
  expect(textOf(await call('design_bot', design))).toMatch(/wants another try/)
  setCard({ done: true, choice: 'no' })
  expect(textOf(await call('design_bot', design))).toMatch(/did not take it\. Nothing changed/)
  setCard({ done: true, choice: 'timeout' })
  expect(textOf(await call('design_bot', design))).toMatch(/did not answer[\s\S]*Ask before showing another/)
  setDesign(400, { error: 'frames.idle row 5 is 7 characters; every row is 8 (the sprite\'s width).' })
  expect(textOf(await call('design_bot', design))).toMatch(/was not shown: frames\.idle row 5 is 7 characters[\s\S]*call design_bot again/)
})

test('get_bot hands back a bot\'s design in the form the design tool takes, with no companion needed', async ($, on) => {
  const made = adoptBot(normalizeConfig(undefined), (designBot(normalizeConfig(undefined), { name: 'Pip', sprite: FROG, notes: 'Warm and brief.' }) as any).profile) as any
  const { call } = await world($, on, { running: false, stored: made.config })
  const said = textOf(await call('get_bot'))
  expect(said).toMatch(/^The design of Pip, as design_bot takes it \(send it back whole, changed, with replace: "Pip"\):/)
  const design = JSON.parse(said.split('\n')[1]!)
  expect(design.sprite.frames.idle[0][1]).toBe('gkgggkgg')
  expect([design.name, design.notes, design.tone]).toEqual(['Pip', 'Warm and brief.', 'neutral'])
  expect(said).toMatch(/other bots: Mini\./)
  expect(textOf(await call('get_bot', { name: 'mini' }))).toMatch(/"avatar":"clawd","skin":"claude"/)
  expect(textOf(await call('get_bot', { name: 'Zed' }))).toMatch(/no bot called "Zed"\. The bots are: Mini, Pip\./)
})

test('/mini-bot design hands the description to Claude with the way to do it, and needs something to go on', async ($, on) => {
  const { run, submitted, clock } = await world($, on)
  expect(await run('design')).toMatch(/Say what the bot should be/)
  expect(submitted).toHaveLength(0)
  expect(await run('design a sleepy blue owl, calm')).toMatch(/preview comes up beside the bot/)
  // A command cannot start a turn while it runs, so the prompt goes in a moment after it has returned.
  expect(submitted).toHaveLength(0)
  await clock.advance(300)
  await clock.settle()
  expect(submitted[0]).toMatch(/^Design a Mini Bot for me: a sleepy blue owl, calm\n\n\(Use the mini-bot:design-bot skill/)
})

test('pixel art is checked cell by cell, and says exactly what is wrong', async () => {
  expect('sprite' in checkSprite(FROG)).toBe(true)
  const broken = (change: Record<string, unknown>) => (checkSprite({ ...FROG, ...change }) as { error: string }).error
  expect(broken({ width: 40 })).toMatch(/sprite\.width is a whole number from 8 to 24/)
  expect(broken({ palette: {} })).toMatch(/names at least one colour/)
  expect(broken({ palette: { green: '#00ff00' } })).toMatch(/one letter or digit/)
  expect(broken({ palette: { g: 'green' } })).toMatch(/written like #3fa7d6/)
  expect(broken({ frames: {} })).toMatch(/needs "idle"/)
  expect(broken({ frames: { idle: FROG.frames.idle, dancing: FROG.frames.idle } })).toMatch(/"dancing" is not a state/)
  expect(broken({ frames: { idle: FROG.frames.idle.slice(1) } })).toMatch(/has 7 rows; every picture has 8/)
  expect(broken({ frames: { idle: FROG.frames.idle.map((r, i) => (i === 2 ? 'ggggxggg' : r)) } })).toMatch(/row 3 uses "x", which is not in the palette/)
  expect(broken({ frames: { idle: [FROG.frames.idle, FROG.frames.idle, FROG.frames.idle, FROG.frames.idle] } })).toMatch(/3 pictures at most/)
  expect(broken({ frames: { idle: FROG.frames.idle.map(() => '........') } })).toMatch(/almost empty/)
  // A space is nothing too, and colours come out in one spelling.
  const spaced = checkSprite({ ...FROG, frames: { idle: FROG.frames.idle.map(r => r.replace(/\./g, ' ')) } }) as any
  expect(spaced.sprite.frames.idle[0][0]).toBe('.gg..gg.')
  expect(spaced.sprite.palette.g).toBe('#5fbf4a')
})

test('a bot keeps its own art under another avatar, takes any colour, and "custom" needs art to wear', async () => {
  const config = normalizeConfig(undefined)
  expect((patchProfile(config, 'default', { avatar: 'custom' }) as any).error).toMatch(/no pixel art of its own yet/)
  const withArt = (patchProfile(config, 'default', { avatar: 'custom', sprite: FROG as any, appearance: { accent: '#3FA7D6', skin: '#101010' } }) as any).config
  expect([withArt.profiles[0].avatar, withArt.profiles[0].appearance.accent, withArt.profiles[0].appearance.skin]).toEqual(['custom', '#3fa7d6', '#101010'])
  const asRobot = (patchProfile(withArt, 'default', { avatar: 'robot' }) as any).config
  expect([asRobot.profiles[0].avatar, asRobot.profiles[0].sprite.width]).toEqual(['robot', 8])
  const without = (patchProfile(withArt, 'default', { sprite: null }) as any).config
  expect([without.profiles[0].avatar, 'sprite' in without.profiles[0]]).toEqual(['clawd', false])
  expect((patchProfile(config, 'default', { appearance: { accent: 'teal' as any } }) as any).error).toMatch(/or a colour written like #3fa7d6/)
  // Art that was damaged where it is kept is dropped, and the bot goes back to the default look.
  const damaged = normalizeConfig({ ...withArt, profiles: [{ ...withArt.profiles[0], sprite: { ...FROG, width: 9 } }] })
  expect([damaged.profiles[0]!.avatar, 'sprite' in damaged.profiles[0]!]).toEqual(['clawd', false])
})

test('the settings take a colour of the person\'s own, the bot\'s own art, and the two new keys', async ($, on) => {
  const made = adoptBot(normalizeConfig(undefined), (designBot(normalizeConfig(undefined), { name: 'Pip', sprite: FROG }) as any).profile) as any
  const { run } = await world($, on, { stored: made.config })
  expect(await run('set accent #3FA7D6')).toBe('Accent colour is now #3fa7d6.')
  expect(await run('set accent teal')).toMatch(/or a colour written like #3fa7d6/)
  expect(await run('set avatar ghost')).toBe('Avatar is now ghost.')
  expect(await run('set avatar custom')).toBe('Avatar is now custom (its own pixel art).')
  expect(await run('set summarize-key ctrl+alt+g')).toBe('Key that summarizes the page in front is now Ctrl+Alt+G.')
  // Said the way it reads, in words: the same setting.
  expect(await run('set summarize key ctrl+alt+y')).toBe('Key that summarizes the page in front is now Ctrl+Alt+Y.')
  expect(await run('set summarize key')).toMatch(/^Give summarize-key a value/)
  expect(await run('set terminal-key ctrl+alt+y')).toMatch(/already the key that summarizes/)
  expect(await run('set terminal-key off')).toBe("Key that opens Claude Code's own window is now off.")
  expect(await run('set summarize-key reset')).toMatch(/Ctrl\+Alt\+P/)
  expect(await run('bot list')).toMatch(/\* Pip \(its own pixel art\)/)
})

test('describing a bot built in says so, and one wearing another look mentions the art it keeps', async () => {
  const config = normalizeConfig(undefined)
  expect(describeBot(config.profiles[0]!, [])).toMatch(/"avatar":"clawd"[\s\S]*It is their only bot\./)
  const kept = (patchProfile((patchProfile(config, 'default', { avatar: 'custom', sprite: FROG as any }) as any).config, 'default', { avatar: 'cat' }) as any).config
  expect(describeBot(kept.profiles[0], ['Bolt'])).toMatch(/also has pixel art of its own[\s\S]*other bots: Bolt\./)
})

test("a shared copy of the settings that lost a bot's art is put right from the companion's, which still has it", async ($, on) => {
  const full = (adoptBot(normalizeConfig(undefined), (designBot(normalizeConfig(undefined), { name: 'Pip', sprite: FROG }) as any).profile) as any).config
  // What a session still running older code writes back: the same revision, without the art.
  const stripped = { ...full, profiles: full.profiles.map(({ sprite: _sprite, ...p }: any) => ({ ...p, avatar: p.avatar === 'custom' ? 'clawd' : p.avatar })) }
  const { call, tick, paths } = await world($, on, { stored: stripped, companionHas: full })
  expect(textOf(await call('get_bot', { name: 'Pip' }))).toMatch(/"sprite":{"width":8/)
  // Once the copies agree, nothing more is fetched (the first tick is the bridge connecting, which always looks once).
  await tick()
  const before = paths().filter(p => p === 'GET /v1/state').length
  await tick()
  await tick()
  expect(paths().filter(p => p === 'GET /v1/state').length).toBe(before)
})

// ---- how the bot talks ----

test('a bot with a character says so to Claude with what is sent from the bot; a plain one adds nothing', async ($, on) => {
  const plain = normalizeConfig(undefined)
  expect(personaNote(plain.profiles[0]!)).toBe('')
  const salty = (patchProfile(plain, 'default', { name: 'Salty', personality: { tone: 'playful', notes: 'A gruff old sea captain: short answers' } }) as any).config
  expect(personaNote(salty.profiles[0])).toBe(
    "(You are answering as Salty, the person's Mini Bot, in a playful tone. Its character: A gruff old sea captain: short answers. This is only about how the reply is worded: what you do, and what is true, stay the same.)",
  )
  const { prompts, submitted, tick, activity } = await world($, on, { stored: salty })
  prompts.push({ id: 'p1', text: 'what day is it', source: 'voice', at: 0 })
  await tick()
  expect(submitted[0]).toMatch(/^what day is it\n\n\(You are answering as Salty[\s\S]*\)\n\n\(Spoken to the Mini Bot\./)
  // The turn it starts is still recognized as the bot's own.
  await $.turn.start({ turnId: 't1', text: submitted[0]! })
  expect(activity().at(-1)).toMatchObject({ phase: 'thinking', source: 'bot', id: 'p1' })
})

// ---- the reply as it is written ----

const step = async ($: any, pieces: string[], extra: Record<string, unknown> = {}) => {
  const got: any[] = []
  for await (const piece of $.turn.step({ turnId: 't1', index: 0, messageCount: 1, model: 'claude-opus-5-5', pieces, ...extra })) got.push(piece)
  return got
}

test('the reply of a turn the bot started is passed on as it is written, and every piece goes on untouched', async ($, on) => {
  const { prompts, submitted, tick, activity, clock } = await world($, on)
  prompts.push({ id: 'p1', text: 'tell me about frogs', source: 'text', at: 0 })
  await tick()
  await $.turn.start({ turnId: 't1', text: submitted[0]! })
  const pieces = ['Frogs are amphibians ', 'that live near water. ', 'They start life as tadpoles ', 'and grow legs later.']
  const got = await step($, pieces)
  await clock.settle()
  expect(got.map(p => p.text)).toEqual(pieces)
  const partial = activity().filter(a => a.preview?.partial)
  expect(partial.length).toBeGreaterThan(0)
  expect(partial.at(-1)).toMatchObject({ id: 'p1', source: 'bot', phase: 'thinking', preview: { isError: false, partial: true } })
  expect(pieces.join('').startsWith(partial[0].preview.text)).toBe(true)
  await $.turn.complete({ turnId: 't1', answer: pieces.join(''), durationMs: 5, isAborted: false, reason: 'answer' })
  expect(activity().at(-1)).toMatchObject({ phase: 'completed', preview: { text: pieces.join(''), isError: false } })
  expect(activity().at(-1).preview.partial).toBeUndefined()
})

test('a turn the bot did not start, and a subagent\'s, keep their words to themselves', async ($, on) => {
  const { prompts, submitted, tick, activity, clock } = await world($, on)
  await $.turn.start({ turnId: 't1', text: 'typed in the terminal' })
  await step($, ['A private answer that is long enough to have been passed on if it were the bot\'s.'])
  await clock.settle()
  expect(activity().some(a => a.preview)).toBe(false)
  await $.turn.complete({ turnId: 't1', answer: 'x', durationMs: 5, isAborted: false, reason: 'answer' })
  prompts.push({ id: 'p2', text: 'and from the bot', source: 'text', at: 0 })
  await tick()
  await $.turn.start({ turnId: 't2', text: submitted[0]! })
  await step($, ['A helper agent thinking aloud at some length about something else.'], { agentId: 'sub1' })
  await clock.settle()
  expect(activity().some(a => a.preview?.partial)).toBe(false)
})

// ---- slash commands in the bot, and Claude Code's own window ----

const COMMANDS = [
  { name: 'model', description: 'Pick a model', source: 'builtin' },
  { name: 'effort', description: 'Pick an effort', source: 'builtin' },
  { name: 'permissions', description: 'Permission rules', source: 'builtin' },
  { name: 'cost', description: 'What it cost', source: 'builtin' },
]

test('in Mini\'s own session the model and effort can be changed from the bot; in a terminal session the bot leaves them alone', async ($, on) => {
  expect([isBlocked('model', true), isBlocked('MODEL', false), isBlocked('permissions', true), isBlocked('cost', false)]).toEqual([false, true, true, false])
  expect(buildCatalog(COMMANDS as any, true).map(c => c.name).filter(n => !n.startsWith('mini-bot'))).toEqual(['model', 'effort', 'cost'])
  expect(buildCatalog(COMMANDS as any).map(c => c.name).filter(n => !n.startsWith('mini-bot'))).toEqual(['cost'])
  const terminal = await world($, on, { commands: COMMANDS })
  terminal.prompts.push({ id: 'c1', text: '/model haiku', source: 'text', at: 0 })
  await terminal.tick()
  expect(terminal.ran).toHaveLength(0)
  expect(terminal.activity().at(-1).preview.text).toMatch(/\/model changes something the bot never touches/)
})

test('a command that prints is shown in the bot; one that opens something to choose from brings Claude Code\'s window up', async ($, on) => {
  const main = await world($, on, { role: 'main', commands: COMMANDS })
  main.prompts.push({ id: 'c1', text: '/model haiku', source: 'text', at: 0 })
  await main.tick()
  expect(main.ran).toEqual([{ command: 'model', args: 'haiku' }])
  expect(main.activity().at(-1).preview.text).toBe('ran')
  expect(main.paths()).not.toContain('POST /v1/overlay/request')

  main.setCommandText(undefined)
  main.prompts.push({ id: 'c2', text: '/model', source: 'text', at: 0 })
  await main.tick()
  expect(main.activity().at(-1).preview.text).toMatch(/If it opened something to choose from, that is in Claude Code's own window/)
  await main.tick()
  expect(main.requests.filter(r => r.path === '/v1/overlay/request').map(r => r.body)).toEqual([{ action: 'terminal' }])
  // Still refused there: what guards the session.
  main.prompts.push({ id: 'c3', text: '/permissions', source: 'text', at: 0 })
  await main.tick()
  expect(main.ran).toHaveLength(2)
})

test('/mini-bot terminal opens Claude Code\'s own window, and says so when there is no session of Mini\'s own', async ($, on) => {
  const { run, requests } = await world($, on)
  expect(await run('terminal')).toMatch(/coming up beside the bot[\s\S]*Ctrl\+Alt\+T opens it and puts it away/)
  expect(requests.find(r => r.path === '/v1/overlay/request')?.body).toEqual({ action: 'terminal' })
  expect(await run('assistant show')).toMatch(/coming up beside the bot/)
  expect(await run('status')).toMatch(/Open Claude Code's own window: Ctrl\+Alt\+T does not work, another program already uses it/)
  expect(await run('help')).toMatch(/\/mini-bot summarize[\s\S]*\/mini-bot design[\s\S]*\/mini-bot terminal/)
})

test('with no session of its own there is no window to open, and an older companion says it is too old', async ($, on) => {
  const none = await world($, on, { wanted: false })
  expect(await none.run('terminal')).toMatch(/no Claude Code session of its own yet[\s\S]*\/mini-bot assistant on/)
  expect(none.paths()).not.toContain('POST /v1/overlay/request')
})

test('an older companion is told apart for each of the new commands', async ($, on) => {
  const old = await world($, on, { version: 5 })
  for (const command of ['terminal', 'summarize', 'design a fox']) expect(await old.run(command)).toMatch(/older and cannot do that/)
  expect(old.submitted).toHaveLength(0)
})
