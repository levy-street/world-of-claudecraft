// The Masterless Strength's body, its arrival and its effects (phase 2J,
// presentation only: smith_heart_fx/final_fx_core.ts, final_fx.ts; the
// arrival's view in heart_seal_core.ts; the room going dark in
// heart_final_core.ts):
//   - the boss's numbers read, never tuned;
//   - the pieces rest on the platform's walk before the heart wakes, off the
//     bridge's line, the altars and each other, the shards out of sight in
//     the chasm; the arrival tears them out in order and locks every one
//     before the shockwave; the heart rises out of its bed into the body;
//   - the arm's reach keeps its bones' lengths; Forge Fist strikes inside its
//     arc and reach; the pour's hands reach forward;
//   - the fall lands every piece on the platform or sends it into the chasm,
//     and the heart goes dark; the room's memory follows it;
//   - the seal memory reads the arrival live when it is seen waking and long
//     past when first seen awake (a late arrival sees the body whole);
//   - FinalFx over a fake world telegraphs Forge Pour on every tier, pours
//     its fire when it lands, never claims an event, disposes.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHeartFinalMemoryForTest,
  HEART_FINAL_DARK,
  heartFinalDarkness,
  noteHeartFinalDeath,
} from '../src/render/smith_heart/heart_final_core';
import { HEART_CORE_BED_Y } from '../src/render/smith_heart/heart_room_kit_plan_core';
import {
  heartSealView,
  newHeartSealView,
  observeHeartSealMask,
} from '../src/render/smith_heart/heart_seal_core';
import { FinalFx } from '../src/render/smith_heart_fx';
import {
  ARRIVAL,
  ARRIVAL_END,
  ARRIVAL_WAVE_AT,
  arrivalWave,
  COLOSSUS_ARM,
  COLOSSUS_PIECES,
  colossusArmIk,
  colossusFallPhase,
  colossusFallPlan,
  colossusFlyPoint,
  colossusLockAt,
  colossusPiecePhase,
  colossusRestPoint,
  colossusTearAt,
  colossusWristTarget,
  DEATH_END,
  FINAL_BOSS,
  FORGE_FIST_CUE,
  FORGE_POUR,
  FORGE_WRATH,
  finalBossKit,
  heartArrivalPoint,
  heartDeathLevel,
  pourFlowLook,
} from '../src/render/smith_heart_fx/final_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { HEART_ALTARS, HEART_ROOM, HEART_TERRACE } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SMITH_HEART_AWAKE_BIT,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_SEAL_FULL,
} from '../src/sim/encounters/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const bearingDeg = (x: number, z: number) =>
  ((Math.atan2(x - HEART_ROOM.x, z - HEART_ROOM.z) * 180) / Math.PI + 360) % 360;

