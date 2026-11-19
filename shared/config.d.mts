export declare const AVATARS: readonly ['clawd', 'blob', 'robot', 'cat', 'ghost', 'bunny']
export declare const SKINS: readonly ['claude', 'sunrise', 'ocean', 'forest', 'berry', 'slate']
export declare const SIZES: readonly ['small', 'medium', 'large']
export declare const IDLE_STYLES: readonly ['none', 'subtle', 'lively']
export declare const SPEEDS: readonly ['slow', 'normal', 'fast']
export declare const TONES: readonly ['neutral', 'cheerful', 'calm', 'playful']
export declare const ANCHORS: readonly ['bottom-right', 'bottom-left', 'top-right', 'top-left']
export declare const STARTUP_MODES: readonly ['manual', 'restore', 'always']
export declare const MODEL_LABELS: readonly ['full', 'model', 'off']
export declare const DEFAULT_HOTKEY: 'Ctrl+Alt+B'
export declare const CONTROL_LEVELS: readonly ['step', 'important', 'free']
export declare const DEFAULT_STOP_KEY: 'Ctrl+Alt+Esc'
export declare const MAX_BLOCKED_APPS: number
export declare const CONTROL_ACTIONS_RANGE: readonly [number, number]
export declare const CONTROL_MINUTES_RANGE: readonly [number, number]
export declare const DEFAULT_TALK_KEY: 'Ctrl+Alt+Space'
export declare const DEFAULT_LOOK_KEY: 'Ctrl+Alt+Q'
export declare const DEFAULT_SUMMARIZE_KEY: 'Ctrl+Alt+S'
export declare const DEFAULT_TERMINAL_KEY: 'Ctrl+Alt+T'
export declare const CUSTOM_AVATAR: 'custom'
export declare const SPRITE_SIZE_RANGE: readonly [number, number]
export declare const SPRITE_STATES: readonly ['idle', 'blink', 'listening', 'thinking', 'working', 'done', 'error']
export declare const MAX_SPRITE_COLORS: number
export declare const MAX_SPRITE_FRAMES: number
export declare const SPEAK_MODES: readonly ['spoken', 'always', 'off']
export declare const VOICE_RATE_RANGE: readonly [number, number]
export declare const SESSION_PERMISSIONS: readonly ['auto', 'acceptEdits', 'manual']
export declare const ACCENTS: readonly ['claude', 'blue', 'green', 'pink', 'orange', 'purple']
export declare const CONFIG_VERSION: 4
export declare const THEMES: readonly ['dark', 'light']
export declare const PANEL_WIDTH_RANGE: readonly [number, number]
export declare const PANEL_REPLY_RANGE: readonly [number, number]
export declare const MAX_PROFILES: number
export declare const MAX_NAME: number
export declare const MAX_NOTES: number

/** One of the built-in characters, or 'custom' for a bot drawn from its own pixel art. */
export type Avatar = (typeof AVATARS)[number] | 'custom'
/** A colour written like "#3fa7d6". */
export type HexColor = `#${string}`
export type Skin = (typeof SKINS)[number] | HexColor
export type SpriteState = (typeof SPRITE_STATES)[number]
/** A bot's own pixel art: a grid of cells, a few colours, and one picture or a few for each state. Only idle is required. */
export type Sprite = {
  width: number
  height: number
  palette: Record<string, HexColor>
  frames: { idle: string[][] } & Partial<Record<SpriteState, string[][]>>
}
export type Size = (typeof SIZES)[number]
export type IdleStyle = (typeof IDLE_STYLES)[number]
export type Speed = (typeof SPEEDS)[number]
export type Tone = (typeof TONES)[number]
export type Anchor = (typeof ANCHORS)[number]
export type StartupMode = (typeof STARTUP_MODES)[number]
export type ModelLabel = (typeof MODEL_LABELS)[number]
export type ControlLevel = (typeof CONTROL_LEVELS)[number]
export type SpeakMode = (typeof SPEAK_MODES)[number]
export type SessionPermissions = (typeof SESSION_PERMISSIONS)[number]
export type Accent = (typeof ACCENTS)[number] | HexColor
export type Theme = (typeof THEMES)[number]

export type Position = { anchor: Anchor } | { anchor: 'custom'; x: number; y: number }

/** What one bot looks like, how it moves and how it talks. Only the personality reaches Claude, with what is sent from the bot. */
export type Profile = {
  id: string
  name: string
  avatar: Avatar
  /** Its own pixel art, if it was given any. Kept while it wears another avatar. */
  sprite?: Sprite
  appearance: { skin: Skin; size: Size; opacity: number; accent: Accent; theme: Theme }
  /** `idle` is the animation intensity. */
  animation: { idle: IdleStyle; speed: Speed; reducedMotion: boolean }
  position: Position
  /** The chat panel's size at 100% scaling; `replyHeight` is the reply area only. `autoFit` lets it grow for long replies. */
  panel: { width: number; replyHeight: number; autoFit: boolean }
  /** How the bot talks. A tone other than neutral, and the notes, go to Claude as a short note with what is sent from the bot. */
  personality: { tone: Tone; notes: string }
}

