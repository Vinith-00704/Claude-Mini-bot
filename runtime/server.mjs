// Entry point of the companion runtime.
//
//   node server.mjs --detach   start a background runtime and return at once
//   node server.mjs --serve    run the runtime in this process
//   --pc-start after either    it is the PC starting up, so Mini's own session waits for the rush to pass
//
// Runs on Node alone, with no packages. Its state lives in %APPDATA%\ClaudeMiniBot
// (or ~/.claude-mini-bot elsewhere); MINI_BOT_HOME overrides the folder.
//
// On an Android phone it is started by the Mini app's start script only, with MINI_BOT_OVERLAY=external: the app is
// the overlay, and its keys (the overlay key, the address of its hands and their token) arrive as one line of JSON on
// standard input. They are held in memory only.

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { platformFor } from './lib/platform.mjs'
import { createRuntime } from './lib/runtime.mjs'

// The keys line: short, and soon. The app's start script writes it as soon as the runtime is started.
const KEYS_MAX_BYTES = 1024
const KEYS_WAIT_MS = 10 * 1000
const HEX_KEY = /^[0-9a-f]{64}$/
const HANDS_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

const dataDir = () =>
  process.env.MINI_BOT_HOME ??
  (process.env.APPDATA ? join(process.env.APPDATA, 'ClaudeMiniBot') : join(homedir(), '.claude-mini-bot'))

const isAlreadyRunning = async () => {
  try {
    const info = JSON.parse(await readFile(join(dataDir(), 'runtime.json'), 'utf8'))
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`, {
      headers: { authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** One line from standard input, or null: too long, too late, or closed first. Nothing of it is ever logged. */
const readLine = () =>
  new Promise(done => {
    const chunks = []
    let size = 0
    let finished = false
    const finish = line => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      process.stdin.removeAllListeners('data')
      process.stdin.destroy()
      done(line)
    }
    const timer = setTimeout(() => finish(null), KEYS_WAIT_MS)
    process.stdin.on('data', chunk => {
      chunks.push(chunk)
      size += chunk.length
      const text = Buffer.concat(chunks)
      const end = text.indexOf(0x0a)
      if (end !== -1) return finish(end <= KEYS_MAX_BYTES ? text.subarray(0, end).toString('utf8') : null)
      if (size > KEYS_MAX_BYTES) finish(null)
    })
    // A last line with no newline after it still counts; nothing at all does not.
    process.stdin.on('end', () => finish(size > 0 && size <= KEYS_MAX_BYTES ? Buffer.concat(chunks).toString('utf8') : null))
    process.stdin.on('error', () => finish(null))
  })

/** The keys the Mini app hands the runtime on the phone, checked; null when they did not arrive as they should. */
const readKeys = async () => {
  const line = await readLine()
  if (line === null) return null
  let keys
  try {
    keys = JSON.parse(line.trim())
  } catch {
    return null
  }
  if (typeof keys !== 'object' || keys === null) return null
  const { overlayKey, handsUrl, handsToken } = keys
  if (typeof overlayKey !== 'string' || !HEX_KEY.test(overlayKey)) return null
  if (typeof handsToken !== 'string' || !HEX_KEY.test(handsToken)) return null
  if (typeof handsUrl !== 'string' || !HANDS_URL.test(handsUrl)) return null
  return { overlayKey, handsUrl, handsToken }
}

const main = async () => {
  const platform = platformFor()
  if (platform.phone && process.env.MINI_BOT_OVERLAY !== 'external') {
    console.error('On the phone, Mini is started by the Mini app.')
    process.exitCode = 2
    return
  }
  const mode = process.argv[2]
  if (mode === '--detach') {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', ...process.argv.slice(3)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return
  }
  if (mode !== '--serve') {
    console.error('usage: node server.mjs --detach | --serve')
    process.exitCode = 2
    return
  }
  if (await isAlreadyRunning()) return
  let phone = null
  if (platform.phone) {
    phone = await readKeys()
    if (phone === null) {
      console.error("Mini's keys did not arrive.")
      process.exitCode = 3
      return
    }
  }
  const runtime = createRuntime({
    dataDir: dataDir(),
    overlay: platform.overlay(),
    platform,
    startedByPc: process.argv.includes('--pc-start'),
    onExit: () => process.exit(0),
    ...(phone ? { overlayKey: phone.overlayKey, phone: { handsUrl: phone.handsUrl, handsToken: phone.handsToken } } : {}),
  })
  await runtime.start()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void runtime.stop())
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
