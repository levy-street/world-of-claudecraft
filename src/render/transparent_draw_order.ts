import type * as THREE from 'three';
import { isOccluderGhostMaterial, isOccluderGhostTwin } from './occluder_ghost_variant_key';

interface TransparentDrawItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: THREE.Material;
}

function ghostLayer(item: TransparentDrawItem): number {
  const material = item.material;
  return material.transparent &&
    material.opacity < 1 &&
    material.depthWrite &&
    isOccluderGhostMaterial(material) &&
    !isOccluderGhostTwin(material)
    ? 1
    : 0;
}

/** Faded scenery must not deposit foreground depth before combat transparencies.
 * Keep its existing depth writes and all ordinary depth tests. Within each layer
 * retain Three's stable transparent ordering, including explicit group/order keys.
 * This also covers authored translucent members of the hideable registries. */
export function transparentGameplaySort(
  left: TransparentDrawItem,
  right: TransparentDrawItem,
): number {
  const layer = ghostLayer(left) - ghostLayer(right);
  if (layer !== 0) return layer;
  if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
  if (left.renderOrder !== right.renderOrder) return left.renderOrder - right.renderOrder;
  if (left.z !== right.z) return right.z - left.z;
  return left.id - right.id;
}
