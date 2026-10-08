// Génère les avatars fournis avec l'application (public/avatars/*.vrm) : Léo (homme),
// Bip (petit robot) et Dino (dinosaure).
//
// Chaque avatar est assemblé à partir de formes simples (sphères, capsules, boîtes arrondies),
// chacune rattachée rigidement à un os : un style « figurine » qui se prête bien aux
// articulations. Le fichier produit est un VRM 1.0 complet :
// - squelette humanoïde (pose en T, regard vers +Z) compatible avec les animations VRMA ;
// - expressions du visage par « morph targets » : clignements, joie, tristesse, colère,
//   surprise, détente, visèmes a/i/u/e/o pour la synchronisation labiale, direction du regard ;
// - matériaux MToon (rendu « dessin animé » avec contour) ;
// - ressorts (antenne du robot, queue du dinosaure).
//
// Ces modèles sont des créations originales du projet, librement réutilisables (CC0).
// Usage : node scripts/build-avatars.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const EXPRESSIONS = [
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight',
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'lookUp', 'lookDown', 'lookLeft', 'lookRight',
]

/* --------------------------------- Géométries --------------------------------- */

const sphere = (seg = 32) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7))
const capsule = (r, len, seg = 20) => new THREE.CapsuleGeometry(r, len, 8, seg)
const cylinder = (rTop, rBottom, h, seg = 24) => new THREE.CylinderGeometry(rTop, rBottom, h, seg)
const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 4, r)
const cone = (r, h) => new THREE.ConeGeometry(r, h, 16)
const torus = (r, tube) => new THREE.TorusGeometry(r, tube, 12, 32)
const ALONG_X = [0, 0, Math.PI / 2] // les capsules/cylindres sont verticaux par défaut

/** Point de la surface avant d'un ellipsoïde, et orientation qui « regarde » vers l'extérieur. */
function onSurface(center, radii, x, y, lift = 0.002) {
  const dx = x - center.x
  const dy = y - center.y
  const k = 1 - (dx / radii.x) ** 2 - (dy / radii.y) ** 2
  const z = center.z + radii.z * Math.sqrt(Math.max(0, k))
  const normal = V(dx / radii.x ** 2, dy / radii.y ** 2, (z - center.z) / radii.z ** 2).normalize()
  const quat = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal)
  return { pos: V(x, y, z).addScaledVector(normal, lift), quat, normal }
}

/* ---------------------------- Déformations du visage ---------------------------- */

const clamp01 = (x) => Math.min(1, Math.max(0, x))

/**
 * Pour une partie du visage, renvoie la nouvelle position (u, v) d'un sommet dans le repère
 * local de la partie (u : vers la gauche de l'avatar, v : vers le haut), ou null s'il ne bouge pas.
 * `side` vaut +1 pour l'œil gauche de l'avatar (à +X), -1 pour le droit.
 */
function deform(expr, part, u, v) {
  const { role, hw, hh, side = 0 } = part
  const inner = clamp01((-side * u) / hw) // 1 du côté du nez
  const outer = clamp01((side * u) / hw)
  if (role === 'eye') {
    const blink = expr === 'blink' || (expr === 'blinkLeft' && side > 0) || (expr === 'blinkRight' && side < 0)
    if (blink) return [u, v * 0.08 - hh * 0.35]
    if (expr === 'happy') return [u * 1.05, v * 0.3 + hh * 0.3 * (1 - (u / hw) ** 2)]
    if (expr === 'relaxed') return [u, v > 0 ? v * 0.35 : v * 0.9]
    if (expr === 'sad') return [u, v > 0 ? v * (0.85 - 0.35 * outer) : v]
    if (expr === 'angry') return [u, v > 0 ? v * (0.75 - 0.4 * inner) : v]
    if (expr === 'surprised') return [u * 1.15, v * 1.2]
  }
  if (role === 'mouth') {
    const c = (u / hw) ** 2
    switch (expr) {
      case 'aa': return [u * 0.85, v * 5]
      case 'ih': return [u * 1.2, v * 2.4]
      case 'ou': return [u * 0.55, v * 3.2]
      case 'ee': return [u * 1.3, v * 3]
      case 'oh': return [u * 0.8, v * 4.2]
      case 'happy': return [u * 1.15, v * 1.8 + hh * 3 * c]
      case 'relaxed': return [u, v + hh * 1.5 * c]
      case 'sad': return [u * 0.9, v - hh * 2.5 * c]
      case 'angry': return [u * 0.75, v * 1.5 - hh * 1.5 * c]
      case 'surprised': return [u * 0.6, v * 4]
    }
  }
  if (role === 'brow') {
    const e = part.lift
    if (expr === 'sad') return [u, v + e * inner - e * 0.3 * outer]
    if (expr === 'angry') return [u, v - e * inner + e * 0.4 * outer]
    if (expr === 'surprised') return [u, v + e * 1.3]
    if (expr === 'happy') return [u, v + e * 0.4]
  }
  return null
}

