import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export interface AuthUser {
  id: string
  email: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const STORAGE_KEY = 'meeting_insights_auth'

function loadStored(): { user: AuthUser; token: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { user: AuthUser; token: string }
    if (data?.user?.id && data?.token) return data
  } catch {
    // ignore
  }
  return null
}

function saveStored(user: AuthUser | null, token: string | null) {
  if (!user || !token) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }))
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = loadStored()
    if (stored) {
      setUser(stored.user)
      setToken(stored.token)
    }
    setLoading(false)
  }, [])

  async function getErrorFromResponse(res: Response): Promise<string> {
    const text = await res.text()
    let msg: string
    try {
      const data = text ? JSON.parse(text) : {}
      msg = data.error ?? ''
    } catch {
      msg = text || ''
    }
    if (!msg) {
      if (res.status === 401) msg = 'Unauthorized'
      else if (res.status === 409) msg = 'Conflict (e.g. email already exists)'
      else if (res.status >= 500) msg = 'Server error'
      else msg = `Request failed (${res.status})`
    } else if (res.status >= 400) {
      msg = `${res.status}: ${msg}`
    }
    return msg
  }

  const signIn = async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) return { error: await getErrorFromResponse(res) }
      const data = await res.json().catch(() => ({}))
      const { token: t, user: u } = data
      if (!t || !u?.id) return { error: 'Invalid response from server: missing token or user' }
      setUser(u)
      setToken(t)
      saveStored(u, t)
      return { error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { error: `Network error: ${message}` }
    }
  }

  const signUp = async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) return { error: await getErrorFromResponse(res) }
      const data = await res.json().catch(() => ({}))
      const { token: t, user: u } = data
      if (!t || !u?.id) return { error: 'Invalid response from server: missing token or user' }
      setUser(u)
      setToken(t)
      saveStored(u, t)
      return { error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { error: `Network error: ${message}` }
    }
  }

  const signOut = async () => {
    setUser(null)
    setToken(null)
    saveStored(null, null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
