import * as THREE from 'three';

/** Cache the complete worn prop's bounds once. Surface sampling only transforms
 * those bounds through the animated holder, without mesh searches or allocation.
 * The frame's Y is the long axis, Z the thin axis; extents are world half-sizes. */
export function weaponSurfaceAnchor(
  root: THREE.Object3D,
  holder: THREE.Object3D,
): ((frame: THREE.Matrix4, extents: THREE.Vector3) => boolean) | undefined {
  holder.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const inverse = holder.matrixWorld.clone().invert();
  const transform = new THREE.Matrix4();
  const piece = new THREE.Box3();
  holder.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData.weaponMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    transform.copy(inverse).multiply(mesh.matrixWorld);
    piece.copy(mesh.geometry.boundingBox).applyMatrix4(transform);
    bounds.union(piece);
  });
  if (bounds.isEmpty()) return undefined;
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const centre = bounds.getCenter(new THREE.Vector3());
  const lengths = [size.x, size.y, size.z];
  let long = 0,
    thin = 0;
  for (let i = 1; i < 3; i++) {
    if (lengths[i] > lengths[long]) long = i;
    if (lengths[i] < lengths[thin]) thin = i;
  }
  if (long === thin) thin = (long + 1) % 3;
  const sideIndex = 3 - long - thin;
  const side = new THREE.Vector3(),
    axis = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    position = new THREE.Vector3();
  return (frame, extents) => {
    let attached = false;
    for (let node: THREE.Object3D | null = holder; node; node = node.parent) {
      if (!node.visible) return false;
      if (node === root) {
        attached = true;
        break;
      }
    }
    if (!attached) return false;
    holder.updateWorldMatrix(true, false);
    side.setFromMatrixColumn(holder.matrixWorld, sideIndex);
    axis.setFromMatrixColumn(holder.matrixWorld, long);
    normal.setFromMatrixColumn(holder.matrixWorld, thin);
    extents.set(
      side.length() * lengths[sideIndex],
      axis.length() * lengths[long],
      normal.length() * lengths[thin],
    );
    if (!Number.isFinite(extents.x + extents.y + extents.z) || extents.y < 0.001) return false;
    axis.normalize();
    normal.normalize();
    side.crossVectors(axis, normal).normalize();
    normal.crossVectors(side, axis).normalize();
    position.copy(centre).applyMatrix4(holder.matrixWorld);
    frame.makeBasis(side, axis, normal).setPosition(position);
    return true;
  };
}
