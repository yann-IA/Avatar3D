import './styles.css'
import { AvatarStage } from './avatar/stage'
import { Conversation } from './core/conversation'
import { parseSegment, slugify } from './core/emotion'
import { MemoryManager } from './core/memory'
import { DEFAULT_PROFILES, applyProfile, resetProfile, switchProfile } from './profiles'
import { createLLM } from './llm'
import { PROVIDERS, loadSettings, saveSettings, type AnimationEntry, type AvatarEntry } from './settings'
import { deleteAvatarFile, loadAvatarFile, saveAvatarFile } from './storage'
import { unlockAudio } from './tts/audio'
import { createTTS, listElevenLabsVoices } from './tts/engines'
import { SettingsPanel } from './ui/panel'

const settings = loadSettings()
// Première version avec un personnage par avatar : si Léo, Bip ou Dino était déjà choisi
// avec le personnage par défaut (Aiko), il reçoit le sien.
{
  const own = DEFAULT_PROFILES[settings.avatar.current]
  if (own && !Object.keys(settings.profiles).length && settings.avatar.current !== 'sample' && settings.persona.name === DEFAULT_PROFILES.sample.name) {
    applyProfile(settings, own)
    saveSettings(settings)
  }
}
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

const memory = new MemoryManager(settings)
memory.onChange((added) => {
  if (added.length) {
    const more = added.length > 1 ? ` (+${added.length - 1})` : ''
    toast(`💭 ${settings.persona.name} retient : « ${added[0].text} »${more}`, 'info', 4000)
  }
  panel.refresh('memoire')
})

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
  onGesture: (id) => void playGesture(id),
  onMouth: (d) => stage.setMouth(d),
  onMicLevel: (l) => micBtn.style.setProperty('--level', String(l)),
  onError: (m) => toast(m),
}, memory)

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
    else if (!gestureMenu.hidden) gestureMenu.hidden = true
    else {
      convo.interrupt()
      stage.stopGesture()
    }
  }
})

$('settings-btn').addEventListener('click', () => panel.toggle())

/* ------------------------------- Gestes ------------------------------- */

const gestureMenu = $('gesture-menu')
const animationUrls = new Map<string, string>()

async function resolveAnimationUrl(a: AnimationEntry): Promise<string> {
  if (!a.url.startsWith('idb:')) return a.url
  let url = animationUrls.get(a.id)
  if (!url) {
    const blob = await loadAvatarFile(a.url.slice(4))
    if (!blob) throw new Error('Fichier d\u2019animation introuvable dans le stockage du navigateur.')
    url = URL.createObjectURL(blob)
    animationUrls.set(a.id, url)
  }
  return url
}

async function playGesture(id: string): Promise<void> {
  const entry = settings.gestures.list.find((a) => a.id === id)
  if (!entry || !stage.loaded) return
  try {
    await stage.playGesture(await resolveAnimationUrl(entry), entry.repeat, entry.fullBody)
  } catch (e) {
    toast(`Animation « ${entry.name} » : ${(e as Error).message}`)
  }
}

function renderGestureMenu(): void {
  gestureMenu.innerHTML =
    settings.gestures.list
      .map((a) => `<button data-gesture="${a.id}">${a.name.replace(/[<>&]/g, '')}</button>`)
      .join('') + '<button data-gesture="" class="stop">■ Arrêter</button>'
}

$('gesture-btn').addEventListener('click', () => {
  renderGestureMenu()
  gestureMenu.hidden = !gestureMenu.hidden
})
gestureMenu.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-gesture]')
  if (!btn) return
  gestureMenu.hidden = true
  if (btn.dataset.gesture) void playGesture(btn.dataset.gesture)
  else stage.stopGesture()
})
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('#gesture-menu, #gesture-btn')) gestureMenu.hidden = true
})

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
    // Chaque avatar a son personnage : on mémorise celui de l'avatar quitté et on charge le sien.
    const changed = switchProfile(settings, settings.avatar.current, entry.id)
    settings.avatar.current = entry.id
    saveSettings(settings)
    if (changed) {
      personaChanged()
      toast(`${settings.persona.name} est là ! Son nom, sa personnalité et sa voix sont chargés.`, 'info', 3500)
    }
  } catch (e) {
    toast(`Impossible de charger l’avatar : ${(e as Error).message}`)
  } finally {
    loader.hidden = true
    if (panel.isOpen) panel.render()
  }
}

