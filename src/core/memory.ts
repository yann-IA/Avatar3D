import { createLLM, type ChatMessage, type LLMClient } from '../llm'
import type { Settings } from '../settings'

/** Un souvenir : une information durable sur l'utilisateur, apprise en conversation. */
export interface MemoryItem {
  id: string
  text: string
  created: number
  updated: number
  /** Personnage avec qui l'information a été apprise. */
  by?: string
}

export interface MemoryOps {
  add: string[]
  update: { id: string; text: string }[]
  delete: string[]
}

const STORAGE_KEY = 'companion.memory.v1'
/** Nombre maximal de souvenirs conservés (les plus anciens sont oubliés au-delà). */
export const MAX_ITEMS = 300
/** Nombre maximal de souvenirs rappelés au personnage à chaque message. */
export const MAX_IN_PROMPT = 40
/** Pause dans la conversation avant de mémoriser (les échanges rapprochés sont traités ensemble). */
const IDLE_DELAY = 12_000
/** Au-delà de ce nombre de messages en attente, on mémorise sans attendre la pause. */
const BATCH_SIZE = 10

/* ------------------------------ Fonctions pures ------------------------------ */

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const words = (s: string) => new Set(normalize(s).split(' ').filter((w) => w.length >= 4))

/** Lit la réponse JSON de l'IA (tolère du texte ou des balises ``` autour). */
export function parseOps(text: string, knownIds: Set<string>): MemoryOps {
  const ops: MemoryOps = { add: [], update: [], delete: [] }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return ops
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return ops
  }
  const o = raw as Record<string, unknown>
  const clean = (t: unknown) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 240) : '')
  if (Array.isArray(o.add)) ops.add = o.add.map(clean).filter((t) => t.length >= 3).slice(0, 8)
  if (Array.isArray(o.update)) {
    ops.update = o.update
      .map((u) => ({ id: String((u as { id?: unknown })?.id ?? ''), text: clean((u as { text?: unknown })?.text) }))
      .filter((u) => knownIds.has(u.id) && u.text.length >= 3)
  }
  if (Array.isArray(o.delete)) ops.delete = o.delete.map(String).filter((id) => knownIds.has(id))
  return ops
}

/** Applique des opérations à une liste de souvenirs ; renvoie la nouvelle liste et les ajouts. */
export function applyOps(items: MemoryItem[], ops: MemoryOps, now: number, by?: string): { items: MemoryItem[]; added: MemoryItem[] } {
  const removed = new Set(ops.delete)
  let next = items.filter((m) => !removed.has(m.id))
  for (const u of ops.update) {
    const m = next.find((x) => x.id === u.id)
    if (m && m.text !== u.text) Object.assign(m, { text: u.text, updated: now })
  }
  const known = new Set(next.map((m) => normalize(m.text)))
  const added: MemoryItem[] = []
  for (const text of ops.add) {
    const key = normalize(text)
    if (!key || known.has(key)) continue
    known.add(key)
    const item = { id: newId(), text, created: now, updated: now, ...(by ? { by } : {}) }
    added.push(item)
    next.push(item)
  }
  if (next.length > MAX_ITEMS) next = [...next].sort((a, b) => b.updated - a.updated).slice(0, MAX_ITEMS).sort((a, b) => a.created - b.created)
  return { items: next, added }
}

let counter = 0
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Souvenirs à rappeler pour un message : tous s'il y en a peu, sinon ceux qui partagent des mots
 * avec le message, complétés par les plus récents. Renvoyés dans l'ordre chronologique.
 */
