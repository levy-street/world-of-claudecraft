// The Hammer Council's effects: the pure plan (src/render/smith_heart_fx/
// council_fx_core.ts: a pillar's integrity on the model, its rise and its fall,
// the marks read off the sim's own numbers, the rock's fall, the claimed cues)
// and CouncilFx over a fake world (no DOM): it dresses the pillars, draws every
// mark round its player, claims the council's own cues and disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { CouncilFx } from '../src/render/smith_heart_fx/council_fx';
import {
  COUNCIL_FX_COLORS,
  COUNCIL_FX_POOLS,
  COUNCIL_MARK_SPECS,
  councilClaims,
  energyLook,
  inheritArc,
  markFill,
  PILLAR_RISE_SECONDS,
  pillarFall,
  pillarLook,
  pillarPipSlots,
  pillarPips,
  pillarRise,
  pulseRadius,
  RISE_SPOT_SPEC,
  ROCK_FALL_SECONDS,
  rockFall,
} from '../src/render/smith_heart_fx/council_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  councilPillarTemplate,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('council_fx_core: integrity on the model', () => {
  it('cracks open, leans and dims a pip per piece lost', () => {
    // A carved column takes two blows: whole, then cracked open and leaning.
    const [a, c] = [2, 1].map((n) => pillarLook(n));
    expect(a.crack).toBe(0);
    expect(a.lean).toBe(0);
    expect(c.crack).toBeGreaterThan(a.crack);
    expect(c.lean).toBeGreaterThan(a.lean);
    expect(c.heat).toBeGreaterThan(a.heat);
    // A fresh risen pillar is one use, and whole while it stands.
    expect(pillarLook(1, true)).toBe(a);
    // Pips read against the pillar's own start: a carved column has two, a
    // risen pillar one.
    expect([2, 1, 0].map((n) => pillarPips(n))).toEqual([2, 1, 0]);
    expect([1, 0].map((n) => pillarPips(n, true))).toEqual([1, 0]);
    expect([pillarPipSlots(false), pillarPipSlots(true)]).toEqual([2, 1]);
  });

  it('a pillar bursts up out of the floor, and falls in tipping and sinking', () => {
    expect(pillarRise(0).sunk).toBe(1);
    expect(pillarRise(PILLAR_RISE_SECONDS * 0.5).sunk).toBeLessThan(0.5);
    expect(Math.abs(pillarRise(PILLAR_RISE_SECONDS + 1).sunk)).toBeLessThan(1e-6);
    const early = pillarFall(0.2);
    const late = pillarFall(1.6);
    expect(late.tip).toBeGreaterThan(early.tip);
    expect(late.sunk).toBeGreaterThan(early.sunk);
    expect(pillarFall(5).alpha).toBe(0);
  });

  it("every mark reads the sim's own numbers, in a threat colour", () => {
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark].radius).toBe(T.riseKnockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark].color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark].radius).toBe(T.rockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark].gather).toBe(true);
    expect(RISE_SPOT_SPEC.seconds).toBe(T.heirRiseWarn);
    expect(RISE_SPOT_SPEC.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(COUNCIL_FX_COLORS.weight).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(pulseRadius(T.columnR)).toBe(T.columnR + T.pulseReach);
    expect(markFill(5, 5)).toBe(0);
    expect(markFill(0, 5)).toBe(1);
  });

  it('the rock drops only over its last moments, landing on the floor', () => {
    // The rock hangs over the soak for the whole mark, sinking, then drops.
    expect(rockFall(T.rockMarkSeconds).visible).toBe(true);
    expect(rockFall(T.rockMarkSeconds + 0.5).visible).toBe(false);
    expect(rockFall(T.rockMarkSeconds).height).toBeGreaterThan(
      rockFall(ROCK_FALL_SECONDS + 0.5).height,
    );
    expect(rockFall(ROCK_FALL_SECONDS + 0.01).height).toBeGreaterThan(
      rockFall(ROCK_FALL_SECONDS / 2).height,
    );
    const mid = rockFall(ROCK_FALL_SECONDS / 2);
    expect(mid.visible).toBe(true);
    expect(rockFall(0.01).height).toBeLessThan(mid.height);
    expect(rockFall(0).height).toBeCloseTo(0);
    expect(energyLook(100).crackle).toBe(true);
    expect(energyLook(40).crackle).toBe(false);
  });

  it('sizes its pools from the tuning (no pillar or rubble left undrawn)', () => {
    // Every standing pillar plus as many falling at once (a Wrath can break all).
    expect(COUNCIL_FX_POOLS.pillars).toBeGreaterThanOrEqual(T.pillarCap * 2);
    // Rubble lies rubbleSeconds: room for every pillar breaking inside it.
    expect(COUNCIL_FX_POOLS.rubble).toBeGreaterThanOrEqual(T.pillarCap);
  });

  it('fills the per-frame scratch it is handed (the frame allocates nothing)', () => {
    const out = { along: 0, lift: 0 };
    expect(inheritArc(0.5, out)).toBe(out);
    expect(out).toEqual(inheritArc(0.5));
    const rise = { sunk: 0, shudder: 0 };
    expect(pillarRise(0.3, rise)).toBe(rise);
    expect(rise).toEqual(pillarRise(0.3));
    expect(pillarLook(2)).toBe(pillarLook(2));
  });

  it("claims exactly the council's own cues", () => {
    for (const id of Object.values(COUNCIL_CUES)) expect(councilClaims(id), id).toBe(true);
    expect(councilClaims(COUNCIL_CASTS.bolt)).toBe(true);
    expect(councilClaims(COUNCIL_CASTS.wrath)).toBe(false);
    expect(councilClaims(undefined)).toBe(false);
  });
});

