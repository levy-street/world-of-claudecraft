// Fire and Fly hunts in the engine (src/sim/minigames/turret_rally.ts): members walk to
// their places at a rally, stand, and leave together a second after the cue; the cue comes
// once every living member stands or once the hold timer since the first gathering
// member's arrival runs out; a thrown member walks back, a late one goes alone at the
// pack's pace, scouts break out at their own, a sprint group never gathers.
import { describe, expect, it } from 'vitest';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_ARENA, TURRET_RALLY, TURRET_TIMING } from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import { positionAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretMonster,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretRallyId, turretRallySlot } from '../src/sim/minigames/turret_rally';
import type { TurretGroupDef, TurretScenarioDef, TurretWaveEntry } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const START = 0;
const WOLF_MARCH = MOBS.forest_wolf.moveSpeed * TURRET_TIMING.marchFactor;
const MUSTER = { speedScale: 1, speedScaleMax: 1.35 } as const;
const SCOUT = { role: 'scout', speedScale: 2.2, speedScaleMax: 2.6 } as const;
const PACK = { advanceScale: 1.2, delayTicks: 0 } as const;

/** An entry of a hunt wave: its pack (absent with a sprint role, which runs in the sprint group). */
type HuntEntry = Omit<TurretWaveEntry, 'role'> & { pack?: number; role?: 'scout' | 'sprint' };

interface HuntOptions {
  packs: readonly { advanceScale: number; delayTicks: number }[];
  minRadius: number;
  maxRadius: number;
  holdTicks: number;
  spreadTicks: number;
  widthTurn: number;
  sprintDelayTicks: number;
}

/** One hunt wave: each pack a group of its entries with the shared rally knobs, the sprint group last. */
function scenario(
  entries: HuntEntry[],
  options: Partial<HuntOptions> = {},
  coreDamage = 1,
): TurretScenarioDef {
  const hunt: HuntOptions = {
    packs: [PACK],
    minRadius: 28,
    maxRadius: 28,
    holdTicks: 400,
    spreadTicks: 20,
    widthTurn: 0.05,
    sprintDelayTicks: 0,
    ...options,
  };
  const plain = ({ pack: _pack, role, ...entry }: HuntEntry): TurretWaveEntry =>
    role === 'scout' ? { ...entry, role } : entry;
  const groups: TurretGroupDef[] = hunt.packs.map((pack, p) => ({
    brick: 'pack',
    entries: entries.filter((e) => e.pack === p).map(plain),
    minRadius: hunt.minRadius,
    maxRadius: hunt.maxRadius,
    holdTicks: hunt.holdTicks,
    spreadTicks: hunt.spreadTicks,
    widthTurn: hunt.widthTurn,
    advanceScale: pack.advanceScale,
    delayTicks: pack.delayTicks,
  }));
  const sprint = entries.filter((e) => e.role === 'sprint').map(plain);
  if (sprint.length)
    groups.push({
      brick: 'sprint',
      entries: sprint,
      spreadTicks: hunt.spreadTicks,
      widthTurn: hunt.widthTurn,
      delayTicks: hunt.sprintDelayTicks,
    });
  return {
    ...TURRET_SCENARIO_STANDARD,
    id: 'test_hunt',
    boardKey: 'test',
    waves: [{ groups, coreDamage }],
  };
}

interface Run {
  state: TurretDefenseState;
  tick: number;
  events: { tick: number; event: TurretEvent }[];
  /** The tick each monster first stood at its place. */
  held: Map<number, number>;
  /** Every monster seen, and those ever carrying a rally. */
  seen: Map<number, TurretMonster>;
  rallied: Set<number>;
  /** Each monster as it first appeared on the field. */
  born: Map<number, { tick: number; state: string; rally?: number; pace?: number; at: number }>;
}

function start(def: TurretScenarioDef, seed = 5): Run {
  return {
    state: createTurretDefense(resolveTurretPlan(def), { x: 0, z: 0 }, seed, START),
    tick: START,
    events: [],
    held: new Map(),
    seen: new Map(),
    rallied: new Set(),
    born: new Map(),
  };
}

