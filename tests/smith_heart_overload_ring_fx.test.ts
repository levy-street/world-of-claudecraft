// The Masterless Strength's Overload ring over a fake world (FinalFx hosting
// final_overload_ring.ts; the pure plan is tests/smith_heart_overload_ring.test.ts):
//   - the blink (Jose's playtest of 2026-11-20, "the middle line blinks and
//     disappears"): online a mob's in-combat bit is never mirrored, so a
//     boss at full health between its blows read as "not engaged" for a
//     moment and the ring, its column and the well's glow went dark until
//     the next blow. The fight's own state aura (the sim puts it on at the
//     pull and takes it off at the fight's end) now decides;
//   - the ring's look never drops out frame to frame through the warning.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FinalFx } from '../src/render/smith_heart_fx';
import { FINAL_BOSS, finalFightEngaged } from '../src/render/smith_heart_fx/final_fx_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FINAL_AURAS,
  FINAL_ZONE_CODES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x, y: 0, z },
    prevPos: { x, y: 0, z },
    facing: 0.6,
    scale: 1,
    hp: 100,
    maxHp: 100,
    dead: false,
    inCombat: true,
    auras: [],
    castingAbility: null as string | null,
    castTargetId: null,
    castRemaining: 0,
    castTotal: 0,
  } as unknown as Entity;
}

const aura = (id: string, value: number) =>
  ({
    id,
    name: 'x',
    kind: 'internal_cd',
    remaining: 3600,
    duration: 3600,
    value,
    sourceId: 2,
  }) as Entity['auras'][number];

function rig() {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  const entities = new Map<number, Entity>();
  const me = entity(1, 'player', 'warrior', o.x + HEART_ROOM.x - 30, o.z + HEART_ROOM.z - 30);
  const boss = entity(2, 'mob', FINAL_BOSS, o.x + HEART_ROOM.x + 20, o.z + HEART_ROOM.z);
  entities.set(me.id, me);
  entities.set(boss.id, boss);
  const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
  const scene = new THREE.Scene();
  const fx = new FinalFx(
    scene,
    () => 0,
    world,
    undefined,
    () => false,
  );
  const root = scene.getObjectByName('smith-heart-final-fx');
  if (!root) throw new Error('no FinalFx root');
  const ring = root.getObjectByName('smithHeartOverloadRing');
  const column = root.getObjectByName('smithHeartOverloadColumn') as THREE.Mesh | undefined;
  if (!ring || !column) throw new Error('no Overload ring');
  return { fx, boss, ring, column, root };
}

describe('the Overload ring never blinks', () => {
  it('an online-mirrored boss (in-combat bit unmirrored, full health, between blows) keeps it lit', () => {
    const { fx, boss, ring, column } = rig();
    // The ClientWorld mirror of a pulled boss: no in-combat bit, no wound,
    // no cast, no blow this second; the fight's state aura on it.
    boss.inCombat = false;
    boss.auras = [aura(FINAL_AURAS.state, FINAL_ZONE_CODES.heat), aura(overloadAuraId('heat'), 85)];
    let dark = 0;
    let level = Number.POSITIVE_INFINITY;
    const mat = column.material as THREE.ShaderMaterial;
    for (let i = 0; i < 240; i++) {
      fx.update(1 / 60);
      if (!ring.visible || !column.visible) dark++;
      level = Math.min(level, mat.uniforms.uLevel.value as number);
    }
    expect(dark).toBe(0);
    // Through the 80 % warning's flicker the column dims, never vanishes.
    expect(level).toBeGreaterThan(0.3);
    fx.dispose();
  });

  it('goes dark when the fight ends (the sim takes the state aura off)', () => {
    const { fx, boss, ring } = rig();
    boss.inCombat = false;
    boss.auras = [aura(FINAL_AURAS.state, FINAL_ZONE_CODES.hammer)];
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    expect(ring.visible).toBe(true);
    boss.auras = [];
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    expect(ring.visible).toBe(false);
    fx.dispose();
  });

  it('the fight counts as engaged off its state aura alone', () => {
    const idle = { inCombat: false, castingAbility: null, hp: 10, maxHp: 10, auras: [] };
    expect(finalFightEngaged(idle, 99)).toBe(false);
    expect(finalFightEngaged({ ...idle, auras: [{ id: FINAL_AURAS.state }] }, 99)).toBe(true);
    // The older reads still count (offline's in-combat bit, a wound, a cast,
    // a blow this second).
    expect(finalFightEngaged({ ...idle, inCombat: true }, 99)).toBe(true);
    expect(finalFightEngaged({ ...idle, hp: 9 }, 99)).toBe(true);
    expect(finalFightEngaged({ ...idle, castingAbility: 'x' }, 99)).toBe(true);
    expect(finalFightEngaged(idle, 0.5)).toBe(true);
  });
});
