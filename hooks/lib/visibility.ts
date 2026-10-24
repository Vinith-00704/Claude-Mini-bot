// Hiding and showing the character. Only the character: the runtime keeps
// running, Claude Code stays connected, and an active capture indicator is not
// the character's to hide (the runtime keeps showing it either way).

import { connect, request } from './client'
import { loadConfig } from './config'
import { adoptRuntimeConfig, commit } from './lifecycle'
import type { Engine, RuntimeState } from './types'

export async function setVisible($: Engine, visible: boolean): Promise<string> {
  const link = await connect($)
  if (!link) {
    // Saved now and sent when the companion starts.
    await commit($, { ...(await loadConfig($)), visible })
    return visible
      ? 'Mini Bot will be shown when it starts. It is not running now: /mini-bot start.'
      : 'Mini Bot will start hidden. It is not running now.'
  }
  const reply = await request<RuntimeState>($, link, 'POST', '/v1/visibility', { visible })
  if (!reply.ok) return `Could not change visibility: ${reply.error}.`
  await adoptRuntimeConfig($, reply.data)
  if (visible) return 'Mini Bot is back where you left it.'
  const watching = reply.data.indicator.visible
  return `Mini Bot is hidden and still connected. /mini-bot show brings it back.${watching ? ` The access indicator stays on while ${reply.data.indicator.kinds.join(' and ')} is in use.` : ''}`
}

export async function toggleVisible($: Engine): Promise<string> {
  const link = await connect($)
  const state = link ? await request<RuntimeState>($, link, 'GET', '/v1/state') : null
  const isShown = state?.ok ? state.data.overlay.visible : (await loadConfig($)).visible
  return setVisible($, !isShown)
}
