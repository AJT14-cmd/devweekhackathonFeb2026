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
  // When sending FormData, let the browser set Content-Type (multipart/form-data + boundary).
  // If we don't delete it, some environments can send the wrong type and the server won't see the file.
  if (options.body instanceof FormData) {
    headers.delete('Content-Type')
  }
  return fetch(url, { ...options, headers })
}