describe('CouncilFx over a fake world', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z + z },
      prevPos: { x: o.x + x, y: 0, z: o.z + z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
      resourceType: null,
      resource: 0,
      maxResource: 0,
    } as unknown as Entity;
  }
  const aura = (id: string, remaining: number, duration: number, value = 0, value2 = 0) =>
    ({
      id,
      name: id,
      kind: 'vulnerability',
      remaining,
      duration,
      value,
      value2,
      sourceId: 0,
      school: 'physical',
    }) as Entity['auras'][number];

  it('draws the pillars, the marks and the rings, claims its cues, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 8, -160);
    const marked = entity(2, 'player', 'mage', 0, -170);
    const column = entity(10, 'object', councilPillarTemplate(2, false), 16, -147);
    const risen = entity(11, 'object', councilPillarTemplate(3, true), -6, -170);
    // The Guardian winding up Mountain's Wrath (its energy full: the holder).
    const guardian = entity(20, 'mob', 'heart_hammer_guardian', 30, -175);
    Object.assign(guardian, {
      resourceType: 'energy',
      resource: 100,
      maxResource: 100,
      castingAbility: COUNCIL_CASTS.wrath,
      castTotal: T.wrathCast,
      castRemaining: 2,
    });
    for (const e of [me, marked, column, risen, guardian]) entities.set(e.id, e);
    marked.auras.push(aura(COUNCIL_AURAS.rockMark, 3, 5));
    me.auras.push(aura(COUNCIL_AURAS.resonance, 10, 15, 0.4, risen.id));
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new CouncilFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const rise = {
      type: 'spellfx',
      sourceId: risen.id,
      targetId: risen.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CUES.rise,
    } as SimEvent;
    expect(fx.handleEvent(rise)).toBe(true);
    for (let i = 0; i < 12; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('smith-heart-council-fx');
    expect(root).toBeDefined();
    const shown = (name: string) => {
      let n = 0;
      root?.traverse((c) => {
        if (c.name !== name) return;
        // Drawn only when it and every parent are visible.
        for (let o: THREE.Object3D | null = c; o; o = o.parent) if (!o.visible) return;
        n++;
      });
      return n;
    };
    expect(shown('smithHeartCouncilPillar')).toBe(2);
    expect(shown('smithHeartPillarPips')).toBe(2);
    expect(shown('smithHeartResonanceRing')).toBe(1);
    expect(shown('smithHeartResonanceThread')).toBe(1);
    // The soak reads from afar: its countdown rim, its beacon, the rock's shadow.
    expect(shown('smithHeartSoakRim')).toBe(1);
    expect(shown('smithHeartSoakBeacon')).toBe(1);
    expect(shown('smithHeartSoakShadow')).toBe(1);
    // The Wrath's real shadow behind both pillars, with its light curtains.
    expect(shown('smithHeartShelter:wrath')).toBe(2);
    expect(shown('smithHeartShelterCurtain:wrath')).toBe(2);
    guardian.castingAbility = null;
    fx.update(1 / 30);
    expect(shown('smithHeartShelter:wrath')).toBe(0);
    expect(shaken).toBeGreaterThan(0);
    // The rock's impact and a fall are claimed and drawn.
    const impact = {
      type: 'spellfxAt',
      x: marked.pos.x,
      z: marked.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.rockImpact,
      radius: T.rockRadius,
    } as SimEvent;
    expect(fx.handleEvent(impact)).toBe(true);
    entities.delete(column.id);
    const fall = {
      type: 'spellfxAt',
      x: column.pos.x,
      z: column.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.collapse,
      radius: 4,
    } as SimEvent;
    expect(fx.handleEvent(fall)).toBe(true);
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    expect(shown('smithHeartCouncilPillar')).toBe(2);
    for (let i = 0; i < 120; i++) fx.update(1 / 30);
    expect(shown('smithHeartCouncilPillar')).toBe(1);
    // The Wrath is not the council's to claim (the engine's sight field).
    const wrath = { ...rise, ability: COUNCIL_CASTS.wrath } as SimEvent;
    expect(fx.handleEvent(wrath)).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-council-fx')).toBeUndefined();
  });
});
