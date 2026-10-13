import { PROVIDERS, getPath, saveSettings, setPath, type ProviderConfig, type ProviderId, type Settings, type STTEngineId, type TTSEngineId } from './settings'

/**
 * Coffre à clés : les clés API (et la configuration qui va avec) chiffrées par une phrase
 * secrète. Le fichier peut être publié avec le site (public/vault.json) ou copié sur un autre
 * appareil : sans la phrase secrète, il est illisible. Sur un nouvel appareil, il suffit donc de
 * taper la phrase secrète au lieu de plusieurs longues clés.
 *
 * Chiffrement : AES-256-GCM (authentifié : une mauvaise phrase est détectée), clé dérivée de la
 * phrase secrète par PBKDF2-SHA256 avec 600 000 itérations et un sel aléatoire, via WebCrypto.
 */

/** Adresse du coffre publié avec le site. */
export const VAULT_URL = 'vault.json'
/** Page GitHub où déposer le fichier pour le publier avec le site. */
export const REPO_UPLOAD_URL = 'https://github.com/yann-IA/Avatar3D/upload/main/public'
export const MIN_PASSPHRASE = 16
const ITERATIONS = 600_000

export interface VaultFile {
  format: 'avatar3d-vault'
  version: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  data: string
  /** Date de création : permet de proposer un coffre plus récent. */
  created: string
}

/** Ce que contient le coffre : clés et réglages de connexion (pas les personnages ni les voix). */
export interface VaultSecrets {
  activeProvider: ProviderId
  providers: Partial<Record<ProviderId, Partial<ProviderConfig>>>
  tts: {
    engine: TTSEngineId
    openai?: { apiKey: string; baseUrl: string; model: string }
    elevenlabs?: { apiKey: string; model: string }
  }
  stt: {
    engine: STTEngineId
    whisper?: { apiKey: string; baseUrl: string; model: string }
  }
}

/* -------------------------------- Contenu du coffre -------------------------------- */

export function collectSecrets(s: Settings): VaultSecrets {
  const providers: VaultSecrets['providers'] = {}
  for (const [id, p] of Object.entries(s.providers) as [ProviderId, ProviderConfig][]) {
    if (p.apiKey || p.workspaceId || id === s.activeProvider) {
      providers[id] = { apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.model, ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}) }
    }
  }
  const o = s.tts.openai
  const e = s.tts.elevenlabs
  const w = s.stt.whisper
  return {
    activeProvider: s.activeProvider,
    providers,
    tts: {
      engine: s.tts.engine,
      ...(o.apiKey ? { openai: { apiKey: o.apiKey, baseUrl: o.baseUrl, model: o.model } } : {}),
      ...(e.apiKey ? { elevenlabs: { apiKey: e.apiKey, model: e.model } } : {}),
    },
    stt: { engine: s.stt.engine, ...(w.apiKey || s.stt.engine === 'whisper' ? { whisper: { apiKey: w.apiKey, baseUrl: w.baseUrl, model: w.model } } : {}) },
  }
}

/** Nombre de clés présentes dans le coffre (pour l'afficher à l'utilisateur). */
export function countKeys(v: VaultSecrets): number {
  return (
    Object.values(v.providers).filter((p) => p?.apiKey).length +
    (v.tts.openai?.apiKey ? 1 : 0) +
    (v.tts.elevenlabs?.apiKey ? 1 : 0) +
    (v.stt.whisper?.apiKey ? 1 : 0)
  )
}

export function applySecrets(s: Settings, v: VaultSecrets): void {
  for (const [id, p] of Object.entries(v.providers) as [ProviderId, Partial<ProviderConfig>][]) {
    if (!(id in PROVIDERS) || !p) continue
    Object.assign(s.providers[id], clean(p))
  }
  if (v.activeProvider in PROVIDERS) s.activeProvider = v.activeProvider
  if (v.tts?.engine) s.tts.engine = v.tts.engine
  if (v.tts?.openai) Object.assign(s.tts.openai, clean(v.tts.openai))
  if (v.tts?.elevenlabs) Object.assign(s.tts.elevenlabs, clean(v.tts.elevenlabs))
  if (v.stt?.engine) s.stt.engine = v.stt.engine
  if (v.stt?.whisper) Object.assign(s.stt.whisper, clean(v.stt.whisper))
}

/** Chemins des réglages qui reçoivent une clé du coffre (ex. « providers.openai.apiKey »). */
export function keyPaths(v: VaultSecrets): string[] {
  return [
    ...(Object.entries(v.providers) as [ProviderId, Partial<ProviderConfig> | undefined][])
      .filter(([id, p]) => id in PROVIDERS && typeof p?.apiKey === 'string' && p.apiKey.trim())
      .map(([id]) => `providers.${id}.apiKey`),
    ...(v.tts?.openai?.apiKey?.trim() ? ['tts.openai.apiKey'] : []),
    ...(v.tts?.elevenlabs?.apiKey?.trim() ? ['tts.elevenlabs.apiKey'] : []),
    ...(v.stt?.whisper?.apiKey?.trim() ? ['stt.whisper.apiKey'] : []),
  ]
}

