// Change Bot: choose, create, rename, customize and delete bot profiles.
//
// A profile is a look and a name. Changing it only changes what the overlay
// draws; the Claude Code session is not reset, replaced or even asked.

import { loadConfig } from './config'
import { commit } from './lifecycle'
import { PROFILE_GROUPS } from './fields'
import { createProfile, deleteProfile, MAX_PROFILES, renameProfile, selectProfile, type Result } from './profiles'
import { ask, confirm, pick } from './prompts'
import { settingsMenu } from './settings-menu'
import type { Config, Engine, Profile } from './types'

const describe = (config: Config, p: Profile) => `${p.name}${p.id === config.activeProfileId ? ' (active)' : ''}`

async function choose($: Engine, question: string, config: Config, header: string): Promise<Profile | undefined> {
  const picked = await pick(
    $,
    question,
    config.profiles.map(p => ({ label: describe(config, p), value: p })),
    header,
  )
  return picked && 'value' in picked ? picked.value : undefined
}

async function apply($: Engine, result: Result) {
  if ('error' in result) return $.ui.log(result.error)
  await commit($, result.config)
  $.ui.log(result.message)
}

export async function createBot($: Engine, config: Config) {
  if (config.profiles.length >= MAX_PROFILES) return $.ui.log(`At most ${MAX_PROFILES} bots.`)
  const name = await ask($, 'Name for the new bot? Type it under "Other".', ['Cancel', 'Use "Mini"'], 'New bot')
  if (name === undefined || name === 'Cancel') return
  const chosen = name === 'Use "Mini"' ? 'Mini' : name
  const copy = await confirm($, `Start ${chosen} from the defaults or as a copy of the active bot?`, 'Defaults', 'Copy active', 'New bot')
  if (copy === undefined) return
  await apply($, createProfile(config, chosen, copy ? undefined : config.activeProfileId))
}

export async function botMenu($: Engine): Promise<void> {
  const actions = [
    { label: 'Select a bot', value: 'select' },
    { label: 'Create a bot', value: 'create' },
    { label: 'Rename a bot', value: 'rename' },
    { label: 'Customize a bot', value: 'customize' },
    { label: 'Delete a bot', value: 'delete' },
  ]
  for (;;) {
    const config = await loadConfig($)
    const picked = await pick(
      $,
      `Your bots: ${config.profiles.map(p => describe(config, p)).join(', ')}. Changing bots never restarts or resets your Claude Code session.`,
      actions,
      'Change Bot',
    )
    if (!picked || 'typed' in picked) return

    if (picked.value === 'create') {
      await createBot($, config)
      continue
    }
    const profile = await choose($, `Which bot to ${picked.value}?`, config, 'Change Bot')
    if (!profile) continue

    if (picked.value === 'select') await apply($, selectProfile(config, profile.id))
    else if (picked.value === 'customize') await settingsMenu($, { profileId: profile.id, groups: PROFILE_GROUPS })
    else if (picked.value === 'rename') {
      const name = await ask($, `New name for ${profile.name}? Type it under "Other".`, ['Cancel', 'Keep current'], 'Rename')
      if (name !== undefined && name !== 'Cancel' && name !== 'Keep current') await apply($, renameProfile(config, profile.id, name))
    } else {
      const sure = await confirm(
        $,
        `Delete ${profile.name}? This cannot be undone. Your Claude Code session is not affected.`,
        `Delete ${profile.name}`,
        'Keep it',
        'Delete bot',
      )
      if (sure) await apply($, deleteProfile(config, profile.id))
    }
  }
}
