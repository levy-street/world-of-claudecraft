// The shared SOAK tell's pool (the plan: floor_tell_core.ts, soak_marker_core.ts):
// a fixed pool of shared soak markers (soak_marker.ts: the element's vortex,
// the crisp rim, rings converging on the middle, inward chevrons, wisps
// rising, and a pip round its rim for every player the soak needs, lit one
// per player inside), laid over an owner's share footprints. A marker blooms
// in and is drawn back into the middle as it goes: owners call `settle`
// every frame. Built once by the OWNER in its constructor under its gated
// root (no GPU work after boot), no light, no per-frame allocation. Every tier
// draws it whole (it is the mechanic's information); reduced motion holds
// its motion still.
//
// (The 2026-11-25 keep-out "avoid" disc is gone: the owner's call of
// 2026-11-26 put every keep-out mechanic back on its own painted footprint.)

import type * as THREE from 'three';
import { buildSoakMarkerGeometry, SoakMarker, type SoakMarkerPaint } from './soak_marker';
import type { SoakElement } from './soak_marker_core';

export interface FloorTellPaint {
  x: number;
  /** The FLOOR height under it. */
  y: number;
  z: number;
  /** The sim's radius (yards): the rim. */
  radius: number;
  /** The soak's element (the marker's palette). Default earth. */
  element?: SoakElement;
  /** The mark's fill (0 laid, 1 landing). */
  fill: number;
  clock: number;
  reduced: boolean;
  /** The players it needs and how many stand inside. */
  need?: number;
  have?: number;
  /** Draw the marker's own rim (off where the owner draws one, the rock's
   *  countdown rim). Default on. */
  rim?: boolean;
  /** The tier's detail (0 low .. 1 full): the wisps' count only. */
  detail?: number;
  /** A countdown arc, the bar's progress (0..1), or none. */
  timer?: number | null;
  /** Where the pips sit (a share of the radius; default the rim's). */
  pipAt?: number;
}

/** The marker's frame, reused (no per-frame allocation). */
const _soak: SoakMarkerPaint = {
  x: 0,
  y: 0,
  z: 0,
  radius: 1,
  element: 'earth',
  fill: 0,
  clock: 0,
  reduced: false,
};

/** A fixed pool of shared soak markers. */
export class FloorTellPool {
  private readonly slots: SoakMarker[] = [];

  /** `rung`: the owner's floor ladder rung (over its footprint's fill). The
   *  pool's markers share one wisp mesh, so they share one `detail`: an owner
   *  passes its one tier density to every slot. */
  constructor(
    root: THREE.Object3D,
    size: number,
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
    rung = 26,
  ) {
    const geo = buildSoakMarkerGeometry(geometries);
    for (let i = 0; i < size; i++) {
      const soak = new SoakMarker(geo, materials, rung, 'floorTellSoak');
      root.add(soak.group);
      this.slots.push(soak);
    }
  }

  get size(): number {
    return this.slots.length;
  }

  /** Lay marker `i` (call every frame it shows). */
  paint(i: number, p: FloorTellPaint): void {
    const s = this.slots[i];
    if (!s) return;
    const q = _soak;
    q.x = p.x;
    q.y = p.y;
    q.z = p.z;
    q.radius = p.radius;
    q.element = p.element ?? 'earth';
    q.fill = p.fill;
    q.clock = p.clock;
    q.reduced = p.reduced;
    q.need = p.need;
    q.have = p.have;
    q.rim = p.rim;
    q.detail = p.detail;
    q.timer = p.timer;
    q.pipAt = p.pipAt;
    s.paint(q);
  }

  /** Marker `i`'s mark is gone: it plays its decay (advanced by `settle`). */
  hide(i: number): void {
    this.slots[i]?.release();
  }

  /** Advance the markers' decays (owners call it every frame). */
  settle(clock: number): void {
    for (const s of this.slots) s.settle(clock);
  }

  /** Hide every marker at once, no decay (a wipe, the fight's end). */
  hideAll(): void {
    for (const s of this.slots) s.hide();
  }

  /** Is marker `i` showing (the tests read it)? A decaying one still is. */
  shown(i: number): boolean {
    return this.slots[i]?.shown ?? false;
  }

  /** Its disc's uniforms (the tests read the count). */
  uniformsOf(i: number): Record<string, THREE.IUniform> | null {
    return this.slots[i]?.discMat.uniforms ?? null;
  }
}
