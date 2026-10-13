import type { MemoryManager } from '../core/memory'
import { DEFAULT_PROFILES } from '../profiles'
import { HOSTED, PROVIDERS, getPath, saveSettings, setPath, type ProviderId, type Settings } from '../settings'
import { browserVoices } from '../tts/engines'
import { browserSTTAvailable, sttEngineFor, whisperKey } from '../stt/engines'

export interface PanelActions {
  onChange(path: string): void
  listModels(): Promise<string[]>
  listElevenVoices(): Promise<{ voice_id: string; name: string }[]>
  testVoice(): void
  selectAvatar(id: string): void
  importAvatar(file: File): void
  addAvatarUrl(name: string, url: string): void
  removeAvatar(id: string): void
  playGesture(id: string): void
  importAnimation(file: File): void
  removeAnimation(id: string): void
  resetPersona(): void
  vaultCreate(): void
  vaultLoad(): void
  vaultImport(file: File): void
  /** Coffre trouvé (site ou fichier importé) : date de création, ou null s'il n'y en a pas. */
  vaultAvailable(): string | null
  vaultForget(): void
  vaultRelease(path: string): void
  memory(): MemoryManager
  memoryAdd(text: string): void
  memoryRemove(id: string): void
  memoryClear(): void
  memoryFlush(): Promise<void>
  memoryExport(): void
  memoryImport(file: File): void
  clearHistory(): void
}

type Tab = 'ia' | 'perso' | 'memoire' | 'voix' | 'ecoute' | 'avatar' | 'gestes' | 'affichage'
const TABS: [Tab, string][] = [
  ['ia', 'IA'],
  ['perso', 'Personnage'],
  ['memoire', 'Mémoire'],
  ['voix', 'Voix'],
  ['ecoute', 'Écoute'],
  ['avatar', 'Avatar'],
  ['gestes', 'Gestes'],
  ['affichage', 'Affichage'],
]

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/* Petits constructeurs HTML ; `data-path` relie le champ au réglage correspondant. */
const text = (label: string, path: string, opts: { type?: string; placeholder?: string; trim?: boolean } = {}) =>
  `<label class="field"><span>${label}</span><input type="${opts.type ?? 'text'}" data-path="${path}" ${opts.trim ? 'data-trim' : ''}
    placeholder="${esc(opts.placeholder)}" spellcheck="false" autocapitalize="off"></label>`
/**
 * Champ de clé API. Volontairement PAS de type « password » : les gestionnaires de mots de
 * passe des navigateurs enregistraient la première clé saisie et la recopiaient ensuite dans
 * les autres champs de clé (IA, Voix, Écoute), écrasant les bonnes valeurs. La clé reste
 * masquée à l'écran (CSS) et un bouton permet de l'afficher.
 */
const secret = (s: Settings, label: string, path: string, placeholder = '') =>
  s.vault.locked.includes(path) && getPath(s, path)
    ? lockedKey(label, path)
    : `<div class="field"><span>${label} <small class="saved" data-saved="${path}"></small></span>
    <div class="row"><input type="text" class="grow secret" data-path="${path}" data-trim
      placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off"
      data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" aria-label="${esc(label)}">
    <button type="button" class="btn" data-reveal aria-label="Afficher ou masquer la clé" title="Afficher / masquer">👁</button></div></div>`
/**
 * Clé chargée depuis le coffre : elle n'est jamais mise dans la page (ni affichable, ni copiable).
 * « Remplacer » l'efface pour en saisir une autre à la main.
 */
const lockedKey = (label: string, path: string) =>
  `<div class="field"><span>${label}</span>
    <div class="row"><div class="grow locked-key" aria-label="${esc(label)} : chargée depuis le coffre, masquée">🔐 Chargée depuis le coffre</div>
    <button type="button" class="btn" data-action="vault-release" data-key="${path}" title="Effacer cette clé pour en saisir une autre">Remplacer</button></div></div>`
/**
 * Champ texte avec une liste de choix (bouton ▾). Remplace les <datalist>, dont la liste ne défile
 * pas sur mobile : ici la liste s'ouvre sous le champ, défile et se filtre en tapant.
 */
