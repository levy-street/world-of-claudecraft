// Persistent Ring of Frost presentation. Both edges of the dangerous annulus
// are terrain-draped, while instanced ice shards and frost motes make the trap
// read from combat camera height without changing its authoritative geometry.

import * as THREE from 'three';
import type { ActiveFrostRing } from '../world_api';

const RING_SEGMENTS = 80;
const SHARD_COUNT = 30;
const MOTE_COUNT = 64;
const GROW_SECONDS = 0.35;
const FADE_SECONDS = 0.7;
// Per-role material pool cap: generous headroom over any plausible concurrent
// ring count so a pool bounds memory without ever binding in normal play.
const MAX_POOL_SIZE = 32;

export interface RingOfFrostSpawn {
  x: number;
  z: number;
  radius: number;
  innerRadius: number;
  duration: number;
}

interface ShardBase {
  x: number;
  z: number;
  groundY: number;
  angle: number;
  height: number;
  width: number;
  phase: number;
}

interface RingVisual {
  root: THREE.Group;
  outerMat: THREE.LineBasicMaterial;
  innerMat: THREE.LineBasicMaterial;
  bandMat: THREE.MeshBasicMaterial;
  shardMat: THREE.MeshStandardMaterial;
  moteMat: THREE.PointsMaterial;
  shards: THREE.InstancedMesh;
  shardBases: ShardBase[];
  shardDummy: THREE.Object3D;
  ownedGeometries: THREE.BufferGeometry[];
  duration: number;
  elapsed: number;
  lastSnapshotRemaining: number;
}

export class RingOfFrostVisuals {
  private readonly rings = new Map<string, RingVisual>();
  private shardGeometry: THREE.ConeGeometry | null = null;
  private nextLocalId = 1;
  // Per-role free lists: a disposed ring's materials are returned here
  // instead of being disposed, and popped by the next ring instead of
  // constructed fresh (Ring of Frost can be up concurrently in mage-heavy
  // fights, spawning and expiring in bursts).
  private readonly outerPool: THREE.LineBasicMaterial[] = [];
  private readonly innerPool: THREE.LineBasicMaterial[] = [];
  private readonly bandPool: THREE.MeshBasicMaterial[] = [];
  private readonly shardMatPool: THREE.MeshStandardMaterial[] = [];
  private readonly motePool: THREE.PointsMaterial[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  spawn(opts: RingOfFrostSpawn): void {
    this.create(`local:${this.nextLocalId++}`, { ...opts, remaining: opts.duration });
  }

  sync(activeRings: readonly ActiveFrostRing[]): void {
    const activeIds = new Set<string>();
    for (const state of activeRings) {
      activeIds.add(state.id);
      const existing = this.rings.get(state.id);
      if (!existing) {
        this.create(state.id, state);
        continue;
      }
      if (existing.lastSnapshotRemaining !== state.remaining) {
        existing.duration = Math.max(0.1, state.duration);
        existing.elapsed = Math.max(0, existing.duration - state.remaining);
        existing.lastSnapshotRemaining = state.remaining;
        this.animate(existing);
      }
    }
    for (const [id, ring] of this.rings) {
      if (id.startsWith('local:') || activeIds.has(id)) continue;
      this.disposeRing(ring);
      this.rings.delete(id);
    }
  }

  private create(id: string, opts: RingOfFrostSpawn & { remaining: number }): void {
    const radius = Math.max(0.5, opts.radius);
    const innerRadius = Math.max(0, Math.min(radius - 0.1, opts.innerRadius));
    const root = new THREE.Group();
    root.name = 'ring-of-frost-fx';

    const outerGeometry = this.buildEdgeGeometry(opts.x, opts.z, radius);
    const innerGeometry = this.buildEdgeGeometry(opts.x, opts.z, innerRadius);
    const outerMat = this.acquireEdgeMat(this.outerPool, 0.9);
    const innerMat = this.acquireEdgeMat(this.innerPool, 0.7);
    const outer = new THREE.LineLoop(outerGeometry, outerMat);
    outer.name = 'ring-of-frost-outer-edge';
    outer.renderOrder = 9;
    const inner = new THREE.LineLoop(innerGeometry, innerMat);
    inner.name = 'ring-of-frost-inner-edge';
    inner.renderOrder = 9;
    root.add(outer, inner);

    const bandGeometry = this.buildBandGeometry(opts.x, opts.z, innerRadius, radius);
    const bandMat = this.acquireBandMat();
    const band = new THREE.Mesh(bandGeometry, bandMat);
    band.name = 'ring-of-frost-band';
    band.renderOrder = 7;
    root.add(band);

    this.shardGeometry ??= new THREE.ConeGeometry(0.3, 1.4, 5, 1);
    const shardMat = this.acquireShardMat();
    const shards = new THREE.InstancedMesh(this.shardGeometry, shardMat, SHARD_COUNT);
    shards.name = 'ring-of-frost-shards';
    shards.frustumCulled = true;
    shards.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(opts.x, this.groundY(opts.x, opts.z) + 0.8, opts.z),
      radius + 2,
    );
    shards.renderOrder = 8;
    const shardBases: ShardBase[] = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const angle = (i / SHARD_COUNT) * Math.PI * 2;
      const lane = i % 2 === 0 ? 0.28 : 0.72;
      const shardRadius = innerRadius + (radius - innerRadius) * lane;
      const x = opts.x + Math.cos(angle) * shardRadius;
      const z = opts.z + Math.sin(angle) * shardRadius;
      shardBases.push({
        x,
        z,
        groundY: this.groundY(x, z) + 0.05,
        angle,
        height: 0.78 + ((i * 7) % 11) * 0.075,
        width: 0.62 + ((i * 5) % 7) * 0.055,
        phase: i * 1.91,
      });
    }
    root.add(shards);

