// The trash engine's visuals (src/render/trash_engine_fx, plan:
// trash_engine_fx_core.ts) and the Sanctum mechanics pass's creature layer
// (src/render/gravewyrm_sanctum_fx/sanctum_kit_fx.ts): the catalog swept from
// the kits, the encounter objects' empty anchors, the hazard looks, the wall
// built to its collider, the line-of-sight nova's sight reach measured with the
// sim's own sight test (a combat wall carves its shadow), the wave, the use
// hint, the freeze and encase timelines, the brand, the quench pools' world
// placement, the Sanctum's new telegraph specs, and a smoke run of the whole
// coordinator over a fake world (build, scan, events, frames, dispose).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRAZIER_TOPPLED_GESTURE,
  sanctumCreatureLooks,
} from '../src/render/characters/sanctum_creature_looks';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { gateObjectPlan } from '../src/render/gate_objects';
import {
  eruption,
  lashSweep,
  sanctumDrawnHeight,
  sanctumTelegraphSpecs,
  TOPPLE_TILT,
  telegraphYaw,
  toppleTilt,
} from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_core';
import { TrashEngineFx } from '../src/render/trash_engine_fx';
import {
  buildIceSlabShellGeometry,
  SLAB_OVERHANG,
} from '../src/render/trash_engine_fx/ice_slab_geometry';
import {
  buildEngineCatalog,
  ENCASE_GROW_SECONDS,
  engineCatalog,
  hazardLook,
  hazardPresence,
  iceEncase,
  isTrashEngineObject,
  NOVA_WAVE_SECONDS,
  novaCastLook,
  novaWave,
  quenchPoolsAt,
  rimeCrystals,
  rimeIntensity,
  SCHOOL_TINT,
  sightReach,
  USE_HINT_RANGE,
  useHint,
  WALL_DROP_SECONDS,
  wallBox,
  wallLife,
} from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { lineOfSightClear } from '../src/sim/colliders';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  GLACIER_SPLINTER_ID,
  RIME_WHELP_ID,
  SCALEGUARD_ID,
  SOUL_BRAZIER_ID,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import {
  COMBAT_WALL_SHAPES,
  clearCombatWallStateForTest,
  setCombatWalls,
} from '../src/sim/instances/combat_wall_state';
import {
  TRASH_DEMO_EMPOWERED,
  TRASH_DEMO_NOVA,
  TRASH_DEMO_NOVA_UNSTOPPABLE,
  TRASH_DEMO_WALKER,
  TRASH_DEMO_WALKER_ORB,
  TRASH_ENGINE_DEMO_KIT,
} from '../src/sim/mob/trash_kit/engine_demo';
import {
  SANCTUM_BOILING_MELTWATER,
  SANCTUM_BRANDED,
  SANCTUM_BRANDING_IRON,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_CREEPING_RIME,
  SANCTUM_ICE_SLAB,
  SANCTUM_ICED_OVER,
  SANCTUM_RIME_BREATH,
  SANCTUM_SPILLED_SOULFIRE,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import type { IWorld } from '../src/world_api';

const SANCTUM = 'gravewyrm_sanctum';

afterEach(() => clearCombatWallStateForTest());

describe('the trash engine catalog', () => {
  const c = engineCatalog();

  it('sweeps every engine record the renderer keys on out of the kits', () => {
    expect(c.hazards.get(SANCTUM_BOILING_MELTWATER)?.hits).toBe('players');
    expect(c.hazards.get(SANCTUM_SPILLED_SOULFIRE)?.hits).toBe('mobs');
    expect(c.wallSeconds.get(SANCTUM_ICE_SLAB)).toBe(15);
    expect(c.walkers.get(TRASH_DEMO_WALKER_ORB)?.castId).toBe(TRASH_DEMO_WALKER);
    expect(c.walkerCasts.has(TRASH_DEMO_WALKER)).toBe(true);
    expect(c.empowerAuras.has(TRASH_DEMO_EMPOWERED)).toBe(true);
    expect(c.novas.has(TRASH_DEMO_NOVA)).toBe(true);
    expect(c.novas.has(TRASH_DEMO_NOVA_UNSTOPPABLE)).toBe(true);
    expect(c.freezeStacks.get(SANCTUM_CREEPING_RIME)?.maxStacks).toBe(5);
    expect(c.freezeAuras.get(SANCTUM_ICED_OVER)?.auraId).toBe(SANCTUM_CREEPING_RIME);
    expect(c.brandAuras.has(SANCTUM_BRANDED)).toBe(true);
    expect(c.uses.get(SANCTUM_TOPPLE_BRAZIER)?.range).toBe(4);
  });

  it('never lists a heal-only walker empower as a lingering aura', () => {
    const kit = {
      walker: {
        ...TRASH_ENGINE_DEMO_KIT.walker,
        empower: { auraId: 'heal_only', name: 'x', damagePct: 0, seconds: 0, healPct: 0.1 },
      },
    } as typeof TRASH_ENGINE_DEMO_KIT;
    expect(buildEngineCatalog([kit]).empowerAuras.has('heal_only')).toBe(false);
  });

  it('gives every engine object an empty anchor (the engine draws it)', () => {
    for (const t of [
      SANCTUM_ICE_SLAB,
      SANCTUM_BOILING_MELTWATER,
      SANCTUM_SPILLED_SOULFIRE,
      TRASH_DEMO_WALKER_ORB,
    ]) {
      expect(isTrashEngineObject(t), t).toBe(true);
      expect(gateObjectPlan({ templateId: t, dungeonId: SANCTUM, pos: { x: 0, z: 0 } }), t).toEqual(
        {
          encounterAnchor: true,
          height: 2,
        },
      );
    }
    expect(isTrashEngineObject('sanctum_boneguard')).toBe(false);
  });
});

describe('hazard pools', () => {
  const c = engineCatalog();
  const def = (t: string) => {
    const d = c.hazards.get(t);
    if (!d) throw new Error(`no hazard ${t}`);
    return d;
  };

  it('rims the players pool in the danger colour and keeps the groups weapon off the threat palette', () => {
    const melt = hazardLook(SANCTUM_BOILING_MELTWATER, def(SANCTUM_BOILING_MELTWATER));
    expect(melt.style).toBe('meltwater');
    expect(melt.danger).toBe(true);
    expect(melt.rim).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(melt.seconds).toBe(5);
    const soul = hazardLook(SANCTUM_SPILLED_SOULFIRE, def(SANCTUM_SPILLED_SOULFIRE));
    expect(soul.style).toBe('soulfire');
    expect(soul.danger).toBe(false);
    expect(Object.values(TELEGRAPH_THREAT_COLORS)).not.toContain(soul.rim);
    expect(soul.seconds).toBe(8);
  });

  it('falls back to a school-tinted disc for an unknown pool', () => {
    const nature = { ...def(SANCTUM_BOILING_MELTWATER), school: 'nature' as const };
    const look = hazardLook('some_new_pool', nature);
    expect(look.style).toBe('generic');
    expect(look.tint).toBe(SCHOOL_TINT.nature);
  });

  it('spreads in fast and never fades out before the sim lifts it', () => {
    expect(hazardPresence(0, 5)).toBe(0);
    expect(hazardPresence(0.5, 5)).toBe(1);
    expect(hazardPresence(4.99, 5)).toBeGreaterThanOrEqual(0.3);
  });
});

describe('combat walls', () => {
  it('stands as its collider box times its scale', () => {
    const shape = COMBAT_WALL_SHAPES[SANCTUM_ICE_SLAB];
    expect(wallBox(SANCTUM_ICE_SLAB, 1)).toEqual(shape);
    expect(wallBox(SANCTUM_ICE_SLAB, 2)).toEqual({
      hw: shape.hw * 2,
      hd: shape.hd * 2,
      height: shape.height * 2,
    });
    expect(wallBox('no_such_wall', 1)).toBeNull();
  });

  it('builds the slab over the footprint the sim blocks, never much past it', () => {
    const box = wallBox(SANCTUM_ICE_SLAB, 1);
    if (!box) throw new Error('no slab box');
    const geo = buildIceSlabShellGeometry(box);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) throw new Error('no bounding box');
    // The tilt adds a hand at the top; the faces may bulge a hand out.
    const slack = SLAB_OVERHANG + 0.12;
    expect(bb.max.x).toBeLessThanOrEqual(box.hw + slack);
    expect(bb.min.x).toBeGreaterThanOrEqual(-box.hw - slack);
    expect(bb.max.z).toBeLessThanOrEqual(box.hd + slack);
    expect(bb.min.z).toBeGreaterThanOrEqual(-box.hd - slack);
    // ...and covers it: the drawn body is not visibly smaller than the wall.
    expect(bb.max.x - bb.min.x).toBeGreaterThan(box.hw * 2 - 0.4);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(box.hd * 2 - 0.4);
    expect(bb.max.y).toBeGreaterThan(box.height - 0.5);
    expect(bb.max.y).toBeLessThan(box.height + 0.5);
    geo.dispose();
  });

  it('crashes down, settles, and strains toward its shatter', () => {
    const out = { drop: 0, squash: 1, strain: 0 };
    expect(wallLife(0, 15, 3.4, out).drop).toBeCloseTo(3.4 * 0.9);
    expect(wallLife(WALL_DROP_SECONDS, 15, 3.4, out).drop).toBe(0);
    expect(wallLife(5, 15, 3.4, out).strain).toBe(0);
    expect(wallLife(15, 15, 3.4, out).strain).toBe(1);
  });
});

