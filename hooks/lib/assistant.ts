// Mini as an always-on assistant, from Claude Code's side: the commands for its own background session, starting
// with the PC, listening for its name, full access and routines, and asking the person in the bot what Claude Code
// would otherwise ask at a terminal nobody is sitting at.
//
// Turning on listening or full access only puts a question up in the bot. The person's click there is what turns it
// on, and nothing here can answer for them.

import { connect, dataDir, getState, request, type Link } from './client'
import { describeRoutine } from './computer'
import { adoptRuntimeConfig, startRuntime } from './lifecycle'
import type { Engine, RuntimeState } from './types'

const MIN_VERSION = 5
/** The first companion that reads pages, shows a designed bot and opens Claude Code's own window. */
const MIN_PAGE_VERSION = 6
const SUBMIT_AFTER_MS = 250
const POLL_MS = 4000
const PERMISSION_WAIT_MS = 5 * 60 * 1000
const OLD = 'The Mini Bot running now is older and cannot do that: /mini-bot stop, then /mini-bot start.'
const OFF = 'Mini Bot is not running: /mini-bot on.'

let mainRole: boolean | null = null

/** Whether this is Mini's own session, started by the companion. */
export async function isMainSession($: Engine): Promise<boolean> {
  if (mainRole === null) mainRole = (await $.env.get('MINI_BOT_ROLE')) === 'main'
  return mainRole
}

/** Whether the person turned Mini off, so a new Claude Code session leaves it off. */
export async function wasTurnedOff($: Engine): Promise<boolean> {
  try {
    await $.fs.read(`${await dataDir($)}/turned-off`)
    return true
  } catch {
    return false
  }
}

const shorten = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** What a tool call would do, in the words of the question in the bot. */
function describeCall(tool: string, input: unknown): string {
  const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const name = tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
  if (typeof args.command === 'string') return `run this command:\n${shorten(args.command, 300)}`
  if (typeof args.file_path === 'string') return `use ${name} on ${shorten(args.file_path, 200)}`
  if (typeof args.url === 'string') return `use ${name} on ${shorten(args.url, 200)}`
  const summary = JSON.stringify(args)
  return `use ${name}${summary && summary !== '{}' ? `: ${shorten(summary, 240)}` : ''}`
}

type Decision = { behavior: 'allow' } | { behavior: 'deny'; message: string }

// Words that delete, add or change things on the PC. Matching too much only costs a question in the bot; matching
// too little is the risk, which is why the list is wide. It is a safety net for a session with full access, not a wall.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const DELETES = /(?:^|[\s;&|(])(?:rm|rmdir|rd|del|erase|unlink|shred|remove-item|ri|clear-content|remove-itemproperty|format-volume|diskpart|stop-computer|restart-computer|shutdown|reg\s+delete|git\s+clean|git\s+reset\s+--hard|git\s+push\b[^\n]*--force)(?=$|[\s;&|)])/i
const CHANGES = /(?:^|[\s;&|(])(?:mkdir|md|new-item|ni|copy-item|cp|copy|xcopy|robocopy|move-item|mv|move|ren|rename-item|rni|set-content|add-content|out-file|tee|tee-object|touch|expand-archive|unzip|tar|invoke-webrequest|iwr|invoke-restmethod|curl|wget|winget|choco|scoop|msiexec|npm\s+(?:i|install|uninstall|rm)|pip3?\s+(?:install|uninstall)|reg\s+add|schtasks|setx|set-itemproperty|new-itemproperty|stop-process|taskkill|git\s+(?:checkout|restore|rebase|commit|push|merge))(?=$|[\s;&|)])/i
const REDIRECT = /(?:^|[^0-9&>\w])>>?(?!\s*(?:&|\$null|\/dev\/null|nul\b))/

/** What a call would do that the person must agree to even with full access, or null if nothing like that. */
export function riskOf(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'Write') return 'write a file'
  if (!SHELL_TOOLS.has(tool) || typeof input.command !== 'string') return null
  if (DELETES.test(input.command)) return 'delete things or cannot be undone'
  if (CHANGES.test(input.command) || REDIRECT.test(input.command)) return 'add, move or change files, programs or settings'
  return null
}

/**
 * With full access on, Mini's own session still asks before it deletes, adds or changes files, programs or settings.
 * Returns a refusal, or null when it may go on. A session without full access is left to Claude Code's own permissions.
 */
