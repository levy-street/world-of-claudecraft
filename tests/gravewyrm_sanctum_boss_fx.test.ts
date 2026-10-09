// SanctumBossFx (render/gravewyrm_sanctum_bosses/sanctum_boss_fx.ts) driven by
// a hand-built world: it binds the chain, plate, meltwater and statue objects
// the sim spawns, lays the boss bars' telegraphs, sends the presentation
// gestures, claims the boss beats it draws and replays the body's clip for
// them, and never throws through a fight's states.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SanctumBossFx } from '../src/render/gravewyrm_sanctum_bosses';
import {
  KORZUL_BURST_AT,
  KORZUL_EMERGE_LAND_GESTURE,
  KORZUL_FROZEN_STANCE,
  KORZUL_HEARTBEAT_GESTURE,
  KORZUL_HIDE_GESTURE,
  KORZUL_SHOW_GESTURE,
  KORZUL_TAKEOFF_GESTURE,
  VELKHAR_THAW_GESTURE,
} from '../src/render/gravewyrm_sanctum_bosses/boss_model_core';
import {
  KORGATH_CHAIN_BREAK,
  KORGATH_ENRAGE,
  KORGATH_ID,
  KORGATH_STRAIN,
  KORZUL_AIRBORNE,
  KORZUL_BREAK_FREE,
  KORZUL_GRAVE_BREATH,
  KORZUL_ID,
  KORZUL_TOUCHDOWN,
  KORZUL_WYRMS_EYE,
  plateTemplate,
  SANCTUM_HELD_STATUE,
  SANCTUM_MELT_STRIP,
  SANCTUM_PYRE_FLARE,
  SANCTUM_QUENCH_WATER,
  sanctumStoryTemplate,
  sealChainTemplate,
  VELKHAR_ID,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import {
  KORZUL_EMERGE,
  KORZUL_EMERGE_LAND_AT,
  KORZUL_EMERGE_RISE_AT,
} from '../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

let nextId = 1;
function ent(kind: string, templateId: string, x: number, z: number, extra: object = {}): Entity {
  return {
    id: nextId++,
    kind,
    templateId,
    pos: { x, y: 0, z },
    facing: 0,
    scale: 1,
    dead: false,
    inCombat: false,
    hp: 100,
    maxHp: 100,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    ...extra,
  } as unknown as Entity;
}

function setup() {
  nextId = 1;
  const entities = new Map<number, Entity>();
  const add = (e: Entity) => {
    entities.set(e.id, e);
    return e;
  };
  const me = add(ent('player', 'p', 0, 0));
  const world = { entities, playerId: me.id } as unknown as IWorld;
  const gestures: [number, string][] = [];
  const scene = new THREE.Scene();
  const fx = new SanctumBossFx(
    scene,
    () => 0,
    world,
    undefined,
    () => false,
    () => {},
    (id, g) => gestures.push([id, g]),
  );
  return { fx, add, entities, gestures, scene, me };
}

describe('SanctumBossFx', () => {
  it('draws Korgath chains, his Strain and a chain break, and replays ChainBreak on him', () => {
    const { fx, add, gestures } = setup();
    const korgath = add(ent('mob', KORGATH_ID, 0, -22, { inCombat: true, scale: 1.5 }));
    const chain = add(ent('object', sealChainTemplate('hammer', 'intact'), -10.5, -12));
    add(ent('object', sealChainTemplate('tongs', 'broken'), 10.5, -12));
    fx.update(0.2);
    korgath.castingAbility = KORGATH_STRAIN;
    korgath.castTotal = 2;
    korgath.castRemaining = 1;
    fx.update(0.2);
    // The broken tongs chain asks for the broken mesh, the whole hammer for none.
    expect(gestures).toContainEqual([korgath.id, 'sanctum_korgath_broken_tongs']);
    expect(gestures).toContainEqual([korgath.id, 'sanctum_korgath_whole_hammer']);
    const ev = {
      type: 'spellfx',
      sourceId: chain.id,
      targetId: chain.id,
      school: 'frost',
      fx: 'nova',
      ability: KORGATH_CHAIN_BREAK,
    } as unknown as SimEvent;
    expect(fx.handleEvent(ev)).toBe(true);
    expect(gestures).toContainEqual([korgath.id, KORGATH_CHAIN_BREAK]);
    const enrage = { ...ev, sourceId: korgath.id, ability: KORGATH_ENRAGE } as SimEvent;
    expect(fx.handleEvent(enrage)).toBe(true);
    expect(gestures).toContainEqual([korgath.id, KORGATH_ENRAGE]);
    for (let i = 0; i < 20; i++) fx.update(0.05);
    fx.dispose();
  });

  it('plays Velkhar thaw off a pyre flare and lays the meltwater and statues', () => {
    const { fx, add, gestures } = setup();
    const velkhar = add(ent('mob', VELKHAR_ID, 0, 107, { inCombat: true }));
    add(ent('object', SANCTUM_PYRE_FLARE, 0, 117.5, { scale: 7 }));
    add(ent('object', SANCTUM_MELT_STRIP, -5, 100, { scale: 30, facing: 0.4 }));
    add(ent('object', SANCTUM_HELD_STATUE, 3, 104));
    fx.update(0.2);
    fx.update(0.2);
    expect(gestures).toContainEqual([velkhar.id, VELKHAR_THAW_GESTURE]);
    fx.dispose();
  });

  it('holds Korzul frozen before his pull, then takes off with the airborne aura', () => {
    const { fx, add, gestures, me, entities } = setup();
    add(ent('object', sanctumStoryTemplate(7), 0, 150));
    const korzul = add(ent('mob', KORZUL_ID, 0, 214, { scale: 1.8 }));
    for (let i = 0; i < 19; i++)
      add(ent('object', plateTemplate(i === 3 ? 'cracked' : 'sound', 6), i * 4, 192, { scale: 8 }));
    fx.update(0.6);
    expect(gestures).toContainEqual([korzul.id, KORZUL_FROZEN_STANCE]);
    korzul.inCombat = true;
    korzul.castingAbility = KORZUL_GRAVE_BREATH;
    korzul.castTotal = 2;
    korzul.castRemaining = 1;
    me.auras.push({ id: KORZUL_WYRMS_EYE } as never, { id: SANCTUM_QUENCH_WATER } as never);
    fx.update(0.6);
    korzul.castingAbility = null;
    korzul.auras.push({ id: KORZUL_AIRBORNE } as never);
    fx.update(0.6);
    expect(gestures).toContainEqual([korzul.id, KORZUL_TAKEOFF_GESTURE]);
    // The heart-shard beats.
    expect(gestures).toContainEqual([korzul.id, KORZUL_HEARTBEAT_GESTURE]);
    expect(entities.size).toBeGreaterThan(19);
    fx.dispose();
  });

  it('keeps Korzul out of sight through Break Free until the ice bursts, then flies, lands and cracks the plates', () => {
    const { fx, add, gestures, entities } = setup();
    const marker = add(ent('object', sanctumStoryTemplate(7), 0, 150));
    const korzul = add(ent('mob', KORZUL_ID, 0, 214, { scale: 1.8 }));
    for (let i = 0; i < 19; i++)
      add(ent('object', plateTemplate('sound'), i * 3, 192, { scale: 8 }));
    fx.update(0.6);
    expect(gestures).toContainEqual([korzul.id, KORZUL_HIDE_GESTURE]);
    // The pull: the face's foot, Break Free's bar, the story at step 8.
    marker.templateId = sanctumStoryTemplate(8);
    korzul.pos = { x: 0, y: 0, z: 235 };
    korzul.inCombat = true;
    korzul.castingAbility = KORZUL_BREAK_FREE;
    korzul.castTotal = KORZUL_EMERGE.burst;
    korzul.castRemaining = KORZUL_EMERGE.burst;
    const pull = {
      type: 'spellfx',
      sourceId: korzul.id,
      targetId: korzul.id,
      school: 'frost',
      fx: 'nova',
      ability: KORZUL_BREAK_FREE,
    } as unknown as SimEvent;
    expect(fx.handleEvent(pull)).toBe(true);
    const shownAt = () =>
      gestures.findIndex((g) => g[0] === korzul.id && g[1] === KORZUL_SHOW_GESTURE);
    const has = (g: string) => gestures.some((x) => x[0] === korzul.id && x[1] === g);
    const step = (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += 0.05) {
        korzul.castRemaining = Math.max(0, korzul.castRemaining - 0.05);
        if (korzul.castRemaining <= 0) korzul.castingAbility = null;
        fx.update(0.05);
      }
    };
    // Up to just before the burst: still hidden (the face's frozen wyrm is the one seen).
    step(KORZUL_BURST_AT - 0.1);
    expect(shownAt()).toBe(-1);
    step(0.2);
    expect(shownAt()).toBeGreaterThanOrEqual(0);
    // The takeoff as the rise begins, the landing clip as the fall begins.
    step(KORZUL_EMERGE_RISE_AT - KORZUL_BURST_AT);
    expect(has(KORZUL_TAKEOFF_GESTURE)).toBe(true);
    expect(has(KORZUL_EMERGE_LAND_GESTURE)).toBe(false);
    korzul.pos = { x: 0, y: 14, z: 210 };
    step(KORZUL_EMERGE_LAND_AT - KORZUL_EMERGE_RISE_AT);
    expect(has(KORZUL_EMERGE_LAND_GESTURE)).toBe(true);
    // Never hidden again once out.
    const hides = gestures.filter((g) => g[0] === korzul.id && g[1] === KORZUL_HIDE_GESTURE);
    korzul.pos = { x: 0, y: 0, z: 192 };
    const touchdown = { ...pull, ability: KORZUL_TOUCHDOWN } as SimEvent;
    expect(fx.handleEvent(touchdown)).toBe(true);
    step(1);
    expect(gestures.filter((g) => g[0] === korzul.id && g[1] === KORZUL_HIDE_GESTURE)).toHaveLength(
      hides.length,
    );
    expect(entities.size).toBeGreaterThan(19);
    fx.dispose();
  });
});
