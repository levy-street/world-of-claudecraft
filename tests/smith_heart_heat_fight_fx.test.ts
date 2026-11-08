// The Guardian of the Heat's fight effects (the pure plan
// src/render/smith_heart_fx/heat_fight_fx_core.ts and its painter
// heat_fight_fx.ts with its parts heat_well_fx.ts and heat_cinder_fx.ts):
// the fight's objects decode to their kinds, it claims every one of its cues,
// the wellspring heaves over its lip when it overflows, a river's lane fills
// before its fire runs, a Hearthseed throbs faster to its burst, a Wakefire
// band builds then erupts, a Rolling Cinder plunges out of the smoke, a
// burning patch catches and dies; the painter over a fake world shows the
// pool, every footprint (rivers, seeds, bands, falls, patches) and Hearth
// Flare's bolt, claims its cues, disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import {
  fallLook,
  HEAT_FIGHT_POOLS,
  HEAT_WELL,
  heatFightClaims,
  heatObjectKind,
  patchLook,
  riverLook,
  SEED_CORE_R,
  seedLook,
  wellLook,
  zoneLook,
  zoneRadii,
} from '../src/render/smith_heart_fx/heat_fight_fx_core';
import { HEAT_METEOR } from '../src/render/smith_heart_fx/heat_meteor_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_MOBS,
  HEAT_OBJECTS,
  heatTimed,
  riverTemplate,
  swellLaneTemplate,
  HEAT_TUNING as T,
  wellTemplate,
  ZONE_BANDS,
  zoneTemplate,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('heat_fight_fx_core: the fight in the Hearth', () => {
  it("decodes every one of the fight's objects to its kind, and nothing else", () => {
    expect(heatObjectKind(wellTemplate('calm'))).toBe('well');
    expect(heatObjectKind(wellTemplate('over'))).toBe('well');
    expect(heatObjectKind(heatTimed(HEAT_OBJECTS.fistPrefix, 3))).toBe('fist');
    expect(heatObjectKind(swellLaneTemplate('warn', 3.6))).toBe('lane');
    expect(heatObjectKind(HEAT_OBJECTS.wave)).toBe('wave');
    expect(heatObjectKind(riverTemplate('flow', 3))).toBe('river');
    expect(heatObjectKind(heatTimed(HEAT_OBJECTS.seedPrefix, T.seedLife))).toBe('seed');
    expect(heatObjectKind(zoneTemplate(1, 'warn', T.zoneWarn))).toBe('zone');
    expect(heatObjectKind(heatTimed(HEAT_OBJECTS.fallPrefix, 2))).toBe('fall');
    expect(heatObjectKind(heatTimed(HEAT_OBJECTS.scorchPrefix, 8))).toBe('scorch');
    expect(heatObjectKind(heatTimed(HEAT_OBJECTS.trailPrefix, 15))).toBe('trail');
    expect(heatObjectKind('sh_heat_well_boil')).toBeNull();
    expect(heatObjectKind('sh_heat_crystal_20')).toBeNull();
    expect(heatObjectKind('sh_quench_hole')).toBeNull();
    expect(heatObjectKind('mailbox')).toBeNull();
  });

  it('claims every cue of its own and nothing else', () => {
    for (const cue of Object.values(HEAT_CUES)) expect(heatFightClaims(cue), cue).toBe(true);
    expect(heatFightClaims('fireball')).toBe(false);
    expect(heatFightClaims(null)).toBe(false);
    expect(heatFightClaims(undefined)).toBe(false);
  });

  it('sits the pool on the sim wellspring; it boils deeper and heaves over its lip', () => {
    expect(HEAT_WELL).toEqual({ x: HEARTH_WELL.x, z: HEARTH_WELL.z, r: HEARTH_WELL.r });
    const p1 = wellLook('calm', 1, 0);
    const p3 = wellLook('calm', 3, 0);
    expect(p3.heat).toBeGreaterThan(p1.heat);
    expect(p3.boil).toBeGreaterThan(p1.boil);
    expect(p1.surge).toBe(0);
    for (let t = 0; t < 4; t += 0.1) {
      const over = wellLook('over', 2, t);
      expect(over.surge).toBeGreaterThanOrEqual(0.6 - 1e-9);
      expect(over.surge).toBeLessThanOrEqual(1 + 1e-9);
      expect(over.heat).toBeGreaterThan(p3.heat);
    }
  });

  it("fills a river's lane, then runs its fire down it and lets it die", () => {
    expect(riverLook('warn', 0, T.riverWarn)).toMatchObject({ fill: 0, lane: true, front: 0 });
    expect(riverLook('warn', T.riverWarn / 2, T.riverWarn).fill).toBeCloseTo(0.5, 9);
    expect(riverLook('flow', 0, T.riverFlow).front).toBe(0);
    expect(riverLook('flow', 1, T.riverFlow).front).toBe(1);
    expect(riverLook('flow', 1, T.riverFlow).lane).toBe(true);
    expect(riverLook('flow', T.riverFlow, T.riverFlow).heat).toBe(0);
    expect(riverLook('flow', T.riverFlow, T.riverFlow).lane).toBe(false);
  });

  it('throbs a seed faster to its burst, its fill on the sim clock', () => {
    expect(seedLook(0, T.seedLife).fill).toBe(0);
    expect(seedLook(T.seedLife / 2, T.seedLife).fill).toBeCloseTo(0.5, 9);
    expect(seedLook(T.seedLife, T.seedLife).fill).toBe(1);
    // Beats in the first and in the last second: more at the end.
    const beats = (from: number) => {
      let n = 0;
      let prev = seedLook(from, T.seedLife).beat;
      let rising = false;
      for (let t = from; t < from + 1; t += 0.005) {
        const b = seedLook(t, T.seedLife).beat;
        if (b > prev) rising = true;
        else if (rising && b < prev) {
          n++;
          rising = false;
        }
        prev = b;
      }
      return n;
    };
    expect(beats(T.seedLife - 1)).toBeGreaterThan(beats(0.5));
    expect(seedLook(T.seedLife - 0.1, T.seedLife).size).toBeGreaterThan(
      seedLook(1, T.seedLife).size,
    );
    expect(SEED_CORE_R).toBeLessThan(T.seedReach);
  });

  it('builds a Wakefire band, then erupts and dies down; its rings are the sim bands', () => {
    expect(zoneLook('warn', 0, T.zoneWarn)).toEqual({ build: 0, burn: 0 });
    expect(zoneLook('warn', T.zoneWarn, T.zoneWarn).build).toBe(1);
    expect(zoneLook('burn', 0.2, T.zoneBurn).burn).toBeGreaterThan(0.8);
    expect(zoneLook('burn', T.zoneBurn, T.zoneBurn).burn).toBeLessThan(0.5);
    for (let b = 0; b < ZONE_BANDS.length; b++) expect(zoneRadii(b)).toEqual(ZONE_BANDS[b]);
    expect(zoneRadii(-1)).toEqual(ZONE_BANDS[0]);
    expect(zoneRadii(99)).toEqual(ZONE_BANDS[ZONE_BANDS.length - 1]);
  });

  it('plunges a cinder out of the smoke; a patch catches and dies', () => {
    expect(fallLook(0, T.cinderFallWarn).height).toBe(40);
    expect(fallLook(T.cinderFallWarn, T.cinderFallWarn)).toEqual({ height: 0, fill: 1 });
    let last = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= T.cinderFallWarn; t += 0.1) {
      const h = fallLook(t, T.cinderFallWarn).height;
      expect(h).toBeLessThanOrEqual(last + 1e-9);
      last = h;
    }
    expect(patchLook(0, 15)).toBe(0);
    expect(patchLook(5, 15)).toBe(1);
    expect(patchLook(15, 15)).toBe(0);
  });

  it('pools every footprint the sim can keep at once', () => {
    expect(HEAT_FIGHT_POOLS.rivers).toBeGreaterThanOrEqual(T.riverCount);
    expect(HEAT_FIGHT_POOLS.seeds).toBeGreaterThanOrEqual(T.seedCap);
    expect(HEAT_FIGHT_POOLS.zones).toBeGreaterThanOrEqual(ZONE_BANDS.length);
    expect(HEAT_FIGHT_POOLS.falls).toBeGreaterThanOrEqual(T.cinderCap);
    expect(HEAT_FIGHT_POOLS.cinders).toBeGreaterThanOrEqual(T.cinderCap);
    expect(HEAT_FIGHT_POOLS.patches).toBeGreaterThanOrEqual(T.trailCap + T.scorchCap);
    expect(HEAT_FIGHT_POOLS.bodies).toBeGreaterThanOrEqual(HEAT_DIFFICULTY.heroic.bolts);
  });
});

