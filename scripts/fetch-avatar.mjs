// Télécharge l'avatar d'exemple dans public/avatars/default.vrm pour un usage hors-ligne
// (Raspberry Pi, mini-PC sans connexion…). Modèle « VRM1_Constraint_Twist_Sample » de pixiv Inc.,
// redistribution autorisée par sa licence VRM (https://vrm.dev/licenses/1.0/).
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_SAMPLE =
  'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'public', 'avatars', 'default.vrm')

const res = await fetch(URL_SAMPLE)
if (!res.ok) {
  console.error(`Échec du téléchargement : HTTP ${res.status}`)
  process.exit(1)
}
await mkdir(dirname(out), { recursive: true })
await writeFile(out, Buffer.from(await res.arrayBuffer()))
console.log(`Avatar enregistré dans ${out}`)
