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
