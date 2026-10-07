import { describe, expect, it } from 'vitest'
import { SentenceChunker } from '../src/core/chunker'
import type { Segment } from '../src/core/emotion'

function run(deltas: string[]): Segment[] {
  const out: Segment[] = []
  const c = new SentenceChunker((s) => out.push(s))
  deltas.forEach((d) => c.push(d))
  c.flush()
  return out
}

describe('SentenceChunker', () => {
  it('émet chaque phrase dès qu’elle est terminée, avec son émotion', () => {
    const out: Segment[] = []
    const c = new SentenceChunker((s) => out.push(s))
    c.push('[happy] Oh, ça me fait vraiment plaisir ! [sa')
    expect(out).toEqual([{ text: 'Oh, ça me fait vraiment plaisir !', emotion: 'happy' }])
    c.push('d] Mais je dois partir bientôt.')
    c.flush()
    expect(out[1]).toEqual({ text: 'Mais je dois partir bientôt.', emotion: 'sad' })
  })

  it('ne coupe pas les nombres décimaux ni les points de suspension en cours', () => {
    const out = run(['Pi vaut environ 3', '.14 et c’est', ' joli... Vraiment très joli.'])
    expect(out.map((s) => s.text)).toEqual(['Pi vaut environ 3.14 et c’est joli...', 'Vraiment très joli.'])
  })

  it('garde l’émotion précédente quand une phrase n’a pas de balise', () => {
    const out = run(['[surprised] Quoi, vraiment ?! Je ne savais pas du tout.'])
    expect(out.every((s) => s.emotion === 'surprised')).toBe(true)
  })

  it('regroupe les phrases trop courtes', () => {
    expect(run(['Oui ! Bien sûr que je peux t’aider.']).map((s) => s.text)).toEqual(['Oui ! Bien sûr que je peux t’aider.'])
  })

  it('coupe une phrase interminable à une virgule', () => {
    const long = 'Alors, ' + 'je pense que c’est une très bonne idée, '.repeat(8) + 'voilà'
    const out = run([long])
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((s) => s.text.length <= 220)).toBe(true)
  })

  it('retire markdown, emojis et actions', () => {
    const out = run(['[joie] *sourit* **Super** idée 😄 ! Allons-y.'])
    expect(out.map((s) => s.text)).toEqual(['Super idée !', 'Allons-y.'])
    expect(out[0].emotion).toBe('happy')
  })
})
