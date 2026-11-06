// Starting with the PC. An entry in the person's own Run key (the same list Settings > Apps > Startup shows, and
// where they can also turn it off) starts a small launcher when they sign in; a Start menu shortcut starts the same
// launcher, which is how Mini is turned back on by hand. Nothing here needs administrator rights, and nothing is
// written until the person asks for it.
//
// The launcher lives in the companion's own folder, because the plugin's folder changes with every version. It finds
// the plugin afresh each time from Claude Code's own list of installed plugins, so an update needs nothing done here.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const DEFAULT_VALUE = 'Claude Mini Bot'
const SHORTCUT = 'Claude Mini Bot.lnk'
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The launcher, as a script on its own: it runs before anything of the plugin's has been found. */
export const launcherSource = ({ fixedRoot = '' } = {}) => `// Written by Claude Mini Bot; /mini-bot autostart off removes it. Finds the installed plugin and starts its companion.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const roots = ${JSON.stringify(fixedRoot ? [fixedRoot] : [])}
try {
  const config = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const list = JSON.parse(readFileSync(join(config, 'plugins', 'installed_plugins.json'), 'utf8'))
  for (const [name, entries] of Object.entries(list.plugins ?? {})) {
    if (name.startsWith('mini-bot@')) for (const entry of entries) if (entry.installPath) roots.push(entry.installPath)
  }
} catch {}
try { roots.push(readFileSync(join(here, 'plugin-root.txt'), 'utf8').trim()) } catch {}
const root = roots.find(r => existsSync(join(r, 'runtime', 'server.mjs')))
if (root) {
  spawn(process.execPath, [join(root, 'runtime', 'server.mjs'), '--detach', '--pc-start'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, MINI_BOT_HOME: here },
  }).unref()
}
`

const run = (file, args) =>
  new Promise(done => {
    execFile(file, args, { windowsHide: true, timeout: 15000 }, (error, stdout) => done({ ok: !error, stdout: String(stdout ?? '') }))
  })

export const createAutostart = ({ dataDir, nodePath = process.execPath, env = process.env, exec = run } = {}) => {
  const value = env.MINI_BOT_RUN_VALUE ?? DEFAULT_VALUE
  const vbs = join(dataDir, 'start-mini.vbs')
  const launcher = join(dataDir, 'start-mini.mjs')
  const startMenu = env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT) : null
  const wscript = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  // A test keeps its hands off the person's Start menu.
  const useShortcut = startMenu !== null && env.MINI_BOT_RUN_VALUE === undefined

  /** The command the Run key and the shortcut start. wscript shows no window at all; without it a console flashes by. */
  const command = () =>
    existsSync(wscript)
      ? { file: wscript, args: `//B //Nologo "${vbs}"`, line: `"${wscript}" //B //Nologo "${vbs}"` }
      : { file: nodePath, args: `"${launcher}"`, line: `"${nodePath}" "${launcher}"` }

  const writeLauncher = async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(launcher, launcherSource({ fixedRoot: env.MINI_BOT_FIXED_ROOT ?? '' }))
    await writeFile(join(dataDir, 'plugin-root.txt'), PLUGIN_ROOT)
    const script = `' Written by Claude Mini Bot; /mini-bot autostart off removes it. Starts the bot with no window.\r\nCreateObject("WScript.Shell").Run """${nodePath}"" ""${launcher}""", 0, False\r\n`
    await writeFile(vbs, Buffer.from(`\ufeff${script}`, 'utf16le'))
  }

  const makeShortcut = async () => {
    if (!useShortcut) return
    const { file, args } = command()
    const quote = text => `'${String(text).replace(/'/g, "''")}'`
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(startMenu)}); $s.TargetPath = ${quote(file)}; $s.Arguments = ${quote(args)}; $s.Description = ${quote('Turn Claude Mini Bot on')}; $s.WorkingDirectory = ${quote(dataDir)}; $s.Save()`])
  }

  return {
    /** Whether the PC starts Mini when the person signs in. */
    async isOn() {
      if (process.platform !== 'win32') return false
      return (await exec('reg', ['query', RUN_KEY, '/v', value])).ok
    },
    async enable() {
      if (process.platform !== 'win32') return { ok: false, message: 'Starting with the PC only works on Windows.' }
      await writeLauncher()
      const added = await exec('reg', ['add', RUN_KEY, '/v', value, '/t', 'REG_SZ', '/d', command().line, '/f'])
      if (!added.ok) return { ok: false, message: 'Windows did not let the bot add itself to the startup list.' }
      await makeShortcut()
      return { ok: true, message: 'Mini starts with your PC from now on.' }
    },
    async disable() {
      if (process.platform !== 'win32') return { ok: true, message: 'Mini does not start with the PC.' }
      await exec('reg', ['delete', RUN_KEY, '/v', value, '/f'])
      if (useShortcut) await rm(startMenu, { force: true }).catch(() => {})
      return { ok: true, message: 'Mini no longer starts with your PC. Your Claude Code sessions can still start it.' }
    },
    /** A running companion keeps the launcher up to date, so a moved Node or a new plugin folder needs nothing done by hand. */
    async refresh() {
      if (await this.isOn()) await writeLauncher()
    },
  }
}
