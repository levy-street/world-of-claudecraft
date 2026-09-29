import { describe, expect, it, vi } from 'vitest';
import { FCT_MAX_CONCURRENT_LOW } from '../src/game/ui_tier_knobs';
import { TURRET_SIZE_CLASSES } from '../src/sim/content/turret_defense';
import type { TurretEvent, TurretHit } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import { describeFct, FCT_ANCHOR_HEAD_OFFSET, type FctEvent } from '../src/ui/fct_core';
import {
  TurretDamageNumbers,
  turretDamageText,
} from '../src/ui/hud/vehicle/turret_damage_numbers_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const PLAN = resolveTurretPlan();
const HUGE = PLAN.kinds.findIndex((k) => k.sizeClass === 'huge');
/** Monster 1 is the plan's first kind (a small wolf), monster 2 a huge one. */
const MONSTERS = [
  { id: 1, kind: 0 },
  { id: 2, kind: HUGE },
];

function session(entries: TurretFeedback[], startTick = 0): TurretSessionView {
  return {
    origin: { x: 0, y: 0, z: 0 },
    defense: {
      startTick,
      plan: PLAN,
      monsters: MONSTERS,
    } as unknown as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: entries,
  };
}

const entry = (seq: number, tick: number, event: TurretEvent): TurretFeedback => ({
  seq,
  tick,
  event,
});
const hit = (id: number, falloff: number, damage: number, x = 4, y = 1, z = 9): TurretHit => ({
  id,
  falloff,
  damage,
  x,
  y,
  z,
});
const impact = (...hits: TurretHit[]): TurretEvent => ({
  type: 'impact',
  shotId: 1,
  x: 0,
  y: 0,
  z: 10,
  hits,
});
const bowled: TurretEvent = {
  type: 'bowled',
  flyerId: 1,
  struckId: 2,
  x: -3,
  y: 2,
  z: 12,
  speed: 14,
  damage: 7,
};

function rig(clock = () => 500) {
  const spawned: { event: FctEvent; now: number }[] = [];
  const now = vi.fn(clock);
  const numbers = new TurretDamageNumbers((event, at) => spawned.push({ event, now: at }), now);
  return { numbers, spawned, now };
}