/** Le personnage a changé (nom, voix…) : mise à jour de l'affichage et de la voix. */
function personaChanged(): void {
  $('persona-name').textContent = settings.persona.name
  convo.reloadVoice()
}

/* ------------------------------ Réglages ------------------------------ */

const panel = new SettingsPanel(settings, {
  onChange(path) {
    if (path.startsWith('tts.') || path === 'persona.language' || path === 'useProxy') convo.reloadVoice()
    if (path === 'persona.name') $('persona-name').textContent = settings.persona.name
    if (path === 'memory.enabled' && !settings.memory.enabled) memory.disable()
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
  playGesture: (id) => void playGesture(id),
  async importAnimation(file) {
    const id = `anim-${Date.now().toString(36)}`
    const name = file.name.replace(/\.vrma$/i, '')
    try {
      await saveAvatarFile(id, file)
      const entry: AnimationEntry = {
        id,
        name,
        tag: slugify(name) || id,
        hint: name,
        url: `idb:${id}`,
        repeat: 1,
        fullBody: true,
      }
      await stage.gestures.load(await resolveAnimationUrl(entry)) // vérifie que le fichier est lisible
      settings.gestures.list.push(entry)
      saveSettings(settings)
      panel.render()
      void playGesture(id)
    } catch (e) {
      animationUrls.delete(id)
      await deleteAvatarFile(id).catch(() => {})
      toast(`Import impossible : ${(e as Error).message}`)
    }
  },
  async removeAnimation(id) {
    const entry = settings.gestures.list.find((a) => a.id === id)
    if (!entry || entry.builtin) return
    settings.gestures.list = settings.gestures.list.filter((a) => a.id !== id)
    if (entry.url.startsWith('idb:')) await deleteAvatarFile(entry.url.slice(4)).catch(() => {})
    const url = animationUrls.get(id)
    if (url) URL.revokeObjectURL(url)
    animationUrls.delete(id)
    saveSettings(settings)
    panel.render()
  },
  resetPersona() {
    if (!resetProfile(settings)) return
    personaChanged()
    panel.render()
    toast(`Personnage d\u2019origine de ${settings.persona.name} rétabli.`, 'info', 3000)
  },
  memory: () => memory,
  memoryAdd: (text) => memory.add(text),
  memoryRemove: (id) => memory.remove(id),
  memoryClear() {
    if (confirm(`Effacer tous les souvenirs ? ${settings.persona.name} oubliera tout ce qu’il sait de toi.`)) memory.clear()
  },
  async memoryFlush() {
    const n = await memory.flush()
    if (!n) toast('Rien de nouveau à retenir pour le moment.', 'info', 2500)
  },
  memoryExport() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([memory.exportJSON()], { type: 'application/json' }))
    a.download = `avatar3d-memoire-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
  async memoryImport(file) {
    try {
      const n = memory.importJSON(await file.text())
      toast(`${n} souvenir${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}.`, 'info', 3000)
    } catch (e) {
      toast(`Import impossible : ${(e as Error).message}`)
    }
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
// Réaffiche le dernier échange de la conversation reprise.
{
  const last = convo.lastExchange
  if (last) {
    userLine.textContent = last.user
    aiLine.textContent = parseSegment(last.assistant, 'neutral').text
  }
}
$('subtitles').classList.toggle('hidden', !settings.ui.subtitles)
stage.followPointer = settings.avatar.followPointer
stage.setQuality(settings.ui.quality)
stage.setBackground(settings.ui.background)
void loadAvatar(settings.avatar.current).then(() => {
  stage.setFraming(settings.avatar.framing, true)
  // Précharge les gestes fournis pour qu'ils démarrent sans délai.
  for (const a of settings.gestures.list) if (a.builtin) void stage.gestures.load(a.url).catch(() => {})
})

if (needsSetup()) {
  toast('Bienvenue ! Ouvre les réglages (⚙) pour choisir ton IA et sa voix.', 'info', 9000)
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => {}))
}
