import { ApiError, isSessionValid, login, type SessionToken } from './api'

export class WrongPasswordError extends Error {}
export class SessionExpiredError extends Error {}

/**
 * Run a write action with a valid session, logging in with `password` first when needed.
 * The session token is kept in memory only (App state), never in storage.
 */
export async function withSession<T>(
  session: SessionToken | null,
  password: string,
  onSession: (session: SessionToken | null) => void,
  action: (token: string) => Promise<T>,
): Promise<T> {
  let active = session
  if (!isSessionValid(active)) {
    try {
      active = await login(password)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new WrongPasswordError('הסיסמה שגויה')
      throw err
    }
    onSession(active)
  }
  try {
    return await action(active.token)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      onSession(null)
      throw new SessionExpiredError('פג תוקף ההתחברות. יש להזין את הסיסמה שוב.')
    }
    throw err
  }
}
