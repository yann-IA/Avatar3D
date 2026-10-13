import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/settings'
import {
  WrongPassphraseError,
  applySecrets,
  collectSecrets,
  countKeys,
  decryptVault,
  encryptVault,
  forgetVaultKeys,
  keyPaths,
  loadedVaultKeys,
  parseVault,
  passphraseProblem,
  releaseKey,
  rememberedVault,
  unlockVault,
} from '../src/vault'

const PASS = 'girafe lampe violon nuage'
// Peu d'itérations dans les tests : le chiffrement reste le même, en plus rapide.
const FAST = 1000

function configured() {
  const s = defaultSettings()
  s.activeProvider = 'anthropic'
  s.providers.anthropic.apiKey = 'sk-ant-test'
  s.providers.anthropic.workspaceId = 'wrkspc_123'
  s.providers.openai.apiKey = 'sk-openai'
  s.tts.engine = 'openai'
  s.tts.openai.apiKey = 'sk-openai'
  s.tts.openai.voice = 'nova'
  return s
}

describe('coffre à clés', () => {
  it('ne garde que les clés et la connexion, pas la voix ni le personnage', () => {
    const v = collectSecrets(configured())
    expect(countKeys(v)).toBe(3)
    expect(v.providers.anthropic).toMatchObject({ apiKey: 'sk-ant-test', workspaceId: 'wrkspc_123' })
    expect(v.tts.openai).not.toHaveProperty('voice')
    expect(v.tts.elevenlabs).toBeUndefined()
    expect(JSON.stringify(v)).not.toContain('persona')
  })

  it('chiffre puis déchiffre avec la bonne phrase secrète', async () => {
    const secrets = collectSecrets(configured())
    const file = await encryptVault(secrets, PASS, FAST)
    expect(file.format).toBe('avatar3d-vault')
    expect(JSON.stringify(file)).not.toContain('sk-ant-test')
    expect(parseVault(JSON.stringify(file))).toEqual(file)
    // Les espaces autour de la phrase sont ignorés.
    expect(await decryptVault(file, `  ${PASS} `)).toEqual(secrets)
  })

  it('refuse une mauvaise phrase secrète ou un fichier modifié', async () => {
    const file = await encryptVault(collectSecrets(configured()), PASS, FAST)
    await expect(decryptVault(file, 'girafe lampe violon nuages')).rejects.toBeInstanceOf(WrongPassphraseError)
    const tampered = { ...file, data: file.data.slice(0, -4) + (file.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') }
    await expect(decryptVault(tampered, PASS)).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('applique les clés sur un appareil vierge sans toucher au reste', async () => {
    const file = await encryptVault(collectSecrets(configured()), PASS, FAST)
    const fresh = defaultSettings()
    fresh.persona.name = 'Dino'
    applySecrets(fresh, await decryptVault(file, PASS))
    expect(fresh.activeProvider).toBe('anthropic')
    expect(fresh.providers.anthropic.apiKey).toBe('sk-ant-test')
    expect(fresh.providers.anthropic.workspaceId).toBe('wrkspc_123')
    expect(fresh.tts.engine).toBe('openai')
    expect(fresh.tts.openai.apiKey).toBe('sk-openai')
    expect(fresh.tts.openai.voice).toBe(defaultSettings().tts.openai.voice)
    expect(fresh.persona.name).toBe('Dino')
  })

  it('ignore les valeurs invalides d’un fichier modifié à la main', () => {
    const s = defaultSettings()
    applySecrets(s, {
      activeProvider: 'inconnu' as never,
      providers: { openai: { apiKey: 42 as never, model: ' gpt ' }, pirate: { apiKey: 'x' } } as never,
      tts: { engine: s.tts.engine },
      stt: { engine: s.stt.engine },
    })
    expect(s.activeProvider).toBe(defaultSettings().activeProvider)
    expect(s.providers.openai.apiKey).toBe('')
    expect(s.providers.openai.model).toBe('gpt')
    expect(s.providers).not.toHaveProperty('pirate')
  })

  it('exige une phrase secrète longue et variée', async () => {
    expect(passphraseProblem('court')).toMatch(/au moins/)
    expect(passphraseProblem('aaaaaaaaaaaaaaaaaaaa')).toMatch(/répétitive/)
    expect(passphraseProblem(PASS)).toBeNull()
    await expect(encryptVault(collectSecrets(configured()), 'court', FAST)).rejects.toThrow()
  })

  it('reconnaît seulement les fichiers de coffre', () => {
    expect(parseVault('pas du json')).toBeNull()
    expect(parseVault('{"format":"autre"}')).toBeNull()
  })
})

describe('clés chargées depuis le coffre', () => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage

  it('verrouille les clés chargées, puis les efface quand on désactive le coffre', async () => {
    const file = await encryptVault(collectSecrets(configured()), PASS, FAST)
    const s = defaultSettings()
    s.stt.whisper.apiKey = 'gsk-saisie-a-la-main'
    expect(await unlockVault(s, file, PASS)).toBe(3)
    expect(s.vault.locked.sort()).toEqual(['providers.anthropic.apiKey', 'providers.openai.apiKey', 'tts.openai.apiKey'])
    expect(loadedVaultKeys(s)).toBe(3)
    expect(s.vault.applied).toBe(file.created)
    expect(rememberedVault()).toEqual(file)

    releaseKey(s, 'tts.openai.apiKey')
    expect(s.tts.openai.apiKey).toBe('')
    expect(loadedVaultKeys(s)).toBe(2)

    expect(forgetVaultKeys(s)).toBe(2)
    expect(s.providers.anthropic.apiKey).toBe('')
    expect(s.providers.openai.apiKey).toBe('')
    expect(s.stt.whisper.apiKey).toBe('gsk-saisie-a-la-main') // pas une clé du coffre : conservée
    expect(s.vault).toMatchObject({ locked: [], applied: '' })
  })

  it('ne verrouille rien avec une mauvaise phrase', async () => {
    const file = await encryptVault(collectSecrets(configured()), PASS, FAST)
    const s = defaultSettings()
    await expect(unlockVault(s, file, 'une autre phrase bien longue')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(s.vault.locked).toEqual([])
    expect(keyPaths(collectSecrets(s))).toEqual([])
  })
})
