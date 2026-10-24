// The person's choices, kept in the mod's store.
//
// The defaults, the checking of stored data and every rule for changing a
// profile are in shared/config.mjs, the same file the companion runtime uses.
// Here are only the store and a flag for changes the runtime has not seen yet.

import { defaultConfig, defaultProfile, normalizeConfig, sameChoices } from '../../shared/config.mjs'
import type { Config, Engine } from './types'

export { defaultConfig, defaultProfile, normalizeConfig, sameChoices }

const STORE_KEY = 'config'
const DIRTY_KEY = 'unsent'

/** Reads what was stored (or nothing) as a complete, valid configuration. */
export async function loadConfig($: Engine): Promise<Config> {
  return normalizeConfig(await $.store.get(STORE_KEY))
}

export async function saveConfig($: Engine, config: Config): Promise<void> {
  await $.store.set(STORE_KEY, config)
}

/** Whether a change was made while the companion was not running, and still has to be sent. */
export async function hasUnsentChange($: Engine): Promise<boolean> {
  return (await $.store.get(DIRTY_KEY)) === true
}

export async function setUnsentChange($: Engine, isUnsent: boolean): Promise<void> {
  await $.store.set(DIRTY_KEY, isUnsent)
}
