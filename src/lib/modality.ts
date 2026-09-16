import type { CatalogModel } from './types'

/** models.dev tags every model with `modalities: { input, output }`. These helpers read those
 *  tags so the chat picker and the voice picker each show only the models that fit. */

export function inputModalities(m: CatalogModel): string[] {
  return m.modalities?.input ?? []
}
export function outputModalities(m: CatalogModel): string[] {
  return m.modalities?.output ?? []
}

/** True when the model can emit text. Custom / synthetic entries (no declared modalities) are
 *  treated as text so they stay usable. Image-, video-, and audio-only generators return false. */
export function outputsText(m: CatalogModel): boolean {
  const out = m.modalities?.output
  return !out || out.length === 0 || out.includes('text')
}

/** A pure generator (image / video / speech out, no text) — not usable as a chat model. */
export function isGenerationOnly(m: CatalogModel): boolean {
  return !outputsText(m)
}

/** Speech-to-text: takes audio in and produces text out. models.dev marks the dedicated
 *  transcription/ASR models with an audio-only input (no "text" in the input list) — that's
 *  what distinguishes Whisper / Qwen3-ASR / Voxtral from a general chat model that merely
 *  *accepts* audio (gpt-4o, gemini), which would 404 on `/audio/transcriptions`. */
export function isSpeechToText(m: CatalogModel): boolean {
  const inp = inputModalities(m)
  return inp.includes('audio') && !inp.includes('text') && outputsText(m)
}
