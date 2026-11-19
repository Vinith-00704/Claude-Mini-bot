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

import { buildCatalog } from './catalog'
import { connect, request, type Link } from './client'
import { configKey, loadConfig } from './config'
import { activeProfile } from './profiles'
import { effortLevel, friendlyModel } from './model-info'
import { syncConfig } from './lifecycle'
import { MIN_RUNTIME_VERSION, type Attachment, type Engine, type Phase, type Profile, type QueuedPrompt } from './types'

const DEFAULT_SCREENSHOT_ASK = 'Take a look at this screenshot.'
// Goes with a spoken prompt whose reply is read aloud, so Claude answers for the ear.
const SPOKEN_NOTE = '(Spoken to the Mini Bot. Your reply is read aloud, so answer in a sentence or two of plain speech, with no markdown, lists or code.)'
// A reply still being written is passed on to the bot each time it has grown by about this much.
const STREAM_STEP = 24
const MAX_STREAM = 20000

/**
 * How the bot on the screen talks, as a note that goes to Claude with what is sent from the bot. A neutral bot
 * with no notes adds nothing. It is about wording alone: it asks for nothing and changes no task.
 */
export function personaNote(profile: Profile): string {
  const tone = profile.personality.tone
  const notes = profile.personality.notes.replace(/\s+/g, ' ').trim()
  if (tone === 'neutral' && notes === '') return ''
  return `(You are answering as ${profile.name}, the person's Mini Bot${tone !== 'neutral' ? `, in a ${tone} tone` : ''}.${notes ? ` Its character: ${notes}${/[.!?]$/.test(notes) ? '' : '.'}` : ''} This is only about how the reply is worded: what you do, and what is true, stay the same.)`
}

/** What Claude is asked when something was attached and nothing was typed. */
function defaultAsk(images: number, files: Attachment[]): string {
  if (files.length === 0) return DEFAULT_SCREENSHOT_ASK
  if (images > 0 || files.length > 1) return 'Take a look at the attachments.'
  return files[0]!.type === 'file' && files[0]!.kind === 'folder' ? 'Take a look at this folder.' : 'Take a look at this file.'
}

function describe(a: Attachment): string {
  if (a.type === 'image') return `Screenshot from Mini Bot (an image file; open it with the Read tool): ${a.path}`
  if (a.kind === 'folder') return `Folder from Mini Bot (list what is inside it, then open what matters): ${a.path}`
  return a.direct
    ? `File from Mini Bot (open it with the Read tool): ${a.path}`
    : `File from Mini Bot (the Read tool may not open this type; use a command or script if you need what is inside): ${a.path}`
}

/**
 * The text Claude Code receives. A plugin's prompt cannot carry an image or a file itself, so
 * each is named by its path, which Claude opens with its own tools (under Claude Code's own
 * permission to read it): the bot passes the path on and never reads the file.
 */
export function composePrompt(prompt: Pick<QueuedPrompt, 'text' | 'attachments'>): string {
  const attachments = prompt.attachments ?? []
  if (attachments.length === 0) return prompt.text
  const images = attachments.filter(a => a.type === 'image').length
  const files = attachments.filter(a => a.type === 'file')
  const ask = prompt.text.trim() === '' ? defaultAsk(images, files) : prompt.text
  const ordered = [...attachments.filter(a => a.type === 'image'), ...files]
  return `${ask}\n\n${ordered.map(describe).join('\n')}`
}

type ClaimReply = { prompts: QueuedPrompt[]; abort?: boolean; revision: number; key?: string; version: number }
// After the copies of the settings were found to differ and were brought together, this many seconds pass before it is looked at again.
const DRIFT_REST_TICKS = 30

export type Report = {
  phase: Phase
  id?: string | null
  detail?: string
  source?: 'bot' | 'claude'
  preview?: { text: string; isError: boolean; partial?: boolean }
}

// Module state. It starts over if the mod reloads; the companion holds the truth.
let link: Link | null = null
let toolsRunning = 0
let lastReport = ''
let isOutdated = false
let pending: QueuedPrompt[] = []
let current: QueuedPrompt | null = null
// What the session runs on, as last reported to the companion (the model's short name and effort), and what a turn last showed.
let lastModelKey = ''
let knownModel = ''
let knownEffort: string | null = null
let sessionUnsupported = false
// The slash commands as last told to the companion, for the bot's `/` picker.
let lastCommandsKey = ''
let commandsUnsupported = false
// Who this session is, once known, and the main conversation's running turn, for when the person asks to stop it.
let me: { id: string; role: 'main' | 'terminal'; name: string } | null = null
let runningTurn: string | null = null
// What the bot was last told Claude Code is doing, and the reply of the bot's own turn as far as it has been written.
let shown: { phase: Phase; detail: string } = { phase: 'idle', detail: '' }
let streamText = ''
let streamSent = 0
let isStreaming = false
let driftRest = 0

