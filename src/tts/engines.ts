import { AudioLipSync, TextLipSync, type MouthDriver } from '../avatar/lipsync'
import { describeError } from '../llm/openai'
import { viaProxy, type Settings } from '../settings'
import { audioContext } from './audio'

/** Un moteur de synthèse vocale : `prepare` peut être lancé à l'avance pour la phrase suivante. */
export interface TTSEngine<P = unknown> {
  prepare(text: string): Promise<P>
  /** Joue la phrase ; `onMouth` reçoit la source de synchronisation labiale (null = bouche fermée). */
  play(prepared: P, onMouth: (driver: MouthDriver | null) => void): Promise<void>
  stop(): void
}

/* ----------------------------- Voix du navigateur ----------------------------- */

export function browserVoices(): SpeechSynthesisVoice[] {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : []
}

export class BrowserTTS implements TTSEngine<string> {
  private finish: (() => void) | null = null

  constructor(private readonly s: Settings) {}

  async prepare(text: string): Promise<string> {
    if (!('speechSynthesis' in window)) throw new Error("La synthèse vocale n'est pas disponible dans ce navigateur.")
    return text
  }

  play(text: string, onMouth: (d: MouthDriver | null) => void): Promise<void> {
    const t = this.s.tts
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      const voices = browserVoices()
      const lang = this.s.persona.language
      u.voice =
        voices.find((v) => v.voiceURI === t.browserVoice) ??
        voices.find((v) => v.lang === lang) ??
        voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) ??
        null
      u.lang = u.voice?.lang ?? lang
      u.pitch = t.pitch
      u.rate = t.rate
      u.volume = t.volume

      const lips = new TextLipSync(text, t.rate)
      const done = () => {
        clearTimeout(watchdog)
        this.finish = null
        onMouth(null)
        resolve()
      }
      this.finish = done
      u.onstart = () => onMouth(lips)
      u.onboundary = (e) => lips.syncTo(e.charIndex)
      u.onend = done
      u.onerror = done
      // Certains navigateurs n'émettent jamais « end » : garde-fou basé sur la durée estimée.
      const watchdog = setTimeout(done, 4000 + (text.length / (14 * t.rate)) * 2000)
      speechSynthesis.speak(u)
    })
  }

  stop(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel()
    this.finish?.()
  }
}

/* ------------------------- Voix « audio » (API distantes) ------------------------- */

abstract class AudioTTS implements TTSEngine<AudioBuffer> {
  private source: AudioBufferSourceNode | null = null
  private finish: (() => void) | null = null

  protected abstract fetchAudio(text: string): Promise<Response>

  async prepare(text: string): Promise<AudioBuffer> {
    const res = await this.fetchAudio(text)
    if (!res.ok) throw new Error(await describeError(res))
    return audioContext().decodeAudioData(await res.arrayBuffer())
  }

  play(buffer: AudioBuffer, onMouth: (d: MouthDriver | null) => void): Promise<void> {
    const ctx = audioContext()
    return new Promise((resolve) => {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const analyser = ctx.createAnalyser()
      src.connect(analyser)
      analyser.connect(ctx.destination)
      const done = () => {
        if (this.source === src) this.source = null
        this.finish = null
        analyser.disconnect()
        onMouth(null)
        resolve()
      }
      src.onended = done
      this.finish = done
      this.source = src
      onMouth(new AudioLipSync(analyser))
      src.start()
    })
  }

  stop(): void {
    try {
      this.source?.stop()
    } catch {
      /* déjà arrêté */
    }
    this.finish?.()
  }
}

/** API compatible OpenAI `/audio/speech` (OpenAI, Kokoro-FastAPI, openedai-speech, LocalAI…). */
export class OpenAITTS extends AudioTTS {
  constructor(private readonly s: Settings) {
    super()
  }

  protected fetchAudio(text: string): Promise<Response> {
    const o = this.s.tts.openai
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey}`
    return fetch(viaProxy(o.baseUrl.replace(/\/+$/, '') + '/audio/speech', this.s.useProxy), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: o.model,
        voice: o.voice,
        input: text,
        speed: o.speed,
        response_format: 'mp3',
        // Seuls les modèles récents (gpt-4o-mini-tts) utilisent les consignes de ton.
        ...(o.instructions && /gpt-4o/.test(o.model) ? { instructions: o.instructions } : {}),
      }),
    })
  }
}

export class ElevenLabsTTS extends AudioTTS {
  constructor(private readonly s: Settings) {
    super()
  }

  protected fetchAudio(text: string): Promise<Response> {
    const e = this.s.tts.elevenlabs
    if (!e.voiceId) throw new Error('Choisis un identifiant de voix ElevenLabs dans les réglages.')
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(e.voiceId)}?output_format=mp3_44100_128`
    return fetch(viaProxy(url, this.s.useProxy), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': e.apiKey },
      body: JSON.stringify({
        text,
        model_id: e.model,
        voice_settings: { stability: e.stability, similarity_boost: e.similarity, style: e.style },
      }),
    })
  }
}

export interface ElevenVoice {
  voice_id: string
  name: string
}

export async function listElevenLabsVoices(s: Settings): Promise<ElevenVoice[]> {
  const res = await fetch(viaProxy('https://api.elevenlabs.io/v1/voices', s.useProxy), {
    headers: { 'xi-api-key': s.tts.elevenlabs.apiKey },
  })
  if (!res.ok) throw new Error(await describeError(res))
  return ((await res.json()) as { voices: ElevenVoice[] }).voices
}

/** Aucun son : seul le texte est affiché, la bouche bouge quand même. */
export class SilentTTS implements TTSEngine<string> {
  private timer = 0
  private finish: (() => void) | null = null

  async prepare(text: string): Promise<string> {
    return text
  }

  play(text: string, onMouth: (d: MouthDriver | null) => void): Promise<void> {
    return new Promise((resolve) => {
      onMouth(new TextLipSync(text, 1))
      this.finish = () => {
        clearTimeout(this.timer)
        this.finish = null
        onMouth(null)
        resolve()
      }
      this.timer = window.setTimeout(this.finish, (text.length / 14) * 1000 + 300)
    })
  }

  stop(): void {
    this.finish?.()
  }
}

export function createTTS(s: Settings): TTSEngine {
  switch (s.tts.engine) {
    case 'openai':
      return new OpenAITTS(s) as TTSEngine
    case 'elevenlabs':
      return new ElevenLabsTTS(s) as TTSEngine
    case 'none':
      return new SilentTTS() as TTSEngine
    default:
      return new BrowserTTS(s) as TTSEngine
  }
}
