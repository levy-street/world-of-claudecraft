// The Sanctum's ice shards: one instanced draw of faceted glacier ice (and a
// few dark rune-iron flecks) thrown ballistically by the Ice Block Toss's
// crash, a Glacier Splinter's Shatter and the Tusker's sweep and charge. A
// fixed pool, coloured per instance; each shard tumbles, lands on the floor
// under it, lies a moment and melts away. Lent to the creature layers through
// SanctumFxHost.shards.
//
// Cosmetic only (src/render/CLAUDE.md): built once under the host's root before
// its gated attach; the CPU writes matrices only while a shard is live; no
// per-frame allocation; no light.

import * as THREE from 'three';
import { surfaceMat } from '../gfx';
import { SHARD_GRAVITY, SHARD_REST } from './sanctum_fx_core';

export interface ShardBurst {
  /** Outward speed (yards a second) and the upward kick. */
  speed: number;
  up: number;
  /** Shard length range (yards). */
  size: readonly [number, number];
  /** Scatter the births over a disc of this radius. */
  radius?: number;
  /** Throw them along this ground heading (radians, sim convention) within
   *  `spread` radians either side; omitted: all round. */
  heading?: number;
  spread?: number;
  /** A share of dark rune-iron flecks among the ice (0..1). */
  iron?: number;
}

const ICE = new THREE.Color(0xdff4ff);
const ICE_DEEP = new THREE.Color(0x8cc8ec);
const IRON = new THREE.Color(0x3a3d48);

export class SanctumShards {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly axis: Float32Array;
  private readonly angle: Float32Array;
  private readonly spin: Float32Array;
  private readonly len: Float32Array;
  private readonly floor: Float32Array;
  private readonly timer: Float32Array;
  /** 0 dead, 1 flying, 2 resting, 3 melting. */
  private readonly state: Uint8Array;
  private cursor = 0;
  private live = 0;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();

  constructor(
    root: THREE.Group,
    readonly capacity: number,
    private readonly groundY: (x: number, z: number) => number,
    private readonly rand: () => number,
  ) {
    // A long, faceted splinter: an octahedron drawn out along y.
    this.geo = new THREE.OctahedronGeometry(0.5, 0).scale(0.42, 1, 0.3);
    this.geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(
      this.geo,
      surfaceMat({
        color: 0xffffff,
        roughness: 0.18,
        metalness: 0.05,
        emissive: 0x1d4a66,
        flatShading: true,
      }),
      capacity,
    );
    this.mesh.name = 'sanctumIceShards';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, ICE);
      this.mesh.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0));
    }
    root.add(this.mesh);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.axis = new Float32Array(capacity * 3);
    this.angle = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.len = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    this.timer = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);
  }

  /** Throw `n` shards from (x, y, z). */
  burst(x: number, y: number, z: number, n: number, o: ShardBurst): void {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if (this.state[i] === 0) this.live++;
      const a =
        o.heading !== undefined
          ? o.heading + (this.rand() - 0.5) * 2 * (o.spread ?? 0.6)
          : this.rand() * Math.PI * 2;
      const r = o.radius ? Math.sqrt(this.rand()) * o.radius : 0;
      const ra = this.rand() * Math.PI * 2;
      const sp = o.speed * (0.45 + this.rand() * 0.9);
      this.pos[i * 3] = x + Math.cos(ra) * r;
      this.pos[i * 3 + 1] = y + this.rand() * 0.4;
      this.pos[i * 3 + 2] = z + Math.sin(ra) * r;
      // Sim heading: forward is (sin a, cos a).
      this.vel[i * 3] = Math.sin(a) * sp;
      this.vel[i * 3 + 1] = o.up * (0.55 + this.rand() * 0.8);
      this.vel[i * 3 + 2] = Math.cos(a) * sp;
      const ax = this.rand() - 0.5;
      const ay = this.rand() - 0.5;
      const az = this.rand() - 0.5;
      const al = Math.hypot(ax, ay, az) || 1;
      this.axis[i * 3] = ax / al;
      this.axis[i * 3 + 1] = ay / al;
      this.axis[i * 3 + 2] = az / al;
      this.angle[i] = this.rand() * Math.PI * 2;
      this.spin[i] = (this.rand() - 0.5) * 16;
      this.len[i] = o.size[0] + this.rand() * (o.size[1] - o.size[0]);
      this.floor[i] = this.groundY(this.pos[i * 3], this.pos[i * 3 + 2]);
      this.timer[i] = 0;
      this.state[i] = 1;
      const iron = this.rand() < (o.iron ?? 0);
      this.mesh.setColorAt(i, iron ? IRON : this.tmpC.copy(ICE).lerp(ICE_DEEP, this.rand() * 0.6));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.live <= 0) {
      this.mesh.visible = false;
      return;
    }
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < this.capacity; i++) {
      const s = this.state[i];
      if (s === 0) continue;
      let shrink = 1;
      if (s === 1) {
        this.vel[i * 3 + 1] -= SHARD_GRAVITY * step;
        this.pos[i * 3] += this.vel[i * 3] * step;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * step;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * step;
        this.angle[i] += this.spin[i] * step;
        const floor = this.floor[i] + this.len[i] * 0.12;
        if (this.pos[i * 3 + 1] <= floor && this.vel[i * 3 + 1] < 0) {
          this.pos[i * 3 + 1] = floor;
          // One skid along the ice, then it settles.
          if (Math.abs(this.vel[i * 3 + 1]) > 4) {
            this.vel[i * 3 + 1] *= -0.25;
            this.vel[i * 3] *= 0.45;
            this.vel[i * 3 + 2] *= 0.45;
            this.spin[i] *= 0.5;
          } else {
            this.state[i] = 2;
            this.timer[i] = 0;
          }
        }
      } else {
        this.timer[i] += step;
        if (s === 2 && this.timer[i] > SHARD_REST) {
          this.state[i] = 3;
          this.timer[i] = 0;
        }
        if (this.state[i] === 3) {
          shrink = 1 - this.timer[i] / 0.6;
          if (shrink <= 0) {
            this.state[i] = 0;
            this.live--;
            this.mesh.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0));
            continue;
          }
        }
      }
      this.tmpAxis.set(this.axis[i * 3], this.axis[i * 3 + 1], this.axis[i * 3 + 2]);
      this.tmpQ.setFromAxisAngle(this.tmpAxis, this.angle[i]);
      this.tmpPos.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      const l = this.len[i] * shrink;
      this.tmpScale.set(l, l, l);
      this.mesh.setMatrixAt(i, this.tmpM.compose(this.tmpPos, this.tmpQ, this.tmpScale));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hideAll(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] === 0) continue;
      this.state[i] = 0;
      this.mesh.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0));
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    // The instance buffers are the mesh's own (the material is the shared
    // surfaceMat cache's: never disposed here).
    this.mesh.dispose();
    this.geo.dispose();
  }
}
