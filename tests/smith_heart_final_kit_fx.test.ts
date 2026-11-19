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
import {
  easeHeading,
  headingGap,
  localBladeIndex,
} from '../src/render/smith_heart_fx/final_stars_fx_core';
import { HEAT_FLOOR } from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  devilTemplate,
  FINAL_CUES,
  FINAL_OBJECTS,
  finalBladeTemplate,
  finalLaneTemplate,
  finalPillarTemplate,
  finalTimed,
  poolTemplate,
  FINAL_TUNING as T,
  whirlTemplate,
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
    // The woken stars (the rework of 2026-11-18).
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.risePrefix, T.pillarWarn))).toBe('rise');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.strikePrefix, T.skyWarn))).toBe('strike');
    expect(finalObjectKind(finalTimed(FINAL_OBJECTS.arcPrefix, T.skyWarn))).toBe('arcRing');
    expect(finalObjectKind(finalBladeTemplate('aim'))).toBe('blade');
    expect(finalObjectKind(finalLaneTemplate('lock', 60))).toBe('lane');
    expect(finalObjectKind(finalPillarTemplate('plain'))).toBe('pillar');
    expect(finalObjectKind(finalPillarTemplate('charged'))).toBe('pillarCharged');
    expect(finalObjectSeconds(finalTimed(FINAL_OBJECTS.strikePrefix, T.skyWarn))).toBe(T.skyWarn);
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
    expect(FINAL_REACH.strike).toBe(T.skyR);
    expect(FINAL_REACH.arc).toBe(T.arcR);
    expect(FINAL_REACH.rise).toBe(T.riseKnockR);
    // A Sky Strike reads apart from Leaping Bolt's reach: a whiter accent.
    expect(FINAL_FOOTPRINTS.strike.accent).not.toBe(FINAL_FOOTPRINTS.bolt.accent);
    // Arcing Stone's ring is lethal-edged.
    expect(FINAL_FOOTPRINTS.arcRing.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    // A Crossing Blade's line is the ice's cold, never a fire's orange or red
    // (the coordinator's call of 2026-11-18: it read as the Heat's), brighter
    // once locked.
    expect(FINAL_FOOTPRINTS.lane.color).toBe(FINAL_KIT_COLORS.iceLine);
    expect(FINAL_FOOTPRINTS.laneLocked.color).toBe(FINAL_KIT_COLORS.iceLineLocked);
    for (const c of [FINAL_KIT_COLORS.iceLine, FINAL_KIT_COLORS.iceLineLocked]) {
      expect(c & 0xff).toBeGreaterThan((c >> 16) & 0xff);
      expect(c).not.toBe(TELEGRAPH_THREAT_COLORS.danger);
    }
    const allowed = new Set([
      ...Object.values(TELEGRAPH_THREAT_COLORS),
      FINAL_KIT_COLORS.soak,
      FINAL_KIT_COLORS.iceLine,
      FINAL_KIT_COLORS.iceLineLocked,
    ]);
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

  it("lays Basalt Fist's lanes on the Anvil out to its rim, all the way (playtest 2026-11-19)", () => {
    const spot = { x: HEART_ROOM.x, z: HEART_ROOM.z - 30 };
    // South, toward the rim 30 yd away: it stops there; north it runs on past
    // the Heat guardian's own lane length to the far rim, 90 yd off.
    expect(laneReach(spot.x, spot.z, Math.PI, HEAT_TUNING.laneLength)).toBe(30);
    expect(laneReach(spot.x, spot.z, 0, HEAT_TUNING.laneLength)).toBe(90);
    expect(90).toBeGreaterThan(HEAT_TUNING.laneLength);
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
          id: FINAL_AURAS.underIce,
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
    // The woken stars: a rise, a strike, a ring round a pillar, a charged
    // pillar, a blade and its line (the line's object at its middle).
    obj(16, finalTimed(FINAL_OBJECTS.risePrefix, T.pillarWarn), -30, -10, T.riseKnockR);
    obj(17, finalTimed(FINAL_OBJECTS.strikePrefix, T.skyWarn), 28, 14, T.skyR);
    obj(18, finalTimed(FINAL_OBJECTS.arcPrefix, T.skyWarn), 32, 18, T.arcR);
    obj(19, finalPillarTemplate('charged'), 32, 18, 1);
    obj(20, finalBladeTemplate('aim'), -40, 0, 1, Math.PI / 2);
    obj(21, finalLaneTemplate('warn', 60), -10, 0, 1, Math.PI / 2);
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
    // Nine object footprints, the ember's ring, the lightning's reach, the
    // bolt's target ring and the blade's line: every tier.
    expect(footprintsShown(root)).toBe(13);
    expect(visibleNamed(root, 'smithHeartFinalWhirl')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalWhirlCore')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalWhirlSmoke')).toBe(1);
    // The blade hovers at its rise, its line on the floor.
    expect(visibleNamed(root, 'smithHeartStarBlade')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrb')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrbCore')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalOrbRing')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalIce')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalShell')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalAnvil')).toBe(1);
    // The personal arrow: my Ember Mark raises it over my head (the other
    // player's Drawn Lightning draws nothing on my screen); without a mark of
    // mine it goes; another player's anvil mark draws nothing, mine does.
    expect(visibleNamed(root, 'smithHeartRushArrow')).toBe(1);
    const ember = me.auras.shift();
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartRushArrow')).toBe(0);
    const anvilMark = {
      id: FINAL_AURAS.anvilMark,
      name: 'x',
      kind: 'internal_cd',
      remaining: 4,
      duration: T.anvilCast,
      value: 0,
      sourceId: 2,
    } as Entity['auras'][number];
    frozen.auras.push(anvilMark);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartRushArrow')).toBe(0);
    me.auras.push({ ...anvilMark });
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartRushArrow')).toBe(1);
    me.auras.pop();
    frozen.auras.pop();
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartRushArrow')).toBe(0);
    if (ember) me.auras.unshift(ember);
    // A Sky Strike lands: a bolt out of the sky; Arcing Stone rings out.
    const strike = {
      type: 'spellfxAt',
      x: at(28, 14).x,
      z: at(28, 14).z,
      school: 'nature',
      fx: 'burst',
      radius: T.skyR,
      ability: FINAL_CUES.strike,
    } as SimEvent;
    expect(fx.handleEvent(strike)).toBe(true);
    expect(
      fx.handleEvent({ ...strike, ability: FINAL_CUES.arcingStone, radius: T.arcR } as SimEvent),
    ).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartStarBolts')).toBe(1);
    expect(visibleNamed(root, 'smithHeartStarRing')).toBeGreaterThanOrEqual(2);
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
    expect(footprintsShown(root)).toBe(12);
    // Out of the Heart: everything hides.
    me.pos = { x: o.x - 200, y: 0, z: o.z };
    fx.update(1 / 30);
    expect(footprintsShown(root)).toBe(0);
    expect(visibleNamed(root, 'smithHeartFinalAnvil')).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-final-kit-fx')).toBeUndefined();
  });
});

