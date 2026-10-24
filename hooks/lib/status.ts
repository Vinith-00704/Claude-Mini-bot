// The status line entry. It says what the person must not lose track of: that
// the bot is hidden (and how to bring it back), and that screen, microphone or
// computer access is in use. It is drawn from the runtime's own report, so
// hiding the character cannot hide it.

import { getState } from './client'
import { loadConfig } from './config'
import { LABELS } from './permissions'
import type { Engine } from './types'

export async function refreshStatus($: Engine): Promise<void> {
  const state = await getState($)
  const isHidden = state ? !state.overlay.visible : !(await loadConfig($)).visible
  const parts: string[] = []
  if (state?.indicator.visible) parts.push(`${state.indicator.kinds.map(k => LABELS[k].toLowerCase()).join(' + ')} in use`)
  if (isHidden) parts.push('hidden (/mini-bot show)')
  $.ui.status(parts.length === 0 ? undefined : `Mini Bot: ${parts.join(' · ')}`)
}
