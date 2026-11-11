// The Masterless Strength's effects (phase 2J, presentation only:
// smith_heart_fx/final_fx_core.ts, final_fx.ts; the arrival's view in
// heart_seal_core.ts; the room going dark in heart_final_core.ts; the
// arrival scene itself is tests/smith_heart_final_arrival.test.ts):
//   - the boss's numbers read, never tuned;
//   - the arm's reach keeps its bones' lengths (the Hammer Council's bodies);
//   - the heart goes dark after the fall; the room's memory follows it;
//   - the seal memory reads the arrival live when it is seen waking and long
//     past when first seen awake (a late arrival sees the body whole);
//   - FinalFx over a fake world slams the floor when a gathering bar lands,
//     burns its heart in the colour of the quarter it drinks, rides an
//     Overload Burst's wall of light out over the Anvil, never claims an
//     event, disposes.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHeartFinalMemoryForTest,
  HEART_FINAL_DARK,
  heartFinalDarkness,
  noteHeartFinalDeath,
} from '../src/render/smith_heart/heart_final_core';
import {
  heartSealView,
  newHeartSealView,
  observeHeartSealMask,
} from '../src/render/smith_heart/heart_seal_core';
import { FinalFx } from '../src/render/smith_heart_fx';
import { ARRIVAL_END } from '../src/render/smith_heart_fx/final_arrival_core';
import {
  colossusArmIk,
  DEATH_END,
  FINAL_BODY_CASTS,
  FINAL_BOSS,
  FORGE_FIST_CUE,
  finalBossKit,
  heartDeathLevel,
} from '../src/render/smith_heart_fx/final_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { HEART_ROOM, SMITH_HEART_VEIN_COLORS } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SMITH_HEART_AWAKE_BIT,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_SEAL_FULL,
} from '../src/sim/encounters/smith_heart';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_ZONE_CODES,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Masterless Strength's body", () => {
  it("reads Forge Fist off the sim template, the burst's reach off the room, a pose for every bar", () => {
    const m = SMITH_HEART_MOBS[FINAL_BOSS];
    const k = finalBossKit();
    expect(k.fistRange).toBe(m.arcCleave?.range);
    expect(k.fistArcDeg).toBe(m.arcCleave?.arcDeg);
    expect(k.burstRadius).toBe(HEART_ROOM.r);
    // The sketch kit is gone: no nova, no cone.
    expect(m.trashKit).toBeUndefined();
    for (const id of Object.values(FINAL_CASTS)) expect(FINAL_BODY_CASTS[id], id).toBeDefined();
  });

  it("keeps the arm's bones their lengths and reaches what it can", () => {
    const s = { x: 7, y: 14, z: 0 };
    const pole = { x: 0.6, y: -0.2, z: -1 };
    const L1 = 6.8;
    const L2 = 6.4;
    for (const w of [
      { x: 8, y: 3, z: 3 },
      { x: 2, y: 1, z: 9 },
      { x: 10, y: 20, z: 0 },
      { x: 30, y: 0, z: 30 },
    ]) {
      const ik = colossusArmIk(s, w, L1, L2, pole);
      const e = ik.elbow;
      expect(Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z)).toBeCloseTo(L1, 4);
      expect(Math.hypot(ik.wrist.x - e.x, ik.wrist.y - e.y, ik.wrist.z - e.z)).toBeCloseTo(L2, 4);
      const reach = Math.hypot(w.x - s.x, w.y - s.y, w.z - s.z);
      if (reach < L1 + L2 - 0.1) {
        expect(Math.hypot(ik.wrist.x - w.x, ik.wrist.y - w.y, ik.wrist.z - w.z)).toBeLessThan(1e-6);
      }
    }
  });

  it('the heart goes dark after the fall', () => {
    expect(heartDeathLevel(DEATH_END)).toBeCloseTo(0, 6);
    expect(heartDeathLevel(0.1)).toBeGreaterThan(0.3);
  });
});

