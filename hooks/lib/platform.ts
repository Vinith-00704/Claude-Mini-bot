// Where this session runs: on a PC, or on an Android phone in Termux. Only the phone's own start script
// (the Mini app's session.sh) sets MINI_BOT_PLATFORM=android; everywhere else nothing here changes anything.

import type { Engine } from './types'

export type Platform = 'pc' | 'android'

let platform: Platform | null = null

/**
 * 'android' when MINI_BOT_PLATFORM is "android", else 'pc'. Asked once: it cannot change within a session. If the
 * question itself fails, this is the PC, as before there was a phone: every tool call waits on this answer.
 */
export async function platformOf($: Engine): Promise<Platform> {
  if (platform === null) {
    try {
      platform = (await $.env.get('MINI_BOT_PLATFORM')) === 'android' ? 'android' : 'pc'
    } catch {
      platform = 'pc'
    }
  }
  return platform
}