/** Déplacement d'ensemble d'une partie (direction du regard). */
function shift(expr, part) {
  if (part.role !== 'eye' && part.role !== 'highlight') return null
  const { hw, hh } = part.eye ?? part
  if (expr === 'lookLeft') return [hw * 0.45, 0]
  if (expr === 'lookRight') return [-hw * 0.45, 0]
  if (expr === 'lookUp') return [0, hh * 0.3]
  if (expr === 'lookDown') return [0, -hh * 0.3]
  return null
}

/* ----------------------------------- Avatar ----------------------------------- */

class Avatar {
  constructor(name) {
    this.name = name
    this.bones = []
    this.boneByName = new Map()
    this.materials = []
    this.matIndex = new Map()
    this.parts = []
    this.springs = []
  }

  bone(name, parent, pos, human = true) {
    const b = { name, parent, pos: V(...pos), human, index: this.bones.length }
    this.bones.push(b)
    this.boneByName.set(name, b)
    return this
  }

  /** Matériau MToon : couleur, ombre, contour, éventuellement lumineux. */
  mat(key, color, { shade, outline = true, emissive = 0 } = {}) {
    this.matIndex.set(key, this.materials.length)
    this.materials.push({ key, color, shade: shade ?? color, outline, emissive })
    return this
  }

