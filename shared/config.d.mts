export declare const AVATARS: readonly ['clawd', 'blob', 'robot', 'cat', 'ghost', 'bunny']
export declare const SKINS: readonly ['claude', 'sunrise', 'ocean', 'forest', 'berry', 'slate']
export declare const SIZES: readonly ['small', 'medium', 'large']
export declare const IDLE_STYLES: readonly ['none', 'subtle', 'lively']
export declare const SPEEDS: readonly ['slow', 'normal', 'fast']
export declare const TONES: readonly ['neutral', 'cheerful', 'calm', 'playful']
export declare const ANCHORS: readonly ['bottom-right', 'bottom-left', 'top-right', 'top-left']
export declare const STARTUP_MODES: readonly ['manual', 'restore', 'always']
export declare const MODEL_LABELS: readonly ['full', 'model', 'off']
export declare const ACCENTS: readonly ['claude', 'blue', 'green', 'pink', 'orange', 'purple']
export declare const CONFIG_VERSION: 2
export declare const THEMES: readonly ['dark', 'light']
export declare const PANEL_WIDTH_RANGE: readonly [number, number]
export declare const PANEL_REPLY_RANGE: readonly [number, number]
export declare const MAX_PROFILES: number
export declare const MAX_NAME: number
export declare const MAX_NOTES: number

export type Avatar = (typeof AVATARS)[number]
export type Skin = (typeof SKINS)[number]
export type Size = (typeof SIZES)[number]
export type IdleStyle = (typeof IDLE_STYLES)[number]
export type Speed = (typeof SPEEDS)[number]
export type Tone = (typeof TONES)[number]
export type Anchor = (typeof ANCHORS)[number]
export type StartupMode = (typeof STARTUP_MODES)[number]
export type ModelLabel = (typeof MODEL_LABELS)[number]
export type Accent = (typeof ACCENTS)[number]
export type Theme = (typeof THEMES)[number]

export type Position = { anchor: Anchor } | { anchor: 'custom'; x: number; y: number }

/** What one bot looks like and how it moves. Nothing here reaches Claude. */
export type Profile = {
  id: string
  name: string
  avatar: Avatar
  appearance: { skin: Skin; size: Size; opacity: number; accent: Accent; theme: Theme }
  /** `idle` is the animation intensity. */
  animation: { idle: IdleStyle; speed: Speed; reducedMotion: boolean }
  position: Position
  /** The chat panel's size at 100% scaling; `replyHeight` is the reply area only. `autoFit` lets it grow for long replies. */
  panel: { width: number; replyHeight: number; autoFit: boolean }
  /** Flavour for the character's own bubbles. Never added to Claude's prompt. */
  personality: { tone: Tone; notes: string }
}

export type Config = {
  version: 2
  revision: number
  activeProfileId: string
  profiles: Profile[]
  visible: boolean
  onboarded: boolean
  sound: { voice: boolean; effects: boolean; volume: number }
  notifications: { enabled: boolean; onTurnComplete: boolean; onAccessChange: boolean }
  startup: { mode: StartupMode; stopWithSession: boolean }
  display: { modelLabel: ModelLabel }
  wasRunning: boolean
}

export type ProfilePatch = {
  name?: string
  avatar?: Avatar
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
export declare function sameChoices(a: Config, b: Config): boolean
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
