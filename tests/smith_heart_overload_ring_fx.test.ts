// The Masterless Strength's Overload ring over a fake world (FinalFx hosting
// final_overload_ring.ts; the pure plan is tests/smith_heart_overload_ring.test.ts):
//   - the blink (Jose's playtest of 2026-11-20, "the middle line blinks and
//     disappears"): online a mob's in-combat bit is never mirrored, so a
//     boss at full health between its blows read as "not engaged" for a
//     moment and the ring, its column and the well's glow went dark until
//     the next blow. The fight's own state aura (the sim puts it on at the
//     pull and takes it off at the fight's end) now decides;
//   - the ring's look never drops out frame to frame through the warning;
//   - a bar reaching 100 percent (the sim's Overload Burst cue, the event
//     FinalFx already reads) explodes the ring: the floor's shockwave, the
//     column's surge, the ring held full then drained to empty.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FinalFx } from '../src/render/smith_heart_fx';
import { FINAL_BOSS, finalFightEngaged } from '../src/render/smith_heart_fx/final_fx_core';
import { OVERLOAD_BURST } from '../src/render/smith_heart_fx/final_overload_ring_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_ZONE_CODES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../src/sim/types';
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

describe('the Overload ring explodes at 100 percent', () => {
  it("plays off the sim's burst cue: shockwave, surge, the ring drained back to empty", () => {
    const { fx, boss, root, column } = rig();
    const bar = aura(overloadAuraId('quench'), 100);
    boss.auras = [aura(FINAL_AURAS.state, FINAL_ZONE_CODES.quench), bar];
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    const shock = root.getObjectByName('smithHeartOverloadShock') as THREE.Mesh | undefined;
    const ringMat = (root.getObjectByName('smithHeartOverloadRingInlay') as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    if (!shock) throw new Error('no shockwave built up front');
    // Built with the ring under the gated root, hidden until a burst.
    expect(shock.parent?.visible).toBe(false);
    // The sim empties the bar and emits its cue on the same tick.
    bar.value = 0;
    const cue = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'nova',
      ability: FINAL_CUES.burst,
    } as SimEvent;
    expect(fx.handleEvent(cue)).toBe(false);
    fx.update(1 / 60);
    const sm = shock.material as THREE.ShaderMaterial;
    expect(shock.parent?.visible).toBe(true);
    expect(sm.uniforms.uA1.value).toBeGreaterThan(0.2);
    const r0 = sm.uniforms.uR1.value as number;
    // The ring held full in the burst quarter's colour a breath.
    expect(ringMat.uniforms.uSweep.value).toBe(1);
    for (let i = 0; i < 15; i++) fx.update(1 / 60);
    expect(sm.uniforms.uR1.value).toBeGreaterThan(r0);
    const cm = column.material as THREE.ShaderMaterial;
    expect(cm.uniforms.uSurge.value).toBeGreaterThan(0.5);
    expect(cm.uniforms.uTop.value).toBeGreaterThan(0.9);
    // Draining: part way round, then empty.
    for (let i = 0; i < 40; i++) fx.update(1 / 60);
    const mid = ringMat.uniforms.uSweep.value as number;
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    for (let t = 0; t < OVERLOAD_BURST.span + 0.2; t += 1 / 60) fx.update(1 / 60);
    expect(ringMat.uniforms.uSweep.value).toBeLessThan(0.02);
    expect(shock.parent?.visible).toBe(false);
    expect(cm.uniforms.uSurge.value).toBe(0);
    fx.dispose();
  });
});
