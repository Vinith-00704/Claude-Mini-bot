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
// A bot drawn from its own pixel art (the profile's `sprite`), made by describing it to Claude. It is a choice only for a bot that has one.
export const CUSTOM_AVATAR = 'custom'
// The pixel art of such a bot: a grid of cells this many across and down, a few colours, and a picture (or a few, played in turn) for each state.
// 'idle' is the only one a sprite must have; a state without its own picture shows the idle one, moved a little.
export const SPRITE_SIZE_RANGE = [8, 24]
export const SPRITE_STATES = ['idle', 'blink', 'listening', 'thinking', 'working', 'done', 'error']
export const MAX_SPRITE_COLORS = 16
export const MAX_SPRITE_FRAMES = 3
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
// Computer control: how much Claude may do without asking. 'step' asks before every action, 'important'
// only before actions that send, delete, buy, submit and the like, 'free' never within the allowed apps.
export const CONTROL_LEVELS = ['step', 'important', 'free']
// The key that ends computer control at once, from any program.
export const DEFAULT_STOP_KEY = 'Ctrl+Alt+Esc'
export const MAX_BLOCKED_APPS = 30
export const CONTROL_ACTIONS_RANGE = [10, 1000]
export const CONTROL_MINUTES_RANGE = [1, 120]
// Live talking: the key that starts talking and the key that shows Claude the window in front, from any program.
export const DEFAULT_TALK_KEY = 'Ctrl+Alt+Space'
export const DEFAULT_LOOK_KEY = 'Ctrl+Alt+Q'
// The key that has Claude summarize the page in front, and the key that opens the real Claude Code window of Mini's own session.
export const DEFAULT_SUMMARIZE_KEY = 'Ctrl+Alt+S'
export const DEFAULT_TERMINAL_KEY = 'Ctrl+Alt+T'
// When a reply is said aloud: when the person spoke the prompt, always, or never.
export const SPEAK_MODES = ['spoken', 'always', 'off']
export const VOICE_RATE_RANGE = [-5, 5]
// The permission mode Mini's own Claude Code session runs in, by Claude Code's names. Skipping permission checks is deliberately not one of them.
export const SESSION_PERMISSIONS = ['auto', 'acceptEdits', 'manual']
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
// 3: sound effects mean something now (the chime when the bot hears its name), and are on unless the person turns them off.
// 4: a bot can have pixel art of its own and colours of its own, and there are two more shortcuts. A copy written by
//    an earlier version cannot hold these (see keepWhatACopyCannotHold).
export const CONFIG_VERSION = 4

export const defaultConfig = () => ({
  version: CONFIG_VERSION,
  // Counts accepted changes. The runtime and the mod compare it to notice that
  // the other side changed something.
  revision: 0,
  activeProfileId: 'default',
  profiles: [defaultProfile()],
  visible: true,
  onboarded: false,
  sound: { voice: false, effects: true, volume: 70 },
  notifications: { enabled: true, onTurnComplete: false, onAccessChange: true },
  startup: { mode: 'restore', stopWithSession: false },
  display: { modelLabel: 'full' },
  hotkey: { toggle: DEFAULT_HOTKEY, talk: DEFAULT_TALK_KEY, look: DEFAULT_LOOK_KEY, summarize: DEFAULT_SUMMARIZE_KEY, terminal: DEFAULT_TERMINAL_KEY },
  // Live talking: when replies are said aloud, whether it goes on listening for a moment after a reply without its
  // name, whether what was heard waits to be checked before it is sent, and the Windows voice and its speed.
  live: { speak: 'spoken', followUp: true, review: false, voice: '', rate: 0 },
  // Mini's own Claude Code session, which the companion keeps running in the background once the person asks for it.
  // `offered` says the person has been asked once; `model` is empty for Claude Code's default.
  assistant: { session: false, offered: false, model: '', permissions: 'auto' },
  // The limits of computer control. Each task still needs the person's own yes in the bot.
  computer: { level: 'step', stopKey: DEFAULT_STOP_KEY, blockedApps: [], maxActions: 150, maxMinutes: 20 },
  // Whether the companion was running when the person last started or stopped it.
  wasRunning: false,
})

