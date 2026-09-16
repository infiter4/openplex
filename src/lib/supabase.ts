import { Capacitor } from '@capacitor/core'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useSettings } from '../state/settings'
import type { SyncConfig } from './types'

let client: SupabaseClient | null = null
let clientKey = ''

export function syncConfigured(cfg: SyncConfig): boolean {
  return Boolean(effectiveConfig(cfg).url && effectiveConfig(cfg).anonKey)
}

export function effectiveConfig(cfg: SyncConfig): SyncConfig {
  return {
    url: cfg.url?.trim() || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '',
    anonKey: cfg.anonKey?.trim() || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
  }
}

export function getSupabase(cfg: SyncConfig): SupabaseClient | null {
  const eff = effectiveConfig(cfg)
  if (!eff.url || !eff.anonKey) return null
  const key = `${eff.url}|${eff.anonKey}`
  if (client && clientKey === key) return client
  client = createClient(eff.url!, eff.anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !Capacitor.isNativePlatform(),
      flowType: 'pkce',
    },
  })
  clientKey = key
  return client
}

export async function getSession(cfg: SyncConfig): Promise<Session | null> {
  const sb = getSupabase(cfg)
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session
}

function redirectTarget(): string {
  return Capacitor.isNativePlatform() ? 'app.openplex://auth-callback' : window.location.origin
}

export async function signInWithGoogle(cfg: SyncConfig): Promise<void> {
  const sb = getSupabase(cfg)
  if (!sb) throw new Error('Sync is not configured')
  const native = Capacitor.isNativePlatform()
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTarget(), skipBrowserRedirect: native },
  })
  if (error) throw error
  if (native && data?.url) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: data.url })
  }
}

export async function signInWithEmail(cfg: SyncConfig, email: string): Promise<void> {
  const sb = getSupabase(cfg)
  if (!sb) throw new Error('Sync is not configured')
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTarget() } })
  if (error) throw error
}

export async function handleAuthRedirect(url: string): Promise<void> {
  const cfg = useSettings.getState().settings.sync
  const sb = getSupabase(cfg)
  if (!sb) return
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.close()
  } catch {
    /* browser may already be closed */
  }
  const u = new URL(url)
  const code = u.searchParams.get('code')
  if (code) {
    await sb.auth.exchangeCodeForSession(code)
    return
  }
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''))
  const access_token = frag.get('access_token')
  const refresh_token = frag.get('refresh_token')
  if (access_token && refresh_token) {
    await sb.auth.setSession({ access_token, refresh_token })
  }
}

export async function signOut(cfg: SyncConfig): Promise<void> {
  const sb = getSupabase(cfg)
  await sb?.auth.signOut()
}
