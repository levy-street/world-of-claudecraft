// The heart seal on the Seal Dais: the ring crystal (ring_crystal.ts, planned by
// ring_crystal_core.ts; the timelines are heart_seal_core.ts's and heart_portal_core.ts's)
// and what a vein's light does as it reaches it. The owner's ask of 2026-11-18: ONE crystal
// that holds the four elements, a connection that lights up, in place of the four granite
// quarters and the four spires round them.
//   - the crystal: the Tripo model of the four elements round a white-gold heart. Dark until
//     its element's vein lights; when the river reaches the seal the element's crystal
//     CLIMBS from the plinth's channel behind a white-hot front, the heart glowing as the
//     four fill; once all four burn and the Ring is clear it swells, ready to be broken;
//     when a player breaks it (the portal bit) it overloads and shatters, its pieces
//     bursting out and the crystal's tumbling on into an orbit round the portal for good
//     (ring_crystal_core.ts), the portal's flash, shockwave and vortex growing out of the
//     place it stood (heart_portal.ts draws those);
//   - the arrival: where a vein's light reaches the plinth a column of its colour stands up
//     off the channel and a shockwave of its colour runs out across the chasm to the Ring.
// Drawn on every tier (the raid's progress and the way). The crystal's material and the
// columns' and waves' are the slot's (their uniforms are the slot's state), built with the
// interior; the frame driver writes uniforms and matrices only while they change.

import * as THREE from 'three';
import {
  HEART_SEAL,
  SEAL_DAIS,
  SMITH_HEART_VEIN_COLORS,
} from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { markSharedGeometry } from '../shared_resource';
import { heartBeamMaterial, heartRingMaterial } from './heart_fx_materials';
import { HEART_PORTAL_RING_REACH } from './heart_portal_core';
import {
  HEART_SEAL_QUARTERS,
  type HeartSealView,
  heartSealArrivalWave,
  heartSealColumn,
} from './heart_seal_core';
import { buildRingCrystal } from './ring_crystal';
import { newRingCrystalState, RING_CRYSTAL, ringCrystalState } from './ring_crystal_core';

/** The plinth sinks a breath into the dais so it never floats over it. */
const PLINTH_SINK = 0.05;
/** The arrival column: where it stands on its element's side (just past the plinth, at
 *  the mouth of the channel its light arrives in) and its size. */
const COLUMN = { r: RING_CRYSTAL.plinthR + 1, foot: 2.4, top: 0.7, height: 24 } as const;

let columnGeometry: THREE.BufferGeometry | null = null;
let discGeometry: THREE.BufferGeometry | null = null;

interface Arrival {
  column: THREE.Mesh;
  columnMat: THREE.ShaderMaterial;
  wave: THREE.Mesh;
  waveMat: THREE.ShaderMaterial;
  /** The last written state (column, wave). */
  last: Float32Array;
}

export interface HeartSeal {
  group: THREE.Group;
  update(view: HeartSealView): void;
}

/** The seal of one slot (instance-local). */
export function buildHeartSeal(): HeartSeal {
  const group = new THREE.Group();
  group.name = 'smithHeartSeal';
  const y = SEAL_DAIS.h;
  columnGeometry ??= markSharedGeometry(
    new THREE.CylinderGeometry(COLUMN.top, COLUMN.foot, COLUMN.height, 20, 1, true).translate(
      0,
      COLUMN.height / 2,
      0,
    ),
  );
  discGeometry ??= markSharedGeometry(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2));
  const arrivals: Arrival[] = HEART_SEAL_QUARTERS.map((q) => {
    const bearing = (q.bearingDeg * Math.PI) / 180;
    const dirX = Math.sin(bearing);
    const dirZ = Math.cos(bearing);
    const color = SMITH_HEART_VEIN_COLORS[q.vein];
    const columnMat = heartBeamMaterial(color, `smithHeartSealColumn:${q.vein}`);
    const column = new THREE.Mesh(columnGeometry as THREE.BufferGeometry, columnMat);
    column.name = `sealColumn:${q.vein}`;
    column.position.set(HEART_SEAL.x + dirX * COLUMN.r, y, HEART_SEAL.z + dirZ * COLUMN.r);
    column.visible = false;
    group.add(column);
    // The arrival's shockwave, in the vein's colour, out across the chasm to the Ring at
    // the Ring's height (it reads from every point of it).
    const waveMat = heartRingMaterial(`smithHeartSealWave:${q.vein}`, color);
    const wave = new THREE.Mesh(discGeometry as THREE.BufferGeometry, waveMat);
    wave.scale.set(HEART_PORTAL_RING_REACH, 1, HEART_PORTAL_RING_REACH);
    wave.position.set(HEART_SEAL.x, 0.16, HEART_SEAL.z);
    wave.renderOrder = floorVfxRenderOrder('ground', 7);
    wave.name = `sealWave:${q.vein}`;
    wave.visible = false;
    group.add(wave);
    return { column, columnMat, wave, waveMat, last: new Float32Array(2).fill(-1) };
  });

  const crystal = buildRingCrystal();
  crystal.group.position.set(HEART_SEAL.x, y - PLINTH_SINK, HEART_SEAL.z);
  group.add(crystal.group);
  const state = newRingCrystalState();

  return {
    group,
    update(view) {
      for (let i = 0; i < arrivals.length; i++) {
        const a = arrivals[i];
        const since = view.since[i];
        const column = Math.round(heartSealColumn(since) * 64) / 64;
        const wave = Math.round(heartSealArrivalWave(since) * 400) / 400;
        // Quantized: a steady seal writes nothing.
        if (a.last[0] === column && a.last[1] === wave) continue;
        a.last[0] = column;
        a.last[1] = wave;
        a.columnMat.uniforms.uK.value = column * 1.6;
        a.column.visible = column > 0;
        a.wave.visible = wave > 0;
        a.waveMat.uniforms.uR.value = wave;
        a.waveMat.uniforms.uK.value = wave > 0 ? 3.2 * (1 - wave * 0.5) : 0;
      }
      ringCrystalState(view.since, view.readySince, view.portalSince, state);
      crystal.update(state);
    },
  };
}
