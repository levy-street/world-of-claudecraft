import * as THREE from 'three';

/** Click the anvil already baked into the blacksmith, without drawing a duplicate. */
export function buildForgeAnvilTarget(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  // Pool reuse assigns a cosmetic yaw, so the pick volume must be rotation invariant.
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.35);
  const inverse = new THREE.Matrix4();
  const ray = new THREE.Ray();
  const point = new THREE.Vector3();
  group.raycast = (raycaster, hits) => {
    inverse.copy(group.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inverse);
    if (!ray.intersectSphere(bounds, point)) return;
    point.applyMatrix4(group.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    hits.push({ distance, point: point.clone(), object: group });
  };
  return { group, height: 1.8 };
}

/** Click the existing town well in Wyrmwatch, without drawing a duplicate small well. */
export function buildForgeWellTarget(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 2.0);
  const inverse = new THREE.Matrix4();
  const ray = new THREE.Ray();
  const point = new THREE.Vector3();
  group.raycast = (raycaster, hits) => {
    inverse.copy(group.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inverse);
    if (!ray.intersectSphere(bounds, point)) return;
    point.applyMatrix4(group.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    hits.push({ distance, point: point.clone(), object: group });
  };
  return { group, height: 2.5 };
}
