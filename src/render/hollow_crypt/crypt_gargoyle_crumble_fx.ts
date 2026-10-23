// The Chapel Gargoyle's death (plan: crypt_gargoyle_crumble_core.ts; host:
// crypt_trash_kit_fx.ts). Carved stone does not lie down:
//
//  - a held beat: hot amber cracks race over the standing body, flakes rain
//    off it and grit trickles at its feet;
//  - the break: the rig goes (a gesture hides its whole model), and in the same
//    frame the body is a mass of stone blocks that let go from the feet up,
//    fall, and smash on the flags in dust and splinters, a few bouncing once;
//    a thick cloud bursts through the body's volume and a low ring of dust
//    rolls out over the floor;
//  - what is left: a heap of rubble under a player's knee, with half the
//    horned face, a horn, a taloned hand and a span of wing lying on it. The
//    heap IS the corpse: the rig's click capsule and nameplate shrink onto it
//    (VisualDef.meshToggles `remains`), so it is what is clicked and looted.
//
// A gargoyle killed in the air (mid dive: the sim never moves a dead mob)
// breaks where it hangs and its stone falls to the floor below; the heap
// builds there and the click capsule drops onto it. A corpse first seen
// already dead is simply a heap. Reduced motion: no flying stone, no shake,
// one soft veil of dust and the heap.
//
// The heap and the corpse are identical on every graphics tier; the blocks and
// the dust shed with the host's density. Nothing here links a program: the
// heap and the blocks are the crypt kit's own stone (crypt_kit.ts, its batch
// shape on its material), the cracks are Cracked Stone's fissure sprites, the
// flash is the kit's shared halo, the dust, splinters and sparks are the
// host's particle pools.

import * as THREE from 'three';
import { corpseHasDecayed } from '../../sim/respawn_policy';
import type { Entity } from '../../sim/types';
import { HALO_FRAG } from './crypt_fx_floor';
import {
  CRUMBLE,
  type CrumbleChunk,
  type CrumbleChunkPose,
  type CrumblePhase,
  crumbleChunkCount,
  crumbleChunkInto,
  crumbleChunkPoseInto,
  crumbleChunksSeconds,
  crumbleFallSeconds,
  crumbleHeapYaw,
  crumblePhaseInto,
  GARGOYLE_AUTHORED_SCALE,
  GARGOYLE_RUBBLE,
  GARGOYLE_WHOLE_GESTURE,
  gargoyleRubbleGesture,
} from './crypt_gargoyle_crumble_core';
import { cryptKitStonePiece } from './crypt_kit';
import { CRACK_GLYPH_FRAG } from './crypt_mark_fx';
import type { CryptKitHost, CryptKitPart, KitGlyph } from './crypt_trash_kit_fx';
import { KIT_STEPS } from './crypt_trash_kit_fx';
import {
  CRACK_AMBER,
  CRYPT_KIT_MOBS,
  CRYPT_KIT_SLOTS,
  crustPlateSpot,
  GARGOYLE_BODY,
} from './crypt_trash_kit_fx_core';

const HEAP_PIECE = 'Kit_GargoyleRubble';
const BLOCK_PIECE = 'Kit_GargoyleChunk';
const SHARD_PIECE = 'Kit_GargoyleShard';
/** Gargoyles breaking at once (a pack holds two at most; a third only gets its dust and heap). */
const BURSTS = 2;
/** Fissure sprites racing over a breaking body. */
const CRACKS = 8;
/** A heap whose corpse went sinks into the floor over this long. */
const HEAP_SINK = 0.7;
/** Stone dust under the crypt's moon: the dust shader takes no light, so the
 *  night is in the colour (a daylight grey reads as a cream cloud here). */
const DUST: readonly [number, number, number] = [0.26, 0.28, 0.33];
/** Splinters: the same stone in shadow (the shard shader lights one facet). */
const SPLINTER: readonly [number, number, number] = [0.15, 0.15, 0.17];

