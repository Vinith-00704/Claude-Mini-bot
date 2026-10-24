// Profile management: the same pure functions the floating UI's changes go
// through in the runtime. Nothing here talks to the runtime or to Claude Code,
// so switching, renaming or deleting a profile cannot touch the session.

export {
  MAX_PROFILES,
  activeProfile,
  checkName,
  createProfile,
  deleteProfile,
  findProfile,
  patchProfile,
  patchSettings,
  renameProfile,
  selectProfile,
} from '../../shared/config.mjs'
export type { Result } from '../../shared/config.mjs'
