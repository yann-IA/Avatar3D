import Anthropic from '@anthropic-ai/sdk'
import { LLMError, type ChatRequest, type LLMClient } from './types'

export interface AnthropicOptions {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
  /** ID de workspace (wrkspc_…), requis pour une clé rattachée à l'organisation plutôt qu'à un workspace. */
  workspaceId?: string
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
      defaultHeaders: opts.workspaceId?.trim() ? { 'anthropic-workspace-id': opts.workspaceId.trim() } : undefined,
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
      if (err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message)) {
        throw new LLMError(
          this.opts.workspaceId?.trim()
            ? `L\u2019ID de workspace « ${this.opts.workspaceId.trim()} » est refusé : vérifie-le dans la console Anthropic (Settings → Workspaces).`
            : 'Cette clé Anthropic n\u2019est rattachée à aucun workspace. Renseigne l\u2019« ID du workspace » (wrkspc_…) dans ⚙ → IA, ou crée une clé à l\u2019intérieur d\u2019un workspace.',
        )
      }
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
