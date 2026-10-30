// Authentication for the local control interface.
//
// The runtime listens on loopback only and every request must carry the bearer
// token written to runtime.json (a file in the user's own profile directory).
// Host and Origin are checked too, so a web page cannot reach the interface by
// DNS rebinding or a cross-site request.

import { randomBytes, timingSafeEqual } from 'node:crypto'

export const newToken = () => randomBytes(32).toString('hex')

export const sameToken = (given, expected) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Returns null when the request may proceed, else `{ status, error }`. */
export const check = (req, { token, port }) => {
  if (req.headers.origin !== undefined) {
    return { status: 403, error: 'browser requests are refused' }
  }
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return { status: 403, error: 'unexpected host' }
  }
  const header = req.headers.authorization ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!sameToken(given, token)) {
    return { status: 401, error: 'missing or wrong token' }
  }
  return null
}