describe("the Masterless Strength's body", () => {
  it('reads Forge Fist, Forge Wrath and Forge Pour off the sim template', () => {
    const m = SMITH_HEART_MOBS[FINAL_BOSS];
    const k = finalBossKit();
    expect(k.fistRange).toBe(m.arcCleave?.range);
    expect(k.fistArcDeg).toBe(m.arcCleave?.arcDeg);
    expect(k.wrathRadius).toBe(m.trashKit?.nova?.radius);
    expect(k.wrathCast).toBe(m.trashKit?.nova?.castTime);
    expect(k.pourRange).toBe(m.trashKit?.cone?.range);
    expect(k.pourArcDeg).toBe(m.trashKit?.cone?.arcDeg);
    expect(k.pourCast).toBe(m.trashKit?.cone?.castTime);
    expect(m.trashKit?.nova?.castId).toBe(FORGE_WRATH);
    expect(m.trashKit?.cone?.castId).toBe(FORGE_POUR);
  });

  it('rests its pieces on the walk before the heart wakes: off the bridge, the altars, each other', () => {
    const big = COLOSSUS_PIECES.filter((p) => p.joint !== 'shard');
    expect(big.length).toBe(11);
    // The bridge lands on the platform at the terrace's bearing.
    const bridge = bearingDeg(HEART_TERRACE.x, HEART_TERRACE.z);
    for (const p of big) {
      const r = colossusRestPoint(p);
      const d = Math.hypot(r.x - HEART_ROOM.x, r.z - HEART_ROOM.z);
      expect(d + p.size * 0.5, p.id).toBeLessThan(HEART_ROOM.r - 1);
      let off = Math.abs(bearingDeg(r.x, r.z) - bridge);
      off = Math.min(off, 360 - off);
      expect(off, p.id).toBeGreaterThan(15);
      for (const a of HEART_ALTARS)
        expect(Math.hypot(r.x - a.x, r.z - a.z), `${p.id} by ${a.vein}`).toBeGreaterThan(
          3 + p.size * 0.5,
        );
      for (const q of big) {
        if (q === p) continue;
        const s = colossusRestPoint(q);
        expect(Math.hypot(r.x - s.x, r.z - s.z), `${p.id}/${q.id}`).toBeGreaterThan(
          (p.size + q.size) * 0.4,
        );
      }
    }
    // The shards wait out of sight, in the chasm under the lip.
    for (const p of COLOSSUS_PIECES.filter((q) => q.joint === 'shard')) {
      const r = colossusRestPoint(p);
      expect(r.y).toBeLessThan(HEART_ROOM.h - 10);
      expect(Math.hypot(r.x - HEART_ROOM.x, r.z - HEART_ROOM.z)).toBeGreaterThan(HEART_ROOM.r);
    }
  });

  it('tears the pieces out in order and locks every one before the shockwave', () => {
    const big = COLOSSUS_PIECES.filter((p) => p.joint !== 'shard');
    for (let i = 1; i < big.length; i++)
      expect(colossusTearAt(big[i])).toBeGreaterThan(colossusTearAt(big[i - 1]));
    for (const p of COLOSSUS_PIECES) {
      expect(colossusTearAt(p)).toBeGreaterThanOrEqual(ARRIVAL.hold);
      expect(colossusLockAt(p), p.id).toBeLessThan(ARRIVAL_WAVE_AT);
      // Its phases run forward and never back.
      const order = ['rest', 'tremble', 'lift', 'fly', 'locked'];
      let last = 0;
      for (let t = 0; t < ARRIVAL_END + 1; t += 0.05) {
        const ph = colossusPiecePhase(p, t);
        const i = order.indexOf(ph.phase);
        expect(i).toBeGreaterThanOrEqual(last);
        last = i;
        expect(ph.k).toBeGreaterThanOrEqual(0);
        expect(ph.k).toBeLessThanOrEqual(1);
      }
      expect(colossusPiecePhase(p, ARRIVAL_END).phase).toBe('locked');
    }
    expect(arrivalWave(ARRIVAL_WAVE_AT - 0.01)).toBe(-1);
    expect(arrivalWave(ARRIVAL_WAVE_AT + 0.5)).toBeGreaterThan(0);
    expect(ARRIVAL_END).toBeGreaterThan(ARRIVAL_WAVE_AT + ARRIVAL.waveSeconds);
  });

  it('flies a piece from where it lifted into its slot', () => {
    const from = { x: 10, y: 3, z: 4 };
    const to = { x: 0, y: 12, z: 1 };
    const c = { x: 0, y: 11, z: 0 };
    const a = colossusFlyPoint(from, to, c, 0, 1.3);
    const b = colossusFlyPoint(from, to, c, 1, 1.3);
    expect(Math.hypot(b.x - to.x, b.y - to.y, b.z - to.z)).toBeLessThan(1e-6);
    // It starts where it lifted, turned round the heart's axis but no
    // nearer or farther from it.
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeCloseTo(Math.hypot(from.x - c.x, from.z - c.z), 6);
    expect(a.y).toBeCloseTo(from.y, 6);
  });

  it('raises the heart out of its bed in the chasm and into the body', () => {
    const slot = { x: HEART_ROOM.x, y: 12.6, z: HEART_ROOM.z + 2 };
    expect(heartArrivalPoint(0, slot).p.y).toBeCloseTo(HEART_CORE_BED_Y, 6);
    let y = -999;
    for (let t = ARRIVAL.hold; t < ARRIVAL.riseEnd; t += 0.1) {
      const p = heartArrivalPoint(t, slot).p;
      expect(p.y).toBeGreaterThanOrEqual(y - 1e-9);
      y = p.y;
    }
    const end = heartArrivalPoint(ARRIVAL.glideEnd + 0.01, slot);
    expect(end.p).toEqual(slot);
    expect(end.glow).toBe(1);
  });

  it("keeps the arm's bones their lengths and reaches what it can", () => {
    const s = { x: 7, y: 14, z: 0 };
    const pole = { x: 0.6, y: -0.2, z: -1 };
    const L1 = COLOSSUS_ARM.upper;
    const L2 = COLOSSUS_ARM.fore;
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

  it('strikes Forge Fist inside its arc and reach, and cups the pour forward', () => {
    const k = finalBossKit();
    const hit = colossusWristTarget('fist', 1, 0.45).wrist;
    expect(Math.hypot(hit.x, hit.z)).toBeLessThanOrEqual(k.fistRange);
    expect((Math.abs(Math.atan2(hit.x, hit.z)) * 180) / Math.PI).toBeLessThanOrEqual(
      k.fistArcDeg / 2,
    );
    expect(hit.y).toBeLessThan(1.5);
    const cup = colossusWristTarget('pour', -1, 1).wrist;
    expect(cup.z).toBeGreaterThan(4);
    const idle = colossusWristTarget('idle', 1, 0).wrist;
    expect(idle).toEqual({
      x: COLOSSUS_ARM.idle.x,
      y: COLOSSUS_ARM.idle.y,
      z: COLOSSUS_ARM.idle.z,
    });
  });

  it('crumbles over the room or into the chasm, and the heart goes dark', () => {
    const from = { x: HEART_ROOM.x, y: 12, z: HEART_ROOM.z };
    COLOSSUS_PIECES.forEach((p, i) => {
      const plan = colossusFallPlan(p, from, i);
      const r = Math.hypot(plan.land.x - HEART_ROOM.x, plan.land.z - HEART_ROOM.z);
      if (plan.chasm) {
        expect(plan.land.y, p.id).toBeLessThan(-40);
        expect(r, p.id).toBeGreaterThan(HEART_ROOM.r);
      } else {
        expect(r, p.id).toBeLessThan(HEART_ROOM.r - 1);
        expect(plan.land.y).toBeCloseTo(HEART_ROOM.h + 0.2, 6);
      }
      expect(colossusFallPhase(plan, DEATH_END).phase).toBe('gone');
      expect(colossusFallPhase(plan, 0).phase).toBe('held');
    });
    expect(heartDeathLevel(DEATH_END)).toBeCloseTo(0, 6);
    expect(heartDeathLevel(0.1)).toBeGreaterThan(0.3);
  });

  it('pours its fire down the cone and never past it', () => {
    for (let t = 0; t < 4; t += 0.05) expect(pourFlowLook(t).front).toBeLessThanOrEqual(1);
    expect(pourFlowLook(0.2).heat).toBe(1);
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

  it('telegraphs Forge Pour, pours its fire, plays the fist and the wrath, claims nothing, disposes', () => {
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
    expect(telegraphsShown(root)).toBe(0);
    boss.castingAbility = FORGE_POUR;
    boss.castTotal = 2.5;
    boss.castRemaining = 2.5;
    for (let i = 0; i < 30; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    expect(telegraphsShown(root)).toBe(1);
    const pour = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'nova',
      ability: FORGE_POUR,
    } as SimEvent;
    expect(fx.handleEvent(pour)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    expect(root?.getObjectByName('smithHeartForgePourFire')?.visible).toBe(true);
    const fist = { ...pour, fx: 'windup', ability: FORGE_FIST_CUE } as SimEvent;
    expect(fx.handleEvent(fist)).toBe(false);
    const wrath = { ...pour, ability: FORGE_WRATH } as SimEvent;
    expect(fx.handleEvent(wrath)).toBe(false);
    fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartForgeWrathWall')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartForgePourFire')?.visible).toBe(false);
    expect(root?.getObjectByName('smithHeartForgeWrathWall')?.visible).toBe(false);
    // The fall: the room's memory goes dark with it.
    boss.dead = true;
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-final-fx')).toBeUndefined();
  });
});
