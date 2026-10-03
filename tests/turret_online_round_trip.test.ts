import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire, isWorldQuestWireCommand } from '../server/quest_command_wire';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import { emitTurretSelfKeys, TURRET_SEAT_KEYS, turretWireNumber } from '../server/turret_self_wire';
import { dispatchVehicleCommand } from '../server/vehicle_command_wire';
import { type QuestWorldCommand, QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import {
  TURRET_DEFAULT_SCENARIO,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_SHOCKWAVE, TURRET_TIMING } from '../src/sim/content/turret_defense';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { BUILTIN_WORLD, dungeonAt } from '../src/sim/data';
import { fireAndFlyScoreboardId } from '../src/sim/fire_and_fly_scoreboards';
import { type MotionSegment, positionAt } from '../src/sim/minigames/thrown_body';
import {
  resolveTurretPlan,
  turretChargesGiven,
  turretChargesLeft,
} from '../src/sim/minigames/turret_defense_plan';
import { turretResult } from '../src/sim/minigames/turret_result';
import { Sim } from '../src/sim/sim';
import type { TurretDefenseView, TurretSessionView } from '../src/sim/turret_defense_session';
import { seatTurret } from '../src/sim/turret_defense_session';
import type { SimEvent, TurretScenarioDef, TurretSession, WorldContent } from '../src/sim/types';
import { turretClockFor, turretSessionFor } from '../src/sim/vehicles';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { TurretFeedbackReader } from '../src/ui/hud/vehicle/turret_feedback_reader_core';
import { TURRET_BRICKS_SCENARIO } from './helpers/turret_wave_plan';

const RUN_BOUND = 20 * 60 * 8;
// The seat state's bytes per second (its key family, each key's `,"key":` counted; lot H4),
// pinned about 10 percent over the measured won runs on this seed against silent growth: only
// the keys a revision moved resend, so a crowd costs little. Standing Watch sits near 3.6 KB/s
// since lot R5b (two fifths more monsters at twice the pace in shorter runs, the revision, the
// aim and the stats moving every shot). Before the split the whole state rode one key: 14.9
// KB/s here, 53.2 on the Veterans' Test and 61.9 on The Pack.
const SEAT_BYTES_PER_SECOND_CEILING = 3_950;
// Per trial (lot R5b): the introduction about 3.9 KB/s (half again as many monsters, quicker),
// the Veterans' Test about 5.7 (an eighteen-strong charge in its last wave).
const SEAT_BYTES_PER_SECOND_BY_TRIAL: Record<string, number> = {
  introduction: 4_300,
  hard: 6_300,
};
// Per mission, re-measured with the waves chained on their clear (lot R5) and The Pack of lot
// R5b: The Deluge about 12.0 KB/s, the highest (276 monsters, the last 60), The Powder Store
// 10.3 (207, the last 63), The Pack 6.9 (163 monsters gathering at rallies; 12.7 with lot R3's
// 234), Heavy Tread 7.2 (82 colossi), The Cracked Tower 6.3 to 6.4 (156).
const SEAT_BYTES_PER_SECOND_BY_MISSION: Record<string, number> = {
  pack: 7_600,
  giants: 7_900,
  deluge: 13_200,
  brittle: 7_050,
  powder: 11_350,
};
// Every run's worst one-second window of the seat state (a sliding 20-tick sum, one full resend
// of a mid-run resume included), against the re-decision line of BANDWIDTH_OPINION.md (a seat's
// worst second past a walking crowd's, 153 KB with the self record's base). Measured on this
// seed since lot R5b: The Powder Store 61.8 KB, The Deluge 58.8, The Cracked Tower 35.3, Heavy
// Tread 25.4, The Pack 17.9, the Veterans' Test 14.0, every other scenario under 8 (lot H4:
// 17.8 KB at most; before the split: 124 to 128 KB). The ceiling sits about 10 percent over the
// worst any measured run reached, not this seed's: the H4 probe (no resume) over the world seed
// and Sim seeds 1 to 8, bare and armed, peaks at 72.7 (The Deluge, a Sim seed) and 72.1 (The
// Powder Store, world seed, armed). A content lot that crosses it has to say so and re-measure.
const SEAT_WORST_SECOND_CEILING = 80_000;
// The same window over everything the seat adds to its player's socket: the state keys, the
// plan's `turp` and the seat's own events (the bomblets and the feedback entries). Measured on
// this seed: The Deluge 86.4 KB, The Powder Store 85.7, The Pack 28.4 (63.9 with lot R3's
// draft); the probe's peak is 102.2 (The Deluge, a Sim seed), then 98.8 (The Powder Store, world
// seed, armed). With the self record's base about 12 KB more, the ceiling stays under the
// 153 KB line (about 125 KB).
const SEAT_WIRE_WORST_SECOND_CEILING = 112_500;
const DRIFT_BOUND_YD = 0.005;
const FORGED_PID = 987_654;
const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };
// The arena reads no world spawn, so the round trip skips ticking the open world's crowds.
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The online client's quest mirror, its commands carried through the server's own router. */
class WireClient extends QuestWorldWireState {
  constructor(
    private readonly sim: Sim,
    private readonly pid: number,
  ) {
    super();
  }

