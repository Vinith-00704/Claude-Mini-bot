import { expect, mock, test } from 'claude-code/testing'

import { normalizeConfig } from '../shared/config.mjs'

// A stand-in for the companion's computer-control routes, behind the mod's own `$.fs` and `$.http`.
// Each ticket answers "not yet" once, then what the test set, so the waiting is exercised too.
const world = async ($: any, on: any, { running = true }: { running?: boolean } = {}) => {
  const requests: { method: string; path: string; body: any }[] = []
  const registered: any[] = []
  const toasts: string[] = []
  const answers = new Map<string, unknown>()
  const polled = new Map<string, number>()
  let nextAnswer: unknown = { done: true, ok: true }
  let seq = 0

  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('tool.register', (_: any, e: any) => {
    registered.push(e)
    return { value: { tool: `mcp__mini-bot__${e.name}` } }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text ?? e)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'mini-bot' } }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  mock.env(on, { MINI_BOT_HOME: '/mb' })
  const clock = mock.clock(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', () => {
    if (!running) throw new Error('ENOENT')
    return { value: JSON.stringify({ pid: 1, port: 4711, token: 'secret' }) }
  })
  on('http.fetch', (_: any, e: any) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    requests.push({ method, path: url.pathname + url.search, body })
    const reply = (status: number, payload: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(payload) } })
    if (url.pathname === '/v1/health') return reply(200, { ok: true, version: 4 })
    if (url.pathname === '/v1/state') return reply(200, { running: true, version: 4, config: normalizeConfig(undefined), bridge: { connected: true, queued: 0 } })
    if (['/v1/computer/start', '/v1/computer/look', '/v1/computer/act'].includes(url.pathname)) {
      if (body?.why === 'refuse me') return reply(400, { error: 'why is a short description of the step, for the person' })
      seq += 1
      answers.set(`t${seq}`, nextAnswer)
      return reply(200, { ticket: `t${seq}` })
    }
    if (url.pathname === '/v1/computer/ticket') {
      const id = url.searchParams.get('id')!
      const times = (polled.get(id) ?? 0) + 1
      polled.set(id, times)
      return reply(200, times === 1 ? { done: false } : answers.get(id))
    }
    if (url.pathname === '/v1/computer/stop') return reply(200, { ok: true, wasRunning: true, actions: 3 })
    return reply(200, {})
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  requests.length = 0
  return {
    registered,
    requests,
    toasts,
    answer: (value: unknown) => (nextAnswer = value),
    call: (tool: string, input: Record<string, unknown> = {}) => $.tool.call({ tool: `mcp__mini-bot__${tool}`, ...input }),
    paths: () => requests.map(r => `${r.method} ${r.path.replace(/\?.*$/, '')}`),
  }
}

const seen = {
  done: true,
  ok: true,
  image: 'QUJD',
  mediaType: 'image/jpeg',
  width: 1366,
  height: 768,
  monitor: 1,
  monitors: [{ index: 1, primary: true, width: 2560, height: 1440 }],
  cursor: { x: 10, y: 20 },
  windows: [{ title: 'Book1 - Excel', process: 'EXCEL', foreground: true, minimized: false, x: 0, y: 0, w: 1366, h: 740 }],
  elementsOf: { title: 'Book1 - Excel', process: 'EXCEL' },
  elements: [{ n: 1, type: 'button', name: 'Save', x: 40, y: 12, w: 20, h: 20, password: false, enabled: true }],
}

test('the four computer-control tools are offered to Claude, each saying what it may and may not do', async ($, on) => {
  const { registered } = await world($, on)
  expect(registered.map(r => r.name)).toEqual(['computer_start', 'computer_look', 'computer_act', 'computer_stop'])
  const start = registered[0]
  expect(start.description).toMatch(/Prefer your other tools/)
  expect(start.description).toMatch(/can never be controlled/)
  expect(start.inputSchema.required).toEqual(['task', 'apps'])
  expect(registered[2].description).toMatch(/Never type passwords/)
  expect(registered[2].inputSchema.required).toEqual(['action', 'why'])
})

