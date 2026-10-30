// What the companion itself may use: the screen, the microphone and computer
// control. This is separate from Claude Code's own permissions, which are not
// read or changed here.
//
// Granting always goes through a dialog the person answers. The runtime
// refuses a grant that does not say it was confirmed, and keeps every grant
// only for as long as it runs.

import { connect, request } from './client'
import { confirm } from './prompts'
import { KINDS, type Engine, type Kind, type RuntimeState } from './types'

export const LABELS: Record<Kind, string> = {
  screen: 'Screen',
  microphone: 'Microphone',
  computer: 'Computer control',
}

const WHAT: Record<Kind, string> = {
  screen: 'see your screen',
  microphone: 'listen through your microphone',
  computer: 'control your computer (mouse and keyboard)',
}

export const parseKind = (word: string): Kind | undefined => {
  const w = word.trim().toLowerCase()
  if (w === 'mic') return 'microphone'
  if (w === 'computer-control' || w === 'control') return 'computer'
  return KINDS.find(k => k === w)
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export const describeAccess = (state: RuntimeState | null): string[] => {
  if (!state) return KINDS.map(k => `${LABELS[k]}: not granted (Mini Bot is not running)`)
  return KINDS.map(kind => {
    const a = state.permissions[kind]
    if (a.active) return `${LABELS[kind]}: ACTIVE since ${clock(a.activeSince ?? 0)}`
    return `${LABELS[kind]}: ${a.granted ? 'granted, not in use' : 'not granted'}`
  })
}

const needRuntime = 'Mini Bot is not running, so nothing is granted. Start it first: /mini-bot start.'

export async function grantAccess($: Engine, kind: Kind): Promise<string> {
  // Computer control is never granted ahead: each task is allowed on its own, in the bot, when Claude asks.
  if (kind === 'computer') {
    return 'Computer control is allowed one task at a time: when Claude asks, the bot shows what it wants to do and in which apps, and you answer there. There is nothing to grant ahead. /mini-bot control stop ends it at any time.'
  }
  const link = await connect($)
  if (!link) return needRuntime
  const ok = await confirm(
    $,
    `Let Mini Bot ${WHAT[kind]}? Its indicator stays visible while ${LABELS[kind].toLowerCase()} is in use, and this lasts until you revoke it or stop Mini Bot. It does not change Claude Code's own permissions.`,
    `Allow ${LABELS[kind].toLowerCase()}`,
    'Not now',
    'Permission',
  )
  if (ok === undefined) return 'Needs someone at the prompt to approve, so nothing was granted.'
  if (!ok) return `${LABELS[kind]} access was not granted.`
  const reply = await request($, link, 'POST', `/v1/permissions/${kind}/grant`, { confirmed: true })
  return reply.ok ? `${LABELS[kind]} access granted until you revoke it or stop Mini Bot.` : `Could not grant: ${reply.error}.`
}

export async function revokeAccess($: Engine, kind: Kind): Promise<string> {
  const link = await connect($)
  if (!link) return 'Mini Bot is not running, so nothing is granted.'
  const reply = await request($, link, 'POST', `/v1/permissions/${kind}/revoke`, {})
  return reply.ok ? `${LABELS[kind]} access revoked and any capture stopped.` : `Could not revoke: ${reply.error}.`
}

export async function revokeAll($: Engine): Promise<string> {
  const link = await connect($)
  if (!link) return 'Mini Bot is not running, so nothing is granted.'
  for (const kind of KINDS) await request($, link, 'POST', `/v1/permissions/${kind}/revoke`, {})
  return 'All Mini Bot access revoked and every capture stopped.'
}
