// The Breath guardian's effects (phase 2G, presentation only:
// smith_heart_fx/breath_fx_core.ts, breath_fx.ts):
//   - the guardian's numbers read, never tuned; the lance's bolt inside its
//     lane; BreathFx over a fake world telegraphs both bars, plays the wind
//     and the lightning when they land, never claims an event, disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BreathFx } from '../src/render/smith_heart_fx';
import {
  BELLOWS_GUST,
  BREATH_GUARDIAN,
  breathGuardianKit,
  GUST_WAVE_SECONDS,
  gustBlastLook,
  gustChargeLook,
  lanceBoltPath,
  lanceLook,
  STORM_LANCE,
} from '../src/render/smith_heart_fx/breath_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Breath guardian's effects", () => {
  it('reads Bellows Gust and Storm Lance off the sim template', () => {
    const k = SMITH_HEART_MOBS[BREATH_GUARDIAN].trashKit;
    const kit = breathGuardianKit();
    expect(kit.gustRadius).toBe(k?.wingGust?.radius);
    expect(kit.gustShove).toBe(k?.wingGust?.knockback);
    expect(kit.lanceLength).toBe(k?.line?.length);
    expect(kit.lanceHalfWidth).toBe(k?.line?.halfWidth);
    expect(k?.wingGust?.castId).toBe(BELLOWS_GUST);
    expect(k?.line?.castId).toBe(STORM_LANCE);
  });

  it('keeps the lance bolt inside its lane, the wall out to the shove', () => {
    const k = breathGuardianKit();
    for (const seed of [1, 2, 3]) {
      const path = lanceBoltPath(seed, k.lanceLength, k.lanceHalfWidth);
      for (const p of path) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(k.lanceHalfWidth);
        expect(p.z).toBeLessThanOrEqual(k.lanceLength);
      }
      expect(path[path.length - 1].z).toBeCloseTo(k.lanceLength, 6);
    }
    const end = gustBlastLook(GUST_WAVE_SECONDS, k.gustRadius, k.gustShove);
    expect(end.front).toBeCloseTo(k.gustRadius + k.gustShove * 0.8, 6);
    expect(gustBlastLook(GUST_WAVE_SECONDS + 1, k.gustRadius, k.gustShove).alpha).toBe(0);
    expect(gustChargeLook(1).inhale).toBe(1);
    expect(gustChargeLook(0).lift).toBe(0);
    expect(lanceLook(0).bolt).toBe(1);
    expect(lanceLook(2).bolt).toBe(0);
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

  it('telegraphs both bars, plays the wind and the lightning, claims nothing, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 0);
    const boss = entity(2, 'mob', BREATH_GUARDIAN, 0, 0);
    boss.castingAbility = BELLOWS_GUST;
    boss.castTotal = 2;
    boss.castRemaining = 2;
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new BreathFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-breath-fx');
    expect(root).toBeDefined();
    expect(telegraphsShown(root)).toBe(0);
    for (let i = 0; i < 30; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    expect(telegraphsShown(root)).toBe(1);
    expect(root?.getObjectByName('smithHeartGustFunnel')?.visible).toBe(true);
    const nova = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'nova',
      ability: BELLOWS_GUST,
    } as SimEvent;
    expect(fx.handleEvent(nova)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    expect(root?.getObjectByName('smithHeartGustWall')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartGustFunnel')?.visible).toBe(false);
    expect(shaken).toBeGreaterThan(0);
    boss.castingAbility = STORM_LANCE;
    boss.castRemaining = 2;
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(1);
    const bolt = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: me.id,
      school: 'nature',
      fx: 'heavyBolt',
      ability: STORM_LANCE,
    } as SimEvent;
    expect(fx.handleEvent(bolt)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartLanceBolt')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartLanceScorch')?.visible).toBe(true);
    for (let i = 0; i < 200; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartGustWall')?.visible).toBe(false);
    expect(root?.getObjectByName('smithHeartLanceScorch')?.visible).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-breath-fx')).toBeUndefined();
  });
});
