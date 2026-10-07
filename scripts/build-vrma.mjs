// Génère les animations VRMA fournies avec l'application (public/animations/*.vrma).
//
// Une VRMA est un fichier glTF binaire avec l'extension VRMC_vrm_animation : un squelette humanoïde
// au repos (pose en T, regard vers +Z) et des pistes de rotation par os. Ici le squelette n'a aucune
// rotation au repos, donc les rotations écrites sont directement celles des os « normalisés » de
// three-vrm : bras gauche vers +X, bras droit vers -X, jambes vers -Y.
//
// Les mouvements sont décrits par des fonctions du temps, échantillonnées à 30 images/s.
// Usage : node scripts/build-vrma.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Euler, Quaternion } from 'three'

const FPS = 30
const HIPS_Y = 0.95

/** Squelette au repos : [os, parent, translation locale]. */
const SKELETON = [
  ['hips', null, [0, HIPS_Y, 0]],
  ['spine', 'hips', [0, 0.08, 0]],
  ['chest', 'spine', [0, 0.12, 0]],
  ['upperChest', 'chest', [0, 0.1, 0]],
  ['neck', 'upperChest', [0, 0.12, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['leftShoulder', 'upperChest', [0.03, 0.08, 0]],
  ['leftUpperArm', 'leftShoulder', [0.09, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.24, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.22, 0, 0]],
  ['rightShoulder', 'upperChest', [-0.03, 0.08, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.09, 0, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.24, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.22, 0, 0]],
  ['leftUpperLeg', 'hips', [0.08, -0.05, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0, -0.4, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.4, 0]],
  ['rightUpperLeg', 'hips', [-0.08, -0.05, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [0, -0.4, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.4, 0]],
]

const TAU = Math.PI * 2
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k)

/** Bras le long du corps, comme la pose de repos de l'application. */
const REST = {
  leftUpperArm: [0.1, 0, -1.2],
  rightUpperArm: [0.1, 0, 1.2],
  leftLowerArm: [0, -0.35, 0],
  rightLowerArm: [0, 0.35, 0],
}

/* ------------------------------ Salut de la main ------------------------------ */

const wave = {
  name: 'wave',
  duration: 3.2,
  pose(t) {
    // Lever le bras (0 → 0,5 s), saluer, puis le redescendre (2,6 → 3,2 s).
    const k = smooth(0, 0.5, t) * (1 - smooth(2.6, 3.2, t))
    const w = Math.sin(TAU * 1.6 * Math.max(0, t - 0.35)) * smooth(0.3, 0.6, t) * (1 - smooth(2.4, 2.8, t))
    return {
      bones: {
        rightUpperArm: mix(REST.rightUpperArm, [0, 0.6, -0.05], k),
        rightLowerArm: mix(REST.rightLowerArm, [-0.3, 0.2, -1.45 + w * 0.3], k),
        rightHand: [0, 0, w * 0.18 * k],
        spine: [0, 0, 0.03 * k],
        chest: [0, -0.06 * k, 0.03 * k],
      },
    }
  },
}

/* ----------------------------------- Danse ----------------------------------- */

const dance = {
  name: 'dance',
  duration: 4, // 8 temps à 120 BPM ; la fin rejoint le début pour boucler
  pose(t) {
    const beat = 0.5 - 0.5 * Math.cos(TAU * 2 * t) // 0 → 1 → 0 à chaque temps
    const sway = Math.sin(TAU * t) // gauche/droite sur deux temps
    const slow = Math.sin(TAU * 0.5 * t)
    // Partie A (bras pliés qui balancent) puis partie B (bras levés), retour à A pour boucler.
    const up = smooth(1.7, 2.1, t) * (1 - smooth(3.6, 4, t))

    const armsA = {
      // Poings près de la poitrine qui balancent en rythme.
      leftUpperArm: [0.35 * sway, 0.25, -1.2],
      rightUpperArm: [-0.35 * sway, -0.25, 1.2],
      leftLowerArm: [0, -2.0 - 0.2 * beat, 0],
      rightLowerArm: [0, 2.0 + 0.2 * beat, 0],
      leftHand: [0, 0.2, -0.2],
      rightHand: [0, -0.2, 0.2],
    }
    const armsB = {
      leftUpperArm: [0, 0, 1.05 + 0.25 * sway],
      rightUpperArm: [0, 0, -1.05 + 0.25 * sway],
      leftLowerArm: [0, 0, 0.35 + 0.25 * beat],
      rightLowerArm: [0, 0, -0.35 - 0.25 * beat],
      leftHand: [0, 0, 0.2 * sway],
      rightHand: [0, 0, 0.2 * sway],
    }
    const bones = {}
    for (const b of Object.keys(armsA)) bones[b] = mix(armsA[b], armsB[b], up)

    const knee = 0.28 * beat
    Object.assign(bones, {
      hips: [0, 0.18 * slow, 0.05 * sway],
      spine: [0.02 * beat, -0.1 * slow, -0.05 * sway],
      chest: [0.02 * beat, -0.05 * slow, -0.03 * sway],
      neck: [0.04 * beat, 0, 0],
      head: [0.08 * beat - 0.03, 0.1 * slow, 0.12 * sway],
      leftUpperLeg: [-knee, 0, 0.03],
      rightUpperLeg: [-knee, 0, -0.03],
      leftLowerLeg: [knee * 2, 0, 0],
      rightLowerLeg: [knee * 2, 0, 0],
      leftFoot: [-knee, 0, 0],
      rightFoot: [-knee, 0, 0],
    })
    return { bones, hips: [0.035 * sway, HIPS_Y - 0.035 * beat, 0] }
  },
}

/* ------------------------------ Écriture du .vrma ------------------------------ */

function build(motion) {
  const frames = Math.round(motion.duration * FPS)
  const times = Array.from({ length: frames + 1 }, (_, i) => i / FPS)
  const samples = times.map((t) => motion.pose(t))

  const nodeIndex = new Map(SKELETON.map(([name], i) => [name, i]))
  const nodes = SKELETON.map(([name, , translation]) => ({ name, translation }))
  for (const [name, parent] of SKELETON) {
    if (parent) (nodes[nodeIndex.get(parent)].children ??= []).push(nodeIndex.get(name))
  }

  const chunks = []
  const bufferViews = []
  const accessors = []
  let offset = 0
  const addAccessor = (values, type, minmax = false) => {
    const data = new Float32Array(values)
    const bytes = Buffer.from(data.buffer)
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    chunks.push(bytes)
    offset += bytes.length
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const acc = { bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / size, type }
    if (minmax) Object.assign(acc, { min: [Math.min(...values)], max: [Math.max(...values)] })
    accessors.push(acc)
    return accessors.length - 1
  }

  const input = addAccessor(times, 'SCALAR', true)
  const samplers = []
  const channels = []
  const boneNames = Object.keys(samples[0].bones)
  const q = new Quaternion()
  const e = new Euler()
  for (const bone of boneNames) {
    const values = []
    let prev = null
    for (const s of samples) {
      q.setFromEuler(e.set(...s.bones[bone]))
      // Garde des quaternions continus (évite les sauts lors de l'interpolation).
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      prev = q.clone()
      values.push(q.x, q.y, q.z, q.w)
    }
    samplers.push({ input, output: addAccessor(values, 'VEC4'), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex.get(bone), path: 'rotation' } })
  }
  if (samples[0].hips) {
    samplers.push({ input, output: addAccessor(samples.flatMap((s) => s.hips), 'VEC3'), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex.get('hips'), path: 'translation' } })
  }

  const bin = Buffer.concat(chunks)
  const json = {
    asset: { version: '2.0', generator: 'Avatar3D build-vrma.mjs' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones: Object.fromEntries(SKELETON.map(([name], i) => [name, { node: i }])) },
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
    animations: [{ name: motion.name, samplers, channels }],
  }
  return glb(json, bin)
}

function glb(json, bin) {
  const pad = (buf, byte) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, byte)])
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const binBuf = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0) // « glTF »
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8)
  const chunk = (buf, type) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(buf.length, 0)
    h.writeUInt32LE(type, 4)
    return Buffer.concat([h, buf])
  }
  return Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)])
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'animations')
await mkdir(outDir, { recursive: true })
for (const motion of [wave, dance]) {
  const file = join(outDir, `${motion.name}.vrma`)
  const data = build(motion)
  await writeFile(file, data)
  console.log(`${file} (${(data.length / 1024).toFixed(1)} Ko)`)
}