  /**
   * Ajoute une forme rattachée à un os. `face` (facultatif) décrit une partie du visage animée
   * par les expressions : { role: 'eye' | 'highlight' | 'mouth' | 'brow', hw, hh, side, ... }.
   */
  add(boneName, geometry, mat, { pos = [0, 0, 0], rot = [0, 0, 0], quat, scale = [1, 1, 1], face } = {}) {
    if (!this.boneByName.has(boneName)) throw new Error(`os inconnu : ${boneName}`)
    const q = quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))
    const p = Array.isArray(pos) ? V(...pos) : pos
    const m = new THREE.Matrix4().compose(p, q, V(...scale))
    const g = geometry.applyMatrix4(m)
    if (face) {
      face.center = p.clone()
      face.right = V(1, 0, 0).applyQuaternion(q)
      face.up = V(0, 1, 0).applyQuaternion(q)
      face.normal = V(0, 0, 1).applyQuaternion(q)
    }
    this.parts.push({ bone: this.boneByName.get(boneName), geometry: g, mat, face })
    return this
  }

  /** Paire gauche/droite : `fn(side)` avec side = +1 (gauche de l'avatar, +X) puis -1. */
  mirror(fn) {
    fn(1, 'left', this)
    fn(-1, 'right', this)
    return this
  }

  spring(name, boneNames, settings) {
    this.springs.push({ name, boneNames, settings })
    return this
  }

  /* ----------------------------- Export VRM 1.0 ----------------------------- */

  toVRM({ lookAtBone = 'head', eyeHeight, eyeDepth }) {
    const gltf = {
      asset: { version: '2.0', generator: 'Avatar3D build-avatars.mjs' },
      extensionsUsed: ['VRMC_vrm', 'VRMC_materials_mtoon', 'VRMC_springBone'],
      extensions: {},
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      skins: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
    }
    const chunks = []
    let offset = 0
    const pushView = (typed, target) => {
      const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
      const pad = (4 - (bytes.length % 4)) % 4
      gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
      chunks.push(bytes, Buffer.alloc(pad))
      offset += bytes.length + pad
      return gltf.bufferViews.length - 1
    }
    const accessor = (typed, type, componentType, target, minmax) => {
      const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]
      const acc = { bufferView: pushView(typed, target), componentType, count: typed.length / size, type }
      if (minmax) {
        const min = Array(size).fill(Infinity)
        const max = Array(size).fill(-Infinity)
        for (let i = 0; i < typed.length; i++) {
          min[i % size] = Math.min(min[i % size], typed[i])
          max[i % size] = Math.max(max[i % size], typed[i])
        }
        Object.assign(acc, { min, max })
      }
      gltf.accessors.push(acc)
      return gltf.accessors.length - 1
    }

    // Os : translations locales (pas de rotation au repos).
    for (const b of this.bones) {
      const parent = b.parent ? this.boneByName.get(b.parent) : null
      const t = parent ? b.pos.clone().sub(parent.pos) : b.pos.clone()
      gltf.nodes.push({ name: b.name, translation: t.toArray() })
    }
    for (const b of this.bones) {
      if (!b.parent) gltf.scenes[0].nodes.push(b.index)
      else (gltf.nodes[this.boneByName.get(b.parent).index].children ??= []).push(b.index)
    }

    // Peau : matrices de liaison inverses = translation opposée à la position de chaque os.
    const ibm = new Float32Array(this.bones.length * 16)
    this.bones.forEach((b, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos.x, -b.pos.y, -b.pos.z, 1], i * 16))
    gltf.skins.push({ inverseBindMatrices: accessor(ibm, 'MAT4', 5126), joints: this.bones.map((b) => b.index), skeleton: 0 })

    // Matériaux MToon.
    const lin = (hex) => new THREE.Color(hex).toArray()
    for (const m of this.materials) {
      const base = lin(m.color)
      gltf.materials.push({
        name: m.key,
        pbrMetallicRoughness: { baseColorFactor: [...base, 1], metallicFactor: 0, roughnessFactor: 1 },
        emissiveFactor: m.emissive ? base.map((c) => c * m.emissive) : [0, 0, 0],
        extensions: {
          VRMC_materials_mtoon: {
            specVersion: '1.0',
            shadeColorFactor: lin(m.shade),
            shadingToonyFactor: 0.92,
            shadingShiftFactor: -0.1,
            giEqualizationFactor: 0.9,
            parametricRimColorFactor: [0.15, 0.15, 0.2],
            parametricRimFresnelPowerFactor: 4,
            parametricRimLiftFactor: 0,
            rimLightingMixFactor: 1,
            outlineWidthMode: m.outline ? 'worldCoordinates' : 'none',
            outlineWidthFactor: m.outline ? 0.0045 : 0,
            outlineColorFactor: lin('#2a2233'),
            outlineLightingMixFactor: 1,
          },
        },
      })
    }

    // Deux maillages : le corps (sans expressions) et le visage (avec morph targets).
    const meshNode = (name, parts, withMorphs) => {
      const byMat = new Map()
      for (const part of parts) {
        const idx = this.matIndex.get(part.mat)
        if (idx === undefined) throw new Error(`matériau inconnu : ${part.mat}`)
        if (!byMat.has(idx)) byMat.set(idx, [])
        byMat.get(idx).push(part)
      }
      const primitives = []
      for (const [matIdx, list] of byMat) {
        const pos = []
        const nor = []
        const joints = []
        const weights = []
        const indices = []
        const targets = EXPRESSIONS.map(() => [])
        for (const part of list) {
          const g = part.geometry
          const base = pos.length / 3
          const P = g.getAttribute('position')
          const N = g.getAttribute('normal')
          for (let i = 0; i < P.count; i++) {
            const p = V(P.getX(i), P.getY(i), P.getZ(i))
            pos.push(p.x, p.y, p.z)
            nor.push(N.getX(i), N.getY(i), N.getZ(i))
            joints.push(part.bone.index, 0, 0, 0)
            weights.push(1, 0, 0, 0)
            if (!withMorphs) continue
            EXPRESSIONS.forEach((expr, e) => {
              const delta = V()
              const f = part.face
              if (f) {
                const ref = f.role === 'highlight' ? f.eye : f
                const local = p.clone().sub(ref.center)
                const u = local.dot(ref.right)
                const v = local.dot(ref.up)
                const w = local.dot(ref.normal)
                if (f.role === 'highlight') {
                  // Le reflet suit l'œil ; il disparaît quand l'œil se ferme ou plisse.
                  const hide = ['blink', 'happy', 'relaxed'].includes(expr) ||
                    (expr === 'blinkLeft' && f.eye.side > 0) || (expr === 'blinkRight' && f.eye.side < 0)
                  if (hide) delta.copy(f.eye.center).sub(p).addScaledVector(ref.normal, -0.004)
                  else if (expr === 'surprised') delta.addScaledVector(ref.right, u * 0.15).addScaledVector(ref.up, v * 0.2)
                } else {
                  const d = deform(expr, f, u, v)
                  if (d) {
                    const np = ref.center.clone().addScaledVector(ref.right, d[0]).addScaledVector(ref.up, d[1]).addScaledVector(ref.normal, w)
                    delta.copy(np.sub(p))
                  }
                }
                const s = shift(expr, f)
                if (s) delta.addScaledVector(ref.right, s[0]).addScaledVector(ref.up, s[1])
              }
              targets[e].push(delta.x, delta.y, delta.z)
            })
          }
          const I = g.index // certaines géométries (boîtes arrondies) ne sont pas indexées
          if (I) for (let i = 0; i < I.count; i++) indices.push(base + I.getX(i))
          else for (let i = 0; i < P.count; i++) indices.push(base + i)
        }
        const prim = {
          attributes: {
            POSITION: accessor(new Float32Array(pos), 'VEC3', 5126, 34962, true),
            NORMAL: accessor(new Float32Array(nor), 'VEC3', 5126, 34962),
            JOINTS_0: accessor(new Uint16Array(joints), 'VEC4', 5123, 34962),
            WEIGHTS_0: accessor(new Float32Array(weights), 'VEC4', 5126, 34962),
          },
          indices: accessor(new Uint32Array(indices), 'SCALAR', 5125, 34963),
          material: matIdx,
        }
        if (withMorphs) prim.targets = targets.map((t) => ({ POSITION: accessor(new Float32Array(t), 'VEC3', 5126, 34962, true) }))
        primitives.push(prim)
      }
      const mesh = { name, primitives }
      if (withMorphs) Object.assign(mesh, { weights: EXPRESSIONS.map(() => 0), extras: { targetNames: EXPRESSIONS } })
      gltf.meshes.push(mesh)
      gltf.nodes.push({ name, mesh: gltf.meshes.length - 1, skin: 0 })
      gltf.scenes[0].nodes.push(gltf.nodes.length - 1)
      return gltf.nodes.length - 1
    }
    const bodyNode = meshNode('Body', this.parts.filter((p) => !p.face), false)
    const faceNode = meshNode('Face', this.parts.filter((p) => p.face), true)

    // Extension VRM : méta-données, humanoïde, expressions, regard.
    const humanBones = {}
    for (const b of this.bones) if (b.human) humanBones[b.name] = { node: b.index }
    const preset = {}
    EXPRESSIONS.forEach((name, index) => {
      preset[name] = {
        morphTargetBinds: [{ node: faceNode, index, weight: 1 }],
        isBinary: false,
        overrideBlink: 'none',
        overrideLookAt: 'none',
        overrideMouth: 'none',
      }
    })
    const head = this.boneByName.get(lookAtBone)
    const range = { inputMaxValue: 25, outputScale: 1 }
    gltf.extensions.VRMC_vrm = {
      specVersion: '1.0',
      meta: {
        name: this.name,
        version: '1.0',
        authors: ['Avatar3D'],
        copyrightInformation: 'Avatar3D — création originale, domaine public (CC0)',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        avatarPermission: 'everyone',
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation',
        allowPoliticalOrReligiousUsage: true,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary',
        allowRedistribution: true,
        modification: 'allowModificationRedistribution',
      },
      humanoid: { humanBones },
      expressions: { preset },
      lookAt: {
        type: 'expression',
        offsetFromHeadBone: [0, eyeHeight - head.pos.y, eyeDepth - head.pos.z],
        rangeMapHorizontalInner: range,
        rangeMapHorizontalOuter: range,
        rangeMapVerticalDown: range,
        rangeMapVerticalUp: range,
      },
      firstPerson: { meshAnnotations: [{ node: bodyNode, type: 'auto' }, { node: faceNode, type: 'auto' }] },
    }

    // Ressorts (antenne, queue…).
    gltf.extensions.VRMC_springBone = {
      specVersion: '1.0',
      springs: this.springs.map((s) => ({
        name: s.name,
        joints: s.boneNames.map((n) => ({ node: this.boneByName.get(n).index, gravityDir: [0, -1, 0], ...s.settings })),
      })),
    }

    const bin = Buffer.concat(chunks)
    gltf.buffers.push({ byteLength: bin.length })
    return glb(gltf, bin)
  }
}