    const moteGeometry = new THREE.BufferGeometry();
    const motePositions = new Float32Array(MOTE_COUNT * 3);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const angle = (i / MOTE_COUNT) * Math.PI * 2 + Math.sin(i * 2.17) * 0.08;
      const lane = 0.16 + ((i * 13) % 69) / 100;
      const moteRadius = innerRadius + (radius - innerRadius) * lane;
      const x = opts.x + Math.cos(angle) * moteRadius;
      const z = opts.z + Math.sin(angle) * moteRadius;
      motePositions[i * 3] = x;
      motePositions[i * 3 + 1] = this.groundY(x, z) + 0.25 + ((i * 17) % 13) * 0.075;
      motePositions[i * 3 + 2] = z;
    }
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const moteMat = this.acquireMoteMat();
    const motes = new THREE.Points(moteGeometry, moteMat);
    motes.name = 'ring-of-frost-motes';
    motes.renderOrder = 10;
    root.add(motes);

    const visual: RingVisual = {
      root,
      outerMat,
      innerMat,
      bandMat,
      shardMat,
      moteMat,
      shards,
      shardBases,
      shardDummy: new THREE.Object3D(),
      ownedGeometries: [outerGeometry, innerGeometry, bandGeometry, moteGeometry],
      duration: Math.max(0.1, opts.duration),
      elapsed: Math.max(0, opts.duration - opts.remaining),
      lastSnapshotRemaining: opts.remaining,
    };
    this.animate(visual);
    this.rings.set(id, visual);
    this.scene.add(root);
  }

  update(dt: number): void {
    for (const [id, ring] of this.rings) {
      ring.elapsed += dt;
      if (ring.elapsed >= ring.duration) {
        this.disposeRing(ring);
        this.rings.delete(id);
        continue;
      }
      this.animate(ring);
    }
  }

  dispose(): void {
    for (const ring of this.rings.values()) this.disposeRing(ring);
    this.rings.clear();
    this.shardGeometry?.dispose();
    this.shardGeometry = null;
    for (const pool of [this.outerPool, this.innerPool, this.bandPool] as const) {
      for (const mat of pool) mat.dispose();
      pool.length = 0;
    }
    for (const mat of this.shardMatPool) mat.dispose();
    this.shardMatPool.length = 0;
    for (const mat of this.motePool) mat.dispose();
    this.motePool.length = 0;
  }

  private buildEdgeGeometry(x: number, z: number, radius: number): THREE.BufferGeometry {
    const positions = new Float32Array(RING_SEGMENTS * 3);
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      positions[i * 3] = px;
      positions[i * 3 + 1] = this.groundY(px, pz) + 0.08;
      positions[i * 3 + 2] = pz;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }

  private buildBandGeometry(
    x: number,
    z: number,
    innerRadius: number,
    outerRadius: number,
  ): THREE.BufferGeometry {
    const positions = new Float32Array(RING_SEGMENTS * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      for (const [lane, radius] of [innerRadius, outerRadius].entries()) {
        const px = x + Math.cos(angle) * radius;
        const pz = z + Math.sin(angle) * radius;
        const offset = (i * 2 + lane) * 3;
        positions[offset] = px;
        positions[offset + 1] = this.groundY(px, pz) + 0.055;
        positions[offset + 2] = pz;
      }
      const next = (i + 1) % RING_SEGMENTS;
      const inner = i * 2;
      const outer = inner + 1;
      const nextInner = next * 2;
      const nextOuter = nextInner + 1;
      indices.push(inner, outer, nextOuter, inner, nextOuter, nextInner);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private acquireEdgeMat(
    pool: THREE.LineBasicMaterial[],
    opacity: number,
  ): THREE.LineBasicMaterial {
    const pooled = pool.pop();
    if (pooled) {
      pooled.color.setHex(0xa7efff);
      pooled.opacity = opacity;
      return pooled;
    }
    return new THREE.LineBasicMaterial({
      color: 0xa7efff,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  private acquireBandMat(): THREE.MeshBasicMaterial {
    const pooled = this.bandPool.pop();
    if (pooled) {
      pooled.color.setHex(0x5fd8ff);
      pooled.opacity = 0.2;
      return pooled;
    }
    return new THREE.MeshBasicMaterial({
      color: 0x5fd8ff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private acquireShardMat(): THREE.MeshStandardMaterial {
    const pooled = this.shardMatPool.pop();
    if (pooled) {
      pooled.color.setHex(0x8de8ff);
      pooled.emissive.setHex(0x1d8dca);
      pooled.opacity = 0.92;
      return pooled;
    }
    return new THREE.MeshStandardMaterial({
      color: 0x8de8ff,
      emissive: 0x1d8dca,
      emissiveIntensity: 1.35,
      roughness: 0.24,
      metalness: 0.04,
      transparent: true,
      opacity: 0.92,
    });
  }

  private acquireMoteMat(): THREE.PointsMaterial {
    const pooled = this.motePool.pop();
    if (pooled) {
      pooled.color.setHex(0xc9f7ff);
      pooled.opacity = 0.8;
      return pooled;
    }
    return new THREE.PointsMaterial({
      color: 0xc9f7ff,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
  }

  // Return a released material to its role's pool, up to the fixed cap; past
  // the cap it is disposed like before, so pool memory stays bounded.
  private release<T extends THREE.Material>(pool: T[], mat: T): void {
    if (pool.length < MAX_POOL_SIZE) pool.push(mat);
    else mat.dispose();
  }

  private animate(ring: RingVisual): void {
    const grow = Math.min(1, ring.elapsed / GROW_SECONDS);
    const fade = Math.min(1, (ring.duration - ring.elapsed) / FADE_SECONDS);
    const pulse = 0.88 + Math.sin(ring.elapsed * 5.2) * 0.12;
    // These exact edges are gameplay information: the trap is active for its
    // whole authoritative lifetime, so they never participate in grow/fade.
    ring.outerMat.opacity = 0.9 * pulse;
    ring.innerMat.opacity = 0.7 * pulse;
    ring.bandMat.opacity = 0.2 * grow * fade * (0.9 + Math.sin(ring.elapsed * 3.7) * 0.1);
    ring.shardMat.opacity = 0.92 * fade;
    ring.moteMat.opacity = 0.78 * grow * fade * pulse;

    for (let i = 0; i < ring.shardBases.length; i++) {
      const base = ring.shardBases[i];
      const flicker = 0.94 + Math.sin(ring.elapsed * 4.4 + base.phase) * 0.06;
      const height = base.height * grow * flicker;
      ring.shardDummy.position.set(base.x, base.groundY + height * 0.5, base.z);
      ring.shardDummy.rotation.set(0, -base.angle + Math.PI * 0.5, 0);
      ring.shardDummy.scale.set(base.width, Math.max(0.02, height / 1.4), base.width);
      ring.shardDummy.updateMatrix();
      ring.shards.setMatrixAt(i, ring.shardDummy.matrix);
    }
    ring.shards.instanceMatrix.needsUpdate = true;
  }

  private disposeRing(ring: RingVisual): void {
    this.scene.remove(ring.root);
    this.release(this.outerPool, ring.outerMat);
    this.release(this.innerPool, ring.innerMat);
    this.release(this.bandPool, ring.bandMat);
    this.release(this.shardMatPool, ring.shardMat);
    this.release(this.motePool, ring.moteMat);
    ring.shards.dispose();
    for (const geometry of ring.ownedGeometries) geometry.dispose();
  }
}
