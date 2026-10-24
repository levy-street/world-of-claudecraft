// Rift boss lethal death zone visual: the red danger circle drawn on the
// terrain at the zone's (x, z) position while the boss casts. The cast bar is
// the primary telegraph; this decal makes the exact danger radius visible so
// players can step out before the detonation.
//
// Three layers per zone (visual decisions in rift_death_zone_core.ts):
// - a terrain-draped rim band (replaces the old 1-pixel LineLoop, which was
//   the v0.36.0 "very hard to see" complaint: browsers cap line width at 1px),
// - a terrain-draped interior wash so the danger AREA reads, not just the rim,
// - a timer sweep disc growing from the center to the rim as the fuse elapses
//   (RiftBossDeathZoneView.total), strobing faster over the final window.
//
// Fairness note: this is an actionable cue (a player reacts to it), so it MUST
// draw at every graphics tier and NEVER be hidden by the FPS governor. The
// geometry is small (three meshes, a few hundred vertices, built once per
// zone; per-frame work is opacity writes and one scale write).

import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import type { HoardBossCueView, RiftBossDeathZoneView } from '../world_api/dungeons';
import { DeathBurstFx } from './death_burst_fx';
import { TempleFx } from './drowned_temple/temple_fx';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { SanctumBossFx } from './gravewyrm_sanctum_bosses';
import { SanctumFx } from './gravewyrm_sanctum_fx';
import { HoardBoneReaperFx } from './hoard_bone_reaper';
import { HoardBossDressing } from './hoard_boss_dressing';
import { HoardBossFx } from './hoard_boss_fx';
import { HoardBossGestures } from './hoard_boss_gestures';
import { HoardBossPresentation } from './hoard_boss_presentation';
import { HoardBoulderFx } from './hoard_boulder';
import { HoardCocoonFx } from './hoard_cocoon';
import { HoardEncounterAccents } from './hoard_encounter_accents';
import { HoardForgeHammerFx } from './hoard_forge_hammer';
import { HoardGoblinCoinsFx } from './hoard_goblin_coins';
import { HoardIceAgeFx } from './hoard_ice_age';
import { HoardMimicCoinsFx } from './hoard_mimic_coins';
import { HoardOrbitalLightning } from './hoard_orbital_lightning';
import { HoardPulsarFx } from './hoard_pulsars';
import { HoardSpellFx } from './hoard_spell_fx';
import { HoardTentaclesFx } from './hoard_tentacles';
import { CryptBossFx } from './hollow_crypt/crypt_boss_fx';
import { CryptCreatureFx } from './hollow_crypt/crypt_creature_fx';
import { CryptFinaleFx } from './hollow_crypt/crypt_finale_fx';
import { CryptTrashFx } from './hollow_crypt/crypt_trash_fx';
import { MorthenFx } from './hollow_crypt/morthen_fx';
import { MorthenRiteFx } from './hollow_crypt/morthen_rite_fx';
import {
  deathZonePlan,
  deathZonePulseSpeed,
  deathZoneSweepScale,
  FILL_OPACITY,
  RING_MAX_OPACITY,
  SWEEP_BASE_OPACITY,
} from './rift_death_zone_core';
import { SummonRiseFx } from './summon_rise_fx';
import { BastionFx } from './sunken_bastion/bastion_fx';
import { TrashEngineFx } from './trash_engine_fx';
import { WildheartFx } from './wildheart_basin';

const SEGMENTS = 64;
const BASE_COLOR = 0xff2200;
const SWEEP_COLOR = 0xff5500;
/** Rim band inner edge as a fraction of the zone radius (mage_ground_fx's
 * terrain-ring proportions, which read clearly at gameplay camera range). */
const RIM_INNER_FRACTION = 0.85;
/** Lift over the sampled ground so the decal never z-fights the floor. */
const GROUND_LIFT = 0.08;
/** The sweep disc rides slightly higher so it always draws over the wash. */
const SWEEP_LIFT = 0.14;

/** One live death zone visual. */
interface ZoneVisual {
  group: THREE.Group;
  rimMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  sweepMat: THREE.MeshBasicMaterial;
  sweep: THREE.Mesh;
  ownedGeometries: THREE.BufferGeometry[];
  /** Pulse phase clock (radians), advanced by update(dt) at the core's speed. */
  phase: number;
  /** Live fuse state, refreshed by sync() each frame from the IWorld view. */
  remaining: number;
  total: number;
}

