// Questions to the person, through Claude Code's own question dialog.
//
// The dialog takes two to four options and always offers "Other" for typed
// text, which is as close to a menu as a command gets in the terminal. These
// helpers page through longer lists and read a dismissed dialog (Esc, or no
// one at the prompt) as "no answer".

import type { Engine } from './types'

const MORE = 'More…'
const FIRST = '↩ Back to the first page'

export type Item<T> = { label: string; value: T }
export type Picked<T> = { value: T } | { typed: string } | undefined

export async function ask($: Engine, question: string, options: string[], header?: string): Promise<string | undefined> {
  try {
    return await $.ui.ask(question, { options, header: header?.slice(0, 12) })
  } catch {
    return undefined
  }
}

/** Yes or no. `undefined` when nobody answered. */
export async function confirm($: Engine, question: string, yes: string, no = 'Cancel', header?: string) {
  const answer = await ask($, question, [yes, no], header)
  return answer === undefined ? undefined : answer === yes
}

/** Picks one item, four at a time. Typed text under "Other" comes back as `{ typed }`. */
export async function pick<T>($: Engine, question: string, items: Item<T>[], header?: string): Promise<Picked<T>> {
  let start = 0
  for (;;) {
    const rest = items.slice(start)
    const isLast = rest.length <= 4
    const page = isLast ? rest : rest.slice(0, 3)
    const labels = page.map(item => item.label)
    const canGoBack = isLast && start > 0 && labels.length < 4
    if (!isLast) labels.push(MORE)
    if (canGoBack) labels.push(FIRST)
    const answer = await ask($, question, labels, header)
    if (answer === undefined) return undefined
    if (!isLast && answer === MORE) {
      start += 3
      continue
    }
    if (canGoBack && answer === FIRST) {
      start = 0
      continue
    }
    const hit = page.find(item => item.label === answer)
    return hit ? { value: hit.value } : { typed: answer }
  }
}
