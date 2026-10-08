import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

/**
 * Rayon de contact minimal des mèches longues, pour un avatar de taille humaine.
 *
 * Les mèches ne sont simulées qu'en quelques points (tous les 6–7 cm) reliés par des segments
 * droits, et les modèles leur donnent souvent un rayon de contact de 1 à 3 cm. Quand l'avatar
 * bouge (danse, bras levés), les segments traversent alors le relief de la poitrine et les
 * mèches paraissent coupées. Un rayon plus grand les garde devant le corps.
 */
const LONG_HAIR_RADIUS = 0.065

/**
 * Augmente le rayon de contact des mèches qui descendent sous le cou (de la racine à la pointe).
 * Les franges et mèches courtes, proches du visage, ne sont pas modifiées.
 * Renvoie le nombre de points de cheveux ajustés.
 */
export function padLongHair(vrm: VRM): number {
  const manager = vrm.springBoneManager
  const head = vrm.humanoid.getRawBoneNode('head')
  const neck = vrm.humanoid.getRawBoneNode('neck') ?? head
  if (!manager || !head || !neck) return 0

  vrm.scene.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  const neckY = neck.getWorldPosition(v).y
  // Proportionnel à la taille de l'avatar (référence : tête à 1,4 m).
  const radius = LONG_HAIR_RADIUS * (head.getWorldPosition(v).y / 1.4)

  let count = 0
  for (const joint of manager.joints) {
    if (!joint.colliderGroups.length || !isDescendant(joint.bone, head)) continue
    let lowest = Infinity
    joint.bone.traverse((o) => (lowest = Math.min(lowest, o.getWorldPosition(v).y)))
    if (lowest < neckY && joint.settings.hitRadius < radius) {
      joint.settings.hitRadius = radius
      count++
    }
  }
  return count
}

function isDescendant(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true
  return false
}
