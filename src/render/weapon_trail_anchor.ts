import * as THREE from 'three';

const handCache = new WeakMap<THREE.Object3D, (THREE.Object3D | null)[]>();
const handPoint = new THREE.Vector3();
/** The live native hand, independent of temporarily hidden held equipment. */
export function sampleHandAnchor(root: THREE.Object3D, hand: 0 | 1, out: {x:number;y:number;z:number}): boolean {
  let hands=handCache.get(root);
  if(!hands){hands=[root.getObjectByName('handslotr')??root.getObjectByName('handslot.r')??null,root.getObjectByName('handslotl')??root.getObjectByName('handslot.l')??null];handCache.set(root,hands);}
  const bone=hands[hand];if(!bone)return false;
  bone.updateWorldMatrix(true,false);bone.getWorldPosition(handPoint);
  out.x=handPoint.x;out.y=handPoint.y;out.z=handPoint.z;return true;
}

/** Resolve the real worn mesh once per cast. Its local tip is transformed by
 * the animated hand every frame; no mesh search or geometry allocation there. */
export function weaponTrailAnchor(
  root: THREE.Object3D,
  hand: 0 | 1,
): ((out: THREE.Vector3) => boolean) | null {
  let holder: THREE.Object3D | null = null;
  let melee: THREE.Object3D | null = null;
  root.traverse((node) => {
    if (node.userData.heldPropHolder && node.userData.heldSlot === hand) holder = node;
    if (hand === 0 && node.userData.meleeGestureBlade && node.visible) melee = node;
  });
  holder = melee ?? holder;
  if (!holder) return null;
  let mesh: THREE.Mesh | null = null;
  let longest = 0;
  const tip = new THREE.Vector3();
  (holder as THREE.Object3D).traverse((node) => {
    if (!(node as THREE.Mesh).isMesh || !node.userData.weaponMesh) return;
    const candidate = node as THREE.Mesh;
    if (!candidate.geometry.boundingBox) candidate.geometry.computeBoundingBox();
    const box = candidate.geometry.boundingBox;
    if (!box) return;
    const dx = box.max.x - box.min.x,
      dy = box.max.y - box.min.y,
      dz = box.max.z - box.min.z;
    const length = Math.max(dx, dy, dz);
    if (length <= longest) return;
    longest = length;
    mesh = candidate;
    box.getCenter(tip);
    const axis = dx >= dy && dx >= dz ? 'x' : dy >= dz ? 'y' : 'z';
    tip[axis] = Math.abs(box.max[axis]) >= Math.abs(box.min[axis]) ? box.max[axis] : box.min[axis];
  });
  if (!mesh) return null;
  const weapon = mesh as THREE.Mesh;
  return (out) => {
    let attached = false;
    for (let node: THREE.Object3D | null = weapon; node; node = node.parent) {
      if (!node.visible) return false;
      if (node === root) {
        attached = true;
        break;
      }
    }
    if (!attached) return false;
    weapon.updateWorldMatrix(true, false);
    out.copy(tip).applyMatrix4(weapon.matrixWorld);
    return true;
  };
}