interface Heap {
  owner: number;
  x: number;
  z: number;
  /** The floor under it, and how far over that floor the body broke. */
  gy: number;
  lift: number;
  facing: number;
  scale: number;
  yaw: number;
  /** The host clock at the death (far in the past for a corpse found dead). */
  diedAt: number;
  calm: boolean;
  /** Seconds its stone takes to reach the floor. */
  fall: number;
  broken: boolean;
  /** The hide gesture for its rig (sent again every scan). */
  gesture: string;
  /** The burst animating it, or -1. */
  burst: number;
  /** Its veil of dust has been thrown (the beat with no burst). */
  veiled: boolean;
  /** The scan that last saw its corpse. */
  seen: number;
  /** The host clock its corpse went, or -1 while it lies. */
  goneAt: number;
  /** The rise last written to its instance (-1: nothing written). */
  drawn: number;
  wisp: number;
}

interface Burst {
  heap: number;
  cracks: KitGlyph[];
  flash: KitGlyph;
  /** Blocks whose impact has been drawn. */
  landed: Uint8Array;
  trickle: number;
  thump: boolean;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

export class CryptGargoyleCrumbleFx implements CryptKitPart {
  private readonly heaps: Heap[] = [];
  private readonly bursts: Burst[] = [];
  private readonly heapMesh: THREE.InstancedMesh;
  private readonly blockMesh: THREE.InstancedMesh;
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly plans: CrumbleChunk[] = [];
  /** Each plan's instance in its batch (blocks and shards count apart). */
  private readonly planInstance: number[] = [];
  private readonly blocksPerBurst: number;
  private readonly shardsPerBurst: number;
  private readonly pose: CrumbleChunkPose = {
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    scale: 1,
    impactAt: 0,
    landed: false,
  };
  private readonly phase: CrumblePhase = {
    cracks: 0,
    crackGlow: 0,
    broken: false,
    flash: 0,
    heap: 0,
    settling: 0,
    done: false,
  };
  private readonly crackSpots: { x: number; y: number; z: number; size: number }[] = [];
  /** Living gargoyles seen by the last scan and by this one: a corpse whose
   *  owner was alive a scan ago died in front of us and gets the whole beat. */
  private alivePrev = new Set<number>();
  private aliveNow = new Set<number>();
  private scan = 0;
  private chunksLive = false;

  constructor(
    private readonly host: CryptKitHost,
    low: boolean,
  ) {
    const h = host;
    const count = crumbleChunkCount(h.density);
    let blocks = 0;
    let shards = 0;
    for (let i = 0; i < count; i++) {
      const plan = crumbleChunkInto(i, {
        x: 0,
        y: 0,
        z: 0,
        delay: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        shard: false,
        yaw: 0,
        spin: 0,
        ax: 0,
        ay: 1,
        az: 0,
        survives: false,
      });
      this.plans.push(plan);
      this.planInstance.push(plan.shard ? shards++ : blocks++);
    }
    this.blocksPerBurst = Math.max(1, blocks);
    this.shardsPerBurst = Math.max(1, shards);
    for (let k = 0; k < CRACKS; k++) this.crackSpots.push(crustPlateSpot(k * 5 + 2, 40));

    const batch = (piece: string, cap: number): THREE.InstancedMesh => {
      const kit = cryptKitStonePiece(piece);
      const mesh = new THREE.InstancedMesh(kit.geometry, kit.material, cap);
      mesh.name = `crypt-gargoyle-crumble:${piece}`;
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, ZERO);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = !low;
      mesh.receiveShadow = true;
      mesh.visible = false;
      h.root.add(mesh);
      return mesh;
    };
    this.heapMesh = batch(HEAP_PIECE, CRYPT_KIT_SLOTS.rubble);
    this.heapMesh.count = 0;
    this.blockMesh = batch(BLOCK_PIECE, BURSTS * this.blocksPerBurst);
    this.shardMesh = batch(SHARD_PIECE, BURSTS * this.shardsPerBurst);
    for (let i = 0; i < CRYPT_KIT_SLOTS.rubble; i++) {
      this.heaps.push({
        owner: -1,
        x: 0,
        z: 0,
        gy: 0,
        lift: 0,
        facing: 0,
        scale: 1,
        yaw: 0,
        diedAt: 0,
        calm: false,
        fall: 0,
        broken: false,
        gesture: '',
        burst: -1,
        veiled: false,
        seen: 0,
        goneAt: -1,
        drawn: -1,
        wisp: 0,
      });
    }
    for (let i = 0; i < BURSTS; i++) {
      const cracks: KitGlyph[] = [];
      for (let k = 0; k < CRACKS; k++) {
        cracks.push(
          h.glyph(
            CRACK_GLYPH_FRAG,
            {
              uColor: { value: new THREE.Color(CRACK_AMBER[0], CRACK_AMBER[1], CRACK_AMBER[2]) },
              uAlpha: { value: 0 },
              uSeed: { value: (k * 0.618034 + i * 0.37) % 1 },
            },
            KIT_STEPS.glyph,
          ),
        );
      }
      this.bursts.push({
        heap: -1,
        cracks,
        flash: h.glyph(
          HALO_FRAG,
          { uColor: { value: new THREE.Color(1, 0.8, 0.55) }, uAlpha: { value: 0 } },
          KIT_STEPS.glyph,
        ),
        landed: new Uint8Array(count),
        trickle: 0,
        thump: false,
      });
    }
  }

