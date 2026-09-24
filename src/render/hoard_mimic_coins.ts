// The Voracious Chest's cursed coins, on screen: a handful of real coins flies out
// of its mouth in an arc to each puddle it spits, lands as the puddle's warning
// ends, lies there while the puddle burns, and sinks away when it is gone. Drawn
// from the ordinary hoard cues (the `mimic-coins` marks), so there is no new
// event or wire surface; the puddle's own gold disc is the generic telegraph.
// How it LOOKS is hoard_mimic_coins_core.ts beside this file.
//
// Performance contract (the hoard siblings' contract): one instanced mesh built
// once and attached through the scene gate, so nothing compiles mid-fight; no
// lights; nothing allocated per frame. The low tier throws half the coins;
// nothing a player acts on lives here (the puddle disc is the telegraph).

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { HOARD_MIMIC_BOSS_TEMPLATE, MIMIC } from '../sim/rift/hoard_mimic_core';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { COIN_LOOK } from './hoard_goblin_coins_core';
import {
  MIMIC_COIN_LOOK as LOOK,
  type MimicCoinFlight,
  mimicCoinArc,
  mimicCoinProgress,
  planMimicCoins,
} from './hoard_mimic_coins_core';
import { setRenderCategory } from './renderer_diagnostics';

/** Puddles drawn at once: a full spit and one more still sinking. */
const SLOTS = MIMIC.coinMax + 2;

interface PuddleSlot {
  key: string;
  live: boolean;
  seen: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  flightSec: number;
  elapsed: number;
  /** Seconds since the puddle vanished (sinking), or -1 while it stands. */
  sinking: number;
  coins: MimicCoinFlight[];
}

export class HoardMimicCoinsFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly perPuddle: number;
  private readonly slots: PuddleSlot[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly arc = { x: 0, y: 0, z: 0 };
  private readonly landing = { x: 0, y: 0, z: 0 };
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
  ) {
    this.root.name = 'hoard-mimic-coins';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.perPuddle = low ? LOOK.lowPerPuddle : LOOK.perPuddle;
    for (let s = 0; s < SLOTS; s++) {
      this.slots.push({
        key: '',
        live: false,
        seen: false,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        flightSec: 0,
        elapsed: 0,
        sinking: -1,
        coins: [],
      });
    }
    this.geometry = new THREE.CylinderGeometry(
      COIN_LOOK.radius,
      COIN_LOOK.radius,
      COIN_LOOK.thickness,
      12,
    );
    this.material = new THREE.MeshStandardMaterial({
      color: COIN_LOOK.gold,
      emissive: COIN_LOOK.glow,
      metalness: 0.85,
      roughness: 0.32,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, SLOTS * this.perPuddle);
    this.mesh.name = 'MimicCoins';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < SLOTS * this.perPuddle; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.root.add(this.mesh);
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.root,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  /** The chest's mouth: where the coins leave from (its nearest body, or the
   *  puddle itself if the chest is out of view). */
  private mouth(x: number, z: number, out: THREE.Vector3): void {
    let best: { x: number; z: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    if (this.world?.riftFloor) {
      for (const entity of this.world.entities.values()) {
        if (entity.templateId !== HOARD_MIMIC_BOSS_TEMPLATE || entity.dead) continue;
        const d = (entity.pos.x - x) ** 2 + (entity.pos.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = entity.pos;
        }
      }
    }
    const from = best ?? { x, z };
    out.set(from.x, this.groundY(from.x, from.z) + LOOK.mouthHeight, from.z);
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (const slot of this.slots) slot.seen = false;
    for (const cue of cues) {
      if (cue.variant !== 'mimic-coins' || cue.remaining <= 0) continue;
      const key = `${cue.instanceId}:${cue.cueId}`;
      let slot = this.slots.find((candidate) => candidate.live && candidate.key === key);
      if (!slot) {
        slot = this.slots.find((candidate) => !candidate.live);
        if (!slot) continue;
        slot.key = key;
        slot.live = true;
        slot.sinking = -1;
        slot.elapsed = 0;
        this.mouth(cue.x, cue.z, slot.from);
        slot.to.set(cue.x, this.groundY(cue.x, cue.z) + COIN_LOOK.thickness / 2, cue.z);
        // Seen in its warning: it lands exactly as the warning ends. Seen late (or
        // with reduced motion): it settles in at once.
        slot.flightSec =
          cue.phase === 'warning' && !this.reducedMotion()
            ? Math.max(LOOK.minFlightSec, cue.remaining)
            : LOOK.minFlightSec;
        slot.coins = planMimicCoins(cue.cueId * 131 + cue.instanceId, this.perPuddle, cue.radius);
      }
      slot.seen = true;
    }
    for (const slot of this.slots) {
      if (slot.live && !slot.seen && slot.sinking < 0) slot.sinking = 0;
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    let any = false;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (!slot.live) continue;
      slot.elapsed += dt;
      if (slot.sinking >= 0) slot.sinking += dt;
      if (slot.sinking >= LOOK.sinkSec) {
        this.clear(s);
        continue;
      }
      any = true;
      const size = slot.sinking < 0 ? 1 : 1 - slot.sinking / LOOK.sinkSec;
      for (let i = 0; i < slot.coins.length; i++) {
        const coin = slot.coins[i];
        const t = mimicCoinProgress(slot.elapsed, slot.flightSec, coin.delay);
        const landed = t >= 1;
        this.landing.x = slot.to.x + coin.dx;
        this.landing.y = slot.to.y;
        this.landing.z = slot.to.z + coin.dz;
        mimicCoinArc(slot.from, this.landing, t, this.arc);
        this.position.set(this.arc.x, this.arc.y, this.arc.z);
        const flight = landed ? 0 : slot.elapsed;
        this.rotation.setFromEuler(
          this.euler.set(coin.spinX * flight, coin.yaw, coin.spinZ * flight),
        );
        this.scale.setScalar(t <= 0 ? 0 : size);
        this.mesh.setMatrixAt(
          s * this.perPuddle + i,
          this.matrix.compose(this.position, this.rotation, this.scale),
        );
      }
    }
    this.mesh.visible = any;
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private clear(s: number): void {
    const slot = this.slots[s];
    slot.live = false;
    slot.key = '';
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < this.perPuddle; i++)
      this.mesh.setMatrixAt(s * this.perPuddle + i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