export async function guardFullAccess($: Engine, input: Record<string, unknown>, signal: AbortSignal): Promise<{ deny: string } | null> {
  const why = riskOf(String(input.tool), input)
  if (!why) return null
  if (!(await isMainSession($))) return null
  const state = await getState($)
  if (!state?.trust?.full) return null
  const answer = await answerPermission($, { tool_name: String(input.tool), tool_input: input }, signal, `Full access is on, and this may ${why}. Claude wants to`)
  return answer.decision.behavior === 'allow' ? null : { deny: answer.decision.message }
}

/** Asks the person in the bot. Claude Code carries on when they answer, and takes no answer as no. */
export async function answerPermission($: Engine, e: { tool_name: string; tool_input: unknown }, signal: AbortSignal, lead = 'Claude Code asks to'): Promise<{ decision: Decision }> {
  const refuse = (message: string) => ({ decision: { behavior: 'deny' as const, message } })
  const link = await connect($)
  if (!link) return refuse('The Mini Bot is not running, so nobody could be asked. Tell the person what you wanted to do.')
  const asked = await request<{ ticket: string }>($, link, 'POST', '/v1/cards/ask', {
    kind: 'permission',
    text: `${lead} ${describeCall(e.tool_name, e.tool_input)}`,
    options: [{ id: 'allow', label: 'Allow', primary: true }, { id: 'deny', label: 'Deny' }],
    waitMs: PERMISSION_WAIT_MS,
  })
  if (!asked.ok) return refuse('The person could not be asked. Tell them what you wanted to do.')
  for (;;) {
    if (signal.aborted) return refuse('Interrupted.')
    const reply = await request<{ done: boolean; choice?: string }>($, link, 'GET', `/v1/cards/ticket?id=${encodeURIComponent(asked.data.ticket)}&wait=${POLL_MS}`)
    if (!reply.ok) return refuse('The Mini Bot stopped answering. Tell the person what you wanted to do.')
    if (!reply.data.done) continue
    if (reply.data.choice === 'allow') return { decision: { behavior: 'allow' } }
    return refuse(reply.data.choice === 'timeout' ? 'The person did not answer in the bot. Tell them what you wanted to do.' : 'The person said no in the bot. Do not try another way around it; ask them what they want.')
  }
}

/** A running companion new enough for these commands, or what to say instead. */
async function linkFor($: Engine, oldest = MIN_VERSION): Promise<{ link: Link } | { message: string }> {
  const link = await connect($)
  if (!link) return { message: OFF }
  const health = await request<{ version: number }>($, link, 'GET', '/v1/health')
  if (health.ok && health.data.version < oldest) return { message: OLD }
  return { link }
}

/**
 * /mini-bot summarize [what to look for]: the page in front is read and handed to Claude with the request. Typed as a
 * command, the reading takes the person's yes in the bot (unless they gave full access); the summary comes up in the bot.
 */
export async function summarizeCommand($: Engine, args: string[]): Promise<string> {
  const found = await linkFor($, MIN_PAGE_VERSION)
  if ('message' in found) return found.message
  const asked = await request<{ ticket: string }>($, found.link, 'POST', '/v1/page/summarize', { focus: args.join(' ') })
  if (!asked.ok) return `Could not read the page: ${asked.error}.`
  // A moment, in case it is quick: a page that needs no yes is read in a second or two.
  const reply = await request<{ done: boolean; ok?: boolean; error?: string; title?: string; unreadable?: boolean }>($, found.link, 'GET', `/v1/computer/ticket?id=${encodeURIComponent(asked.data.ticket)}&wait=${POLL_MS}`)
  if (reply.ok && reply.data.done) {
    if (reply.data.ok) return `Claude is reading "${reply.data.title ?? 'the page'}". The summary comes up in the bot.`
    return reply.data.unreadable
      ? `${reply.data.error ?? 'That window could not be read as text.'} Send Claude a picture of it instead: the look key, or /mini-bot screenshot.`
      : `Not summarized: ${reply.data.error ?? 'the page could not be read'}`
  }
  return 'Answer in the bot: it asks whether Claude may read the page in front. The summary comes up there.'
}

/** Starts a turn with this prompt once the command that asked for it has returned: a command cannot start one while it is still running. */
function submitSoon($: Engine, text: string, tries = 8): void {
  $.clock.after(SUBMIT_AFTER_MS, () => void $.prompt.submit({ text, asUser: true }).catch(() => (tries > 1 ? submitSoon($, text, tries - 1) : undefined)))
}

