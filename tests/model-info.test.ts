import { expect, test } from 'claude-code/testing'

import { effortLevel, friendlyModel } from '../hooks/lib/model-info'

test('a model id is shown as a person says it', async () => {
  const names: [string, string][] = [
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-4-1-20250805', 'Opus 4.1'],
    ['claude-sonnet-4-20250514', 'Sonnet 4'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'],
    ['opus', 'Opus'],
    ['Sonnet', 'Sonnet'],
  ]
  for (const [id, name] of names) expect(friendlyModel(id)).toBe(name)
  // What it does not know is shown as it is, shortened rather than guessed at.
  expect(friendlyModel('some-other-model')).toBe('some-other-model')
  expect(friendlyModel('x'.repeat(60))).toBe('x'.repeat(28))
  expect(friendlyModel('  ')).toBe('')
})

test('only the named effort levels are shown', async () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) expect(effortLevel(level)).toBe(level)
  for (const other of [undefined, null, 'extreme', 3, 'HIGH']) expect(effortLevel(other)).toBeNull()
})
