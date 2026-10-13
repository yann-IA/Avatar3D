import { saveSettings, type Settings } from '../settings'
import {
  MIN_PASSPHRASE,
  REPO_UPLOAD_URL,
  WrongPassphraseError,
  collectSecrets,
  countKeys,
  encryptVault,
  passphraseProblem,
  rememberVault,
  unlockVault,
  type VaultFile,
} from '../vault'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const date = new Intl.DateTimeFormat('fr', { dateStyle: 'long', timeStyle: 'short' })

/** Champ de phrase secrète : texte masqué, ignoré par les gestionnaires de mots de passe. */
const secretInput = (id: string, placeholder: string) =>
  `<div class="row"><input id="${id}" type="text" class="grow secret dialog-input" placeholder="${placeholder}" autocomplete="off"
    spellcheck="false" autocapitalize="off" autocorrect="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true">
   <button type="button" class="btn" data-reveal aria-label="Afficher ou masquer">👁</button></div>`

/** Fenêtres du coffre à clés : déverrouillage (nouvel appareil) et création (sur le PC). */
export class VaultDialog {
  private readonly dialog = document.getElementById('vault-dialog') as HTMLDialogElement

  constructor(
    private readonly s: Settings,
    private readonly onApplied: (keys: number) => void,
  ) {
    this.dialog.addEventListener('click', (e) => {
      const el = e.target as HTMLElement
      el.closest<HTMLElement>('[data-reveal]')?.previousElementSibling?.classList.toggle('revealed')
      if (el.closest('[data-close]')) this.close()
    })
  }