  protected override sendQuestWorldCommand(command: QuestWorldCommand): void {
    const forged = { ...command, pid: FORGED_PID, damage: 1e6, readyTick: 0 };
    const wire = JSON.parse(JSON.stringify(forged));
    if (isWorldQuestWireCommand(wire.cmd)) dispatchWorldQuestWire(this.sim, wire, this.pid);
    else dispatchVehicleCommand(this.sim, this.pid, wire);
  }

  route(event: SimEvent): void {
    this.applyQuestWorldEvent(JSON.parse(JSON.stringify(event)) as SimEvent);
  }
}

const SEAT_KEYS: ReadonlySet<string> = new Set(TURRET_SEAT_KEYS);

/**
 * The server's per-session byte diff over the turret keys, parsed as the client does.
 * `bytes` counts what each key puts on the socket, its `,"key":` included.
 */
function wirePass(
  sent: Record<string, string>,
  sim: Sim,
  pid: number,
  bytes?: Record<string, number>,
): Record<string, unknown> {
  let extra = '';
  emitTurretSelfKeys(
    (key, serialized) => {
      if (sent[key] === serialized) return;
      sent[key] = serialized;
      const field = `,"${key}":${serialized}`;
      if (bytes) bytes[key] = (bytes[key] ?? 0) + field.length;
      extra += field;
    },
    sim.meta(pid)!,
    sim.tickCount,
    sent,
  );
  return JSON.parse(`{${extra.slice(1)}}`);
}

/** The seat state's bytes in one pass's counts. */
function seatBytes(bytes: Record<string, number>): number {
  let sum = 0;
  for (const key of TURRET_SEAT_KEYS) sum += bytes[key] ?? 0;
  return sum;
}

/** The heaviest one-second window: the largest sum over 20 consecutive ticks. */
function worstSecond(perTick: readonly number[]): number {
  let worst = 0;
  let sum = 0;
  for (const [i, n] of perTick.entries()) {
    sum += n - (i >= 20 ? perTick[i - 20] : 0);
    worst = Math.max(worst, sum);
  }
  return worst;
}

/** A value as the seat state keys carry it: the rounding the server applies, both sides alike. */
function rounded(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, turretWireNumber));
}

/** The state within the wire rounding; the event-built ring and the result stats exact. */
function expectMirrors(shown: TurretSessionView | null, truth: TurretSessionView | null): void {
  expect(rounded(shown && { ...shown, feedback: [] })).toEqual(
    rounded(truth && { ...truth, feedback: [] }),
  );
  expect(shown?.feedback).toEqual(truth?.feedback);
  expect(shown?.defense.stats).toEqual(truth?.defense.stats);
}

const DRIFT_SAMPLES = 16;

/** The farthest a body drawn from the rounded segment strays from the exact one over its span. */
function segmentDrift(shown: MotionSegment, exact: MotionSegment): number {
  let worst = 0;
  for (let i = 0; i <= DRIFT_SAMPLES; i++) {
    const t = exact.start + ((exact.end - exact.start) * i) / DRIFT_SAMPLES;
    const a = positionAt(shown, t, ground);
    const b = positionAt(exact, t, ground);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  return worst;
}

function nearestLive(defense: TurretDefenseView, tick: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of defense.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, ground);
    const d = Math.hypot(p.x - defense.cx, p.z - defense.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function serverPlayer() {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    noPlayer: true,
    world: EMPTY_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
  sim.drainEvents();
  return { sim, pid };
}

function turretEvents(events: readonly SimEvent[], pid: number) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'turretDefense' }> =>
      e.type === 'turretDefense' && e.pid === pid,
  );
}

/** Whether a living body stands inside the Shockwave's reach at `tick`. */
function inReach(defense: TurretDefenseView, tick: number): boolean {
  return defense.monsters.some((m) => {
    if (m.hp <= 0) return false;
    const p = positionAt(m.seg, tick, ground);
    return Math.hypot(p.x - defense.cx, p.z - defense.cz) < TURRET_SHOCKWAVE.reach;
  });
}

/**
 * A whole seat played through the wire by the online client's nearest-first aimer (or
 * left to fall with `aim` off), the client's view checked against the server's every tick.
 * `armed`, the aimer spends what its own mirror says is left: a frag shell for each shot
 * while any remain, and a Shockwave whenever a body stands inside the reach and it has
 * rearmed.
 */