function glb(json, bin) {
  const pad = (buf, byte) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, byte)])
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const binBuf = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
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

/** Ajoute deux yeux (avec reflet), une bouche et éventuellement des sourcils sur un ellipsoïde. */
function addFace(a, { bone = 'head', center, radii, eyeX, eyeY, eye, mouthY, mouth, brow, mats }) {
  a.mirror((side) => {
    const s = onSurface(center, radii, side * eyeX, eyeY)
    const eyePart = { role: 'eye', hw: eye[0], hh: eye[1], side }
    a.add(bone, sphere(24), mats.eye, { pos: s.pos, quat: s.quat, scale: [eye[0], eye[1], eye[2] ?? 0.008], face: eyePart })
    const hl = s.pos.clone()
      .addScaledVector(V(1, 0, 0).applyQuaternion(s.quat), eye[0] * 0.35)
      .addScaledVector(V(0, 1, 0).applyQuaternion(s.quat), eye[1] * 0.38)
      .addScaledVector(s.normal, (eye[2] ?? 0.008) * 0.9 + 0.002)
    a.add(bone, sphere(12), mats.highlight, { pos: hl, quat: s.quat, scale: [eye[0] * 0.32, eye[0] * 0.32, 0.003], face: { role: 'highlight', eye: eyePart } })
    if (brow) {
      const b = onSurface(center, radii, side * eyeX * 1.05, eyeY + brow.dy, 0.003)
      const tilt = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), side * 0.12)
      a.add(bone, capsule(brow.thickness, brow.length, 10), mats.brow, {
        pos: b.pos,
        quat: b.quat.clone().multiply(tilt).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...ALONG_X))),
        scale: [1, 1, 0.5],
        face: { role: 'brow', hw: brow.length / 2 + brow.thickness, hh: brow.thickness, side, lift: brow.lift },
      })
    }
  })
  const m = onSurface(mouth.center ?? center, mouth.radii ?? radii, 0, mouthY)
  a.add(bone, sphere(24), mats.mouth, {
    pos: m.pos,
    quat: m.quat,
    scale: [mouth.w, mouth.h, 0.006],
    face: { role: 'mouth', hw: mouth.w, hh: mouth.h },
  })
}

/* ------------------------------------ Léo ------------------------------------ */

