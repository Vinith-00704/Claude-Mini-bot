// Routines: reminders the bot says, and prompts it gives Claude, at a time the person chose. They live with the
// companion, so they fire without any process left waiting, and they only ever fire while the bot is on. A reminder
// is only words on the screen. A routine that gives Claude a prompt runs on Mini's own session, like anything the
// person says to it, and shows on the bot while it does: it is never hidden work.
//
// A time is written the way people write it: "09:00" (the next time it comes round), "in 20 minutes", "daily 09:00",
// "weekdays 18:30", "mon,thu 08:15", or a full date and time ("2026-11-20 17:30").

import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

const fail = (status, error) => Object.assign(new Error(error), { status })

const MAX_ROUTINES = 40
const MAX_TEXT = 1000
// A time missed by less than this (the PC was waking up) still counts. Older than this it is skipped.
const GRACE_MS = 15 * 60 * 1000
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAYS = [1, 2, 3, 4, 5]

const clock = raw => {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim())
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const half = match[3]?.toLowerCase()
  if (half) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (half === 'pm' ? 12 : 0)
  }
  if (hour > 23 || minute > 59 || (!half && match[2] === undefined)) return null
  return { hour, minute }
}

/** A time as written, in its stored form: `{ once: ms }` or `{ hour, minute, days: [0-6] }`. Null when it cannot be read. */
export const parseWhen = (raw, now = Date.now()) => {
  const text = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (text === '') return null
  const inTime = /^in (\d{1,4}) ?(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(text)
  if (inTime) {
    const unit = inTime[2][0]
    const ms = Number(inTime[1]) * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000)
    return ms > 0 ? { once: now + ms } : null
  }
  const repeat = /^(daily|every day|everyday|weekdays|weekends|[a-z]{3}(?:,[a-z]{3})*) (.+)$/.exec(text)
  if (repeat) {
    const at = clock(repeat[2])
    if (!at) return null
    const word = repeat[1]
    const days = word === 'daily' || word === 'every day' || word === 'everyday' ? [0, 1, 2, 3, 4, 5, 6]
      : word === 'weekdays' ? WEEKDAYS
      : word === 'weekends' ? [0, 6]
      : word.split(',').map(d => DAYS.indexOf(d))
    if (days.includes(-1)) return null
    return { ...at, days }
  }
  const at = clock(text.replace(/^at /, ''))
  if (at) {
    const when = new Date(now)
    when.setHours(at.hour, at.minute, 0, 0)
    if (when.getTime() <= now) when.setDate(when.getDate() + 1)
    return { once: when.getTime() }
  }
  const date = Date.parse(text.replace(' ', 'T'))
  return Number.isFinite(date) && date > now ? { once: date } : null
}

/** When a stored time next comes round after `after`, in milliseconds. */
export const nextAfter = (when, after) => {
  if (typeof when.once === 'number') return when.once > after ? when.once : null
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(after)
    day.setDate(day.getDate() + offset)
    day.setHours(when.hour, when.minute, 0, 0)
    if (when.days.includes(day.getDay()) && day.getTime() > after) return day.getTime()
  }
  return null
}

const describeWhen = when => {
  if (typeof when.once === 'number') return new Date(when.once).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  const time = `${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}`
  const days = when.days.length === 7 ? 'daily' : when.days.join() === WEEKDAYS.join() ? 'weekdays' : when.days.map(d => DAYS[d]).join(',')
  return `${days} ${time}`
}

export class Routines {
  #file
  #now
  #items = []

  constructor({ file, now = Date.now }) {
    this.#file = file
    this.#now = now
  }

  async load() {
    try {
      const stored = JSON.parse(await readFile(this.#file, 'utf8'))
      const now = this.#now()
      this.#items = (Array.isArray(stored) ? stored : [])
        .filter(r => r && typeof r.id === 'string' && typeof r.text === 'string' && r.when && (r.kind === 'say' || r.kind === 'ask'))
        // What came due while the bot was off: a one-time thing long past is dropped, a repeating one waits for its next time.
        .map(r => (typeof r.nextAt === 'number' && r.nextAt < now - GRACE_MS ? { ...r, nextAt: nextAfter(r.when, now) } : r))
        .filter(r => r.nextAt !== null)
    } catch {
      this.#items = []
    }
  }

  #save() {
    const temp = `${this.#file}.${process.pid}.tmp`
    void writeFile(temp, JSON.stringify(this.#items, null, 1))
      .then(() => rename(temp, this.#file))
      .catch(() => {})
  }

  /** Checks a routine as asked for, without adding it. */
  check({ kind, text, when }) {
    if (kind !== 'say' && kind !== 'ask') throw fail(400, 'kind is say (a reminder) or ask (a prompt for Claude)')
    const clean = typeof text === 'string' ? text.trim() : ''
    if (clean === '' || clean.length > MAX_TEXT) throw fail(400, `a routine has text, ${MAX_TEXT} characters at most`)
    if (clean.startsWith('/')) throw fail(400, 'a routine cannot start with a slash: Claude Code would take it for a command')
    const parsed = parseWhen(when, this.#now())
    if (!parsed) throw fail(400, 'when is a time such as "17:30", "in 20 minutes", "daily 09:00", "weekdays 18:30", "mon,thu 08:15" or "2026-11-20 17:30"')
    if (this.#items.length >= MAX_ROUTINES) throw fail(429, `At most ${MAX_ROUTINES} routines. Remove one first.`)
    return { kind, text: clean, when: parsed }
  }

  add(checked) {
    const item = { id: randomUUID().slice(0, 8), ...checked, nextAt: nextAfter(checked.when, this.#now()), createdAt: this.#now() }
    if (item.nextAt === null) throw fail(400, 'that time has already passed')
    this.#items.push(item)
    this.#save()
    return this.#view(item)
  }

  /** Removes one by its id or its number in the list. */
  remove(which) {
    const key = String(which ?? '').trim()
    const byNumber = /^\d+$/.test(key) ? this.list()[Number(key) - 1]?.id : undefined
    const target = this.#items.find(r => r.id === key || r.id === byNumber)
    if (!target) throw fail(404, 'there is no such routine')
    this.#items = this.#items.filter(r => r !== target)
    this.#save()
    return this.#view(target)
  }

  /** Takes out what has come due: each one-time thing goes, each repeating one moves on to its next time. */
  due() {
    const now = this.#now()
    const fired = []
    for (const item of this.#items) if (item.nextAt <= now) fired.push(item)
    if (fired.length === 0) return []
    for (const item of fired) item.nextAt = nextAfter(item.when, now)
    this.#items = this.#items.filter(r => r.nextAt !== null)
    this.#save()
    return fired.map(r => ({ id: r.id, kind: r.kind, text: r.text }))
  }

  #view(r) {
    return { id: r.id, kind: r.kind, text: r.text, when: describeWhen(r.when), repeats: typeof r.when.once !== 'number', nextAt: r.nextAt }
  }

  list() {
    return [...this.#items].sort((a, b) => a.nextAt - b.nextAt).map(r => this.#view(r))
  }
}
