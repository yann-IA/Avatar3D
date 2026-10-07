import Anthropic from '@anthropic-ai/sdk'
import { LLMError, type ChatRequest, type LLMClient } from './types'

export interface AnthropicOptions {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
}

/** Modèles qui acceptent le paramètre `effort` (pas Haiku 4.5 ni les générations antérieures). */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(4-[678]|5)/.test(model)
/** Modèles pour lesquels le repli automatique côté serveur (`fallbacks: "default"`) est disponible. */
const supportsFallback = (model: string) => /^claude-(opus-5|fable-5-1|mythos-5-1|sonnet-5-5)/.test(model)

export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic

  constructor(private readonly opts: AnthropicOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl.replace(/\/+$/, ''),
      // L'application tourne entièrement dans le navigateur : la clé reste sur l'appareil de l'utilisateur.
      dangerouslyAllowBrowser: true,
    })
  }

  async streamChat({ system, messages, signal, onText }: ChatRequest): Promise<string> {
    const { model } = this.opts
    const fallback = supportsFallback(model)
    try {
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: this.opts.maxTokens,
          system,
          messages,
          ...(supportsEffort(model) ? { output_config: { effort: this.opts.effort } } : {}),
          // Si un filtre de sécurité refuse la requête, l'API la rejoue sur un autre modèle au lieu d'échouer.
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal },
      )
      stream.on('text', (delta) => onText(delta))
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') {
        onText(' [sad] Désolée, je ne peux pas répondre à ça.')
      }
      return final.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw err
      if (err instanceof Anthropic.AuthenticationError) throw new LLMError('Clé API Anthropic invalide.')
      if (err instanceof Anthropic.NotFoundError) throw new LLMError(`Modèle introuvable : ${model}`)
      if (err instanceof Anthropic.RateLimitError) throw new LLMError('Limite de débit Anthropic atteinte, réessaie dans un instant.')
      if (err instanceof Anthropic.APIError) throw new LLMError(`Erreur Anthropic ${err.status ?? ''} : ${err.message}`)
      throw err
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list()) ids.push(m.id)
    return ids
  }
}
