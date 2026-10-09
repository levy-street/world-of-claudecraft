// The Drowning Yard's Mooring Posts in Gaoler Ossick's fight (plan:
// bastion_mooring_core.ts), read off each post's mirrored encounter object
// (its template carries the lamp: lit, dark, kindling) and the sim's
// OSSICK_MOORED cue, so offline and online look the same:
//  - a LIT post burns warm: a flame in its glass cage, a halo, and a pool of
//    lamplight on the flags the size of its reach;
//  - while the local player is hooked by the Drowned Anchor, every lit post
//    calls to them: a pulsing gold ring on the flags at the sim's reach and a
//    shaft of light over the lamp (the safe points to run for);
//  - when a post takes a chain: the chain snaps taut from the freed player to
//    the post's ring, white-hot, then bursts into links and sparks; the lamp
//    flares blinding gold and dies, the glass spits sparks and the smoke
//    rolls off it; a jolt for the freed player;
//  - a DARK post is visibly out: no flame, a dull ember, smoke curling off
//    the cage; over its last seconds it KINDLES, sputtering and catching
//    until it burns whole again with a soft bloom.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once in the
// constructor under the Bastion telegraph root (compile-gated by BastionFx), no
// per-frame allocation, no new light (the glow is additive sprites and discs).
// What a player acts on draws on every graphics tier: the lamp's lit or dark
// state, the lamplight pool, the safe ring and the shaft. The sparks, smoke,
// shards and link debris are cosmetic and shed on the low tier.

import * as THREE from 'three';
import {
  MOORING_CHAIN_FLOOR,
  type MooringState,
  mooringStateOf,
  OSSICK_ANCHORED,
  OSSICK_MOORED,
  WINCH,
  YARD,
} from '../../sim/encounters/sunken_bastion/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import { bastionSlotOrigin, chainPoints } from './bastion_boss_fx_core';
import {
  MOORING_FLARE_SECONDS,
  MOORING_LAMP_HEIGHT,
  MOORING_RING_HEIGHT,
  MOORING_SAFE_RADIUS,
  type MooringLampLook,
  mooringLampLook,
  mooringRingPulse,
  mooringRingShown,
  mooringSnapHeat,
} from './bastion_mooring_core';
import { BastionParticles } from './bastion_particles';

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

/** Two claims' yards in view at most. */
const POST_SLOTS = 8;
const SNAP_SLOTS = 2;
const SNAP_LINKS = 14;
const SCAN_SEC = 0.1;
const FLAME = new THREE.Color(1.0, 0.72, 0.32);
const HALO = new THREE.Color(1.0, 0.6, 0.22);
const EMBER = new THREE.Color(0.75, 0.16, 0.05);
const SAFE = new THREE.Color(1.0, 0.82, 0.38);
const IRON = new THREE.Color(0.06, 0.06, 0.065);
const HOT = new THREE.Color(1.0, 0.86, 0.55);
const SHAKE_MOOR = 0.16;

/** One glow texture for every Mooring Post build (radialGlowTexture makes a
 *  new canvas texture per call; a module copy is never re-uploaded). */
let glowTex: THREE.Texture | null = null;

interface PostSlot {
  postId: number;
  state: MooringState;
  /** Clock when the state was seen to change (first sight: long ago). */
  since: number;
  /** Clock of its flare (a chain taken), or -1. */
  flareAt: number;
  x: number;
  y: number;
  z: number;
  flame: THREE.Sprite;
  flameMat: THREE.SpriteMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  pool: THREE.Mesh;
  poolMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  shaft: THREE.Sprite;
  shaftMat: THREE.SpriteMaterial;
  seed: number;
  /** The claim slot the post stands in (the sim moors only to the hooked
   *  player's own claim's posts). */
  claim: number;
}

interface SnapSlot {
  age: number;
  postId: number;
  playerId: number;
  /** The freed player's chest when the chain snapped (they may walk off). */
  px: number;
  py: number;
  pz: number;
}