  beginScan(): void {
    this.scan++;
    const spare = this.alivePrev;
    this.alivePrev = this.aliveNow;
    this.aliveNow = spare;
    this.aliveNow.clear();
  }

  see(e: Entity): void {
    if (e.kind !== 'mob' || e.templateId !== CRYPT_KIT_MOBS.gargoyle) return;
    if (!e.dead) {
      this.aliveNow.add(e.id);
      // It lives again (a reset run): the rig comes back and the heap goes.
      const held = this.heapOf(e.id);
      if (held) {
        this.host.gesture(e.id, GARGOYLE_WHOLE_GESTURE);
        this.release(held);
      }
      return;
    }
    // A decayed corpse has no view and nothing to loot: its heap goes with it.
    if (corpseHasDecayed(e.dead, e.corpseTimer)) return;
    const heap = this.heapOf(e.id) ?? this.claim(e);
    if (!heap) return;
    heap.seen = this.scan;
    heap.goneAt = -1;
    // Sent again every scan: a view built later (the corpse walked back into
    // range) hides its body within a tenth of a second.
    if (heap.broken) this.host.gesture(e.id, heap.gesture);
  }

  endScan(): void {
    const now = this.host.now();
    let lying = false;
    for (const heap of this.heaps) {
      if (heap.owner < 0) continue;
      lying = true;
      if (heap.seen === this.scan || heap.goneAt >= 0) continue;
      heap.goneAt = now;
    }
    // The kit may have landed since the batches were built: a heap lying on
    // its stand-in shape takes the real piece.
    if (lying) this.adoptKit();
  }

  private adoptKit(): void {
    this.adopt(this.heapMesh, HEAP_PIECE);
    this.adopt(this.blockMesh, BLOCK_PIECE);
    this.adopt(this.shardMesh, SHARD_PIECE);
  }

  private heapOf(id: number): Heap | null {
    for (const heap of this.heaps) if (heap.owner === id) return heap;
    return null;
  }