describe('the line-of-sight nova', () => {
  it('bisects a ray to its first block, and keeps an open ray whole', () => {
    expect(sightReach(() => true, 20)).toBe(20);
    const reach = sightReach((d) => d < 7.3, 20);
    // Conservative: the shadow never starts before the true block.
    expect(reach).toBeGreaterThanOrEqual(7.3);
    expect(reach).toBeLessThan(7.3 + 20 / 2 ** 5);
  });

  it('carves the shadow of a combat wall with the sim sight test itself', () => {
    const def = DUNGEONS[SANCTUM];
    const o = instanceOrigin(def.index, 0);
    // The Thaw Works' upper terrace: a wide flat floor (tests/trash_engine.test.ts).
    const from = { x: o.x, y: groundHeight(o.x, o.z + 42, WORLD_SEED), z: o.z + 42 };
    const to = { x: 0, z: 0 };
    const ray = (dx: number, dz: number) =>
      sightReach((d) => {
        to.x = from.x + dx * d;
        to.z = from.z + dz * d;
        return lineOfSightClear(WORLD_SEED, from, to, 0.05);
      }, 12);
    const open = ray(0, 1);
    expect(open).toBe(12);
    setCombatWalls(o.x, o.z, [
      { id: 1, templateId: SANCTUM_ICE_SLAB, x: 0, z: 42 + 6, y: from.y, rot: 0, scale: 1 },
    ]);
    const blocked = ray(0, 1);
    const hd = COMBAT_WALL_SHAPES[SANCTUM_ICE_SLAB].hd;
    expect(blocked).toBeLessThan(6);
    expect(blocked).toBeGreaterThan(6 - hd - 0.8);
    // A ray the other way never sees the wall.
    expect(ray(0, -1)).toBeGreaterThan(blocked);
  });

  it('draws the kickable bar with the danger rim and the unstoppable one lethal', () => {
    const kick = novaCastLook(TRASH_ENGINE_DEMO_KIT, TRASH_DEMO_NOVA);
    expect(kick?.kickable).toBe(true);
    expect(kick?.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(kick?.radius).toBe(TRASH_ENGINE_DEMO_KIT.nova?.radius);
    const hard = novaCastLook(TRASH_ENGINE_DEMO_KIT, TRASH_DEMO_NOVA_UNSTOPPABLE);
    expect(hard?.kickable).toBe(false);
    expect(hard?.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(novaCastLook(TRASH_ENGINE_DEMO_KIT, 'something_else')).toBeNull();
    expect(novaCastLook(undefined, TRASH_DEMO_NOVA)).toBeNull();
  });

  it('races the wave out to the radius, then lets it go', () => {
    expect(novaWave(0, 20).front).toBe(0);
    expect(novaWave(NOVA_WAVE_SECONDS, 20).front).toBeCloseTo(20);
    expect(novaWave(NOVA_WAVE_SECONDS * 0.5, 20).front).toBeGreaterThan(10);
    expect(novaWave(NOVA_WAVE_SECONDS + 5, 20).alpha).toBe(0);
  });
});

describe('usable bodies, freeze stacks, the encase', () => {
  it('hints the use within its range and lights the ring inside its reach', () => {
    const out = { glyph: 0, ring: 0, inReach: false };
    expect(useHint(USE_HINT_RANGE + 1, 4, out).glyph).toBe(0);
    expect(useHint(8, 4, out).glyph).toBe(1);
    expect(useHint(8, 4, out).inReach).toBe(false);
    expect(useHint(3, 4, out).inReach).toBe(true);
  });

  it('grows rime with the stacks, full one short of the freeze', () => {
    expect(rimeIntensity(0, 5)).toBe(0);
    expect(rimeIntensity(1, 5)).toBeCloseTo(0.25);
    expect(rimeIntensity(4, 5)).toBe(1);
    expect(rimeCrystals(0.01, 14)).toBe(1);
    expect(rimeCrystals(1, 14)).toBe(14);
    expect(rimeCrystals(0, 14)).toBe(0);
  });

  it('slams the ice shut fast and cracks it as the stun ends', () => {
    const out = { grow: 0, crack: 0 };
    expect(iceEncase(0, 2, out).grow).toBe(0);
    expect(iceEncase(ENCASE_GROW_SECONDS, 2, out).grow).toBe(1);
    expect(iceEncase(1, 1.5, out).crack).toBe(0);
    expect(iceEncase(1.9, 0, out).crack).toBe(1);
  });
});

describe('quench pools', () => {
  it('lays the dungeon pools at the slot origin', () => {
    const def = DUNGEONS[SANCTUM];
    const zones = def.quenchZones ?? [];
    expect(zones.length).toBeGreaterThan(0);
    const o = instanceOrigin(def.index, 2);
    expect(quenchPoolsAt(SANCTUM, 2)).toEqual(
      zones.map((q) => ({ x: o.x + q.x, z: o.z + q.z, r: q.r })),
    );
    expect(quenchPoolsAt('no_such_dungeon', 0)).toEqual([]);
  });
});

describe('the Sanctum mechanics pass telegraphs', () => {
  const specs = sanctumTelegraphSpecs();

  it('lays the Counterweight Lash behind the Scaleguard, as the template tests it', () => {
    const lash = MOBS[SCALEGUARD_ID].trashKit?.tailLash;
    const spec = specs[SANCTUM_COUNTERWEIGHT_LASH];
    expect(spec.shape).toBe('cone');
    expect(spec.range).toBe(lash?.range);
    expect(spec.arcDeg).toBe(lash?.arcDeg);
    expect(spec.behind).toBe(true);
    expect(spec.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(telegraphYaw(spec, 0.4)).toBeCloseTo(0.4 + Math.PI);
    // The breath still opens forward: together they leave the flanks.
    expect(telegraphYaw(specs.sanctum_cinder_breath, 0.4)).toBe(0.4);
  });

  it('paints the Rime Breath across the whelp front', () => {
    const cone = MOBS[RIME_WHELP_ID].trashKit?.cone;
    const spec = specs[SANCTUM_RIME_BREATH];
    expect(spec.range).toBe(cone?.range);
    expect(spec.arcDeg).toBe(cone?.arcDeg);
    expect(spec.behind).toBeFalsy();
  });

  it('marks Thaw the Held and the Branding Iron with the kick glyph', () => {
    for (const id of [SANCTUM_THAW_THE_HELD, SANCTUM_BRANDING_IRON]) {
      expect(specs[id].shape).toBe('sigil');
      expect(specs[id].color).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
  });

  it('times the sweep, the fall and the eruption', () => {
    expect(lashSweep(0).edge).toBe(0);
    expect(lashSweep(10).alpha).toBe(0);
    expect(toppleTilt(0).tilt).toBe(0);
    expect(toppleTilt(5)).toEqual({ tilt: TOPPLE_TILT, landed: true });
    expect(eruption(0.3).rise).toBe(1);
    expect(eruption(10).alpha).toBe(0);
  });

  it('draws a split Glacier Splinter at 72 percent of its drawn height', () => {
    const base = MOBS[GLACIER_SPLINTER_ID].scale ?? 1;
    const split = MOBS[GLACIER_SPLINTER_ID].trashKit?.split?.scale ?? 1;
    expect(sanctumDrawnHeight(GLACIER_SPLINTER_ID, base * split)).toBeCloseTo(
      sanctumDrawnHeight(GLACIER_SPLINTER_ID, base) * split,
    );
  });

  it('hides a toppled Soul Brazier whole (the fx draw it fallen)', () => {
    const def = sanctumCreatureLooks({}).sanctum_soul_brazier;
    expect(def.meshToggles).toEqual([{ nodes: ['*'], hideNow: BRAZIER_TOPPLED_GESTURE }]);
    expect(MOBS[SOUL_BRAZIER_ID].trashKit?.usable?.castId).toBe(SANCTUM_TOPPLE_BRAZIER);
  });
});

describe('TrashEngineFx over a fake world', () => {
  function entity(
    id: number,
    kind: Entity['kind'],
    templateId: string,
    x: number,
    z: number,
  ): Entity {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0.3,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it('builds, scans every piece, routes the beats, paints frames and disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 0, 0);
    me.auras.push(
      { id: SANCTUM_CREEPING_RIME, stacks: 3, remaining: 5 } as Entity['auras'][number],
      { id: SANCTUM_BRANDED, remaining: 9 } as Entity['auras'][number],
    );
    entities.set(me.id, me);
    const slab = entity(2, 'object', SANCTUM_ICE_SLAB, 6, 0);
    const pool = entity(3, 'object', SANCTUM_BOILING_MELTWATER, -5, 2);
    pool.scale = 3.5;
    const spill = entity(4, 'object', SANCTUM_SPILLED_SOULFIRE, -5, -6);
    spill.scale = 4.5;
    const orb = entity(5, 'object', TRASH_DEMO_WALKER_ORB, 3, 4);
    const caster = entity(6, 'mob', 'sanctum_boneguard', 0, 10);
    caster.devTrashKit = TRASH_ENGINE_DEMO_KIT;
    caster.castingAbility = TRASH_DEMO_NOVA;
    caster.castTotal = 2.5;
    caster.castRemaining = 1.5;
    const brazier = entity(7, 'mob', SOUL_BRAZIER_ID, 2, -2);
    for (const e of [slab, pool, spill, orb, caster, brazier]) entities.set(e.id, e);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      cfg: { seed: WORLD_SEED, playerClass: 'warrior' },
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new TrashEngineFx(scene, () => 0, world);
    for (let i = 0; i < 12; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('trash-engine-fx');
    expect(root).toBeDefined();
    let visible = 0;
    root?.traverseVisible(() => visible++);
    expect(visible).toBeGreaterThan(10);
    const spellfx = (ability: string, sourceId: number, targetId: number, fxKind = 'nova') =>
      ({ type: 'spellfx', sourceId, targetId, school: 'frost', fx: fxKind, ability }) as SimEvent;
    expect(fx.handleEvent(spellfx('trash_combat_wall_rise', slab.id, slab.id))).toBe(true);
    expect(fx.handleEvent(spellfx(TRASH_DEMO_NOVA, caster.id, caster.id))).toBe(true);
    expect(fx.handleEvent(spellfx(TRASH_DEMO_WALKER, caster.id, orb.id))).toBe(true);
    expect(fx.handleEvent(spellfx('trash_walker_intercept', orb.id, me.id))).toBe(true);
    expect(fx.handleEvent(spellfx(SANCTUM_ICED_OVER, caster.id, me.id))).toBe(true);
    expect(fx.handleEvent(spellfx('trash_brand_quenched', me.id, me.id))).toBe(true);
    expect(fx.handleEvent(spellfx('trash_brand_fizzled', caster.id, me.id))).toBe(true);
    expect(fx.handleEvent(spellfx(SANCTUM_TOPPLE_BRAZIER, me.id, brazier.id))).toBe(true);
    expect(fx.handleEvent(spellfx(SANCTUM_TOPPLE_BRAZIER, me.id, brazier.id, 'windup'))).toBe(true);
    expect(
      fx.handleEvent({
        type: 'spellfxAt',
        x: 6,
        z: 0,
        school: 'frost',
        fx: 'burst',
        ability: 'trash_combat_wall_shatter',
      } as SimEvent),
    ).toBe(true);
    expect(
      fx.handleEvent({
        type: 'spellfxAt',
        x: 3,
        z: 4,
        school: 'fire',
        fx: 'burst',
        ability: 'trash_walker_fade',
      } as SimEvent),
    ).toBe(true);
    // Not an engine beat: left to the renderer.
    expect(fx.handleEvent(spellfx('fireball', me.id, caster.id))).toBe(false);
    entities.delete(slab.id);
    entities.delete(orb.id);
    for (let i = 0; i < 40; i++) fx.update(1 / 30);
    fx.dispose();
    expect(scene.getObjectByName('trash-engine-fx')).toBeUndefined();
  });
});

describe('the render resolves a mob kit the way the sim does', () => {
  it('a dev-lent kit stands in for the template kit (a Thawcaller lent the demo nova)', async () => {
    const { kitOf } = await import('../src/render/trash_engine_fx/trash_engine_fx_core');
    const { TRASH_ENGINE_DEMO_KIT } = await import('../src/sim/mob/trash_kit/engine_demo');
    const lent = { templateId: 'broodsworn_thawcaller', devTrashKit: TRASH_ENGINE_DEMO_KIT };
    expect(kitOf(lent)?.nova).toBeDefined();
    expect(kitOf({ templateId: 'broodsworn_thawcaller' })?.nova).toBeUndefined();
  });
});