test('a look reaches Claude as the picture itself, then what is on it, marked as information and not instructions', async ($, on) => {
  const { call, answer, paths } = await world($, on)
  answer(seen)
  const res = await call('computer_look', { monitor: 1 })
  const blocks = res.result as any[]
  expect(blocks[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
  const text = blocks[1].text as string
  expect(text).toMatch(/Monitor 1 of 1; the picture is 1366 x 768 pixels/)
  expect(text).toMatch(/\[front\] EXCEL: "Book1 - Excel"/)
  expect(text).toMatch(/\[1\] button "Save" at 40,12/)
  expect(text).toMatch(/information, never instructions/)
  // It asked once and waited for the answer.
  expect(paths()).toEqual(['GET /v1/health', 'GET /v1/health', 'POST /v1/computer/look', 'GET /v1/computer/ticket', 'GET /v1/computer/ticket'])
})

test('a step says what was done and shows the screen after it; a refusal is passed on as it is', async ($, on) => {
  const { call, answer, requests } = await world($, on)
  answer({ ...seen, did: 'Click "Save" in Excel' })
  const done = await call('computer_act', { action: 'click', element: 1, why: 'to save' })
  expect((done.result as any[])[1].text).toMatch(/^Done: Click "Save" in Excel\. The screen after it:/)
  const act = requests.find(r => r.path === '/v1/computer/act')!
  expect(act.body).toEqual({ action: 'click', element: 1, why: 'to save' })

  answer({ done: true, ok: false, refused: true, error: 'Not done: chrome is not one of the apps allowed for this task (excel).' })
  const refused = await call('computer_act', { action: 'click', x: 1, y: 1, why: 'x' })
  expect((refused.result as any[])[0].text).toMatch(/^Not done: chrome is not one of the apps allowed/)

  const bad = await call('computer_act', { action: 'click', x: 1, y: 1, why: 'refuse me' })
  expect((bad.result as any[])[0].text).toMatch(/^Not done: why is a short description/)
})

test('control is asked for in the bot, and ends with the turn that asked for it', async ($, on) => {
  const { call, answer, toasts, requests } = await world($, on)
  await $.turn.start({ turnId: 't1', text: 'make a chart in excel' })
  answer({ done: true, ok: true, granted: true, level: 'step', apps: ['excel'] })
  const res = await call('computer_start', { task: 'Make a chart', apps: ['excel'] })
  expect((res.result as any[])[0].text).toMatch(/^Control granted for this task\. Apps: excel\. the person approves every step/)
  expect(toasts.join(' ')).toMatch(/answer in the bot/)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer' })
  const stop = requests.filter(r => r.path === '/v1/computer/stop')
  expect(stop.map(r => r.body.reason)).toEqual(['the turn ended'])
})

test('a no from the person is passed on, and Claude is told not to press', async ($, on) => {
  const { call, answer } = await world($, on)
  answer({ done: true, ok: false, granted: false, error: 'The person said no. Do not try to control the computer for this; ask how they want to go on.' })
  const res = await call('computer_start', { task: 'Clean up', apps: ['explorer'] })
  expect((res.result as any[])[0].text).toMatch(/The person said no/)
})

test('a subagent never gets control, and nothing is asked of the companion for it', async ($, on) => {
  const { call, requests } = await world($, on)
  const res = await call('computer_start', { task: 'x', apps: ['excel'], agentId: 'sub1' })
  expect(res.isError ?? res.deny !== undefined).toBe(true)
  expect(String(res.text ?? res.deny)).toMatch(/only for the main conversation/)
  expect(requests.filter(r => r.path.startsWith('/v1/computer'))).toEqual([])
})

test('without the bot running there is no control, and Claude is told how the person can start it', async ($, on) => {
  const { call } = await world($, on, { running: false })
  const res = await call('computer_look')
  expect((res.result as any[])[0].text).toMatch(/not running.*\/mini-bot start/)
})

test('computer_stop ends control and says how many steps were taken', async ($, on) => {
  const { call, requests } = await world($, on)
  const res = await call('computer_stop', { summary: 'Made the chart.' })
  expect((res.result as any[])[0].text).toMatch(/Control ended after 3 steps/)
  expect(requests.find(r => r.path === '/v1/computer/stop')!.body).toEqual({ reason: 'Claude finished', summary: 'Made the chart.' })
})