/** Who this session is, as the companion tells sessions apart. Mini's own session was started with MINI_BOT_ROLE set. */
export async function identity($: Engine) {
  if (me) return me
  const role = (await $.env.get('MINI_BOT_ROLE')) === 'main' ? 'main' : 'terminal'
  const folder = (await $.session.cwd()).split(/[\\/]/).filter(Boolean).pop() ?? ''
  me = { id: await $.session.id(), role, name: role === 'main' ? 'Mini' : folder }
  return me
}

/** Whether a turn of the main conversation is running now. */
export function isTurnRunning(): boolean {
  return runningTurn !== null
}

/** True when the companion is too old to carry prompts, so `/mini-bot status` can say so. */
export function isRuntimeOutdated(): boolean {
  return isOutdated
}

// What the bot says while Claude uses the computer-control tools.
const CONTROL_LABELS: Record<string, string> = {
  computer_start: 'Asking to use your PC',
  computer_look: 'Looking at your screen',
  computer_act: 'Using your PC',
  computer_stop: 'Handing your PC back',
  screen_look: 'Looking at your screen',
  read_page: 'Reading the page',
  design_bot: 'Showing you the new bot',
  get_bot: 'Looking at your bots',
  show_on_screen: 'Showing you where',
  add_routine: 'Adding a routine',
  list_routines: 'Reading your routines',
  remove_routine: 'Removing a routine',
}

function shortName(tool: string): string {
  const name = tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
  return (tool.startsWith('mcp__mini-bot__') ? CONTROL_LABELS[name] : undefined) ?? name.slice(0, 40)
}

export async function report($: Engine, what: Report): Promise<void> {
  if (!link) return
  const key = JSON.stringify([what.phase, what.id ?? null, what.detail ?? '', what.source ?? 'claude'])
  if (key === lastReport && what.preview === undefined) return
  lastReport = key
  shown = { phase: what.phase, detail: what.detail ?? '' }
  const reply = await request($, link, 'POST', '/v1/activity', { ...what, session: me?.id })
  if (!reply.ok && reply.status === 0) link = null
}