type Choice = string | [value: string, label: string]
const combo = (label: string, path: string, choices: Choice[], extra = '') =>
  `<div class="field"><span>${label}</span>
    <div class="row"><input type="text" class="grow" data-path="${path}" spellcheck="false" autocapitalize="off" autocomplete="off">
    ${extra}<button type="button" class="btn" data-pick="${path}" data-choices="${esc(JSON.stringify(choices))}" aria-label="Choisir dans la liste" title="Choisir dans la liste">▾</button></div>
    <div class="picker" data-picker="${path}" hidden></div></div>`
/** Modèles qui ne servent pas à discuter (écoute, voix, images…) : masqués de la liste de l'onglet IA. */
const NON_CHAT = /whisper|transcribe|tts|speech|audio|realtime|dall-e|image|embedding|moderation|davinci|babbage|search|sora|computer-use|guard/i

const range = (label: string, path: string, min: number, max: number, step: number) =>
  `<label class="field"><span>${label} : <output data-out="${path}"></output></span>
    <input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}"></label>`
const check = (label: string, path: string) =>
  `<label class="field inline"><span>${label}</span><input type="checkbox" data-path="${path}"></label>`
const select = (label: string, path: string, options: [string, string][]) =>
  `<label class="field"><span>${label}</span><select data-path="${path}">${options
    .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
    .join('')}</select></label>`
const hint = (html: string) => `<p class="hint">${html}</p>`

/** Indicateur d'état du coffre : clés chargées ou non sur cet appareil. */
const KEY_NAMES: Record<string, string> = { 'tts.openai.apiKey': 'Voix OpenAI', 'tts.elevenlabs.apiKey': 'Voix ElevenLabs', 'stt.whisper.apiKey': 'Écoute Whisper' }
function vaultStatus(s: Settings, available: string | null): string {
  const loaded = s.vault.locked.filter((p) => getPath(s, p))
  if (!loaded.length) {
    const site = new URL('vault.json', location.href).href
    return available
      ? `<div class="vault-status ready">🔒 Coffre trouvé (créé le ${new Date(available).toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' })}), pas encore déverrouillé sur cet appareil.
          <small>Clique sur « Charger le coffre » et tape ta phrase secrète.</small></div>`
      : `<div class="vault-status off">Aucun coffre trouvé pour ce site.
          <small>Adresse vérifiée : ${esc(site)}</small></div>`
  }
  const names = loaded.map((p) => KEY_NAMES[p] ?? `IA ${PROVIDERS[p.split('.')[1] as ProviderId]?.label ?? p}`)
  const when = s.vault.applied ? ` le ${new Date(s.vault.applied).toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' })}` : ''
  return `<div class="vault-status on" role="status">✅ Coffre actif : ${loaded.length} clé${loaded.length > 1 ? 's' : ''} chargée${loaded.length > 1 ? 's' : ''}
    <small>${esc(names.join(' · '))} — coffre créé${when}</small></div>`
}

const LANGUAGES: [string, string][] = [
  ['fr-FR', 'Français'],
  ['en-US', 'Anglais (US)'],
  ['en-GB', 'Anglais (UK)'],
  ['es-ES', 'Espagnol'],
  ['de-DE', 'Allemand'],
  ['it-IT', 'Italien'],
  ['pt-BR', 'Portugais (Brésil)'],
  ['ja-JP', 'Japonais'],
  ['zh-CN', 'Chinois'],
  ['ko-KR', 'Coréen'],
]

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

export class SettingsPanel {
  private tab: Tab = 'ia'
  private readonly root = document.getElementById('panel')!
  private readonly body = document.getElementById('panel-body')!
  private readonly tabs = document.getElementById('tabs')!

