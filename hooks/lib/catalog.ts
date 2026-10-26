// The slash commands the floating bot offers when `/` is typed in its panel: the list Claude Code
// reports (built-ins, plugins, skills, MCP prompts) plus the `/mini-bot` subcommands, minus the
// ones the bot never runs. The overlay only shows and searches this list; running a command is
// slash.ts, and is limited by the same BLOCKED set, so nothing is offered that would be refused.

import type { CommandInfo } from 'claude-code'

// Commands the bot does not run, because the floating bot promises never to change these: Claude
// Code's permission rules, the model and effort, the sign-in, and the session itself.
export const BLOCKED = new Set(['permissions', 'allowed-tools', 'model', 'effort', 'config', 'hooks', 'login', 'logout', 'exit', 'quit'])

export type CatalogEntry = {
  name: string
  description: string
  source: CommandInfo['source'] | 'bot'
  /** Needs something typed after it, so choosing it completes the name and waits instead of running it bare. */
  takesArgs?: true
}

// `/mini-bot` subcommands that do their work without a menu, so they work fully from the bot.
const OWN: CatalogEntry[] = [
  { name: 'mini-bot hide', description: 'Hide the floating character', source: 'bot' },
  { name: 'mini-bot show', description: 'Show the floating character', source: 'bot' },
  { name: 'mini-bot toggle', description: 'Hide or show the character', source: 'bot' },
  { name: 'mini-bot status', description: 'What is running, which bot, which access is in use', source: 'bot' },
  { name: 'mini-bot settings list', description: 'List every setting and its value', source: 'bot' },
  { name: 'mini-bot set', description: 'Change a setting, e.g. set opacity 70', source: 'bot', takesArgs: true },
  { name: 'mini-bot permissions status', description: 'See which access is granted', source: 'bot' },
  { name: 'mini-bot permissions revoke all', description: 'End all screen, microphone and computer access', source: 'bot' },
  { name: 'mini-bot screenshot', description: 'Snip part of the screen and ask Claude about it', source: 'bot' },
  { name: 'mini-bot speech', description: 'Which speech recognizer is in use', source: 'bot' },
  { name: 'mini-bot update', description: 'Is a newer version out on GitHub', source: 'bot' },
  { name: 'mini-bot bot list', description: 'List your bots', source: 'bot' },
  { name: 'mini-bot switch', description: 'Change to another bot', source: 'bot', takesArgs: true },
  { name: 'mini-bot create', description: 'Make a new bot', source: 'bot', takesArgs: true },
  { name: 'mini-bot help', description: 'Every /mini-bot command', source: 'bot' },
]

/** The list for the picker, in the order Claude Code's own typeahead lists it, with the bot's subcommands after `/mini-bot`. */
export function buildCatalog(commands: readonly CommandInfo[]): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  let hasOwn = false
  for (const c of commands) {
    if (BLOCKED.has(c.name.toLowerCase())) continue
    entries.push({ name: c.name, description: c.description, source: c.source })
    if (c.name === 'mini-bot') {
      entries.push(...OWN)
      hasOwn = true
    }
  }
  if (!hasOwn) entries.push(...OWN)
  return entries
}