/**
 * Déchiffre le coffre et charge ses clés sur cet appareil. Les clés chargées sont marquées
 * « verrouillées » : l'interface ne les affiche plus. Renvoie le nombre de clés chargées.
 */
export async function unlockVault(s: Settings, file: VaultFile, passphrase: string): Promise<number> {
  const secrets = await decryptVault(file, passphrase)
  applySecrets(s, secrets)
  const paths = keyPaths(secrets)
  s.vault.locked = [...new Set([...s.vault.locked, ...paths])]
  s.vault.applied = file.created
  saveSettings(s)
  rememberVault(file)
  return paths.length
}

/** Désactive le coffre : efface de cet appareil les clés qu'il avait chargées. */
export function forgetVaultKeys(s: Settings): number {
  const n = s.vault.locked.length
  for (const path of s.vault.locked) setPath(s, path, '')
  s.vault.locked = []
  s.vault.applied = ''
  saveSettings(s)
  return n
}

/** Libère une seule clé du coffre (effacée) pour pouvoir en saisir une autre à la main. */
export function releaseKey(s: Settings, path: string): void {
  if (!s.vault.locked.includes(path)) return
  setPath(s, path, '')
  s.vault.locked = s.vault.locked.filter((p) => p !== path)
  saveSettings(s)
}

/** Nombre de clés du coffre réellement présentes sur cet appareil. */
export function loadedVaultKeys(s: Settings): number {
  return s.vault.locked.filter((p) => {
    const v = getPath(s, p)
    return typeof v === 'string' && v !== ''
  }).length
}

/** Ne garde que les chaînes (un fichier modifié à la main ne doit pas casser les réglages). */
function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).trim()])) as Partial<T>
}

/* ------------------------------------ Chiffrement ------------------------------------ */

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Vérifie que la phrase secrète est assez longue pour résister aux tentatives de devinette. */
export function passphraseProblem(passphrase: string): string | null {
  const p = passphrase.trim()
  if (p.length < MIN_PASSPHRASE) return `La phrase secrète doit faire au moins ${MIN_PASSPHRASE} caractères (par exemple 4 mots au hasard).`
  if (new Set(p.toLowerCase()).size < 8) return 'La phrase secrète est trop répétitive : utilise plusieurs mots différents.'
  return null
}

export async function encryptVault(secrets: VaultSecrets, passphrase: string, iterations = ITERATIONS): Promise<VaultFile> {
  const problem = passphraseProblem(passphrase)
  if (problem) throw new Error(problem)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase.trim(), salt, iterations)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(secrets))))
  return { format: 'avatar3d-vault', version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(data), created: new Date().toISOString() }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Phrase secrète incorrecte.')
  }
}

export async function decryptVault(file: VaultFile, passphrase: string): Promise<VaultSecrets> {
  const key = await deriveKey(passphrase.trim(), unb64(file.salt), file.iterations)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data))
  } catch {
    throw new WrongPassphraseError() // AES-GCM refuse de déchiffrer avec une mauvaise clé
  }
  return JSON.parse(new TextDecoder().decode(plain)) as VaultSecrets
}

export function parseVault(text: string): VaultFile | null {
  try {
    const v = JSON.parse(text) as VaultFile
    return v?.format === 'avatar3d-vault' && v.version === 1 && v.salt && v.iv && v.data && v.iterations > 0 ? v : null
  } catch {
    return null
  }
}

/* ------------------------------- Fichier du coffre ------------------------------- */

const FILE_KEY = 'companion.vaultfile.v1'

/**
 * Garde une copie du fichier chiffré (sans la phrase secrète, il est illisible) pour pouvoir le
 * déverrouiller plus tard, par exemple en réalité augmentée, même s'il avait été importé à la main.
 */
export function rememberVault(file: VaultFile): void {
  try {
    localStorage.setItem(FILE_KEY, JSON.stringify(file))
  } catch {
    /* stockage plein ou indisponible : le coffre du site reste utilisable */
  }
}

export function rememberedVault(): VaultFile | null {
  try {
    return parseVault(localStorage.getItem(FILE_KEY) ?? '')
  } catch {
    return null
  }
}

/** Coffre le plus récent disponible : celui du site, sinon le dernier importé sur cet appareil. */
export async function availableVault(): Promise<VaultFile | null> {
  const site = await fetchVault()
  const local = rememberedVault()
  if (site && local) return site.created >= local.created ? site : local
  return site ?? local
}

/** Coffre publié avec le site, s'il existe. */
export async function fetchVault(): Promise<VaultFile | null> {
  try {
    const res = await fetch(VAULT_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return parseVault(await res.text())
  } catch {
    return null
  }
}
