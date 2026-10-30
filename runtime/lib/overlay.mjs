// The overlay window driver.
//
// The overlay is a separate process that reads the runtime's state over the
// same authenticated interface and draws it. Here it is only started and
// stopped; the runtime owns every decision about what it shows.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../overlay.ps1', import.meta.url))

/** A driver that draws nothing, for tests and non-Windows hosts. */
export const noOverlay = () => ({
  name: 'none',
  start() {},
  stop() {},
  get isAttached() {
    return false
  },
})

export const windowsOverlay = () => {
  let child = null
  return {
    name: 'winforms',
    start({ url, token, overlayKey }) {
      if (child) return
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
        { env: { ...process.env, MINI_BOT_URL: url, MINI_BOT_TOKEN: token, MINI_BOT_OVERLAY_KEY: overlayKey }, stdio: 'ignore', windowsHide: true },
      )
      child.on('exit', () => {
        child = null
      })
    },
    stop() {
      child?.kill()
      child = null
    },
    get isAttached() {
      return child !== null
    },
  }
}

export const defaultOverlay = () => (process.platform === 'win32' ? windowsOverlay() : noOverlay())
