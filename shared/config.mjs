// What the person has chosen, and the rules for changing it.
//
// Plain JavaScript with no imports, so the same file runs in Claude Code's mod
// environment and in the companion runtime's Node. Both sides change profiles
// through these functions, so a rename made in the floating UI and one typed as
// `/mini-bot bot rename` follow the same rules.
//
// Every function takes a configuration and returns a new one, as
// `{ config, message }`, or `{ error }` saying why not. Nothing here has side
// effects.

// 'clawd' is Claude Code's own mascot, drawn as the pixel art it is in the terminal.
export const AVATARS = ['clawd', 'blob', 'robot', 'cat', 'ghost', 'bunny']
// 'claude' is Claude Code's clawd_body colour, rgb(215,119,87).
export const SKINS = ['claude', 'sunrise', 'ocean', 'forest', 'berry', 'slate']
export const SIZES = ['small', 'medium', 'large']
export const IDLE_STYLES = ['none', 'subtle', 'lively']
export const SPEEDS = ['slow', 'normal', 'fast']
export const TONES = ['neutral', 'cheerful', 'calm', 'playful']
export const ANCHORS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
export const STARTUP_MODES = ['manual', 'restore', 'always']
// The label of the model and effort the session runs on, in the panel: both, the model alone, or nothing.
export const MODEL_LABELS = ['full', 'model', 'off']
// The keyboard shortcut that hides and shows the bot from any program.
export const DEFAULT_HOTKEY = 'Ctrl+Alt+B'
// 'claude' is Claude Code's own accent, the colour of its spinner and prompt marks.
export const ACCENTS = ['claude', 'blue', 'green', 'pink', 'orange', 'purple']
export const THEMES = ['dark', 'light']

// The chat panel's size, in pixels at 100% scaling. `replyHeight` is the reply area only: the rest of
// the panel (header, prompt, buttons) keeps its size, so the reply is what grows when the person drags.
export const PANEL_WIDTH_RANGE = [320, 900]
export const PANEL_REPLY_RANGE = [80, 600]

export const MAX_PROFILES = 12
export const MAX_NAME = 40
export const MAX_NOTES = 280

export const defaultProfile = (id = 'default', name = 'Mini') => ({
  id,
  name,
  avatar: 'clawd',
  appearance: { skin: 'claude', size: 'medium', opacity: 100, accent: 'claude', theme: 'dark' },
  animation: { idle: 'subtle', speed: 'normal', reducedMotion: false },
  position: { anchor: 'bottom-right' },
  panel: { width: 380, replyHeight: 150, autoFit: false },
  personality: { tone: 'neutral', notes: '' },
})

// 2: Claude Code's own look is the default. A stored version 1 is migrated (see normalizeConfig).
export const CONFIG_VERSION = 2

export const defaultConfig = () => ({
  version: CONFIG_VERSION,
  // Counts accepted changes. The runtime and the mod compare it to notice that
  // the other side changed something.
  revision: 0,
  activeProfileId: 'default',
  profiles: [defaultProfile()],
  visible: true,
  onboarded: false,
  sound: { voice: false, effects: false, volume: 50 },
  notifications: { enabled: true, onTurnComplete: false, onAccessChange: true },
  startup: { mode: 'restore', stopWithSession: false },
  display: { modelLabel: 'full' },
  hotkey: { toggle: DEFAULT_HOTKEY },
  // Whether the companion was running when the person last started or stopped it.
  wasRunning: false,
})