export class BastionMooringFx {
  private readonly root = new THREE.Group();
  private readonly fx: BastionParticles;
  private readonly posts: PostSlot[] = [];
  private readonly snaps: SnapSlot[] = [];
  private readonly links: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly seen: number[] = [];
  private readonly look: MooringLampLook = { flame: 0, halo: 0, ember: 0 };
  private readonly pts = new Float32Array(SNAP_LINKS * 3);
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private hooked = false;
  /** The local player's claim slot while hooked (-1 when not). */
  private hookedClaim = -1;
  private slack = 1;
  private scan = 0;
  private clock = 0;

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly reducedMotion?: () => boolean,
  ) {
    this.root.name = 'sunken-bastion-mooring-fx';
    parent.add(this.root);
    this.fx = new BastionParticles(this.root, cosmetic);
    glowTex ??= radialGlowTexture();
    const glow = glowTex;
    const sprite = (color: THREE.Color): { s: THREE.Sprite; m: THREE.SpriteMaterial } => {
      const m = new THREE.SpriteMaterial({
        map: glow,
        color,
        opacity: 0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      m.name = 'sunkenBastionMooringGlow';
      this.materials.push(m);
      const s = new THREE.Sprite(m);
      s.visible = false;
      this.root.add(s);
      return { s, m };
    };
    const disc = this.geo(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2));
    const band = this.geo(new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2));
    for (let i = 0; i < POST_SLOTS; i++) {
      const flame = sprite(FLAME);
      const halo = sprite(HALO);
      const shaft = sprite(SAFE);
      const poolMat = new THREE.MeshBasicMaterial({
        map: glow,
        color: HALO,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      poolMat.name = 'sunkenBastionMooringPool';
      this.materials.push(poolMat);
      const pool = new THREE.Mesh(disc, poolMat);
      pool.visible = false;
      pool.frustumCulled = false;
      // Lamplight on the flags: ambient light on the floor's own rung, so every
      // telegraph paints over it (bastion_lights.ts's torch pools sit there too).
      pool.renderOrder = floorVfxRenderOrder('ground', 2);
      this.root.add(pool);
      const ringMat = new THREE.MeshBasicMaterial({
        color: SAFE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      ringMat.name = 'sunkenBastionMooringRing';
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(band, ringMat);
      ring.visible = false;
      ring.frustumCulled = false;
      ring.renderOrder = floorVfxRenderOrder('encounter', 19);
      this.root.add(ring);
      this.posts.push({
        postId: -1,
        state: 'lit',
        since: -99,
        flareAt: -1,
        x: 0,
        y: 0,
        z: 0,
        flame: flame.s,
        flameMat: flame.m,
        halo: halo.s,
        haloMat: halo.m,
        pool,
        poolMat,
        ring,
        ringMat,
        shaft: shaft.s,
        shaftMat: shaft.m,
        seed: i * 1.7,
        claim: -1,
      });
    }
    const linkGeo = this.geo(new THREE.TorusGeometry(0.2, 0.06, 6, 10));
    linkGeo.scale(1, 1.45, 1);
    const linkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    linkMat.name = 'sunkenBastionMooringChain';
    this.materials.push(linkMat);
    this.links = new THREE.InstancedMesh(linkGeo, linkMat, SNAP_SLOTS * SNAP_LINKS);
    this.links.frustumCulled = false;
    this.links.count = 0;
    this.links.setColorAt(0, IRON);
    this.root.add(this.links);
    for (let i = 0; i < SNAP_SLOTS; i++)
      this.snaps.push({ age: -1, postId: -1, playerId: -1, px: 0, py: 0, pz: 0 });
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  // ---- events ------------------------------------------------------------------------

  /** Claims the moor cue (the chain taken by a post); true when it drew it. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || ev.ability !== OSSICK_MOORED || !this.world) return false;
    const post = this.world.entities.get(ev.sourceId);
    const p = this.world.entities.get(ev.targetId);
    if (!post) return true;
    const slot = this.slotOf(post.id) ?? this.bind(post);
    if (slot) this.flare(slot);
    if (p) {
      let snap = this.snaps[0];
      for (const s of this.snaps)
        if (s.age < 0) {
          snap = s;
          break;
        }
      snap.age = 0;
      snap.postId = post.id;
      snap.playerId = p.id;
      snap.px = p.pos.x;
      snap.py = p.pos.y + 1.1;
      snap.pz = p.pos.z;
      if (p.id === this.world.playerId && this.shake && !this.reducedMotion?.())
        this.shake(SHAKE_MOOR);
    }
    return true;
  }

  /** The lamp flares and dies: the glass spits sparks and shards, smoke rolls. */
  private flare(slot: PostSlot): void {
    if (slot.flareAt >= 0 && this.clock - slot.flareAt < MOORING_FLARE_SECONDS) return;
    slot.flareAt = this.clock;
    const y = slot.y + MOORING_LAMP_HEIGHT;
    this.fx.burst(slot.x, y, slot.z, 0xfff0c0, 10, 0.4, 3.2, 0.35, 1.2, 5);
    this.fx.burst(slot.x, y, slot.z, 0xffb050, 8, 0.2, 0.9, 0.6, 2.5, 7);
    this.fx.chunksAt(slot.x, y, slot.z, slot.y, 0xb8d0c8, 6, 4.5, 0.35);
    this.fx.burst(slot.x, y + 0.6, slot.z, 0x3a3e42, 4, 0.6, 2.4, 2.4, 1.1, 0.4, true);
  }

  // ---- frame --------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.updatePosts(dt);
    this.updateSnaps(world, dt);
    this.fx.update(dt);
  }

  /** The slot bound to `postId` (-1: a free slot), or null. */
  private slotOf(postId: number): PostSlot | null {
    for (const s of this.posts) if (s.postId === postId) return s;
    return null;
  }

  private bind(post: EntityView): PostSlot | null {
    const state = mooringStateOf(post.templateId);
    const slot = this.slotOf(-1);
    if (!state || !slot) return null;
    slot.postId = post.id;
    slot.state = state;
    // First sight: no bloom, no flare (it has stood like this a while).
    slot.since = this.clock - 99;
    slot.flareAt = -1;
    slot.x = post.pos.x;
    slot.z = post.pos.z;
    slot.y = this.groundY(post.pos.x, post.pos.z);
    slot.claim = bastionSlotOrigin(post.pos.x, post.pos.z).slot;
    return slot;
  }

  private release(slot: PostSlot): void {
    slot.postId = -1;
    slot.flame.visible = false;
    slot.halo.visible = false;
    slot.pool.visible = false;
    slot.ring.visible = false;
    slot.shaft.visible = false;
  }

  private scanWorld(world: IWorld): void {
    this.seen.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind !== 'object') continue;
      const state = mooringStateOf(e.templateId);
      if (!state) continue;
      this.seen.push(e.id);
      const slot = this.slotOf(e.id) ?? this.bind(e);
      if (!slot || slot.state === state) continue;
      // A lit post gone dark without its cue (joined late, or the cue was
      // missed): it still flares and dies.
      if (slot.state === 'lit' && state === 'dark') this.flare(slot);
      // The last spark catches: a soft whoomp as it burns whole again.
      if (state === 'lit')
        this.fx.burst(
          slot.x,
          slot.y + MOORING_LAMP_HEIGHT,
          slot.z,
          0xffc070,
          6,
          0.3,
          1.6,
          0.5,
          1.8,
          2,
        );
      slot.state = state;
      slot.since = this.clock;
    }
    for (const slot of this.posts)
      if (slot.postId >= 0 && !this.seen.includes(slot.postId)) this.release(slot);
    // The local player hooked: every lit post calls to them.
    const me = world.entities.get(world.playerId);
    this.hooked = false;
    this.hookedClaim = -1;
    if (me && !me.dead) {
      for (const a of me.auras)
        if (a.id === OSSICK_ANCHORED) {
          this.hooked = true;
          break;
        }
    }
    if (this.hooked && me) {
      const o = bastionSlotOrigin(me.pos.x, me.pos.z);
      this.hookedClaim = o.slot;
      const d = Math.hypot(me.pos.x - o.x - WINCH.x, me.pos.z - o.z - WINCH.z);
      this.slack = (d - MOORING_CHAIN_FLOOR) / Math.max(1, YARD.r - MOORING_CHAIN_FLOOR);
    }
  }

  private updatePosts(dt: number): void {
    for (const slot of this.posts) {
      if (slot.postId < 0) continue;
      const flare = slot.flareAt >= 0 ? this.clock - slot.flareAt : -1;
      const look = mooringLampLook(slot.state, this.clock - slot.since, flare, this.look);
      const flicker =
        0.86 +
        0.14 * Math.sin(this.clock * 11 + slot.seed) * Math.sin(this.clock * 4.3 + slot.seed * 2);
      const ly = slot.y + MOORING_LAMP_HEIGHT;
      // The flame in the cage.
      const fl = look.flame * flicker;
      slot.flame.visible = fl > 0.01 || look.ember > 0.01;
      slot.flame.position.set(slot.x, ly, slot.z);
      if (fl > 0.01) {
        slot.flameMat.color.copy(FLAME);
        slot.flameMat.opacity = Math.min(1, fl);
        slot.flame.scale.set(1.0 + 0.2 * fl, 1.35 + 0.25 * fl, 1);
      } else {
        // A dead lamp keeps a dull ember behind the glass.
        slot.flameMat.color.copy(EMBER);
        slot.flameMat.opacity = look.ember * (0.75 + 0.25 * Math.sin(this.clock * 1.7 + slot.seed));
        slot.flame.scale.set(0.35, 0.35, 1);
      }
      // The halo, bigger and brighter while it calls to a hooked player.
      const calling = slot.claim === this.hookedClaim && mooringRingShown(slot.state, this.hooked);
      const halo = look.halo * flicker * (calling ? 1.35 : 1);
      slot.halo.visible = halo > 0.01;
      if (slot.halo.visible) {
        slot.halo.position.set(slot.x, ly + 0.1, slot.z);
        const hs = (calling ? 5.6 : 4.4) * (0.7 + 0.3 * Math.min(1.6, halo));
        slot.halo.scale.set(hs, hs, 1);
        slot.haloMat.opacity = Math.min(1, 0.9 * halo);
      }
      // Its light on the flags: the size of its reach.
      slot.pool.visible = halo > 0.01;
      if (slot.pool.visible) {
        const r = MOORING_SAFE_RADIUS * 1.25;
        slot.pool.position.set(slot.x, slot.y + 0.06, slot.z);
        slot.pool.scale.set(r, 1, r);
        slot.poolMat.opacity = Math.min(0.85, 0.5 * halo);
      }
      // The safe ring and the shaft of light while the local player is hooked.
      slot.ring.visible = calling;
      slot.shaft.visible = calling;
      if (calling) {
        const pulse = mooringRingPulse(this.clock, this.slack);
        const r = MOORING_SAFE_RADIUS * (0.96 + 0.04 * pulse);
        slot.ring.position.set(slot.x, slot.y + 0.08, slot.z);
        slot.ring.scale.set(r, 1, r);
        slot.ringMat.opacity = 0.5 + 0.45 * pulse;
        slot.shaft.position.set(slot.x, slot.y + 6.5, slot.z);
        slot.shaft.scale.set(1.5, 11, 1);
        slot.shaftMat.opacity = 0.18 + 0.22 * pulse;
      }
      // Cosmetic: smoke off a dead lamp, sparks off a kindling one.
      if (!this.cosmetic) continue;
      if (slot.state === 'dark' && this.fx.rand() < dt * 1.1)
        this.fx.burst(slot.x, ly + 0.55, slot.z, 0x45494d, 1, 0.3, 1.3, 2.2, 0.7, 0.1, true);
      else if (slot.state === 'kindling' && this.fx.rand() < dt * 5)
        this.fx.burst(slot.x, ly, slot.z, 0xffb050, 1, 0.12, 0.4, 0.4, 1.4, 1.2);
    }
  }

  private updateSnaps(world: IWorld, dt: number): void {
    let n = 0;
    for (const snap of this.snaps) {
      if (snap.age < 0) continue;
      snap.age += dt;
      const slot = this.slotOf(snap.postId);
      const post = world.entities.get(snap.postId);
      const heat = mooringSnapHeat(snap.age);
      const ax = slot?.x ?? post?.pos.x ?? snap.px;
      const az = slot?.z ?? post?.pos.z ?? snap.pz;
      const ay = (slot?.y ?? this.groundY(ax, az)) + MOORING_RING_HEIGHT;
      if (heat < 0) {
        // It bursts: links fly, sparks off the ring.
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          this.fx.chunksAt(
            ax + (snap.px - ax) * t,
            ay + (snap.py - ay) * t,
            az + (snap.pz - az) * t,
            this.groundY(ax, az),
            0x2d2b2a,
            3,
            4,
            0.6,
          );
        }
        this.fx.burst(ax, ay, az, 0xffc070, 8, 0.15, 0.8, 0.35, 1.6, 5);
        snap.age = -1;
        continue;
      }
      // Taut and white-hot from the post's ring to where they were freed.
      this.c.copy(IRON).lerp(HOT, heat);
      chainPoints(ax, ay, az, snap.px, snap.py, snap.pz, 0, SNAP_LINKS, this.pts);
      for (let i = 0; i < SNAP_LINKS; i++) {
        const j = Math.min(SNAP_LINKS - 1, i + 1);
        const k = i === SNAP_LINKS - 1 ? i - 1 : i;
        this.v.set(
          this.pts[j * 3] - this.pts[k * 3],
          this.pts[j * 3 + 1] - this.pts[k * 3 + 1],
          this.pts[j * 3 + 2] - this.pts[k * 3 + 2],
        );
        this.v.normalize();
        this.q.setFromUnitVectors(UP, this.v);
        if (i % 2 === 1) this.q.multiply(QUARTER);
        // A shiver along the taut chain.
        const jit = 0.05 * heat * Math.sin(this.clock * 60 + i * 1.9);
        this.s.set(this.pts[i * 3], this.pts[i * 3 + 1] + jit, this.pts[i * 3 + 2]);
        this.m4.compose(this.s, this.q, ONE);
        this.links.setMatrixAt(n, this.m4);
        this.links.setColorAt(n, this.c);
        n++;
      }
      if (this.cosmetic && this.fx.rand() < dt * 30) {
        const t = this.fx.rand();
        this.fx.burst(
          ax + (snap.px - ax) * t,
          ay + (snap.py - ay) * t,
          az + (snap.pz - az) * t,
          0xffd080,
          1,
          0.1,
          0.5,
          0.25,
          1.2,
          2.5,
        );
      }
    }
    this.links.count = n;
    this.links.visible = n > 0;
    if (n > 0) {
      this.links.instanceMatrix.needsUpdate = true;
      if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.links.dispose();
    this.fx.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const QUARTER = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
