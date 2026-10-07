import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Emotion } from '../core/emotion'
import { SILENT, type MouthDriver, type Visemes } from './lipsync'

export type Activity = 'idle' | 'listening' | 'thinking' | 'speaking'

const EMOTION_EXPRESSIONS: Exclude<Emotion, 'neutral'>[] = ['happy', 'sad', 'angry', 'surprised', 'relaxed']
const VISEME_KEYS: (keyof Visemes)[] = ['aa', 'ih', 'ou', 'ee', 'oh']

/** Posture de tête propre à chaque émotion : [inclinaison avant, rotation, penché sur le côté]. */
const EMOTION_POSE: Record<Emotion, [number, number, number]> = {
  neutral: [0, 0, 0],
  happy: [-0.04, 0, 0.07],
  sad: [0.16, 0, -0.03],
  angry: [0.07, 0, 0],
  surprised: [-0.1, 0, 0],
  relaxed: [0.02, 0, 0.1],
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'].flatMap((f) => ['Proximal', 'Intermediate', 'Distal'].map((j) => f + j))

const damp = (current: number, target: number, lambda: number, dt: number) =>
  THREE.MathUtils.damp(current, target, lambda, dt)

/**
 * Scène 3D : charge un avatar VRM et l'anime de façon procédurale (respiration, clignements,
 * regard, émotions, synchronisation labiale, gestes pendant la parole).
 */
export class AvatarStage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50)
  private readonly controls: OrbitControls
  private readonly timer = new THREE.Timer()
  private readonly lookTarget = new THREE.Object3D()
  private readonly pointer = new THREE.Vector2()

  private vrm: VRM | null = null
  private headHeight = 1.4
  private framing: 'bust' | 'full' = 'bust'
  followPointer = true

  private mouth: MouthDriver | null = null
  private visemes: Visemes = { ...SILENT }
  private emotion: Emotion = 'neutral'
  private emotionWeight: Record<Emotion, number> = { neutral: 0, happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 }
  private emotionUntil = 0
  private activity: Activity = 'idle'

  private blinkValue = 0
  private nextBlink = 2
  private blinkPhase = -1
  private saccade = new THREE.Vector2()
  private nextSaccade = 1
  private headPose = new THREE.Vector3()
  private talkLevel = 0
  private nodPhase = 0
  private time = 0
  private loadToken = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.setQuality('medium')

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 1.4)
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1, 2, 2.5)
    const rim = new THREE.DirectionalLight(0x9fb4ff, 1.2)
    rim.position.set(-1.5, 1.5, -2)
    this.scene.add(hemi, key, rim, this.lookTarget)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 0.4
    this.controls.maxDistance = 6
    this.controls.minPolarAngle = Math.PI * 0.2
    this.controls.maxPolarAngle = Math.PI * 0.75

    window.addEventListener('resize', () => this.resize())
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    })
    this.resize()
    this.renderer.setAnimationLoop(() => this.frame())
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap))
    this.resize()
  }

  setBackground(color: string): void {
    document.body.style.setProperty('--stage-bg', color)
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.vrm) this.setFraming(this.framing)
  }

  /** Charge un avatar .vrm (VRM 0.x ou 1.0). `url` peut être une URL blob: pour un fichier local. */
  async load(url: string, onProgress?: (ratio: number) => void): Promise<void> {
    const token = ++this.loadToken
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total))
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error("Ce fichier n'est pas un avatar VRM valide.")
    if (token !== this.loadToken) {
      VRMUtils.deepDispose(gltf.scene)
      return
    }

    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm) // les modèles VRM 0.x regardent dans l'autre sens
    vrm.scene.traverse((o) => (o.frustumCulled = false))

    if (this.vrm) {
      this.scene.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
    }
    this.vrm = vrm
    this.scene.add(vrm.scene)
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget

    this.applyRestPose(0)
    vrm.update(0)
    vrm.scene.updateMatrixWorld(true)
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    this.headHeight = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4
    this.setFraming(this.framing)
  }

  get loaded(): boolean {
    return this.vrm !== null
  }

  /** Cadrage de la caméra : buste (conversation) ou corps entier, adapté à la forme de l'écran. */
  setFraming(mode: 'bust' | 'full'): void {
    this.framing = mode
    const h = this.headHeight
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const aspect = this.camera.aspect
    // Taille de la zone à montrer (largeur, hauteur) en mètres.
    const [w, ht] = mode === 'bust' ? [0.42, 0.65] : [0.9, h * 1.25]
    const dist = Math.max(ht / 2 / tanV, w / 2 / (tanV * aspect))
    const span = 2 * dist * tanV
    // Visage placé dans le tiers supérieur de l'écran en mode buste.
    const ty = mode === 'bust' ? h - 0.09 - Math.max(0, span - ht) * 0.3 : h * 0.55
    this.controls.target.set(0, ty, 0)
    this.camera.position.set(0, ty + (mode === 'bust' ? 0.02 : 0.1), dist)
    this.controls.update()
  }

  setMouth(driver: MouthDriver | null): void {
    this.mouth = driver
  }

  setEmotion(e: Emotion, holdSeconds = 6): void {
    this.emotion = e
    this.emotionUntil = this.time + holdSeconds
  }

  setActivity(a: Activity): void {
    this.activity = a
  }

  /* ------------------------------ Animation ------------------------------ */

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm?.humanoid.getNormalizedBoneNode(name) ?? null
  }

  private rot(name: VRMHumanBoneName, x: number, y: number, z: number): void {
    this.bone(name)?.rotation.set(x, y, z)
  }

  /** Bras le long du corps (les VRM sont modélisés en « T »), respiration et petits mouvements. */
  private applyRestPose(t: number): void {
    const breath = Math.sin(t * 1.7)
    const sway = Math.sin(t * 0.45)
    const talk = this.talkLevel
    const g1 = Math.sin(t * 2.3) * talk
    const g2 = Math.sin(t * 1.9 + 1.3) * talk

    this.rot('hips', 0, sway * 0.025, Math.sin(t * 0.33) * 0.012)
    this.rot('spine', breath * 0.012, -sway * 0.02, 0)
    this.rot('chest', breath * 0.018, 0, 0)
    this.rot('upperChest', breath * 0.01, 0, 0)

    const armDown = 1.2 + breath * 0.015
    this.rot('leftUpperArm', 0.1 + g1 * 0.08, 0, -armDown + Math.max(0, g1) * 0.12)
    this.rot('rightUpperArm', 0.1 + g2 * 0.08, 0, armDown - Math.max(0, g2) * 0.12)
    this.rot('leftLowerArm', 0, -0.35 - talk * 0.35 - Math.max(0, g1) * 0.3, 0)
    this.rot('rightLowerArm', 0, 0.35 + talk * 0.35 + Math.max(0, g2) * 0.3, 0)
    this.rot('leftHand', 0, 0, -0.1 - talk * 0.1)
    this.rot('rightHand', 0, 0, 0.1 + talk * 0.1)
    for (const f of FINGERS) {
      const curl = f.includes('Distal') ? 0.35 : f.includes('Intermediate') ? 0.3 : 0.18
      this.rot(`left${f}` as VRMHumanBoneName, 0, 0, -curl)
      this.rot(`right${f}` as VRMHumanBoneName, 0, 0, curl)
    }
    this.rot('leftShoulder', 0, 0, breath * 0.01)
    this.rot('rightShoulder', 0, 0, -breath * 0.01)
  }

  private updateBlink(dt: number): void {
    // Clignements naturels, parfois doubles. Moins forts quand l'émotion ferme déjà les yeux.
    if (this.blinkPhase < 0) {
      this.nextBlink -= dt
      if (this.nextBlink <= 0) {
        this.blinkPhase = 0
        this.nextBlink = Math.random() < 0.15 ? 0.25 : 2 + Math.random() * 4
      }
    } else {
      this.blinkPhase += dt
      const d = 0.16
      this.blinkValue = this.blinkPhase < d / 2 ? this.blinkPhase / (d / 2) : 1 - (this.blinkPhase - d / 2) / (d / 2)
      if (this.blinkPhase >= d) {
        this.blinkPhase = -1
        this.blinkValue = 0
      }
    }
  }

  private updateLook(dt: number): void {
    this.nextSaccade -= dt
    if (this.nextSaccade <= 0) {
      this.saccade.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08)
      this.nextSaccade = 0.6 + Math.random() * 2.5
    }
    const p = this.followPointer ? this.pointer : new THREE.Vector2()
    const target = this.camera.position.clone()
    target.x += p.x * 0.6 + this.saccade.x
    target.y += p.y * 0.4 + this.saccade.y
    if (this.activity === 'thinking') {
      target.x += 0.35 // regarde en l'air, sur le côté, quand elle réfléchit
      target.y += 0.35
    }
    this.lookTarget.position.lerp(target, 1 - Math.exp(-8 * dt))
  }

  private updateHead(dt: number): void {
    const vrm = this.vrm!
    const pose = EMOTION_POSE[this.emotion]
    const head = this.bone('head')
    const neck = this.bone('neck')
    if (!head || !neck) return

    // La tête suit un peu le regard.
    const local = vrm.scene.worldToLocal(this.lookTarget.position.clone())
    const dir = local.sub(new THREE.Vector3(0, this.headHeight, 0))
    const yaw = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z), -0.6, 0.6) * 0.35
    const pitch = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.5, 0.5) * 0.3

    let tx = pitch + pose[0]
    let tz = pose[2]
    if (this.activity === 'listening') {
      tz += 0.1 // tête légèrement penchée : elle écoute
      tx += 0.03
    }
    this.nodPhase += dt * (5 + this.talkLevel * 3)
    const nod = Math.sin(this.nodPhase) * this.talkLevel * 0.035 + this.mouthOpen() * 0.04

    this.headPose.x = damp(this.headPose.x, tx + nod, 6, dt)
    this.headPose.y = damp(this.headPose.y, yaw + pose[1], 6, dt)
    this.headPose.z = damp(this.headPose.z, tz + Math.sin(this.time * 0.7) * 0.02, 4, dt)
    neck.rotation.set(this.headPose.x * 0.4, this.headPose.y * 0.4, this.headPose.z * 0.4)
    head.rotation.set(this.headPose.x * 0.6, this.headPose.y * 0.6, this.headPose.z * 0.6)
  }

  private mouthOpen(): number {
    const v = this.visemes
    return Math.min(1, v.aa + v.oh * 0.8 + v.ou * 0.5 + v.ee * 0.5 + v.ih * 0.4)
  }

  private updateExpressions(dt: number): void {
    const em = this.vrm!.expressionManager
    if (!em) return

    if (this.emotion !== 'neutral' && this.time > this.emotionUntil && this.activity !== 'speaking') this.emotion = 'neutral'
    const speaking = this.mouth !== null
    for (const e of EMOTION_EXPRESSIONS) {
      // L'émotion reste modérée pendant la parole pour que la bouche reste lisible.
      const target = e === this.emotion ? (speaking ? 0.55 : 0.8) : 0
      this.emotionWeight[e] = damp(this.emotionWeight[e], target, 4, dt)
      em.setValue(e, this.emotionWeight[e])
    }

    const v = this.mouth ? this.mouth.sample() : SILENT
    for (const k of VISEME_KEYS) {
      this.visemes[k] = this.mouth ? v[k] : damp(this.visemes[k], 0, 18, dt)
      em.setValue(k, Math.min(1, this.visemes[k]))
    }

    const eyesClosedByEmotion = Math.max(this.emotionWeight.happy, this.emotionWeight.relaxed)
    em.setValue('blink', this.blinkValue * (1 - eyesClosedByEmotion * 0.7))
  }

  private frame(): void {
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    this.time += dt
    this.controls.update()
    if (this.vrm) {
      this.talkLevel = damp(this.talkLevel, this.mouth ? 0.6 + this.mouthOpen() * 0.4 : 0, 3, dt)
      this.applyRestPose(this.time)
      this.updateBlink(dt)
      this.updateLook(dt)
      this.updateHead(dt)
      this.updateExpressions(dt)
      this.vrm.update(dt)
    }
    this.renderer.render(this.scene, this.camera)
  }
}
