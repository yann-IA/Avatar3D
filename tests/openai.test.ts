import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient, adapt, initialQuirks } from '../src/llm/openai'

const sse = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200 })
const error400 = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 })

afterEach(() => vi.unstubAllGlobals())

describe('paramètres selon le modèle', () => {
  it('utilise max_completion_tokens et pas de température pour les modèles récents d’OpenAI', () => {
    expect(initialQuirks('https://api.openai.com/v1', 'gpt-5.5-mini')).toMatchObject({ completionTokens: true, reasoning: true, noTemperature: true })
    expect(initialQuirks('https://api.openai.com/v1', 'gpt-4o')).toMatchObject({ completionTokens: true, reasoning: false, noTemperature: false })
    expect(initialQuirks('https://api.groq.com/openai/v1', 'llama-3.3-70b')).toMatchObject({ completionTokens: false, reasoning: false })
  })

  it('s’adapte aux messages d’erreur', () => {
    const q = initialQuirks('http://localhost:11434/v1', 'x')
    expect(adapt(q, "Erreur 400 : Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")).toBe(true)
    expect(q.completionTokens).toBe(true)
    expect(adapt(q, "Unsupported value: 'temperature' does not support 0.8 with this model.")).toBe(true)
    expect(q.noTemperature).toBe(true)
    expect(adapt(q, 'Invalid API key')).toBe(false)
  })

  it('réessaie automatiquement avec le bon paramètre (relais local, modèle inconnu)', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      return 'max_tokens' in body ? error400("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.") : sse('Bonjour !')
    })
    const client = new OpenAICompatibleClient({ baseUrl: 'http://localhost:5173/__proxy/x', apiKey: 'k', model: 'gpt-x', temperature: 0.8, maxTokens: 512 })
    let out = ''
    expect(await client.streamChat({ signal: new AbortController().signal, system: 's', messages: [{ role: 'user', content: 'salut' }], onText: (t) => (out += t) })).toBe('Bonjour !')
    expect(out).toBe('Bonjour !')
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toMatchObject({ max_completion_tokens: 512, temperature: 0.8 })
    // la fois suivante, directement le bon paramètre
    await client.streamChat({ signal: new AbortController().signal, system: 's', messages: [], onText: () => {} })
    expect(bodies).toHaveLength(3)
    expect(bodies[2]).not.toHaveProperty('max_tokens')
  })

  it('envoie une réflexion courte et plus de marge aux modèles qui réfléchissent', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ((body = JSON.parse(String(init.body))), sse('ok')))
    const client = new OpenAICompatibleClient({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-5.5', temperature: 0.8, maxTokens: 1024 })
    await client.streamChat({ signal: new AbortController().signal, system: 's', messages: [], onText: () => {} })
    expect(body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 5024 })
    expect(body).not.toHaveProperty('temperature')
  })
})
