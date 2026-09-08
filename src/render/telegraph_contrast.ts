import * as THREE from 'three';

/** A restrained dark bed under an exact gameplay footprint. Additive fire can
 * bloom over it without erasing the border against a pale floor or another cast.
 * Built with the owning telegraph, so the normal reveal/prewarm gate sees it. */
export function addTelegraphContrast(
  root: THREE.Object3D,
  fill: THREE.Mesh,
  border: THREE.Mesh,
): void {
  const bed = new THREE.Mesh(
    fill.geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: 0x08101a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    }),
  );
  bed.name = `${fill.name}Contrast`;
  bed.renderOrder = fill.renderOrder - 1;
  bed.position.copy(fill.position);
  bed.position.y -= 0.001;
  // Keep the dangerous/safe boundary readable without expanding its geometry.
  const material = border.material as THREE.Material;
  material.blending = THREE.NormalBlending;
  root.add(bed);
}
