// Every setting the person can change, described once.
//
// The interactive menus and `/mini-bot set <field> <value>` both read this
// table, so a setting is added in one place. A field either belongs to a bot
// (`profile`: it travels with that bot) or to the whole companion (`global`).
// Changes go through the same patch functions the floating UI's go through.

import { activeProfile, patchProfile, patchSettings } from './profiles'
import {
  ACCENTS,
  ANCHORS,
  AVATARS,
  IDLE_STYLES,
  SIZES,
  SKINS,
  SPEEDS,
  STARTUP_MODES,
  THEMES,
  TONES,
  type Config,
  type Profile,
  type ProfilePatch,
  type Result,
  type SettingsPatch,
} from './types'

export type GroupId =
  | 'name'
  | 'look'
  | 'animation'
  | 'size-position'
  | 'opacity'
  | 'sound'
  | 'notifications'
  | 'startup'
  | 'personality'

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'name', label: 'Bot name' },
  { id: 'look', label: 'Avatar, skin and accent' },
  { id: 'animation', label: 'Animation' },
  { id: 'size-position', label: 'Size and position' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'sound', label: 'Voice and sound' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'startup', label: 'Startup' },
  { id: 'personality', label: 'Personality' },
]

/** The groups the Settings menu lists. Personality is reached through Change Bot. */
export const SETTINGS_GROUPS = GROUPS.filter(g => g.id !== 'personality')
/** The groups that belong to a single bot. */
export const PROFILE_GROUPS = GROUPS.filter(g =>
  ['name', 'look', 'animation', 'size-position', 'opacity', 'personality'].includes(g.id),
)

export type Applied = { config: Config } | { error: string }

export type Field = {
  id: string
  group: GroupId
  label: string
  scope: 'profile' | 'global'
  kind: 'choice' | 'bool' | 'number' | 'text' | 'position'
  /** Fixed choices; for numbers, the presets offered beside a typed value. */
  options?: readonly string[]
  range?: [number, number]
  show: (config: Config, profile: Profile) => string
  apply: (config: Config, profileId: string, raw: string) => Applied
}

const BOOL_WORDS: Record<string, boolean> = { on: true, off: false, true: true, false: false, yes: true, no: false, '1': true, '0': false }

const done = (result: Result): Applied => ('error' in result ? result : { config: result.config })

type Scope = { scope: 'profile'; patch: (value: never) => ProfilePatch } | { scope: 'global'; patch: (value: never) => SettingsPatch }

const send = (config: Config, profileId: string, how: Scope, value: unknown): Applied =>
  how.scope === 'profile'
    ? done(patchProfile(config, profileId, (how.patch as (v: unknown) => ProfilePatch)(value)))
    : done(patchSettings(config, (how.patch as (v: unknown) => SettingsPatch)(value)))

function choiceField<T extends string>(
  id: string,
  group: GroupId,
  label: string,
  options: readonly T[],
  read: (config: Config, profile: Profile) => T,
  how: { scope: 'profile'; patch: (value: T) => ProfilePatch } | { scope: 'global'; patch: (value: T) => SettingsPatch },
): Field {
  return {
    id,
    group,
    label,
    scope: how.scope,
    kind: 'choice',
    options,
    show: read,
    apply: (config, profileId, raw) => {
      const value = options.find(o => o === raw.trim().toLowerCase())
      return value ? send(config, profileId, how as Scope, value) : { error: `${label} is one of: ${options.join(', ')}.` }
    },
  }
}

function boolField(
  id: string,
  group: GroupId,
  label: string,
  read: (config: Config, profile: Profile) => boolean,
  how: { scope: 'profile'; patch: (value: boolean) => ProfilePatch } | { scope: 'global'; patch: (value: boolean) => SettingsPatch },
): Field {
  return {
    id,
    group,
    label,
    scope: how.scope,
    kind: 'bool',
    options: ['on', 'off'],
    show: (config, profile) => (read(config, profile) ? 'on' : 'off'),
    apply: (config, profileId, raw) => {
      const value = BOOL_WORDS[raw.trim().toLowerCase()]
      return value === undefined ? { error: `${label} is on or off.` } : send(config, profileId, how as Scope, value)
    },
  }
}

function numberField(
  id: string,
  group: GroupId,
  label: string,
  range: [number, number],
  presets: readonly string[],
  read: (config: Config, profile: Profile) => number,
  how: { scope: 'profile'; patch: (value: number) => ProfilePatch } | { scope: 'global'; patch: (value: number) => SettingsPatch },
): Field {
  return {
    id,
    group,
    label,
    scope: how.scope,
    kind: 'number',
    options: presets,
    range,
    show: (config, profile) => `${read(config, profile)}%`,
    apply: (config, profileId, raw) => {
      const value = Number(raw.trim().replace(/%$/, ''))
      if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
        return { error: `${label} is a whole number from ${range[0]} to ${range[1]}.` }
      }
      return send(config, profileId, how as Scope, value)
    },
  }
}

