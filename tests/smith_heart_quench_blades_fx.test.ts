// The Smith's blades on the Frozen Lake move smoothly whatever the snapshot
// rate (Jose's playtest: online they moved roughly). The pure motion cores
// (src/render/smith_heart_fx/quench_fight_fx_core.ts: followStep,
// wakeFillStep, bladeFlight, bladeBank) and the painter
// (quench_blades_fx.ts) over a fake world whose objects move only on a 20 Hz
// clock while the frames run at 60: the drawn blade never steps, the
// awakening rises every frame, and a slash is drawn on the sim's eased
// curve (slashEase) from the lane's two ends, leaning and banking.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QuenchBladesFx } from '../src/render/smith_heart_fx/quench_blades_fx';
import {
  BLADE_HOMES,
  bladeBank,
  bladeFlight,
  followStep,
  wakeFillStep,
} from '../src/render/smith_heart_fx/quench_fight_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  bladeTemplate,
  laneTemplate,
  QUENCH_CASTS,
  QUENCH_GUARDIAN,
  slashEase,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the blades motion cores', () => {
  it('follows frame-rate free, and the wake fill runs on between reads', () => {
    // Two half frames equal one whole frame.
    const a = followStep(followStep(0, 10, 0.05, 10), 10, 0.05, 10);
    expect(a).toBeCloseTo(followStep(0, 10, 0.1, 10), 6);
    expect(followStep(3, 3, 0.1, 10)).toBe(3);
    // No bar: nothing; a bar: runs on at its pace between two reads.
    expect(wakeFillStep(0.5, 0, 0.1, 4)).toBe(0);
    let f = 0;
    const seen: number[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      // The read moves on a 10 Hz clock only.
      const read = Math.floor((i / 60) * 10) / 10 / 4;
      f = wakeFillStep(f, Math.max(0.001, read), 1 / 60, 4);
      seen.push(f);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i] - seen[i - 1]).toBeLessThan(0.02);
    }
    expect(seen[seen.length - 1]).toBeGreaterThan(0.9);
  });

  it('draws the flight on the sim curve, its speed peaking mid-lane, banking within reason', () => {
    const out = { x: 0, z: 0, speed: 0 };
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      bladeFlight(0, 0, 40, 0, k * T.slashFly, out);
      expect(out.x).toBeCloseTo(40 * slashEase(k), 6);
    }
    expect(bladeFlight(0, 0, 40, 0, 0, out).speed).toBe(0);
    expect(bladeFlight(0, 0, 40, 0, T.slashFly / 2, out).speed).toBeCloseTo(1);
    expect(bladeFlight(0, 0, 40, 0, T.slashFly * 2, out).x).toBe(40);
    expect(Math.abs(bladeBank(50, 1, 1))).toBeLessThanOrEqual(0.45);
    expect(bladeBank(0, 1, 1)).toBeGreaterThan(0);
    expect(bladeBank(0, 1, -1)).toBeLessThan(0);
    expect(bladeBank(0, 0, 1)).toBe(0);
  });
});