describe("the Heart's memories: the arrival and the fall", () => {
  afterEach(() => clearHeartFinalMemoryForTest());

  it('reads the arrival live when seen waking, long past when first seen awake', () => {
    const live = 'arrival-live';
    observeHeartSealMask(live, SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT, 10);
    const v = newHeartSealView();
    heartSealView(live, 11, v);
    expect(v.awakeSince).toBe(-1);
    // The veins' mask never carries the arrival.
    observeHeartSealMask(
      live,
      SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT | SMITH_HEART_AWAKE_BIT,
      12,
    );
    heartSealView(live, 14.5, v);
    expect(v.awakeSince).toBeCloseTo(2.5, 6);
    expect(v.mask).toBe(SMITH_HEART_SEAL_FULL);
    const late = 'arrival-late';
    observeHeartSealMask(
      late,
      SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT | SMITH_HEART_AWAKE_BIT,
      50,
    );
    heartSealView(late, 50, v);
    expect(v.awakeSince).toBeGreaterThan(ARRIVAL_END);
  });

  it('darkens the room after the fall, never before it', () => {
    expect(heartFinalDarkness('fall', 5)).toBe(0);
    noteHeartFinalDeath('fall', 10);
    expect(heartFinalDarkness('fall', 10 + HEART_FINAL_DARK.at - 0.01)).toBe(0);
    expect(heartFinalDarkness('fall', 10 + HEART_FINAL_DARK.at + HEART_FINAL_DARK.seconds)).toBe(1);
    noteHeartFinalDeath('fall', null);
    expect(heartFinalDarkness('fall', 99)).toBe(0);
  });
});

describe('FinalFx', () => {
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

  it('slams the floor as a bar lands, wears its quarter, bursts, claims nothing, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', o.x + HEART_ROOM.x - 10, o.z + HEART_ROOM.z - 10);
    const boss = entity(2, 'mob', FINAL_BOSS, o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new FinalFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-final-fx');
    expect(root).toBeDefined();
    fx.update(1 / 30);
    // No floor telegraph of its own any more (the kits' are their own).
    expect(telegraphsShown(root)).toBe(0);
    // The Anvil's bar: its end, the slam (a shake).
    boss.castingAbility = FINAL_CASTS.anvil;
    boss.castTotal = 6;
    boss.castRemaining = 6;
    for (let i = 0; i < 60; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    boss.castingAbility = null;
    const before = shaken;
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    expect(shaken).toBeGreaterThan(before);
    // It drinks the Heat: its heart's light burns the Heat's colour.
    boss.auras = [
      {
        id: FINAL_AURAS.state,
        name: 'x',
        kind: 'internal_cd',
        remaining: 1,
        duration: 1,
        value: FINAL_ZONE_CODES.heat,
        sourceId: boss.id,
      },
    ] as Entity['auras'];
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    const halo = (root?.getObjectByName('smithHeartColossusHalo') as THREE.Sprite | undefined)
      ?.material as THREE.SpriteMaterial | undefined;
    if (!halo) throw new Error('no heart halo');
    const tint = halo.color;
    const heat = new THREE.Color(SMITH_HEART_VEIN_COLORS.heat);
    expect(
      Math.abs(tint.r - heat.r) + Math.abs(tint.g - heat.g) + Math.abs(tint.b - heat.b),
    ).toBeLessThan(0.05);
    const fist = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'windup',
      ability: FORGE_FIST_CUE,
    } as SimEvent;
    expect(fx.handleEvent(fist)).toBe(false);
    const burst = { ...fist, fx: 'nova', ability: FINAL_CUES.burst } as SimEvent;
    expect(fx.handleEvent(burst)).toBe(false);
    fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartOverloadWall')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartOverloadWall')?.visible).toBe(false);
    // The fall: the room's memory goes dark with it.
    boss.dead = true;
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-final-fx')).toBeUndefined();
  });
});