export type Config = {
  version: 4
  revision: number
  activeProfileId: string
  profiles: Profile[]
  visible: boolean
  onboarded: boolean
  sound: { voice: boolean; effects: boolean; volume: number }
  notifications: { enabled: boolean; onTurnComplete: boolean; onAccessChange: boolean }
  startup: { mode: StartupMode; stopWithSession: boolean }
  display: { modelLabel: ModelLabel }
  /** Shortcuts that work from any program, written like "Ctrl+Alt+M", or "off": hide and show the bot, talk, show Claude the window in front, summarize the page in front, open Claude Code's own window. */
  hotkey: { toggle: string; talk: string; look: string; summarize: string; terminal: string }
  /** Live talking: when replies are said aloud, listening on after a reply, checking what was heard before it goes, the Windows voice (empty for its default) and speed. */
  live: { speak: SpeakMode; followUp: boolean; review: boolean; voice: string; rate: number }
  /** Mini's own Claude Code session: whether the companion keeps one running, whether the person has been offered it, its model (empty for the default) and permission mode. */
  assistant: { session: boolean; offered: boolean; model: string; permissions: SessionPermissions }
  /** Computer control's limits. `blockedApps` are program names ("outlook"), added to the ones always blocked. */
  computer: { level: ControlLevel; stopKey: string; blockedApps: string[]; maxActions: number; maxMinutes: number }
  wasRunning: boolean
}

export type ProfilePatch = {
  name?: string
  avatar?: Avatar
  /** New pixel art, or null to take it away. */
  sprite?: Sprite | null
  appearance?: Partial<Profile['appearance']>
  animation?: Partial<Profile['animation']>
  position?: Position
  panel?: Partial<Profile['panel']>
  personality?: Partial<Profile['personality']>
}

export type SettingsPatch = {
  sound?: Partial<Config['sound']>
  notifications?: Partial<Config['notifications']>
  startup?: Partial<Config['startup']>
  display?: Partial<Config['display']>
  hotkey?: Partial<Config['hotkey']>
  computer?: Partial<Config['computer']>
  live?: Partial<Config['live']>
  assistant?: Partial<Config['assistant']>
  onboarded?: boolean
  visible?: boolean
}

export type Result = { config: Config; message: string } | { error: string }

export type Op =
  | { op: 'create'; name: string; copyOf?: string }
  | { op: 'select'; id: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'delete'; id: string }
  | { op: 'update'; id?: string; patch: ProfilePatch }
  | { op: 'settings'; patch: SettingsPatch }
  | { op: 'move'; x: number; y: number }
  | { op: 'resize'; width: number; replyHeight: number }

export declare function defaultProfile(id?: string, name?: string): Profile
export declare function defaultConfig(): Config
export declare function normalizeProfile(raw: unknown, index?: number, legacyPosition?: unknown): Profile
export declare function normalizeConfig(raw: unknown): Config
/** A shortcut in its one spelling ("Ctrl+Alt+M"), 'off', or null when it cannot be used. */
export declare function parseHotkey(raw: unknown): string | null
/** A colour written "#3fa7d6" in its one spelling, or null. */
export declare function hexColor(raw: unknown): HexColor | null
/** A bot's pixel art, checked: the sprite in its one form, or what is wrong with it. */
export declare function checkSprite(raw: unknown): { sprite: Sprite } | { error: string }
/** A program's name as compared ("EXCEL.EXE" is "excel"), or null when it is not a usable name. */
export declare function appName(raw: unknown): string | null
/** A model name as Claude Code takes it after --model, or null. */
export declare function modelName(raw: unknown): string | null
export declare function sameChoices(a: Config, b: Config): boolean
/** A whole copy of the settings from Claude Code's side, with what that copy cannot hold (a bot's own art and colours, the newer shortcuts) kept from the current settings. */
export declare function keepWhatACopyCannotHold(incoming: unknown, current: Config): unknown
/** A short mark of what the settings say, ignoring their revision. */
export declare function configKey(config: Config): string
export declare function activeProfile(config: Config): Profile
export declare function findProfile(config: Config, query: string): Profile | undefined
export declare function checkName(config: Config, name: string, exceptId?: string): { name: string } | { error: string }
export declare function selectProfile(config: Config, id: string): Result
export declare function createProfile(config: Config, name: string, copyOf?: string): Result
export declare function renameProfile(config: Config, id: string, name: string): Result
export declare function deleteProfile(config: Config, id: string): Result
export declare function checkPatch(patch: unknown): string | null
export declare function patchProfile(config: Config, id: string, patch: ProfilePatch): Result
export declare function patchSettings(config: Config, patch: SettingsPatch): Result
export declare function applyOp(config: Config, op: unknown): Result
/** A bot designed from a description, checked: the profile it would be, or what is wrong with the design. */
export declare function designBot(config: Config, spec: unknown): { profile: Profile; isNew: boolean } | { error: string }
/** Adds a designed bot, or changes the one it redesigns, and switches to it. */
export declare function adoptBot(config: Config, profile: Profile): Result
