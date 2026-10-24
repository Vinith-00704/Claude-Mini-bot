// The authenticated local interface to the companion runtime.
//
// The runtime writes its port and a random token to runtime.json in the
// person's own profile folder. Every request carries that token; nothing else
// is trusted. A missing file, a dead port or a wrong token all read the same
// way: the runtime is not there.

import type { Engine, RuntimeState } from './types'

export type Link = { port: number; token: string; pid: number }

export type Reply<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function dataDir($: Engine): Promise<string> {
  const override = await $.env.get('MINI_BOT_HOME')
  if (override) return override
  const appData = await $.env.get('APPDATA')
  if (appData) return `${appData}/ClaudeMiniBot`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home}/.claude-mini-bot`
}

export async function readLink($: Engine): Promise<Link | null> {
  try {
    const info = JSON.parse((await $.fs.read(`${await dataDir($)}/runtime.json`)) as string)
    return typeof info.port === 'number' && typeof info.token === 'string' ? info : null
  } catch {
    return null
  }
}

export async function request<T>(
  $: Engine,
  link: Link,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<Reply<T>> {
  try {
    const res = await $.http.fetch(`http://127.0.0.1:${link.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${link.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const parsed = JSON.parse(res.text || '{}')
    return res.ok ? { ok: true, data: parsed as T } : { ok: false, status: res.status, error: String(parsed.error ?? res.status) }
  } catch {
    return { ok: false, status: 0, error: 'the companion is not reachable' }
  }
}

/** The link to a runtime that answers, or null. */
export async function connect($: Engine): Promise<Link | null> {
  const link = await readLink($)
  if (!link) return null
  return (await request($, link, 'GET', '/v1/health')).ok ? link : null
}

/** The runtime's own report of itself, or null when it is not running. */
export async function getState($: Engine): Promise<RuntimeState | null> {
  const link = await connect($)
  if (!link) return null
  const reply = await request<RuntimeState>($, link, 'GET', '/v1/state')
  return reply.ok ? reply.data : null
}
