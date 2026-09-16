import { create } from 'zustand'
import { uid } from '../lib/utils'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
}

interface ToastStore {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const useToasts = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const toast: Toast = { ...t, id: uid() }
    set({ toasts: [...get().toasts, toast] })
    setTimeout(() => get().dismiss(toast.id), t.kind === 'error' ? 7000 : 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  info: (title: string, detail?: string) => useToasts.getState().push({ kind: 'info', title, detail }),
  success: (title: string, detail?: string) => useToasts.getState().push({ kind: 'success', title, detail }),
  error: (title: string, detail?: string) => useToasts.getState().push({ kind: 'error', title, detail }),
}
