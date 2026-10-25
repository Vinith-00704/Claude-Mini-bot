import { expect, test } from 'claude-code/testing'

import { defaultConfig, normalizeConfig } from '../hooks/lib/config'
import { findField } from '../hooks/lib/fields'
import {
  createProfile,
  deleteProfile,
  patchProfile,
  renameProfile,
  selectProfile,
  type Result,
} from '../hooks/lib/profiles'
import { tokenize } from '../hooks/lib/commands'

const ok = (result: Result) => {
  if ('error' in result) throw new Error(result.error)
  return result.config
}

test('creating a bot adds it, selects it, and leaves the others alone', async () => {
  const before = defaultConfig()
  const after = ok(createProfile(before, 'Biscuit'))
  expect(after.profiles.map(p => p.name)).toEqual(['Mini', 'Biscuit'])
  expect(after.activeProfileId).toBe('biscuit')
  expect(after.profiles[0]).toEqual(before.profiles[0])
})

test('a copy keeps the look of the bot it came from', async () => {
  const base = ok(createProfile(defaultConfig(), 'Biscuit'))
  const tweaked = ok(patchProfile(base, 'biscuit', { avatar: 'cat', appearance: { accent: 'pink' } }))
  const copy = ok(createProfile(tweaked, 'Biscuit 2', 'biscuit'))
  expect(copy.profiles.at(-1)?.avatar).toBe('cat')
  expect(copy.profiles.at(-1)?.appearance.accent).toBe('pink')
})

test('names are unique ignoring case, non-empty and short', async () => {
  const config = defaultConfig()
  expect(createProfile(config, 'mini')).toEqual({ error: 'There is already a bot called "Mini".' })
  expect(createProfile(config, '   ')).toEqual({ error: 'A bot needs a name.' })
  expect('error' in createProfile(config, 'x'.repeat(41))).toBe(true)
})

test('renaming keeps the id, so the active bot stays active', async () => {
  const config = ok(renameProfile(defaultConfig(), 'default', 'Sparky'))
  expect(config.profiles[0]?.id).toBe('default')
  expect(config.profiles[0]?.name).toBe('Sparky')
  expect(config.activeProfileId).toBe('default')
  // Renaming a bot to its own name in another case is allowed.
  expect('config' in renameProfile(config, 'default', 'SPARKY')).toBe(true)
})

test('the last bot cannot be deleted; deleting the active one switches to another', async () => {
  const one = defaultConfig()
  expect('error' in deleteProfile(one, 'default')).toBe(true)
  const two = ok(createProfile(one, 'Biscuit'))
  expect(two.activeProfileId).toBe('biscuit')
  const left = ok(deleteProfile(two, 'biscuit'))
  expect(left.profiles.map(p => p.id)).toEqual(['default'])
  expect(left.activeProfileId).toBe('default')
})

test('selecting an unknown bot is refused and changes nothing', async () => {
  expect(selectProfile(defaultConfig(), 'nope')).toEqual({ error: 'No such bot.' })
})

test('whatever was stored is read back as a valid configuration', async () => {
  expect(normalizeConfig(undefined)).toEqual(defaultConfig())
  const repaired = normalizeConfig({
    activeProfileId: 'gone',
    profiles: [
      { id: 'a', name: 'A', avatar: 'dragon', appearance: { opacity: 9000, size: 'huge' }, position: { anchor: 'custom', x: 'left' } },
      { id: 'a', name: 'duplicate id' },
    ],
    startup: { mode: 'sometimes' },
  })
  expect(repaired.profiles).toHaveLength(1)
  expect(repaired.activeProfileId).toBe('a')
  expect(repaired.profiles[0]?.avatar).toBe('clawd')
  expect(repaired.profiles[0]?.appearance).toEqual({ skin: 'claude', size: 'medium', opacity: 100, accent: 'claude', theme: 'dark' })
  expect(repaired.profiles[0]?.position).toEqual({ anchor: 'bottom-right' })
  expect(repaired.startup.mode).toBe('restore')
})

test('a configuration stored by an earlier version keeps its single position, now on every bot', async () => {
  const old = {
    activeProfileId: 'a',
    position: { anchor: 'custom', x: 40, y: 50 },
    profiles: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  }
  const migrated = normalizeConfig(old)
  expect(migrated.profiles.map(p => p.position)).toEqual([
    { anchor: 'custom', x: 40, y: 50 },
    { anchor: 'custom', x: 40, y: 50 },
  ])
  expect(migrated.onboarded).toBe(false)
})

test('a patch names only what changes, and bad values are refused whole', async () => {
  const config = defaultConfig()
  const changed = ok(patchProfile(config, 'default', { appearance: { opacity: 70 }, animation: { idle: 'lively' } }))
  expect(changed.profiles[0]?.appearance).toEqual({ skin: 'claude', size: 'medium', opacity: 70, accent: 'claude', theme: 'dark' })
  expect(changed.profiles[0]?.animation.idle).toBe('lively')
  expect(changed.profiles[0]?.animation.speed).toBe('normal')
  expect(patchProfile(config, 'default', { appearance: { opacity: 5 } })).toEqual({ error: 'Opacity is a whole number from 20 to 100.' })
  expect('error' in patchProfile(config, 'default', { avatar: 'dragon' as never })).toBe(true)
  expect('error' in patchProfile(config, 'default', { nonsense: 1 } as never)).toBe(true)
  expect(patchProfile(config, 'nope', {})).toEqual({ error: 'No such bot.' })
})