/** /mini-bot design <what it should be>: Claude draws the bot and shows it beside the bot on the screen; nothing changes until the person says so there. */
export async function designCommand($: Engine, args: string[]): Promise<string> {
  const what = args.join(' ').trim()
  if (what === '') {
    return 'Say what the bot should be, for example: /mini-bot design a sleepy blue owl with round glasses, calm and brief. You can also just ask Claude: "make me a mini bot that looks like a fox".'
  }
  const found = await linkFor($, MIN_PAGE_VERSION)
  if ('message' in found) return found.message
  const text = `Design a Mini Bot for me: ${what}\n\n(Use the mini-bot:design-bot skill if you have it, then the design_bot tool, and show me the preview. Decide the details yourself rather than asking me first.)`
  submitSoon($, text)
  return 'Claude is designing it. A preview comes up beside the bot: press Use it there, or Try again.'
}

/** /mini-bot terminal: the real Claude Code of Mini's own session, in its own window beside the bot. */
export async function terminalCommand($: Engine): Promise<string> {
  const found = await linkFor($, MIN_PAGE_VERSION)
  if ('message' in found) return found.message
  const state = await getState($)
  if (!state?.assistant?.wanted) return "Mini has no Claude Code session of its own yet, so there is no window to open. /mini-bot assistant on starts one; then this opens it."
  const reply = await request($, found.link, 'POST', '/v1/overlay/request', { action: 'terminal' })
  if (!reply.ok) return `Could not open it: ${reply.error}.`
  const key = state.config.hotkey.terminal
  return `Claude Code's own window is coming up beside the bot. It is the real thing: every slash command, picker and its voice mode work in it.${key && key !== 'off' ? ` ${key} opens it and puts it away.` : ''}`
}

const STATUS: Record<string, string> = {
  starting: 'starting',
  running: 'running in the background',
  'needs-you': 'waiting for you in its window',
  failed: 'not running',
  off: 'not running',
}

/** The lines /mini-bot status adds. */
export function describeAssistant(state: RuntimeState | null): string[] {
  if (!state?.assistant) return []
  const lines = [
    `Mini's own Claude Code session: ${state.assistant.wanted ? STATUS[state.assistant.status] : 'off (/mini-bot assistant on)'}.${state.assistant.note ? ` ${state.assistant.note}` : ''}`,
    `Starts with your PC: ${state.assistant.startsWithPc ? 'yes' : 'no (/mini-bot autostart on)'}.`,
    `Listening for its name: ${state.trust?.listen ? 'on' : 'off (/mini-bot listen on)'}. Full access to the mouse and keyboard: ${state.trust?.full ? 'on' : 'off'}.`,
  ]
  if (state.assistant.wanted) lines.push(`Its instructions and notes are in ${state.assistant.home}: edit CLAUDE.md there to change how it behaves.`)
  const target = state.sessions?.find(s => s.target)
  if (target) lines.push(`The bot talks to: ${target.role === 'main' ? "Mini's own session" : `your session in ${target.name || 'a terminal'}`}${target.pinned ? ' (you chose it)' : ''}.`)
  if (state.routines) lines.push(`Routines: ${state.routines} (/mini-bot routines).`)
  return lines
}

function onOff(word: string | undefined): boolean | null {
  const w = word?.toLowerCase()
  return w === 'on' || w === 'yes' || w === 'true' ? true : w === 'off' || w === 'no' || w === 'false' ? false : null
}

export async function autostartCommand($: Engine, args: string[]): Promise<string> {
  const on = onOff(args[0])
  const found = await linkFor($)
  if (args.length > 0 && on === null) return 'Use: /mini-bot autostart [on | off]'
  if ('message' in found) return found.message
  if (on === null) {
    const state = await getState($)
    return state?.assistant?.startsWithPc ? 'Mini starts with your PC. /mini-bot autostart off stops that.' : 'Mini does not start with your PC. /mini-bot autostart on starts it when you sign in to Windows.'
  }
  const reply = await request<{ ok: boolean; message: string }>($, found.link, 'POST', '/v1/autostart', { on })
  return reply.ok ? reply.data.message : `Could not change it: ${reply.error}.`
}

export async function assistantCommand($: Engine, args: string[]): Promise<string> {
  const [verb] = args
  const on = onOff(verb)
  if (on === true) {
    // Asking for the session is also asking for the companion that keeps it.
    const started = await startRuntime($)
    if (!started.ok) return started.message
  }
  const found = await linkFor($)
  if ('message' in found) return found.message
  if (on !== null) {
    const reply = await request<RuntimeState>($, found.link, 'POST', '/v1/assistant', { on })
    if (!reply.ok) return `Could not change it: ${reply.error}.`
    await adoptRuntimeConfig($, reply.data)
    return on
      ? "Mini's own Claude Code session is starting in the background. The first time, its window opens so you can say yes to the folder it runs in. /mini-bot status says how it is doing."
      : "Mini's own session is closed. The bot now talks to whichever Claude Code session you have open."
  }
  if (verb === 'restart') {
    const reply = await request($, found.link, 'POST', '/v1/assistant', { restart: true })
    return reply.ok ? "Mini's own session is restarting, and picks up the same conversation." : `Could not restart it: ${reply.error}.`
  }
  if (verb === 'show') return terminalCommand($)
  if (verb !== undefined && verb !== 'status') return 'Use: /mini-bot assistant [on | off | restart | show | status]'
  return describeAssistant(await getState($)).join('\n') || OLD
}

