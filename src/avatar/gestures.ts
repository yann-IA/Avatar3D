import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'

interface Channel {
  node: THREE.Object3D
  kind: 'quaternion' | 'position'
  interpolant: THREE.Interpolant
}

interface Playing {
  channels: Channel[]
  duration: number
  elapsed: number
  total: number
  fade: number
  stopAt: number
  resolve: () => void
}

/**
 * Joue des animations VRMA (salut, danse, ou fichiers importés) par-dessus l'animation
 * procédurale, avec un fondu à l'entrée et à la sortie. Les os que l'animation ne touche pas
 * (par exemple la tête pendant un salut) restent animés normalement : l'avatar continue de
 * te regarder et de parler.
 */
export class GesturePlayer {
  private readonly cache = new Map<string, Promise<VRMAnimation>>()
  /** Clips adaptés à l'avatar courant (hauteur des hanches comprise) : vidé à chaque changement d'avatar. */
  private clips = new WeakMap<VRMAnimation, THREE.AnimationClip>()
  private vrm: VRM | null = null
  private current: Playing | null = null
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()

  attach(vrm: VRM): void {
    this.stop(0)
    this.vrm = vrm
    this.clips = new WeakMap()
  }

  get playing(): boolean {
    return this.current !== null
  }

  /** Précharge un fichier .vrma (les suivants sont servis depuis le cache). */
  load(url: string): Promise<VRMAnimation> {
    let p = this.cache.get(url)
    if (!p) {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
      p = loader.loadAsync(url).then((gltf) => {
        const anim = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
        if (!anim) throw new Error("Ce fichier n'est pas une animation VRMA valide.")
        return anim
      })
      p.catch(() => this.cache.delete(url))
      this.cache.set(url, p)
    }
    return p
  }

  /**
   * Joue une animation `repeat` fois (0 = en boucle jusqu'à `stop`).
   * La promesse se résout quand l'animation est terminée ou interrompue.
   */
  async play(url: string, repeat = 1, fade = 0.35): Promise<void> {
    const anim = await this.load(url)
    const vrm = this.vrm
    if (!vrm) return
    this.stop(0)

    let clip = this.clips.get(anim)
    if (!clip) {
      clip = createVRMAnimationClip(anim, vrm)
      this.clips.set(anim, clip)
    }
    // On échantillonne les pistes nous-mêmes plutôt que d'utiliser AnimationMixer : celui-ci
    // n'écrit une valeur que si elle a changé depuis la dernière image, ce qui laisserait la pose
    // procédurale reprendre le dessus pendant les moments immobiles de l'animation.
    const channels: Channel[] = []
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
      const node = vrm.scene.getObjectByName(nodeName)
      if (node && (propertyName === 'quaternion' || propertyName === 'position')) {
        channels.push({ node, kind: propertyName, interpolant: (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() })
      }
    }
    const total = repeat > 0 ? clip.duration * repeat : Infinity

    return new Promise((resolve) => {
      this.current = { channels, duration: clip.duration, elapsed: 0, total, fade, stopAt: total, resolve }
    })
  }

  /** Termine l'animation en cours avec un fondu (0 = immédiatement). */
  stop(fade = 0.35): void {
    const cur = this.current
    if (!cur) return
    if (fade <= 0) {
      this.current = null
      cur.resolve()
    } else {
      cur.fade = fade
      cur.stopAt = Math.min(cur.stopAt, cur.elapsed + fade)
    }
  }

  /**
   * À appeler à chaque image, APRÈS la pose procédurale et AVANT `vrm.update` :
   * mélange la pose de l'animation avec la pose procédurale.
   */
  update(dt: number): void {
    const cur = this.current
    if (!cur) return
    cur.elapsed += dt
    const fadeIn = Math.min(1, cur.elapsed / cur.fade)
    const fadeOut = Math.min(1, Math.max(0, (cur.stopAt - cur.elapsed) / cur.fade))
    const w = smoothstep(Math.min(fadeIn, fadeOut))
    const t = Math.min(cur.elapsed, cur.total) % cur.duration

    for (const ch of cur.channels) {
      const value = ch.interpolant.evaluate(t)
      if (ch.kind === 'quaternion') ch.node.quaternion.slerp(this.q.fromArray(value), w)
      else ch.node.position.lerp(this.v.fromArray(value), w)
    }

    if (cur.elapsed >= cur.stopAt) this.stop(0)
  }
}

const smoothstep = (x: number) => x * x * (3 - 2 * x)