export const FIELDS: Field[] = [
  {
    id: 'name',
    group: 'name',
    label: 'Bot name',
    scope: 'profile',
    kind: 'text',
    show: (_config, profile) => profile.name,
    apply: (config, profileId, raw) => done(patchProfile(config, profileId, { name: raw })),
  },
  choiceField('avatar', 'look', 'Avatar', AVATARS, (_c, p) => p.avatar, { scope: 'profile', patch: avatar => ({ avatar }) }),
  choiceField('skin', 'look', 'Skin', SKINS, (_c, p) => p.appearance.skin, { scope: 'profile', patch: skin => ({ appearance: { skin } }) }),
  choiceField('accent', 'look', 'Accent colour', ACCENTS, (_c, p) => p.appearance.accent, { scope: 'profile', patch: accent => ({ appearance: { accent } }) }),
  choiceField('theme', 'look', 'Panel theme', THEMES, (_c, p) => p.appearance.theme, { scope: 'profile', patch: theme => ({ appearance: { theme } }) }),
  choiceField('idle', 'animation', 'Animation intensity', IDLE_STYLES, (_c, p) => p.animation.idle, { scope: 'profile', patch: idle => ({ animation: { idle } }) }),
  choiceField('speed', 'animation', 'Animation speed', SPEEDS, (_c, p) => p.animation.speed, { scope: 'profile', patch: speed => ({ animation: { speed } }) }),
  boolField('reduced-motion', 'animation', 'Reduced motion', (_c, p) => p.animation.reducedMotion, { scope: 'profile', patch: reducedMotion => ({ animation: { reducedMotion } }) }),
  choiceField('size', 'size-position', 'Size', SIZES, (_c, p) => p.appearance.size, { scope: 'profile', patch: size => ({ appearance: { size } }) }),
  {
    id: 'position',
    group: 'size-position',
    label: 'Position',
    scope: 'profile',
    kind: 'position',
    options: ANCHORS,
    show: (_config, profile) => (profile.position.anchor === 'custom' ? `${profile.position.x}, ${profile.position.y}` : profile.position.anchor),
    apply: (config, profileId, raw) => {
      const word = raw.trim().toLowerCase()
      const anchor = ANCHORS.find(a => a === word)
      if (anchor) return done(patchProfile(config, profileId, { position: { anchor } }))
      const match = /^(-?\d{1,5})\s*[, ]\s*(-?\d{1,5})$/.exec(word)
      if (match) return done(patchProfile(config, profileId, { position: { anchor: 'custom', x: Number(match[1]), y: Number(match[2]) } }))
      return { error: `Position is a corner (${ANCHORS.join(', ')}) or "x,y" in pixels.` }
    },
  },
  numberField('opacity', 'opacity', 'Opacity', [20, 100], ['100', '85', '70', '50'], (_c, p) => p.appearance.opacity, { scope: 'profile', patch: opacity => ({ appearance: { opacity } }) }),
  boolField('voice', 'sound', 'Voice', c => c.sound.voice, { scope: 'global', patch: voice => ({ sound: { voice } }) }),
  boolField('sound-effects', 'sound', 'Sound effects', c => c.sound.effects, { scope: 'global', patch: effects => ({ sound: { effects } }) }),
  numberField('volume', 'sound', 'Volume', [0, 100], ['0', '25', '50', '75'], c => c.sound.volume, { scope: 'global', patch: volume => ({ sound: { volume } }) }),
  boolField('notifications', 'notifications', 'Notifications', c => c.notifications.enabled, { scope: 'global', patch: enabled => ({ notifications: { enabled } }) }),
  boolField('notify-turn-complete', 'notifications', 'Notify when a turn finishes', c => c.notifications.onTurnComplete, { scope: 'global', patch: onTurnComplete => ({ notifications: { onTurnComplete } }) }),
  boolField('notify-access-change', 'notifications', 'Notify when access changes', c => c.notifications.onAccessChange, { scope: 'global', patch: onAccessChange => ({ notifications: { onAccessChange } }) }),
  choiceField('startup', 'startup', 'Startup', STARTUP_MODES, c => c.startup.mode, { scope: 'global', patch: mode => ({ startup: { mode } }) }),
  boolField('stop-with-session', 'startup', 'Stop when Claude Code exits', c => c.startup.stopWithSession, { scope: 'global', patch: stopWithSession => ({ startup: { stopWithSession } }) }),
  choiceField('tone', 'personality', 'Tone', TONES, (_c, p) => p.personality.tone, { scope: 'profile', patch: tone => ({ personality: { tone } }) }),
  {
    id: 'notes',
    group: 'personality',
    label: 'Personality notes',
    scope: 'profile',
    kind: 'text',
    show: (_c, p) => (p.personality.notes === '' ? '(none)' : p.personality.notes),
    apply: (config, profileId, raw) => done(patchProfile(config, profileId, { personality: { notes: raw.trim().slice(0, 280) } })),
  },
]

export const findField = (id: string) => FIELDS.find(f => f.id === id.trim().toLowerCase())
export const fieldsIn = (group: GroupId) => FIELDS.filter(f => f.group === group)

/** The current value of a field, for the bot a profile id names (default: the active one). */
export const currentValue = (field: Field, config: Config, profileId = config.activeProfileId) =>
  field.show(config, config.profiles.find(p => p.id === profileId) ?? activeProfile(config))
