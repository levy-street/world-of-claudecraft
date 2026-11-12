// The Masterless Strength's quarter kits' look (smith_heart_fx/
// final_kit_fx_core.ts and final_kit_fx.ts):
//   - every object template the sim lays reads back as its kind, and every
//     footprint's radius is the sim's own;
//   - every footprint draws in a threat colour (or the soak's gold, stand-in
//     ones) and claims every final cue (no generic draw doubles them);
//   - the kit's floor rungs are untied with each other, with FinalFx's
//     particles and with HeatFx's fist and lanes, which share the Anvil;
//   - the anvil hangs high through most of its bar and lands at its end; the
//     root's spikes stand while it is rooted and sink as it lets go;
//   - the painter over a fake world lays a footprint per object and mark,
//     raises the whirls, orbs, ice and anvil, blows the rim band, leaps its
//     lightning on a cue, claims its cues, hides outside the Heart, disposes;
//   - Basalt Fist's lanes on the Anvil reach its rim, not one yard.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph';
import { FinalKitFx } from '../src/render/smith_heart_fx';
import { anvilHang } from '../src/render/smith_heart_fx/final_anvil_core';
import {
  FINAL_FOOTPRINTS,
  FINAL_FX_PARTICLE_RUNGS,
  FINAL_KIT_COLORS,
  FINAL_KIT_FLOOR,
  FINAL_REACH,
  finalKitClaims,
  finalKitRungs,
  finalObjectKind,
  finalObjectSeconds,
  rootRise,
} from '../src/render/smith_heart_fx/final_kit_fx_core';
import { HEAT_FLOOR } from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_OBJECTS,
  finalTimed,
  poolTemplate,
  FINAL_TUNING as T,
  whirlTemplate,
  windTemplate,
} from '../src/sim/encounters/smith_heart/final_ids';
import { laneReach } from '../src/sim/encounters/smith_heart/heat_geometry';
import { HEAT_TUNING } from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the final kits' plan", () => {
  it('reads back every object the sim lays, with its warning', () => {
    expect(finalObjectKind(whirlTemplate('warn'))).toBe('whirlWarn');
    expect(finalObjectKind(whirlTemplate('live'))).toBe('whirl');
    expect(finalObjectKind(poolTemplate('ember'))).toBe('emberPool');
    expect(finalObjectKind(poolTemplate('forge'))).toBe('forgePool');
    expect(finalObjectKind(windTemplate('warn', 2))).toBe('windWarn');
    expect(finalObjectKind(windTemplate('blow', 8))).toBe('windBlow');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.crackPrefix, T.iceWarn))).toBe('crack');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.orbPrefix, T.orbLife))).toBe('orb');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.tremorPrefix, T.tremorWarn))).toBe('tremor');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.anvilPrefix, T.anvilCast))).toBe('anvil');
    expect(finalObjectKind('sh_heat_fist_30')).toBeNull();
    expect(finalObjectSeconds(finalTimed(FINAL_OBJECTS.crackPrefix, T.iceWarn))).toBe(T.iceWarn);
    expect(finalObjectSeconds(finalTimed(FINAL_OBJECTS.anvilPrefix, T.anvilCast))).toBe(
      T.anvilCast,
    );
  });

  it("draws every footprint at the sim's radius, in a threat colour or the soak's gold", () => {
    expect(FINAL_REACH.whirl).toBe(T.whirlR);
    expect(FINAL_REACH.ember).toBe(T.emberR);
    expect(FINAL_REACH.crack).toBe(T.iceR);
    expect(FINAL_REACH.tremor).toBe(T.tremorR);
    expect(FINAL_REACH.anvil).toBe(T.anvilR);
    expect(FINAL_REACH.drawn).toBe(T.drawnReach);
    expect(FINAL_REACH.bolt).toBe(T.boltJump);
    expect(FINAL_REACH.rimOuter - FINAL_REACH.rimInner).toBe(T.rimBand);
    const allowed = new Set([...Object.values(TELEGRAPH_THREAT_COLORS), FINAL_KIT_COLORS.soak]);
    for (const [k, f] of Object.entries(FINAL_FOOTPRINTS))
      expect(allowed.has(f.color), k).toBe(true);
    expect(FINAL_FOOTPRINTS.anvil.color).toBe(FINAL_KIT_COLORS.soak);
    expect(FINAL_FOOTPRINTS.crack.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
  });

  it('claims every final cue and nothing else', () => {
    for (const c of Object.values(FINAL_CUES)) expect(finalKitClaims(c), c).toBe(true);
    expect(finalKitClaims('heart_heat_fist_land')).toBe(false);
    expect(finalKitClaims(null)).toBe(false);
  });

  it("keeps its floor rungs untied: its own, FinalFx's particles, HeatFx's fist and lanes", () => {
    const mine = finalKitRungs();
    const own = mine.filter((r, i) => mine.indexOf(r) === i);
    // Fire and glow are both additive (commuting) only if they share a rung
    // deliberately; here every rung is its own.
    expect(own.length).toBe(mine.length);
    const heat = [
      HEAT_FLOOR.craterChar.step,
      HEAT_FLOOR.wakeChar.step,
      HEAT_FLOOR.craterGlow.step,
      HEAT_FLOOR.wakeGlow.step,
      HEAT_FLOOR.fistTelegraphChar.step,
      HEAT_FLOOR.fistTelegraphGlow.step,
      HEAT_FLOOR.fistTelegraphCurtain.step,
      HEAT_FLOOR.fistSmoke.step,
      HEAT_FLOOR.fistSparks.step,
    ];
    for (const r of mine) {
      expect(FINAL_FX_PARTICLE_RUNGS, String(r)).not.toContain(r);
      expect(heat, String(r)).not.toContain(r);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(30);
    }
    // The element telegraphs: every char (multiplies commute) under every
    // glow, the cosmetic curtains over both.
    expect(FINAL_KIT_FLOOR.telegraphChar).toBeLessThan(FINAL_KIT_FLOOR.telegraphGlow);
    expect(FINAL_KIT_FLOOR.telegraphGlow).toBeLessThan(FINAL_KIT_FLOOR.telegraphCurtain);
    for (const r of [HEAT_FLOOR.fistTelegraphGlow.step, HEAT_FLOOR.wakeGlow.step])
      expect(FINAL_KIT_FLOOR.telegraphChar).not.toBe(r);
  });

  it('hangs the anvil high through its bar and lands it at the end; the root rises and sinks', () => {
    expect(anvilHang(0).height).toBeGreaterThan(15);
    expect(anvilHang(0.7).height).toBeGreaterThan(15);
    expect(anvilHang(1).height).toBeLessThan(0.5);
    for (let f = 0.8; f < 1; f += 0.02)
      expect(anvilHang(f + 0.02).height).toBeLessThanOrEqual(anvilHang(f).height + 1e-9);
    expect(rootRise(T.rootSeconds)).toBe(0);
    expect(rootRise(T.rootSeconds / 2)).toBeCloseTo(1, 5);
    expect(rootRise(0)).toBe(0);
  });

  it("lays Basalt Fist's lanes on the Anvil out to its rim", () => {
    const spot = { x: HEART_ROOM.x, z: HEART_ROOM.z - 30 };
    // South, toward the rim 30 yd away: it stops there; north it runs whole.
    expect(laneReach(spot.x, spot.z, Math.PI, HEAT_TUNING.laneLength)).toBe(30);
    expect(laneReach(spot.x, spot.z, 0, HEAT_TUNING.laneLength)).toBe(HEAT_TUNING.laneLength);
  });
});

