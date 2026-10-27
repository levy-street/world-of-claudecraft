// The Heat guardian's effects (phase 2I, presentation only:
// smith_heart_fx/heat_fx_core.ts, heat_fx.ts):
//   - the guardian's numbers read, never tuned; the pour's seams inside its
//     lane and its flow never past its length; the knell's cracks and wave
//     never past its radius; HeatFx over a fake world telegraphs both bars on
//     every tier, plays the fire when they land, never claims an event,
//     disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFx } from '../src/render/smith_heart_fx';
import {
  HEAT_FX_COLORS,
  HEAT_GUARDIAN,
  heatGuardianKit,
  KNELL_WAVE_SECONDS,
  knellBlastLook,
  knellCrackPaths,
  knellCracks,
  knellGather,
  MOLTEN_POUR,
  POUR_MOLTEN_SECONDS,
  POUR_RUN_SECONDS,
  pourFlowLook,
  pourGather,
  pourSeamPaths,
  pourSeams,
  SEARING_KNELL,
} from '../src/render/smith_heart_fx/heat_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Heat guardian's effects", () => {
  it('reads Molten Pour and Searing Knell off the sim template', () => {
    const k = SMITH_HEART_MOBS[HEAT_GUARDIAN].trashKit;
    const kit = heatGuardianKit();
    expect(kit.pourLength).toBe(k?.line?.length);
    expect(kit.pourHalfWidth).toBe(k?.line?.halfWidth);
    expect(kit.pourCast).toBe(k?.line?.castTime);
    expect(kit.knellRadius).toBe(k?.screech?.radius);
    expect(kit.knellCast).toBe(k?.screech?.castTime);
    expect(k?.line?.castId).toBe(MOLTEN_POUR);
    expect(k?.screech?.castId).toBe(SEARING_KNELL);
  });

  it('keeps the fire inside what it hits: the lane, its length, the ring', () => {
    const k = heatGuardianKit();
    for (const seed of [1, 2, 3])
      for (const path of pourSeamPaths(seed, k.pourLength, k.pourHalfWidth)) {
        for (const p of path) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(k.pourHalfWidth);
          expect(p.z).toBeLessThanOrEqual(k.pourLength + 1e-9);
        }
        for (const crack of knellCrackPaths(seed, k.knellRadius))
          for (const p of crack) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(k.knellRadius);
      }
    for (let t = 0; t < 3; t += 0.02) {
      expect(knellBlastLook(t, k.knellRadius).front).toBeLessThanOrEqual(k.knellRadius + 1e-9);
      expect(pourFlowLook(t).front).toBeLessThanOrEqual(1);
    }
    expect(knellBlastLook(KNELL_WAVE_SECONDS, k.knellRadius).front).toBeCloseTo(k.knellRadius, 6);
    expect(pourFlowLook(POUR_RUN_SECONDS).front).toBeCloseTo(1, 6);
  });

  it('times the bars and the landings: gathering, then pouring, cooling, gone', () => {
    expect(pourGather(1)).toBe(1);
    expect(pourSeams(0)).toBe(0);
    expect(pourSeams(1)).toBe(1);
    expect(knellGather(0)).toBe(0);
    expect(knellCracks(1)).toBe(1);
    const hot = pourFlowLook(POUR_RUN_SECONDS + 0.05);
    expect(hot.heat).toBeGreaterThan(0.9);
    expect(hot.crust).toBe(0);
    const cold = pourFlowLook(POUR_MOLTEN_SECONDS - 0.05);
    expect(cold.crust).toBeGreaterThan(0.9);
    expect(cold.heat).toBeLessThan(0.1);
    expect(pourFlowLook(POUR_MOLTEN_SECONDS + 0.1).front).toBe(0);
    expect(knellBlastLook(2, 10).alpha).toBe(0);
    // White-gold, never a threat colour or a volcano's red.
    const [r, g, b] = HEAT_FX_COLORS.fire;
    expect(g / r).toBeGreaterThan(0.6);
    expect(b).toBeLessThan(g);
  });

  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0.4,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  /** The telegraph groups shown (a pooled fan or lane holds a mesh). */
  function telegraphsShown(root: THREE.Object3D | undefined): number {
    let n = 0;
    root?.traverse((o) => {
      if (
        o instanceof THREE.Group &&
        o !== root &&
        o.visible &&
        o.children.some((c) => c instanceof THREE.Mesh)
      )
        n++;
    });
    return n;
  }

  it('telegraphs both bars, plays the fire, claims nothing, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 0);
    const boss = entity(2, 'mob', HEAT_GUARDIAN, 0, 0);
    boss.castingAbility = SEARING_KNELL;
    boss.castTotal = 2.5;
    boss.castRemaining = 2.5;
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new HeatFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-heat-fx');
    expect(root).toBeDefined();
    expect(telegraphsShown(root)).toBe(0);
    for (let i = 0; i < 30; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    expect(telegraphsShown(root)).toBe(1);
    expect(root?.getObjectByName('smithHeartKnellSphere')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartKnellCracks')?.visible).toBe(true);
    const nova = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'physical',
      fx: 'nova',
      ability: SEARING_KNELL,
    } as SimEvent;
    expect(fx.handleEvent(nova)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    expect(root?.getObjectByName('smithHeartKnellWall')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartKnellSphere')?.visible).toBe(false);
    expect(shaken).toBeGreaterThan(0);
    boss.castingAbility = MOLTEN_POUR;
    boss.castTotal = 2;
    boss.castRemaining = 2;
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(1);
    expect(root?.getObjectByName('smithHeartPourSeams')?.visible).toBe(true);
    const pour = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: me.id,
      school: 'fire',
      fx: 'heavyBolt',
      ability: MOLTEN_POUR,
    } as SimEvent;
    expect(fx.handleEvent(pour)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartPourFlow')?.visible).toBe(true);
    for (let i = 0; i < 200; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartKnellWall')?.visible).toBe(false);
    let flows = 0;
    root?.traverse((o) => {
      if (o.name === 'smithHeartPourFlow' && o.visible) flows++;
    });
    expect(flows).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-heat-fx')).toBeUndefined();
  });
});
