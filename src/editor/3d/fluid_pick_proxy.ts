import * as THREE from 'three';
import { isFluidAssetId } from '../../sim/fluid_volumes';

/** A fluid's real surface is rendered separately. Keep its selection proxy
 *  raycastable without drawing a colored collider rectangle over the water. */
export function createFluidPickMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function volumeOverlayMaterial(
  assetId: string,
  selected: boolean,
  normal: THREE.MeshBasicMaterial,
  selection: THREE.MeshBasicMaterial,
  fluid: THREE.MeshBasicMaterial,
): THREE.MeshBasicMaterial {
  return isFluidAssetId(assetId) ? fluid : selected ? selection : normal;
}
