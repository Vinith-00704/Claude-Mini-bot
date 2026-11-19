// Slash commands typed into the floating bot: Claude Code's own (`/compact`, `/cost`, a plugin's, a
// skill's) and `/mini-bot ...`. They are run as the person typing them in Claude Code would run them,
// and what they print comes back to the bot's panel, so the bot is not asked a question it cannot answer.
//
// Only text the person typed is taken for a command. A spoken sentence is never one, so a misheard
// word cannot run anything, and a prompt with attachments is always a prompt. Anything else that
// begins with a slash (a path, an unknown name) is refused with a note, because Claude Code would
// read it as a command too.

import { isMainSession } from './assistant'
import { isTurnRunning, report, submitPrompt } from './bridge'
import { isBlocked } from './catalog'
import { connect, request } from './client'
import { runCommand } from './commands'
import type { Engine, QueuedPrompt } from './types'

/** `/name rest of the line`, or null when the text is not shaped like a command. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? { name: match[1]!.toLowerCase(), args: (match[2] ?? '').trim() } : null
}

async function finish($: Engine, prompt: QueuedPrompt, text: string, isError = false): Promise<void> {
  await report($, { phase: isError ? 'error' : 'completed', id: prompt.id, source: 'bot', preview: { text, isError } })
}

// A command that has shown nothing for this long has most likely opened something to choose from.
const PICKER_WAIT_MS = 2500

/**
 * A command typed into the bot can open something to choose from (a picker, a panel), which Claude Code draws in its own
 * window and not here. In Mini's own session nobody is looking at that window, so the bot is asked to bring it up
 * beside itself. A command that started a turn (a skill) has opened nothing.
 */
async function showItsWindow($: Engine): Promise<void> {
  if (isTurnRunning()) return
  const link = await connect($)
  if (link) await request($, link, 'POST', '/v1/overlay/request', { action: 'terminal' })
}

/** Runs the prompt as a command if it is one, and says whether it was; false means send it to Claude as usual. */
async function slashCommand($: Engine, prompt: QueuedPrompt): Promise<boolean> {
  if (prompt.source !== 'text' || (prompt.attachments?.length ?? 0) > 0) return false
  const parsed = parseSlash(prompt.text)
  if (!parsed) return false
  const { name, args } = parsed

  const isMain = await isMainSession($)
  if (isBlocked(name, isMain)) {
    await finish($, prompt, `/${name} changes something the bot never touches. Run it in Claude Code itself.`, true)
    return true
  }
  // `/mini-bot` is this plugin's own command: Claude Code would not route a call from here back to it.
  const own = name === 'mini-bot'
  if (!own && !(await $.command.list()).some(c => c.name.toLowerCase() === name)) return false

  await report($, { phase: 'working', id: prompt.id, source: 'bot', detail: '/' + name })
  let isSettled = false
  const waiting = !own && isMain ? $.clock.after(PICKER_WAIT_MS, () => (isSettled ? undefined : void showItsWindow($).catch(() => {}))) : null
  try {
    const text = own ? await runCommand($, args) : (await $.command.run({ command: name, args })).text
    isSettled = true
    const said = text?.trim() ?? ''
    // Nothing printed: it showed a panel, or it was a prompt for Claude. The first is in its window, which comes up.
    if (said === '' && !own && isMain) $.clock.after(600, () => void showItsWindow($).catch(() => {}))
    await finish($, prompt, said || (isMain && !own ? `/${name} ran. If it opened something to choose from, that is in Claude Code's own window, beside the bot.` : `/${name} ran. Anything it opened or printed is in Claude Code.`))
  } catch {
    await finish($, prompt, `/${name} could not run right now. Try again in a moment.`, true)
  } finally {
    isSettled = true
    waiting?.cancel()
  }
  return true
}

/** What the bot has queued, one prompt: a command is run, anything else goes to Claude as an ordinary prompt. */
export async function dispatchPrompt($: Engine, queued: QueuedPrompt): Promise<void> {
  if (await slashCommand($, queued)) return
  // Claude Code reads a submitted prompt that begins with a slash as a command, whatever the bot decided, so
  // such a prompt (a path, a spoken slash) is not sent: it would run something, or nothing, instead of reaching Claude.
  if (queued.text.trim().startsWith('/')) {
    await finish($, queued, 'That starts with a slash, so Claude Code would take it for a command, and it is not one the bot can run. Start with a word to send it as a prompt.', true)
    return
  }
  await submitPrompt($, queued)
}
