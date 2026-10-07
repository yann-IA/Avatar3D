export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]

const ALIASES: Record<string, Emotion> = {
  neutral: 'neutral', neutre: 'neutral', calme: 'neutral',
  happy: 'happy', joy: 'happy', joie: 'happy', heureux: 'happy', heureuse: 'happy', content: 'happy', contente: 'happy', rire: 'happy', sourire: 'happy',
  sad: 'sad', sorrow: 'sad', triste: 'sad', tristesse: 'sad',
  angry: 'angry', anger: 'angry', colere: 'angry', colère: 'angry', fache: 'angry', fâché: 'angry', fâchée: 'angry',
  surprised: 'surprised', surprise: 'surprised', surprit: 'surprised', étonné: 'surprised', étonnée: 'surprised',
  relaxed: 'relaxed', fun: 'relaxed', detendu: 'relaxed', détendu: 'relaxed', détendue: 'relaxed', tendre: 'relaxed',
}

export function toEmotion(tag: string): Emotion | undefined {
  return ALIASES[tag.trim().toLowerCase()]
}

/** Consigne ajoutée au prompt système pour que le modèle annote ses phrases. */
export const EMOTION_INSTRUCTIONS = `Règles de format (ta réponse est lue à voix haute par un avatar 3D) :
- Commence chaque phrase par une balise d'émotion parmi : [neutral] [happy] [sad] [angry] [surprised] [relaxed]. Exemple : « [happy] Oh, ça me fait plaisir ! [relaxed] Raconte-moi tout. »
- N'utilise ni markdown, ni listes, ni emojis, ni descriptions d'actions entre astérisques.
- Écris les nombres et symboles comme on les prononce quand c'est plus naturel.`

export interface Segment {
  text: string
  emotion: Emotion
  /** Identifiant d'un geste à jouer au début de la phrase (animation VRMA). */
  gesture?: string
}

/** Synonymes acceptés pour les gestes fournis (les modèles écrivent parfois la balise en français). */
const GESTURE_ALIASES: Record<string, string[]> = {
  wave: ['salut', 'saluer', 'coucou', 'hello', 'bye', 'au revoir', 'wave hand'],
  dance: ['danse', 'danser', 'dancing'],
}

/** Transforme un nom en balise simple : « Salut joyeux ! » -> « salut-joyeux ». */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Table balise -> identifiant de geste (balise, nom et synonymes). */
export function gestureMap(entries: { id: string; tag: string; name: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of entries) {
    for (const alias of [e.tag, e.name, ...(GESTURE_ALIASES[e.id] ?? [])]) map.set(slugify(alias), e.id)
  }
  return map
}

/** Consigne décrivant à l'IA les gestes qu'elle peut faire. */
export function gestureInstructions(entries: { tag: string; hint: string }[]): string {
  if (!entries.length) return ''
  const list = entries.map((e) => `[${e.tag}] pour ${e.hint}`).join(' ; ')
  return `- Tu peux faire un geste avec ton corps en plaçant une de ces balises au début d'une phrase : ${list}. Utilise-les avec parcimonie, pas à chaque réponse.`
}

const TAG_RE = /\[([^\]\n]{1,24})\]/g

/**
 * Nettoie un morceau de réponse : extrait les balises d'émotion, retire le markdown,
 * les emojis et les actions *entre astérisques* pour ne garder que le texte à prononcer.
 */
export function parseSegment(raw: string, previous: Emotion, gestures?: Map<string, string>): Segment {
  let emotion: Emotion | undefined
  let gesture: string | undefined
  let text = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // liens markdown
  text = text.replace(TAG_RE, (_, tag: string) => {
    const e = toEmotion(tag)
    if (e) emotion ??= e
    else gesture ??= gestures?.get(slugify(tag))
    return ' '
  })
  text = text
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **gras**
    .replace(/\*[^*\n]{1,80}\*/g, ' ') // *sourit*
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`#>_~]|\*+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return gesture ? { text, emotion: emotion ?? previous, gesture } : { text, emotion: emotion ?? previous }
}