function playOnline(command: string | TurretScenarioDef, aim = true, armed = false) {
  const { sim, pid } = serverPlayer();
  const client = new WireClient(sim, pid);
  const sent: Record<string, string> = {};
  const before = { ...sim.entities.get(pid)!.pos };
  if (typeof command === 'string') sim.chat(command, pid);
  else expect(seatTurret(sim.ctx, pid, command)).toBeNull();
  expect(sim.meta(pid)?.vehicle?.kind).toBe('turret');

  let priorTruth: TurretSessionView | null = null;
  let shots = 0;
  let slams = 0;
  let lullTried = false;
  let lullWatch = false;
  const routed = new Set<string>();
  let identical = 0;
  let phase = '';
  let priorWave = 0;
  const chained: number[] = [];
  const phases = new Set<string>();
  let ticks = 0;
  const bytes: Record<string, number> = {};
  const seatPerTick: number[] = [];
  const seatWirePerTick: number[] = [];
  let resumed = false;
  let late: { client: WireClient; sent: Record<string, string> } | null = null;
  let lateTicks = 0;
  const drift = { march: 0, fly: 0, skid: 0 };
  const drawn = { march: 0, fly: 0, skid: 0 };
  const drawnSegments = new Set<string>();
  let rallied = 0;
  const states = new Set<string>();
  for (let i = 0; i < RUN_BOUND && phase !== 'won' && phase !== 'lost'; i++) {
    const events = sim.tick();
    ticks++;
    let fed = 0;
    let eventBytes = 0;
    for (const event of events) {
      if (event.pid !== pid) continue;
      eventBytes += JSON.stringify(event).length;
      client.route(event);
      late?.client.route(event);
      if (event.type !== 'turretDefense') continue;
      fed++;
      const e = event.event;
      if (lullWatch) expect(['fired', 'shockwave']).not.toContain(e.type);
      routed.add(e.type === 'fired' && e.weapon ? `fired ${e.weapon}` : e.type);
    }
    const prior = client.turretSession;
    const seen = sim.meta(pid)?.vehicle as TurretSession | undefined;
    const lastWave = seen ? seen.defense.plan.waves.length - 1 : -1;
    const resume = !resumed && seen?.defense.phase === 'wave' && seen.defense.wave === lastWave;
    if (resume) {
      // A resume or a spectator switch: the server forgets what this session holds.
      for (const key of Object.keys(sent)) delete sent[key];
      resumed = true;
    }
    const counts: Record<string, number> = {};
    const self = wirePass(sent, sim, pid, counts);
    for (const [key, n] of Object.entries(counts)) bytes[key] = (bytes[key] ?? 0) + n;
    seatPerTick.push(seatBytes(counts));
    seatWirePerTick.push(seatBytes(counts) + (counts.turp ?? 0) + eventBytes);
    if (resume) expect(Object.keys(self).sort()).toEqual(['turp', ...TURRET_SEAT_KEYS].sort());
    client.applyQuestSelfSnapshot(self, sim.time, sim.tickCount);

    const authoritative = turretSessionFor(sim.ctx, pid);
    expect(client.turretClock).toBe(turretClockFor(sim.ctx, pid));
    if (!late && seen?.defense.phase === 'wave' && seen.defense.wave === 1) {
      late = { client: new WireClient(sim, pid), sent: {} };
    }
    if (late) {
      // A session that joins mid-wave: every key from scratch, then the same diffs.
      late.client.applyQuestSelfSnapshot(wirePass(late.sent, sim, pid), sim.time, sim.tickCount);
      const { feedback: _ring, ...seat } = authoritative!;
      expect(rounded({ ...late.client.turretSession!, feedback: [] })).toEqual(
        rounded({ ...seat, feedback: [] }),
      );
      lateTicks++;
    }
    if (Object.keys(self).length === 0 && fed === 0 && prior) {
      // Nothing moved on the wire: the same object on both sides, so still equal.
      expect(client.turretSession).toBe(prior);
      expect(authoritative).toBe(priorTruth);
      identical++;
    } else {
      expectMirrors(client.turretSession, authoritative);
    }
    priorTruth = authoritative;

    const view = client.turretSession as TurretSessionView;
    if (authoritative) {
      expect(turretChargesLeft(view.defense)).toEqual(turretChargesLeft(authoritative.defense));
      expect(view.defense.shockReadyTick).toBe(authoritative.defense.shockReadyTick);
    }
    if (view.defense.rallies?.length) rallied++;
    for (const [index, m] of view.defense.monsters.entries()) {
      states.add(m.state);
      const kind = m.seg.kind;
      if (kind === 'still' || drawnSegments.has(`${m.id}:${m.seg.start}`)) continue;
      drawnSegments.add(`${m.id}:${m.seg.start}`);
      const exact = authoritative!.defense.monsters[index].seg;
      drift[kind] = Math.max(drift[kind], segmentDrift(m.seg, exact));
      drawn[kind]++;
    }
    // The next wave sets off on its clear's tick: the client's wave moves on straight from
    // one wave to the next, nothing of the cleared wave still living.
    if (view.defense.wave > priorWave) {
      expect([phase, view.defense.phase]).toEqual(['wave', 'wave']);
      chained.push(view.defense.monsters.filter((m) => m.hp > 0).length);
    }
    priorWave = view.defense.wave;
    phase = view.defense.phase;
    phases.add(phase);
    const clock = client.turretClock!;
    const left = turretChargesLeft(view.defense);
    const live = view.defense.phase === 'wave';
    lullWatch = false;
    if (armed && !lullTried && view.defense.phase === 'intro') {
      // Both weapons clicked in the intro: refused on the server, nothing spent or sent.
      lullTried = true;
      lullWatch = true;
      const seat = (sim.meta(pid)!.vehicle as TurretSession).defense;
      const { rev, shockReadyTick } = seat;
      const aimAt = { x: seat.cx + 10, z: seat.cz };
      client.useVehicleAction('turret_frag', aimAt);
      client.useVehicleAction('turret_shockwave', aimAt);
      expect(seat.rev).toBe(rev);
      expect(seat.shockReadyTick).toBe(shockReadyTick);
      expect(turretChargesLeft(seat)).toEqual(seat.plan.arsenal);
    }
    if (armed && live && left.shockwave > 0 && clock >= view.defense.shockReadyTick) {
      if (inReach(view.defense, clock)) {
        client.useVehicleAction('turret_shockwave', { x: 0, z: 0 });
        slams++;
      }
    }
    if (!aim || clock < view.defense.readyTick) continue;
    const target = nearestLive(view.defense, clock);
    if (!target) continue;
    const frag = armed && live && left.fragmentation > 0;
    client.useVehicleAction(frag ? 'turret_frag' : 'turret_fire', target);
    shots++;
  }
  expect(phase).toBe(aim ? 'won' : 'lost');
  if (aim) expect(resumed).toBe(true);
  expect(lateTicks).toBeGreaterThan(0);
  expect(lullTried).toBe(armed);
  expect(identical).toBeGreaterThan(0);
  expect(worstSecond(seatPerTick)).toBeLessThan(SEAT_WORST_SECOND_CEILING);
  expect(worstSecond(seatWirePerTick)).toBeLessThan(SEAT_WIRE_WORST_SECOND_CEILING);
  for (const kind of aim ? (['march', 'fly', 'skid'] as const) : (['march'] as const)) {
    expect(drawn[kind]).toBeGreaterThan(0);
    expect(drift[kind]).toBeLessThan(DRIFT_BOUND_YD);
  }
  return {
    sim,
    pid,
    client,
    sent,
    before,
    shots,
    slams,
    routed,
    chained,
    phases,
    rallied,
    states,
    seatBytesPerSecond: seatBytes(bytes) / (ticks / 20),
  };
}

