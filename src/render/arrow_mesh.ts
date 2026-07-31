// The one arrow model, shared by the nocked-in-hand prop (nocked_arrow.ts) and
// the flying projectile (arrow_projectiles.ts) so the launch hand-off reads as
// the same arrow. Procedural, authored along +Y with the nock at the origin
// (grip convention of the held-weapon models); geometry and materials are
// module singletons, every caller gets a cheap re-mesh over the shared data.
import * as THREE from 'three';

export const ARROW_LENGTH = 0.58;
const SHAFT_RADIUS = 0.016;
const HEAD_LENGTH = 0.08;
const HEAD_RADIUS = 0.032;
const FLETCH_LENGTH = 0.15;
const FLETCH_HEIGHT = 0.055;

let shaftGeo: THREE.CylinderGeometry | null = null;
let headGeo: THREE.ConeGeometry | null = null;
let fletchGeo: THREE.PlaneGeometry | null = null;
let shaftMat: THREE.MeshStandardMaterial | null = null;
let headMat: THREE.MeshStandardMaterial | null = null;
let fletchMat: THREE.MeshStandardMaterial | null = null;

function materials(): [THREE.Material, THREE.Material, THREE.Material] {
  // Bright pale shaft/fletching: the arrow must read as a fast sliver against
  // dark grass at night, so it leans lighter than a literal wood tone.
  shaftMat ??= new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.8 });
  headMat ??= new THREE.MeshStandardMaterial({
    color: 0xd8dde6,
    roughness: 0.4,
    metalness: 0.6,
  });
  fletchMat ??= new THREE.MeshStandardMaterial({
    color: 0xf3efe2,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  return [shaftMat, headMat, fletchMat];
}

/** A fresh arrow group over the shared geometry/materials. Nock at the origin,
 *  tip at +Y * ARROW_LENGTH. */
export function buildArrowMesh(): THREE.Group {
  const [shaft, head, fletch] = materials();
  shaftGeo ??= new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, ARROW_LENGTH, 5);
  headGeo ??= new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 5);
  fletchGeo ??= new THREE.PlaneGeometry(FLETCH_HEIGHT, FLETCH_LENGTH);

  const group = new THREE.Group();
  const shaftMesh = new THREE.Mesh(shaftGeo, shaft);
  shaftMesh.position.y = ARROW_LENGTH / 2;
  group.add(shaftMesh);
  const headMesh = new THREE.Mesh(headGeo, head);
  headMesh.position.y = ARROW_LENGTH - HEAD_LENGTH / 2;
  group.add(headMesh);
  for (const roll of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(fletchGeo, fletch);
    f.position.y = FLETCH_LENGTH / 2 + 0.02;
    f.rotation.y = roll;
    group.add(f);
  }
  return group;
}