export function selectRelevant(items: MemoryItem[], query: string, max = MAX_IN_PROMPT): MemoryItem[] {
  if (items.length <= max) return [...items].sort((a, b) => a.created - b.created)
  const q = words(query)
  const byRecency = [...items].sort((a, b) => b.updated - a.updated)
  const scored = byRecency.map((m, rank) => {
    let overlap = 0
    for (const w of words(m.text)) if (q.has(w)) overlap++
    return { m, score: overlap * 3 + (1 - rank / items.length) }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.m)
    .sort((a, b) => a.created - b.created)
}

const shortDate = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short' })

/** Section du prompt système qui rappelle les souvenirs au personnage. */
export function memoryPrompt(items: MemoryItem[]): string {
  if (!items.length) return ''
  const lines = items.map((m) => `- (${shortDate.format(m.created)}) ${m.text}`).join('\n')
  return `Souvenirs de tes conversations précédentes avec l’utilisateur (ne les récite pas comme une liste : sers-t’en naturellement quand c’est utile, comme un ami qui se souvient) :\n${lines}`
}

export const EXTRACTION_PROMPT = `Tu gères la mémoire à long terme d’un compagnon virtuel. À partir des nouveaux échanges, mets à jour la liste des souvenirs sur l’utilisateur.

Retiens seulement des informations durables et utiles pour de futures conversations : son prénom et son identité (âge, métier, ville…), ses goûts, ses proches et animaux, ses projets, les événements importants de sa vie (en indiquant la date quand c’est utile), la façon dont il aime qu’on lui parle, et tout ce qu’il demande explicitement de retenir.
Ignore les banalités, les questions ponctuelles et ce que le compagnon dit de lui-même.
Si une information change ou se précise, modifie le souvenir existant plutôt que d’en ajouter un. Si l’utilisateur demande d’oublier quelque chose, supprime le souvenir correspondant.
Chaque souvenir est une phrase courte et autonome, à la troisième personne (« L’utilisateur… », ou son prénom s’il est connu).

Réponds UNIQUEMENT avec un objet JSON, sans autre texte :
{"add": ["nouveau souvenir"], "update": [{"id": "m…", "text": "souvenir corrigé"}], "delete": ["m…"]}
Si rien n’est à retenir : {"add": [], "update": [], "delete": []}`

/** Message envoyé à l'IA pour extraire les souvenirs d'un lot d'échanges. */
export function extractionInput(items: MemoryItem[], batch: ChatMessage[], assistantName: string, now: number): string {
  const date = new Intl.DateTimeFormat('fr', { dateStyle: 'full' }).format(now)
  const known = items.length ? items.map((m) => `[${m.id}] ${m.text}`).join('\n') : '(aucun)'
  const talk = batch.map((m) => `${m.role === 'user' ? 'Utilisateur' : assistantName} : ${m.content}`).join('\n')
  return `Date du jour : ${date}\n\nSouvenirs actuels :\n${known}\n\nNouveaux échanges :\n${talk}`
}

/* --------------------------------- Gestionnaire --------------------------------- */

interface Stored {
  items: MemoryItem[]
  /** Messages pas encore analysés (conservés si la page est fermée avant la mémorisation). */
  pending: ChatMessage[]
}

/**
 * Mémoire à long terme : stocke les souvenirs dans le navigateur, les fait extraire par l'IA quand
 * la conversation marque une pause, et fournit ceux à rappeler au personnage.
 */
export class MemoryManager {
  items: MemoryItem[] = []
  pending: ChatMessage[] = []
  private timer = 0
  private running = false
  private readonly listeners = new Set<(added: MemoryItem[]) => void>()

  constructor(
    private readonly settings: Settings,
    private readonly client: () => LLMClient = () => createLLM(settings),
  ) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Stored | null
      if (raw) {
        this.items = Array.isArray(raw.items) ? raw.items : []
        this.pending = Array.isArray(raw.pending) ? raw.pending : []
      }
    } catch {
      /* stockage illisible : on repart de zéro */
    }
    if (this.pending.length) this.schedule(3000) // échanges non mémorisés lors de la dernière visite
  }

  get enabled(): boolean {
    return this.settings.memory.enabled
  }

  get busy(): boolean {
    return this.running
  }

  /** Appelé après chaque mémorisation ou modification ; `added` liste les nouveaux souvenirs. */
  onChange(fn: (added: MemoryItem[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(added: MemoryItem[] = []): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: this.items, pending: this.pending } satisfies Stored))
    } catch {
      /* stockage plein ou bloqué */
    }
    for (const fn of this.listeners) fn(added)
  }

  /** Section de prompt à ajouter pour répondre à `query`. */
  promptFor(query: string): string {
    return this.enabled ? memoryPrompt(selectRelevant(this.items, query)) : ''
  }

  /** Enregistre des échanges terminés ; ils seront analysés à la prochaine pause. */
  observe(messages: ChatMessage[]): void {
    if (!this.enabled) return
    this.pending.push(...messages.filter((m) => m.content.trim()))
    this.changed()
    this.schedule(this.pending.length >= BATCH_SIZE ? 0 : IDLE_DELAY)
  }

  /** Repousse la mémorisation (l'utilisateur parle encore). */
  postpone(): void {
    if (this.pending.length) this.schedule(IDLE_DELAY)
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), delay)
  }

  /** Analyse maintenant les échanges en attente. Renvoie le nombre de souvenirs ajoutés. */
  async flush(): Promise<number> {
    clearTimeout(this.timer)
    if (this.running || !this.pending.length || !this.enabled) return 0
    this.running = true
    const batch = this.pending.slice()
    try {
      const reply = await this.client().streamChat({
        system: EXTRACTION_PROMPT,
        messages: [{ role: 'user', content: extractionInput(this.items, batch, this.settings.persona.name, Date.now()) }],
        signal: new AbortController().signal,
        onText: () => {},
      })
      const ops = parseOps(reply, new Set(this.items.map((m) => m.id)))
      const { items, added } = applyOps(this.items, ops, Date.now(), this.settings.persona.name)
      this.items = items
      this.pending.splice(0, batch.length)
      this.changed(added)
      return added.length
    } catch (err) {
      console.warn('Mémoire : analyse impossible pour le moment', err)
      this.schedule(60_000) // nouvel essai plus tard (réseau, quota…)
      return 0
    } finally {
      this.running = false
    }
  }

  add(text: string): void {
    const { items } = applyOps(this.items, { add: [text.trim()], update: [], delete: [] }, Date.now(), this.settings.persona.name)
    this.items = items
    this.changed()
  }

  remove(id: string): void {
    this.items = this.items.filter((m) => m.id !== id)
    this.changed()
  }

  clear(): void {
    this.items = []
    this.pending = []
    clearTimeout(this.timer)
    this.changed()
  }

  /** Mémoire désactivée : les échanges en attente ne seront pas analysés. */
  disable(): void {
    this.pending = []
    clearTimeout(this.timer)
    this.changed()
  }

  exportJSON(): string {
    return JSON.stringify({ format: 'avatar3d-memory', version: 1, items: this.items }, null, 2)
  }

  /** Importe des souvenirs (fusionnés avec les existants). Renvoie le nombre de souvenirs ajoutés. */
  importJSON(json: string): number {
    const data = JSON.parse(json) as { items?: { text?: unknown; created?: unknown; by?: unknown }[] }
    if (!Array.isArray(data.items)) throw new Error('Fichier de mémoire invalide.')
    const known = new Set(this.items.map((m) => normalize(m.text)))
    let count = 0
    for (const it of data.items) {
      const text = typeof it.text === 'string' ? it.text.trim().slice(0, 240) : ''
      if (!text || known.has(normalize(text))) continue
      known.add(normalize(text))
      const created = typeof it.created === 'number' ? it.created : Date.now()
      this.items.push({ id: newId(), text, created, updated: created, ...(typeof it.by === 'string' ? { by: it.by } : {}) })
      count++
    }
    this.changed()
    return count
  }
}