const rec = value => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {})
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const num = (value, min, max, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const text = (value, max, fallback) => (typeof value === 'string' ? value.slice(0, max) : fallback)

/** A colour written "#3fa7d6", in its one spelling, or null. */
export const hexColor = raw => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(raw ?? '').trim())
  return match ? '#' + match[1].toLowerCase() : null
}
// A colour setting is one of the named ones or any colour written as hex.
const pickColor = (value, allowed, fallback) => (allowed.includes(value) ? value : hexColor(value) ?? fallback)

/**
 * The pixel art of a bot, checked: `{ sprite }` in its one form, or `{ error }` saying exactly what is wrong, so
 * whoever drew it can put it right.
 *
 *   width, height   cells across and down (SPRITE_SIZE_RANGE)
 *   palette         { a: '#d77757', b: '#121212', ... }: one letter or digit per colour, MAX_SPRITE_COLORS at most
 *   frames          { idle: [...], blink: [...], listening: [...], thinking: [...], working: [...], done: [...], error: [...] }
 *                   Each is one picture (`height` strings of `width` characters) or up to MAX_SPRITE_FRAMES of them, played in
 *                   turn. A character is a palette key, or "." (or a space) for nothing there. Only idle is required.
 */
export const checkSprite = raw => {
  const s = rec(raw)
  const [min, max] = SPRITE_SIZE_RANGE
  const { width, height } = s
  if (!Number.isInteger(width) || width < min || width > max) return { error: `sprite.width is a whole number from ${min} to ${max}.` }
  if (!Number.isInteger(height) || height < min || height > max) return { error: `sprite.height is a whole number from ${min} to ${max}.` }
  const palette = {}
  const entries = Object.entries(rec(s.palette))
  if (entries.length === 0) return { error: 'sprite.palette names at least one colour, such as { "a": "#d77757" }.' }
  if (entries.length > MAX_SPRITE_COLORS) return { error: `sprite.palette has ${MAX_SPRITE_COLORS} colours at most.` }
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9]$/.test(key)) return { error: `A palette key is one letter or digit, not "${String(key).slice(0, 12)}".` }
    const colour = hexColor(value)
    if (!colour) return { error: `Palette colour "${key}" must be written like #3fa7d6.` }
    palette[key] = colour
  }
  const given = rec(s.frames)
  const unknown = Object.keys(given).find(k => !SPRITE_STATES.includes(k))
  if (unknown) return { error: `"${String(unknown).slice(0, 20)}" is not a state. The states are: ${SPRITE_STATES.join(', ')}.` }
  if (!('idle' in given)) return { error: 'sprite.frames needs "idle": the picture of the bot at rest.' }
  const frames = {}
  for (const state of SPRITE_STATES) {
    if (!(state in given)) continue
    const value = given[state]
    if (!Array.isArray(value) || value.length === 0) return { error: `frames.${state} is a picture: ${height} strings of ${width} characters.` }
    // One picture (its rows), or a few pictures.
    const pictures = typeof value[0] === 'string' ? [value] : value
    if (pictures.length > MAX_SPRITE_FRAMES) return { error: `frames.${state} has ${MAX_SPRITE_FRAMES} pictures at most.` }
    frames[state] = []
    for (const [n, picture] of pictures.entries()) {
      const where = pictures.length > 1 ? `frames.${state}[${n}]` : `frames.${state}`
      if (!Array.isArray(picture) || picture.length !== height) return { error: `${where} has ${Array.isArray(picture) ? picture.length : 0} rows; every picture has ${height} (the sprite's height).` }
      const rows = []
      for (const [y, row] of picture.entries()) {
        if (typeof row !== 'string' || row.length !== width) return { error: `${where} row ${y + 1} is ${typeof row === 'string' ? row.length : 0} characters; every row is ${width} (the sprite's width).` }
        const clean = row.replace(/ /g, '.')
        const bad = [...clean].find(ch => ch !== '.' && !(ch in palette))
        if (bad) return { error: `${where} row ${y + 1} uses "${bad}", which is not in the palette. Use a palette key, or "." for nothing.` }
        rows.push(clean)
      }
      frames[state].push(rows)
    }
  }
  const filled = frames.idle[0].join('').replace(/\./g, '').length
  if (filled < 12) return { error: 'The idle picture is almost empty. Draw the bot with palette keys; "." is nothing.' }
  return { sprite: { width, height, palette, frames } }
}

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
  const typed = parts.pop() ?? ''
  const key = typed === 'escape' ? 'esc' : typed
  if (!/^([a-z0-9]|f([1-9]|1[0-2])|esc|pause|space)$/.test(key)) return null
  const modifiers = new Set()
  for (const part of parts) {
    if (!(part in MODIFIER_NAMES)) return null
    modifiers.add(MODIFIER_NAMES[part])
  }
  if (!modifiers.has('Ctrl') && !modifiers.has('Alt') && !modifiers.has('Win')) return null
  const name = key === 'esc' || key === 'pause' || key === 'space' ? key[0].toUpperCase() + key.slice(1) : key.toUpperCase()
  return [...MODIFIER_ORDER.filter(m => modifiers.has(m)), name].join('+')
}

