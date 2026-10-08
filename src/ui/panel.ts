import { DEFAULT_PROFILES } from '../profiles'
import { HOSTED, PROVIDERS, getPath, saveSettings, setPath, type ProviderId, type Settings } from '../settings'
import { browserVoices } from '../tts/engines'
import { browserSTTAvailable } from '../stt/engines'

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
  clearHistory(): void
}

type Tab = 'ia' | 'perso' | 'voix' | 'ecoute' | 'avatar' | 'gestes' | 'affichage'
const TABS: [Tab, string][] = [
  ['ia', 'IA'],
  ['perso', 'Personnage'],
  ['voix', 'Voix'],
  ['ecoute', 'Écoute'],
  ['avatar', 'Avatar'],
  ['gestes', 'Gestes'],
  ['affichage', 'Affichage'],
]

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/* Petits constructeurs HTML ; `data-path` relie le champ au réglage correspondant. */
const text = (label: string, path: string, opts: { type?: string; placeholder?: string; list?: string; trim?: boolean } = {}) =>
  `<label class="field"><span>${label}</span><input type="${opts.type ?? 'text'}" data-path="${path}" ${opts.trim ? 'data-trim' : ''}
    placeholder="${esc(opts.placeholder)}" ${opts.list ? `list="${opts.list}"` : ''} spellcheck="false" autocapitalize="off"></label>`
/**
 * Champ de clé API. Volontairement PAS de type « password » : les gestionnaires de mots de
 * passe des navigateurs enregistraient la première clé saisie et la recopiaient ensuite dans
 * les autres champs de clé (IA, Voix, Écoute), écrasant les bonnes valeurs. La clé reste
 * masquée à l'écran (CSS) et un bouton permet de l'afficher.
 */
const secret = (label: string, path: string, placeholder = '') =>
  `<div class="field"><span>${label} <small class="saved" data-saved="${path}"></small></span>
    <div class="row"><input type="text" class="grow secret" data-path="${path}" data-trim
      placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off"
      data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" aria-label="${esc(label)}">
    <button type="button" class="btn" data-reveal aria-label="Afficher ou masquer la clé" title="Afficher / masquer">👁</button></div></div>`
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
            ? secret('Clé API', `${p}.apiKey`, 'sk-…') +
              (preset.keyUrl ? hint(`Obtenir une clé : <a href="${preset.keyUrl}" target="_blank" rel="noopener">${preset.keyUrl}</a>`) : '')
            : hint('Aucune clé nécessaire pour un serveur local.'),
          `<div class="row"><div class="grow">${text('Modèle', `${p}.model`, { list: 'model-list' })}</div>
            <button class="btn" data-action="models" style="align-self:flex-end">Lister</button></div>
            <datalist id="model-list">${preset.models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`,
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
            secret('Clé API (voix)', 'tts.openai.apiKey', 'sk-…'),
            text('Adresse de l’API', 'tts.openai.baseUrl', { type: 'url' }),
            text('Modèle', 'tts.openai.model', { list: 'tts-models' }),
            `<datalist id="tts-models"><option value="gpt-4o-mini-tts"><option value="tts-1"><option value="tts-1-hd"><option value="kokoro"></datalist>`,
            text('Voix', 'tts.openai.voice', { list: 'tts-voices' }),
            `<datalist id="tts-voices">${OPENAI_VOICES.map((v) => `<option value="${v}">`).join('')}<option value="ff_siwis"></datalist>`,
            `<label class="field"><span>Ton / style de voix (gpt-4o-mini-tts)</span><textarea data-path="tts.openai.instructions" style="min-height:70px"></textarea></label>`,
            range('Vitesse', 'tts.openai.speed', 0.5, 2, 0.05),
            test,
            hint('Avec <code>gpt-4o-mini-tts</code>, le champ « ton » change l’intonation (joyeuse, chuchotée, timide…). Pour une voix locale gratuite : Kokoro-FastAPI (adresse <code>http://localhost:8880/v1</code>, voix française <code>ff_siwis</code>).'),
          ].join('')
        }
        if (s.tts.engine === 'elevenlabs') {
          return [
            engine,
            secret('Clé API ElevenLabs', 'tts.elevenlabs.apiKey'),
            `<div class="row"><div class="grow">${text('Voix (identifiant)', 'tts.elevenlabs.voiceId', { list: 'eleven-voices' })}</div>
              <button class="btn" data-action="eleven-voices" style="align-self:flex-end">Lister</button></div>
              <datalist id="eleven-voices"></datalist>`,
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
                  : '⚠️ Ce navigateur ne propose pas la reconnaissance vocale (c’est le cas de Firefox et de Chromium sur Raspberry Pi) : choisis Whisper.',
              )
            : [
                text('Adresse de l’API', 'stt.whisper.baseUrl', { type: 'url' }),
                secret('Clé API (écoute)', 'stt.whisper.apiKey'),
                text('Modèle', 'stt.whisper.model', { list: 'stt-models' }),
                `<datalist id="stt-models"><option value="whisper-1"><option value="gpt-4o-mini-transcribe"><option value="whisper-large-v3-turbo"></datalist>`,
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
        const models = await this.actions.listModels()
        this.body.querySelector('#model-list')!.innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('')
        btn.textContent = `${models.length} trouvés`
        this.body.querySelector<HTMLInputElement>(`[data-path="providers.${this.s.activeProvider}.model"]`)?.focus()
      } catch (e) {
        btn.textContent = 'Échec'
        alert((e as Error).message)
      }
    })
    on('eleven-voices', async (btn) => {
      btn.textContent = '…'
      try {
        const voices = await this.actions.listElevenVoices()
        this.body.querySelector('#eleven-voices')!.innerHTML = voices
          .map((v) => `<option value="${esc(v.voice_id)}">${esc(v.name)}</option>`)
          .join('')
        btn.textContent = `${voices.length} voix`
      } catch (e) {
        btn.textContent = 'Échec'
        alert((e as Error).message)
      }
    })
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
