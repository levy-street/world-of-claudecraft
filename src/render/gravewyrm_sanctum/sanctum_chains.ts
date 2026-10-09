// The Smith's four great chains (sanctum_chains_core.ts): from the rings on
// the seal pillars of the Lock Terrace, high over the gulf, the works, the
// vault and the shore, into the Calving Face. One InstancedMesh per kit slot
// of Kit_ChainLink (links as thick as a mast, every other one a quarter
// turn), its matrices written once at build and again only while a chain is
// falling: as the face's story counts Korgath's broken chains (stage 2), each
// tears out of the ice and swings down into the gulf, then hangs slack from
// its pillar. Render only, far above every walkway; cosmetic, every tier.

import * as THREE from 'three';
import { LOCK_TERRACE, SEAL_PILLARS } from '../../sim/content/gravewyrm_sanctum_layout';
import { sharedUniforms } from '../gfx';
import {
  CHAIN_FALL_ORDER,
  CHAIN_LINK_SCALE,
  CHAIN_PITCH,
  type ChainRun,
  chainPath,
  chainSag,
  linksAlong,
  PILLAR_SCALE,
  planChainRuns,
  runLength,
} from './sanctum_chains_core';
import { chainFall, FACE_EVENT_SECONDS } from './sanctum_face_core';
import {
  registerSanctumFallback,
  SANCTUM_SLOTS,
  sanctumKitMeshes,
  sanctumPieceGeometry,
  sanctumSlotMaterial,
} from './sanctum_kit';
import { chainLinkGeometry } from './sanctum_shapes';
import { newSanctumStoryView, sanctumSlotKey, sanctumStoryView } from './sanctum_story_core';

registerSanctumFallback('Kit_ChainLink', () => [
  { slot: 'stone', g: chainLinkGeometry(9.8, 1.15), rgb: [0.05, 0.052, 0.058] },
]);

const X = new THREE.Vector3(1, 0, 0);
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpRoll = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const LINK_SCALE = new THREE.Vector3(CHAIN_LINK_SCALE, CHAIN_LINK_SCALE, CHAIN_LINK_SCALE);
const tmpM = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Build the chains of the slot anchored at (ox, oz). Returns the group and
 *  its per-frame driver (called by the sky's frame hook every frame). */
export function buildSanctumChains(
  ox: number,
  oz: number,
): { group: THREE.Group; update: () => void } {
  const key = sanctumSlotKey(ox, oz);
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumChains';
  const runs = planChainRuns();
  const counts = runs.map((r) => Math.ceil(runLength(r, chainSag(r)) / CHAIN_PITCH) + 1);
  const total = counts.reduce((a, b) => a + b, 0);
  const starts = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + b, 0));
  const geo = sanctumPieceGeometry('Kit_ChainLink');
  const meshes: THREE.InstancedMesh[] = [];
  for (const slot of SANCTUM_SLOTS) {
    const g = geo[slot];
    if (!g) continue;
    const mesh = new THREE.InstancedMesh(g, sanctumSlotMaterial(slot), total);
    mesh.name = `gravewyrmSanctumChainLinks:${slot}`;
    // The runs span the whole cirque: never culled by their build bounds.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = slot === 'stone';
    meshes.push(mesh);
    group.add(mesh);
  }
  // The four seal pillars (intact until their chain tears out of the face,
  // then cracked: the kit's Kit_SealPillarCracked_*).
  const pillars = SEAL_PILLARS.map((p) => {
    const tool = p.id.charAt(0).toUpperCase() + p.id.slice(1);
    const holder = new THREE.Group();
    holder.name = `sealPillar:${p.id}`;
    holder.position.set(p.x, LOCK_TERRACE.h, p.z);
    holder.rotation.y = Math.atan2(LOCK_TERRACE.x - p.x, LOCK_TERRACE.z - p.z);
    holder.scale.setScalar(PILLAR_SCALE);
    const intact = sanctumKitMeshes(`Kit_SealPillar_${tool}`);
    const cracked = sanctumKitMeshes(`Kit_SealPillarCracked_${tool}`);
    cracked.visible = false;
    holder.add(intact, cracked);
    group.add(holder);
    return { intact, cracked };
  });
  const lastK = runs.map(() => -1);
  const write = (run: ChainRun, i: number, k: number) => {
    const path = chainPath(run, k, 48);
    const links = linksAlong(path);
    for (let n = 0; n < counts[i]; n++) {
      const link = links[n];
      if (!link || link.p[1] < -95) {
        for (const m of meshes) m.setMatrixAt(starts[i] + n, HIDDEN);
        continue;
      }
      tmpDir.set(link.dir[0], link.dir[1], link.dir[2]);
      tmpQ.setFromUnitVectors(X, tmpDir);
      tmpRoll.setFromAxisAngle(X, link.roll);
      tmpQ.multiply(tmpRoll);
      tmpP.set(link.p[0], link.p[1], link.p[2]);
      tmpM.compose(tmpP, tmpQ, LINK_SCALE);
      for (const m of meshes) m.setMatrixAt(starts[i] + n, tmpM);
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    lastK[i] = k;
  };
  const view = newSanctumStoryView();
  let stamp = Number.NaN;
  const update = (): void => {
    const t = sharedUniforms.uTime.value;
    if (t === stamp) return;
    stamp = t;
    const v = sanctumStoryView(key, t, view);
    for (let c = 0; c < 4; c++) {
      const i = CHAIN_FALL_ORDER[c];
      const since = v.chainSince[c];
      const k = since < 0 ? 0 : since >= FACE_EVENT_SECONDS.chainFall ? 1 : chainFall(since);
      if (k !== lastK[i]) write(runs[i], i, k);
      pillars[i].intact.visible = since < 0;
      pillars[i].cracked.visible = since >= 0;
    }
  };
  update();
  return { group, update };
}
