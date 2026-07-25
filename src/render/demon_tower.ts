// The Demon Tower's centrepiece: the Demon Core that stands at the middle of
// every arena floor and tears the waves out of the rift.
//
// A sibling module the rift prop factory delegates to, not another case block
// grown inside door_portal.ts. The GLB is the generated `demon_core` prop (Tripo
// prop lane, see CREDITS.md); when it has not finished loading, or on the low
// graphics tier, a procedural stand-in of the same silhouette and the same
// footprint is drawn instead, so the core is NEVER invisible and never changes
// size between tiers.
//
// Graphics-settings fairness: every tier draws the core at the same position and
// the same radius as the collider the sim gives it (DEMON_TOWER_CORE_RADIUS).
// The low tier sheds the pulsing glow shell and the ember light, which are pure
// decoration; it never sheds the body, because the body is a solid obstacle the
// raid positions around and hiding it would hide actionable information.

import * as THREE from 'three';
import { DEMON_TOWER_CORE_RADIUS } from '../sim/rift/tower_scaling';
import { loadGltf } from './assets/loader';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const CORE_URL = '/models/props/demon_core.glb';
/** World-unit height the model is fitted to (the height it was generated at). */
const CORE_HEIGHT = 6.0;

type Gltf = Awaited<ReturnType<typeof loadGltf>>;
let coreGltf: Gltf | null = null;
let corePending: Promise<void> | null = null;

/** Load the core model once. Lazy: an authored tower floor is rare, so paying
 * this preload at every boot would be wasteful. Safe to call repeatedly. */
export function ensureDemonTowerAssets(): Promise<void> {
  if (coreGltf) return Promise.resolve();
  if (!corePending) {
    corePending = loadGltf(CORE_URL)
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          markSharedGeometry(mesh.geometry);
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach(markSharedMaterial);
          else markSharedMaterial(mat);
        });
        coreGltf = gltf;
      })
      .catch(() => {
        // A missing asset must never break the floor: the procedural stand-in
        // below carries the same silhouette and the same footprint.
        coreGltf = null;
      });
  }
  return corePending;
}

/** Scale a loaded GLB so its tallest axis matches `height`, base on the ground. */
function fitted(gltf: Gltf, height: number): THREE.Object3D {
  const root = gltf.scene.clone(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tall = Math.max(size.y, 1e-4);
  const scale = height / tall;
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;
  return root;
}

/** The procedural stand-in: a flared trunk under a bulbous pod, matching the
 * generated model's read closely enough that a player never sees a different
 * object, only a simpler one. */
function proceduralCore(): THREE.Object3D {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(DEMON_TOWER_CORE_RADIUS * 0.45, DEMON_TOWER_CORE_RADIUS, 3.4, 10, 1),
    new THREE.MeshStandardMaterial({ color: 0x5a3126, roughness: 0.9, metalness: 0 }),
  );
  trunk.position.y = 1.7;
  group.add(trunk);
  const pod = new THREE.Mesh(
    new THREE.SphereGeometry(DEMON_TOWER_CORE_RADIUS * 0.78, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xb3241a,
      emissive: 0xff4a12,
      emissiveIntensity: 0.7,
      roughness: 0.6,
    }),
  );
  pod.position.y = 4.4;
  pod.scale.set(1, 1.2, 1);
  group.add(pod);
  return group;
}

/**
 * Build the Demon Core body for a `rift_tower_core` ground object.
 *
 * `portal` is the pulsing glow shell the renderer already spins/pulses for other
 * rift props, so the core breathes with no per-frame work of its own here.
 */
export function buildDemonTowerCore(lowGfx: boolean): {
  body: THREE.Group;
  portal?: THREE.Mesh;
} {
  const body = new THREE.Group();
  void ensureDemonTowerAssets();

  body.add(coreGltf ? fitted(coreGltf, CORE_HEIGHT) : proceduralCore());

  if (lowGfx) return { body };

  // Decoration only, shed on the low tier: a translucent heat shell around the
  // pod. It carries no information a player acts on (the core is never a target
  // and never moves), so dropping it is graphics-fairness safe.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(DEMON_TOWER_CORE_RADIUS * 1.05, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  shell.position.y = 4.4;
  body.add(shell);

  return { body, portal: shell };
}

/** Render height the entity is drawn at, so the nameplate and pick radius sit
 * on the real model rather than a default. */
export const DEMON_TOWER_CORE_RENDER_HEIGHT = CORE_HEIGHT;
