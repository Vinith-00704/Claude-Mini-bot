// The Permissions menu: what the companion may use right now, with a way to
// grant or revoke each.

import { getState } from './client'
import { describeAccess, grantAccess, LABELS, revokeAccess, revokeAll } from './permissions'
import { confirm, pick } from './prompts'
import { KINDS, type Engine } from './types'

export async function permissionsMenu($: Engine): Promise<void> {
  for (;;) {
    const state = await getState($)
    const items = [
      ...KINDS.map(kind => ({ label: LABELS[kind], value: kind as string })),
      { label: 'Revoke all', value: 'all' },
    ]
    const picked = await pick(
      $,
      `Mini Bot access (separate from Claude Code's own permissions):\n${describeAccess(state).join('\n')}\nChoose one to grant or revoke. Esc to go back.`,
      items,
      'Permissions',
    )
    if (!picked || 'typed' in picked) return

    if (picked.value === 'all') {
      $.ui.log(await revokeAll($))
      continue
    }
    const kind = KINDS.find(k => k === picked.value)!
    if (state?.permissions[kind].granted) {
      const revoke = await confirm($, `${LABELS[kind]} access is on. Revoke it?`, 'Revoke', 'Keep', 'Permission')
      if (revoke) $.ui.log(await revokeAccess($, kind))
    } else {
      $.ui.log(await grantAccess($, kind))
    }
  }
}