const rec = value => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {})
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const num = (value, min, max, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const text = (value, max, fallback) => (typeof value === 'string' ? value.slice(0, max) : fallback)

const MODIFIER_NAMES = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', win: 'Win', windows: 'Win', super: 'Win', meta: 'Win' }
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win']

/**
 * A shortcut as written ("ctrl + alt + m") in its one spelling ("Ctrl+Alt+M"), 'off' for none, or null when it
 * cannot be used. It needs a letter, a digit or F1-F12, and Ctrl, Alt or Win with it: Shift alone would
 * take over capital letters in every program.
 */
export const parseHotkey = raw => {
  const word = String(raw ?? '').trim().toLowerCase()
  if (word === 'off' || word === 'none' || word === 'disabled') return 'off'
  const parts = word.split('+').map(part => part.trim())
  const key = parts.pop() ?? ''
  if (!/^([a-z0-9]|f([1-9]|1[0-2]))$/.test(key)) return null
  const modifiers = new Set()
  for (const part of parts) {
    if (!(part in MODIFIER_NAMES)) return null
    modifiers.add(MODIFIER_NAMES[part])
  }
  if (!modifiers.has('Ctrl') && !modifiers.has('Alt') && !modifiers.has('Win')) return null
  return [...MODIFIER_ORDER.filter(m => modifiers.has(m)), key.toUpperCase()].join('+')
}

const normalizePosition = raw => {
  const p = rec(raw)
  return p.anchor === 'custom' && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { anchor: 'custom', x: Math.round(p.x), y: Math.round(p.y) }
    : { anchor: pick(p.anchor, ANCHORS, 'bottom-right') }
}

export const normalizeProfile = (raw, index = 0, legacyPosition) => {
  const base = defaultProfile()
  const p = rec(raw)
  const appearance = rec(p.appearance)
  const animation = rec(p.animation)
  const personality = rec(p.personality)
  const panel = rec(p.panel)
  return {
    id: text(p.id, 64, '') || `profile-${index + 1}`,
    name: text(p.name, MAX_NAME, '').replace(/\s+/g, ' ').trim() || base.name,
    avatar: pick(p.avatar, AVATARS, base.avatar),
    appearance: {
      skin: pick(appearance.skin, SKINS, base.appearance.skin),
      size: pick(appearance.size, SIZES, base.appearance.size),
      opacity: num(appearance.opacity, 20, 100, base.appearance.opacity),
      accent: pick(appearance.accent, ACCENTS, base.appearance.accent),
      theme: pick(appearance.theme, THEMES, base.appearance.theme),
    },
    animation: {
      idle: pick(animation.idle, IDLE_STYLES, base.animation.idle),
      speed: pick(animation.speed, SPEEDS, base.animation.speed),
      reducedMotion: bool(animation.reducedMotion, base.animation.reducedMotion),
    },
    // Earlier versions kept one position for every bot; it moves into each bot.
    position: normalizePosition(p.position ?? legacyPosition),
    panel: {
      width: num(panel.width, ...PANEL_WIDTH_RANGE, base.panel.width),
      replyHeight: num(panel.replyHeight, ...PANEL_REPLY_RANGE, base.panel.replyHeight),
      autoFit: bool(panel.autoFit, base.panel.autoFit),
    },
    personality: {
      tone: pick(personality.tone, TONES, base.personality.tone),
      notes: text(personality.notes, MAX_NOTES, ''),
    },
  }
}

/**
 * Before version 2 the factory bot was a round orange blob with a blue accent.
 * A bot still wearing exactly that look has never been customized, so it takes
 * the new default (Claude Code's mascot). Anything the person changed is kept.
 */
const upgradeFactoryLook = (raw, version) => {
  const p = rec(raw)
  if (version === CONFIG_VERSION) return raw
  const a = rec(p.appearance)
  const isFactory = p.avatar === 'blob' && a.skin === 'sunrise' && (a.accent === 'blue' || a.accent === undefined)
  return isFactory ? { ...p, avatar: 'clawd', appearance: { ...a, skin: 'claude', accent: 'claude' } } : raw
}

/** Reads whatever was stored, or sent, as a complete and valid configuration. */
export const normalizeConfig = raw => {
  const base = defaultConfig()
  const c = rec(raw)
  const seen = new Set()
  const profiles = (Array.isArray(c.profiles) ? c.profiles : [])
    .slice(0, MAX_PROFILES)
    .map((p, i) => upgradeFactoryLook(p, c.version))
    .map((p, i) => normalizeProfile(p, i, c.position))
    .filter(p => !seen.has(p.id) && seen.add(p.id))
  if (profiles.length === 0) profiles.push(base.profiles[0])
  const sound = rec(c.sound)
  const notifications = rec(c.notifications)
  const startup = rec(c.startup)
  const display = rec(c.display)
  const hotkey = rec(c.hotkey)
  return {
    version: CONFIG_VERSION,
    revision: num(c.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    activeProfileId: profiles.some(p => p.id === c.activeProfileId) ? c.activeProfileId : profiles[0].id,
    profiles,
    visible: bool(c.visible, base.visible),
    onboarded: bool(c.onboarded, base.onboarded),
    sound: {
      voice: bool(sound.voice, base.sound.voice),
      effects: bool(sound.effects, base.sound.effects),
      volume: num(sound.volume, 0, 100, base.sound.volume),
    },
    notifications: {
      enabled: bool(notifications.enabled, base.notifications.enabled),
      onTurnComplete: bool(notifications.onTurnComplete, base.notifications.onTurnComplete),
      onAccessChange: bool(notifications.onAccessChange, base.notifications.onAccessChange),
    },
    startup: {
      mode: pick(startup.mode, STARTUP_MODES, base.startup.mode),
      stopWithSession: bool(startup.stopWithSession, base.startup.stopWithSession),
    },
    display: { modelLabel: pick(display.modelLabel, MODEL_LABELS, base.display.modelLabel) },
    hotkey: { toggle: parseHotkey(hotkey.toggle) ?? base.hotkey.toggle },
    wasRunning: bool(c.wasRunning, base.wasRunning),
  }
}

/** The same choices ignoring the revision counter, for noticing a real change. */
export const sameChoices = (a, b) => JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 })

