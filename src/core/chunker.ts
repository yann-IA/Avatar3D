import { parseSegment, type Emotion, type Segment } from './emotion'

/**
 * Découpe le flux de texte du modèle en phrases dès qu'elles sont complètes, pour que
 * l'avatar commence à parler sans attendre la fin de la réponse.
 */
export class SentenceChunker {
  private buffer = ''
  private emotion: Emotion = 'neutral'

  constructor(
    private readonly onSegment: (s: Segment) => void,
    private readonly gestures?: Map<string, string>,
    private readonly minLength = 12,
    private readonly maxLength = 220,
  ) {}

  push(delta: string): void {
    this.buffer += delta
    for (;;) {
      const cut = this.findCut()
      if (cut < 0) break
      this.emit(this.buffer.slice(0, cut))
      this.buffer = this.buffer.slice(cut)
    }
  }

  flush(): void {
    this.emit(this.buffer)
    this.buffer = ''
  }

  private emit(raw: string): void {
    const seg = parseSegment(raw, this.emotion, this.gestures)
    this.emotion = seg.emotion
    if (/[\p{L}\p{N}]/u.test(seg.text)) this.onSegment(seg)
    else if (seg.gesture) this.onSegment({ ...seg, text: '' }) // geste seul, sans paroles
  }

  /** Position de coupe (exclusive) ou -1 si aucune phrase n'est encore terminée. */
  private findCut(): number {
    const b = this.buffer
    // Une balise d'émotion en cours d'écriture ne doit pas être coupée.
    const open = b.lastIndexOf('[')
    const limit = open > b.lastIndexOf(']') ? open : b.length

    for (let i = 0; i < limit; i++) {
      const c = b[i]
      if (c === '\n' && i >= 1) return i + 1
      if ('.!?…。！？'.includes(c)) {
        let j = i + 1
        while (j < b.length && '.!?…"»)'.includes(b[j])) j++
        if (j >= b.length) return -1 // on ne sait pas encore si la phrase continue (« 3.14 », « ... »)
        if (/\s/.test(b[j]) && this.visibleLength(b.slice(0, j)) >= this.minLength) return j
      }
    }
    if (limit > this.maxLength) {
      // Phrase trop longue : on coupe à la dernière virgule ou espace.
      const window = b.slice(0, this.maxLength)
      const comma = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' : '))
      if (comma > this.minLength) return comma + 1
      const space = window.lastIndexOf(' ')
      if (space > this.minLength) return space + 1
    }
    return -1
  }

  private visibleLength(s: string): number {
    return s.replace(/\[[^\]]*\]/g, '').trim().length
  }
}
