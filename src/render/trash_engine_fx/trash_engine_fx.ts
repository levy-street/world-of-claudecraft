// The trash engine's visuals (plan: trash_engine_fx_core.ts), hosted by
// ../rift_death_zone.ts beside the dungeons' own fx: generic, keyed only on
// the engine's records (sim/mob/trash_kit/CLAUDE.md "Engine pieces"), so any
// dungeon that adopts a piece by data gets its look for free. The layers:
//  - engine_hazards.ts: hazard pools (boiling meltwater, spilled soulfire, a
//    school disc for anything else), the danger ring on the players' pools;
//  - engine_walls.ts: temporary combat walls (the Ice Slab), crash and shatter;
//  - engine_walkers.ts: walker orbs, their lane, empower, intercept, fade;
//  - engine_nova.ts: the line-of-sight nova's sight field and its wave;
//  - engine_use.ts: usable bodies' glyph, reach ring, effort and strike;
//  - engine_body_fx.ts: freeze-stack rime, the ice encase, the brand;
//  - engine_quench.ts: the dungeon's quench pools.
// This coordinator owns the root (one compile-gated attach), the telegraph
// kit, the pooled particles and rings, the shared ice shards, the 10 Hz scan
// that hands each entity to the layers, and the event routing.
//
// Rules (src/render/CLAUDE.md): every geometry, material and texture is built
// in this constructor under the root before its gated attach; no light; no
// per-frame allocation in the pools. Telegraphs and the shapes a player acts
// on draw on every tier; particles, curtains and shimmer thin on the low tier
// (`density`, from the static preset). Everything is derived from IWorld
// entities and events, so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { TelegraphKit } from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { sanctumDrawnHeight } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { SanctumShards } from '../gravewyrm_sanctum_fx/sanctum_shards';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { EngineBodyFx } from './engine_body_fx';
import { EngineHazards } from './engine_hazards';
import { EngineNova } from './engine_nova';
import { EngineParticles } from './engine_particles';
import { EngineQuench } from './engine_quench';
import { EngineUse } from './engine_use';
import { EngineWalkers } from './engine_walkers';
import { EngineWalls } from './engine_walls';
import { type EngineCatalog, engineCatalog, kitOf } from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const SCAN_SEC = 0.1;
const SHARD_CAPACITY = 240;

export class TrashEngineFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly catalog: EngineCatalog = engineCatalog();
  private readonly kit: TelegraphKit;
  private readonly particles: EngineParticles;
  private readonly shards: SanctumShards;
  private readonly glowTex: THREE.Texture | null;
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly hazards: EngineHazards | null = null;
  private readonly walls: EngineWalls | null = null;
  private readonly walkers: EngineWalkers | null = null;
  private readonly nova: EngineNova | null = null;
  private readonly use: EngineUse | null = null;
  private readonly bodies: EngineBodyFx | null = null;
  private readonly quench: EngineQuench | null = null;
  private seed = 0x3e91;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'trash-engine-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    this.kit = new TelegraphKit(this.root, detail);
    const hasDom = typeof document !== 'undefined';
    const glowTex = hasDom ? radialGlowTexture() : null;
    if (glowTex) glowTex.name = 'trashEngineGlow';
    this.glowTex = glowTex;
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    this.shards = new SanctumShards(
      this.root,
      Math.round(SHARD_CAPACITY * (detail ? 1 : 0.5)),
      (x, z) => this.groundY(x, z),
      () => this.rand(),
    );
    if (world) {
      const host = this.host(world);
      this.hazards = new EngineHazards(host);
      this.walls = new EngineWalls(host);
      this.walkers = new EngineWalkers(host);
      this.nova = new EngineNova(host);
      this.use = new EngineUse(host);
      this.bodies = new EngineBodyFx(host);
      this.quench = new EngineQuench(host);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private host(world: IWorld): TrashEngineHost {
    return {
      root: this.root,
      kit: this.kit,
      world,
      catalog: this.catalog,
      density: this.density,
      uTime: this.uTime,
      glowTex: this.glowTex,
      shards: this.shards,
      groundY: (x, z) => this.groundY(x, z),
      puff: (x, y, z, n, o) => this.particles.puff(x, y, z, n, o),
      shockRing: (x, z, c, r, s) => this.particles.shockRing(x, z, c, r, s),
      rand: () => this.rand(),
      reducedMotion: () => this.reducedMotion(),
      shake: (amount) => this.shakeSink?.(amount),
      bodyHeight: (e) => sanctumDrawnHeight(e.templateId, e.scale > 0 ? e.scale : 1),
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** True when the event is one of the engine's (the renderer then skips its
   *  generic draw of it). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type === 'spellfxAt') {
      if (ev.ability === 'trash_combat_wall_shatter') {
        this.walls?.shatter(ev.x, ev.z);
        return true;
      }
      return this.walkers?.handleEvent(ev) ?? false;
    }
    if (ev.type !== 'spellfx' || !ev.ability) return false;
    if (ev.ability === 'trash_combat_wall_rise') {
      const wall = this.world.entities.get(ev.targetId);
      if (wall) this.walls?.rise(wall);
      return true;
    }
    return (
      (this.nova?.handleEvent(ev) ?? false) ||
      (this.walkers?.handleEvent(ev) ?? false) ||
      (this.use?.handleEvent(ev) ?? false) ||
      (this.bodies?.handleEvent(ev) ?? false)
    );
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    this.hazards?.update(dt, this.clock);
    this.walls?.update(dt, this.clock);
    this.walkers?.update(dt, this.clock);
    this.nova?.update(dt, this.clock);
    this.use?.update(dt, this.clock);
    this.bodies?.update(dt, this.clock);
    this.quench?.update(dt);
    this.shards.update(dt);
    this.particles.update(this.clock);
  }

  /** Hand every entity to the layers that draw it (10 Hz). */
  private scan(world: IWorld): void {
    const c = this.catalog;
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        if (c.hazards.has(e.templateId)) this.hazards?.scan(e);
        else if (c.walkers.has(e.templateId)) this.walkers?.scanOrb(e);
        else this.walls?.scan(e);
        continue;
      }
      if (e.kind === 'player') {
        this.bodies?.scan(e);
        this.walkers?.scanBody(e);
        this.use?.scanUser(e);
        continue;
      }
      if (e.kind !== 'mob') continue;
      this.scanMob(e);
    }
  }

  private scanMob(e: Entity): void {
    if (e.auras.length > 0) this.walkers?.scanBody(e);
    const kit = kitOf(e);
    if (!kit) return;
    if (kit.usable) this.use?.scanBody(e, kit.usable);
    if (kit.nova && e.castingAbility) this.nova?.scanMob(e);
    if (kit.walker && e.castingAbility === kit.walker.castId && !e.dead)
      this.walkers?.gather(e, SCAN_SEC);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (e) {
        errors.push(e);
      }
    };
    attempt(() => this.root.removeFromParent());
    attempt(() => this.kit.dispose());
    attempt(() => this.shards.dispose());
    attempt(() => this.particles.dispose());
    for (const layer of [
      this.hazards,
      this.walls,
      this.walkers,
      this.nova,
      this.use,
      this.bodies,
      this.quench,
    ]) {
      if (layer) attempt(() => layer.dispose());
    }
    if (this.glowTex) {
      const tex = this.glowTex;
      attempt(() => tex.dispose());
    }
    if (errors.length > 0) throw new AggregateError(errors, 'TrashEngineFx dispose');
  }
}
