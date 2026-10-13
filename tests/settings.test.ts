import { describe, expect, it } from 'vitest'
import { defaultSettings, getPath, setPath } from '../src/settings'

describe('settings paths', () => {
  it('lit et écrit un réglage imbriqué', () => {
    const s = defaultSettings()
    setPath(s, 'providers.groq.apiKey', 'gsk_test')
    expect(getPath(s, 'providers.groq.apiKey')).toBe('gsk_test')
    expect(getPath(s, 'tts.openai.voice')).toBe('nova')
  })
})

describe('clé partagée entre services', () => {
  it('réutilise la clé OpenAI de l’onglet IA pour Whisper et les voix, pas pour un autre serveur', async () => {
    const { defaultSettings, sharedKey } = await import('../src/settings')
    const s = defaultSettings()
    s.providers.openai.apiKey = 'sk-ia'
    expect(sharedKey(s, s.stt.whisper.baseUrl, '')).toBe('sk-ia')
    expect(sharedKey(s, s.tts.openai.baseUrl, 'sk-propre')).toBe('sk-propre')
    expect(sharedKey(s, 'https://api.groq.com/openai/v1', '')).toBe('')
    s.providers.groq.apiKey = 'gsk'
    expect(sharedKey(s, 'https://api.groq.com/openai/v1', '')).toBe('gsk')
  })
})