describe("Crossing Blade follows the local player's drawn pose (playtest 2026-11-19)", () => {
  it('picks the line aimed at me and points it at me, not at the late server line', () => {
    expect(headingGap(0.1, -0.1)).toBeCloseTo(0.2, 9);
    expect(headingGap(Math.PI - 0.05, -Math.PI + 0.05)).toBeCloseTo(0.1, 9);
    const blades = [
      { fromX: 0, fromZ: 0, facing: 0, aiming: true },
      { fromX: 0, fromZ: 0, facing: Math.PI / 2, aiming: true },
      { fromX: 0, fromZ: 0, facing: 0.05, aiming: false },
    ];
    // Me north-north-east of the blades: the first (north) is mine.
    expect(localBladeIndex(blades, 3, 20)).toBe(0);
    // Me east: the second.
    expect(localBladeIndex(blades, 20, 1)).toBe(1);
    // Nothing aims within reach of me: none.
    expect(localBladeIndex(blades, -20, -1)).toBe(-1);
    // The hand-back eases, the shortest way round, and lands.
    const half = easeHeading(0, 1, 14, Math.log(2) / 14);
    expect(half).toBeCloseTo(0.5, 6);
    expect(headingGap(easeHeading(3, -3, 14, 10), -3)).toBeLessThan(1e-6);
  });

  it('in the painter: my line turns to where I am drawn while it aims, then hands back on lock', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const at = (dx: number, dz: number) => ({
      x: o.x + HEART_ROOM.x + dx,
      z: o.z + HEART_ROOM.z + dz,
    });
    const entities = new Map<number, Entity>();
    // Me 20 yd east of the room's centre, marked and aiming.
    const p = at(20, 0);
    const me = entity(1, 'player', 'warrior', p.x, p.z, {
      auras: [
        {
          id: FINAL_AURAS.bladeMark,
          name: 'x',
          kind: 'internal_cd',
          remaining: 3,
          duration: 4,
          value: 1,
          sourceId: 2,
        },
      ] as Entity['auras'],
    });
    entities.set(me.id, me);
    // The blade on the west rim; the server's line still points where I was a
    // moment ago (a little north of me).
    const from = at(-HEART_ROOM.r + 1.5, 0);
    const lateFacing = Math.atan2(20 - (-HEART_ROOM.r + 1.5), 6);
    const blade = entity(20, 'object', finalBladeTemplate('aim'), from.x, from.z, {
      facing: lateFacing,
    });
    const len = 2 * (HEART_ROOM.r - 1.5);
    const mid = {
      x: from.x + Math.sin(lateFacing) * len * 0.5,
      z: from.z + Math.cos(lateFacing) * len * 0.5,
    };
    const lane = entity(21, 'object', finalLaneTemplate('warn', len), mid.x, mid.z, {
      facing: lateFacing,
    });
    entities.set(blade.id, blade);
    entities.set(lane.id, lane);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new FinalKitFx(scene, () => 0, world);
    const root = scene.getObjectByName('smith-heart-final-kit-fx');
    let holder: THREE.Object3D | null = null;
    root?.traverse((c) => {
      if (c.name === 'smithHeartStarBlade' && c.visible) holder = c;
    });
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    root?.traverse((c) => {
      if (c.name === 'smithHeartStarBlade' && c.visible) holder = c;
    });
    const h = holder as THREE.Object3D | null;
    expect(h).not.toBeNull();
    // The blade sits half its length back along its line: its heading is from it to the rim spot.
    const drawn = Math.atan2(from.x - (h?.position.x ?? 0), from.z - (h?.position.z ?? 0));
    const toMe = Math.atan2(me.pos.x - from.x, me.pos.z - from.z);
    expect(headingGap(drawn, toMe)).toBeLessThan(0.01);
    expect(headingGap(drawn, lateFacing)).toBeGreaterThan(0.05);
    // Locked: it eases back onto the server's line.
    me.auras[0].value = 2;
    lane.templateId = finalLaneTemplate('lock', len);
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    const back = Math.atan2(from.x - (h?.position.x ?? 0), from.z - (h?.position.z ?? 0));
    expect(headingGap(back, lateFacing)).toBeLessThan(0.01);
    fx.dispose();
  });
});

