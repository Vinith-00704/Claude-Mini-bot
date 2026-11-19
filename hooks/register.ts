// Wiring only: the command, the session start and end, the once-a-second pick-up
// of prompts from the floating bot, the reports of what Claude Code is doing, and
// the computer-control tools (served in lib/computer, decided by the companion).
// The work lives in lib/: config and profiles (what the person chose), client and
// lifecycle (the companion), bridge (prompts and activity), visibility,
// permissions, and the menus.

import type { Register } from 'claude-code'

import { answerPermission, guardFullAccess, isMainSession, wasTurnedOff } from './lib/assistant'
import { commandCheck, modelCheck, pump, replyPiece, stepStarted, toolFinished, toolStarted, turnEnded, turnStarted } from './lib/bridge'
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
    } else if (!(await wasTurnedOff($)) && (config.startup.mode === 'always' || (config.startup.mode === 'restore' && config.wasRunning))) {
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
      description: 'Manage your Mini Bot: hide, settings, permissions, change or design a bot, summarize the page in front, start or stop',
      argumentHint: '[hide|show|start|stop|status|settings|permissions|summarize|design|terminal|switch|create|bot|help]',
    })
    // Claude's tools: the mouse and keyboard, the screen, the page in front, routines, designing a bot. What touches
    // the person's PC or changes their bot asks them in the bot first.
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
  // Its text is passed on as it comes, for a turn the bot started, and every piece goes on exactly as it came.
  on('turn.step', async function* ($, e, next) {
    void stepStarted($, e).catch(() => {})
    const stream = next(e)
    for await (const piece of stream) {
      try {
        replyPiece($, e, piece as { kind?: string; text?: string })
      } catch {
        // Showing the reply early is a nicety: it never gets in the way of the reply.
      }
      yield piece
    }

    return await stream.result
  })

  on('tool.call', async ($, e, next) => {
    void toolStarted($, String(e.tool)).catch(() => {})
    try {
      const control = controlTool(String(e.tool))
      if (control) return await serveControl($, control, e as unknown as Record<string, unknown>, next.signal)
      // Full access is not a blank cheque: deleting, adding or changing things still goes to the person first.
      const refused = await guardFullAccess($, e as unknown as Record<string, unknown>, next.signal)
      if (refused) return refused
      return await next(e)
    } finally {
      void toolFinished($).catch(() => {})
    }
  })

  // Nobody sits at the terminal of Mini's own session, so what Claude Code would ask there is asked in the bot, and
  // only the person's click there answers it. In a terminal session Claude Code's own dialog comes up as usual.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (!(await isMainSession($))) return next(e)
    return answerPermission($, e, next.signal)
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
        // Mini's own session ending says nothing about the companion, which started it and will start it again.
        if ((await loadConfig($)).startup.stopWithSession && !(await isMainSession($))) await stopRuntime($, { remember: true })
      } catch {}
    }

    return next(e)
  })
}