describe('HeatFightFx over a fake world', () => {
  it('shows the pool and every footprint, bolts Hearth Flare, claims its cues, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    let nextId = 1;
    const entity = (kind: string, templateId: string, x: number, z: number, scale = 1) =>
      ({
        id: nextId++,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: Math.PI / 2,
        scale,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
        castingAbility: null as string | null,
        castTargetId: null,
        castRemaining: 0,
        castTotal: 0,
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => {
      entities.set(e.id, e);
      return e;
    };
    const me = add(entity('player', 'warrior', -206, 2));
    const far = add(entity('player', 'mage', -186, 10));
    const boss = add(entity('mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z));
    const well = add(entity('object', wellTemplate('calm'), HEARTH_WELL.x, HEARTH_WELL.z));
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const bump = () => {
      (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    };
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    const shown = (name: string) => {
      let n = 0;
      scene.traverse((c) => {
        if (c.name === name && c.visible) n++;
      });
      return n;
    };
    run(4);
    const root = scene.getObjectByName('smith-heart-heat-fight-fx');
    expect(root).toBeDefined();
    expect(shown('smithHeartHeatWellPool')).toBe(1);
    expect(shown('smithHeartHeatRiver')).toBe(0);
    // The overflow: the pool heaves, a river's lane, then its fire.
    well.templateId = wellTemplate('over');
    const river = add(
      entity('object', riverTemplate('warn', T.riverWarn), HEARTH_WELL.x + 8, 0, T.riverHalf),
    );
    bump();
    run(4);
    river.templateId = riverTemplate('flow', T.riverFlow);
    run(6);
    expect(shown('smithHeartHeatRiver')).toBe(1);
    // The melee's shore terrace lies round the pool.
    expect(shown('smithHeartHeatWellShore')).toBe(1);
    // The guardian throws the seeds: a meteor per seed, in the air until the
    // sim lands it, its orb only then (the footprint shows from the throw).
    expect(
      fx.handleEvent({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: boss.id,
        school: 'fire',
        fx: 'nova',
        ability: HEAT_CUES.seedThrow,
      } as SimEvent),
    ).toBe(true);
    // Seeds under the raid, a Wakefire band, a cinder's fall, a trail patch.
    add(entity('object', heatTimed(HEAT_OBJECTS.seedPrefix, T.seedLife), -204, 4, T.seedReach));
    add(entity('object', heatTimed(HEAT_OBJECTS.seedPrefix, T.seedLife), -200, -4, T.seedReach));
    bump();
    run(4);
    expect(shown('smithHeartHeatSeedField')).toBe(1);
    expect(shown('smithHeartHeatSeeds')).toBe(0);
    // Past the release, before the landing: both meteors fly.
    run(Math.ceil((HEAT_METEOR.release + 0.15) * 20) - 4);
    expect(shown('smithHeartHeatMeteors')).toBe(1);
    let flying = 0;
    scene.traverse((c) => {
      if (c instanceof THREE.Sprite && c.visible && c.material.name === 'smithHeartHeatMeteorGlow')
        flying++;
    });
    expect(flying).toBe(2);
    expect(shown('smithHeartHeatSeeds')).toBe(0);
    // The sim lands one: it strikes now, its crater glows, its orb shows.
    expect(
      fx.handleEvent({
        type: 'spellfxAt',
        x: o.x - 204,
        z: o.z + 4,
        radius: 1.5,
        school: 'fire',
        fx: 'burst',
        ability: HEAT_CUES.seed,
      } as unknown as SimEvent),
    ).toBe(true);
    run(1);
    expect(shown('smithHeartHeatMeteorCrater')).toBe(1);
    expect(shown('smithHeartHeatSeeds')).toBe(1);
    // The other lands on its own beat.
    run(Math.ceil((HEAT_METEOR.land - HEAT_METEOR.release) * 20) + 2);
    expect(shown('smithHeartHeatMeteorCrater')).toBe(2);
    expect(shown('smithHeartHeatMeteors')).toBe(0);
    add(entity('object', zoneTemplate(1, 'warn', T.zoneWarn), HEARTH_WELL.x, HEARTH_WELL.z));
    add(entity('object', heatTimed(HEAT_OBJECTS.fallPrefix, T.cinderFallWarn), -196, 0, 3));
    add(entity('object', heatTimed(HEAT_OBJECTS.trailPrefix, T.trailLife), -205, 6, T.trailR));
    add(entity('mob', HEAT_MOBS.cinder, -190, 0));
    bump();
    run(8);
    expect(shown('smithHeartHeatSeeds')).toBe(1);
    expect(shown('smithHeartHeatWakefire')).toBe(1);
    expect(shown('smithHeartHeatPatches')).toBe(1);
    expect(shown('smithHeartHeatCinder')).toBeGreaterThanOrEqual(1);
    // Hearth Flare strikes the far player: claimed, a bolt from the guardian.
    const flare = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: far.id,
      school: 'fire',
      fx: 'beam',
      ability: HEAT_CUES.flare,
    } as SimEvent;
    expect(fx.handleEvent(flare)).toBe(true);
    run(2);
    expect(shown('smithHeartHeatFlare')).toBe(1);
    const burst = {
      type: 'spellfxAt',
      x: o.x - 204,
      z: o.z + 4,
      radius: T.seedReach,
      school: 'fire',
      fx: 'burst',
      ability: HEAT_CUES.seedBurst,
    } as unknown as SimEvent;
    expect(fx.handleEvent(burst)).toBe(true);
    expect(fx.handleEvent({ ...flare, ability: 'fireball' } as SimEvent)).toBe(false);
    // Out of the Hearth: everything goes.
    me.pos = { x: o.x + 400, y: 0, z: o.z };
    run(20);
    expect(shown('smithHeartHeatWellPool')).toBe(0);
    expect(shown('smithHeartHeatSeeds')).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-heat-fight-fx')).toBeUndefined();
  });
});
