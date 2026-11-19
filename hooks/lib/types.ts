import type { EngineInterface } from 'claude-code'
import type { Config } from '../../shared/config.mjs'

export type Engine = EngineInterface

// What a bot is and what the person has chosen lives in shared/config.mjs, which
// the companion runtime uses too.
export {
  ACCENTS,
  ANCHORS,
  AVATARS,
  CUSTOM_AVATAR,
  checkSprite,
  designBot,
  hexColor,
  DEFAULT_SUMMARIZE_KEY,
  DEFAULT_TERMINAL_KEY,
  MAX_SPRITE_COLORS,
  MAX_SPRITE_FRAMES,
  SPRITE_SIZE_RANGE,
  SPRITE_STATES,
  CONTROL_ACTIONS_RANGE,
  CONTROL_LEVELS,
  CONTROL_MINUTES_RANGE,
  DEFAULT_HOTKEY,
  DEFAULT_LOOK_KEY,
  DEFAULT_STOP_KEY,
  DEFAULT_TALK_KEY,
  appName,
  modelName,
  SESSION_PERMISSIONS,
  SPEAK_MODES,
  VOICE_RATE_RANGE,
  IDLE_STYLES,
  MODEL_LABELS,
  PANEL_REPLY_RANGE,
  PANEL_WIDTH_RANGE,
  parseHotkey,
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
  ControlLevel,
  IdleStyle,
  ModelLabel,
  Op,
  Position,
  Profile,
  ProfilePatch,
  Result,
  SessionPermissions,
  SettingsPatch,
  SpeakMode,
  Sprite,
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
  indicator: { visible: boolean; kinds: Kind[]; standby?: boolean }
  /** What the person allowed for good, in the bot (absent from a companion that predates it). */
  trust?: { listen: boolean; full: boolean; mic: boolean }
  /** Mini's own Claude Code session (absent from a companion that predates it). */
  assistant?: { status: 'off' | 'starting' | 'running' | 'needs-you' | 'failed'; wanted: boolean; pid: number | null; sessionId: string | null; note: string; home: string; startsWithPc: boolean }
  /** The Claude Code sessions connected now, and which one the bot talks to. */
  sessions?: { id: string; role: 'main' | 'terminal'; name: string; target: boolean; pinned: boolean }[]
  /** How many routines there are. */
  routines?: number
  activity: { phase: Phase; id: string | null; detail: string; source: 'bot' | 'claude' }
  voice: { state: 'idle' | 'listening' | 'standby'; error: string | null; heard: string | null }
  /** What the session runs on, once it has said (absent from a companion that predates it). Ages are in milliseconds. */
  session?: { model: string; name: string; effort: string | null; ageMs: number; switched: { from: string; to: string; ageMs: number } | null } | null
  /** Computer control as the companion has it (absent from a companion that predates it). */
  computer?: {
    status: 'off' | 'asking' | 'running' | 'paused'
    task: string | null
    apps: string[]
    level: string | null
    actions: number
    last: { task: string; apps: string[]; actions: number; endedReason: string; summary: string; endedAt: number } | null
  }
  /** Whether Windows gave the overlay the hide/show shortcut now chosen; null until the overlay says (or for a companion that predates it). */
  hotkey?: { combo: string; ok: boolean } | null
  /** The same for the other shortcuts, by name (talk, look, summarize, terminal), once the overlay has said. */
  keys?: Record<string, { combo: string; ok: boolean }>
  bridge: { connected: boolean; queued: number }
}

/**
 * What can ride along with a prompt: a screenshot the companion saved, or the path of a file or
 * folder the person dropped on the bot. `direct` is false for a type Claude's Read tool may not open.
 */
export type Attachment =
  | { type: 'image'; path: string }
  | { type: 'file'; path: string; kind: 'file' | 'folder'; direct: boolean }

/** A prompt typed or spoken into the floating bot, waiting for Claude Code. */
export type QueuedPrompt = { id: string; text: string; source: 'text' | 'voice' | 'routine'; attachments?: Attachment[]; at: number }

/** The oldest runtime that has the prompt queue and the shared configuration. */
export const MIN_RUNTIME_VERSION = 2