function leo() {
  const a = new Avatar('Léo')
    .bone('hips', null, [0, 0.86, 0]).bone('spine', 'hips', [0, 0.96, 0]).bone('chest', 'spine', [0, 1.1, 0])
    .bone('neck', 'chest', [0, 1.36, 0]).bone('head', 'neck', [0, 1.42, 0])
    .mirror((s, side, av) => {
      av.bone(`${side}Shoulder`, 'chest', [s * 0.04, 1.3, 0])
        .bone(`${side}UpperArm`, `${side}Shoulder`, [s * 0.17, 1.3, 0])
        .bone(`${side}LowerArm`, `${side}UpperArm`, [s * 0.42, 1.3, 0])
        .bone(`${side}Hand`, `${side}LowerArm`, [s * 0.66, 1.3, 0])
        .bone(`${side}UpperLeg`, 'hips', [s * 0.09, 0.83, 0])
        .bone(`${side}LowerLeg`, `${side}UpperLeg`, [s * 0.09, 0.46, 0])
        .bone(`${side}Foot`, `${side}LowerLeg`, [s * 0.09, 0.08, 0])
    })
    .mat('skin', '#f1c5a3', { shade: '#d4977a' })
    .mat('hair', '#4b3426', { shade: '#2b1d14' })
    .mat('shirt', '#3d7bd9', { shade: '#2a559c' })
    .mat('trim', '#f2f4f8', { shade: '#c3c9d6' })
    .mat('pants', '#303855', { shade: '#1c2134' })
    .mat('shoes', '#2b2b2f', { shade: '#141416' })
    .mat('sole', '#eeeeee', { shade: '#bdbdbd' })
    .mat('eye', '#231c1c', { outline: false })
    .mat('highlight', '#ffffff', { outline: false, emissive: 0.3 })
    .mat('mouth', '#8a3a3a', { outline: false })
    .mat('brow', '#3b281c', { outline: false })
    .mat('blush', '#f3a49a', { outline: false })
    .mat('nose', '#e8b493', { shade: '#cf9474', outline: false })

  const HC = V(0, 1.565, 0)
  const HR = V(0.165, 0.182, 0.17)
  a.add('head', sphere(48), 'skin', { pos: HC, scale: HR.toArray() })
  a.mirror((s) => a.add('head', sphere(), 'skin', { pos: [s * 0.163, 1.555, -0.005], scale: [0.017, 0.038, 0.03] }))
  const nose = onSurface(HC, HR, 0, 1.528, 0.004)
  a.add('head', sphere(16), 'nose', { pos: nose.pos, quat: nose.quat, scale: [0.016, 0.018, 0.014] })
  a.mirror((s) => {
    const b = onSurface(HC, HR, s * 0.097, 1.5, 0.001)
    a.add('head', sphere(16), 'blush', { pos: b.pos, quat: b.quat, scale: [0.024, 0.013, 0.004] })
  })
  // Cheveux : calotte inclinée vers l'arrière (front dégagé), nuque, mèche avant, pattes.
  a.add('head', new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), 'hair', {
    pos: [0, 1.578, -0.009], rot: [-0.38, 0, 0], scale: [0.179, 0.198, 0.185],
  })
  a.add('head', new THREE.SphereGeometry(1, 48, 24, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.42), 'hair', {
    pos: [0, 1.565, -0.006], scale: [0.174, 0.19, 0.18],
  })
  a.add('head', sphere(), 'hair', { pos: [0.027, 1.655, 0.137], rot: [0.5, 0, -0.18], scale: [0.12, 0.033, 0.07] })
  a.mirror((s) => a.add('head', capsule(0.015, 0.055, 10), 'hair', { pos: [s * 0.158, 1.545, 0.038] }))
  addFace(a, {
    center: HC, radii: HR, eyeX: 0.06, eyeY: 1.545, eye: [0.023, 0.031],
    mouthY: 1.478, mouth: { w: 0.024, h: 0.006 },
    brow: { dy: 0.056, length: 0.033, thickness: 0.005, lift: 0.011 },
    mats: { eye: 'eye', highlight: 'highlight', mouth: 'mouth', brow: 'brow' },
  })
  // Cou, buste, bassin.
  a.add('neck', cylinder(0.042, 0.046, 0.12), 'skin', { pos: [0, 1.37, 0] })
  a.add('chest', capsule(0.15, 0.14, 32), 'shirt', { pos: [0, 1.17, 0], scale: [1, 1, 0.68] })
  a.add('chest', torus(0.056, 0.014), 'trim', { pos: [0, 1.305, 0.004], rot: [Math.PI / 2, 0, 0], scale: [1, 0.7, 1] })
  a.add('spine', capsule(0.135, 0.06, 32), 'shirt', { pos: [0, 1.0, 0], scale: [1, 1, 0.68] })
  a.add('hips', capsule(0.14, 0.05, 32), 'pants', { pos: [0, 0.875, 0], scale: [1, 0.9, 0.7] })
  a.mirror((s, side) => {
    a.add(`${side}UpperArm`, sphere(), 'shirt', { pos: [s * 0.17, 1.29, 0], scale: [0.07, 0.065, 0.06] })
    a.add(`${side}UpperArm`, capsule(0.05, 0.11), 'shirt', { pos: [s * 0.25, 1.3, 0], rot: ALONG_X })
    a.add(`${side}UpperArm`, capsule(0.04, 0.12), 'skin', { pos: [s * 0.33, 1.3, 0], rot: ALONG_X })
    a.add(`${side}LowerArm`, capsule(0.036, 0.18), 'skin', { pos: [s * 0.54, 1.3, 0], rot: ALONG_X })
    a.add(`${side}Hand`, sphere(), 'skin', { pos: [s * 0.7, 1.3, 0], scale: [0.05, 0.04, 0.03] })
    a.add(`${side}Hand`, capsule(0.012, 0.025, 8), 'skin', { pos: [s * 0.685, 1.3, 0.03], rot: [0, 0, s * 0.9] })
    a.add(`${side}UpperLeg`, capsule(0.068, 0.27), 'pants', { pos: [s * 0.09, 0.645, 0] })
    a.add(`${side}LowerLeg`, capsule(0.058, 0.3), 'pants', { pos: [s * 0.09, 0.27, 0] })
    a.add(`${side}Foot`, rbox(0.105, 0.075, 0.21, 0.03), 'shoes', { pos: [s * 0.09, 0.05, 0.035] })
    a.add(`${side}Foot`, rbox(0.11, 0.022, 0.215, 0.01), 'sole', { pos: [s * 0.09, 0.012, 0.035] })
  })
  return a.toVRM({ eyeHeight: 1.545, eyeDepth: 0.16 })
}

