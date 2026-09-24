// Vysska's Cocoon, drawn from the authoritative hoard cues. The cocoons
// themselves are ordinary attackable mobs with Blender bodies
// (characters/manifest.ts, docs/design/cocoon/); this file draws everything that
// depends on the moment: the web mark closing on a player, the strand the cocoon
// hangs by, the RESCUE RING running down (the sim's own clock,
// src/sim/rift/hoard_cocoon_core.ts), her feeding line, and the end. How it
// LOOKS is hoard_cocoon_core.ts beside this file.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; nothing is allocated per frame; the idle frame
// is a few branches. The low tier sheds her feeding line and the silk shreds. It
// NEVER sheds what a player acts on: the web mark, the strand and the rescue
// ring draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import {
  type CocoonLook,
  cocoonEndLook,
  cocoonLook,
  COCOON_LOOK as LOOK,
  makeCocoonLook,
  WEB_FLOATS,
  writeWeb,
} from './hoard_cocoon_core';
import { ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import { setRenderCategory } from './renderer_diagnostics';

/** Two cocoons at most are ever spun at once. */
const RIGS = 2;
const SHREDS = 160;
const RING_SEGMENTS = 48;
const FEED_SEGMENTS = 10;
/** Seconds between looks for where she stands (her feeding line's far end). */
const BOSS_POLL = 0.25;
const BOSS_TEMPLATE = 'rift_boss_venom';

type Ribbon = ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

interface CocoonRig {
  instanceId: number;
  cueId: number;
  seen: boolean;
  shown: boolean;
  fresh: boolean;
  ended: boolean;
  fed: boolean;
  brood: boolean;
  burst: boolean;
  x: number;
  z: number;
  ground: number;
  total: number;
  remaining: number;
  elapsed: number;
  web: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  strand: Ribbon;
  ring: Ribbon;
  feed?: Ribbon;
  look: CocoonLook;
}

export class HoardCocoonFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 43;
  private readonly rigs: CocoonRig[] = [];
  private readonly calm = new THREE.Color(LOOK.calm);
  private readonly urgent = new THREE.Color(LOOK.urgent);
  private readonly end = { burst: 0, spread: 0 };
  private bossId = -1;
  private bossPoll = 0;
  private bossX = 0;
  private bossZ = 0;
  private hasBoss = false;
  private readonly shreds?: {
    points: THREE.Points;
    position: THREE.BufferAttribute;
    size: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
    velocity: Float32Array;
    life: Float32Array;
    span: Float32Array;
    cursor: number;
    live: number;
  };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
  ) {
    this.root.name = 'hoard-cocoon';
    setRenderCategory(this.root, 'ui3d');
    this.low =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';

    const web = this.own(new THREE.BufferGeometry());
    const lines = new Float32Array(WEB_FLOATS);
    writeWeb(lines);
    web.setAttribute('position', new THREE.BufferAttribute(lines, 3));
    for (let i = 0; i < RIGS; i++) this.rigs.push(this.makeRig(web));

    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(SHREDS * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(SHREDS), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(SHREDS), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(SHREDS * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(LOOK.silk);
      for (let i = 0; i < SHREDS; i++) tint.setXYZ(i, color.r, color.g, color.b);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 30;
      this.root.add(points);
      this.shreds = {
        points,
        position,
        size,
        alpha,
        velocity: new Float32Array(SHREDS * 3),
        life: new Float32Array(SHREDS),
        span: new Float32Array(SHREDS),
        cursor: 0,
        live: 0,
      };
    }

    // Compile with everything present and visible-capable, then idle hidden.
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.root,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private keep<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private ribbon(
    segments: number,
    color: number,
    additive: boolean,
    name: string,
    order: number,
  ): Ribbon {
    const made = strip(segments);
    this.own(made.geometry);
    const material = this.keep(ribbonMaterial(color, additive));
    const mesh = new THREE.Mesh(made.geometry, material);
    mesh.name = name;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.root.add(mesh);
    return { ...made, mesh, material };
  }

  private makeRig(web: THREE.BufferGeometry): CocoonRig {
    const rig: CocoonRig = {
      instanceId: -1,
      cueId: -1,
      seen: false,
      shown: false,
      fresh: false,
      ended: false,
      fed: false,
      brood: false,
      burst: false,
      x: 0,
      z: 0,
      ground: 0,
      total: 0,
      remaining: -1,
      elapsed: 0,
      web: new THREE.LineSegments(
        web,
        this.keep(
          new THREE.LineBasicMaterial({
            color: LOOK.web,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      ),
      strand: this.ribbon(1, LOOK.silk, false, 'CocoonStrand', 19),
      // Alpha blended, never additive: it must read on any floor, and its colour
      // (calm to urgent) is the message.
      ring: this.ribbon(RING_SEGMENTS, LOOK.calm, false, 'CocoonRing', 18),
      feed: this.low ? undefined : this.ribbon(FEED_SEGMENTS, LOOK.feed, true, 'CocoonFeed', 21),
      look: makeCocoonLook(),
    };
    rig.web.name = 'CocoonWeb';
    rig.web.visible = false;
    rig.web.frustumCulled = false;
    rig.web.renderOrder = 17;
    this.root.add(rig.web);
    return rig;
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (let i = 0; i < this.rigs.length; i++) this.rigs[i].seen = false;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      const ended = cue.variant === 'brood-cocoon-end';
      if (!ended && cue.variant !== 'brood-cocoon') continue;
      let rig: CocoonRig | undefined;
      let free: CocoonRig | undefined;
      for (let i = 0; i < this.rigs.length; i++) {
        const candidate = this.rigs[i];
        if (candidate.cueId === cue.cueId && candidate.instanceId === cue.instanceId) {
          rig = candidate;
          break;
        }
        if (!free && candidate.cueId === -1) free = candidate;
      }
      if (!rig) {
        rig = free;
        if (!rig) continue;
        // A rig is reused across casts and whole runs: start it clean.
        rig.cueId = cue.cueId;
        rig.instanceId = cue.instanceId;
        rig.ended = ended;
        rig.remaining = -1;
        rig.burst = false;
        rig.brood = false;
        rig.fed = false;
      }
      if (rig.ended !== ended) {
        // The same cue, now its end: a new clock.
        rig.ended = ended;
        rig.remaining = -1;
        rig.burst = false;
      }
      rig.seen = true;
      // A wrapped player's cue rides them (they may be knocked about before the
      // silk closes), so the place is read every frame.
      rig.x = cue.x;
      rig.z = cue.z;
      rig.ground = this.groundY(cue.x, cue.z);
      if (ended) rig.fed = (cue.innerRadius ?? 0) >= 0.5;
      else rig.brood = (cue.innerRadius ?? 0) >= 0.5;
      rig.total = cue.total;
      if (rig.remaining !== cue.remaining) {
        rig.remaining = cue.remaining;
        rig.elapsed = Math.max(0, cue.total - cue.remaining);
        rig.fresh = true;
      }
    }
    for (let i = 0; i < this.rigs.length; i++) if (!this.rigs[i].seen) this.rigs[i].cueId = -1;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const still = this.reducedMotion();
    let live = false;
    for (let i = 0; i < this.rigs.length; i++) {
      if (this.rigs[i].seen && this.rigs[i].cueId !== -1) live = true;
    }
    if (live) this.findBoss(dt);
    for (let i = 0; i < this.rigs.length; i++) this.updateRig(this.rigs[i], dt, still);
    this.updateShreds(dt);
  }

  /** Where she stands: the far end of her feeding line. Looked for only while a
   *  cocoon lives, and only inside a rift floor (a hoard is one). */
  private findBoss(dt: number): void {
    const world = this.world;
    if (!world || this.low) return;
    const held = this.bossId === -1 ? undefined : world.entities.get(this.bossId);
    if (held && !held.dead) {
      this.bossX = held.pos.x;
      this.bossZ = held.pos.z;
      this.hasBoss = true;
      return;
    }
    this.hasBoss = false;
    this.bossPoll -= dt;
    if (this.bossPoll > 0 || !world.riftFloor) return;
    this.bossPoll = BOSS_POLL;
    this.bossId = -1;
    for (const entity of world.entities.values()) {
      if (entity.templateId !== BOSS_TEMPLATE || entity.dead) continue;
      this.bossId = entity.id;
      this.bossX = entity.pos.x;
      this.bossZ = entity.pos.z;
      this.hasBoss = true;
      return;
    }
  }

  private hideRig(rig: CocoonRig): void {
    if (!rig.shown) return;
    rig.shown = false;
    rig.web.visible = false;
    rig.strand.mesh.visible = false;
    rig.ring.mesh.visible = false;
    if (rig.feed) rig.feed.mesh.visible = false;
  }

  private updateRig(rig: CocoonRig, dt: number, still: boolean): void {
    if (!rig.seen || rig.cueId === -1) {
      this.hideRig(rig);
      return;
    }
    rig.shown = true;
    // A cue that refreshed this frame already IS now: only a stale one is
    // carried forward, so the clock never double-steps.
    if (rig.fresh) rig.fresh = false;
    else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);

    if (rig.ended) {
      rig.web.visible = false;
      rig.strand.mesh.visible = false;
      if (rig.feed) rig.feed.mesh.visible = false;
      cocoonEndLook(rig.elapsed, this.end);
      // The ring flares once and spreads: red and sour if she fed, clean if cut.
      rig.ring.mesh.visible = this.end.burst > 0.01;
      if (rig.ring.mesh.visible) {
        rig.ring.material.uniforms.tint.value.copy(rig.fed ? this.urgent : this.calm);
        rig.ring.material.uniforms.gain.value = this.end.burst;
        this.writeRing(rig, 1, LOOK.ringRadius * this.end.spread);
      }
      if (!rig.burst) {
        rig.burst = true;
        if (!still) this.burst(rig.x, rig.ground + 1.6, rig.z, rig.fed ? 30 : 70);
      }
      return;
    }

    const look = cocoonLook(rig.elapsed, rig.total, rig.brood, still ? 0 : this.time, rig.look);
    const top = rig.brood ? LOOK.broodTop : LOOK.silkTop;

    rig.web.visible = look.web > 0.01;
    if (rig.web.visible) {
      rig.web.position.set(rig.x, rig.ground + 0.07, rig.z);
      rig.web.scale.setScalar(LOOK.webRadius * look.webScale);
      if (!still) rig.web.rotation.y = this.time * 0.5;
      rig.web.material.opacity = look.web;
    }

    rig.strand.mesh.visible = look.strand > 0.01;
    if (rig.strand.mesh.visible) {
      const sway = still ? 0 : 0.06 * Math.sin(this.time * 1.7 + rig.cueId);
      const y0 = rig.ground + top - 0.15;
      const y1 = rig.ground + top + LOOK.strandHeight * look.strand;
      rig.strand.position.setXYZ(0, rig.x - 0.07, y0, rig.z);
      rig.strand.position.setXYZ(1, rig.x + 0.07, y0, rig.z);
      rig.strand.position.setXYZ(2, rig.x - 0.04 + sway, y1, rig.z);
      rig.strand.position.setXYZ(3, rig.x + 0.04 + sway, y1, rig.z);
      rig.strand.alpha.setX(0, 0.95);
      rig.strand.alpha.setX(1, 0.95);
      rig.strand.alpha.setX(2, 0.25);
      rig.strand.alpha.setX(3, 0.25);
      rig.strand.position.needsUpdate = true;
      rig.strand.alpha.needsUpdate = true;
    }

    rig.ring.mesh.visible = look.ring > 0.01;
    if (rig.ring.mesh.visible) {
      rig.ring.material.uniforms.tint.value.copy(this.calm).lerp(this.urgent, look.urgency);
      rig.ring.material.uniforms.gain.value = look.ring * (0.75 + 0.25 * look.pulse);
      this.writeRing(rig, look.left, LOOK.ringRadius);
    }

    const feed = rig.feed;
    if (feed) {
      feed.mesh.visible = look.feed > 0.01 && this.hasBoss;
      if (feed.mesh.visible) {
        feed.material.uniforms.gain.value = look.feed;
        this.writeFeed(rig, feed, top);
      }
    }
  }

  /** The rescue ring: an arc round the cocoon whose lit share is the time LEFT.
   *  It empties clockwise from the top, so a glance reads it like a clock. */
  private writeRing(rig: CocoonRig, left: number, radius: number): void {
    const y = rig.ground + 0.09;
    const inner = radius - LOOK.ringWidth;
    for (let column = 0; column <= RING_SEGMENTS; column++) {
      const t = column / RING_SEGMENTS;
      const bearing = t * Math.PI * 2;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      rig.ring.position.setXYZ(column * 2, rig.x + sx * inner, y, rig.z + sz * inner);
      rig.ring.position.setXYZ(column * 2 + 1, rig.x + sx * radius, y, rig.z + sz * radius);
      // Spent time is a faint ghost of the ring, so its full size still reads.
      const lit = t <= left ? 1 : 0.12;
      rig.ring.alpha.setX(column * 2, lit * 0.7);
      rig.ring.alpha.setX(column * 2 + 1, lit);
    }
    rig.ring.position.needsUpdate = true;
    rig.ring.alpha.needsUpdate = true;
  }

  /** Her feeding line: a sagging thread of light from the cocoon to her. */
  private writeFeed(rig: CocoonRig, feed: Ribbon, top: number): void {
    const y0 = rig.ground + top * 0.7;
    const y1 = this.groundY(this.bossX, this.bossZ) + 2.2;
    for (let row = 0; row <= FEED_SEGMENTS; row++) {
      const t = row / FEED_SEGMENTS;
      const x = rig.x + (this.bossX - rig.x) * t;
      const z = rig.z + (this.bossZ - rig.z) * t;
      const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 1.1;
      feed.position.setXYZ(row * 2, x, y - 0.12, z);
      feed.position.setXYZ(row * 2 + 1, x, y + 0.12, z);
      // Light runs along it toward her.
      const run = 0.45 + 0.55 * Math.sin((t * 3 - this.time * 2.4) * Math.PI * 2) ** 2;
      feed.alpha.setX(row * 2, run * 0.5);
      feed.alpha.setX(row * 2 + 1, run);
    }
    feed.position.needsUpdate = true;
    feed.alpha.needsUpdate = true;
  }

  private burst(x: number, y: number, z: number, count: number): void {
    const shreds = this.shreds;
    if (!shreds) return;
    for (let n = 0; n < count; n++) {
      const a = this.random() * Math.PI * 2;
      const s = 2 + this.random() * 5;
      const i = shreds.cursor;
      shreds.cursor = (i + 1) % SHREDS;
      shreds.position.setXYZ(i, x, y + (this.random() - 0.5) * 2.4, z);
      shreds.velocity[i * 3] = Math.sin(a) * s;
      shreds.velocity[i * 3 + 1] = 1 + this.random() * 4;
      shreds.velocity[i * 3 + 2] = Math.cos(a) * s;
      shreds.size.setX(i, 0.16 + this.random() * 0.2);
      shreds.life[i] = 0.8 + this.random() * 0.7;
      shreds.span[i] = shreds.life[i];
      shreds.live++;
    }
    shreds.size.needsUpdate = true;
  }

  private updateShreds(dt: number): void {
    const shreds = this.shreds;
    if (!shreds || shreds.live === 0) return;
    let alive = 0;
    for (let i = 0; i < SHREDS; i++) {
      if (shreds.life[i] <= 0) continue;
      shreds.life[i] -= dt;
      if (shreds.life[i] <= 0) {
        shreds.alpha.setX(i, 0);
        continue;
      }
      alive++;
      // Silk floats: it falls slowly and drags.
      shreds.velocity[i * 3] *= 1 - 1.8 * dt;
      shreds.velocity[i * 3 + 2] *= 1 - 1.8 * dt;
      shreds.velocity[i * 3 + 1] -= 3.5 * dt;
      shreds.position.setXYZ(
        i,
        shreds.position.getX(i) + shreds.velocity[i * 3] * dt,
        shreds.position.getY(i) + shreds.velocity[i * 3 + 1] * dt,
        shreds.position.getZ(i) + shreds.velocity[i * 3 + 2] * dt,
      );
      shreds.alpha.setX(i, Math.min(1, (shreds.life[i] / shreds.span[i]) * 1.4) * 0.6);
    }
    shreds.live = alive;
    shreds.points.visible = alive > 0;
    shreds.position.needsUpdate = true;
    shreds.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
