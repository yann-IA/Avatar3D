let ctx: AudioContext | null = null

export function audioContext(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

/** Les navigateurs mobiles exigent un geste de l'utilisateur avant de jouer du son. */
export async function unlockAudio(): Promise<void> {
  const c = audioContext()
  if (c.state === 'suspended') await c.resume()
  if (!unlocked) {
    unlocked = true
    // Un son vide joué pendant le geste « déverrouille » la sortie audio sur iOS.
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, 22050)
    src.connect(c.destination)
    src.start()
    // Idem pour la synthèse vocale du navigateur.
    if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''))
  }
}
let unlocked = false
