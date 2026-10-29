// `/mini-bot` and its typed subcommands. With no arguments it opens the menu;
// everything the menu does can also be typed, which is also what works where
// no one can answer a dialog.

import { botMenu, createBot } from './bot-menu'
import { isRuntimeOutdated } from './bridge'
import { connect, getState, request } from './client'
import { loadConfig } from './config'
import { commit, startRuntime, stopRuntime } from './lifecycle'
import { mainMenu } from './menu'
import { describeAccess, grantAccess, parseKind, revokeAccess, revokeAll } from './permissions'
import { permissionsMenu } from './permissions-menu'
import { activeProfile, createProfile, deleteProfile, findProfile, renameProfile, selectProfile, type Result } from './profiles'
import { confirm, pick } from './prompts'
import { currentValue, findField, FIELDS, GROUPS } from './fields'
import { settingsMenu } from './settings-menu'
import { speechCommand } from './speech'
import { refreshStatus } from './status'
import { updateCommand } from './update'
import { setVisible, toggleVisible } from './visibility'
import { MIN_RUNTIME_VERSION, type Engine } from './types'

export const tokenize = (input: string): string[] =>
  [...input.matchAll(/"([^"]*)"|(\S+)/g)].map(m => (m[1] ?? m[2])!)

const HELP = `Mini Bot: your floating character. Claude Code stays the intelligence.

  /mini-bot                         open the menu
  /mini-bot hide | show | toggle    hide or restore the character (Claude Code stays connected)
  /mini-bot start | stop            start or stop the companion only
  /mini-bot status                  what is running, which bot, what access is in use
  /mini-bot settings [list]         change settings in a menu, or list them
  /mini-bot set <field> <value>     e.g. set opacity 70, set skin ocean, set position bottom-left, set panel-size 520x300
  /mini-bot permissions             see, grant or revoke screen, microphone and computer access
  /mini-bot permissions grant|revoke <screen|microphone|computer|all>
  /mini-bot screenshot              snip part of the screen and ask Claude about it
  /mini-bot speech [install [small]]  check, or set up, accurate offline speech recognition
  /mini-bot update                  is a newer version out on GitHub, and how to install it
  /mini-bot switch [name]           change to another bot (a list if no name)
  /mini-bot create [name]           make a new bot
  /mini-bot bot                     choose, create, rename, customize or delete bots
  /mini-bot bot list | use <name> | new <name> [--copy] | rename <name> <new> | customize <name> | delete <name>

The floating bot works without these: click it to type a prompt or use the
microphone, drag it to move it, right-click it for hide, settings and permissions.`

async function describeStatus($: Engine): Promise<string> {
  const [config, state] = await Promise.all([loadConfig($), getState($)])
  const profile = activeProfile(config)
  const shown = state ? state.overlay.visible : config.visible
  const lines = [
    `Mini Bot is ${state ? 'running' : 'stopped'} and ${shown ? 'visible' : 'hidden'}. Active bot: ${profile.name} (${profile.avatar}, ${profile.appearance.skin}).`,
    ...describeAccess(state),
  ]
  if (config.hotkey.toggle !== 'off') {
    // A companion started before the shortcut existed does not have it until it restarts.
    lines.push(
      state && !state.config.hotkey
        ? `Shortcut ${config.hotkey.toggle} works after /mini-bot stop and /mini-bot start.`
        : state?.hotkey?.ok === false
          ? `Hide/show shortcut ${config.hotkey.toggle} does not work: another program already uses it. Pick another with /mini-bot set hotkey ctrl+alt+j.`
          : `Hide/show shortcut: ${config.hotkey.toggle} (/mini-bot set hotkey changes it).`,
    )
  }
  if (state?.session) lines.push('Session model: ' + state.session.name + (state.session.effort ? ', effort ' + state.session.effort : '') + '.')
  if (state && (state.version < MIN_RUNTIME_VERSION || isRuntimeOutdated())) {
    lines.push('The companion is an older version and cannot carry prompts from the floating bot: /mini-bot stop, then /mini-bot start.')
  } else if (state) {
    lines.push(`Prompts from the floating bot: ${state.bridge.connected ? 'connected to this session' : 'not connected yet (give it a moment)'}.`)
  }
  if (state && state.version < 3) lines.push('The companion is from before the bot could list slash commands when you type /: /mini-bot stop, then /mini-bot start.')
  return lines.join('\n')
}

async function listSettings($: Engine): Promise<string> {
  const config = await loadConfig($)
  const lines = GROUPS.map(group => {
    const fields = FIELDS.filter(f => f.group === group.id)
    return `${group.label}\n${fields.map(f => `  ${f.id}: ${currentValue(f, config)}${f.options ? `  [${f.options.join(' | ')}]` : ''}`).join('\n')}`
  })
  return `Settings for ${activeProfile(config).name}:\n${lines.join('\n')}`
}

async function setField($: Engine, args: string[]): Promise<string> {
  const field = findField(args[0] ?? '')
  if (!field) return `No setting called "${args[0] ?? ''}". /mini-bot settings list shows them.`
  if (args.length < 2) return `Give ${field.id} a value. /mini-bot settings list shows the choices.`
  const config = await loadConfig($)
  const applied = field.apply(config, config.activeProfileId, args.slice(1).join(' '))
  if ('error' in applied) return applied.error
  await commit($, applied.config)
  return `${field.label} is now ${currentValue(field, applied.config)}.`
}

