import { expect, mock, test } from 'claude-code/testing'

import { normalizeConfig } from '../shared/config.mjs'

// A stand-in for the companion, behind the mod's own `$.fs` and `$.http`. The questions it is asked are answered as the
// test says, once polled for; `role` is how this session was started.
const world = async ($: any, on: any, { running = true, role, offFlag = false, stored }: { running?: boolean; role?: string; offFlag?: boolean; stored?: unknown } = {}) => {
  const requests: { method: string; path: string; body: any }[] = []
  const asked: any[] = []
  const submitted: string[] = []
  const aborted: string[] = []
  const launched: string[][] = []
  let choice = 'allow'
  let claimReply: any = { prompts: [] }
  let config: any = normalizeConfig(undefined)

  on('store.get', () => ({ value: stored }))
  on('store.set', () => ({ value: undefined }))
  on('tool.register', (_: any, e: any) => ({ value: { tool: `mcp__mini-bot__${e.name}` } }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.abort', (_: any, e: any) => {
    aborted.push(e.turnId)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'F:\\work\\project' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'mini-bot' } }))
  on('command.list', () => ({ value: [] }))
  on('prompt.submit', (_: any, e: any) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_: any, e: any) => {
    launched.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('classic.PermissionRequest', () => ({}))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('command.run', () => ({}))
  mock.env(on, { MINI_BOT_HOME: '/mb', ...(role ? { MINI_BOT_ROLE: role } : {}) })
  const clock = mock.clock(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', (_: any, e: any) => {
    if (String(e.path).endsWith('turned-off')) {
      if (offFlag) return { value: '1' }
      throw new Error('ENOENT')
    }
    if (!running) throw new Error('ENOENT')
    return { value: JSON.stringify({ pid: 1, port: 4711, token: 'secret' }) }
  })
  on('http.fetch', (_: any, e: any) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    requests.push({ method, path: url.pathname + url.search, body })
    const reply = (status: number, payload: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(payload) } })
    const blank = { granted: false, grantedAt: null, active: false, activeSince: null }
    const state = { running: true, version: 5, pid: 1, config, overlay: { visible: true }, permissions: { screen: blank, microphone: blank, computer: blank }, indicator: { visible: false, kinds: [] }, bridge: { connected: true, queued: 0 } }
    if (url.pathname === '/v1/health') return reply(200, { ok: true, version: 5, pid: 1 })
    if (url.pathname === '/v1/prompts/claim') return reply(200, { revision: config.revision, version: 5, ...claimReply })
    if (url.pathname === '/v1/cards/ask') {
      asked.push(body)
      return reply(200, { ticket: 'k1' })
    }
    if (url.pathname === '/v1/cards/ticket') return reply(200, { done: true, choice })
    if (url.pathname === '/v1/routines' && method === 'GET') return reply(200, { routines: [{ id: 'a', kind: 'say', text: 'Stretch', when: 'daily 09:00', repeats: true }] })
    if (url.pathname === '/v1/routines') return reply(200, body.kind === 'say' ? { routine: { id: 'b', kind: 'say', text: body.text, when: body.when, repeats: false } } : { ticket: 'k2' })
    if (url.pathname === '/v1/routines/remove') return reply(200, { removed: { id: 'a', kind: 'say', text: 'Stretch', when: 'daily 09:00', repeats: true } })
    if (url.pathname === '/v1/autostart') return reply(200, { ok: true, message: body.on ? 'Mini starts with your PC from now on.' : 'Mini no longer starts with your PC.' })
    if (url.pathname === '/v1/assistant') {
      if (typeof body.on === 'boolean') config = { ...config, assistant: { ...config.assistant, session: body.on }, revision: config.revision + 1 }
      return reply(200, { ...state, config })
    }
    if (url.pathname === '/v1/trust/ask' || url.pathname === '/v1/trust/off') return reply(200, { ...state, trust: { listen: false, full: false, mic: false } })
    return reply(200, state)
  })
  await $.session.start({ cwd: '/' })
  const run = async (args: string) => (await $.command.run({ command: 'mini-bot', args })).text as string
  await clock.settle()
  const tick = async () => {
    await clock.advance(1000)
    await clock.settle()
  }
  return { requests, asked, submitted, aborted, launched, clock, tick, run, setChoice: (c: string) => { choice = c }, setClaim: (r: any) => { claimReply = r } }
}