describe('QuenchBladesFx over a fake world on a 20 Hz clock', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
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

  function rig() {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', o.x + 198, o.z - 2);
    const boss = entity(2, 'mob', QUENCH_GUARDIAN, o.x + 198, o.z - 2);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const blades = BLADE_HOMES.map((h, i) => {
      const b = entity(10 + i, 'object', bladeTemplate('float'), o.x + h.x, o.z + h.z);
      entities.set(b.id, b);
      return b;
    });
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    const fx = new QuenchBladesFx(scene, () => -30, world);
    const holder = (i: number) => scene.getObjectByName(`quenchBlade:${i}`) as THREE.Object3D;
    return { entities, world, scene, fx, holder, blades, boss };
  }

  it('a floating blade glides after its object instead of stepping with it', () => {
    const { fx, holder, blades } = rig();
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    const h = holder(0);
    const start = h.position.x;
    // The object jumps 1.5 yd on one snapshot.
    blades[0].pos.x += 1.5;
    let last = start;
    let biggest = 0;
    for (let i = 0; i < 60; i++) {
      fx.update(1 / 60);
      biggest = Math.max(biggest, Math.abs(h.position.x - last));
      last = h.position.x;
    }
    expect(biggest).toBeLessThan(0.3);
    expect(h.position.x).toBeCloseTo(start + 1.5, 1);
    fx.dispose();
  });

  it('the awakening rises every frame though its bar is read on a 20 Hz clock', () => {
    const { fx, scene, blades, boss } = rig();
    for (const b of blades) b.templateId = bladeTemplate('wake');
    boss.castingAbility = QUENCH_CASTS.wake;
    boss.castTotal = T.wakeCast;
    boss.castRemaining = T.wakeCast;
    const frame = (scene.getObjectByName('quenchBlade:0') as THREE.Object3D).children[0];
    const lifts: number[] = [];
    let clock = 0;
    for (let i = 0; i < Math.round(T.wakeCast * 60); i++) {
      clock += 1 / 60;
      // The bar moves on the sim's 20 Hz clock only.
      boss.castRemaining = Math.max(0, T.wakeCast - Math.floor(clock * 20) / 20);
      fx.update(1 / 60);
      lifts.push(frame.position.y);
    }
    const rising = lifts.slice(Math.round(lifts.length * 0.5));
    let steps = 0;
    for (let i = 1; i < rising.length; i++) {
      expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1] - 1e-6);
      if (rising[i] - rising[i - 1] > 0.25) steps++;
    }
    expect(steps).toBe(0);
    expect(lifts[lifts.length - 1]).toBeGreaterThan(lifts[0] + 2);
    fx.dispose();
  });

  it('a slash is drawn along its line on the eased curve, leaning into its speed', () => {
    const { fx, world, entities, holder, blades } = rig();
    for (let i = 0; i < 20; i++) fx.update(1 / 60);
    const a = BLADE_HOMES[0];
    const b = BLADE_HOMES[2];
    // Whole yards, as the sim makes every line: a little short of the other home.
    const length = Math.floor(Math.hypot(b.x - a.x, b.z - a.z));
    const facing = Math.atan2(b.x - a.x, b.z - a.z);
    const end = { x: a.x + Math.sin(facing) * length, z: a.z + Math.cos(facing) * length };
    const lane = entity(
      30,
      'object',
      laneTemplate('fly', T.slashFly, length),
      o.x + a.x,
      o.z + a.z,
    );
    lane.facing = facing;
    entities.set(lane.id, lane);
    world.entityRosterVersion++;
    for (let i = 0; i < 8; i++) fx.update(1 / 60);
    blades[0].templateId = bladeTemplate('fly');
    const h = holder(0);
    const from = { x: h.position.x, z: h.position.z };
    const steps: number[] = [];
    let last = { ...from };
    let leaned = 0;
    let clock = 0;
    for (let i = 0; i < Math.round(T.slashFly * 60); i++) {
      clock += 1 / 60;
      // The object moves on the sim's 20 Hz clock only.
      const k = slashEase(Math.floor(clock * 20) / 20 / T.slashFly);
      blades[0].pos.x = o.x + a.x + (end.x - a.x) * k;
      blades[0].pos.z = o.z + a.z + (end.z - a.z) * k;
      fx.update(1 / 60);
      steps.push(Math.hypot(h.position.x - last.x, h.position.z - last.z));
      last = { x: h.position.x, z: h.position.z };
      leaned = Math.max(leaned, (h.children[0] as THREE.Object3D).rotation.x);
    }
    const n = steps.length;
    // Eased: slow off the mark and onto it, fastest mid-lane, never a jump.
    expect(steps[1]).toBeLessThan(steps[Math.floor(n / 2)] * 0.3);
    expect(steps[n - 1]).toBeLessThan(steps[Math.floor(n / 2)] * 0.3);
    for (let i = 1; i < n; i++) expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThan(0.25);
    expect(Math.hypot(h.position.x - (o.x + end.x), h.position.z - (o.z + end.z))).toBeLessThan(
      0.3,
    );
    expect(leaned).toBeGreaterThan(0.4);
    fx.dispose();
  });
});