/* ------------------------------------ Bip ------------------------------------ */

function bip() {
  const a = new Avatar('Bip')
    .bone('hips', null, [0, 0.4, 0]).bone('spine', 'hips', [0, 0.45, 0]).bone('chest', 'spine', [0, 0.53, 0])
    .bone('neck', 'chest', [0, 0.65, 0]).bone('head', 'neck', [0, 0.69, 0])
    .bone('antenna1', 'head', [0, 1.0, 0], false).bone('antenna2', 'antenna1', [0, 1.08, 0], false)
    .bone('antenna3', 'antenna2', [0, 1.14, 0], false)
    .mirror((s, side, av) => {
      av.bone(`${side}UpperArm`, 'chest', [s * 0.16, 0.6, 0])
        .bone(`${side}LowerArm`, `${side}UpperArm`, [s * 0.27, 0.6, 0])
        .bone(`${side}Hand`, `${side}LowerArm`, [s * 0.37, 0.6, 0])
        .bone(`${side}UpperLeg`, 'hips', [s * 0.075, 0.38, 0])
        .bone(`${side}LowerLeg`, `${side}UpperLeg`, [s * 0.075, 0.23, 0])
        .bone(`${side}Foot`, `${side}LowerLeg`, [s * 0.075, 0.07, 0])
    })
    .mat('white', '#eef2f8', { shade: '#b6c1d3' })
    .mat('grey', '#8d98ac', { shade: '#5d6677' })
    .mat('orange', '#ff9b3d', { shade: '#d0661a' })
    .mat('glowOrange', '#ffb35c', { shade: '#ff9b3d', emissive: 0.6 })
    .mat('visor', '#172036', { shade: '#0c1120' })
    .mat('panel', '#7cc6ff', { shade: '#4a93d6', emissive: 0.25 })
    .mat('eye', '#66f4ff', { outline: false, emissive: 0.9 })
    .mat('highlight', '#ffffff', { outline: false, emissive: 1 })
    .mat('mouth', '#66f4ff', { outline: false, emissive: 0.9 })
    .mat('cheek', '#ff8fb5', { outline: false, emissive: 0.6 })

  a.add('head', rbox(0.44, 0.32, 0.36, 0.09), 'white', { pos: [0, 0.85, 0] })
  a.add('head', rbox(0.36, 0.22, 0.06, 0.05), 'visor', { pos: [0, 0.845, 0.155] })
  a.mirror((s) => {
    a.add('head', cylinder(0.05, 0.05, 0.04), 'orange', { pos: [s * 0.235, 0.85, 0], rot: ALONG_X })
    a.add('head', cylinder(0.028, 0.028, 0.05), 'grey', { pos: [s * 0.245, 0.85, 0], rot: ALONG_X })
    a.add('head', sphere(16), 'cheek', { pos: [s * 0.125, 0.8, 0.187], scale: [0.022, 0.012, 0.003] })
  })
  a.add('antenna1', cylinder(0.01, 0.012, 0.09, 12), 'grey', { pos: [0, 1.045, 0] })
  a.add('antenna2', sphere(), 'glowOrange', { pos: [0, 1.11, 0], scale: [0.032, 0.032, 0.032] })
  // Visage plat sur l'écran : un « ellipsoïde » très large fait office de plan.
  addFace(a, {
    center: V(0, 0.84, -10), radii: V(100, 100, 10.188), eyeX: 0.075, eyeY: 0.86, eye: [0.03, 0.04, 0.005],
    mouthY: 0.79, mouth: { w: 0.03, h: 0.006 },
    mats: { eye: 'eye', highlight: 'highlight', mouth: 'mouth' },
  })
  a.add('neck', cylinder(0.045, 0.05, 0.06), 'grey', { pos: [0, 0.665, 0] })
  a.add('chest', rbox(0.3, 0.22, 0.22, 0.07), 'white', { pos: [0, 0.545, 0] })
  a.add('chest', rbox(0.15, 0.08, 0.02, 0.01), 'panel', { pos: [0, 0.565, 0.11] })
  a.add('chest', sphere(16), 'orange', { pos: [0, 0.495, 0.108], scale: [0.016, 0.016, 0.01] })
  a.add('hips', rbox(0.24, 0.09, 0.19, 0.04), 'grey', { pos: [0, 0.415, 0] })
  a.mirror((s, side) => {
    a.add(`${side}UpperArm`, sphere(), 'orange', { pos: [s * 0.165, 0.6, 0], scale: [0.045, 0.045, 0.045] })
    a.add(`${side}UpperArm`, capsule(0.032, 0.06), 'grey', { pos: [s * 0.22, 0.6, 0], rot: ALONG_X })
    a.add(`${side}LowerArm`, capsule(0.036, 0.06), 'white', { pos: [s * 0.32, 0.6, 0], rot: ALONG_X })
    a.add(`${side}Hand`, sphere(), 'orange', { pos: [s * 0.4, 0.6, 0], scale: [0.048, 0.048, 0.048] })
    a.add(`${side}UpperLeg`, cylinder(0.035, 0.035, 0.12), 'grey', { pos: [s * 0.075, 0.31, 0] })
    a.add(`${side}LowerLeg`, cylinder(0.045, 0.05, 0.12), 'white', { pos: [s * 0.075, 0.16, 0] })
    a.add(`${side}Foot`, rbox(0.11, 0.07, 0.16, 0.03), 'orange', { pos: [s * 0.075, 0.035, 0.025] })
  })
  a.spring('Antenne', ['antenna1', 'antenna2', 'antenna3'], { hitRadius: 0.02, stiffness: 0.8, gravityPower: 0, dragForce: 0.25 })
  return a.toVRM({ eyeHeight: 0.86, eyeDepth: 0.19 })
}

