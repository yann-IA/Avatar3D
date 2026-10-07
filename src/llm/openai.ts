import { readSSE } from './sse'
import { LLMError, type ChatRequest, type LLMClient } from './types'

export interface OpenAICompatibleOptions {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

/** Client pour toute API compatible « OpenAI chat/completions » (OpenAI, Groq, Mistral, Ollama…). */
export class OpenAICompatibleClient implements LLMClient {
  constructor(private readonly opts: OpenAICompatibleOptions) {}

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.opts.apiKey) h.Authorization = `Bearer ${this.opts.apiKey}`
    return h
  }

  private url(path: string): string {
    return this.opts.baseUrl.replace(/\/+$/, '') + path
  }

  async streamChat({ system, messages, signal, onText }: ChatRequest): Promise<string> {
    if (!this.opts.model) throw new LLMError('Aucun modèle choisi dans les réglages.')
    const res = await fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      signal,
      body: JSON.stringify({
        model: this.opts.model,
        stream: true,
        temperature: this.opts.temperature,
        max_tokens: this.opts.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    })
    if (!res.ok || !res.body) throw new LLMError(await describeError(res))

    let full = ''
    for await (const data of readSSE(res.body)) {
      if (data === '[DONE]') break
      let json: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } }
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new LLMError(json.error.message ?? 'Erreur du fournisseur')
      const delta = json.choices?.[0]?.delta?.content
      if (delta) {
        full += delta
        onText(delta)
      }
    }
    return full
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url('/models'), { headers: this.headers() })
    if (!res.ok) throw new LLMError(await describeError(res))
    const json = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] }
    const ids = json.data?.map((m) => m.id) ?? json.models?.map((m) => m.name) ?? []
    return ids.sort()
  }
}

export async function describeError(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      detail = j.error?.message ?? j.message ?? j.detail?.message ?? j.detail ?? text
    } catch {
      detail = text
    }
  } catch {
    /* corps illisible */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? ' (clé API invalide ou manquante ?)'
      : res.status === 404
        ? ' (URL ou nom de modèle incorrect ?)'
        : res.status === 429
          ? ' (quota ou limite de débit atteint)'
          : ''
  return `Erreur ${res.status}${hint} : ${String(detail).slice(0, 300)}`
}
