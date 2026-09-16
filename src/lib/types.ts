
export interface ModelRef {
  providerId: string
  modelId: string
}

export type ThinkLevel = string

export interface Thread {
  id: string
  title: string
  systemPrompt?: string
  modelRef?: ModelRef
  webSearch?: boolean
  thinking?: ThinkLevel
  contextCap?: number
  maxOutput?: number
  pinned: boolean
  archived: boolean
  deleted: boolean
  folder?: string
  untitled?: boolean
  createdAt: number
  updatedAt: number
  dirty: number
}

export type Role = 'user' | 'assistant'
export type MessageStatus = 'complete' | 'streaming' | 'error' | 'stopped'

export interface Source {
  title: string
  url: string
  /** Short preview for the sources panel. */
  snippet?: string
  /** Whole page text, when we opened it. */
  content?: string
  /** The passages the search engine judged relevant — already reranked, so the best text we get. */
  passages?: string[]
  score?: number
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cost?: number
  estimated?: boolean
  latencyMs?: number
}

export interface SearchStep {
  kind: 'search' | 'read' | 'think' | 'sources'
  label: string
}

export interface AgentFile {
  name: string
  bucketKey?: string
  b64?: string
  bytes?: number
  mime?: string
}

export type AgentTool =
  | 'terminal'
  | 'code'
  | 'write_file'
  | 'edit_file'
  | 'read_file'
  | 'list_files'
  | 'make_document'
  | 'download_file'
  | 'view_image'
  | 'run_background'
  | 'check_background'

export interface AgentImage {
  b64: string
  mime: string
}

export interface ToolStep {
  id: string
  tool: AgentTool
  title: string
  detail?: string
  status: 'running' | 'done' | 'error'
  output?: string
  exitCode?: number
  files?: AgentFile[]
}

export interface Attachment {
  kind?: 'image' | 'document'
  mimeType: string
  name?: string
  dataUrl?: string
  text?: string
  pageImages?: string[]
  size?: number
}

/** Ordered piece of an assistant turn, in true stream order (text interleaved with tool runs). */
export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; stepId: string }

export interface Message {
  id: string
  threadId: string
  role: Role
  content: string
  reasoning?: string
  model?: ModelRef
  usage?: Usage
  sources?: Source[]
  searchSteps?: SearchStep[]
  searchError?: string
  toolSteps?: ToolStep[]
  /** present only for agentic (tool-using) turns; ordered layout of text + tool cards */
  segments?: MessageSegment[]
  attachments?: Attachment[]
  variants?: string[]
  variantIndex?: number
  manual?: boolean
  status: MessageStatus
  error?: string
  deleted: boolean
  createdAt: number
  updatedAt: number
  dirty: number
}

export interface Memory {
  id: string
  content: string
  source: 'manual' | 'auto'
  enabled: boolean
  deleted: boolean
  createdAt: number
  updatedAt: number
  dirty: number
}

export interface ProviderConnection {
  providerId: string
  apiKey?: string
  accountId?: string
  baseUrl?: string
  label?: string
  kind: 'catalog' | 'custom'
  /** The provider's own live model list, when we've been able to fetch /models. */
  models?: string[]
  /** When that live list was last fetched — drives pruning + refresh throttling. */
  modelsFetchedAt?: number
}

/**
 * A repair applied to a provider — by the heal agent or by hand. Deliberately pure config and no
 * secrets, so it lives in `settings` and rides the always-on settings sync (connections only sync
 * when encrypted key-sync is switched on, which most people never enable).
 */
export interface ProviderOverride {
  baseUrl?: string
  apiStyle?: 'openai' | 'anthropic' | 'cohere'
  headers?: Record<string, string>
  /** Model id the app asks for -> the id the provider actually serves. */
  modelAliases?: Record<string, string>
  /**
   * Display name. Its presence is what turns an override into a whole provider: a repair can add
   * a provider the catalog has never heard of, and because overrides live in settings it shows up
   * on every device — unlike a connection, which only syncs with encrypted key sync switched on.
   */
  name?: string
  /** Models to offer for this provider, on top of anything the catalog or its /models list gives. */
  models?: string[]
  /** Short human note: what was changed and why. */
  note?: string
  updatedAt?: number
}

export interface ReasoningOption {
  type: string
  values?: string[]
  min?: number
  max?: number
}

export interface CatalogModel {
  id: string
  name: string
  family?: string
  attachment?: boolean
  reasoning?: boolean
  reasoning_options?: ReasoningOption[]
  tool_call?: boolean
  temperature?: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  modalities?: { input?: string[]; output?: string[] }
  open_weights?: boolean
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
}

export interface CatalogProvider {
  id: string
  name: string
  api?: string
  env?: string[]
  npm?: string
  doc?: string
  models: Record<string, CatalogModel>
}

export type Catalog = Record<string, CatalogProvider>

/** Tavily only: it's the one built for this, and one good engine beats four mediocre ones. */
export type SearchProviderId = 'tavily'

export interface SearchSettings {
  provider: SearchProviderId
  keys: Partial<Record<SearchProviderId, string>>
  maxResults: number
  light?: boolean
}

export interface VoiceSettings {
  providerId?: string
  model?: string
}

export interface MemorySettings {
  enabled: boolean
  auto: boolean
}

export interface PromptPreset {
  id: string
  name: string
  content: string
}

export interface SyncConfig {
  url?: string
  anonKey?: string
}

export interface KeySyncSettings {
  enabled: boolean
}

export interface ComputeSettings {
  enabled: boolean
  deviceToken?: string
  deviceName?: string
}

export type ThemeName = 'obsidian' | 'paper' | 'nocturne' | 'ember'

export interface Settings {
  theme: 'system' | 'light' | 'dark' | ThemeName
  defaultModel?: ModelRef
  defaultSystemPrompt: string
  promptPresets: PromptPreset[]
  temperature?: number
  search: SearchSettings
  voice?: VoiceSettings
  memory: MemorySettings
  sync: SyncConfig
  keySync: KeySyncSettings
  compute: ComputeSettings
  proxyUrl?: string
  /** Per-provider repairs (endpoint/style/headers/model aliases) — see ProviderOverride. */
  providerOverrides?: Record<string, ProviderOverride>
  showAllProviders: boolean
  pinnedModels?: ModelRef[]
  density?: 'compact' | 'comfortable' | 'spacious'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultSystemPrompt: '',
  promptPresets: [],
  search: { provider: 'tavily', keys: {}, maxResults: 6, light: false },
  memory: { enabled: true, auto: false },
  sync: {},
  keySync: { enabled: false },
  compute: { enabled: false },
  showAllProviders: false,
  density: 'comfortable',
}