test('a patch that renames follows the name rules', async () => {
  const two = ok(createProfile(defaultConfig(), 'Biscuit'))
  expect(patchProfile(two, 'biscuit', { name: 'mini' })).toEqual({ error: 'There is already a bot called "Mini".' })
  const renamed = ok(patchProfile(two, 'biscuit', { name: 'Maple', avatar: 'cat' }))
  expect(renamed.profiles[1]).toMatchObject({ id: 'biscuit', name: 'Maple', avatar: 'cat' })
})

test('settings fields validate what they are given', async () => {
  const config = defaultConfig()
  const opacity = findField('opacity')!
  expect('error' in opacity.apply(config, 'default', '5')).toBe(true)
  expect('error' in opacity.apply(config, 'default', 'lots')).toBe(true)
  const set = opacity.apply(config, 'default', '70%')
  expect('config' in set && set.config.profiles[0]?.appearance.opacity).toBe(70)
  const position = findField('position')!
  const custom = position.apply(config, 'default', '120, 340')
  expect('config' in custom && custom.config.profiles[0]?.position).toEqual({ anchor: 'custom', x: 120, y: 340 })
  expect('error' in position.apply(config, 'default', 'the moon')).toBe(true)
  expect('error' in findField('avatar')!.apply(config, 'default', 'dragon')).toBe(true)
  const accent = findField('accent')!.apply(config, 'default', 'pink')
  expect('config' in accent && accent.config.profiles[0]?.appearance.accent).toBe('pink')
})

test('a bot setting follows its bot, a global one does not', async () => {
  const two = ok(createProfile(defaultConfig(), 'Biscuit'))
  const skinned = findField('skin')!.apply(two, 'biscuit', 'ocean')
  const placed = findField('position')!.apply(two, 'biscuit', 'top-left')
  const volume = findField('volume')!.apply(two, 'biscuit', '10')
  if (!('config' in skinned) || !('config' in placed) || !('config' in volume)) throw new Error('should apply')
  expect(skinned.config.profiles.map(p => p.appearance.skin)).toEqual(['claude', 'ocean'])
  expect(placed.config.profiles.map(p => p.position.anchor)).toEqual(['bottom-right', 'top-left'])
  expect(volume.config.sound.volume).toBe(10)
})

test('the chat panel size is kept per bot, within the limits', async () => {
  const two = ok(createProfile(defaultConfig(), 'Biscuit'))
  expect(two.profiles.map(p => p.panel)).toEqual([
    { width: 380, replyHeight: 150, autoFit: false },
    { width: 380, replyHeight: 150, autoFit: false },
  ])
  const size = findField('panel-size')!
  const set = size.apply(two, 'biscuit', '520 x 300')
  if (!('config' in set)) throw new Error('should apply')
  expect(set.config.profiles.map(p => p.panel.width)).toEqual([380, 520])
  expect(set.config.profiles[1]?.panel.replyHeight).toBe(300)
  const reset = size.apply(set.config, 'biscuit', 'reset')
  expect('config' in reset && reset.config.profiles[1]?.panel).toEqual({ width: 380, replyHeight: 150, autoFit: false })
  expect('error' in size.apply(two, 'biscuit', '100 x 300')).toBe(true)
  expect('error' in size.apply(two, 'biscuit', 'huge')).toBe(true)
  const grow = findField('grow-replies')!.apply(two, 'biscuit', 'on')
  expect('config' in grow && grow.config.profiles[1]?.panel.autoFit).toBe(true)
  // Whatever was stored is pulled back into range, and a bot saved before this existed gets the default.
  const repaired = normalizeConfig({ profiles: [{ id: 'a', name: 'A', panel: { width: 5000, replyHeight: -3, autoFit: 'yes' } }, { id: 'b', name: 'B' }] })
  expect(repaired.profiles.map(p => p.panel)).toEqual([
    { width: 900, replyHeight: 80, autoFit: false },
    { width: 380, replyHeight: 150, autoFit: false },
  ])
})

test('arguments split on spaces and keep quoted names whole', async () => {
  expect(tokenize('bot rename "Old Name" "New Name"')).toEqual(['bot', 'rename', 'Old Name', 'New Name'])
  expect(tokenize('')).toEqual([])
})

test("the default bot is Claude Code's mascot, in Claude Code's colour", async () => {
  const bot = defaultConfig().profiles[0]
  expect(bot).toMatchObject({ avatar: 'clawd', appearance: { skin: 'claude', accent: 'claude' } })
})

test('a bot that still has the old factory look takes the new default; a customized one is left alone', async () => {
  const old = {
    version: 1,
    activeProfileId: 'default',
    profiles: [
      { id: 'default', name: 'Mini', avatar: 'blob', appearance: { skin: 'sunrise', accent: 'blue', size: 'medium', opacity: 100 } },
      { id: 'avis', name: 'avis', avatar: 'ghost', appearance: { skin: 'sunrise', accent: 'blue' } },
      { id: 'pickedcolour', name: 'Tweaked', avatar: 'blob', appearance: { skin: 'ocean', accent: 'blue' } },
    ],
  }
  const migrated = normalizeConfig(old)
  expect(migrated.version).toBe(2)
  expect(migrated.profiles.map(p => [p.name, p.avatar, p.appearance.skin])).toEqual([
    ['Mini', 'clawd', 'claude'],
    ['avis', 'ghost', 'sunrise'],
    ['Tweaked', 'blob', 'ocean'],
  ])
  // Already at the new version: nothing is rewritten.
  const again = normalizeConfig(migrated)
  expect(again.profiles.map(p => p.avatar)).toEqual(['clawd', 'ghost', 'blob'])
})
