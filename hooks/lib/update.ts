// `/mini-bot update`: says which version is installed, whether GitHub has a newer one, and
// the two commands that install it.
//
// A plugin cannot replace itself while it is loaded, so this only checks and explains; the
// person runs the commands. The check is one plain GET of the repository's manifest, with
// nothing sent from this computer.

import type { Engine } from './types'

const REPO = 'Vinith-00704/Claude-Mini-bot'
const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/HEAD/.claude-plugin/plugin.json`   // HEAD: whatever the repository's default branch is

const STEPS = `To update, run these two commands in a terminal (or at the Claude Code prompt with ! in front, e.g. ! claude plugin update mini-bot):
  claude plugin marketplace update claude-mini-bot
  claude plugin update mini-bot
Then start a new Claude Code session (or /reload-plugins). If the bot is running, /mini-bot stop and /mini-bot start make it use the new version.`

/** True when `a` is a higher version than `b`; compares dotted numbers, ignoring any suffix. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.split('.').map(p => Number.parseInt(p, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

async function versionOf(read: () => Promise<unknown>): Promise<string | null> {
  try {
    const version = JSON.parse(String(await read())).version
    return typeof version === 'string' && /^\d+(\.\d+)*/.test(version) ? version : null
  } catch {
    return null
  }
}

export async function updateCommand($: Engine): Promise<string> {
  const installed = await versionOf(() => $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  const latest = await versionOf(async () => {
    const res = await $.http.fetch(MANIFEST_URL)
    if (!res.ok) throw new Error(`status ${res.status}`)
    return res.text
  })
  const have = installed ? `Mini Bot ${installed} is installed` : 'Mini Bot is installed'
  if (!latest) return `${have}. Could not check GitHub for a newer version (${REPO}).\n\n${STEPS}`
  if (installed && !isNewer(latest, installed)) return `${have} and up to date.`
  return `${have}; version ${latest} is available.\n\n${STEPS}`
}