/** A program's name as the bot compares them: "EXCEL.EXE" and "excel" are the same app. Null when it is not a usable name. */
export const appName = raw => {
  const name = String(raw ?? '').trim().toLowerCase().replace(/\.exe$/, '')
  return /^[a-z0-9][a-z0-9 ._-]{0,39}$/.test(name) ? name : null
}

/** A model name as Claude Code takes it after --model ("sonnet", "claude-sonnet-5-5"), or null. It goes on a command line, so only these characters. */
export const modelName = raw => {
  const name = String(raw ?? '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,59}$/.test(name) ? name : null
}

const normalizeComputer = (raw, base) => {
  const c = rec(raw)
  const stopKey = parseHotkey(c.stopKey)
  const apps = Array.isArray(c.blockedApps) ? c.blockedApps.map(appName).filter(a => a !== null) : []
  return {
    level: pick(c.level, CONTROL_LEVELS, base.level),
    // The stop key cannot be turned off: it is how the person ends control without reaching the mouse.
    stopKey: stopKey && stopKey !== 'off' ? stopKey : base.stopKey,
    blockedApps: [...new Set(apps)].slice(0, MAX_BLOCKED_APPS),
    maxActions: num(c.maxActions, ...CONTROL_ACTIONS_RANGE, base.maxActions),
    maxMinutes: num(c.maxMinutes, ...CONTROL_MINUTES_RANGE, base.maxMinutes),
  }
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
  const checked = p.sprite === undefined || p.sprite === null ? {} : checkSprite(p.sprite)
  const sprite = 'sprite' in checked ? checked.sprite : null
  return {
    id: text(p.id, 64, '') || `profile-${index + 1}`,
    name: text(p.name, MAX_NAME, '').replace(/\s+/g, ' ').trim() || base.name,
    // A bot keeps the pixel art it was given even while it wears another avatar, so the person can go back to it.
    avatar: p.avatar === CUSTOM_AVATAR && sprite ? CUSTOM_AVATAR : pick(p.avatar, AVATARS, base.avatar),
    ...(sprite ? { sprite } : {}),
    appearance: {
      skin: pickColor(appearance.skin, SKINS, base.appearance.skin),
      size: pick(appearance.size, SIZES, base.appearance.size),
      opacity: num(appearance.opacity, 20, 100, base.appearance.opacity),
      accent: pickColor(appearance.accent, ACCENTS, base.appearance.accent),
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
  const live = rec(c.live)
  const assistant = rec(c.assistant)
  return {
    version: CONFIG_VERSION,
    revision: num(c.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    activeProfileId: profiles.some(p => p.id === c.activeProfileId) ? c.activeProfileId : profiles[0].id,
    profiles,
    visible: bool(c.visible, base.visible),
    onboarded: bool(c.onboarded, base.onboarded),
    sound: {
      voice: bool(sound.voice, base.sound.voice),
      // Before version 3 this setting did nothing, so a stored "off" was never a choice.
      effects: (c.version ?? 0) < 3 ? base.sound.effects : bool(sound.effects, base.sound.effects),
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
    hotkey: {
      toggle: parseHotkey(hotkey.toggle) ?? base.hotkey.toggle,
      talk: parseHotkey(hotkey.talk) ?? base.hotkey.talk,
      look: parseHotkey(hotkey.look) ?? base.hotkey.look,
      summarize: parseHotkey(hotkey.summarize) ?? base.hotkey.summarize,
      terminal: parseHotkey(hotkey.terminal) ?? base.hotkey.terminal,
    },
    live: {
      speak: pick(live.speak, SPEAK_MODES, base.live.speak),
      followUp: bool(live.followUp, base.live.followUp),
      review: bool(live.review, base.live.review),
      voice: text(live.voice, 60, base.live.voice),
      rate: num(live.rate, ...VOICE_RATE_RANGE, base.live.rate),
    },
    assistant: {
      session: bool(assistant.session, base.assistant.session),
      offered: bool(assistant.offered, base.assistant.offered),
      model: modelName(assistant.model) ?? base.assistant.model,
      permissions: pick(assistant.permissions, SESSION_PERMISSIONS, base.assistant.permissions),
    },
    computer: normalizeComputer(c.computer, base.computer),
    wasRunning: bool(c.wasRunning, base.wasRunning),
  }
}

/**
 * A whole copy of the settings, as Claude Code's side sends it, with what that copy cannot hold kept from the settings
 * as they stand. A Claude Code session that was opened before an update still runs the older code, shares the stored
 * settings with newer sessions, and writes them back without a bot's own art, its own colours or the newer shortcuts.
 * Its silence about those is not a wish to remove them.
 *
 * Pixel art is only ever removed with its bot (or by a change asked for in the bot itself), so a copy that lacks the art
 * of a bot that has some is taken for such a copy, whatever version it says it is.
 */
export const keepWhatACopyCannotHold = (incoming, current) => {
  const c = rec(incoming)
  const isOld = !(Number(c.version) >= CONFIG_VERSION)
  const base = defaultProfile()
  const profiles = (Array.isArray(c.profiles) ? c.profiles : []).map(raw => {
    const p = rec(raw)
    const mine = current.profiles.find(q => q.id === p.id)
    if (!mine) return raw
    const isLossy = isOld || (mine.sprite !== undefined && (p.sprite === undefined || p.sprite === null))
    if (!isLossy) return raw
    const a = rec(p.appearance)
    const kept = (now, was, fallback) => (hexColor(was) && now === fallback ? was : now)
    return {
      ...p,
      ...(mine.sprite ? { sprite: mine.sprite } : {}),
      // The older code reads "custom" as the default character, so that is what it sends back.
      avatar: mine.avatar === CUSTOM_AVATAR && p.avatar === base.avatar ? CUSTOM_AVATAR : p.avatar,
      appearance: { ...a, skin: kept(a.skin, mine.appearance.skin, base.appearance.skin), accent: kept(a.accent, mine.appearance.accent, base.appearance.accent) },
    }
  })
  const keys = rec(c.hotkey)
  return {
    ...c,
    profiles,
    ...(isOld ? { hotkey: { ...keys, summarize: keys.summarize ?? current.hotkey.summarize, terminal: keys.terminal ?? current.hotkey.terminal } } : {}),
  }
}

/** A short mark of what the settings say (not their revision), for telling whether two copies are the same without sending either. */
export const configKey = config => {
  const text = JSON.stringify({ ...config, revision: 0, wasRunning: false })
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${text.length}:${hash >>> 0}`
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

/**
 * A bot as it was designed from the person's description, checked: `{ profile, isNew }`, the bot it would be (for the
 * preview they are shown before anything changes), or `{ error }`. Nothing is changed here; adoptBot does that.
 *
 *   name       what it is called (a new bot needs one)
 *   replace    the name of an existing bot to redesign; without it the design is a new bot
 *   sprite     its own pixel art (checkSprite), or avatar: one of the built-in characters
 *   skin, accent   a named colour or "#rrggbb";  theme, size, idle, tone, notes   as in a profile
 */
export const designBot = (config, spec) => {
  const s = rec(spec)
  const replace = typeof s.replace === 'string' ? s.replace.trim() : ''
  const target = replace === '' ? undefined : findProfile(config, replace)
  if (replace !== '' && !target) return { error: `There is no bot called "${replace.slice(0, MAX_NAME)}" to change. The bots are: ${config.profiles.map(p => p.name).join(', ')}.` }
  if (!target && config.profiles.length >= MAX_PROFILES) return { error: `There are already ${MAX_PROFILES} bots. Redesign one of them (replace), or the person can delete one first.` }
  const named = checkName(config, s.name ?? target?.name, target?.id)
  if ('error' in named) return named
  const patch = {}
  if (s.sprite !== undefined && s.sprite !== null) {
    const checked = checkSprite(s.sprite)
    if ('error' in checked) return checked
    patch.sprite = checked.sprite
    patch.avatar = CUSTOM_AVATAR
  } else if (s.avatar !== undefined && s.avatar !== null) {
    patch.avatar = typeof s.avatar === 'string' ? s.avatar.trim().toLowerCase() : s.avatar
    if (patch.avatar === CUSTOM_AVATAR && !target?.sprite) return { error: 'avatar "custom" needs sprite: the bot\'s own pixel art.' }
  } else if (!target) return { error: `Give the bot a look: sprite (its own pixel art), or avatar (one of ${AVATARS.join(', ')}).` }
  const word = value => (typeof value === 'string' ? value.trim().toLowerCase() : value)
  const appearance = {}
  for (const key of ['skin', 'accent', 'theme', 'size']) if (s[key] !== undefined && s[key] !== null) appearance[key] = word(s[key])
  if (Object.keys(appearance).length > 0) patch.appearance = appearance
  if (s.idle !== undefined && s.idle !== null) patch.animation = { idle: word(s.idle) }
  const personality = {}
  if (s.tone !== undefined && s.tone !== null) personality.tone = word(s.tone)
  if (s.notes !== undefined && s.notes !== null) personality.notes = typeof s.notes === 'string' ? s.notes.replace(/\s+/g, ' ').trim() : s.notes
  if (Object.keys(personality).length > 0) patch.personality = personality
  const bad = checkPatch(patch)
  if (bad) return { error: bad }
  // A new bot stands where the one on the screen stands, at its size, with the same panel.
  const active = activeProfile(config)
  const base = target ?? {
    ...defaultProfile(freshId(config, named.name), named.name),
    appearance: { ...defaultProfile().appearance, size: active.appearance.size, opacity: active.appearance.opacity },
    animation: { ...active.animation },
    position: active.position,
    panel: { ...active.panel },
  }
  const profile = normalizeProfile({
    ...base,
    name: named.name,
    avatar: patch.avatar ?? base.avatar,
    sprite: patch.sprite ?? base.sprite,
    appearance: { ...base.appearance, ...appearance },
    animation: { ...base.animation, ...rec(patch.animation) },
    personality: { ...base.personality, ...personality },
  })
  return { profile, isNew: !target }
}

/** Makes a designed bot real: it is added, or takes the place of the one it redesigns, and becomes the bot on the screen. */
export const adoptBot = (config, profile) => {
  const made = normalizeProfile(profile)
  const existing = config.profiles.find(p => p.id === made.id)
  if (!existing && config.profiles.length >= MAX_PROFILES) return { error: `At most ${MAX_PROFILES} bots.` }
  const named = checkName(config, made.name, existing?.id)
  if ('error' in named) return named
  const profiles = existing ? config.profiles.map(p => (p.id === made.id ? made : p)) : [...config.profiles, made]
  return { config: { ...config, profiles, activeProfileId: made.id }, message: existing ? `${made.name} has its new look.` : `Created ${made.name} and switched to it.` }
}

/** Why a profile patch is not acceptable, or null. A patch names only what changes. */
export const checkPatch = patch => {
  const p = rec(patch)
  const known = ['name', 'avatar', 'sprite', 'appearance', 'animation', 'position', 'panel', 'personality']
  const extra = Object.keys(p).find(k => !known.includes(k))
  if (extra) return `Unknown setting "${extra}".`
  if ('name' in p && typeof p.name !== 'string') return 'Name must be text.'
  if ('sprite' in p && p.sprite !== null) {
    const checked = checkSprite(p.sprite)
    if ('error' in checked) return checked.error
  }
  if ('avatar' in p && p.avatar !== CUSTOM_AVATAR) {
    const bad = oneOf('Avatar', p.avatar, AVATARS)
    if (bad) return bad
  }
  const a = rec(p.appearance)
  for (const [key, allowed] of [['size', SIZES], ['theme', THEMES]]) {
    if (key in a) {
      const bad = oneOf(key[0].toUpperCase() + key.slice(1), a[key], allowed)
      if (bad) return bad
    }
  }
  for (const [key, allowed] of [['skin', SKINS], ['accent', ACCENTS]]) {
    if (key in a && !allowed.includes(a[key]) && !hexColor(a[key])) return `${key[0].toUpperCase() + key.slice(1)} is one of: ${allowed.join(', ')}, or a colour written like #3fa7d6.`
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
  // The pixel art comes with the patch, is taken away by it (null), or stays as it was.
  const sprite = 'sprite' in patch ? patch.sprite : profile.sprite
  if (patch.avatar === CUSTOM_AVATAR && !sprite) return { error: 'This bot has no pixel art of its own yet. Ask Claude to design one: /mini-bot design <what it should look like>.' }
  const merged = {
    ...next.profiles.find(p => p.id === id),
    avatar: patch.avatar ?? (sprite ? profile.avatar : profile.avatar === CUSTOM_AVATAR ? defaultProfile().avatar : profile.avatar),
    sprite: sprite ?? undefined,
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

const SETTINGS_KEYS = ['sound', 'notifications', 'startup', 'display', 'hotkey', 'computer', 'live', 'assistant', 'onboarded', 'visible']

const HOTKEY_LABELS = {
  toggle: 'the hide/show shortcut',
  talk: 'the talk key',
  look: 'the key that shows Claude your window',
  summarize: 'the key that summarizes the page in front',
  terminal: "the key that opens Claude Code's own window",
}

/** Why changed shortcuts cannot be used, or null. No two of them may be the same key, and none may be the key that stops computer control. */
const checkHotkeys = (config, patch) => {
  const p = rec(patch)
  const wanted = { ...config.hotkey }
  for (const name of Object.keys(HOTKEY_LABELS)) {
    if (!(name in p)) continue
    const key = parseHotkey(p[name])
    if (key === null) return 'A shortcut is Ctrl, Alt or Win with a letter, a digit, Space or F1-F12, for example Ctrl+Alt+M. "off" turns it off.'
    wanted[name] = key
  }
  for (const name of Object.keys(p).filter(n => n in HOTKEY_LABELS)) {
    if (wanted[name] === 'off') continue
    if (wanted[name] === config.computer.stopKey) return `${config.computer.stopKey} is the key that stops computer control.`
    const clash = Object.keys(HOTKEY_LABELS).find(other => other !== name && wanted[other] === wanted[name])
    if (clash) return `${wanted[name]} is already ${HOTKEY_LABELS[clash]}.`
  }
  return null
}

/** Why a change to how the bot talks cannot be made, or null. */
const checkLive = patch => {
  const l = rec(patch)
  if ('speak' in l && !SPEAK_MODES.includes(l.speak)) return `Speaking replies is one of: ${SPEAK_MODES.join(', ')}.`
  for (const key of ['followUp', 'review']) if (key in l && typeof l[key] !== 'boolean') return `${key} is on or off.`
  if ('voice' in l && (typeof l.voice !== 'string' || l.voice.length > 60)) return 'The voice is the name of a Windows voice, such as Microsoft Zira Desktop.'
  if ('rate' in l && !(Number.isInteger(l.rate) && l.rate >= VOICE_RATE_RANGE[0] && l.rate <= VOICE_RATE_RANGE[1])) return `The speaking speed is a whole number from ${VOICE_RATE_RANGE[0]} to ${VOICE_RATE_RANGE[1]}.`
  return null
}

/** Why a change to Mini's own session cannot be made, or null. */
const checkAssistant = patch => {
  const a = rec(patch)
  for (const key of ['session', 'offered']) if (key in a && typeof a[key] !== 'boolean') return `${key} is on or off.`
  if ('model' in a && a.model !== '' && modelName(a.model) === null) return 'The model is a name Claude Code knows, such as sonnet, opus or haiku, or "default".'
  if ('permissions' in a && !SESSION_PERMISSIONS.includes(a.permissions)) return `The session's permission mode is one of: ${SESSION_PERMISSIONS.join(', ')}.`
  return null
}

/** Why a change to the computer-control settings cannot be made, or null. */
const checkComputer = (config, patch) => {
  const c = rec(patch)
  if ('level' in c && !CONTROL_LEVELS.includes(c.level)) return `The control level is one of: ${CONTROL_LEVELS.join(', ')}.`
  if ('stopKey' in c) {
    const key = parseHotkey(c.stopKey)
    if (key === null || key === 'off') return 'The stop key is Ctrl, Alt or Win with a letter, a digit, F1-F12, Esc or Pause, for example Ctrl+Alt+Esc. It cannot be turned off.'
    for (const [name, label] of Object.entries(HOTKEY_LABELS)) if (key === config.hotkey[name]) return `${key} is already ${label}.`
  }
  if ('blockedApps' in c && !(Array.isArray(c.blockedApps) && c.blockedApps.length <= MAX_BLOCKED_APPS && c.blockedApps.every(a => appName(a) !== null))) {
    return `Blocked apps are program names such as "chrome" or "outlook", ${MAX_BLOCKED_APPS} at most.`
  }
  for (const [key, [min, max], label] of [['maxActions', CONTROL_ACTIONS_RANGE, 'The action limit'], ['maxMinutes', CONTROL_MINUTES_RANGE, 'The time limit']]) {
    if (key in c && !(Number.isInteger(c[key]) && c[key] >= min && c[key] <= max)) return `${label} is a whole number from ${min} to ${max}.`
  }
  return null
}

/** Applies changes that belong to the whole companion rather than one bot. */
export const patchSettings = (config, patch) => {
  const p = rec(patch)
  const extra = Object.keys(p).find(k => !SETTINGS_KEYS.includes(k))
  if (extra) return { error: `Unknown setting "${extra}".` }
  const bad = checkHotkeys(config, p.hotkey) ?? checkComputer(config, p.computer) ?? checkLive(p.live) ?? checkAssistant(p.assistant)
  if (bad) return { error: bad }
  const merged = {
    ...config,
    ...('onboarded' in p ? { onboarded: p.onboarded } : {}),
    ...('visible' in p ? { visible: p.visible } : {}),
    sound: { ...config.sound, ...rec(p.sound) },
    notifications: { ...config.notifications, ...rec(p.notifications) },
    startup: { ...config.startup, ...rec(p.startup) },
    display: { ...config.display, ...rec(p.display) },
    hotkey: { ...config.hotkey, ...rec(p.hotkey) },
    computer: { ...config.computer, ...rec(p.computer) },
    live: { ...config.live, ...rec(p.live) },
    assistant: { ...config.assistant, ...rec(p.assistant) },
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
