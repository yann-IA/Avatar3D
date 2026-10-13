import { saveSettings, type Settings } from '../settings'
import {
  MIN_PASSPHRASE,
  REPO_UPLOAD_URL,
  WrongPassphraseError,
  applySecrets,
  collectSecrets,
  countKeys,
  decryptVault,
  encryptVault,
  passphraseProblem,
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
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-reveal]')
      btn?.previousElementSibling?.classList.toggle('revealed')
    })
  }

  private open(html: string): void {
    this.dialog.innerHTML = `<form method="dialog" class="dialog-body">${html}</form>`
    if (!this.dialog.open) this.dialog.showModal()
  }

  close(): void {
    this.dialog.close()
  }

  /** Demande la phrase secrète et charge les clés du coffre. */
  unlock(file: VaultFile, { remindLater = true } = {}): void {
    this.open(`
      <h2>🔐 Coffre à clés</h2>
      <p>Un coffre à clés créé le ${esc(date.format(new Date(file.created)))} est disponible. Entre ta phrase secrète
        pour charger tes clés API sur cet appareil.</p>
      ${secretInput('vault-pass', 'Phrase secrète')}
      <p class="dialog-error" id="vault-error" role="alert"></p>
      <div class="row dialog-actions">
        ${remindLater ? '<button class="btn" value="later" id="vault-later">Plus tard</button>' : '<button class="btn" value="cancel">Annuler</button>'}
        <button class="btn primary" id="vault-go" value="go">Déverrouiller</button>
      </div>`)
    const input = this.dialog.querySelector<HTMLInputElement>('#vault-pass')!
    const error = this.dialog.querySelector<HTMLElement>('#vault-error')!
    const go = this.dialog.querySelector<HTMLButtonElement>('#vault-go')!
    input.focus()
    this.dialog.querySelector('#vault-later')?.addEventListener('click', () => {
      this.s.vault.dismissed = file.created
      saveSettings(this.s)
    })
    go.addEventListener('click', async (e) => {
      e.preventDefault()
      if (!input.value.trim()) return
      go.disabled = true
      go.textContent = 'Déchiffrement…'
      error.textContent = ''
      try {
        const secrets = await decryptVault(file, input.value)
        applySecrets(this.s, secrets)
        this.s.vault.applied = file.created
        saveSettings(this.s)
        this.close()
        this.onApplied(countKeys(secrets))
      } catch (err) {
        error.textContent = err instanceof WrongPassphraseError ? 'Phrase secrète incorrecte, réessaie.' : `Coffre illisible : ${(err as Error).message}`
        go.disabled = false
        go.textContent = 'Déverrouiller'
        input.select()
      }
    })
  }

  /** Chiffre les clés actuelles avec une nouvelle phrase secrète et propose le fichier. */
  create(): void {
    const keys = countKeys(collectSecrets(this.s))
    if (!keys) {
      this.open(`<h2>🔐 Créer un coffre à clés</h2>
        <p>Aucune clé API n'est encore enregistrée sur cet appareil. Renseigne d'abord tes clés (IA, voix, écoute),
          puis reviens créer le coffre.</p>
        <div class="row dialog-actions"><button class="btn primary" value="ok">Compris</button></div>`)
      return
    }
    this.open(`
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
        <button class="btn" value="cancel">Annuler</button>
        <button class="btn primary" id="vault-go" value="go">Créer le coffre</button>
      </div>`)
    const pass = this.dialog.querySelector<HTMLInputElement>('#vault-pass')!
    const pass2 = this.dialog.querySelector<HTMLInputElement>('#vault-pass2')!
    const error = this.dialog.querySelector<HTMLElement>('#vault-error')!
    const go = this.dialog.querySelector<HTMLButtonElement>('#vault-go')!
    pass.focus()
    go.addEventListener('click', async (e) => {
      e.preventDefault()
      const problem = passphraseProblem(pass.value) ?? (pass.value.trim() !== pass2.value.trim() ? 'Les deux phrases ne correspondent pas.' : null)
      if (problem) {
        error.textContent = problem
        return
      }
      go.disabled = true
      go.textContent = 'Chiffrement…'
      try {
        const file = await encryptVault(collectSecrets(this.s), pass.value)
        this.s.vault.applied = file.created
        saveSettings(this.s)
        download(file)
        this.created()
      } catch (err) {
        error.textContent = (err as Error).message
        go.disabled = false
        go.textContent = 'Créer le coffre'
      }
    })
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
      <div class="row dialog-actions"><button class="btn primary" value="ok">Terminé</button></div>`)
  }
}

function download(file: VaultFile): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  a.download = 'vault.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
