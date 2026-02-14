// Local Flask backend (same origin in dev -> Vite proxy to localhost:5000)
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

/**
 * Wrapper around fetch that injects the Supabase JWT as a Bearer token.
 */
export function authFetch(
  url: string,
  token: string | undefined,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(url, { ...options, headers })
}
