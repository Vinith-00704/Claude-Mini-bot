import type { EngineInterface } from 'claude-code'
import type { Config } from '../../shared/config.mjs'

export type Engine = EngineInterface

// What a bot is and what the person has chosen lives in shared/config.mjs, which
// the companion runtime uses too.
export {
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
} from '../../shared/config.mjs'
export type {
  Accent,
  Anchor,
  Avatar,
  Config,
  IdleStyle,
  Op,
  Position,
  Profile,
  ProfilePatch,
  Result,
  SettingsPatch,
  Size,
  Skin,
  Speed,
  StartupMode,
  Theme,
  Tone,
} from '../../shared/config.mjs'

export const KINDS = ['screen', 'microphone', 'computer'] as const
export type Kind = (typeof KINDS)[number]

export type Access = {
  granted: boolean
  grantedAt: number | null
  active: boolean
  activeSince: number | null
}

export type Phase = 'idle' | 'sending' | 'thinking' | 'working' | 'completed' | 'error'

/** What the runtime reports. The runtime is the authority on all of this. */
export type RuntimeState = {
  running: true
  version: number
  pid: number
  startedAt: number
  config: Config
  overlay: { visible: boolean; driver: string; isAttached: boolean }
  permissions: Record<Kind, Access>
  indicator: { visible: boolean; kinds: Kind[] }
  activity: { phase: Phase; id: string | null; detail: string; source: 'bot' | 'claude' }
  voice: { state: 'idle' | 'listening'; error: string | null; heard: string | null }
  bridge: { connected: boolean; queued: number }
}

/** A screenshot taken with the bot, saved by the companion (it accepts no other file). */
export type Attachment = { type: 'image'; path: string }

/** A prompt typed or spoken into the floating bot, waiting for Claude Code. */
export type QueuedPrompt = { id: string; text: string; source: 'text' | 'voice'; attachments?: Attachment[]; at: number }

/** The oldest runtime that has the prompt queue and the shared configuration. */
export const MIN_RUNTIME_VERSION = 2
