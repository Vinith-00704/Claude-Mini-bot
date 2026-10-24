// The bridge between the floating bot and this Claude Code session.
//
// The bot is only a front-end. What is typed or spoken into it is queued in the
// companion; here it is picked up about once a second and submitted as an
// ordinary prompt of the session (`$.prompt.submit`), so it runs under Claude
// Code's own permissions and shows in the transcript like any other prompt.
//
// In the other direction this reports what Claude Code is really doing (a turn
// starting, a tool running, a turn ending) so the bot can show it. The text of a
// reply is sent only for a turn the bot itself started, and only to the
// companion on this computer; every other turn is reported as a state alone.

import { connect, request, type Link } from './client'
import { loadConfig } from './config'
import { syncConfig } from './lifecycle'
import { MIN_RUNTIME_VERSION, type Engine, type Phase, type QueuedPrompt } from './types'

const DEFAULT_SCREENSHOT_ASK = 'Take a look at this screenshot.'

/**
 * The text Claude Code receives. A plugin's prompt cannot carry an image itself,
 * so a screenshot is named by its file, which Claude opens with its Read tool
 * (under Claude Code's own permission to read it).
 */
export function composePrompt(prompt: Pick<QueuedPrompt, 'text' | 'attachments'>): string {
  const images = (prompt.attachments ?? []).filter(a => a.type === 'image')
  if (images.length === 0) return prompt.text
  const ask = prompt.text.trim() === '' ? DEFAULT_SCREENSHOT_ASK : prompt.text
  const lines = images.map(a => `Screenshot from Mini Bot (an image file; open it with the Read tool): ${a.path}`)
  return `${ask}\n\n${lines.join('\n')}`
}

type ClaimReply = { prompts: QueuedPrompt[]; revision: number; version: number }

type Report = {
  phase: Phase
  id?: string | null
  detail?: string
  source?: 'bot' | 'claude'
  preview?: { text: string; isError: boolean }
}

// Module state. It starts over if the mod reloads; the companion holds the truth.
let link: Link | null = null
let toolsRunning = 0
let lastReport = ''
let isOutdated = false
let pending: QueuedPrompt[] = []
let current: QueuedPrompt | null = null

/** True when the companion is too old to carry prompts, so `/mini-bot status` can say so. */
export function isRuntimeOutdated(): boolean {
  return isOutdated
}

function shortName(tool: string): string {
  return tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '').slice(0, 40)
}

async function report($: Engine, what: Report): Promise<void> {
  if (!link) return
  const key = JSON.stringify([what.phase, what.id ?? null, what.detail ?? '', what.source ?? 'claude'])
  if (key === lastReport && what.preview === undefined) return
  lastReport = key
  const reply = await request($, link, 'POST', '/v1/activity', what)
  if (!reply.ok && reply.status === 0) link = null
}

async function submitPrompt($: Engine, queued: QueuedPrompt): Promise<void> {
  const prompt = { ...queued, text: composePrompt(queued) }
  pending.push(prompt)
  try {
    // Resolves once the turn starts, which may be a while if Claude is busy:
    // it is deliberately not awaited by the caller, so asking for new prompts goes on.
    await $.prompt.submit({ text: prompt.text, asUser: true })
  } catch {
    pending = pending.filter(p => p.id !== prompt.id)
    await report($, {
      phase: 'error',
      id: prompt.id,
      source: 'bot',
      detail: 'Claude Code did not accept the prompt',
      preview: { text: 'Claude Code did not accept that prompt. Try again in a moment.', isError: true },
    })
  }
}

/** Called about once a second: picks up what the bot has queued and keeps the two copies of the settings together. */
export async function pump($: Engine): Promise<void> {
  if (!link) {
    // No companion known: look for one. With none running this is one failed file read.
    link = await connect($)
    if (!link) return
    await syncConfig($, link)
  }
  const reply = await request<ClaimReply>($, link, 'POST', '/v1/prompts/claim', {})
  if (!reply.ok) {
    // A companion from before the prompt queue has no such route.
    isOutdated = reply.status === 404
    link = null
    return
  }
  isOutdated = reply.data.version < MIN_RUNTIME_VERSION
  for (const prompt of reply.data.prompts) void submitPrompt($, prompt)
  if (reply.data.revision !== (await loadConfig($)).revision) await syncConfig($, link)
}

/** A turn of the main conversation began. If it is a prompt the bot sent, it is tracked as that one. */
export async function turnStarted($: Engine, e: { text: string; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined) return
  toolsRunning = 0
  const text = e.text.trim()
  const index = pending.findIndex(p => p.text === text || text.includes(p.text))
  current = index >= 0 ? (pending.splice(index, 1)[0] ?? null) : null
  await report($, { phase: 'thinking', id: current?.id ?? null, source: current ? 'bot' : 'claude' })
}

export async function toolStarted($: Engine, tool: string): Promise<void> {
  toolsRunning += 1
  await report($, { phase: 'working', id: current?.id ?? null, source: current ? 'bot' : 'claude', detail: shortName(tool) })
}

export async function toolFinished($: Engine): Promise<void> {
  toolsRunning = Math.max(0, toolsRunning - 1)
  if (toolsRunning === 0) await report($, { phase: 'thinking', id: current?.id ?? null, source: current ? 'bot' : 'claude' })
}

export async function turnEnded($: Engine, e: { answer: string; reason: string; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined) return
  const mine = current
  current = null
  toolsRunning = 0
  const phase: Phase = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'idle' : 'error'
  const answer = e.answer.trim()
  const preview = mine
    ? { text: phase === 'error' ? 'Claude Code could not finish that.' : answer, isError: phase === 'error' }
    : undefined
  await report($, { phase, id: mine?.id ?? null, source: mine ? 'bot' : 'claude', preview })
}