describe('Fire and Fly damage numbers', () => {
  it('floats one number per hit over each struck body, where the sim says it stood', () => {
    const { numbers, spawned } = rig();
    numbers.update(
      session([entry(1, 10, impact(hit(1, 0.5, 30, 4, 1, 9), hit(2, 0.25, 12, -2, 3, 11)))]),
      10,
    );
    expect(spawned.map((s) => s.event.text)).toEqual(['30', '12']);
    const [small, huge] = spawned.map((s) => describeFct(s.event, 0.5));
    expect(small.anchor.x).toBe(4);
    expect(small.anchor.y).toBeCloseTo(1 + TURRET_SIZE_CLASSES.small.height * 1.1, 12);
    expect(small.anchor.z).toBe(9);
    expect(huge.anchor.x).toBe(-2);
    expect(huge.anchor.y).toBeCloseTo(3 + TURRET_SIZE_CLASSES.huge.height * 1.1, 12);
    expect(huge.anchor.z).toBe(11);
    for (const { event, now } of spawned) {
      expect(event).toMatchObject({ kind: 'damage-done-ability', crit: false, isSelf: false });
      expect(now).toBe(500);
    }
  });

  it('marks a core hit as a crit, in the FCT style', () => {
    const { numbers, spawned } = rig();
    numbers.update(session([entry(1, 10, impact(hit(1, 1, 60), hit(2, 0.99, 59)))]), 10);
    expect(spawned.map((s) => [s.event.text, s.event.crit])).toEqual([
      ['60!', true],
      ['59', false],
    ]);
    expect(turretDamageText(60, true)).toBe('60!');
    expect(describeFct(spawned[0].event, 0.5)).toMatchObject({
      crit: true,
      colorToken: 'damage-done-ability',
    });
  });

  it("floats a barrel blast's hits like a shell's, its core hit as a crit", () => {
    const { numbers, spawned } = rig();
    const blast: TurretEvent = {
      type: 'barrelExploded',
      id: 4,
      x: 0,
      y: 0,
      z: 10,
      hits: [hit(1, 1, 120, 4, 1, 9), hit(2, 0.5, 60, -2, 3, 11)],
    };
    numbers.update(session([entry(1, 10, blast)]), 10);
    expect(spawned.map((s) => [s.event.text, s.event.crit])).toEqual([
      ['120!', true],
      ['60', false],
    ]);
    expect(describeFct(spawned[1].event, 0.5).anchor.x).toBe(-2);
  });

  it('floats a bowling knock over the struck body, never as a crit', () => {
    const { numbers, spawned } = rig();
    numbers.update(session([entry(1, 10, bowled)]), 10);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].event).toMatchObject({ text: '7', crit: false });
    const anchor = describeFct(spawned[0].event, 0.5).anchor;
    expect(anchor.x).toBe(-3);
    expect(anchor.y).toBeCloseTo(2 + TURRET_SIZE_CLASSES.huge.height * 1.1, 12);
    expect(anchor.z).toBe(12);
  });

  it('spawns each entry once, however often the same view is read', () => {
    const { numbers, spawned } = rig();
    const ring = [entry(1, 10, impact(hit(1, 1, 60)))];
    numbers.update(session(ring), 10);
    numbers.update(session(ring), 10);
    numbers.update(null, 11);
    numbers.update(session(ring), 11);
    expect(spawned).toHaveLength(1);
    ring.push(entry(2, 12, bowled));
    numbers.update(session(ring), 12);
    expect(spawned.map((s) => s.event.text)).toEqual(['60!', '7']);
  });

  it('starts over with a new seat', () => {
    const { numbers, spawned } = rig();
    numbers.update(session([entry(1, 10, impact(hit(1, 1, 60)))]), 10);
    numbers.update(session([entry(1, 50, impact(hit(1, 0.5, 30)))], 40), 50);
    expect(spawned.map((s) => s.event.text)).toEqual(['60!', '30']);
  });

  it('floats nothing for entries already stale at their first read', () => {
    const { numbers, spawned } = rig();
    numbers.update(
      session([entry(1, 39, impact(hit(1, 1, 60))), entry(2, 40, impact(hit(1, 1, 61)))]),
      50,
    );
    expect(spawned.map((s) => s.event.text)).toEqual(['61!']);
  });

  it('reads the clock only when a number spawns, and once per batch', () => {
    const { numbers, now } = rig();
    numbers.update(session([entry(1, 10, impact())]), 10);
    expect(now).not.toHaveBeenCalled();
    numbers.update(
      session([
        entry(1, 10, impact()),
        entry(2, 11, impact(hit(1, 1, 5), hit(2, 1, 5))),
        entry(3, 11, bowled),
      ]),
      11,
    );
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('floats over the tallest planned body for one the engine already dropped', () => {
    const { numbers, spawned } = rig();
    numbers.update(session([entry(1, 10, impact(hit(9, 0.5, 5, 0, 0, 0)))]), 10);
    const tallest = Math.max(...PLAN.kinds.map((k) => k.height));
    expect(tallest).toBeGreaterThan(FCT_ANCHOR_HEAD_OFFSET);
    expect(describeFct(spawned[0].event, 0.5).anchor.y).toBeCloseTo(tallest * 1.1, 12);
  });

  it("fits a blast through the largest wave under the low tier's live FCT cap", () => {
    const largest = Math.max(...PLAN.waves.map((w) => w.spawns.length));
    expect(largest).toBeGreaterThan(1);
    expect(largest).toBeLessThanOrEqual(FCT_MAX_CONCURRENT_LOW);
  });
});