  private claim(e: Entity): Heap | null {
    const h = this.host;
    let heap: Heap | null = null;
    for (const s of this.heaps) {
      if (s.owner < 0) {
        heap = s;
        break;
      }
    }
    // Every slot holds a corpse still lying: this one keeps its plain body.
    if (!heap) return null;
    const scale = e.scale || 1;
    const gy = h.groundY(e.pos.x, e.pos.z);
    const over = e.pos.y - gy;
    heap.owner = e.id;
    this.submitHeaps();
    heap.x = e.pos.x;
    heap.z = e.pos.z;
    heap.gy = gy;
    heap.lift = over > 0.3 ? over : 0;
    heap.facing = e.facing;
    heap.scale = scale;
    heap.yaw = crumbleHeapYaw(e.id, e.facing);
    heap.calm = h.calm();
    heap.fall = heap.calm ? 0 : crumbleFallSeconds(heap.lift, scale);
    heap.gesture = gargoyleRubbleGesture(heap.lift, scale);
    heap.broken = false;
    heap.burst = -1;
    heap.veiled = false;
    heap.goneAt = -1;
    heap.drawn = -1;
    heap.wisp = 0;
    // Seen alive a scan ago: it died in front of us. Otherwise the corpse was
    // already lying (we walked into range, or joined late): only the heap.
    const witnessed = this.alivePrev.has(e.id);
    heap.diedAt = witnessed ? h.now() : -1e6;
    if (witnessed && !heap.calm) {
      for (let i = 0; i < this.bursts.length; i++) {
        const b = this.bursts[i];
        if (b.heap >= 0) continue;
        b.heap = this.heaps.indexOf(heap);
        b.landed.fill(0);
        b.trickle = 0;
        b.thump = false;
        heap.burst = i;
        break;
      }
    }
    // The kit may have landed since the batches were built: draw the real pieces.
    this.adoptKit();
    return heap;
  }

  private adopt(mesh: THREE.InstancedMesh, piece: string): void {
    const geometry = cryptKitStonePiece(piece).geometry;
    if (mesh.geometry !== geometry) mesh.geometry = geometry;
  }

  private release(heap: Heap): void {
    const i = this.heaps.indexOf(heap);
    if (heap.burst >= 0) this.endBurst(this.bursts[heap.burst]);
    heap.owner = -1;
    heap.burst = -1;
    heap.broken = false;
    heap.drawn = -1;
    this.heapMesh.setMatrixAt(i, ZERO);
    this.heapMesh.instanceMatrix.needsUpdate = true;
    this.heapMesh.visible = this.submitHeaps() > 0;
  }

  /** Submit the heap batch only as far as its highest claimed slot. The batch
   *  is not frustum culled, and an empty slot's zero matrix still costs the
   *  heap's whole triangle count in every pass, shadows included. */
  private submitHeaps(): number {
    let top = 0;
    for (let i = 0; i < this.heaps.length; i++) if (this.heaps[i].owner >= 0) top = i + 1;
    this.heapMesh.count = top;
    return top;
  }

  private endBurst(b: Burst): void {
    const i = this.bursts.indexOf(b);
    for (const g of b.cracks) g.mesh.visible = false;
    b.flash.mesh.visible = false;
    for (let k = 0; k < this.blocksPerBurst; k++)
      this.blockMesh.setMatrixAt(i * this.blocksPerBurst + k, ZERO);
    for (let k = 0; k < this.shardsPerBurst; k++)
      this.shardMesh.setMatrixAt(i * this.shardsPerBurst + k, ZERO);
    this.blockMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (b.heap >= 0) this.heaps[b.heap].burst = -1;
    b.heap = -1;
  }

