// Wiring only: the command, the session start and end, the once-a-second pick-up
// of prompts from the floating bot, the reports of what Claude Code is doing, and
// the computer-control tools (served in lib/computer, decided by the companion).
// The work lives in lib/: config and profiles (what the person chose), client and
// lifecycle (the companion), bridge (prompts and activity), visibility,
// permissions, and the menus.

import type { Register } from 'claude-code'

import { commandCheck, modelCheck, pump, stepStarted, toolFinished, toolStarted, turnEnded, turnStarted } from './lib/bridge'
import { connect } from './lib/client'
import { controlTool, endControl, serveControl, TOOLS } from './lib/computer'
import { loadConfig } from './lib/config'
import { runCommand } from './lib/commands'
import { startRuntime, stopRuntime, syncConfig } from './lib/lifecycle'
import { dispatchPrompt } from './lib/slash'
import { refreshStatus } from './lib/status'
import type { Engine } from './lib/types'

const TICK_MS = 1000
const STATUS_EVERY = 5

/** Brings the companion back as the person left it, then keeps the status line honest. */
async function resume($: Engine) {
  try {
    const config = await loadConfig($)
    const link = await connect($)
    if (link) {
      // A companion that outlived the last session: reconnect and bring the two copies of the settings together.
      await syncConfig($, link)
    } else if (config.startup.mode === 'always' || (config.startup.mode === 'restore' && config.wasRunning)) {
      const started = await startRuntime($)
      if (!started.ok) $.ui.log(started.message)
    }
    await refreshStatus($)
  } catch {
    // The companion is optional: a failure here never gets in the way of the session.
  }
}

let isTicking = false
let ticks = 0

/** Once a second: pick up what was typed into the floating bot, and now and then refresh the status line. */
async function tick($: Engine) {
  if (isTicking) return
  isTicking = true
  try {
    // Not waited for: a command can take a while, and asking for new prompts goes on.
    for (const prompt of await pump($)) void dispatchPrompt($, prompt).catch(() => {})
    ticks += 1
    if (ticks % STATUS_EVERY === 0) {
      await refreshStatus($)
      await modelCheck($)
      await commandCheck($)
    }
  } catch {
    // Try again next second.
  } finally {
    isTicking = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mini-bot',
      description: 'Manage your Mini Bot: hide, settings, permissions, change bot, start or stop',
      argumentHint: '[hide|show|start|stop|status|settings|permissions|switch|create|bot|help]',
    })
    // Claude's tools for using the mouse and keyboard. Each asks the person in the bot before anything happens.
    for (const tool of TOOLS) {
      try {
        await $.tool.register({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as unknown as Record<string, unknown> })
      } catch {}
    }
    void resume($)
    $.clock.every(TICK_MS, () => tick($))

    return next(e)
  })

  on('command.run', { command: 'mini-bot' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  // What Claude Code is really doing, for the bot to show. These only report: they never change a turn.
  on('turn.start', async ($, e, next) => {
    void turnStarted($, e).catch(() => {})

    return next(e)
  })

  // Each request of the main conversation names its model and effort: noted for the bot to show, never changed.
  on('turn.step', async function* ($, e, next) {
    void stepStarted($, e).catch(() => {})

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    void toolStarted($, String(e.tool)).catch(() => {})
    try {
      const control = controlTool(String(e.tool))
      if (control) return await serveControl($, control, e as unknown as Record<string, unknown>, next.signal)
      return await next(e)
    } finally {
      void toolFinished($).catch(() => {})
    }
  })

  on('turn.complete', async ($, e, next) => {
    void turnEnded($, e).catch(() => {})
    // Control of the mouse and keyboard never outlives the turn that asked for it: it is over before the turn is.
    if (e.agentId === undefined) {
      try {
        await endControl($, 'the turn ended')
      } catch {}
    }

    return next(e)
  })

  // Only the companion is stopped, and only if the person asked for that; it is
  // remembered as running, so the next session brings it back.
  on('session.end', async ($, e, next) => {
    try {
      await endControl($, 'the session ended')
    } catch {}
    if (e.reason !== 'clear') {
      try {
        if ((await loadConfig($)).startup.stopWithSession) await stopRuntime($, { remember: true })
      } catch {}
    }

    return next(e)
  })
}
