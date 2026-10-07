import './styles.css'
import { AvatarStage } from './avatar/stage'
import { Conversation } from './core/conversation'
import { createLLM } from './llm'
import { PROVIDERS, loadSettings, saveSettings, type AvatarEntry } from './settings'
import { deleteAvatarFile, loadAvatarFile, saveAvatarFile } from './storage'
import { unlockAudio } from './tts/audio'
import { createTTS, listElevenLabsVoices } from './tts/engines'
import { SettingsPanel } from './ui/panel'

const settings = loadSettings()
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const stage = new AvatarStage($<HTMLCanvasElement>('stage'))
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { stage })
const statusEl = $('status')
const userLine = $('user-line')
const aiLine = $('ai-line')
const toastEl = $('toast')
const micBtn = $('mic-btn')

/* ------------------------------ Messages ------------------------------ */

let toastTimer = 0
function toast(message: string, kind: 'error' | 'info' = 'error', ms = 7000): void {
  toastEl.textContent = message
  toastEl.className = `toast ${kind === 'info' ? 'info' : ''}`
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms)
}
toastEl.addEventListener('click', () => (toastEl.hidden = true))

const STATE_LABELS = { idle: 'En attente', listening: 'J’écoute…', thinking: 'Réfléchit…', speaking: 'Parle' }

/* ---------------------------- Conversation ---------------------------- */

const convo = new Conversation(settings, {
  onState: (s) => {
    statusEl.dataset.state = s
    statusEl.textContent = STATE_LABELS[s]
    document.body.dataset.state = s
    stage.setActivity(s)
    micBtn.setAttribute('aria-label', s === 'listening' ? 'Terminer' : s === 'idle' ? 'Parler' : 'Interrompre')
  },
  onUserText: (text, final) => {
    userLine.textContent = text
    userLine.classList.toggle('interim', !final)
  },
  onAssistantText: (text) => {
    aiLine.textContent = text
    aiLine.scrollTop = aiLine.scrollHeight
  },
  onEmotion: (e) => stage.setEmotion(e),
  onMouth: (d) => stage.setMouth(d),
  onMicLevel: (l) => micBtn.style.setProperty('--level', String(l)),
  onError: (m) => toast(m),
})

function needsSetup(): boolean {
  const preset = PROVIDERS[settings.activeProvider]
  return preset.needsKey && !settings.providers[settings.activeProvider].apiKey
}

async function talk(): Promise<void> {
  await unlockAudio()
  if (needsSetup()) {
    panel.open('ia')
    toast('Choisis un fournisseur d’IA et colle ta clé API pour commencer.', 'info')
    return
  }
  await convo.toggleListening()
}

micBtn.addEventListener('click', () => void talk())

$('text-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const input = $<HTMLInputElement>('text-input')
  const text = input.value
  input.value = ''
  void unlockAudio()
  if (needsSetup()) {
    panel.open('ia')
    toast('Choisis un fournisseur d’IA et colle ta clé API pour commencer.', 'info')
    return
  }
  void convo.send(text)
})

window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select')
  if (e.code === 'Space' && !typing && !e.repeat) {
    e.preventDefault()
    void talk()
  } else if (e.code === 'Escape') {
    if (panel.isOpen) panel.close()
    else convo.interrupt()
  }
})

$('settings-btn').addEventListener('click', () => panel.toggle())

/* ------------------------------- Avatars ------------------------------- */

let objectUrl: string | null = null

async function resolveAvatarUrl(a: AvatarEntry): Promise<string> {
  if (a.url.startsWith('idb:')) {
    const blob = await loadAvatarFile(a.url.slice(4))
    if (!blob) throw new Error('Fichier d’avatar introuvable dans le stockage du navigateur.')
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(blob)
    return objectUrl
  }
  if (a.localUrl) {
    // Copie locale (npm run fetch-avatar) : utile hors-ligne et plus rapide.
    try {
      const res = await fetch(a.localUrl, { method: 'HEAD' })
      if (res.ok && !res.headers.get('content-type')?.includes('text/html')) return a.localUrl
    } catch {
      /* pas de copie locale */
    }
  }
  return a.url
}