describe('Fire and Fly online: the socket-free round trip', () => {
  it('mirrors the authoritative seat within the wire rounding every tick of a won run, then clears on leave', () => {
    const { sim, pid, client, sent, before, shots, seatBytesPerSecond, chained, phases } =
      playOnline('/dev turret');
    expect(shots).toBeGreaterThan(50);
    // Only the moved keys of the state per revision, pruned and rounded: about 3.6 KB/s over
    // this run (14.9 as one key, 23.7 before the pruning); a later lot that grows it fails here.
    expect(seatBytesPerSecond).toBeLessThan(SEAT_BYTES_PER_SECOND_CEILING);
    expect(chained).toEqual(TURRET_DEFAULT_SCENARIO.waves.slice(1).map(() => 0));
    expect(phases).toEqual(new Set(['intro', 'wave', 'won']));
    const ring = client.turretSession!.feedback;
    expect(ring.map((f) => f.seq)).toEqual(ring.map((_, i) => ring[0].seq + i));

    client.leaveVehicle();
    for (const event of sim.tick()) if (event.pid === pid) client.route(event);
    client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
    expect(sim.meta(pid)?.vehicle ?? null).toBeNull();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    expect(sim.entities.get(pid)!.pos).toEqual(before);
    expect(dungeonAt(sim.entities.get(pid)!.pos.x)).toBeNull();
  });

  it("mirrors every tick of a won mission that spends its limited weapons: charges, resupplies, rearm and every weapon's entries", () => {
    // The Cracked Tower gives both weapons and resupplies them after waves 3, 5 and 7.
    const { sim, pid, client, slams, routed, seatBytesPerSecond } = playOnline(
      '/dev turret brittle',
      true,
      true,
    );
    const truth = turretSessionFor(sim.ctx, pid)!;
    const plan = truth.defense.plan;
    expect(truth.defense.stats.resupplies).toBe(plan.resupplyWaves.length);
    const given = turretChargesGiven(plan, truth.defense.stats.resupplies);
    expect(given).toEqual({
      shockwave: plan.arsenal.shockwave + 3,
      fragmentation: plan.arsenal.fragmentation + 3,
    });
    expect(truth.defense.stats.frags).toBe(given.fragmentation);
    expect(truth.defense.stats.shockwaves).toBe(given.shockwave);
    expect(slams).toBeGreaterThanOrEqual(given.shockwave);
    expect(client.turretSession!.defense.stats).toEqual(truth.defense.stats);
    expect(turretChargesLeft(client.turretSession!.defense)).toEqual({
      shockwave: 0,
      fragmentation: 0,
    });
    // Each weapon's entries reached the client and matched the server's ring every tick.
    for (const kind of [
      'fired frag',
      'fragBurst',
      'bomblet',
      'shockwave',
      'shockwaveHit',
      'resupply',
    ])
      expect(routed.has(kind), kind).toBe(true);
    // The ring and the bomblets never ride the state keys, only the charges spent and resupplied (in
    // the stats) and the Shockwave's rearm tick do.
    expect(seatBytesPerSecond).toBeLessThan(SEAT_BYTES_PER_SECOND_BY_MISSION.brittle);
  });

  it.each(
    TURRET_SCENARIOS.filter((s) => s !== TURRET_DEFAULT_SCENARIO).map((s) => [s.boardKey, s]),
  )('mirrors every tick of a won %s run, its plan carried to the client', (key, scenario) => {
    const { client, seatBytesPerSecond, chained, phases } = playOnline(`/dev turret ${key}`);
    expect(seatBytesPerSecond).toBeLessThan(SEAT_BYTES_PER_SECOND_BY_TRIAL[key]);
    expect(chained).toEqual(scenario.waves.slice(1).map(() => 0));
    expect(phases).toEqual(new Set(['intro', 'wave', 'won']));
    const seat = client.turretSession!;
    expect(seat.defense.plan.scenarioId).toBe(scenario.id);
    expect(seat.defense.plan.integrity).toBe(scenario.integrity);
    expect(seat.waveCount).toBe(scenario.waves.length);
  });

  it('mirrors every tick of a won run of every brick and keg mode: surgers, a pack, a sprint group, a small group, a big one, a surge, random, lane, crown and route kegs', () => {
    const { client, chained, phases, routed, rallied, states } = playOnline(TURRET_BRICKS_SCENARIO);
    expect(phases).toEqual(new Set(['intro', 'wave', 'won']));
    expect(chained).toEqual(TURRET_BRICKS_SCENARIO.waves.slice(1).map(() => 0));
    // The pack's rally and its gathering members crossed the wire like the rest of the seat.
    expect(rallied).toBeGreaterThan(0);
    expect(states.has('muster')).toBe(true);
    expect(routed.has('barrelsPlaced')).toBe(true);
    const plan = client.turretSession!.defense.plan;
    expect(plan).toEqual(resolveTurretPlan(TURRET_BRICKS_SCENARIO));
    const bricks = new Set(plan.waves.flatMap((w) => w.groups.map((g) => g.brick)));
    expect(bricks).toEqual(new Set(['walkers', 'pack', 'surgers', 'sprint']));
    const lots = new Set(plan.waves.flatMap((w) => w.kegs.map((k) => k.mode)));
    expect(lots).toEqual(new Set(['random', 'crown', 'path']));
    const kegs = plan.waves.flatMap((w) => w.kegs);
    expect(kegs.some((k) => k.mode === 'random' && k.lanes)).toBe(true);
    expect(kegs.some((k) => k.mode === 'path' && k.placement !== 'axis' && k.minRadius)).toBe(true);
  }, 60_000);

  it.each(TURRET_MISSIONS.map((s) => [s.boardKey, s] as const))(
    'mirrors every tick of a won %s mission, its plan and its chained waves carried to the client',
    (key, mission) => {
      const { client, seatBytesPerSecond, chained, phases, rallied, states, routed } = playOnline(
        `/dev turret ${key}`,
      );
      expect(seatBytesPerSecond).toBeLessThan(SEAT_BYTES_PER_SECOND_BY_MISSION[key]);
      // The hunt's rallies, gathering states and departure cues crossed the wire, mirrored
      // every tick like the rest of the seat.
      const hunts = mission.waves.some((w) => w.groups.some((g) => g.brick === 'pack'));
      expect(rallied > 0).toBe(hunts);
      expect(states.has('muster') && states.has('hold')).toBe(hunts);
      expect(routed.has('rallyCue')).toBe(hunts);
      // Every wave set off on the tick the one before was cleared, with no pause and no
      // living tail, and the client's wave counter moved on with the server's.
      expect(chained).toEqual(mission.waves.slice(1).map(() => 0));
      expect(phases).toEqual(new Set(['intro', 'wave', 'won']));
      const seat = client.turretSession!;
      expect(seat.defense.plan).not.toHaveProperty('overlap');
      expect(seat.defense.phase).toBe('won');
      expect(seat.defense.plan.scenarioId).toBe(mission.id);
      expect(seat.defense.plan.waves.map((w) => [w.groups, w.kegs, w.kegCap])).toEqual(
        resolveTurretPlan(mission).waves.map((w) => [w.groups, w.kegs, w.kegCap]),
      );
    },
    // A mission's won run lasts minutes of play.
    60_000,
  );

  it("carries the instructor's locks, the recruitment and a mission's score through the wire", () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...EMPTY_WORLD, npcs: { [FIRE_AND_FLY_NPC_DEF.id]: FIRE_AND_FLY_NPC_DEF } },
    });
    sim.resetDay = '2026-09-06';
    const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
    sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel, pid);
    const player = sim.entities.get(pid)!;
    player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
    player.prevPos = { ...player.pos };
    sim.tick();
    sim.drainEvents();
    const meta = sim.meta(pid)!;
    meta.fireAndFlyRecruitment = { trialsWon: TURRET_SCENARIOS.length - 2, recruited: false };
    const client = new WireClient(sim, pid);
    const sent: Record<string, string> = {};
    let sentRev = -1;
    // The server re-diffs the heavy self keys only on a wireRev move (server/game.ts).
    const questPass = () => {
      if (meta.wireRev === sentRev) return;
      sentRev = meta.wireRev;
      const self: Record<string, unknown> = {};
      emitQuestSelfKeys(
        (key, value) => {
          const serialized = JSON.stringify(value);
          if (sent[key] === serialized) return;
          sent[key] = serialized;
          self[key] = JSON.parse(serialized);
        },
        sim,
        meta,
      );
      client.applyQuestSelfSnapshot(self, sim.time, sim.tickCount);
    };
    const pick = (courseId: string) => {
      client.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId });
      const events = sim.drainEvents().filter((e) => e.pid === pid);
      client.applyQuestSelfSnapshot(wirePass({}, sim, pid), sim.time, sim.tickCount);
      questPass();
      return events;
    };
    const win = () => {
      const defense = (meta.vehicle as TurretSession).defense;
      defense.phase = 'won';
      defense.result = turretResult(defense.plan, {
        phase: 'won',
        integrity: defense.plan.integrity,
        stats: { kills: 20, barrelKills: 0, bowled: 0, shockwaves: 0, frags: 0, resupplies: 0 },
      });
      const events = [...sim.tick(), ...sim.tick()].filter((e) => e.pid === pid);
      questPass();
      sim.leaveVehicle(pid);
      sim.drainEvents();
      return events;
    };
    questPass();
    expect(client.fireAndFlyRecruitment).toEqual({
      trialsWon: TURRET_SCENARIOS.length - 2,
      recruited: false,
    });

    const mission = TURRET_MISSIONS[0];
    const refused = pick(mission.id);
    expect(meta.vehicle ?? null).toBeNull();
    expect(refused).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'Master Gunner Alder has not cleared you for that yet.',
      }),
    );

    pick(TURRET_SCENARIOS[TURRET_SCENARIOS.length - 2].id);
    win();
    expect(client.fireAndFlyRecruitment.trialsWon).toBe(TURRET_SCENARIOS.length - 1);

    // A practice win moves nothing on the row, so only the recruitment moves wireRev.
    const last = TURRET_SCENARIOS[TURRET_SCENARIOS.length - 1];
    pick(last.id);
    expect(client.turretSession?.defense.plan.scenarioId).toBe(last.id);
    expect((meta.vehicle as TurretSession).worldQuest?.practice).toBe(true);
    win();
    expect(client.fireAndFlyRecruitment).toEqual({
      trialsWon: TURRET_SCENARIOS.length,
      recruited: true,
    });

    pick(mission.id);
    expect(client.turretSession?.defense.plan).toEqual(resolveTurretPlan(mission));
    const scored = win();
    expect(scored).toContainEqual(
      expect.objectContaining({
        type: 'worldQuestScore',
        board: fireAndFlyScoreboardId(mission.id, 'lifetime'),
        medal: 'gold',
      }),
    );
    expect(scored).toContainEqual(
      expect.objectContaining({ type: 'worldQuestMastery', stars: 3, missions: 1 }),
    );
  });

  it('mirrors every tick of a lost run, its result reaching the client on the last revision', () => {
    const { sim, pid, client } = playOnline('/dev turret', false);
    const result = client.turretSession!.defense.result;
    expect(result).toMatchObject({ won: false, medal: null });
    expect(result).toEqual(turretSessionFor(sim.ctx, pid)!.defense.result);
  });

  it('clears the ended seat the client mirrors as a Leave would, once it leaves on its own', () => {
    const { sim, pid, client, sent, before } = playOnline('/dev turret', false);
    const ended = client.turretSession!.defense.phaseEndTick;
    expect(ended).toBe(turretSessionFor(sim.ctx, pid)!.defense.phaseEndTick);
    const deadline = ended + TURRET_TIMING.endedSeatTicks;
    const step = () => {
      for (const event of sim.tick()) if (event.pid === pid) client.route(event);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
    };
    while (sim.tickCount < deadline - 1) step();
    expect(client.turretSession?.defense.phase).toBe('lost');
    expect(client.turretClock).toBe(deadline - 1);
    step();
    expect(sim.meta(pid)?.vehicle ?? null).toBeNull();
    for (const key of TURRET_SEAT_KEYS) expect(sent[key]).toBe('null');
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    expect(sim.entities.get(pid)!.pos).toEqual(before);
    expect(dungeonAt(sim.entities.get(pid)!.pos.x)).toBeNull();
  });

  it('leaves a seat it cannot read, once per unreadable stretch, rather than lock the player in', () => {
    const { sim, pid } = serverPlayer();
    const client = new WireClient(sim, pid);
    const sent: Record<string, string> = {};
    const before = { ...sim.entities.get(pid)!.pos };
    sim.chat('/dev turret', pid);
    client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
    expect(client.turretSession).not.toBeNull();
    const tur = JSON.parse(sent.tur) as { defense: Record<string, unknown> };
    // A skewed build's phase: the whole seat fails to decode.
    const unreadable = { tur: { ...tur, defense: { ...tur.defense, phase: 'overheated' } } };
    const leaves = vi.spyOn(client, 'leaveVehicle');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      client.applyQuestSelfSnapshot(unreadable, sim.time, sim.tickCount);
      expect(client.turretSession).toBeNull();
      expect(leaves).toHaveBeenCalledTimes(1);
      expect(sim.meta(pid)?.vehicle ?? null).toBeNull();
      expect(sim.entities.get(pid)!.pos).toEqual(before);
      // Still unreadable before the server's null lands: no second leave.
      client.applyQuestSelfSnapshot(unreadable, sim.time, sim.tickCount);
      expect(leaves).toHaveBeenCalledTimes(1);
      // The server's cleared seat ends the stretch; a later unreadable seat leaves again.
      client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
      expect(client.turretSession).toBeNull();
      sim.chat('/dev turret', pid);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
      expect(client.turretSession).not.toBeNull();
      client.applyQuestSelfSnapshot(unreadable, sim.time, sim.tickCount);
      expect(leaves).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('starts a resumed client with an empty ring and replays nothing', () => {
    const { sim, pid } = serverPlayer();
    const client = new WireClient(sim, pid);
    let sent: Record<string, string> = {};
    sim.chat('/dev turret', pid);
    for (let i = 0; i < 400; i++) {
      for (const event of sim.tick()) if (event.pid === pid) client.route(event);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
    }
    const lastSeen = client.turretSession!.feedback.at(-1)!.seq;
    expect(lastSeen).toBeGreaterThan(0);

    // A drop: the socket closes, the events of the gap are never sent, the resume resends
    // every self key from scratch.
    client.resetQuestWorldWireState();
    expect(client.turretSession).toBeNull();
    for (let i = 0; i < 40; i++) sim.tick();
    sent = {};
    let events: SimEvent[] = [];
    while (!events.length) {
      events = sim.tick().filter((e) => e.pid === pid && e.type === 'turretDefense');
    }
    for (const event of events) client.route(event);
    client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);

    const view = client.turretSession!;
    const authoritative = turretSessionFor(sim.ctx, pid)!;
    const { feedback: _ring, ...seat } = authoritative;
    expect(rounded({ ...view, feedback: [] })).toEqual(rounded({ ...seat, feedback: [] }));
    expect(view.feedback.map((f) => f.seq)).toEqual(
      events.map((e) => (e.type === 'turretDefense' ? e.seq : -1)),
    );
    expect(view.feedback.every((f) => f.seq > lastSeen)).toBe(true);
  });

  it('mirrors a Replay on the ended seat as a new seat: the old ring dropped, equal every tick', () => {
    const { sim, pid } = serverPlayer();
    const client = new WireClient(sim, pid);
    const sent: Record<string, string> = {};
    const step = () => {
      for (const event of sim.tick()) if (event.pid === pid) client.route(event);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, pid), sim.time, sim.tickCount);
      expectMirrors(client.turretSession, turretSessionFor(sim.ctx, pid));
    };
    sim.chat('/dev turret', pid);
    for (let i = 0; i < 400; i++) step();
    const before = sim.meta(pid)?.vehicle as TurretSession;
    expect(client.turretSession?.feedback.length).toBeGreaterThan(0);

    // The run ends as a breach would end it, and the card's reader has read it all.
    const defense = before.defense;
    defense.phase = 'lost';
    defense.integrity = 0;
    defense.shots = [];
    defense.result = turretResult(defense.plan, defense);
    defense.phaseEndTick = sim.tickCount;
    defense.rev++;
    step();
    const reader = new TurretFeedbackReader();
    reader.read(client.turretSession as TurretSessionView);
    expect(client.turretSession?.defense.phase).toBe('lost');
    const plan = sent.turp;

    client.useVehicleAction('turret_replay', { x: 0, z: 0 });
    const after = sim.meta(pid)?.vehicle as TurretSession;
    expect(after).not.toBe(before);
    step();
    const view = client.turretSession as TurretSessionView;
    expect(view.defense.startTick).toBe(after.defense.startTick);
    expect(view.defense.startTick).not.toBe(defense.startTick);
    expect(view.defense.phase).toBe('intro');
    expect(view.feedback).toEqual([]);
    expect(reader.read(view)).toEqual([]);
    expect(reader.newSeat).toBe(true);
    // Same scenario, same plan: the `turp` key never moves.
    expect(sent.turp).toBe(plan);

    const seqs: number[] = [];
    for (let i = 0; i < TURRET_TIMING.introTicks + 200; i++) {
      step();
      for (const entry of reader.read(client.turretSession as TurretSessionView))
        seqs.push(entry.seq);
    }
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("drops the first seat's ring when a spectator switches to another seated player", () => {
    const { sim, pid: early } = serverPlayer();
    const late = sim.addPlayer('warrior', 'Second', { characterId: 8 });
    sim.drainEvents();
    sim.chat('/dev turret', early);
    for (let i = 0; i < 400; i++) sim.tick();
    sim.chat('/dev turret', late);
    expect(sim.meta(late)?.vehicle?.kind).toBe('turret');
    const client = new WireClient(sim, late);
    let sent: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      for (const event of turretEvents(sim.tick(), late)) client.route(event);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, late), sim.time, sim.tickCount);
    }
    const lastSeen = client.turretSession!.feedback.at(-1)!.seq;

    // The spectate anchor moves to the earlier seat: its events, and every key from scratch.
    sent = {};
    const routed: number[] = [];
    for (let i = 0; i < 400 && routed.length < 4; i++) {
      for (const event of turretEvents(sim.tick(), early)) {
        client.route(event);
        routed.push(event.seq);
      }
      client.applyQuestSelfSnapshot(wirePass(sent, sim, early), sim.time, sim.tickCount);
      expect(client.turretSession!.feedback.map((f) => f.seq)).toEqual(routed);
    }
    // Its sequence runs ahead of the one left, so only the seat change can start the ring over.
    expect(routed[0]).toBeGreaterThan(lastSeen);
    const { feedback: _ring, ...seat } = turretSessionFor(sim.ctx, early)!;
    expect(rounded({ ...client.turretSession!, feedback: [] })).toEqual(
      rounded({ ...seat, feedback: [] }),
    );
  });

  it('clears the seat without a leave when a spectator switches to a player who never sat', () => {
    const { sim, pid: seated } = serverPlayer();
    const idle = sim.addPlayer('warrior', 'Idle', { characterId: 8 });
    sim.drainEvents();
    sim.chat('/dev turret', seated);
    const client = new WireClient(sim, seated);
    let sent: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      for (const event of turretEvents(sim.tick(), seated)) client.route(event);
      client.applyQuestSelfSnapshot(wirePass(sent, sim, seated), sim.time, sim.tickCount);
    }
    expect(client.turretSession).not.toBeNull();
    const leaves = vi.spyOn(client, 'leaveVehicle');

    // A fresh diff memory on a never-seated anchor: only the plan and the seat key, as nulls.
    sent = {};
    sim.tick();
    const record = wirePass(sent, sim, idle);
    expect(Object.keys(record)).toEqual(['turp', 'tur']);
    client.applyQuestSelfSnapshot(record, sim.time, sim.tickCount);
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    expect(leaves).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) {
      sim.tick();
      expect(wirePass(sent, sim, idle)).toEqual({});
    }
  });
});