async function permissions($: Engine, args: string[]): Promise<string> {
  const [verb, what] = args
  if (verb === undefined) {
    await permissionsMenu($)
    return describeAccess(await getState($)).join('\n')
  }
  if (verb === 'status') return describeAccess(await getState($)).join('\n')
  if (verb !== 'grant' && verb !== 'revoke') return 'Use: /mini-bot permissions [status | grant <kind> | revoke <kind|all>]'
  if (verb === 'revoke' && what === 'all') return revokeAll($)
  const kind = parseKind(what ?? '')
  if (!kind) return `Which access? screen, microphone or computer${verb === 'revoke' ? ', or all' : ''}.`
  return verb === 'grant' ? grantAccess($, kind) : revokeAccess($, kind)
}

async function finish($: Engine, result: Result): Promise<string> {
  if ('error' in result) return result.error
  await commit($, result.config)
  return result.message
}

async function bots($: Engine, args: string[]): Promise<string> {
  const [verb, ...rest] = args
  const config = await loadConfig($)
  if (verb === undefined) {
    await botMenu($)
    return 'Bot menu closed.'
  }
  if (verb === 'list') return config.profiles.map(p => `${p.id === config.activeProfileId ? '* ' : '  '}${p.name} (${p.avatar}, ${p.appearance.skin})`).join('\n')
  if (verb === 'new') {
    const copy = rest.includes('--copy')
    const name = rest.filter(w => w !== '--copy').join(' ')
    if (name === '') {
      await createBot($, config)
      return 'Done.'
    }
    return finish($, createProfile(config, name, copy ? config.activeProfileId : undefined))
  }
  const target = findProfile(config, rest[0] ?? '')
  if (!target) return `No bot called "${rest[0] ?? ''}". /mini-bot bot list shows them.`
  if (verb === 'use') return finish($, selectProfile(config, target.id))
  if (verb === 'rename') return finish($, renameProfile(config, target.id, rest.slice(1).join(' ')))
  if (verb === 'customize') {
    await settingsMenu($, { profileId: target.id, groups: GROUPS.filter(g => ['name', 'look', 'animation', 'size-position', 'opacity', 'personality'].includes(g.id)) })
    return `Finished customizing ${target.name}.`
  }
  if (verb === 'delete') {
    const sure = await confirm($, `Delete ${target.name}? This cannot be undone. Your Claude Code session is not affected.`, `Delete ${target.name}`, 'Keep it', 'Delete bot')
    if (sure === undefined) return 'Deleting needs someone at the prompt to confirm, so nothing was deleted.'
    return sure ? finish($, deleteProfile(config, target.id)) : `Kept ${target.name}.`
  }
  return 'Use: /mini-bot bot [list | use | new | rename | customize | delete]'
}

async function askForScreenshot($: Engine): Promise<string> {
  const link = await connect($)
  if (!link) return 'Mini Bot is not running, so it cannot take a screenshot. Start it first: /mini-bot start.'
  const reply = await request($, link, 'POST', '/v1/overlay/request', { action: 'screenshot' })
  if (!reply.ok) {
    return reply.status === 404
      ? 'The companion is an older version without screenshots: /mini-bot stop, then /mini-bot start.'
      : `Could not ask for a screenshot: ${reply.error}.`
  }
  return 'Select an area on screen (or click a window, or press Enter for the whole screen). Choose Ask Claude to send it here.'
}

async function switchBot($: Engine, args: string[]): Promise<string> {
  if (args.length > 0) return bots($, ['use', ...args])
  const config = await loadConfig($)
  const picked = await pick(
    $,
    'Switch to which bot?',
    config.profiles.map(p => ({ label: p.name + (p.id === config.activeProfileId ? ' (active)' : ''), value: p.id })),
    'Switch bot',
  )
  if (!picked || 'typed' in picked) return 'No bot chosen, so nothing changed.'
  return finish($, selectProfile(config, picked.value))
}

export async function runCommand($: Engine, input: string): Promise<string> {
  const [verb = '', ...args] = tokenize(input)
  const text = await (async () => {
    switch (verb.toLowerCase()) {
      case '':
        return mainMenu($)
      case 'help':
        return HELP
      case 'status':
        return describeStatus($)
      case 'hide':
        return setVisible($, false)
      case 'show':
      case 'unhide':
        return setVisible($, true)
      case 'toggle':
        return toggleVisible($)
      case 'screenshot':
      case 'snip':
        return askForScreenshot($)
      case 'speech':
      case 'voice':
        return speechCommand($, args)
      case 'update':
      case 'version':
        return updateCommand($)
      case 'start':
        return (await startRuntime($)).message
      case 'stop':
        return (await stopRuntime($)).message
      case 'settings':
        if (args[0] === 'list') return listSettings($)
        await settingsMenu($)
        return 'Settings closed.'
      case 'set':
        return setField($, args)
      case 'permissions':
      case 'permission':
        return permissions($, args)
      case 'bot':
      case 'profile':
        return bots($, args)
      case 'switch':
      case 'use':
        return switchBot($, args)
      case 'create':
      case 'new':
        return bots($, ['new', ...args])
      default:
        return `Unknown option "${verb}".\n\n${HELP}`
    }
  })()
  await refreshStatus($)
  return text
}
