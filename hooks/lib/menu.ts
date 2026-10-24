// The /mini-bot menu: five choices, shown four at a time because the question
// dialog takes at most four options.

import { botMenu } from './bot-menu'
import { getState } from './client'
import { loadConfig } from './config'
import { startRuntime, stopRuntime } from './lifecycle'
import { permissionsMenu } from './permissions-menu'
import { activeProfile } from './profiles'
import { pick } from './prompts'
import { settingsMenu } from './settings-menu'
import { toggleVisible } from './visibility'
import type { Engine } from './types'

type Choice = 'visibility' | 'settings' | 'permissions' | 'bot' | 'power'

const ITEMS: { label: string; value: Choice }[] = [
  { label: 'Hide / Unhide', value: 'visibility' },
  { label: 'Settings', value: 'settings' },
  { label: 'Permissions', value: 'permissions' },
  { label: 'Change Bot', value: 'bot' },
  { label: 'Start / Stop', value: 'power' },
]

export async function mainMenu($: Engine): Promise<string> {
  for (;;) {
    const [config, state] = await Promise.all([loadConfig($), getState($)])
    const shown = state ? state.overlay.visible : config.visible
    const where = `${activeProfile(config).name} · ${state ? 'running' : 'stopped'} · ${shown ? 'visible' : 'hidden'}`
    const picked = await pick($, `Mini Bot (${where}). What would you like to do?`, ITEMS, 'Mini Bot')
    if (!picked) return 'Menu closed. /mini-bot help lists the typed commands.'
    if ('typed' in picked) continue

    switch (picked.value) {
      case 'visibility':
        return toggleVisible($)
      case 'power':
        return (state ? await stopRuntime($) : await startRuntime($)).message
      case 'settings':
        await settingsMenu($)
        break
      case 'permissions':
        await permissionsMenu($)
        break
      case 'bot':
        await botMenu($)
        break
    }
  }
}
