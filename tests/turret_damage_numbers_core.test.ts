import { describe, expect, it, vi } from 'vitest';
import { FCT_MAX_CONCURRENT_LOW } from '../src/game/ui_tier_knobs';
import { TURRET_FRAGMENTATION, TURRET_SIZE_CLASSES } from '../src/sim/content/turret_defense';
import type { TurretEvent, TurretHit } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import { TURRET_BOMBLETS } from '../src/sim/minigames/turret_fragmentation';
import { describeFct, FCT_ANCHOR_HEAD_OFFSET, type FctEvent } from '../src/ui/fct_core';
import {
  TURRET_MULTI_HIT_MIN,
  TurretDamageNumbers,
  turretDamageText,
  turretMultiHitText,
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

describe('the fragmentation shell multi-hit callout', () => {
  const BURST = { x: 6, y: 9, z: 30 };
  const fragBurst = (shotId: number): TurretEvent => ({
    type: 'fragBurst',
    shotId,
    ...BURST,
    bomblets: [],
  });
  const bomblet = (shotId: number, index: number, ...ids: number[]): TurretEvent => ({
    type: 'bomblet',
    shotId,
    index,
    x: BURST.x,
    y: 0,
    z: BURST.z,
    hits: ids.map((id) => hit(id, 0.5, 10)),
  });
  /** A frag's whole feedback: its burst, then each bomblet striking the ids given for it. */
  function frag(shotId: number, struck: number[][], seq = 1, tick = 10): TurretFeedback[] {
    const out = [entry(seq, tick, fragBurst(shotId))];
    for (let i = 0; i < TURRET_BOMBLETS; i++) {
      out.push(entry(seq + 1 + i, tick + 4 + i, bomblet(shotId, i, ...(struck[i] ?? []))));
    }
    return out;
  }
  const callouts = (spawned: { event: FctEvent }[]) =>
    spawned.filter((s) => s.event.text.startsWith('x'));

  it('pops one xN over the burst once its last bomblet lands, for six distinct monsters or more', () => {
    expect(TURRET_MULTI_HIT_MIN).toBe(6);
    const { numbers, spawned } = rig();
    const ring = frag(5, [[1, 2], [2, 3], [], [4], [1], [5, 6]]);
    numbers.update(session(ring.slice(0, -1)), 20);
    expect(callouts(spawned)).toEqual([]);
    numbers.update(session(ring), 21);
    const pops = callouts(spawned);
    expect(pops).toHaveLength(1);
    expect(pops[0].event).toMatchObject({
      kind: 'damage-done-ability',
      text: turretMultiHitText(6),
      crit: true,
      isSelf: false,
    });
    expect(turretMultiHitText(4)).toBe('x4');
    const anchor = describeFct(pops[0].event, 0.5).anchor;
    expect(anchor.x).toBe(BURST.x);
    expect(anchor.y).toBeCloseTo(BURST.y, 12);
    expect(anchor.z).toBe(BURST.z);
    expect(BURST.y - TURRET_FRAGMENTATION.burstHeight).toBe(5);
  });

  it('counts each monster once, however many bomblets struck it', () => {
    const { numbers, spawned } = rig();
    numbers.update(session(frag(5, [[1], [1, 2], [2, 3], [3, 4], [1, 2, 5]])), 30);
    expect(callouts(spawned)).toEqual([]);
  });

  it('pops once per shell, however often the same view is read', () => {
    const { numbers, spawned } = rig();
    const ring = frag(5, [[1, 2, 3, 4, 5, 6]]);
    numbers.update(session(ring), 30);
    numbers.update(session(ring), 30);
    numbers.update(session(ring), 31);
    expect(callouts(spawned).map((s) => s.event.text)).toEqual(['x6']);
  });

  it('keeps two frags apart, each with its own tally', () => {
    const { numbers, spawned } = rig();
    const a = frag(5, [
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    const b = frag(6, [[7, 8, 9, 10, 11, 12, 13]], a.length + 1);
    // Interleaved, as two frags a reload apart land.
    numbers.update(session([...a.slice(0, 3), ...b.slice(0, 2), ...a.slice(3), ...b.slice(2)]), 30);
    expect(callouts(spawned).map((s) => s.event.text)).toEqual(['x6', 'x7']);
  });

  it('pops nothing for a shell whose last bomblet is stale at its first read, or never landed', () => {
    const { numbers, spawned } = rig();
    numbers.update(session(frag(5, [[1, 2, 3, 4, 5, 6]])), 40);
    expect(callouts(spawned)).toEqual([]);
    // A run that ended between bomblets drops the rest: no callout, and the tally is let go.
    const cut = frag(6, [[1, 2, 3, 4, 5, 6]], 1, 100).slice(0, 3);
    numbers.update(session(cut, 1), 106);
    const next = frag(7, [[1, 2, 3, 4, 5, 6]], 4, 200);
    numbers.update(session([...cut, ...next], 1), 211);
    expect(callouts(spawned).map((s) => s.event.text)).toEqual(['x6']);
    // Shot 6's tally was let go at shot 7's burst: its last bomblet, read fresh, pops nothing.
    const last = entry(4 + next.length, 212, bomblet(6, TURRET_BOMBLETS - 1));
    numbers.update(session([...cut, ...next, last], 1), 212);
    expect(callouts(spawned).map((s) => s.event.text)).toEqual(['x6']);
  });

  it('starts over with a new seat', () => {
    const { numbers, spawned } = rig();
    const old = frag(5, [[1, 2, 3, 4]]).slice(0, 4);
    numbers.update(session(old), 14);
    // The new seat joined after its frag burst: the old seat's tally of shot 5 is gone.
    const fresh = frag(5, [[], [], [], [], [], [], [], [5, 6, 7]], 1, 60).slice(1);
    numbers.update(session(fresh, 50), 71);
    expect(callouts(spawned)).toEqual([]);
  });
});