async function loadAvatar(id: string): Promise<void> {
  const entry = settings.avatar.list.find((a) => a.id === id) ?? settings.avatar.list[0]
  const loader = $('loader')
  const loaderText = $('loader-text')
  loader.hidden = false
  loaderText.textContent = `Chargement de « ${entry.name} »…`
  try {
    const url = await resolveAvatarUrl(entry)
    await stage.load(url, (r) => (loaderText.textContent = `Chargement de « ${entry.name} »… ${Math.round(r * 100)} %`))
    settings.avatar.current = entry.id
    saveSettings(settings)
  } catch (e) {
    toast(`Impossible de charger l’avatar : ${(e as Error).message}`)
  } finally {
    loader.hidden = true
    if (panel.isOpen) panel.render()
  }
}

/* ------------------------------ Réglages ------------------------------ */

const panel = new SettingsPanel(settings, {
  onChange(path) {
    if (path.startsWith('tts.') || path === 'persona.language' || path === 'useProxy') convo.reloadVoice()
    if (path === 'persona.name') $('persona-name').textContent = settings.persona.name
    if (path === 'avatar.framing') stage.setFraming(settings.avatar.framing)
    if (path === 'avatar.followPointer') stage.followPointer = settings.avatar.followPointer
    if (path === 'ui.quality') stage.setQuality(settings.ui.quality)
    if (path === 'ui.background') stage.setBackground(settings.ui.background)
    if (path === 'ui.subtitles') $('subtitles').classList.toggle('hidden', !settings.ui.subtitles)
  },
  listModels: () => createLLM(settings).listModels(),
  listElevenVoices: () => listElevenLabsVoices(settings),
  async testVoice() {
    await unlockAudio()
    const tts = createTTS(settings)
    const phrase =
      settings.persona.language.startsWith('fr')
        ? `Bonjour ! Je m’appelle ${settings.persona.name}. Tu aimes ma voix ?`
        : `Hi! My name is ${settings.persona.name}. Do you like my voice?`
    try {
      const prepared = await tts.prepare(phrase)
      stage.setEmotion('happy', 4)
      await tts.play(prepared, (d) => stage.setMouth(d))
    } catch (e) {
      toast(`Voix : ${(e as Error).message}`)
    }
  },
  selectAvatar: (id) => void loadAvatar(id),
  async importAvatar(file) {
    const id = `file-${Date.now().toString(36)}`
    try {
      await saveAvatarFile(id, file)
    } catch (e) {
      toast(`Enregistrement impossible : ${(e as Error).message}`)
      return
    }
    settings.avatar.list.push({ id, name: file.name.replace(/\.vrm$/i, ''), url: `idb:${id}` })
    saveSettings(settings)
    await loadAvatar(id)
  },
  addAvatarUrl(name, url) {
    const id = `url-${Date.now().toString(36)}`
    settings.avatar.list.push({ id, name, url })
    saveSettings(settings)
    void loadAvatar(id)
  },
  async removeAvatar(id) {
    const entry = settings.avatar.list.find((a) => a.id === id)
    if (!entry || entry.builtin) return
    settings.avatar.list = settings.avatar.list.filter((a) => a.id !== id)
    if (entry.url.startsWith('idb:')) await deleteAvatarFile(entry.url.slice(4)).catch(() => {})
    saveSettings(settings)
    panel.render()
  },
  clearHistory() {
    convo.clearHistory()
    userLine.textContent = ''
    aiLine.textContent = ''
    toast('Conversation effacée.', 'info', 2500)
  },
})

/* ------------------------------ Démarrage ------------------------------ */

$('persona-name').textContent = settings.persona.name
$('subtitles').classList.toggle('hidden', !settings.ui.subtitles)
stage.followPointer = settings.avatar.followPointer
stage.setQuality(settings.ui.quality)
stage.setBackground(settings.ui.background)
void loadAvatar(settings.avatar.current).then(() => stage.setFraming(settings.avatar.framing))

if (needsSetup()) {
  toast('Bienvenue ! Ouvre les réglages (⚙) pour choisir ton IA et sa voix.', 'info', 9000)
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => {}))
}
