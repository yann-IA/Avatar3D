/** Poids des formes de bouche VRM (visèmes) : a, i, u, e, o. */
export interface Visemes {
  aa: number
  ih: number
  ou: number
  ee: number
  oh: number
}

export const SILENT: Visemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

/** Source qui indique, à chaque image, comment la bouche doit être ouverte. */
export interface MouthDriver {
  sample(): Visemes
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Synchronisation labiale à partir du son réel : le volume ouvre la bouche, et le
 * « centre de gravité » du spectre (approximation des formants) choisit la voyelle.
 */
export class AudioLipSync implements MouthDriver {
  private readonly time: Float32Array<ArrayBuffer>
  private readonly freq: Uint8Array<ArrayBuffer>
  private readonly binHz: number
  private current: Visemes = { ...SILENT }

  constructor(private readonly analyser: AnalyserNode) {
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.4
    this.time = new Float32Array(analyser.fftSize)
    this.freq = new Uint8Array(analyser.frequencyBinCount)
    this.binHz = analyser.context.sampleRate / analyser.fftSize
  }

  sample(): Visemes {
    this.analyser.getFloatTimeDomainData(this.time)
    let sum = 0
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i]
    const rms = Math.sqrt(sum / this.time.length)
    const db = 20 * Math.log10(rms + 1e-8)
    const volume = clamp01((db + 48) / 30)

    this.analyser.getByteFrequencyData(this.freq)
    const lo = Math.floor(150 / this.binHz)
    const hi = Math.min(this.freq.length - 1, Math.ceil(4000 / this.binHz))
    let weighted = 0
    let total = 0
    for (let i = lo; i <= hi; i++) {
      const e = this.freq[i] * this.freq[i]
      weighted += e * i * this.binHz
      total += e
    }
    const centroid = total > 0 ? weighted / total : 1200
    return this.smooth(vowelWeights(centroid, volume))
  }

  private smooth(target: Visemes): Visemes {
    const c = this.current
    for (const k of Object.keys(c) as (keyof Visemes)[]) {
      const rate = target[k] > c[k] ? 0.55 : 0.3 // ouverture rapide, fermeture plus douce
      c[k] += (target[k] - c[k]) * rate
    }
    return c
  }
}

/** Répartit une ouverture de bouche entre les voyelles selon la fréquence centrale du son. */
export function vowelWeights(centroid: number, volume: number): Visemes {
  const centers: [keyof Visemes, number][] = [
    ['ou', 650],
    ['oh', 950],
    ['aa', 1350],
    ['ee', 1900],
    ['ih', 2500],
  ]
  const out = { ...SILENT }
  if (volume <= 0.02) return out
  let norm = 0
  for (const [k, c] of centers) {
    const w = Math.max(0, 1 - Math.abs(centroid - c) / 550)
    out[k] = w
    norm += w
  }
  if (norm === 0) out.aa = norm = 1
  for (const [k] of centers) out[k] = (out[k] / norm) * volume
  // « a » sert de forme de base : une bouche qui parle s'ouvre toujours un peu.
  out.aa = Math.min(1, out.aa + volume * 0.25)
  return out
}

/** Visème associé à une position du texte (pour les voix du navigateur, sans accès au son). */
export function visemeAt(text: string, i: number): keyof Visemes | 'closed' | 'half' {
  const c = text[i]?.toLowerCase() ?? ''
  const next = text[i + 1]?.toLowerCase() ?? ''
  if (!c || /[\s.,!?;:…\-—()"«»]/.test(c)) return 'closed'
  if (c === 'o' && next === 'u') return 'ou'
  if ((c === 'a' || c === 'e') && next === 'u') return 'oh'
  if (c === 'a' && (next === 'i' || next === 'y')) return 'ee'
  if ('aàâá'.includes(c)) return 'aa'
  if ('eéèêëæ'.includes(c)) return 'ee'
  if ('iîïyí'.includes(c)) return 'ih'
  if ('oôöóœ'.includes(c)) return 'oh'
  if ('uûüùúw'.includes(c)) return 'ou'
  if ('mbp'.includes(c)) return 'closed'
  return 'half'
}

/**
 * Synchronisation labiale « simulée » à partir du texte prononcé : on avance dans le texte
 * à la vitesse de lecture estimée, et on se recale sur les événements `boundary` quand le
 * navigateur en fournit.
 */
export class TextLipSync implements MouthDriver {
  private start = 0
  private offset = 0
  private readonly charsPerMs: number
  private current: Visemes = { ...SILENT }
  private lastVowel: keyof Visemes = 'aa'

  constructor(
    private readonly text: string,
    rate: number,
  ) {
    this.charsPerMs = (14 * rate) / 1000
    this.start = performance.now()
  }

  /** Appelé sur un événement `boundary` (début de mot). */
  syncTo(charIndex: number): void {
    this.offset = charIndex
    this.start = performance.now()
  }

  sample(): Visemes {
    const pos = this.offset + (performance.now() - this.start) * this.charsPerMs
    const i = Math.floor(pos)
    const target = { ...SILENT }
    if (i < this.text.length) {
      const v = visemeAt(this.text, i)
      const frac = pos - i
      const amp = 0.55 + 0.4 * Math.sin(Math.PI * frac) // petite pulsation par syllabe
      if (v === 'half') target[this.lastVowel] = 0.2 * amp
      else if (v !== 'closed') {
        target[v] = amp
        this.lastVowel = v
      }
    }
    const c = this.current
    for (const k of Object.keys(c) as (keyof Visemes)[]) c[k] += (target[k] - c[k]) * 0.35
    return c
  }
}