function step(run: Run): TurretEvent[] {
  const events = tickTurretDefense(run.state, ++run.tick, flat);
  for (const event of events) run.events.push({ tick: run.tick, event });
  for (const m of run.state.monsters) {
    if (!run.seen.has(m.id)) {
      const p = positionAt(m.seg, run.tick, flat);
      run.born.set(m.id, {
        tick: run.tick,
        state: m.state,
        rally: m.rally,
        pace: m.pace,
        at: Math.hypot(p.x, p.z),
      });
    }
    run.seen.set(m.id, m);
    if (m.rally !== undefined) run.rallied.add(m.id);
    if (m.state === 'hold' && !run.held.has(m.id)) run.held.set(m.id, run.tick);
  }
  return events;
}

function until(run: Run, done: () => boolean, bound = 4000): void {
  for (let i = 0; i < bound && !done(); i++) step(run);
  expect(done()).toBe(true);
}

function cues(run: Run) {
  return run.events.flatMap(({ tick, event }) =>
    event.type === 'rallyCue' ? [{ tick, ...event }] : [],
  );
}

const pos = (m: TurretMonster, tick: number) => positionAt(m.seg, tick, flat);

describe('a rally', () => {
  it('gathers every member at its own place, cues once all stand, and leaves 1 s later at one pace', () => {
    const run = start(
      scenario([
        { templateId: 'forest_wolf', count: 6, level: 2, ...MUSTER, pack: 0, leads: true },
      ]),
    );
    until(run, () => cues(run).length > 0);
    const [cue] = cues(run);
    const { state } = run;
    const rally = state.rallies?.find((r) => r.id === cue.rally);
    expect(rally).toBeDefined();
    expect(cue.rally).toBe(turretRallyId(0, 0));
    // Every member stands at its place, facing the tower, and the leader cries.
    expect(state.monsters).toHaveLength(6);
    for (const m of state.monsters) {
      expect(m.state).toBe('hold');
      const slot = turretRallySlot(rally!, 0, 0, m.slot!);
      const at = pos(m, cue.tick);
      expect(Math.hypot(at.x - slot.x, at.z - slot.z)).toBeLessThan(1e-9);
      expect(m.facing).toBeCloseTo(Math.atan2(-at.x, -at.z), 12);
    }
    expect(cue.id).toBe(1);
    expect(rally!.leader).toBe(1);
    expect(Math.hypot(cue.x, cue.z)).toBeCloseTo(28, 9);
    // Gathered before the timer: the cue is the last arrival's tick, the departure 1 s on.
    expect(cue.tick).toBe(Math.max(...run.held.values()));
    expect(cue.tick).toBeLessThan(rally!.firstArrivalTick + rally!.holdTicks);
    expect(cue.departTick - cue.tick).toBe(TURRET_RALLY.cueLeadTicks);
    expect(TURRET_RALLY.cueLeadTicks).toBe(20);
    until(run, () => run.tick === cue.departTick);
    expect(state.rallies ?? []).toEqual([]);
    const pace = WOLF_MARCH * PACK.advanceScale;
    for (const m of state.monsters) {
      expect(m.state).toBe('march');
      expect(m.seg.start).toBe(cue.departTick);
      expect(m.seg.kind === 'march' && m.seg.speed).toBeCloseTo(pace, 12);
      expect(m.pace).toBeCloseTo(pace, 12);
      expect(m.rally).toBeUndefined();
      expect(m.slot).toBeUndefined();
    }
  });

  it('walks members in at their own drawn paces, keyed by id, inside the band', () => {
    const run = start(
      scenario([{ templateId: 'forest_wolf', count: 8, level: 2, ...MUSTER, pack: 0 }]),
    );
    until(run, () => run.state.monsters.length === 8);
    const paces = run.state.monsters.map((m) => m.pace!);
    for (const p of paces) {
      expect(p).toBeGreaterThanOrEqual(WOLF_MARCH);
      expect(p).toBeLessThanOrEqual(WOLF_MARCH * 1.35);
    }
    expect(new Set(paces).size).toBe(8);
    for (const m of run.state.monsters) {
      expect(m.state).toBe('muster');
      expect(m.seg.kind === 'march' && m.seg.speed).toBe(m.pace);
    }
    const again = start(
      scenario([{ templateId: 'forest_wolf', count: 8, level: 2, ...MUSTER, pack: 0 }]),
    );
    until(again, () => again.state.monsters.length === 8);
    expect(again.state.monsters.map((m) => m.pace)).toEqual(paces);
  });

  it('cues on the timer while a member is still out, and sends the late ones alone at the pack pace', () => {
    const run = start(
      scenario([{ templateId: 'forest_wolf', count: 6, level: 2, ...MUSTER, pack: 0 }], {
        spreadTicks: 400,
        holdTicks: 40,
      }),
    );
    until(run, () => cues(run).length > 0);
    const [cue] = cues(run);
    const rally = run.state.rallies!.find((r) => r.id === cue.rally)!;
    expect(cue.tick).toBe(rally.firstArrivalTick + 40);
    const standing = run.state.monsters.filter((m) => m.state === 'hold').length;
    expect(standing).toBeLessThan(6);
    until(run, () => run.tick === cue.departTick);
    const pace = WOLF_MARCH * PACK.advanceScale;
    // Whoever walked in or stood: all go for the tower now, at the pack's pace.
    for (const m of run.state.monsters) {
      expect(m.state).toBe('march');
      expect(m.seg.start).toBe(cue.departTick);
      expect(m.pace).toBeCloseTo(pace, 12);
    }
    // Those spawning after the departure skip the rally and march in at the pack's pace.
    until(run, () => run.born.size === 6);
    const late = [...run.born.values()].filter((b) => b.tick > cue.departTick);
    expect(late.length).toBeGreaterThan(0);
    for (const b of late) {
      expect(b.state).toBe('march');
      expect(b.rally).toBeUndefined();
      expect(b.pace).toBeCloseTo(pace, 12);
      expect(b.at).toBeCloseTo(TURRET_ARENA.spawnRadius, 6);
    }
  });

  it('walks a thrown member back to its place, and waits for it before the cue', () => {
    const run = start(
      scenario([{ templateId: 'forest_wolf', count: 4, level: 2, ...MUSTER, pack: 0 }], {
        spreadTicks: 120,
      }),
    );
    until(run, () => run.held.size > 0);
    const [first] = [...run.held.keys()];
    const target = run.state.monsters.find((m) => m.id === first)!;
    const at = pos(target, run.tick);
    run.state.readyTick = run.tick;
    expect(fireTurret(run.state, run.tick, at.x, at.z, flat).ok).toBe(true);
    until(run, () => target.state === 'fly');
    expect(target.hp).toBeGreaterThan(0);
    until(run, () => target.state === 'muster');
    // Back on its feet while the pack gathers: to its own place, at its own pace.
    const rally = run.state.rallies![0];
    const slot = turretRallySlot(rally, 0, 0, target.slot!);
    const end = pos(target, target.seg.end);
    expect(Math.hypot(end.x - slot.x, end.z - slot.z)).toBeLessThan(1e-6);
    expect(target.seg.kind === 'march' && target.seg.speed).toBe(target.pace);
    const back = run.tick;
    until(run, () => cues(run).length > 0);
    const [cue] = cues(run);
    expect(cue.tick).toBeGreaterThan(back);
    expect(target.state).toBe('hold');
    expect(run.state.monsters.every((m) => m.state === 'hold')).toBe(true);
  });

  it('never waits for a dead member, and its first living packmate of its kind cries when the leader fell', () => {
    const run = start(
      scenario(
        [{ templateId: 'forest_wolf', count: 4, level: 2, ...MUSTER, pack: 0, leads: true }],
        { spreadTicks: 200 },
        100_000,
      ),
    );
    until(run, () => run.state.monsters.length === 1);
    const leader = run.state.monsters[0];
    expect(run.state.rallies![0].leader).toBe(leader.id);
    const at = pos(leader, run.tick);
    run.state.readyTick = run.tick;
    fireTurret(run.state, run.tick, at.x, at.z, flat);
    until(run, () => leader.hp <= 0);
    until(run, () => cues(run).length > 0);
    const [cue] = cues(run);
    const rally = run.state.rallies!.find((r) => r.id === cue.rally)!;
    // Gathered, not timed out: the dead leader is not waited for.
    expect(cue.tick).toBeLessThan(rally.firstArrivalTick + rally.holdTicks);
    const living = run.state.monsters.filter((m) => m.hp > 0);
    expect(living.every((m) => m.state === 'hold')).toBe(true);
    expect(cue.id).toBe(Math.min(...living.map((m) => m.id)));
  });

  it("hands a fallen leader's cry only to a living member of its own kind, else stays silent", () => {
    function cueAfterLeaderFalls(wolves: number) {
      const run = start(
        scenario(
          [
            { templateId: 'wild_boar', count: 3, level: 2, ...MUSTER, pack: 0 },
            { templateId: 'forest_wolf', count: wolves, level: 2, ...MUSTER, pack: 0, leads: true },
          ],
          { spreadTicks: 200 },
          100_000,
        ),
      );
      const leaderId = () => run.state.rallies?.[0]?.leader ?? -1;
      until(run, () => leaderId() >= 0);
      const leader = run.state.monsters.find((m) => m.id === leaderId())!;
      const at = pos(leader, run.tick);
      run.state.readyTick = run.tick;
      fireTurret(run.state, run.tick, at.x, at.z, flat);
      until(run, () => leader.hp <= 0);
      until(run, () => cues(run).length > 0);
      const living = run.state.monsters.filter((m) => m.hp > 0);
      return { cue: cues(run)[0], leader, living };
    }
    // A boar spawns first, so the lowest living id is never the wolves' heir.
    const heir = cueAfterLeaderFalls(2);
    const wolves = heir.living.filter((m) => m.kind === heir.leader.kind);
    expect(wolves.length).toBeGreaterThan(0);
    expect(Math.min(...heir.living.map((m) => m.id))).toBeLessThan(wolves[0].id);
    expect(heir.cue.id).toBe(Math.min(...wolves.map((m) => m.id)));
    // A lone leader fallen: no one of its kind is left, and no other creature cries for it.
    const lone = cueAfterLeaderFalls(1);
    expect(lone.living.length).toBeGreaterThan(0);
    expect(lone.living.some((m) => m.kind === lone.leader.kind)).toBe(false);
    expect(lone.cue.id).toBe(-1);
  });

  it('breaks the scouts out at their own pace, starts the timer on the pack, and never gathers a sprint', () => {
    const run = start(
      scenario(
        [
          { templateId: 'forest_wolf', count: 4, level: 2, ...MUSTER, pack: 0, leads: true },
          { templateId: 'forest_wolf', count: 2, level: 2, ...SCOUT, pack: 0 },
          { templateId: 'tunnel_rat', count: 3, level: 6, role: 'sprint', speedScale: 2.4 },
        ],
        { sprintDelayTicks: 0 },
      ),
    );
    const plan = run.state.plan;
    const role = (m: TurretMonster) => plan.kinds[m.kind].role;
    until(run, () => cues(run).length > 0);
    const rally = run.state.rallies![0];
    const scoutsHeld = [...run.held.entries()].filter(([id]) => {
      const m = run.state.monsters.find((x) => x.id === id);
      return m && role(m) === 'scout';
    });
    const packHeld = [...run.held.entries()].filter(([id]) => {
      const m = run.state.monsters.find((x) => x.id === id);
      return m && role(m) === undefined;
    });
    // The scouts arrive first and wait; the timer starts with the pack's own first arrival.
    expect(Math.min(...scoutsHeld.map(([, t]) => t))).toBeLessThan(
      Math.min(...packHeld.map(([, t]) => t)),
    );
    expect(rally.firstArrivalTick).toBe(Math.min(...packHeld.map(([, t]) => t)));
    const [cue] = cues(run);
    until(run, () => run.tick === cue.departTick);
    for (const m of run.state.monsters) {
      if (role(m) === 'sprint') continue;
      const speed = m.seg.kind === 'march' ? m.seg.speed : 0;
      expect(m.seg.start).toBe(cue.departTick);
      if (role(m) === 'scout') {
        expect(speed).toBe(m.pace);
        expect(speed).toBeGreaterThanOrEqual(WOLF_MARCH * 2.2);
        expect(speed).toBeLessThanOrEqual(WOLF_MARCH * 2.6);
      } else expect(speed).toBeCloseTo(WOLF_MARCH * PACK.advanceScale, 12);
    }
    // The sprint group ran straight in from the ring: never a rally, never a stand.
    const sprint = [...run.seen.values()].filter((m) => role(m) === 'sprint');
    expect(sprint).toHaveLength(3);
    for (const m of sprint) {
      expect(run.rallied.has(m.id)).toBe(false);
      expect(run.held.has(m.id)).toBe(false);
    }
  });

  it('never lets two rallies leave within the departure gap', () => {
    const entries = [0, 1].map((pack) => ({
      templateId: 'forest_wolf',
      count: 3,
      level: 2,
      speedScale: 1,
      pack,
    }));
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = start(
        scenario(entries, { packs: [PACK, PACK], widthTurn: 0.02, spreadTicks: 0 }),
        seed,
      );
      until(run, () => cues(run).length === 2);
      const [a, b] = cues(run);
      expect(Math.abs(a.departTick - b.departTick)).toBeGreaterThanOrEqual(
        TURRET_RALLY.departGapTicks,
      );
      for (const cue of [a, b]) expect(cue.departTick - cue.tick).toBe(TURRET_RALLY.cueLeadTicks);
    }
  });
});