export const activeProfile = config => config.profiles.find(p => p.id === config.activeProfileId) ?? config.profiles[0]

export const findProfile = (config, query) => {
  const q = String(query ?? '').trim()
  return config.profiles.find(p => p.id === q) ?? config.profiles.find(p => p.name.toLowerCase() === q.toLowerCase())
}

/** A usable name, or the reason it is not. Names are unique ignoring case. */
export const checkName = (config, name, exceptId) => {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (clean === '') return { error: 'A bot needs a name.' }
  if (clean.length > MAX_NAME) return { error: `Names are ${MAX_NAME} characters at most.` }
  const clash = config.profiles.find(p => p.id !== exceptId && p.name.toLowerCase() === clean.toLowerCase())
  if (clash) return { error: `There is already a bot called "${clash.name}".` }
  return { name: clean }
}

const slug = name =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'bot'

const freshId = (config, name) => {
  let id = slug(name)
  for (let n = 2; config.profiles.some(p => p.id === id); n++) id = `${slug(name)}-${n}`
  return id
}

export const selectProfile = (config, id) => {
  const profile = config.profiles.find(p => p.id === id)
  if (!profile) return { error: 'No such bot.' }
  return { config: { ...config, activeProfileId: id }, message: `Switched to ${profile.name}.` }
}

/** A new profile, from the defaults or as a copy of an existing one. It becomes the active bot. */
export const createProfile = (config, name, copyOf) => {
  if (config.profiles.length >= MAX_PROFILES) return { error: `At most ${MAX_PROFILES} bots.` }
  const checked = checkName(config, name)
  if ('error' in checked) return checked
  const source = copyOf ? config.profiles.find(p => p.id === copyOf) : undefined
  const profile = { ...JSON.parse(JSON.stringify(source ?? defaultProfile())), id: freshId(config, checked.name), name: checked.name }
  return {
    config: { ...config, profiles: [...config.profiles, profile], activeProfileId: profile.id },
    message: `Created ${profile.name} and switched to it.`,
  }
}

export const renameProfile = (config, id, name) => {
  const profile = config.profiles.find(p => p.id === id)
  if (!profile) return { error: 'No such bot.' }
  const checked = checkName(config, name, id)
  if ('error' in checked) return checked
  return {
    config: { ...config, profiles: config.profiles.map(p => (p.id === id ? { ...p, name: checked.name } : p)) },
    message: `Renamed ${profile.name} to ${checked.name}.`,
  }
}

/** Removes a profile. The caller asks for confirmation first. The last one stays. */
export const deleteProfile = (config, id) => {
  const profile = config.profiles.find(p => p.id === id)
  if (!profile) return { error: 'No such bot.' }
  if (config.profiles.length === 1) return { error: 'That is your only bot, so it cannot be deleted.' }
  const profiles = config.profiles.filter(p => p.id !== id)
  return {
    config: { ...config, profiles, activeProfileId: config.activeProfileId === id ? profiles[0].id : config.activeProfileId },
    message: `Deleted ${profile.name}.`,
  }
}

const oneOf = (label, value, allowed) => (allowed.includes(value) ? null : `${label} is one of: ${allowed.join(', ')}.`)

/** Why a profile patch is not acceptable, or null. A patch names only what changes. */
export const checkPatch = patch => {
  const p = rec(patch)
  const known = ['name', 'avatar', 'appearance', 'animation', 'position', 'panel', 'personality']
  const extra = Object.keys(p).find(k => !known.includes(k))
  if (extra) return `Unknown setting "${extra}".`
  if ('name' in p && typeof p.name !== 'string') return 'Name must be text.'
  if ('avatar' in p) {
    const bad = oneOf('Avatar', p.avatar, AVATARS)
    if (bad) return bad
  }
  const a = rec(p.appearance)
  for (const [key, allowed] of [['skin', SKINS], ['size', SIZES], ['accent', ACCENTS], ['theme', THEMES]]) {
    if (key in a) {
      const bad = oneOf(key[0].toUpperCase() + key.slice(1), a[key], allowed)
      if (bad) return bad
    }
  }
  if ('opacity' in a && !(Number.isInteger(a.opacity) && a.opacity >= 20 && a.opacity <= 100)) return 'Opacity is a whole number from 20 to 100.'
  const n = rec(p.animation)
  for (const [key, allowed] of [['idle', IDLE_STYLES], ['speed', SPEEDS]]) {
    if (key in n) {
      const bad = oneOf(`Animation ${key}`, n[key], allowed)
      if (bad) return bad
    }
  }
  if ('reducedMotion' in n && typeof n.reducedMotion !== 'boolean') return 'Reduced motion is on or off.'
  if ('position' in p) {
    const pos = rec(p.position)
    const isCustom = pos.anchor === 'custom' && Number.isFinite(pos.x) && Number.isFinite(pos.y)
    if (!isCustom && !ANCHORS.includes(pos.anchor)) return `Position is a corner (${ANCHORS.join(', ')}) or custom x and y.`
  }
  const pn = rec(p.panel)
  for (const [key, [min, max], label] of [['width', PANEL_WIDTH_RANGE, 'Panel width'], ['replyHeight', PANEL_REPLY_RANGE, 'Reply height']]) {
    if (key in pn && !(Number.isInteger(pn[key]) && pn[key] >= min && pn[key] <= max)) return `${label} is a whole number from ${min} to ${max}.`
  }
  if ('autoFit' in pn && typeof pn.autoFit !== 'boolean') return 'Growing for long replies is on or off.'
  const s = rec(p.personality)
  if ('tone' in s) {
    const bad = oneOf('Tone', s.tone, TONES)
    if (bad) return bad
  }
  if ('notes' in s && (typeof s.notes !== 'string' || s.notes.length > MAX_NOTES)) return `Notes are text of ${MAX_NOTES} characters at most.`
  return null
}

