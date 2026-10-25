// Settings, as a series of questions. Used for the active bot (Settings) and
// for any bot chosen under Change Bot (Customize).

import { ask, pick, type Item } from './prompts'
import { loadConfig } from './config'
import { commit } from './lifecycle'
import { activeProfile } from './profiles'
import { currentValue, fieldsIn, GROUPS, SETTINGS_GROUPS, type Field, type GroupId } from './fields'
import type { Engine } from './types'

/** Asks for a new value for one field and applies it. */
export async function editField($: Engine, field: Field, profileId: string): Promise<void> {
  const config = await loadConfig($)
  const now = currentValue(field, config, profileId)
  let raw: string | undefined

  if (field.kind === 'text') {
    const extra = field.id === 'notes' ? 'Clear notes' : field.id === 'panel-size' ? 'Reset to default' : 'Cancel'
    const answer = await ask($, `${field.label} (now: ${now}). Type the new value under "Other".`, ['Keep current', extra], field.label)
    if (answer === undefined || answer === 'Keep current' || (answer === 'Cancel' && field.id !== 'notes')) return
    raw = answer === 'Clear notes' ? '' : answer === 'Reset to default' ? 'reset' : answer
  } else {
    const items: Item<string>[] = (field.options ?? []).map(o => ({ label: o, value: o }))
    const hint =
      field.kind === 'number' && field.range
        ? ` Pick one or type a number from ${field.range[0]} to ${field.range[1]}.`
        : field.kind === 'position'
          ? ' Pick a corner or type "x,y" in pixels.'
          : ''
    const picked = await pick($, `${field.label} (now: ${now}).${hint}`, items, field.label)
    if (!picked) return
    raw = 'value' in picked ? picked.value : picked.typed
  }

  const applied = field.apply(config, profileId, raw)
  if ('error' in applied) return $.ui.log(applied.error)
  await commit($, applied.config)
  $.ui.log(`${field.label} is now ${currentValue(field, applied.config, profileId)}.`)
}

async function editGroup($: Engine, group: GroupId, profileId: string): Promise<void> {
  const fields = fieldsIn(group)
  if (fields.length === 1) return editField($, fields[0]!, profileId)
  for (;;) {
    const config = await loadConfig($)
    const items = fields.map(f => ({ label: `${f.label}: ${currentValue(f, config, profileId)}`, value: f }))
    const picked = await pick($, `${GROUPS.find(g => g.id === group)!.label}: which one?`, items)
    if (!picked || 'typed' in picked) return
    await editField($, picked.value, profileId)
  }
}

/** The settings menu. Returns when the person backs out. */
export async function settingsMenu(
  $: Engine,
  { profileId, groups = SETTINGS_GROUPS }: { profileId?: string; groups?: typeof GROUPS } = {},
): Promise<void> {
  for (;;) {
    const config = await loadConfig($)
    const id = profileId ?? config.activeProfileId
    const name = (config.profiles.find(p => p.id === id) ?? activeProfile(config)).name
    const picked = await pick(
      $,
      `Settings for ${name}. Bot settings follow this bot; position, sound, notifications and startup apply to all bots. Esc to go back.`,
      groups.map(g => ({ label: g.label, value: g.id })),
      'Settings',
    )
    if (!picked || 'typed' in picked) return
    await editGroup($, picked.value, id)
  }
}