describe('the gathering disc', () => {
  it('lays its places without a draw, spaced, turned to the advance axis', () => {
    const rally = { x: 0, z: 30 };
    const slots = Array.from({ length: 18 }, (_, n) => turretRallySlot(rally, 0, 0, n));
    expect(Array.from({ length: 18 }, (_, n) => turretRallySlot(rally, 0, 0, n))).toEqual(slots);
    for (const [i, a] of slots.entries()) {
      for (const b of slots.slice(i + 1))
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.2);
      expect(Math.hypot(a.x - rally.x, a.z - rally.z)).toBeLessThan(
        TURRET_RALLY.slotSpacing * Math.sqrt(18),
      );
    }
    // The same disc on another side of the tower, turned with its axis.
    const turned = { x: 30, z: 0 };
    for (let n = 0; n < 18; n++) {
      const a = slots[n];
      const b = turretRallySlot(turned, 0, 0, n);
      expect(b.x).toBeCloseTo(a.z, 9);
      expect(b.z).toBeCloseTo(-a.x, 9);
    }
  });
});

describe('a whole hunt', () => {
  function trace(seed: number): string[] {
    const plan = resolveTurretPlan(TURRET_MISSION_PACK);
    const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
    const out: string[] = [];
    for (let t = 1; t < 20 * 60 * 6 && state.phase !== 'won' && state.phase !== 'lost'; t++) {
      for (const e of tickTurretDefense(state, t, flat)) out.push(`${t} ${JSON.stringify(e)}`);
      if (t < state.readyTick) continue;
      let best: { x: number; z: number } | null = null;
      // The foot only: no shell ever reaches a rally (the nearest stands 22 yd out).
      let bestD = 16;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const p = positionAt(m.seg, t, flat);
        const d = Math.hypot(p.x, p.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best)
        for (const e of fireTurret(state, t, best.x, best.z, flat).events)
          out.push(`${t} ${JSON.stringify(e)}`);
    }
    out.push(state.phase);
    return out;
  }

  it('replays The Pack exactly from one seed, its cues included, and differently from another', () => {
    const a = trace(17);
    expect(a.at(-1)).toBe('won');
    expect(a.filter((line) => line.includes('"rallyCue"')).length).toBe(
      TURRET_MISSION_PACK.waves.reduce(
        (n, w) => n + w.groups.filter((g) => g.brick === 'pack').length,
        0,
      ),
    );
    expect(trace(17)).toEqual(a);
    expect(trace(18)).not.toEqual(a);
  }, 60_000);
});
