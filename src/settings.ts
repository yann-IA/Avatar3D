export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'mistral'
  | 'openrouter'
  | 'deepseek'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'custom'

export interface ProviderPreset {
  label: string
  kind: 'openai' | 'anthropic'
  baseUrl: string
  model: string
  /** Suggestions affichées dans la liste déroulante du modèle. */
  models: string[]
  needsKey: boolean
  keyUrl?: string
}

/** Tous les fournisseurs sauf Anthropic parlent le dialecte « OpenAI chat/completions ». */
export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'],
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    label: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  openrouter: {
    label: 'OpenRouter (des centaines de modèles)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    models: [],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat'],
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    models: [],
    needsKey: false,
  },
  lmstudio: {
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    models: [],
    needsKey: false,
  },
  custom: {
    label: 'Autre (compatible OpenAI)',
    kind: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    model: '',
    models: [],
    needsKey: false,
  },
}

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export type TTSEngineId = 'browser' | 'openai' | 'elevenlabs' | 'none'
export type STTEngineId = 'browser' | 'whisper'

export interface AvatarEntry {
  id: string
  name: string
  /** URL distante/relative, ou « idb:<id> » pour un fichier importé (stocké dans IndexedDB). */
  url: string
  /** Copie locale essayée en premier (voir `npm run fetch-avatar`). */
  localUrl?: string
  builtin?: boolean
}

export interface Settings {
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  /** Fait passer les appels par le relais du serveur Vite (contourne CORS). */
  useProxy: boolean
  temperature: number
  maxTokens: number
  /** Effort de réflexion des modèles Claude récents : « low » = réponses rapides. */
  claudeEffort: 'low' | 'medium' | 'high'
  historyLength: number

  persona: {
    name: string
    prompt: string
    language: string
  }

  tts: {
    engine: TTSEngineId
    browserVoice: string
    pitch: number
    rate: number
    volume: number
    openai: { baseUrl: string; apiKey: string; model: string; voice: string; instructions: string; speed: number }
    elevenlabs: { apiKey: string; voiceId: string; model: string; stability: number; similarity: number; style: number }
  }

  stt: {
    engine: STTEngineId
    handsFree: boolean
    whisper: { baseUrl: string; apiKey: string; model: string }
    silenceMs: number
  }

  avatar: {
    current: string
    list: AvatarEntry[]
    framing: 'bust' | 'full'
    followPointer: boolean
  }

  ui: {
    subtitles: boolean
    quality: 'low' | 'medium' | 'high'
    background: string
  }
}

export const SAMPLE_AVATAR: AvatarEntry = {
  id: 'sample',
  name: 'Exemple pixiv (VRM 1.0)',
  url: 'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  localUrl: 'avatars/default.vrm',
  builtin: true,
}

export const DEFAULT_PROMPT = `Tu es Aiko, une compagne virtuelle chaleureuse, curieuse et pleine d'humour.
Tu discutes à l'oral avec ton interlocuteur : réponds en phrases courtes et naturelles (2 à 4 phrases en général), comme dans une vraie conversation.`

function defaultProviders(): Record<ProviderId, ProviderConfig> {
  const out = {} as Record<ProviderId, ProviderConfig>
  for (const [id, p] of Object.entries(PROVIDERS) as [ProviderId, ProviderPreset][]) {
    out[id] = { baseUrl: p.baseUrl, apiKey: '', model: p.model }
  }
  return out
}

export function defaultSettings(): Settings {
  return {
    activeProvider: 'openai',
    providers: defaultProviders(),
    useProxy: false,
    temperature: 0.8,
    maxTokens: 1024,
    claudeEffort: 'low',
    historyLength: 20,
    persona: { name: 'Aiko', prompt: DEFAULT_PROMPT, language: 'fr-FR' },
    tts: {
      engine: 'browser',
      browserVoice: '',
      pitch: 1.15,
      rate: 1.05,
      volume: 1,
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini-tts',
        voice: 'nova',
        instructions: 'Voix jeune, douce et enjouée, ton chaleureux et naturel.',
        speed: 1,
      },
      elevenlabs: { apiKey: '', voiceId: '', model: 'eleven_flash_v2_5', stability: 0.45, similarity: 0.8, style: 0.3 },
    },
    stt: {
      engine: 'browser',
      handsFree: false,
      whisper: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1' },
      silenceMs: 900,
    },
    avatar: { current: SAMPLE_AVATAR.id, list: [SAMPLE_AVATAR], framing: 'bust', followPointer: true },
    ui: { subtitles: true, quality: 'medium', background: '#1b1d2e' },
  }
}

const STORAGE_KEY = 'companion.settings.v1'

/** Fusion profonde : les nouvelles clés par défaut apparaissent même avec d'anciens réglages sauvegardés. */
function merge<T>(base: T, saved: unknown): T {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
    return (saved === undefined || typeof saved !== typeof base ? base : saved) as T
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    out[k] = k in out ? merge(out[k], v) : v
  }
  return out as T
}

export function loadSettings(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const s = merge(base, JSON.parse(raw))
    // L'avatar d'exemple reste toujours disponible et à jour.
    s.avatar.list = [SAMPLE_AVATAR, ...s.avatar.list.filter((a) => a.id !== SAMPLE_AVATAR.id)]
    return s
  } catch {
    return base
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* stockage plein ou bloqué : les réglages restent en mémoire */
  }
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.')
  const last = keys.pop()!
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as Record<string, unknown>)
  target[last] = value
}

/** Préfixe une URL par le relais local si demandé (http(s)://hote/... -> /__proxy/https/hote/...). */
export function viaProxy(url: string, useProxy: boolean): string {
  if (!useProxy) return url
  const m = /^(https?):\/\/(.*)$/.exec(url)
  if (!m) return url
  return new URL(`__proxy/${m[1]}/${m[2]}`, document.baseURI).href
}
