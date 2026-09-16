import { Capacitor } from '@capacitor/core'
import { useStore } from '../state/store'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export const AUTH_REDIRECT = 'app.openplex://auth-callback'

export async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  const [{ StatusBar, Style }, { SplashScreen }, { App }, { Keyboard }] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
    import('@capacitor/keyboard'),
  ])

  const isDark = () => document.documentElement.dataset.theme === 'dark'

  const applyStatusBar = async () => {
    try {
      await StatusBar.setStyle({ style: isDark() ? Style.Dark : Style.Light })
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: isDark() ? '#0b0c0f' : '#faf9f7' })
      }
    } catch {
      /* StatusBar not available on this device */
    }
  }
  await applyStatusBar()
  new MutationObserver(applyStatusBar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  App.addListener('backButton', () => {
    const s = useStore.getState()
    if (s.settingsTab) return s.closeSettings()
    if (s.shortcutsOpen) return s.setShortcutsOpen(false)
    if (s.paletteOpen) return s.setPaletteOpen(false)
    if (s.sourcesFor) return s.setSourcesFor(null)
    if (window.innerWidth <= 900 && s.sidebarOpen && s.activeThreadId) return s.setSidebarOpen(false)
    if (s.activeThreadId) return void s.selectThread(null)
    void App.minimizeApp()
  })

  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.includes('auth-callback') && !url.includes('access_token') && !url.includes('code=')) return
    try {
      const { handleAuthRedirect } = await import('./supabase')
      await handleAuthRedirect(url)
      await useStore.getState().initSync()
    } catch {
      /* ignore malformed callbacks */
    }
  })

  try {
    Keyboard.addListener('keyboardWillShow', () => document.documentElement.classList.add('kb-open'))
    Keyboard.addListener('keyboardWillHide', () => document.documentElement.classList.remove('kb-open'))
  } catch {
    /* keyboard plugin optional */
  }

  await SplashScreen.hide()
}