  update(dt: number): void {
    const h = this.host;
    const now = h.now();
    let chunks = false;
    for (let i = 0; i < this.heaps.length; i++) {
      const heap = this.heaps[i];
      if (heap.owner < 0) continue;
      const t = now - heap.diedAt;
      const phase = crumblePhaseInto(t, heap.fall, heap.calm, this.phase);
      const burst = heap.burst >= 0 ? this.bursts[heap.burst] : null;
      // The calm beat, and a third gargoyle breaking at once (no burst left
      // for it): a veil of dust thrown AS it dies, so it is thick over the
      // body by the time the rig goes. A corpse found already lying gets none.
      if (!burst && !heap.veiled) {
        heap.veiled = true;
        if (t < 1) this.veil(heap);
      }
      if (!heap.broken && phase.broken) {
        heap.broken = true;
        h.gesture(heap.owner, heap.gesture);
        if (burst) this.breakApart(heap);
      }
      if (burst) {
        this.stepBurst(heap, burst, phase, t, dt);
        chunks = true;
      }
      // Dust still drifting off the heap as it settles.
      if (heap.broken && phase.settling > 0 && t < 30) {
        heap.wisp += dt * 9 * h.density * phase.settling;
        while (heap.wisp >= 1) {
          heap.wisp -= 1;
          this.wisp(heap);
        }
      }
      // The heap: up out of the dust, and back into the floor once its corpse went.
      let rise = phase.heap;
      if (heap.goneAt >= 0) {
        const gone = (now - heap.goneAt) / HEAP_SINK;
        if (gone >= 1) {
          // A view that somehow outlived its corpse's heap gets its body
          // back: never a rig with nothing standing in for it.
          h.gesture(heap.owner, GARGOYLE_WHOLE_GESTURE);
          this.release(heap);
          continue;
        }
        rise *= 1 - smooth(gone);
      }
      if (rise !== heap.drawn) {
        heap.drawn = rise;
        const s = heap.scale / GARGOYLE_AUTHORED_SCALE;
        Q.setFromAxisAngle(UP, heap.yaw);
        P.set(heap.x, heap.gy, heap.z);
        // It builds from the middle out as the stone lands on it.
        S.set(s * (0.72 + 0.28 * rise), s * rise, s * (0.72 + 0.28 * rise));
        this.heapMesh.setMatrixAt(i, rise > 0 ? M.compose(P, Q, S) : ZERO);
        this.heapMesh.instanceMatrix.needsUpdate = true;
        this.heapMesh.visible = true;
      }
    }
    if (chunks || this.chunksLive) {
      this.blockMesh.instanceMatrix.needsUpdate = true;
      this.shardMesh.instanceMatrix.needsUpdate = true;
    }
    this.chunksLive = chunks;
    this.blockMesh.visible = chunks;
    this.shardMesh.visible = chunks;
  }

  /** A point of the body, world space: `lx` across, `ly` up over the floor
   *  the heap stands on, `lz` ahead, in the rig's own yards. */
  private bodyPoint(heap: Heap, lx: number, ly: number, lz: number): THREE.Vector3 {
    const c = Math.cos(heap.facing);
    const s = Math.sin(heap.facing);
    const k = heap.scale;
    return P.set(
      heap.x + (lx * c + lz * s) * k,
      heap.gy + heap.lift + ly * k,
      heap.z + (-lx * s + lz * c) * k,
    );
  }

