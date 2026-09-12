import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initNative } from './lib/native'
import { applyDensity, applyTheme } from './state/settings'
import { useSettings } from './state/settings'
import './styles/global.css'

applyTheme(useSettings.getState().settings.theme)
applyDensity(useSettings.getState().settings.density)
void initNative()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