/* ------------------------------------ Dino ------------------------------------ */

function dino() {
  const a = new Avatar('Dino')
    .bone('hips', null, [0, 0.45, 0]).bone('spine', 'hips', [0, 0.53, 0]).bone('chest', 'spine', [0, 0.63, 0])
    .bone('neck', 'chest', [0, 0.74, 0]).bone('head', 'neck', [0, 0.79, 0])
    .bone('tail1', 'hips', [0, 0.42, -0.16], false).bone('tail2', 'tail1', [0, 0.36, -0.31], false)
    .bone('tail3', 'tail2', [0, 0.3, -0.44], false).bone('tail4', 'tail3', [0, 0.26, -0.55], false)
    .bone('tail5', 'tail4', [0, 0.24, -0.63], false)
    .mirror((s, side, av) => {
      av.bone(`${side}UpperArm`, 'chest', [s * 0.15, 0.66, 0])
        .bone(`${side}LowerArm`, `${side}UpperArm`, [s * 0.235, 0.66, 0])
        .bone(`${side}Hand`, `${side}LowerArm`, [s * 0.31, 0.66, 0])
        .bone(`${side}UpperLeg`, 'hips', [s * 0.1, 0.42, 0])
        .bone(`${side}LowerLeg`, `${side}UpperLeg`, [s * 0.1, 0.25, 0])
        .bone(`${side}Foot`, `${side}LowerLeg`, [s * 0.1, 0.07, 0])
    })
    .mat('green', '#74c76b', { shade: '#4a9446' })
    .mat('light', '#a3df92', { shade: '#72b463' })
    .mat('belly', '#f6e27c', { shade: '#d8b947' })
    .mat('spike', '#ffaa4d', { shade: '#e07a1e' })
    .mat('claw', '#fff7e6', { shade: '#d9cbb0' })
    .mat('eye', '#1e1a1a', { outline: false })
    .mat('highlight', '#ffffff', { outline: false, emissive: 0.3 })
    .mat('mouth', '#6b2b2b', { outline: false })
    .mat('blush', '#ff9fb0', { outline: false })
    .mat('nostril', '#3d6b37', { outline: false })

  const HC = V(0, 0.96, 0)
  const HR = V(0.2, 0.185, 0.19)
  const SC = V(0, 0.895, 0.12)
  const SR = V(0.155, 0.105, 0.12)
  a.add('head', sphere(48), 'green', { pos: HC, scale: HR.toArray() })
  a.add('head', sphere(40), 'light', { pos: SC, scale: SR.toArray() })
  a.mirror((s) => {
    const n = onSurface(SC, SR, s * 0.035, 0.918, 0.001)
    a.add('head', sphere(12), 'nostril', { pos: n.pos, quat: n.quat, scale: [0.008, 0.006, 0.004] })
    const b = onSurface(HC, HR, s * 0.16, 0.95, 0.001)
    a.add('head', sphere(16), 'blush', { pos: b.pos, quat: b.quat, scale: [0.03, 0.017, 0.005] })
  })
  addFace(a, {
    center: HC, radii: HR, eyeX: 0.085, eyeY: 1.0, eye: [0.033, 0.042, 0.01],
    mouthY: 0.865, mouth: { w: 0.035, h: 0.0065, center: SC, radii: SR },
    mats: { eye: 'eye', highlight: 'highlight', mouth: 'mouth' },
  })
  const spikes = [
    ['head', [0, 1.14, -0.02], -0.3, 1], ['head', [0, 1.1, -0.12], -0.9, 1], ['neck', [0, 0.87, -0.17], -1.2, 0.9],
    ['chest', [0, 0.73, -0.2], -1.4, 0.9], ['spine', [0, 0.6, -0.21], -1.5, 0.85], ['hips', [0, 0.49, -0.21], -1.5, 0.8],
    ['tail1', [0, 0.5, -0.22], -1.1, 0.75], ['tail2', [0, 0.43, -0.34], -1.2, 0.6], ['tail3', [0, 0.365, -0.46], -1.3, 0.45],
  ]
  for (const [bone, pos, tilt, k] of spikes) a.add(bone, cone(0.035 * k, 0.08 * k), 'spike', { pos, rot: [tilt, 0, 0] })
  a.add('chest', sphere(40), 'green', { pos: [0, 0.62, 0], scale: [0.2, 0.2, 0.18] })
  a.add('hips', sphere(40), 'green', { pos: [0, 0.47, 0], scale: [0.21, 0.16, 0.19] })
  a.add('spine', sphere(32), 'belly', { pos: [0, 0.56, 0.12], scale: [0.15, 0.2, 0.075] })
  a.add('tail1', sphere(32), 'green', { pos: [0, 0.41, -0.2], scale: [0.12, 0.11, 0.15] })
  a.add('tail2', sphere(32), 'green', { pos: [0, 0.355, -0.33], scale: [0.095, 0.085, 0.12] })
  a.add('tail3', sphere(24), 'green', { pos: [0, 0.305, -0.45], scale: [0.07, 0.065, 0.09] })
  a.add('tail4', sphere(24), 'green', { pos: [0, 0.265, -0.55], scale: [0.05, 0.045, 0.07] })
  a.mirror((s, side) => {
    a.add(`${side}UpperArm`, capsule(0.042, 0.05), 'green', { pos: [s * 0.19, 0.66, 0], rot: ALONG_X })
    a.add(`${side}LowerArm`, capsule(0.04, 0.04), 'green', { pos: [s * 0.27, 0.66, 0], rot: ALONG_X })
    a.add(`${side}Hand`, sphere(), 'light', { pos: [s * 0.33, 0.66, 0], scale: [0.048, 0.044, 0.044] })
    for (const dz of [-0.02, 0.02]) a.add(`${side}Hand`, cone(0.012, 0.03), 'claw', { pos: [s * 0.375, 0.66, dz], rot: [0, 0, -s * Math.PI / 2] })
    a.add(`${side}UpperLeg`, sphere(32), 'green', { pos: [s * 0.1, 0.36, 0], scale: [0.09, 0.11, 0.095] })
    a.add(`${side}LowerLeg`, capsule(0.065, 0.08), 'green', { pos: [s * 0.1, 0.18, 0] })
    a.add(`${side}Foot`, sphere(32), 'light', { pos: [s * 0.1, 0.045, 0.035], scale: [0.085, 0.05, 0.12] })
    for (const dx of [-0.035, 0, 0.035]) a.add(`${side}Foot`, sphere(12), 'claw', { pos: [s * 0.1 + dx, 0.035, 0.15], scale: [0.016, 0.014, 0.016] })
  })
  a.spring('Queue', ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'], { hitRadius: 0.05, stiffness: 1.2, gravityPower: 0.05, dragForce: 0.4 })
  return a.toVRM({ eyeHeight: 1.0, eyeDepth: 0.18 })
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'avatars')
await mkdir(outDir, { recursive: true })
for (const [file, build] of [['leo.vrm', leo], ['bip.vrm', bip], ['dino.vrm', dino]]) {
  const data = build()
  await writeFile(join(outDir, file), data)
  console.log(`${file} (${(data.length / 1024).toFixed(0)} Ko)`)
}