  private stepBurst(heap: Heap, b: Burst, phase: CrumblePhase, t: number, dt: number): void {
    const h = this.host;
    const now = h.now();
    const scale = heap.scale;
    const bi = this.bursts.indexOf(b);
    // The held beat: cracks racing over the standing stone.
    const lit = phase.cracks * CRACKS;
    for (let k = 0; k < CRACKS; k++) {
      const g = b.cracks[k];
      const grown = Math.min(1, Math.max(0, lit - k));
      if (phase.broken || grown <= 0) {
        g.mesh.visible = false;
        continue;
      }
      const spot = this.crackSpots[k];
      const p = this.bodyPoint(
        heap,
        spot.x * GARGOYLE_BODY.rx,
        GARGOYLE_BODY.up + spot.y * GARGOYLE_BODY.ry * 0.9,
        GARGOYLE_BODY.forward + spot.z * GARGOYLE_BODY.rz,
      );
      g.mesh.position.copy(p);
      g.mesh.scale.setScalar((0.8 + 0.55 * spot.size) * scale * (0.35 + 0.65 * grown));
      g.mat.uniforms.uAlpha.value =
        phase.crackGlow * grown * (0.62 + 0.14 * Math.sin(now * 31 + k * 1.7));
      g.mesh.visible = true;
    }
    if (!phase.broken) {
      // Flakes shaken off the body, sparks spat from the cracks, grit at its feet.
      b.trickle += dt * h.density * (10 + 46 * phase.cracks);
      while (b.trickle >= 1) {
        b.trickle -= 1;
        const a = h.rand() * Math.PI * 2;
        const up = h.rand() * 2 - 1;
        const p = this.bodyPoint(
          heap,
          Math.sin(a) * GARGOYLE_BODY.rx,
          GARGOYLE_BODY.up + up * GARGOYLE_BODY.ry,
          GARGOYLE_BODY.forward + Math.cos(a) * GARGOYLE_BODY.rz,
        );
        h.brush
          .at(p.x, p.y, p.z)
          .vel(Math.sin(a) * 1.2, -0.5 - h.rand() * 2, Math.cos(a) * 1.2)
          .acc(0, -22, 0)
          .life(0.7 + h.rand() * 0.5, 0.4, heap.gy + 0.06)
          .size(0.2 + h.rand() * 0.18, 0.16, (h.rand() - 0.5) * 12)
          .rgba(SPLINTER[0], SPLINTER[1], SPLINTER[2], 1)
          .emit(h.shards, now);
        if (h.rand() < 0.6) {
          h.brush
            .at(p.x, p.y, p.z)
            .vel(Math.sin(a) * 2.5, 1 + h.rand() * 2.5, Math.cos(a) * 2.5)
            .acc(0, -6, 0)
            .life(0.4 + h.rand() * 0.4, 1.2)
            .size(0.2, 0.04)
            .rgba(CRACK_AMBER[0], CRACK_AMBER[1], CRACK_AMBER[2], 1)
            .emit(h.glow, now);
        }
      }
      return;
    }
    const since = t - CRUMBLE.crack;
    // The flash as it breaks.
    b.flash.mesh.visible = phase.flash > 0.01;
    if (b.flash.mesh.visible) {
      const p = this.bodyPoint(heap, 0, GARGOYLE_BODY.up, GARGOYLE_BODY.forward);
      b.flash.mesh.position.copy(p);
      b.flash.mesh.scale.setScalar((2.2 + 2.4 * (1 - phase.flash)) * scale);
      b.flash.mat.uniforms.uAlpha.value = phase.flash * 0.5;
    }
    // The mass of it reaching the floor.
    if (!b.thump && since >= heap.fall + 0.3) {
      b.thump = true;
      h.shakeAt(heap.x, heap.z, 0.34);
    }
    // The blocks.
    const liftLocal = heap.lift / scale;
    const c = Math.cos(heap.facing);
    const s = Math.sin(heap.facing);
    for (let i = 0; i < this.plans.length; i++) {
      const plan = this.plans[i];
      const pose = crumbleChunkPoseInto(plan, since, liftLocal, this.pose);
      const mesh = plan.shard ? this.shardMesh : this.blockMesh;
      const per = plan.shard ? this.shardsPerBurst : this.blocksPerBurst;
      const slot = bi * per + this.planInstance[i];
      const wx = heap.x + (pose.x * c + pose.z * s) * scale;
      const wy = heap.gy + pose.y * scale;
      const wz = heap.z + (-pose.x * s + pose.z * c) * scale;
      if (pose.landed && b.landed[i] === 0) {
        b.landed[i] = 1;
        this.impact(heap, wx, wz, plan.size * scale, plan.survives);
      }
      if (pose.scale <= 0) {
        mesh.setMatrixAt(slot, ZERO);
        continue;
      }
      P.set(wx, wy, wz);
      Q.setFromAxisAngle(AXIS.set(plan.ax, plan.ay, plan.az), pose.angle);
      S.setScalar(plan.size * scale * pose.scale);
      mesh.setMatrixAt(slot, M.compose(P, Q, S));
    }
    if (since > crumbleChunksSeconds(liftLocal) && phase.flash <= 0) this.endBurst(b);
  }