/** Applies a patch to one profile: renames go through the name rules, the rest merges in. */
export const patchProfile = (config, id, patch) => {
  const profile = config.profiles.find(p => p.id === id)
  if (!profile) return { error: 'No such bot.' }
  const bad = checkPatch(patch)
  if (bad) return { error: bad }
  let next = config
  if (typeof patch.name === 'string' && patch.name.trim() !== profile.name) {
    const renamed = renameProfile(config, id, patch.name)
    if ('error' in renamed) return renamed
    next = renamed.config
  }
  const merged = {
    ...next.profiles.find(p => p.id === id),
    avatar: patch.avatar ?? profile.avatar,
    appearance: { ...profile.appearance, ...rec(patch.appearance) },
    animation: { ...profile.animation, ...rec(patch.animation) },
    position: patch.position ?? profile.position,
    panel: { ...profile.panel, ...rec(patch.panel) },
    personality: { ...profile.personality, ...rec(patch.personality) },
  }
  return {
    config: { ...next, profiles: next.profiles.map(p => (p.id === id ? normalizeProfile(merged) : p)) },
    message: `Updated ${merged.name}.`,
  }
}

const SETTINGS_KEYS = ['sound', 'notifications', 'startup', 'display', 'hotkey', 'onboarded', 'visible']

/** Applies changes that belong to the whole companion rather than one bot. */
export const patchSettings = (config, patch) => {
  const p = rec(patch)
  const extra = Object.keys(p).find(k => !SETTINGS_KEYS.includes(k))
  if (extra) return { error: `Unknown setting "${extra}".` }
  if ('toggle' in rec(p.hotkey) && parseHotkey(p.hotkey.toggle) === null) {
    return { error: 'A shortcut is Ctrl, Alt or Win with a letter, a digit or F1-F12, for example Ctrl+Alt+M. "off" turns it off.' }
  }
  const merged = {
    ...config,
    ...('onboarded' in p ? { onboarded: p.onboarded } : {}),
    ...('visible' in p ? { visible: p.visible } : {}),
    sound: { ...config.sound, ...rec(p.sound) },
    notifications: { ...config.notifications, ...rec(p.notifications) },
    startup: { ...config.startup, ...rec(p.startup) },
    display: { ...config.display, ...rec(p.display) },
    hotkey: { ...config.hotkey, ...rec(p.hotkey) },
  }
  return { config: normalizeConfig(merged), message: 'Settings updated.' }
}

/**
 * One change asked for over the runtime's interface (`POST /v1/config/apply`),
 * by the floating UI: { op: 'create' | 'select' | 'rename' | 'delete' | 'update' | 'settings' | 'move' | 'resize', ... }.
 */
export const applyOp = (config, op) => {
  const o = rec(op)
  switch (o.op) {
    case 'create':
      return createProfile(config, o.name, o.copyOf)
    case 'select':
      return selectProfile(config, o.id)
    case 'rename':
      return renameProfile(config, o.id, o.name)
    case 'delete':
      return deleteProfile(config, o.id)
    case 'update':
      return patchProfile(config, o.id ?? config.activeProfileId, o.patch)
    case 'settings':
      return patchSettings(config, o.patch)
    case 'move':
      return patchProfile(config, config.activeProfileId, { position: { anchor: 'custom', x: o.x, y: o.y } })
    case 'resize':
      return patchProfile(config, config.activeProfileId, { panel: { width: o.width, replyHeight: o.replyHeight } })
    default:
      return { error: 'Unknown change.' }
  }
}
