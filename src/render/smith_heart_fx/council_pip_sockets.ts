// The Hammer Council's pillar pips as carved stone sockets (plan:
// council_fx_core.ts pillarPips; docs/design/raid/smith_heart.md 5.18), a part
// of CouncilPillarsFx: round every pillar's foot, one socket of dressed stone
// per piece it started with, set into the floor where its arc of the pip ring
// lies, each holding a gem of light: lit (the vein's ochre, or a soul pillar's
// own colour), spent (a dark cracked stone), the last one throbbing, a flash
// when one is lost. Readable on every tier: the floor ring stays under them
// (its arcs are the same count), the sockets and the gems are two instanced
// draws with no light and no per-frame allocation.

import * as THREE from 'three';
import { surfaceMat } from '../gfx';

/** At most three sockets a pillar (a soul pillar's pips). */
const PER = 3;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _spent = new THREE.Color(0x2c241c);

export class CouncilPipSockets {
  private readonly sockets: THREE.InstancedMesh;
  private readonly gems: THREE.InstancedMesh;
  private readonly used: Uint8Array;

  constructor(
    root: THREE.Group,
    private readonly slots: number,
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ) {
    const n = slots * PER;
    // A dressed octagonal socket stone, its cup a little sunk.
    const socketGeo = new THREE.CylinderGeometry(0.6, 0.74, 0.42, 8, 1).translate(0, 0.15, 0);
    const gemGeo = new THREE.OctahedronGeometry(0.36, 0).scale(1, 1.5, 1);
    geometries.push(socketGeo, gemGeo);
    const socketMat = surfaceMat({ color: 0xa79c8a, roughness: 0.88, flatShading: true });
    const gemMat = new THREE.MeshBasicMaterial({ name: 'smithHeartPipGem', toneMapped: false });
    materials.push(socketMat, gemMat);
    this.sockets = new THREE.InstancedMesh(socketGeo, socketMat, n);
    this.sockets.name = 'smithHeartPipSockets';
    this.gems = new THREE.InstancedMesh(gemGeo, gemMat, n);
    this.gems.name = 'smithHeartPipGems';
    for (const mesh of [this.sockets, this.gems]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
    }
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.sockets.setMatrixAt(i, _m);
      this.gems.setMatrixAt(i, _m);
      this.gems.setColorAt(i, _spent);
    }
    this.used = new Uint8Array(slots);
  }

  /**
   * Pillar slot `slot`'s sockets this frame round (x, y, z): `count` of them on
   * a ring of `radius` (each where its arc of the floor ring lies), `lit` of
   * them burning in `hex`, a `flash` (0 to 1) after a loss, the clock for the
   * last one's throb.
   */
  paint(
    slot: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    count: number,
    lit: number,
    hex: number,
    flash: number,
    clock: number,
  ): void {
    const n = Math.max(0, Math.min(PER, count));
    for (let k = 0; k < PER; k++) {
      const i = slot * PER + k;
      if (k >= n) {
        if (k < this.used[slot]) {
          _m.makeScale(0, 0, 0);
          this.sockets.setMatrixAt(i, _m);
          this.gems.setMatrixAt(i, _m);
        }
        continue;
      }
      // The arc k's centre (the floor ring's own layout: council_pillars_fx PIP_FRAG).
      const a = Math.PI * 2 * ((k + 0.5) / n - 0.5);
      const sx = x + Math.sin(a) * radius;
      const sz = z + Math.cos(a) * radius;
      _q.setFromAxisAngle(_up, a + Math.PI / 8);
      _p.set(sx, y, sz);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      this.sockets.setMatrixAt(i, _m);
      const on = k < lit;
      const last = on && lit === 1 && n > 1;
      const throb = last ? 0.82 + 0.18 * Math.sin(clock * 7) : 1;
      const lift = on ? 0.72 + 0.06 * Math.sin(clock * 2.2 + k) : 0.42;
      const size = on ? (1 + flash * 0.35) * throb : 0.78;
      _q.setFromAxisAngle(_up, on ? clock * 0.8 + k : k * 1.3);
      _p.set(sx, y + lift, sz);
      _s.set(size, on ? size : size * 0.6, size);
      _m.compose(_p, _q, _s);
      this.gems.setMatrixAt(i, _m);
      if (on) _c.setHex(hex).multiplyScalar((1 + flash * 1.5) * (0.75 + 0.25 * throb));
      else _c.copy(_spent);
      this.gems.setColorAt(i, _c);
    }
    this.used[slot] = n;
    this.sockets.instanceMatrix.needsUpdate = true;
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
  }

  /** Slot `slot` has no pillar standing: its sockets go. */
  hide(slot: number): void {
    if (this.used[slot] === 0) return;
    _m.makeScale(0, 0, 0);
    for (let k = 0; k < PER; k++) {
      this.sockets.setMatrixAt(slot * PER + k, _m);
      this.gems.setMatrixAt(slot * PER + k, _m);
    }
    this.used[slot] = 0;
    this.sockets.instanceMatrix.needsUpdate = true;
    this.gems.instanceMatrix.needsUpdate = true;
  }

  /** How many slots the sockets are sized for. */
  get capacity(): number {
    return this.slots;
  }
}