  /** The break: the cloud through the body, the dust rolling out over the
   *  floor, the splinters and the sparks, and the blow that shakes the room. */
  private breakApart(heap: Heap): void {
    const h = this.host;
    const now = h.now();
    const scale = heap.scale;
    const size = scale / GARGOYLE_AUTHORED_SCALE;
    const floor = heap.gy;
    // The cloud: thick, through the whole body and its wings, sinking.
    for (let i = 0; i < Math.round(40 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const up = h.rand() * 2 - 1;
      const wide = i % 3 === 0 ? 2.1 : 1.1;
      const p = this.bodyPoint(
        heap,
        Math.sin(a) * GARGOYLE_BODY.rx * wide * Math.sqrt(h.rand()),
        GARGOYLE_BODY.up + up * GARGOYLE_BODY.ry * 1.25,
        GARGOYLE_BODY.forward + Math.cos(a) * GARGOYLE_BODY.rz * 0.9 * Math.sqrt(h.rand()),
      );
      h.brush
        .at(p.x, p.y, p.z)
        .vel(
          Math.sin(a) * (1 + h.rand() * 2.5),
          -1 - h.rand() * 2.5,
          Math.cos(a) * (1 + h.rand() * 2.5),
        )
        .acc(0, -2.5, 0)
        .life(1.3 + h.rand() * 0.8, 1.3, floor + 0.5 * size)
        .size((1.8 + h.rand() * 0.9) * size, (3.4 + h.rand() * 1.4) * size, (h.rand() - 0.5) * 0.9)
        .rgba(DUST[0], DUST[1], DUST[2], 0.46)
        .emit(h.dust, now + h.rand() * 0.1);
    }
    // The ring: low, fast, rolling out along the flags as the mass lands.
    const lands = now + heap.fall + 0.12;
    for (let i = 0; i < Math.round(42 * h.density); i++) {
      const a = (i / 42) * Math.PI * 2 + h.rand() * 0.3;
      const r = (1 + h.rand() * 0.9) * scale;
      const sp = 5.5 + h.rand() * 4;
      h.brush
        .at(heap.x + Math.sin(a) * r, floor + 0.45 * size, heap.z + Math.cos(a) * r)
        .vel(Math.sin(a) * sp, 0.3 + h.rand() * 0.8, Math.cos(a) * sp)
        .life(1.6 + h.rand() * 0.8, 2.1, floor + 0.35 * size)
        .size(
          (1.3 + h.rand() * 0.6) * size,
          (3 + h.rand() * 1.2) * size,
          (h.rand() < 0.5 ? -1 : 1) * (0.5 + h.rand() * 0.7),
        )
        .rgba(DUST[0], DUST[1], DUST[2], 0.36)
        .emit(h.dust, lands + h.rand() * 0.35);
    }
    // Splinters thrown off the break.
    for (let i = 0; i < Math.round(44 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const up = h.rand() * 2 - 1;
      const p = this.bodyPoint(
        heap,
        Math.sin(a) * GARGOYLE_BODY.rx * 1.2,
        GARGOYLE_BODY.up + up * GARGOYLE_BODY.ry,
        GARGOYLE_BODY.forward + Math.cos(a) * GARGOYLE_BODY.rz * 0.8,
      );
      const sp = 3 + h.rand() * 6;
      const big = i % 4 === 0;
      h.brush
        .at(p.x, p.y, p.z)
        .vel(Math.sin(a) * sp, h.rand() * 5, Math.cos(a) * sp)
        .acc(0, -26, 0)
        .life(1.1 + h.rand() * 0.7 + heap.fall, 0.5, floor + 0.07)
        .size(
          big ? 0.5 + h.rand() * 0.3 : 0.22 + h.rand() * 0.18,
          big ? 0.44 : 0.18,
          (h.rand() - 0.5) * 11,
        )
        .rgba(SPLINTER[0], SPLINTER[1], SPLINTER[2], 1)
        .emit(h.shards, now + h.rand() * 0.05);
    }
    // The last of the fire in it.
    const core = this.bodyPoint(heap, 0, GARGOYLE_BODY.up, GARGOYLE_BODY.forward);
    const cx = core.x;
    const cy = core.y;
    const cz = core.z;
    for (let i = 0; i < Math.round(48 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const sp = 5 + h.rand() * 9;
      h.brush
        .at(cx, cy + (h.rand() - 0.5) * 2 * scale, cz)
        .vel(Math.sin(a) * sp, 1 + h.rand() * 6, Math.cos(a) * sp)
        .acc(0, -11, 0)
        .life(0.5 + h.rand() * 0.5, 1.8)
        .size(0.24, 0.05)
        .rgba(CRACK_AMBER[0], CRACK_AMBER[1], CRACK_AMBER[2], 1)
        .emit(h.glow, now);
    }
    h.shakeAt(heap.x, heap.z, 0.5);
  }

  /** A block landing: dust kicked up and splinters off it (a block that does
   *  not survive is all splinters). */
  private impact(heap: Heap, x: number, z: number, size: number, survives: boolean): void {
    const h = this.host;
    const now = h.now();
    const floor = heap.gy;
    for (let i = 0; i < Math.max(1, Math.round(2 * h.density)); i++) {
      const a = h.rand() * Math.PI * 2;
      h.brush
        .at(x, floor + 0.3, z)
        .vel(
          Math.sin(a) * (1 + h.rand() * 1.6),
          0.6 + h.rand() * 1.2,
          Math.cos(a) * (1 + h.rand() * 1.6),
        )
        .life(0.9 + h.rand() * 0.5, 1.6, floor + 0.25)
        .size(0.6 + size * 0.8, 1.5 + size * 1.7, (h.rand() - 0.5) * 0.8)
        .rgba(DUST[0], DUST[1], DUST[2], 0.36)
        .emit(h.dust, now);
    }
    const bits = Math.round((survives ? 1 : 3) * h.density);
    for (let i = 0; i < bits; i++) {
      const a = h.rand() * Math.PI * 2;
      const sp = 2 + h.rand() * 4.5;
      h.brush
        .at(x, floor + 0.2, z)
        .vel(Math.sin(a) * sp, 2.5 + h.rand() * 4.5, Math.cos(a) * sp)
        .acc(0, -26, 0)
        .life(0.8 + h.rand() * 0.6, 0.5, floor + 0.07)
        .size((0.22 + h.rand() * 0.26) * Math.min(1.4, 0.6 + size), 0.18, (h.rand() - 0.5) * 12)
        .rgba(SPLINTER[0], SPLINTER[1], SPLINTER[2], 1)
        .emit(h.shards, now);
    }
  }

  /** The calm beat: one soft veil of dust over the body, nothing thrown. */
  private veil(heap: Heap): void {
    const h = this.host;
    const now = h.now();
    const size = heap.scale / GARGOYLE_AUTHORED_SCALE;
    for (let i = 0; i < Math.round(44 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const up = h.rand() * 2 - 1;
      const p = this.bodyPoint(
        heap,
        Math.sin(a) * GARGOYLE_BODY.rx * (i % 3 === 0 ? 2 : 1.2) * Math.sqrt(h.rand()),
        GARGOYLE_BODY.up + up * GARGOYLE_BODY.ry * 1.5,
        GARGOYLE_BODY.forward + Math.cos(a) * GARGOYLE_BODY.rz * 0.8 * Math.sqrt(h.rand()),
      );
      h.brush
        .at(p.x, p.y, p.z)
        .vel(0, -0.9 - h.rand() * 0.9, 0)
        .life(1.5 + h.rand() * 0.6, 1, heap.gy + 0.5 * size)
        .size(2.4 * size, 3.6 * size, (h.rand() - 0.5) * 0.3)
        .rgba(DUST[0], DUST[1], DUST[2], 0.6)
        .emit(h.dust, now);
    }
  }

  private wisp(heap: Heap): void {
    const h = this.host;
    const size = heap.scale / GARGOYLE_AUTHORED_SCALE;
    const a = h.rand() * Math.PI * 2;
    const r = Math.sqrt(h.rand()) * GARGOYLE_RUBBLE.radius * 0.75 * size;
    h.brush
      .at(heap.x + Math.sin(a) * r, heap.gy + 0.25 * size, heap.z + Math.cos(a) * r)
      .vel((h.rand() - 0.5) * 0.5, 0.45 + h.rand() * 0.5, (h.rand() - 0.5) * 0.5)
      .life(1.6 + h.rand() * 0.9, 0.5)
      .size((0.7 + h.rand() * 0.4) * size, (1.8 + h.rand() * 0.7) * size, (h.rand() - 0.5) * 0.4)
      .rgba(DUST[0], DUST[1], DUST[2], 0.13)
      .emit(h.dust, h.now());
  }

  /** The batches own their instance buffers (the kit owns the geometry and
   *  material they draw: never disposed here). */
  dispose(): void {
    this.heapMesh.dispose();
    this.blockMesh.dispose();
    this.shardMesh.dispose();
  }
}
