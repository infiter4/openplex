import { effortValuesFor, supportsThinkingControl } from '../../lib/llm'
import { ENDPOINTS } from '../../lib/providers'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import type { DialStop } from './ReasoningDial'

const DOT_COLORS = ['#e0894a', '#7fae8a', '#6a8caf', '#b07bac', '#5fa8d3', '#c97b63', '#d0a14b']
function dotFor(id: string): string {
  return DOT_COLORS[Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % DOT_COLORS.length]
}

export interface ReasoningControl {
  show: boolean
  stops: DialStop[]
  value: string | undefined
  onChange: (v: string | undefined) => void
  modelInitial: string
  modelColor: string
}

export function useReasoning(): ReasoningControl {
  const activeThreadId = useStore((s) => s.activeThreadId)
  const threads = useStore((s) => s.threads)
  const setThinking = useStore((s) => s.setThinking)
  const draftThinking = useStore((s) => s.draftThinking)
  const catalog = useProviders((s) => s.catalog)
  const defaultModel = useSettings((s) => s.settings.defaultModel)

  const thread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null
  const value = thread ? thread.thinking : draftThinking
  const currentRef = thread?.modelRef ?? defaultModel ?? null
  const currentModel = currentRef && catalog ? catalog[currentRef.providerId]?.models[currentRef.modelId] : null

  const providerStyle = currentRef ? (ENDPOINTS[currentRef.providerId]?.style ?? 'openai') : 'openai'
  const canThink = Boolean(
    currentModel?.reasoning && currentRef && supportsThinkingControl(currentRef.providerId, providerStyle, currentRef.modelId),
  )
  const effortOpt = currentModel?.reasoning_options?.find((o) => o.type === 'effort')
  const isToggle = !effortOpt && Boolean(currentModel?.reasoning_options?.some((o) => o.type === 'toggle'))
  const reasoningValues = isToggle
    ? ['on']
    : currentRef
      ? effortValuesFor(currentRef.providerId, currentRef.modelId, effortOpt?.values)
      : ['low', 'medium', 'high']
  const allowOff =
    isToggle || providerStyle === 'anthropic' || ['openrouter', 'groq', 'google', 'zai'].includes(currentRef?.providerId ?? '')

  const stops: DialStop[] = canThink
    ? [
        { value: undefined, label: 'Auto' },
        ...(allowOff ? [{ value: 'off', label: 'Off' }] : []),
        ...reasoningValues.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })),
      ]
    : []

  return {
    show: canThink && stops.length > 0,
    stops,
    value,
    onChange: setThinking,
    modelInitial: (currentModel?.name ?? currentRef?.modelId ?? '?').charAt(0).toUpperCase(),
    modelColor: currentRef ? dotFor(currentRef.providerId) : 'var(--bg3)',
  }
}