describe('the Breath Dust Devil: the fire tornado in wind (playtest 2026-11-19)', () => {
  it("draws a devil with the tornado's own bodies, its wind palette, and claims its cue", () => {
    expect(finalObjectKind(devilTemplate('warn'))).toBe('devilWarn');
    expect(finalObjectKind(devilTemplate('live'))).toBe('devil');
    expect(FINAL_REACH.devil).toBe(T.devilR);
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const at = (dx: number, dz: number) => ({ x: o.x + HEART_ROOM.x + dx, z: o.z + HEART_ROOM.z + dz });
    const entities = new Map<number, Entity>();
    const p = at(0, -30);
    const me = entity(1, 'player', 'warrior', p.x, p.z);
    entities.set(me.id, me);
    const d = at(4, -26);
    entities.set(40, entity(40, 'object', devilTemplate('live'), d.x, d.z, { scale: T.devilR }));
    const world = { entities, player: me, playerId: me.id, entityRosterVersion: 1 } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new FinalKitFx(scene, () => 0, world);
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('smith-heart-final-kit-fx');
    expect(visibleNamed(root, 'smithHeartFinalDevil')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalDevilCore')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalDevilSmoke')).toBe(1);
    // Never a fire whirl.
    expect(visibleNamed(root, 'smithHeartFinalWhirl')).toBe(0);
    let wind = -1;
    root?.traverse((c) => {
      if (c.name === 'smithHeartFinalDevil' && c.visible)
        wind = ((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uWind.value;
    });
    expect(wind).toBe(1);
    const cue = {
      type: 'spellfx',
      sourceId: 40,
      targetId: 1,
      school: 'nature',
      fx: 'nova',
      ability: FINAL_CUES.devil,
    } as SimEvent;
    expect(fx.handleEvent(cue)).toBe(true);
    entities.delete(40);
    (world as { entityRosterVersion: number }).entityRosterVersion = 2;
    for (let i = 0; i < 3; i++) fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalDevil')).toBe(0);
    fx.dispose();
  });
});
