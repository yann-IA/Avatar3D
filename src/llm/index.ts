import { PROVIDERS, viaProxy, type Settings } from '../settings'
import { AnthropicClient } from './anthropic'
import { OpenAICompatibleClient } from './openai'
import type { LLMClient } from './types'

export * from './types'

export function createLLM(s: Settings): LLMClient {
  const preset = PROVIDERS[s.activeProvider]
  const cfg = s.providers[s.activeProvider]
  const baseUrl = viaProxy(cfg.baseUrl, s.useProxy)
  if (preset.kind === 'anthropic') {
    return new AnthropicClient({
      baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: s.maxTokens,
      effort: s.claudeEffort,
      workspaceId: cfg.workspaceId,
    })
  }
  return new OpenAICompatibleClient({
    baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
  })
}
