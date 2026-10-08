import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryManager, applyOps, memoryPrompt, parseOps, selectRelevant, type MemoryItem } from '../src/core/memory'
import type { ChatRequest, LLMClient } from '../src/llm'
import { defaultSettings } from '../src/settings'

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage
  ;(globalThis as { window?: unknown }).window = globalThis
})

const item = (id: string, text: string, t = 1): MemoryItem => ({ id, text, created: t, updated: t })

describe('parseOps', () => {
  it('lit un JSON entouré de texte ou de balises', () => {
    const ops = parseOps('Voici :\n```json\n{"add":["L’utilisateur s’appelle Yann"],"update":[{"id":"m1","text":"Il a 2 chats"}],"delete":["m2","inconnu"]}\n```', new Set(['m1', 'm2']))
    expect(ops).toEqual({ add: ['L’utilisateur s’appelle Yann'], update: [{ id: 'm1', text: 'Il a 2 chats' }], delete: ['m2'] })
  })
  it('ignore une réponse illisible', () => {
    expect(parseOps('Je ne sais pas', new Set())).toEqual({ add: [], update: [], delete: [] })
    expect(parseOps('{"add": [', new Set())).toEqual({ add: [], update: [], delete: [] })
  })
})

describe('applyOps', () => {
  it('ajoute sans doublon, modifie et supprime', () => {
    const items = [item('m1', 'Yann aime le jazz'), item('m2', 'Yann a un chat')]
    const { items: next, added } = applyOps(items, { add: ['yann AIME le jazz !', 'Yann est développeur'], update: [{ id: 'm2', text: 'Yann a deux chats' }], delete: [] }, 5, 'Bip')
    expect(next.map((m) => m.text)).toEqual(['Yann aime le jazz', 'Yann a deux chats', 'Yann est développeur'])
    expect(added).toHaveLength(1)
    expect(added[0].by).toBe('Bip')
    const after = applyOps(next, { add: [], update: [], delete: ['m1'] }, 6).items
    expect(after.map((m) => m.id)).not.toContain('m1')
  })
})

describe('selectRelevant', () => {
  it('garde tout quand il y a peu de souvenirs', () => {
    expect(selectRelevant([item('a', 'x', 2), item('b', 'y', 1)], 'z').map((m) => m.id)).toEqual(['b', 'a'])
  })
  it('privilégie les souvenirs liés au message', () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`m${i}`, `souvenir banal numéro ${i}`, i + 10))
    many.push(item('chat', 'Yann a un chat qui s’appelle Moustache', 1))
    const picked = selectRelevant(many, 'Comment va Moustache, mon chat ?', 10)
    expect(picked).toHaveLength(10)
    expect(picked[0].id).toBe('chat')
  })
  it('formate la section du prompt', () => {
    expect(memoryPrompt([item('a', 'Yann aime le jazz', Date.UTC(2026, 9, 8))])).toMatch(/Souvenirs[\s\S]*- \(8 oct\.\) Yann aime le jazz/)
    expect(memoryPrompt([])).toBe('')
  })
})

describe('MemoryManager', () => {
  it('mémorise les échanges en attente grâce à l’IA, puis les rappelle', async () => {
    const requests: ChatRequest[] = []
    const fake: LLMClient = {
      async streamChat(req) {
        requests.push(req)
        return '{"add":["L’utilisateur s’appelle Yann et vit à Lyon"],"update":[],"delete":[]}'
      },
      async listModels() {
        return []
      },
    }
    const s = defaultSettings()
    const mem = new MemoryManager(s, () => fake)
    mem.observe([
      { role: 'user', content: 'Salut, moi c’est Yann, je vis à Lyon.' },
      { role: 'assistant', content: '[happy] Enchantée Yann !' },
    ])
    expect(mem.pending).toHaveLength(2)
    expect(await mem.flush()).toBe(1)
    expect(mem.pending).toHaveLength(0)
    expect(requests[0].messages[0].content).toContain('Utilisateur : Salut, moi c’est Yann')
    expect(mem.promptFor('Tu te souviens de moi ?')).toContain('Yann et vit à Lyon')
    // persistance
    expect(new MemoryManager(s, () => fake).items).toHaveLength(1)
    // désactivée : plus de rappel ni d'analyse
    s.memory.enabled = false
    expect(mem.promptFor('x')).toBe('')
    mem.observe([{ role: 'user', content: 'test' }])
    expect(mem.pending).toHaveLength(0)
  })

  it('garde les échanges en attente si l’IA est injoignable', async () => {
    const mem = new MemoryManager(defaultSettings(), () => ({
      streamChat: async () => {
        throw new Error('réseau')
      },
      listModels: async () => [],
    }))
    mem.observe([{ role: 'user', content: 'Je m’appelle Yann' }])
    expect(await mem.flush()).toBe(0)
    expect(mem.pending).toHaveLength(1)
  })

  it('exporte et réimporte sans doublon', () => {
    const mem = new MemoryManager(defaultSettings())
    mem.add('Yann aime le jazz')
    const json = mem.exportJSON()
    expect(mem.importJSON(json)).toBe(0)
    const other = new MemoryManager(defaultSettings())
    other.clear()
    expect(other.importJSON(json)).toBe(1)
  })
})