const permission = ($: any) => $.classic.PermissionRequest({ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item notes.txt' } })

test("in Mini's own session Claude Code's permission ask goes to the bot, and only a yes there allows it", async ($, on) => {
  const { asked, setChoice } = await world($, on, { role: 'main' })
  const allowed = await permission($)
  expect(allowed.decision).toEqual({ behavior: 'allow' })
  expect(asked[0].text).toMatch(/Remove-Item notes\.txt/)
  expect(asked[0].kind).toBe('permission')
  setChoice('deny')
  const denied = await permission($)
  expect(denied.decision.behavior).toBe('deny')
  expect(denied.decision.message).toMatch(/said no/)
  setChoice('timeout')
  expect((await permission($)).decision.message).toMatch(/did not answer/)
})

test("in a terminal session the bot stays out of it: Claude Code's own dialog comes up as usual", async ($, on) => {
  const { asked } = await world($, on)
  const result = await permission($)
  expect(result.decision).toBeUndefined()
  expect(asked).toHaveLength(0)
})

test("with no companion to ask, Mini's own session is refused, never allowed", async ($, on) => {
  await world($, on, { role: 'main', running: false })
  const result = await permission($)
  expect(result.decision.behavior).toBe('deny')
})

test('each session says who it is when it asks for prompts', async ($, on) => {
  const main = await world($, on, { role: 'main' })
  await main.tick()
  const claim = main.requests.find(r => r.path === '/v1/prompts/claim')
  expect(claim?.body.bridge).toEqual({ id: 'session-1', role: 'main', name: 'Mini' })
})

test('a terminal session is named after its folder', async ($, on) => {
  const { tick, requests } = await world($, on)
  await tick()
  expect(requests.find(r => r.path === '/v1/prompts/claim')?.body.bridge).toEqual({ id: 'session-1', role: 'terminal', name: 'project' })
})

test('asking to stop aborts the running turn of the main conversation', async ($, on) => {
  const { tick, setClaim, aborted } = await world($, on)
  await $.turn.start({ turnId: 't1', text: 'do a long thing' })
  setClaim({ prompts: [], abort: true })
  await tick()
  expect(aborted).toEqual(['t1'])
})

test('a spoken prompt is sent with a note that its reply is read aloud, and is still recognized as the bot\'s', async ($, on) => {
  const { tick, setClaim, submitted, requests } = await world($, on)
  setClaim({ prompts: [{ id: 'v1', text: 'what time is it', source: 'voice', at: 0 }] })
  await tick()
  setClaim({ prompts: [] })
  expect(submitted[0]).toMatch(/^what time is it\n\n\(Spoken to the Mini Bot/)
  await $.turn.start({ turnId: 't1', text: submitted[0]! })
  await $.turn.complete({ turnId: 't1', answer: 'Ten past nine.', durationMs: 5, isAborted: false, reason: 'answer' })
  const last = requests.filter(r => r.path === '/v1/activity').at(-1)
  expect(last?.body).toMatchObject({ phase: 'completed', id: 'v1', source: 'bot', preview: { text: 'Ten past nine.', isError: false } })
  expect(last?.body.session).toBe('session-1')
})

test('a typed prompt gets no such note', async ($, on) => {
  const { tick, setClaim, submitted } = await world($, on)
  setClaim({ prompts: [{ id: 't1', text: 'what time is it', source: 'text', at: 0 }] })
  await tick()
  expect(submitted[0]).toBe('what time is it')
})

test('commands reach the companion, and turning on listening or full access only asks in the bot', async ($, on) => {
  const { run, requests } = await world($, on)
  expect(await run('autostart on')).toMatch(/starts with your PC/)
  expect(requests.find(r => r.path === '/v1/autostart')?.body).toEqual({ on: true })
  expect(await run('assistant on')).toMatch(/starting in the background/)
  expect(requests.find(r => r.path === '/v1/assistant')?.body).toEqual({ on: true })
  expect(await run('listen on')).toMatch(/Answer in the bot/)
  expect(requests.find(r => r.path === '/v1/trust/ask')?.body).toEqual({ what: 'listen' })
  expect(await run('full-access on')).toMatch(/Answer in the bot/)
  expect(await run('full-access off')).toMatch(/Full access is off/)
  expect(requests.find(r => r.path === '/v1/trust/off')?.body).toEqual({ what: 'full' })
  expect(await run('listen maybe')).toMatch(/Use:/)
})

test('routines can be listed, added and removed from a command', async ($, on) => {
  const { run, requests } = await world($, on)
  expect(await run('routines')).toMatch(/daily 09:00: say "Stretch"/)
  expect(await run('remind "in 20 minutes" stand up now')).toMatch(/Added: in 20 minutes: say "stand up now"/)
  expect(requests.filter(r => r.path === '/v1/routines' && r.method === 'POST').at(-1)?.body).toEqual({ kind: 'say', text: 'stand up now', when: 'in 20 minutes' })
  expect(await run('routine "daily 09:00" brief me')).toMatch(/Answer in the bot/)
  expect(await run('routines remove 1')).toMatch(/Removed/)
  expect(await run('remind "in 20 minutes"')).toMatch(/Use:/)
})

test('a new session leaves Mini off when the person turned it off', async ($, on) => {
  const { launched } = await world($, on, { running: false, offFlag: true, stored: normalizeConfig({ wasRunning: true }) })
  expect(launched).toEqual([])
})

test('a new session starts Mini when it was running and the person has not turned it off', async ($, on) => {
  const { launched } = await world($, on, { running: false, stored: normalizeConfig({ wasRunning: true }) })
  expect(launched.some(argv => argv.includes('--detach'))).toBe(true)
})

test('the status says how the assistant is doing', async ($, on) => {
  const { run } = await world($, on)
  expect(await run('status')).toMatch(/Mini Bot is running/)
})

test('Mini\'s own session ending never takes the companion with it', async ($, on) => {
  const { requests } = await world($, on, { role: 'main' })
  await $.session.end({ reason: 'other', sessionId: 'session-1', resume: false } as any)
  expect(requests.some(r => r.path === '/v1/shutdown')).toBe(false)
})
