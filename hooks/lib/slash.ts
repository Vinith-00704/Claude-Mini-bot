// Slash commands typed into the floating bot: Claude Code's own (`/compact`, `/cost`, a plugin's, a
// skill's) and `/mini-bot ...`. They are run as the person typing them in Claude Code would run them,
// and what they print comes back to the bot's panel, so the bot is not asked a question it cannot answer.
//
// Only text the person typed is taken for a command. A spoken sentence is never one, so a misheard
// word cannot run anything, and a prompt with attachments is always a prompt. Anything else that
// begins with a slash (a path, an unknown name) is refused with a note, because Claude Code would
// read it as a command too.

import { report, submitPrompt } from './bridge'
import { BLOCKED } from './catalog'
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

/** Runs the prompt as a command if it is one, and says whether it was; false means send it to Claude as usual. */
async function slashCommand($: Engine, prompt: QueuedPrompt): Promise<boolean> {
  if (prompt.source !== 'text' || (prompt.attachments?.length ?? 0) > 0) return false
  const parsed = parseSlash(prompt.text)
  if (!parsed) return false
  const { name, args } = parsed

  if (BLOCKED.has(name)) {
    await finish($, prompt, `/${name} changes something the bot never touches. Run it in Claude Code itself.`, true)
    return true
  }
  // `/mini-bot` is this plugin's own command: Claude Code would not route a call from here back to it.
  const own = name === 'mini-bot'
  if (!own && !(await $.command.list()).some(c => c.name.toLowerCase() === name)) return false

  await report($, { phase: 'working', id: prompt.id, source: 'bot', detail: '/' + name })
  try {
    const text = own ? await runCommand($, args) : (await $.command.run({ command: name, args })).text
    await finish($, prompt, text?.trim() || `/${name} ran. Anything it opened or printed is in Claude Code.`)
  } catch {
    await finish($, prompt, `/${name} could not run right now. Try again in a moment.`, true)
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