  constructor(
    private readonly s: Settings,
    private readonly actions: PanelActions,
  ) {
    document.getElementById('panel-close')!.addEventListener('click', () => this.close())
    this.tabs.innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}" role="tab">${label}</button>`).join('')
    this.tabs.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined
      if (id) this.show(id)
    })
    this.body.addEventListener('input', (e) => this.onInput(e))
    this.body.addEventListener('change', (e) => this.onInput(e))
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => this.tab === 'voix' && this.render())
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  open(tab?: Tab): void {
    this.root.hidden = false
    this.show(tab ?? this.tab)
  }

  close(): void {
    this.root.hidden = true
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  show(tab: Tab): void {
    this.tab = tab
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab))
    this.render()
  }

  /** Ré-affiche l'onglet s'il est actuellement visible (ex. : nouveaux souvenirs). */
  refresh(tab: Tab): void {
    if (this.isOpen && this.tab === tab) this.render()
  }

  render(): void {
    this.body.innerHTML = this.html()
    for (const el of this.body.querySelectorAll<HTMLInputElement>('[data-path]')) {
      const v = getPath(this.s, el.dataset.path!)
      if (el.type === 'checkbox') el.checked = Boolean(v)
      else el.value = String(v ?? '')
      this.updateOutput(el)
    }
    this.bindButtons()
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    const path = el.dataset.path
    if (!path) return
    // Les clés collées emportent souvent un espace ou un retour à la ligne : l'API les refuserait.
    const raw = 'trim' in el.dataset ? el.value.trim() : el.value
    const value = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(raw) : raw
    setPath(this.s, path, value)
    saveSettings(this.s)
    this.updateOutput(el)
    this.flashSaved(path)
    if (e.type === 'change') {
      if ('trim' in el.dataset) el.value = raw
      this.actions.onChange(path)
      // Certains choix changent les champs affichés.
      if (['activeProvider', 'tts.engine', 'stt.engine'].includes(path)) this.render()
    }
  }

  private updateOutput(el: HTMLInputElement): void {
    const out = this.body.querySelector(`[data-out="${el.dataset.path}"]`)
    if (out) out.textContent = el.value
  }

  private html(): string {
    const s = this.s
    switch (this.tab) {
      case 'ia': {
        const id = s.activeProvider
        const preset = PROVIDERS[id]
        const p = `providers.${id}`
        return [
          select('Fournisseur', 'activeProvider', (Object.keys(PROVIDERS) as ProviderId[]).map((k) => [k, PROVIDERS[k].label])),
          preset.needsKey || s.providers[id].apiKey
            ? secret(s, 'Clé API', `${p}.apiKey`, 'sk-…') +
              (preset.keyUrl ? hint(`Obtenir une clé : <a href="${preset.keyUrl}" target="_blank" rel="noopener">${preset.keyUrl}</a>`) : '')
            : hint('Aucune clé nécessaire pour un serveur local.'),
          combo('Modèle', `${p}.model`, preset.models, `<button type="button" class="btn" data-action="models">Lister</button>`),
          text('Adresse de l’API', `${p}.baseUrl`, { type: 'url' }),
          preset.kind === 'anthropic'
            ? text('ID de l\u2019espace de travail (facultatif)', `${p}.workspaceId`, { placeholder: 'wrkspc_…', trim: true }) +
              hint(
                'Le plus simple : dans la console Anthropic, crée ta clé avec une <b>Portée</b> réglée sur un espace de travail (par exemple « Default ») et laisse ce champ vide. Une clé de portée « Organisation » est déconseillée ici : elle donne aussi accès à l\u2019administration de ton organisation. Si tu en utilises quand même une, indique ici l\u2019ID de l\u2019espace de travail (wrkspc_…).',
              )
            : '',
          preset.kind === 'anthropic'
            ? select('Rapidité des réponses (effort)', 'claudeEffort', [
                ['low', 'Rapide (conseillé pour la voix)'],
                ['medium', 'Équilibré'],
                ['high', 'Réfléchi (plus lent)'],
              ]) + hint('Claude Haiku 4.5 ou Sonnet 5.5 répondent plus vite qu’Opus pour une conversation orale.')
            : range('Créativité (température)', 'temperature', 0, 1.5, 0.05),
          range('Longueur max. des réponses (tokens)', 'maxTokens', 128, 4096, 64),
          range('Mémoire de la conversation (messages)', 'historyLength', 2, 60, 2),
          HOSTED
            ? hint(
                'Les clés sont enregistrées uniquement dans ce navigateur et sont envoyées directement au fournisseur choisi. Si un fournisseur refuse les appels depuis un navigateur (erreur « Failed to fetch »), choisis-en un autre (OpenAI, Claude et Groq fonctionnent) ou installe l\u2019application sur ton PC pour utiliser le relais local.',
              )
            : check('Passer par le relais local (contourne CORS)', 'useProxy') +
              hint(
                'Les clés sont enregistrées uniquement dans ce navigateur. Le relais local n’existe qu’avec <code>npm run dev</code> ou <code>npm run preview</code> : active-le si un fournisseur refuse les appels directs depuis le navigateur. Pour Ollama sans relais, lance-le avec <code>OLLAMA_ORIGINS=*</code>.',
              ),
          `<h3>🔐 Coffre à clés</h3>`,
          vaultStatus(s, this.actions.vaultAvailable()),
          hint(
            'Chiffre tes clés avec une phrase secrète pour les retrouver sur un autre appareil (ton téléphone par exemple) en tapant seulement cette phrase. Les clés chargées depuis le coffre restent masquées : personne ne peut les afficher ni les recopier.',
          ),
          `<div class="row" style="flex-wrap:wrap">
             <button class="btn" data-action="vault-create">Créer un coffre…</button>
             <button class="btn" data-action="vault-load">${s.vault.locked.length ? 'Recharger le coffre' : 'Charger le coffre'}</button>
             <label class="btn">Importer un fichier de coffre<input id="vault-file" type="file" accept=".json,application/json" hidden></label>
             ${s.vault.locked.length ? '<button class="btn danger" data-action="vault-forget">Désactiver le coffre</button>' : ''}
           </div>`,
          `<button class="btn danger" data-action="clear">Effacer la conversation</button>`,
        ].join('')
      }

      case 'perso': {
        const avatar = s.avatar.list.find((a) => a.id === s.avatar.current)
        return [
          hint(
            `Ces réglages, ainsi que la voix et son ton, sont propres à l’avatar <b>${esc(avatar?.name ?? '')}</b> : chaque avatar garde son personnage quand tu en changes.`,
          ),
          text('Nom', 'persona.name'),
          select('Langue', 'persona.language', LANGUAGES),
          `<label class="field"><span>Personnalité (prompt système)</span><textarea data-path="persona.prompt"></textarea></label>`,
          hint(
            'Décris son caractère, sa façon de parler, ce qu’il ou elle sait de toi… Les consignes d’émotion (balises [happy], [sad]…) sont ajoutées automatiquement : c’est ce qui fait réagir le visage de l’avatar.',
          ),
          DEFAULT_PROFILES[s.avatar.current]
            ? `<button class="btn" data-action="reset-persona">Rétablir le personnage d’origine (${esc(DEFAULT_PROFILES[s.avatar.current].name)})</button>`
            : '',
        ].join('')
      }

      case 'voix': {
        const engine = select('Moteur de voix', 'tts.engine', [
          ['browser', 'Voix de l’appareil (gratuit, hors-ligne)'],
          ['openai', 'OpenAI / compatible (Kokoro, LocalAI…)'],
          ['elevenlabs', 'ElevenLabs (voix très naturelles)'],
          ['none', 'Muet (texte seulement)'],
        ])
        const test = `<button class="btn primary" data-action="test-voice">Tester la voix</button>`
        if (s.tts.engine === 'browser') {
          const lang = s.persona.language.slice(0, 2)
          const voices = browserVoices()
          const sorted = [...voices.filter((v) => v.lang.startsWith(lang)), ...voices.filter((v) => !v.lang.startsWith(lang))]
          return [
            engine,
            select('Voix', 'tts.browserVoice', [['', `Automatique (${{ female: 'voix féminine', male: 'voix masculine', any: 'meilleure voix' }[s.tts.voiceHint]})`], ...sorted.map((v): [string, string] => [v.voiceURI, `${v.name} (${v.lang})`])]),
            voices.length ? '' : hint('Aucune voix trouvée pour l’instant (elles se chargent parfois après quelques secondes).'),
            range('Hauteur (ton)', 'tts.pitch', 0.5, 2, 0.05),
            range('Vitesse', 'tts.rate', 0.5, 2, 0.05),
            range('Volume', 'tts.volume', 0, 1, 0.05),
            test,
            hint('La qualité dépend du système : les voix « Google » ou « Natural/Online » (Edge) sont les plus agréables.'),
          ].join('')
        }
        if (s.tts.engine === 'openai') {
          return [
            engine,
            secret(s, 'Clé API (voix)', 'tts.openai.apiKey', 'sk-…'),
            text('Adresse de l’API', 'tts.openai.baseUrl', { type: 'url' }),
            combo('Modèle', 'tts.openai.model', ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd', 'kokoro']),
            combo('Voix', 'tts.openai.voice', [...OPENAI_VOICES, 'ff_siwis']),
            `<label class="field"><span>Ton / style de voix (gpt-4o-mini-tts)</span><textarea data-path="tts.openai.instructions" style="min-height:70px"></textarea></label>`,
            range('Vitesse', 'tts.openai.speed', 0.5, 2, 0.05),
            test,
            hint('Avec <code>gpt-4o-mini-tts</code>, le champ « ton » change l’intonation (joyeuse, chuchotée, timide…). Pour une voix locale gratuite : Kokoro-FastAPI (adresse <code>http://localhost:8880/v1</code>, voix française <code>ff_siwis</code>).'),
          ].join('')
        }
        if (s.tts.engine === 'elevenlabs') {
          return [
            engine,
            secret(s, 'Clé API ElevenLabs', 'tts.elevenlabs.apiKey'),
            combo('Voix (identifiant)', 'tts.elevenlabs.voiceId', [], `<button type="button" class="btn" data-action="eleven-voices">Lister</button>`),
            select('Modèle', 'tts.elevenlabs.model', [
              ['eleven_flash_v2_5', 'Flash v2.5 (le plus rapide)'],
              ['eleven_turbo_v2_5', 'Turbo v2.5'],
              ['eleven_multilingual_v2', 'Multilingual v2 (meilleure qualité)'],
            ]),
            range('Stabilité', 'tts.elevenlabs.stability', 0, 1, 0.05),
            range('Ressemblance', 'tts.elevenlabs.similarity', 0, 1, 0.05),
            range('Expressivité', 'tts.elevenlabs.style', 0, 1, 0.05),
            test,
          ].join('')
        }
        return engine + hint('L’avatar bouge les lèvres sans son, les réponses s’affichent en sous-titres.')
      }

      case 'ecoute':
        return [
          select('Reconnaissance vocale', 'stt.engine', [
            ['browser', 'Navigateur (gratuit — Chrome, Edge, Safari)'],
            ['whisper', 'Whisper via API (OpenAI, Groq, serveur local)'],
          ]),
          s.stt.engine === 'browser'
            ? hint(
                browserSTTAvailable()
                  ? 'Disponible dans ce navigateur. Chrome envoie l’audio aux serveurs de Google pour la transcription.'
                  : sttEngineFor(s) === 'whisper'
                    ? '✅ Ce navigateur (Firefox par exemple) ne reconnaît pas la voix lui-même : Whisper est utilisé automatiquement avec ta clé OpenAI de l’onglet IA.'
                    : '⚠️ Ce navigateur (Firefox, Chromium sur Raspberry Pi…) ne reconnaît pas la voix lui-même. Choisis « Whisper via API » ci-dessus, ou ajoute simplement une clé OpenAI dans l’onglet IA : elle servira aussi à l’écoute.',
              )
            : [
                text('Adresse de l’API', 'stt.whisper.baseUrl', { type: 'url' }),
                secret(s, 'Clé API (écoute)', 'stt.whisper.apiKey'),
                !s.stt.whisper.apiKey && whisperKey(s) ? hint('✅ Champ vide : la clé du même service saisie dans l’onglet IA est utilisée.') : '',
                combo('Modèle', 'stt.whisper.model', ['whisper-1', 'gpt-4o-mini-transcribe', 'whisper-large-v3-turbo']),
                range('Silence de fin de phrase (ms)', 'stt.silenceMs', 400, 2500, 100),
                hint('Groq est très rapide et peu cher : adresse <code>https://api.groq.com/openai/v1</code>, modèle <code>whisper-large-v3-turbo</code>. En local : faster-whisper-server / speaches.'),
              ].join(''),
          check('Mode mains libres (réécoute après chaque réponse)', 'stt.handsFree'),
          hint('Astuce : barre d’espace = parler. Appuyer sur le bouton pendant qu’elle parle l’interrompt.'),
        ].join('')

      case 'avatar':
        return [
          `<div class="avatar-list">${s.avatar.list
            .map(
              (a) => `<div class="avatar-item ${a.id === s.avatar.current ? 'active' : ''}">
                <span class="name" title="${esc(a.url)}">${esc(a.name)}</span>
                ${a.id === s.avatar.current ? '<span class="hint">actif</span>' : `<button class="btn" data-action="use-avatar" data-id="${esc(a.id)}">Utiliser</button>`}
                ${a.builtin ? '' : `<button class="btn danger" data-action="rm-avatar" data-id="${esc(a.id)}" aria-label="Supprimer">✕</button>`}
              </div>`,
            )
            .join('')}</div>`,
          `<label class="btn primary" style="text-align:center">Importer un fichier .vrm
            <input id="vrm-file" type="file" accept=".vrm" hidden></label>`,
          `<h3>Ou depuis une adresse web</h3>
           <div class="row"><input id="vrm-url" class="grow" type="url" placeholder="https://…/mon-avatar.vrm"
             style="padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:inherit;font-size:16px">
           <button class="btn" data-action="add-url">Ajouter</button></div>`,
          select('Cadrage', 'avatar.framing', [
            ['bust', 'Buste (conversation)'],
            ['full', 'Corps entier'],
          ]),
          check('Les yeux suivent le pointeur', 'avatar.followPointer'),
          hint(
            'Où trouver des avatars : <a href="https://hub.vroid.com" target="_blank" rel="noopener">VRoid Hub</a> (modèles téléchargeables), <a href="https://booth.pm/en/browse/3D%20Models?tags%5B%5D=VRM" target="_blank" rel="noopener">Booth</a>, ou crée le tien gratuitement avec <a href="https://vroid.com/studio" target="_blank" rel="noopener">VRoid Studio</a>. Formats acceptés : VRM 0.x et 1.0. Respecte la licence de chaque modèle.',
          ),
        ].join('')

      case 'gestes':
        return [
          `<div class="avatar-list">${s.gestures.list
            .map(
              (a) => `<div class="avatar-item">
                <span class="name">${esc(a.name)} <span class="hint">[${esc(a.tag)}]</span></span>
                <button class="btn" data-action="play-gesture" data-id="${esc(a.id)}" aria-label="Jouer">▶</button>
                ${a.builtin ? '' : `<button class="btn danger" data-action="rm-gesture" data-id="${esc(a.id)}" aria-label="Supprimer">✕</button>`}
              </div>`,
            )
            .join('')}</div>`,
          `<label class="btn primary" style="text-align:center">Importer une animation .vrma
            <input id="vrma-file" type="file" accept=".vrma" hidden></label>`,
          check('L\u2019IA peut faire des gestes d\u2019elle-même', 'gestures.enabled'),
          hint(
            'L\u2019IA déclenche un geste en écrivant sa balise (par exemple <code>[wave]</code> pour dire bonjour). Une animation importée reçoit une balise tirée de son nom. Tu peux aussi les jouer avec le bouton ✋ en haut de l\u2019écran.',
          ),
          hint(
            'Animations VRMA à télécharger : les packs gratuits de VRoid et d\u2019autres créateurs sur <a href="https://booth.pm/en/search/VRMA" target="_blank" rel="noopener">Booth (recherche « VRMA »)</a> — vérifie leur licence, ou crée les tiennes avec un logiciel comme Blender (extension VRM) ou des outils de capture de mouvement.',
          ),
        ].join('')

      case 'memoire': {
        const mem = this.actions.memory()
        const date = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', year: 'numeric' })
        const items = [...mem.items].sort((a, b) => b.created - a.created)
        return [
          check('Mémoire à long terme', 'memory.enabled'),
          hint(
            'Après chaque conversation, l’IA note les informations durables sur toi (prénom, goûts, proches, projets, événements…) et les rappelle au personnage les fois suivantes. Les souvenirs sont partagés par tous les avatars. Ils sont enregistrés uniquement dans ce navigateur et envoyés au fournisseur d’IA avec tes messages. Chaque mémorisation est une petite requête supplémentaire. Tu peux aussi dire « retiens que… » ou « oublie que… ».',
          ),
          mem.pending.length
            ? `<div class="row"><span class="hint grow">${mem.pending.length} message${mem.pending.length > 1 ? 's' : ''} en attente de mémorisation${mem.busy ? '…' : ''}</span>
               <button class="btn" data-action="mem-flush" ${mem.busy ? 'disabled' : ''}>Mémoriser maintenant</button></div>`
            : '',
          `<div class="row"><input id="mem-new" class="grow" type="text" placeholder="Ajouter un souvenir (ex. : J’adore le jazz)"
             style="padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:inherit;font-size:16px">
           <button class="btn" data-action="mem-add">Ajouter</button></div>`,
          `<h3>${items.length} souvenir${items.length > 1 ? 's' : ''}</h3>`,
          items.length
            ? `<div class="avatar-list">${items
                .map(
                  (m) => `<div class="avatar-item memory-item">
                    <span class="grow"><span class="memory-text">${esc(m.text)}</span>
                      <small class="hint">${date.format(m.created)}${m.by ? ` · avec ${esc(m.by)}` : ''}</small></span>
                    <button class="btn danger" data-action="mem-rm" data-id="${esc(m.id)}" aria-label="Oublier ce souvenir" title="Oublier">✕</button>
                  </div>`,
                )
                .join('')}</div>`
            : hint('Aucun souvenir pour l’instant : discute un peu, et reviens voir ici !'),
          `<div class="row"><button class="btn" data-action="mem-export">Exporter</button>
             <label class="btn">Importer<input id="mem-import" type="file" accept=".json,application/json" hidden></label>
             <button class="btn danger" data-action="mem-clear" style="margin-left:auto">Tout oublier</button></div>`,
        ].join('')
      }

      case 'affichage':
        return [
          check('Sous-titres', 'ui.subtitles'),
          select('Qualité graphique', 'ui.quality', [
            ['low', 'Basse (Raspberry Pi, vieux téléphones)'],
            ['medium', 'Moyenne'],
            ['high', 'Haute'],
          ]),
          `<label class="field inline"><span>Couleur de fond</span><input type="color" data-path="ui.background"></label>`,
        ].join('')
    }
  }

  /** Ouvre la liste de choix d'un champ : elle défile, se filtre en tapant, et un choix remplit le champ. */
  private openPicker(path: string, choices: Choice[], note = ''): void {
    const picker = this.body.querySelector<HTMLElement>(`[data-picker="${path}"]`)
    const input = this.body.querySelector<HTMLInputElement>(`[data-path="${path}"]`)
    if (!picker || !input) return
    this.body.querySelectorAll<HTMLElement>('.picker').forEach((p) => (p.hidden = true))
    const items = choices.map((c) => (typeof c === 'string' ? [c, c] : c))
    picker.innerHTML = `${items.length > 8 ? '<input type="search" class="picker-filter" placeholder="Filtrer (ex. : gpt-4o, claude, llama…)" autocapitalize="off" spellcheck="false">' : ''}
      <div class="picker-list" role="listbox">${
        items.length
          ? items
              .map(([v, l]) => `<button type="button" role="option" data-value="${esc(v)}" class="${v === input.value ? 'current' : ''}">${esc(l)}${l !== v ? `<small>${esc(v)}</small>` : ''}</button>`)
              .join('')
          : '<p class="hint">Aucun choix proposé : clique sur « Lister » ou tape la valeur.</p>'
      }</div>${note ? `<p class="hint">${esc(note)}</p>` : ''}`
    picker.hidden = false
    const filter = picker.querySelector<HTMLInputElement>('.picker-filter')
    filter?.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase()
      picker.querySelectorAll<HTMLElement>('[data-value]').forEach((b) => (b.hidden = !!q && !b.textContent!.toLowerCase().includes(q)))
    })
    picker.querySelectorAll<HTMLElement>('[data-value]').forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.dataset.value!
        input.dispatchEvent(new Event('change', { bubbles: true }))
        picker.hidden = true
      }),
    )
    picker.querySelector('.current')?.scrollIntoView({ block: 'nearest' })
  }

  focusField(path: string): void {
    this.body.querySelector<HTMLInputElement>(`[data-path="${path}"]`)?.focus()
  }

  /** Petit « ✓ enregistrée » à côté d'une clé, pour confirmer qu'elle est bien sauvegardée. */
  private flashSaved(path: string): void {
    const badge = this.body.querySelector<HTMLElement>(`[data-saved="${path}"]`)
    if (!badge) return
    badge.textContent = '✓ enregistrée'
    clearTimeout(Number(badge.dataset.timer))
    badge.dataset.timer = String(window.setTimeout(() => (badge.textContent = ''), 1500))
  }

  private bindButtons(): void {
    const on = (action: string, fn: (el: HTMLElement) => void) =>
      this.body.querySelectorAll<HTMLElement>(`[data-action="${action}"]`).forEach((el) => el.addEventListener('click', () => fn(el)))
    this.body.querySelectorAll<HTMLElement>('[data-reveal]').forEach((btn) =>
      btn.addEventListener('click', () => btn.previousElementSibling?.classList.toggle('revealed')),
    )

    on('models', async (btn) => {
      btn.textContent = '…'
      try {
        const all = await this.actions.listModels()
        const chat = all.filter((m) => !NON_CHAT.test(m))
        const hidden = all.length - chat.length
        btn.textContent = `${chat.length} trouvés`
        this.openPicker(
          `providers.${this.s.activeProvider}.model`,
          chat,
          hidden ? `${hidden} modèle${hidden > 1 ? 's' : ''} qui ne servent pas à discuter (Whisper, voix, images…) ne sont pas affichés. La reconnaissance vocale Whisper se règle dans l’onglet Écoute.` : '',
        )
      } catch (e) {
        btn.textContent = 'Échec'
        alert((e as Error).message)
      }
    })
    on('eleven-voices', async (btn) => {
      btn.textContent = '…'
      try {
        const voices = await this.actions.listElevenVoices()
        btn.textContent = `${voices.length} voix`
        this.openPicker('tts.elevenlabs.voiceId', voices.map((v) => [v.voice_id, v.name]))
      } catch (e) {
        btn.textContent = 'Échec'
        alert((e as Error).message)
      }
    })
    this.body.querySelectorAll<HTMLElement>('[data-pick]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const path = btn.dataset.pick!
        const picker = this.body.querySelector<HTMLElement>(`[data-picker="${path}"]`)
        if (picker && !picker.hidden) picker.hidden = true
        else this.openPicker(path, JSON.parse(btn.dataset.choices ?? '[]') as Choice[])
      }),
    )
    on('test-voice', () => this.actions.testVoice())
    on('clear', () => this.actions.clearHistory())
    on('use-avatar', (el) => this.actions.selectAvatar(el.dataset.id!))
    on('rm-avatar', (el) => this.actions.removeAvatar(el.dataset.id!))
    on('add-url', () => {
      const input = this.body.querySelector<HTMLInputElement>('#vrm-url')!
      const url = input.value.trim()
      if (!url) return
      const name = decodeURIComponent(url.split('/').pop() ?? 'Avatar').replace(/\.vrm$/i, '')
      this.actions.addAvatarUrl(name, url)
    })
    on('reset-persona', () => this.actions.resetPersona())
    on('vault-create', () => this.actions.vaultCreate())
    on('vault-load', () => this.actions.vaultLoad())
    on('vault-forget', () => this.actions.vaultForget())
    on('vault-release', (el) => this.actions.vaultRelease(el.dataset.key!))
    this.body.querySelector<HTMLInputElement>('#vault-file')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) this.actions.vaultImport(file)
    })
    const addMemory = () => {
      const input = this.body.querySelector<HTMLInputElement>('#mem-new')
      if (input?.value.trim()) this.actions.memoryAdd(input.value)
    }
    on('mem-add', addMemory)
    this.body.querySelector<HTMLInputElement>('#mem-new')?.addEventListener('keydown', (e) => e.key === 'Enter' && addMemory())
    on('mem-rm', (el) => this.actions.memoryRemove(el.dataset.id!))
    on('mem-clear', () => this.actions.memoryClear())
    on('mem-export', () => this.actions.memoryExport())
    on('mem-flush', (el) => {
      el.setAttribute('disabled', '')
      el.textContent = '…'
      void this.actions.memoryFlush().finally(() => this.refresh('memoire'))
    })
    this.body.querySelector<HTMLInputElement>('#mem-import')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) this.actions.memoryImport(file)
    })
    on('play-gesture', (el) => this.actions.playGesture(el.dataset.id!))
    on('rm-gesture', (el) => this.actions.removeAnimation(el.dataset.id!))
    this.body.querySelector<HTMLInputElement>('#vrma-file')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) this.actions.importAnimation(file)
    })
    this.body.querySelector<HTMLInputElement>('#vrm-file')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) this.actions.importAvatar(file)
    })
  }
}
