// A model id as a person says it: "claude-opus-5-5" is "Opus 5.5".

const FAMILY = /(opus|sonnet|haiku|fable)/

/** A short, readable name for a model id or alias. An id it does not recognise is shown as it is (shortened). */
export function friendlyModel(id: string): string {
  const raw = id.trim()
  if (raw === '') return ''
  // "[1m]" after the id marks a larger context window.
  const window = /\[(\d+m)\]\s*$/i.exec(raw)?.[1]?.toUpperCase()
  const base = raw.replace(/\[[^\]]*\]\s*$/, '').trim().toLowerCase()
  const family = FAMILY.exec(base)?.[1]
  if (!family) return raw.length > 28 ? raw.slice(0, 28) : raw

  // The version follows the family (claude-opus-5-5, claude-sonnet-4-20250514) or comes first (claude-3-5-sonnet-20241022).
  // A minor version is one or two digits, so a date after it is never mistaken for one.
  const after = new RegExp(`${family}-(\\d{1,2})(?!\\d)(?:-(\\d{1,2})(?!\\d))?`).exec(base)
  const before = new RegExp(`(?:^|-)(\\d{1,2})(?:-(\\d{1,2}))?-${family}`).exec(base)
  const match = before ?? after
  const version = match ? `${match[1]}${match[2] !== undefined ? `.${match[2]}` : ''}` : ''
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `${name}${version ? ` ${version}` : ''}${window ? ` (${window})` : ''}`
}

/** The effort levels the session names, or null for a model with none (or a number the bot cannot show as a level). */
export function effortLevel(effort: unknown): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null {
  return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max' ? effort : null
}
