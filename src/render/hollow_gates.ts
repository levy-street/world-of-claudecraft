// The Duskfall Passage's two cave mouths: the crystal cave standing on the
// flat shelf in the northwest Thornpeak cliffs (the way IN), and the
// fantasy tree cave on the Veiled Hollow's southern wall (the way OUT).
// Both are the maintainer's generated dungeon models (the flower-bed
// fidelity recipe, build_veiled_hollow_props.mjs), placed exactly over the
// REALM_PORTALS trigger points so walking into a mouth is walking into the
// portal; sim/colliders.ts flanks each mouth from the same records. A ring
// of pink flowers marks the Thornpeak entrance.
//
// The two gate models are wide (their generated footprint runs well past the
// "compact" width the placement assumed, see the occluder footprint below),
// and their authored landings sit only ~5yd out so a portal never bounces an
// arrival straight back in. That leaves an arriving player's own camera
// standing inside the rock a step or two after landing: unlike every other
// large static prop (buildings, great trees, mine mounds, all wired into
// props.ts's `registerHideable`), the gate meshes never faded when the
// eye-to-camera segment crossed them, so the screen just stayed full of
// opaque rock until the player walked far enough away. Mirrors the same
// occluder-fade pattern dungeon.ts and yumi_maze.ts use for their own
// standalone hideables (props.ts's version is private to `buildProps`); the
// footprint itself is an ORIENTED box at the gate's real half-extents and
// authored facing, not a circumscribed circle, so the fade never triggers
// wider than the rock the camera can actually stand inside.
import * as THREE from 'three';
import { REALM_PORTALS } from '../sim/content/realm';
import { hash2 } from '../sim/rng';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { occluderSegmentHitsObb } from './occluder_fade_core';
import { flowerTuftTexture } from './textures';

interface GateOccluder {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  topY: number;
  mats: OccluderFadeMat[];
  alpha: number;
}

export interface HollowGatesView {
  group: THREE.Group;
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
}

const GATE_URLS = {
  crystal: '/models/props/hollow_gate_crystal.glb',
  tree: '/models/props/hollow_gate_tree.glb',
} as const;
type GateKey = keyof typeof GATE_URLS;
const gateScenes: Partial<Record<GateKey, THREE.Group>> = {};
for (const key of Object.keys(GATE_URLS) as GateKey[]) {
  registerDeferredPreload(() =>
    loadGltf(GATE_URLS[key]).then((gltf) => {
      gateScenes[key] = gltf.scene;
    }),
  );
}

/** Gate height in world units (a walk-in cave mouth over the 2yd trigger). */
const GATE_HEIGHT = 12;

export function buildHollowGates(seed: number): HollowGatesView {
  const group = new THREE.Group();
  group.name = 'hollow-gates';
  const occluders: GateOccluder[] = [];
  const portal = REALM_PORTALS[0];
  if (!portal) return { group, update: () => {} };

  const place = (key: GateKey, x: number, z: number, facing: number): void => {
    const scene = gateScenes[key];
    if (!scene) return;
    const gate = scene.clone(true);
    // re-base: xz-centered, feet at min-y, normalized to GATE_HEIGHT
    const box = new THREE.Box3().setFromObject(gate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = GATE_HEIGHT / Math.max(size.y, 0.001);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    // The oriented box that matches the rebased XZ footprint exactly (the
    // rebase centers the model on this box, so its half-extents are the
    // whole story; `outer.rotation.y = facing` below rotates the mesh and
    // the occluder test together, so the fade covers exactly the rock a
    // player can actually be standing inside, not just the narrow sim
    // colliders that only fence off walking around the mouth, and not a
    // looser circle that would fade the gate from angles the rock never
    // actually blocks).
    const halfW = (size.x / 2) * s;
    const halfD = (size.z / 2) * s;
    const inner = new THREE.Group();
    inner.position.set(-cx, -box.min.y, -cz);
    inner.add(gate);
    gate.position.set(0, 0, 0);
    const outer = new THREE.Group();
    outer.add(inner);
    inner.position.set(-cx * s, -box.min.y * s, -cz * s);
    inner.scale.setScalar(s);
    // Seat at the footprint MINIMUM (center + a ring under the mound's
    // base), not the center sample: the calm pad levels the bench, but the
    // classic ground still undulates ~half a yard, and a base edge hovering
    // over a dip reads as floating on a prop this wide.
    let seatY = terrainHeight(x, z, seed);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = terrainHeight(x + Math.cos(a) * 4.5, z + Math.sin(a) * 4.5, seed);
      if (h < seatY) seatY = h;
    }
    outer.position.set(x, seatY - 0.35, z);
    outer.rotation.y = facing;
    const mats: OccluderFadeMat[] = [];
    const seenMats = new Map<THREE.Material, OccluderFadeMat>();
    outer.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const src = mesh.material as THREE.Material;
      let fade = seenMats.get(src);
      if (!fade) {
        fade = occluderFadeRecordFor(mats, cloneMaterialWithHooks(src), mesh);
        seenMats.set(src, fade);
      } else {
        occluderFadeRecordFor(mats, fade.mat, mesh);
      }
      mesh.material = fade.mat;
    });
    group.add(outer);
    occluders.push({
      x,
      z,
      hw: halfW,
      hd: halfD,
      rot: facing,
      topY: seatY + GATE_HEIGHT,
      mats,
      alpha: 1,
    });
  };
  // the mouth faces the arrival landing (the direction players walk out)
  const facingOf = (side: { x: number; z: number; landing: { x: number; z: number } }): number =>
    Math.atan2(side.landing.x - side.x, side.landing.z - side.z);
  place('crystal', portal.a.x, portal.a.z, facingOf(portal.a));
  place('tree', portal.b.x, portal.b.z, facingOf(portal.b));

  // --- the pink flower ring around the Thornpeak entrance ---
  {
    const quad = new THREE.PlaneGeometry(0.95, 0.8);
    quad.translate(0, 0.38, 0);
    const quad2 = quad.clone().rotateY(Math.PI / 2);
    const tex = flowerTuftTexture(
      [
        { p: [240, 140, 190], c: [200, 90, 150] },
        { p: [244, 168, 200], c: [200, 110, 150] },
        { p: [232, 120, 176], c: [250, 220, 235] },
      ],
      true,
    );
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    for (const geo of [quad, quad2]) {
      const spots: { x: number; z: number; s: number; rot: number }[] = [];
      for (let k = 0; k < 64; k++) {
        const ang = hash2(k, 1, seed + 6101) * Math.PI * 2;
        const dist = 4 + Math.sqrt(hash2(k, 2, seed + 6111)) * 6.5;
        spots.push({
          x: portal.a.x + Math.sin(ang) * dist,
          z: portal.a.z + Math.cos(ang) * dist,
          s: 0.7 + hash2(k, 3, seed + 6121) * 0.6,
          rot: hash2(k, 4, seed + 6131) * Math.PI * 2,
        });
      }
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, terrainHeight(sp.x, sp.z, seed), sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    group,
    update(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, reducedMotion = false): void {
      // Petals never move; only the gate rock fades when it stands between
      // the eye and the camera (see the header note on why this exists).
      for (const o of occluders) {
        prefetchOccluderFadeWithin(o.mats, o.x, o.z, camX, camZ);
        const hide = occluderSegmentHitsObb(
          o.x,
          o.z,
          o.hw,
          o.hd,
          o.rot,
          o.topY,
          eyeX,
          eyeY,
          eyeZ,
          camX,
          camY,
          camZ,
        );
        o.alpha = advanceOccluderFade(o.mats, o.alpha, hide, dt, reducedMotion);
      }
    },
  };
}
