// Entry point of the companion runtime.
//
//   node server.mjs --detach   start a background runtime and return at once
//   node server.mjs --serve    run the runtime in this process
//
// Runs on Node alone, with no packages. Its state lives in %APPDATA%\ClaudeMiniBot
// (or ~/.claude-mini-bot elsewhere); MINI_BOT_HOME overrides the folder.

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { defaultOverlay } from './lib/overlay.mjs'
import { createRuntime } from './lib/runtime.mjs'

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

const main = async () => {
  const mode = process.argv[2]
  if (mode === '--detach') {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
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
  const runtime = createRuntime({
    dataDir: dataDir(),
    overlay: defaultOverlay(),
    onExit: () => process.exit(0),
  })
  await runtime.start()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void runtime.stop())
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