// ---- the painter over a fake world --------------------------------------------------------

function entity(
  id: number,
  kind: string,
  templateId: string,
  x: number,
  z: number,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x, y: 0, z },
    facing: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    scale: 1,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
    ...extra,
  } as unknown as Entity;
}

function visibleNamed(root: THREE.Object3D | undefined, name: string): number {
  let n = 0;
  root?.traverse((o) => {
    if (o.name === name && o.visible) n++;
  });
  return n;
}

function footprintsShown(root: THREE.Object3D | undefined): number {
  let n = 0;
  root?.traverse((o) => {
    if (
      o instanceof THREE.Group &&
      o !== root &&
      o.visible &&
      o.children.some((c) => c instanceof THREE.Mesh) &&
      o.name === ''
    )
      n++;
  });
  return n;
}

describe('FinalKitFx over a fake world', () => {
  it('lays every footprint and body, leaps its lightning, claims its cues, hides out of the Heart, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const at = (dx: number, dz: number) => ({
      x: o.x + HEART_ROOM.x + dx,
      z: o.z + HEART_ROOM.z + dz,
    });
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => entities.set(e.id, e);
    const p = at(-10, -10);
    const me = entity(1, 'player', 'warrior', p.x, p.z, {
      auras: [
        {
          id: FINAL_AURAS.ember,
          name: 'x',
          kind: 'internal_cd',
          remaining: 3,
          duration: 6,
          value: 0,
          sourceId: 2,
        },
        {
          id: FINAL_AURAS.shell,
          name: 'x',
          kind: 'heal_absorb',
          remaining: 9,
          duration: 20,
          value: 600,
          sourceId: 2,
        },
      ] as Entity['auras'],
    });
    const p2 = at(4, -10);
    const frozen = entity(3, 'player', 'mage', p2.x, p2.z, {
      auras: [
        {
          id: FINAL_AURAS.frozen,
          name: 'x',
          kind: 'stun',
          remaining: 2,
          duration: 4,
          value: 0,
          sourceId: 2,
        },
        {
          id: FINAL_AURAS.drawn,
          name: 'x',
          kind: 'internal_cd',
          remaining: 2,
          duration: 6,
          value: 0,
          sourceId: 2,
        },
      ] as Entity['auras'],
    });
    const b = at(0, 20);
    const boss = entity(2, 'mob', FINAL_BOSS, b.x, b.z, {
      castingAbility: FINAL_CASTS.bolt,
      castTotal: 2,
      castRemaining: 1,
      castTargetId: 3,
      auras: [
        {
          id: FINAL_AURAS.root,
          name: 'x',
          kind: 'root',
          remaining: 7,
          duration: 15,
          value: 0,
          sourceId: 2,
        },
        {
          id: FINAL_AURAS.unbound,
          name: 'x',
          kind: 'internal_cd',
          remaining: 9,
          duration: 9,
          value: 3,
          stacks: 3,
          sourceId: 2,
        },
      ] as Entity['auras'],
    });
    add(me);
    add(frozen);
    add(boss);
    const obj = (
      id: number,
      templateId: string,
      dx: number,
      dz: number,
      scale: number,
      facing = 0,
    ) => add(entity(id, 'object', templateId, at(dx, dz).x, at(dx, dz).z, { scale, facing }));
    obj(10, whirlTemplate('live'), 5, 5, T.whirlR);
    obj(11, poolTemplate('ember'), -20, 5, T.emberR);
    obj(12, finalTimed(FINAL_OBJECTS.crackPrefix, T.iceWarn), 12, -4, T.iceR);
    obj(13, finalTimed(FINAL_OBJECTS.orbPrefix, T.orbLife), -15, 15, T.orbR);
    obj(14, finalTimed(FINAL_OBJECTS.tremorPrefix, T.tremorWarn), 20, 0, T.tremorR);
    obj(15, finalTimed(FINAL_OBJECTS.anvilPrefix, T.anvilCast), 0, 30, T.anvilR);
    obj(16, windTemplate('blow', T.windBlow), 0, 0, HEART_ROOM.r, Math.PI / 2);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new FinalKitFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-final-kit-fx');
    expect(root).toBeDefined();
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    // Six object footprints, the ember's ring, the lightning's reach and the
    // bolt's target ring: every tier.
    expect(footprintsShown(root)).toBe(9);
    expect(visibleNamed(root, 'smithHeartFinalWhirl')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalWhirlCore')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrb')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrbCore')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrbRing')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalIce')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalShell')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalAnvil')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalRimBand')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalRootSpikes')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalUnbound')).toBe(1);
    // A leap of lightning on its cue, claimed.
    const bolt = {
      type: 'spellfx',
      sourceId: 2,
      targetId: 3,
      school: 'nature',
      fx: 'beam',
      ability: FINAL_CUES.bolt,
    } as SimEvent;
    expect(fx.handleEvent(bolt)).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalArcs')).toBe(1);
    const land = {
      type: 'spellfxAt',
      x: at(0, 30).x,
      z: at(0, 30).z,
      school: 'physical',
      fx: 'burst',
      radius: T.anvilR,
      ability: FINAL_CUES.anvil,
    } as SimEvent;
    expect(fx.handleEvent(land)).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    expect(fx.handleEvent({ ...land, ability: 'heart_heat_fist_land' } as SimEvent)).toBe(false);
    // The switch's shockwave rides out over the floor and fades.
    expect(fx.handleEvent({ ...land, ability: FINAL_CUES.shock } as SimEvent)).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalShock')).toBe(1);
    for (let i = 0; i < 60; i++) fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalShock')).toBe(0);
    // An object gone: its footprint goes with it.
    entities.delete(10);
    (world as { entityRosterVersion: number }).entityRosterVersion = 2;
    for (let i = 0; i < 12; i++) fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalWhirl')).toBe(0);
    expect(footprintsShown(root)).toBe(8);
    // Out of the Heart: everything hides.
    me.pos = { x: o.x - 200, y: 0, z: o.z };
    fx.update(1 / 30);
    expect(footprintsShown(root)).toBe(0);
    expect(visibleNamed(root, 'smithHeartFinalAnvil')).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-final-kit-fx')).toBeUndefined();
  });
});
