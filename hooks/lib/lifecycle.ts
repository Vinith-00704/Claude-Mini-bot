// Starting and stopping the companion: the overlay and its runtime, and
// nothing else. Claude Code is never signalled, restarted or touched here; the
// only thing stopped is the process the runtime's own interface says is the
// runtime.
//
// This module also keeps the mod's copy of the configuration and the
// companion's together. Both can change it (a typed command here, the floating
// UI there), so each copy counts its accepted changes in `revision` and the one
// with more wins; a change made here while the companion was down always wins.

import { connect, dataDir, request, type Link } from './client'
import { hasUnsentChange, loadConfig, normalizeConfig, saveConfig, setUnsentChange } from './config'
import type { Config, Engine, RuntimeState } from './types'

const START_WAIT_MS = 8000
const STOP_WAIT_MS = 4000
const STEP_MS = 250

/** Sends the whole local copy to a running companion. Resolves its report, or null if there is none. */
export async function pushConfig($: Engine, config: Config, link?: Link | null): Promise<RuntimeState | null> {
  const target = link ?? (await connect($))
  if (!target) return null
  const reply = await request<RuntimeState>($, target, 'PUT', '/v1/config', config)
  return reply.ok ? reply.data : null
}

/** Keeps a changed configuration and hands it to the companion if it is up, else remembers to send it later. */
export async function commit($: Engine, config: Config): Promise<void> {
  const reported = await pushConfig($, config)
  if (reported) {
    // The companion's copy carries the revision it assigned.
    await saveConfig($, { ...reported.config, wasRunning: config.wasRunning })
    await setUnsentChange($, false)
  } else {
    await saveConfig($, config)
    await setUnsentChange($, true)
  }
}

/** Takes the companion's copy as the local one (what the person changed in the floating UI). */
export async function adoptRuntimeConfig($: Engine, state: RuntimeState): Promise<void> {
  const local = await loadConfig($)
  const next = { ...normalizeConfig(state.config), wasRunning: local.wasRunning }
  if (JSON.stringify(next) !== JSON.stringify(local)) await saveConfig($, next)
}

/** After connecting: sends the local copy if it is the newer one, otherwise takes the companion's. */
export async function syncConfig($: Engine, link: Link): Promise<void> {
  const reply = await request<RuntimeState>($, link, 'GET', '/v1/state')
  if (!reply.ok) return
  const local = await loadConfig($)
  if ((await hasUnsentChange($)) || local.revision > reply.data.config.revision) await commit($, local)
  else if (reply.data.config.revision > local.revision) await adoptRuntimeConfig($, reply.data)
}

async function waitFor($: Engine, isDone: () => Promise<boolean>, ms: number) {
  for (let waited = 0; waited < ms; waited += STEP_MS) {
    if (await isDone()) return true
    await $.clock.sleep(STEP_MS)
  }
  return isDone()
}

async function rememberRunning($: Engine, wasRunning: boolean) {
  const config = await loadConfig($)
  if (config.wasRunning !== wasRunning) await saveConfig($, { ...config, wasRunning })
}

export async function startRuntime($: Engine): Promise<{ ok: boolean; message: string }> {
  const existing = await connect($)
  if (existing) {
    await syncConfig($, existing)
    await rememberRunning($, true)
    return { ok: true, message: 'Mini Bot is already running; reconnected.' }
  }
  const node = (await $.env.get('MINI_BOT_NODE')) ?? 'node'
  const script = `${$.plugin.root}/runtime/server.mjs`
  try {
    const launched = await $.process.run([node, script, '--detach'], { timeoutMs: 10_000 })
    if (launched.exitCode !== 0) {
      return { ok: false, message: `Could not start the companion (${node} exited ${launched.exitCode}). Is Node.js installed?` }
    }
  } catch {
    return { ok: false, message: `Could not start the companion: "${node}" was not found. Install Node.js, or set MINI_BOT_NODE.` }
  }
  let link: Link | null = null
  const isUp = await waitFor($, async () => (link = await connect($)) !== null, START_WAIT_MS)
  if (!isUp || !link) {
    return { ok: false, message: `The companion did not come up within ${START_WAIT_MS / 1000}s (state folder: ${await dataDir($)}).` }
  }
  await syncConfig($, link)
  await rememberRunning($, true)
  return { ok: true, message: 'Mini Bot started.' }
}

/**
 * Asks the runtime to stop. It ends any screen or microphone capture and drops
 * every access grant before it exits. With `remember: false` the next session
 * will not restore it on its own.
 */
export async function stopRuntime($: Engine, { remember = false } = {}): Promise<{ ok: boolean; message: string }> {
  const link = await connect($)
  await rememberRunning($, remember)
  if (!link) return { ok: true, message: 'Mini Bot is not running.' }
  const reply = await request($, link, 'POST', '/v1/shutdown', {})
  if (!reply.ok) return { ok: false, message: `The companion refused to stop: ${reply.error}.` }
  const gone = await waitFor($, async () => (await connect($)) === null, STOP_WAIT_MS)
  return gone
    ? { ok: true, message: 'Mini Bot stopped. Screen, microphone and computer access ended with it; Claude Code is untouched.' }
    : { ok: false, message: 'Asked the companion to stop but it is still answering.' }
}