export async function submitPrompt($: Engine, queued: QueuedPrompt): Promise<void> {
  const prompt = { ...queued, text: composePrompt(queued) }
  // The notes go with what is sent; the prompt is recognized by what the person said.
  const config = await loadConfig($)
  const notes = [personaNote(activeProfile(config)), queued.source === 'voice' && config.live.speak !== 'off' ? SPOKEN_NOTE : ''].filter(note => note !== '')
  pending.push(prompt)
  try {
    // Resolves once the turn starts, which may be a while if Claude is busy:
    // it is deliberately not awaited by the caller, so asking for new prompts goes on.
    await $.prompt.submit({ text: [prompt.text, ...notes].join('\n\n'), asUser: true })
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

/**
 * Called about once a second: picks up what the bot has queued and keeps the two copies of the settings together.
 * What it picks up is returned for the caller to act on (a command, or a prompt for Claude).
 */
export async function pump($: Engine): Promise<QueuedPrompt[]> {
  if (!link) {
    // No companion known: look for one. With none running this is one failed file read.
    link = await connect($)
    if (!link) return []
    await syncConfig($, link)
    // A companion that has just come up knows nothing about the session yet.
    lastModelKey = ''
    sessionUnsupported = false
    lastCommandsKey = ''
    commandsUnsupported = false
    await modelCheck($)
    await commandCheck($)
  }
  const reply = await request<ClaimReply>($, link, 'POST', '/v1/prompts/claim', { bridge: await identity($) })
  if (!reply.ok) {
    // A companion from before the prompt queue has no such route.
    isOutdated = reply.status === 404
    link = null
    return []
  }
  isOutdated = reply.data.version < MIN_RUNTIME_VERSION
  if (reply.data.abort && runningTurn) {
    const turnId = runningTurn
    runningTurn = null
    try {
      await $.turn.abort({ turnId })
    } catch {
      // It had just ended by itself.
    }
    // A turn cut this way reports nothing more about itself, so the bot is told here.
    const id = current?.id ?? null
    const source = current ? 'bot' : 'claude'
    current = null
    toolsRunning = 0
    await report($, { phase: 'idle', id, source, detail: '' })
  }
  try {
    const local = await loadConfig($)
    if (driftRest > 0) driftRest -= 1
    if (reply.data.revision !== local.revision) await syncConfig($, link)
    else if (driftRest === 0 && reply.data.key !== undefined && reply.data.key !== configKey(local)) {
      // The same revision and not the same settings: another session wrote the shared copy back without something. The companion's copy is taken.
      driftRest = DRIFT_REST_TICKS
      await syncConfig($, link)
    }
  } catch {
    // The prompts are already claimed: a failed sync is tried again next second, and must not lose them.
  }
  return reply.data.prompts
}

/** A turn of the main conversation began. If it is a prompt the bot sent, it is tracked as that one. */
export async function turnStarted($: Engine, e: { text: string; turnId: string; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined) return
  runningTurn = e.turnId
  toolsRunning = 0
  streamText = ''
  streamSent = 0
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
  runningTurn = null
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

/**
 * A piece of the reply has arrived. For a turn the bot itself started, what has been written so far is passed on,
 * so the panel shows the reply growing as Claude Code's own window would. Any other turn's text stays where it is.
 */
export function replyPiece($: Engine, e: { agentId?: string }, piece: { kind?: string; text?: string }): void {
  if (!current || !link || e.agentId !== undefined || piece.kind !== 'text' || typeof piece.text !== 'string') return
  streamText += piece.text
  if (isStreaming || streamText.length - streamSent < STREAM_STEP || streamText.trim() === '') return
  void sendStream($).catch(() => {})
}

async function sendStream($: Engine): Promise<void> {
  const mine = current
  if (!mine || !link) return
  isStreaming = true
  try {
    streamSent = streamText.length
    const reply = await request($, link, 'POST', '/v1/activity', {
      phase: shown.phase === 'working' ? 'working' : 'thinking',
      id: mine.id,
      source: 'bot',
      detail: shown.phase === 'working' ? shown.detail : '',
      preview: { text: streamText.trim().slice(0, MAX_STREAM), isError: false, partial: true },
      session: me?.id,
    })
    if (!reply.ok && reply.status === 0) link = null
  } finally {
    isStreaming = false
  }
}

/** Tells the companion which model the session runs on and at what effort, when that is not what it was last told. */
async function publishModel($: Engine, id: string, effort: string | null): Promise<void> {
  if (!link || sessionUnsupported || id === '') return
  const name = friendlyModel(id)
  const key = `${name}|${effort ?? ''}`
  if (key === lastModelKey) return
  lastModelKey = key
  const reply = await request($, link, 'POST', '/v1/session', { model: id, name, effort, session: me?.id })
  if (reply.ok) return
  if (reply.status === 0) link = null
  // A companion from before this existed has no such route: say nothing more to it.
  else if (reply.status === 404) sessionUnsupported = true
  else lastModelKey = ''
}

/**
 * A request of the main conversation is about to go out: the model and effort it names are what the session
 * runs on right now. A subagent's requests are its own business and are not shown.
 */
export async function stepStarted($: Engine, e: { model: string; effort?: unknown; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined) return
  // Each request of a turn writes its own text: what the last one said (before its tools ran) makes way for it.
  streamText = ''
  streamSent = 0
  knownModel = friendlyModel(e.model)
  knownEffort = effortLevel(e.effort)
  await publishModel($, e.model, knownEffort)
}

/**
 * Between requests, as a model is chosen with /model: ask the session which model it runs on. The effort is
 * only known from a request, so after a change it is left out until the next one.
 */
export async function modelCheck($: Engine): Promise<void> {
  if (!link) return
  const id = await $.session.model()
  if (typeof id !== 'string' || id === '') return
  const name = friendlyModel(id)
  // The session may name a model by an alias that a request resolves to a full id; the same model is not a change.
  if (knownModel !== '' && !/\d/.test(name) && knownModel.toLowerCase().startsWith(name.toLowerCase())) return
  await publishModel($, id, name === knownModel ? knownEffort : null)
}

/**
 * Tells the companion which slash commands exist, for the bot's `/` picker, when that is not what it was last told.
 * Commands come and go (a plugin is installed, a skill is added), so this is checked now and then, not just once.
 */
export async function commandCheck($: Engine): Promise<void> {
  if (!link || commandsUnsupported) return
  const entries = buildCatalog(await $.command.list(), (await identity($)).role === 'main')
  const key = JSON.stringify(entries)
  if (key === lastCommandsKey) return
  lastCommandsKey = key
  const reply = await request($, link, 'POST', '/v1/commands', { commands: entries, session: me?.id })
  if (reply.ok) return
  if (reply.status === 0) link = null
  // A companion from before this existed has no such route: say nothing more to it.
  else if (reply.status === 404) commandsUnsupported = true
  else lastCommandsKey = ''
}
