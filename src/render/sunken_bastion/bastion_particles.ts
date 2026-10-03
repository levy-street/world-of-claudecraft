// A small pooled particle kit for the Sunken Bastion's fifth-pass effects (the
// Turnkey's cage, Ossick's anchor and shackles, the reaper): soft glow puffs
// (smoke, dust, soul light, sparks) and tumbling chunks (iron shards, broken
// links, flagstone chips). Everything is built once and reused: no per-frame
// allocation. Every piece is COSMETIC (the telegraphs and chains that carry
// what a player acts on live in the owning modules), so a host on the low
// effects tier builds none of it and every call is a no-op.

import * as THREE from 'three';
import { radialGlowTexture } from '../textures';

const PUFFS = 48;
const CHUNKS = 36;

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  from: number;
  to: number;
  rise: number;
  peak: number;
  vx: number;
  vz: number;
}

interface Chunk {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  age: number;
  floor: number;
  scale: number;
}

let glowTex: THREE.Texture | null = null;

export class BastionParticles {
  private readonly puffs: Puff[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly chunkMesh: THREE.InstancedMesh | null = null;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private seed = 20260930;

  constructor(
    private readonly root: THREE.Group,
    private readonly on: boolean,
  ) {
    if (!on) return;
    glowTex ??= radialGlowTexture();
    for (let i = 0; i < PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffffff,
        opacity: 0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      root.add(sprite);
      this.puffs.push({
        sprite,
        mat,
        age: -1,
        life: 1,
        from: 1,
        to: 2,
        rise: 0,
        peak: 0.8,
        vx: 0,
        vz: 0,
      });
    }
    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    geo.scale(1.6, 0.7, 1);
    this.geometries.push(geo);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.35,
    });
    this.materials.push(mat);
    this.chunkMesh = new THREE.InstancedMesh(geo, mat, CHUNKS);
    this.chunkMesh.count = 0;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.setColorAt(0, this.c.setHex(0x333333));
    root.add(this.chunkMesh);
    for (let i = 0; i < CHUNKS; i++)
      this.chunks.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rot: new THREE.Euler(),
        age: -1,
        floor: 0,
        scale: 1,
      });
  }

  /** A deterministic presentation-only generator (never the sim's rng). */
  rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** `count` soft puffs of `color` round a point: size from -> to over `life`,
   *  drifting up `rise` yd/s and out `spread` yd/s. Additive unless `smoke`. */
  burst(
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    from: number,
    to: number,
    life: number,
    rise = 0.6,
    spread = 0,
    smoke = false,
  ): void {
    if (!this.on) return;
    for (let i = 0; i < count; i++) {
      const p = this.puffs.find((s) => s.age < 0);
      if (!p) return;
      const a = (i / Math.max(1, count)) * Math.PI * 2 + this.rand();
      const r = count > 1 ? from * 0.5 : 0;
      p.sprite.position.set(x + Math.sin(a) * r, y + this.rand() * 0.4, z + Math.cos(a) * r);
      p.mat.color.setHex(color);
      p.mat.blending = smoke ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.age = 0;
      p.life = life * (0.8 + this.rand() * 0.4);
      p.from = from;
      p.to = to;
      p.rise = rise;
      p.peak = smoke ? 0.55 : 0.9;
      p.vx = Math.sin(a) * spread;
      p.vz = Math.cos(a) * spread;
      p.sprite.visible = true;
    }
  }

  /** `count` chunks of `color` thrown up and out from a point, landing on `floor`. */
  chunksAt(
    x: number,
    y: number,
    z: number,
    floor: number,
    color: number,
    count: number,
    speed = 5,
    scale = 1,
  ): void {
    const mesh = this.chunkMesh;
    if (!this.on || !mesh) return;
    let n = 0;
    for (let i = 0; i < this.chunks.length && n < count; i++) {
      const d = this.chunks[i];
      if (d.age >= 0 && d.age < 1.6) continue;
      const a = this.rand() * Math.PI * 2;
      d.pos.set(x + Math.sin(a) * 0.4, y, z + Math.cos(a) * 0.4);
      d.vel.set(
        Math.sin(a) * speed * (0.5 + this.rand()),
        speed * (0.8 + this.rand()),
        Math.cos(a) * speed * (0.5 + this.rand()),
      );
      d.spin.set(this.rand() * 10, this.rand() * 10, this.rand() * 10);
      d.rot.set(0, 0, 0);
      d.age = 0;
      d.floor = floor;
      d.scale = scale * (0.6 + this.rand() * 0.7);
      mesh.setColorAt(i, this.c.setHex(color));
      n++;
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.on) return;
    for (const p of this.puffs) {
      if (p.age < 0) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.age = -1;
        p.sprite.visible = false;
        continue;
      }
      const size = p.from + (p.to - p.from) * (1 - (1 - k) * (1 - k));
      p.sprite.scale.set(size, size, 1);
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += p.rise * dt;
      p.mat.opacity = p.peak * Math.sin(Math.PI * Math.min(1, k * 1.15));
    }
    const mesh = this.chunkMesh;
    if (!mesh) return;
    let last = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const d = this.chunks[i];
      if (d.age < 0) {
        this.s.setScalar(0);
        this.m4.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, this.m4);
        continue;
      }
      d.age += dt;
      if (d.age > 2.2) {
        d.age = -1;
        this.m4.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, this.m4);
        continue;
      }
      d.vel.y -= 22 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < d.floor + 0.12) {
        d.pos.y = d.floor + 0.12;
        d.vel.set(d.vel.x * 0.35, Math.abs(d.vel.y) * 0.25, d.vel.z * 0.35);
        d.spin.multiplyScalar(0.5);
      }
      d.rot.set(d.rot.x + d.spin.x * dt, d.rot.y + d.spin.y * dt, d.rot.z + d.spin.z * dt);
      this.q.setFromEuler(d.rot);
      const shrink = d.age > 1.6 ? Math.max(0.01, 1 - (d.age - 1.6) / 0.6) : 1;
      this.s.setScalar(shrink * d.scale);
      this.m4.compose(d.pos, this.q, this.s);
      mesh.setMatrixAt(i, this.m4);
      last = i + 1;
    }
    mesh.count = last;
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.chunkMesh?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const p of this.puffs) this.root.remove(p.sprite);
  }
}