async function trustCommand($: Engine, what: 'listen' | 'full', args: string[], words: { label: string; isOn: string; isOff: string; asked: string; off: string; use: string }): Promise<string> {
  const on = onOff(args[0])
  if (args.length > 0 && on === null) return words.use
  const found = await linkFor($)
  if ('message' in found) return found.message
  if (on === null) return (await getState($))?.trust?.[what] ? words.isOn : words.isOff
  const reply = await request<RuntimeState>($, found.link, 'POST', on ? '/v1/trust/ask' : '/v1/trust/off', { what })
  if (!reply.ok) return `Could not change ${words.label}: ${reply.error}.`
  if (!on) return words.off
  return reply.data.trust?.[what] ? words.isOn : words.asked
}

export async function listenCommand($: Engine, args: string[]): Promise<string> {
  return trustCommand($, 'listen', args, {
    label: 'listening',
    isOn: 'The bot is listening for its name. A small mark on your screen says so. /mini-bot listen off stops it.',
    isOff: 'The bot is not listening. /mini-bot listen on asks you in the bot.',
    asked: 'Answer in the bot: only your own click there turns this on.',
    off: 'The bot has stopped listening, and the microphone is closed.',
    use: 'Use: /mini-bot listen [on | off]',
  })
}

export async function fullAccessCommand($: Engine, args: string[]): Promise<string> {
  return trustCommand($, 'full', args, {
    label: 'full access',
    isOn: 'Claude has full access to your mouse and keyboard: any app (except the ones never controlled), and no question before an ordinary step. It still asks in the bot before anything important: sending, deleting, buying, and deleting, adding or changing files. /mini-bot full-access off takes it back.',
    isOff: 'Claude asks in the bot before it uses your mouse and keyboard. /mini-bot full-access on asks you, in the bot, whether to give full access.',
    asked: 'Answer in the bot: only your own click there turns this on.',
    off: 'Full access is off. Claude asks in the bot again, and anything it was doing with the mouse and keyboard has stopped.',
    use: 'Use: /mini-bot full-access [on | off]',
  })
}

type RoutineView = Parameters<typeof describeRoutine>[0]

export async function routinesCommand($: Engine, args: string[]): Promise<string> {
  const found = await linkFor($)
  if ('message' in found) return found.message
  if (args[0] === 'remove' || args[0] === 'delete') {
    const reply = await request<{ removed: RoutineView }>($, found.link, 'POST', '/v1/routines/remove', { which: args[1] ?? '' })
    return reply.ok ? `Removed: ${describeRoutine(reply.data.removed)}` : `Not removed: ${reply.error}. /mini-bot routines lists them.`
  }
  const reply = await request<{ routines: RoutineView[] }>($, found.link, 'GET', '/v1/routines')
  if (!reply.ok) return `Could not read them: ${reply.error}.`
  if (reply.data.routines.length === 0) return 'No reminders or routines yet. Ask Claude, or: /mini-bot remind "in 20 minutes" stretch'
  return [...reply.data.routines.map((r, i) => describeRoutine(r, i + 1)), '', '/mini-bot routines remove <number> removes one.'].join('\n')
}

export async function addRoutineCommand($: Engine, kind: 'say' | 'ask', args: string[]): Promise<string> {
  const [when, ...words] = args
  const text = words.join(' ').trim()
  const use = `Use: /mini-bot ${kind === 'say' ? 'remind' : 'routine'} "<when>" <text>, where when is "17:30", "in 20 minutes", "daily 09:00", "weekdays 18:30" or "mon,thu 08:15".`
  if (!when || !text) return use
  const found = await linkFor($)
  if ('message' in found) return found.message
  const reply = await request<{ routine?: RoutineView; ticket?: string }>($, found.link, 'POST', '/v1/routines', { kind, text, when })
  if (!reply.ok) return `Not added: ${reply.error}.`
  return reply.data.routine ? `Added: ${describeRoutine(reply.data.routine)}` : 'Answer in the bot to add it: it runs by itself, so it takes your yes there.'
}