  /**
   * Affiche une fenêtre. Seul le bouton principal valide le formulaire : la touche Entrée (y compris
   * celle du clavier virtuel du casque) déclenche donc toujours l'action principale. Les autres
   * boutons sont de simples boutons (`data-close` ferme la fenêtre).
   */
  private open(html: string, onSubmit?: () => void): void {
    this.dialog.innerHTML = `<form class="dialog-body">${html}</form>`
    this.dialog.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault()
      if (onSubmit) onSubmit()
      else this.close()
    })
    if (!this.dialog.open) this.dialog.showModal()
  }

  close(): void {
    this.dialog.close()
  }

  /** Demande la phrase secrète et charge les clés du coffre. */
  unlock(file: VaultFile, { remindLater = true } = {}): void {
    rememberVault(file)
    const go = async () => {
      if (!input.value.trim() || button.disabled) return
      button.disabled = true
      button.textContent = 'Déchiffrement…'
      error.textContent = ''
      try {
        const keys = await unlockVault(this.s, file, input.value)
        this.close()
        this.onApplied(keys)
      } catch (err) {
        error.textContent = err instanceof WrongPassphraseError ? 'Phrase secrète incorrecte, réessaie.' : `Coffre illisible : ${(err as Error).message}`
        button.disabled = false
        button.textContent = 'Déverrouiller'
        input.select()
      }
    }
    this.open(
      `
      <h2>🔐 Coffre à clés</h2>
      <p>Un coffre à clés créé le ${esc(date.format(new Date(file.created)))} est disponible. Entre ta phrase secrète
        pour charger tes clés API sur cet appareil.</p>
      ${secretInput('vault-pass', 'Phrase secrète')}
      <p class="dialog-error" id="vault-error" role="alert"></p>
      <div class="row dialog-actions">
        ${remindLater ? '<button type="button" class="btn" id="vault-later" data-close>Plus tard</button>' : '<button type="button" class="btn" data-close>Annuler</button>'}
        <button type="submit" class="btn primary" id="vault-go">Déverrouiller</button>
      </div>`,
      () => void go(),
    )
    const input = this.dialog.querySelector<HTMLInputElement>('#vault-pass')!
    const error = this.dialog.querySelector<HTMLElement>('#vault-error')!
    const button = this.dialog.querySelector<HTMLButtonElement>('#vault-go')!
    input.focus()
    this.dialog.querySelector('#vault-later')?.addEventListener('click', () => {
      this.s.vault.dismissed = file.created
      saveSettings(this.s)
    })
  }

  /** Chiffre les clés actuelles avec une nouvelle phrase secrète et propose le fichier. */
  create(): void {
    const keys = countKeys(collectSecrets(this.s))
    if (!keys) {
      this.open(`<h2>🔐 Créer un coffre à clés</h2>
        <p>Aucune clé API n'est encore enregistrée sur cet appareil. Renseigne d'abord tes clés (IA, voix, écoute),
          puis reviens créer le coffre.</p>
        <div class="row dialog-actions"><button type="submit" class="btn primary">Compris</button></div>`)
      return
    }
    const go = async () => {
      const problem = passphraseProblem(pass.value) ?? (pass.value.trim() !== pass2.value.trim() ? 'Les deux phrases ne correspondent pas.' : null)
      if (problem) {
        error.textContent = problem
        return
      }
      if (button.disabled) return
      button.disabled = true
      button.textContent = 'Chiffrement…'
      try {
        const file = await encryptVault(collectSecrets(this.s), pass.value)
        this.s.vault.applied = file.created
        saveSettings(this.s)
        rememberVault(file)
        download(file)
        this.created()
      } catch (err) {
        error.textContent = (err as Error).message
        button.disabled = false
        button.textContent = 'Créer le coffre'
      }
    }
    this.open(
      `
      <h2>🔐 Créer un coffre à clés</h2>
      <p>Tes ${keys} clé${keys > 1 ? 's' : ''} API et les réglages de connexion vont être chiffrés avec une phrase secrète.
        Sur un autre appareil (ton téléphone par exemple), il suffira de taper cette phrase.</p>
      <p class="hint">Choisis au moins ${MIN_PASSPHRASE} caractères, idéalement 4 ou 5 mots tirés au hasard
        (ex. : « girafe lampe violon nuage »). Le fichier pourra être public : seule la phrase protège tes clés.
        Note-la bien, elle ne pourra pas être retrouvée.</p>
      ${secretInput('vault-pass', 'Phrase secrète')}
      ${secretInput('vault-pass2', 'Confirme la phrase secrète')}
      <p class="dialog-error" id="vault-error" role="alert"></p>
      <div class="row dialog-actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary" id="vault-go">Créer le coffre</button>
      </div>`,
      () => void go(),
    )
    const pass = this.dialog.querySelector<HTMLInputElement>('#vault-pass')!
    const pass2 = this.dialog.querySelector<HTMLInputElement>('#vault-pass2')!
    const error = this.dialog.querySelector<HTMLElement>('#vault-error')!
    const button = this.dialog.querySelector<HTMLButtonElement>('#vault-go')!
    pass.focus()
  }

  private created(): void {
    this.open(`
      <h2>✅ Coffre créé</h2>
      <p>Le fichier <b>vault.json</b> vient d'être téléchargé. Pour qu'il soit proposé automatiquement sur tes autres
        appareils, publie-le avec le site :</p>
      <ol>
        <li>Ouvre la page d'envoi du dépôt : <a href="${REPO_UPLOAD_URL}" target="_blank" rel="noopener">dossier « public » sur GitHub</a>.</li>
        <li>Glisse le fichier <b>vault.json</b> dans la page (il remplace l'ancien s'il existe).</li>
        <li>Clique sur <b>Commit changes</b>. Le site est mis à jour en une à deux minutes.</li>
      </ol>
      <p class="hint">Sur l’autre appareil, ouvre ensuite l'application : elle te demandera ta phrase secrète. Tu peux aussi copier
        le fichier sur un appareil et utiliser « Importer un fichier de coffre » dans ⚙ → IA.</p>
      <div class="row dialog-actions"><button type="submit" class="btn primary">Terminé</button></div>`)
  }
}

function download(file: VaultFile): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  a.download = 'vault.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