/** Manages rift boss lethal death zone visuals. Add to the renderer alongside
 * other ground-ring systems (ringOfFrostVisuals, etc.). */
export class RiftDeathZoneVisuals {
  private readonly zones = new Map<string, ZoneVisual>();
  private readonly hoardBossFx: HoardBossFx;
  private readonly hoardPresentation: HoardBossPresentation;
  private readonly hoardGestures: HoardBossGestures;
  private readonly hoardDressing: HoardBossDressing;
  private readonly hoardAccents: HoardEncounterAccents;
  private readonly hoardSpells: HoardSpellFx;
  private readonly hoardOrbital: HoardOrbitalLightning;
  private readonly hoardBoneReaper: HoardBoneReaperFx;
  private readonly hoardIceAge: HoardIceAgeFx;
  private readonly hoardPulsars: HoardPulsarFx;
  private readonly hoardForgeHammer: HoardForgeHammerFx;
  private readonly hoardTentacles: HoardTentaclesFx;
  private readonly hoardBoulder: HoardBoulderFx;
  private readonly hoardCocoon: HoardCocoonFx;
  private readonly hoardGoblinCoins: HoardGoblinCoinsFx;
  private readonly hoardMimicCoins: HoardMimicCoinsFx;
  // Dungeon trash telegraphs (the Hollow Crypt's cleaves, breaths, rings, bursts).
  private readonly cryptTrash: CryptTrashFx;
  // The Sunken Bastion's trash and boss floor telegraphs.
  private readonly bastionFx: BastionFx;
  // The Drowned Temple's trash and boss telegraphs, and the Mere Hydra's body.
  private readonly templeFx: TempleFx;
  // The trash kit's death-burst rings (any dungeon's kit mob that bursts).
  private readonly deathBursts: DeathBurstFx;
  // The Wildheart Basin's telegraphs and creature effects (the Saurian, the trash).
  private readonly wildheartFx: WildheartFx;
  private readonly cryptCreatures: CryptCreatureFx;
  // The Hollow Crypt finale: Morthen's entrance and the Knellwyrm.
  private readonly cryptFinale: CryptFinaleFx;
  // Morthen the Lich Bishop's own body effects and his stance gestures.
  private readonly morthenFx: MorthenFx;
  // Morthen's fight on the Rite Ring (telegraphs, ward, candles, souls, the
  // Grasp) and the Knellwyrm's heroic Burning Knell.
  private readonly morthenRite: MorthenRiteFx;
  // The Hollow Crypt's wing bosses: Sexton Marrow, the Lady of the Bonechill,
  // Cantor Ilvane (their telegraphs, hazards and spell effects).
  private readonly cryptBosses: CryptBossFx;
  // The Gravewyrm Sanctum's telegraphs and creature effects (the Sledge
  // Tusker and its sledge, the trash).
  private readonly sanctumFx: SanctumFx;
  // The Gravewyrm Sanctum's three bosses: chains, plates, meltwater, telegraphs.
  private readonly sanctumBosses: SanctumBossFx;
  // The trash engine's generic pieces in any dungeon (hazard pools, combat
  // walls, walker orbs, the sight-line nova, usable bodies, freeze, brands).
  private readonly trashEngine: TrashEngineFx;
  // A boss's summoned dead rising as they land, in any zone (summon_rise_fx.ts).
  private readonly summonRise: SummonRiseFx;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly world?: IWorld,
    shake?: (amount: number) => void,
    reducedMotion?: () => boolean,
    playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.hoardGestures = new HoardBossGestures(world, playGesture);
    this.hoardBossFx = new HoardBossFx(scene, groundY, compileGate);
    this.hoardPresentation = new HoardBossPresentation(world, shake);
    this.hoardDressing = new HoardBossDressing(scene, groundY, world, compileGate, reducedMotion);
    this.hoardAccents = new HoardEncounterAccents(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
    );
    this.hoardSpells = new HoardSpellFx(scene, groundY, compileGate, reducedMotion);
    this.hoardOrbital = new HoardOrbitalLightning(scene, groundY, compileGate, reducedMotion);
    this.hoardBoneReaper = new HoardBoneReaperFx(scene, groundY, world, compileGate, reducedMotion);
    this.hoardIceAge = new HoardIceAgeFx(scene, groundY, compileGate, reducedMotion, shake);
    this.hoardPulsars = new HoardPulsarFx(scene, groundY, world, compileGate, reducedMotion, shake);
    this.hoardForgeHammer = new HoardForgeHammerFx(
      scene,
      groundY,
      compileGate,
      reducedMotion,
      shake,
    );
    this.hoardTentacles = new HoardTentaclesFx(scene, groundY, compileGate, reducedMotion, shake);
    this.hoardBoulder = new HoardBoulderFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
    );
    this.hoardCocoon = new HoardCocoonFx(scene, groundY, world, compileGate, reducedMotion);
    this.hoardMimicCoins = new HoardMimicCoinsFx(scene, groundY, world, compileGate, reducedMotion);
    this.cryptTrash = new CryptTrashFx(scene, groundY, world, compileGate, reducedMotion, shake);
    this.bastionFx = new BastionFx(
      scene,
      groundY,
      world,
      compileGate,
      playGesture,
      reducedMotion,
      shake,
    );
    this.templeFx = new TempleFx(
      scene,
      groundY,
      world,
      compileGate,
      playGesture,
      shake,
      reducedMotion,
    );
    this.deathBursts = new DeathBurstFx(scene, groundY, world, compileGate);
    this.wildheartFx = new WildheartFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.cryptCreatures = new CryptCreatureFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
    );
    this.cryptFinale = new CryptFinaleFx(scene, groundY, world, compileGate, reducedMotion, shake);
    this.cryptBosses = new CryptBossFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.morthenFx = new MorthenFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.morthenRite = new MorthenRiteFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.sanctumFx = new SanctumFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.sanctumBosses = new SanctumBossFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
      shake,
      playGesture,
    );
    this.hoardGoblinCoins = new HoardGoblinCoinsFx(
      scene,
      groundY,
      world,
      compileGate,
      reducedMotion,
    );
    this.trashEngine = new TrashEngineFx(scene, groundY, world, compileGate, reducedMotion, shake);
    this.summonRise = new SummonRiseFx(playGesture);
  }

  /** Called each frame with the current zone list from IWorld.riftBossDeathZones().
   * Zones are keyed by position + radius (short-lived, so a simple position key
   * is sufficient; two coincident zones on the same tick are collapsed, which is
   * fine for gameplay). */
  sync(zones: readonly RiftBossDeathZoneView[], hoardCues: readonly HoardBossCueView[] = []): void {
    this.hoardPresentation.sync(hoardCues);
    this.hoardGestures.sync(hoardCues);
    this.hoardBossFx.setTheme(this.world?.riftFloor?.seed);
    this.hoardBossFx.sync(hoardCues);
    this.hoardDressing.sync(hoardCues);
    this.hoardAccents.sync(hoardCues);
    this.hoardSpells.sync(hoardCues);
    this.hoardOrbital.sync(hoardCues);
    this.hoardBoneReaper.sync(hoardCues);
    this.hoardIceAge.sync(hoardCues);
    this.hoardPulsars.sync(hoardCues);
    this.hoardForgeHammer.sync(hoardCues);
    this.hoardTentacles.sync(hoardCues);
    this.hoardBoulder.sync(hoardCues);
    this.hoardCocoon.sync(hoardCues);
    this.hoardMimicCoins.sync(hoardCues);
    const seen = new Set<string>();
    for (const z of zones) {
      const key = `${z.x.toFixed(1)}:${z.z.toFixed(1)}:${z.radius.toFixed(1)}`;
      seen.add(key);
      const existing = this.zones.get(key);
      if (existing) {
        existing.remaining = z.remaining;
        existing.total = z.total;
      } else {
        this.create(key, z);
      }
    }
    for (const [key, visual] of this.zones) {
      if (!seen.has(key)) {
        this.scene.remove(visual.group);
        visual.rimMat.dispose();
        visual.fillMat.dispose();
        visual.sweepMat.dispose();
        for (const geo of visual.ownedGeometries) geo.dispose();
        this.zones.delete(key);
      }
    }
  }

  /** Called each frame with the elapsed frame time in seconds. */
  update(dt: number): void {
    this.hoardBossFx.update(dt);
    this.hoardDressing.update(dt);
    this.hoardAccents.update(dt);
    this.hoardSpells.update(dt);
    this.hoardOrbital.update(dt);
    this.hoardBoneReaper.update(dt);
    this.hoardIceAge.update(dt);
    this.hoardPulsars.update(dt);
    this.hoardForgeHammer.update(dt);
    this.hoardTentacles.update(dt);
    this.hoardBoulder.update(dt);
    this.hoardCocoon.update(dt);
    this.hoardGoblinCoins.update(dt);
    this.hoardMimicCoins.update(dt);
    this.cryptTrash.update(dt);
    this.bastionFx.update(dt);
    this.templeFx.update(dt);
    this.deathBursts.update(dt);
    this.wildheartFx.update(dt);
    this.cryptCreatures.update(dt);
    this.cryptFinale.update(dt);
    this.cryptBosses.update(dt);
    this.morthenFx.update(dt);
    this.morthenRite.update(dt);
    this.sanctumFx.update(dt);
    this.sanctumBosses.update(dt);
    this.trashEngine.update(dt);
    this.summonRise.update(dt);
    for (const visual of this.zones.values()) {
      visual.phase = (visual.phase + dt * deathZonePulseSpeed(visual.remaining)) % (Math.PI * 2);
      const plan = deathZonePlan(visual.phase, visual.remaining, visual.total);
      visual.rimMat.opacity = plan.ringOpacity;
      visual.fillMat.opacity = plan.fillOpacity;
      visual.sweepMat.opacity = plan.sweepOpacity;
      // The sweep disc is built at full radius and scaled radially; the axis
      // triple comes from the core (the disc's radial plane is LOCAL x/y, so
      // local z stays 1; deathZoneSweepScale pins that in a Node test).
      const [sx, sy, sz] = deathZoneSweepScale(plan.sweepFraction);
      visual.sweep.scale.set(sx, sy, sz);
    }
  }

  dispose(): void {
    this.sync([]);
    this.hoardBossFx.dispose();
    this.hoardDressing.dispose();
    this.hoardAccents.dispose();
    this.hoardSpells.dispose();
    this.hoardOrbital.dispose();
    this.hoardBoneReaper.dispose();
    this.hoardIceAge.dispose();
    this.hoardPulsars.dispose();
    this.hoardForgeHammer.dispose();
    this.hoardTentacles.dispose();
    this.hoardBoulder.dispose();
    this.hoardCocoon.dispose();
    this.hoardGoblinCoins.dispose();
    this.hoardMimicCoins.dispose();
    this.cryptTrash.dispose();
    this.bastionFx.dispose();
    this.templeFx.dispose();
    this.deathBursts.dispose();
    this.wildheartFx.dispose();
    this.cryptCreatures.dispose();
    this.cryptFinale.dispose();
    this.cryptBosses.dispose();
    this.morthenFx.dispose();
    this.morthenRite.dispose();
    this.sanctumFx.dispose();
    this.sanctumBosses.dispose();
    this.trashEngine.dispose();
    this.hoardPresentation.dispose();
  }

  /** The drawn scale multiplier of a body (a fed Bastion Barnacle Crawler
   *  swells; 1 for every other body). O(1); the renderer asks it per body. */
  bodySwell(id: number): number {
    return this.bastionFx.bodySwell(id);
  }

  /** True when a dungeon effect claimed the event outright (the renderer
   *  then skips its generic draw of it). */
  handleEvent(event: SimEvent): boolean {
    this.hoardPresentation.handleEvent(event);
    const crypt = this.cryptTrash.handleEvent(event);
    this.cryptCreatures.handleEvent(event);
    this.cryptFinale.handleEvent(event);
    this.cryptBosses.handleEvent(event);
    this.morthenFx.handleEvent(event);
    this.morthenRite.handleEvent(event);
    const temple = this.templeFx.handleEvent(event);
    const basin = this.wildheartFx.handleEvent(event);
    const sanctum = this.sanctumFx.handleEvent(event);
    const sanctumBoss = this.sanctumBosses.handleEvent(event);
    const engine = this.trashEngine.handleEvent(event);
    this.summonRise.handleEvent(event);
    return (
      this.bastionFx.handleEvent(event) ||
      temple ||
      basin ||
      sanctum ||
      sanctumBoss ||
      engine ||
      crypt
    );
  }

  private create(key: string, zone: RiftBossDeathZoneView): void {
    // All ground sampling happens ONCE here (the renderer's groundY closure
    // regenerates the rift floor per call, so per-frame sampling is off the
    // table). The rim band and interior wash drape the terrain per vertex,
    // which keeps the decal on the floor across the raised-dais step (the
    // 2026-07-21 "invisible aoe circles" playtest bug).
    const group = new THREE.Group();
    group.name = 'rift-death-zone';
    const ownedGeometries: THREE.BufferGeometry[] = [];

    const rimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(BASE_COLOR).multiplyScalar(1.6),
      transparent: true,
      opacity: RING_MAX_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rimGeo = this.terrainRing(zone.x, zone.z, zone.radius * RIM_INNER_FRACTION, zone.radius);
    ownedGeometries.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.renderOrder = floorVfxRenderOrder('encounter', 9); // above terrain, below entities
    group.add(rim);

    // Fill and sweep blend NORMALLY (not additively) on purpose: an S-rank
    // deathZoneStrike barrage stacks one zone per living member, and additive
    // fills summed the overlaps to a white-out that erased the zone EDGES,
    // the one thing a player needs to find (verified with a five-zone
    // capture). Alpha blending converges toward the fill color instead, so
    // any number of overlaps stays readable; the thin rim band keeps its
    // additive glow (overlap area is small and a brighter crossing helps).
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(BASE_COLOR).multiplyScalar(1.3),
      transparent: true,
      opacity: FILL_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fillGeo = this.terrainDisc(zone.x, zone.z, zone.radius * RIM_INNER_FRACTION);
    ownedGeometries.push(fillGeo);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.renderOrder = floorVfxRenderOrder('encounter', 8);
    group.add(fill);

    // The timer sweep: a flat disc at the zone center's ground height, scaled
    // out to the rim as the fuse elapses. Flat (not terrain-draped) because it
    // rescales every frame; rift boss floors are flat apart from the dais
    // step, and the center height is the right one where the sweep starts.
    const sweepMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(SWEEP_COLOR).multiplyScalar(1.4),
      transparent: true,
      opacity: SWEEP_BASE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sweepGeo = new THREE.CircleGeometry(zone.radius, SEGMENTS);
    ownedGeometries.push(sweepGeo);
    const sweep = new THREE.Mesh(sweepGeo, sweepMat);
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.set(zone.x, this.groundY(zone.x, zone.z) + SWEEP_LIFT, zone.z);
    const [sx, sy, sz] = deathZoneSweepScale(0);
    sweep.scale.set(sx, sy, sz);
    sweep.renderOrder = floorVfxRenderOrder('encounter', 10);
    group.add(sweep);

    this.scene.add(group);
    this.zones.set(key, {
      group,
      rimMat,
      fillMat,
      sweepMat,
      sweep,
      ownedGeometries,
      phase: 0,
      remaining: zone.remaining,
      total: zone.total,
    });
  }

  /** Terrain-draped annulus band (mage_ground_fx's createTerrainRing shape). */
  private terrainRing(
    x: number,
    z: number,
    innerRadius: number,
    outerRadius: number,
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      for (const radius of [innerRadius, outerRadius]) {
        const sx = x + Math.cos(angle) * radius;
        const sz = z + Math.sin(angle) * radius;
        vertices.push(sx, this.groundY(sx, sz) + GROUND_LIFT, sz);
      }
      if (segment < SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  /** Terrain-draped disc fan (center vertex plus a sampled rim per segment). */
  private terrainDisc(x: number, z: number, radius: number): THREE.BufferGeometry {
    const vertices: number[] = [x, this.groundY(x, z) + GROUND_LIFT, z];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const sx = x + Math.cos(angle) * radius;
      const sz = z + Math.sin(angle) * radius;
      vertices.push(sx, this.groundY(sx, sz) + GROUND_LIFT, sz);
      if (segment < SEGMENTS) indices.push(0, segment + 1, segment + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }
}
