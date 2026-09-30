import { describe, expect, it } from 'vitest';
import { emitTurretSelfKeys, turretWireNumber } from '../server/turret_self_wire';
import { dispatchVehicleCommand } from '../server/vehicle_command_wire';
import { type QuestWorldCommand, QuestWorldWireState } from '../src/net/quest_world_wire_state';
import {
  TURRET_DEFAULT_SCENARIO,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { BUILTIN_WORLD, dungeonAt } from '../src/sim/data';
import { type MotionSegment, positionAt } from '../src/sim/minigames/thrown_body';
import { turretResult } from '../src/sim/minigames/turret_result';
import { Sim } from '../src/sim/sim';
import type { TurretDefenseView, TurretSessionView } from '../src/sim/turret_defense_session';
import type { SimEvent, TurretSession, WorldContent } from '../src/sim/types';
import { turretClockFor, turretSessionFor } from '../src/sim/vehicles';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { TurretFeedbackReader } from '../src/ui/hud/vehicle/turret_feedback_reader_core';

const RUN_BOUND = 20 * 60 * 8;
const TUR_BYTES_PER_SECOND_CEILING = 15_000;
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
    dispatchVehicleCommand(this.sim, this.pid, JSON.parse(JSON.stringify(forged)));
  }

  route(event: SimEvent): void {
    this.applyQuestWorldEvent(JSON.parse(JSON.stringify(event)) as SimEvent);
  }
}

/** The server's per-session byte diff over the two turret keys, parsed as the client does. */
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
      if (bytes) bytes[key] = (bytes[key] ?? 0) + serialized.length;
      extra += `,"${key}":${serialized}`;
    },
    sim.meta(pid)!,
    sim.tickCount,
  );
  return JSON.parse(`{${extra.slice(1)}}`);
}

/** A value as the `tur` key carries it: the rounding the server applies, both sides alike. */
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

/**
 * A whole seat played through the wire by the online client's nearest-first aimer (or
 * left to fall with `aim` off), the client's view checked against the server's every tick.
 */
function playOnline(command: string, aim = true) {
  const { sim, pid } = serverPlayer();
  const client = new WireClient(sim, pid);
  const sent: Record<string, string> = {};
  const before = { ...sim.entities.get(pid)!.pos };
  sim.chat(command, pid);
  expect(sim.meta(pid)?.vehicle?.kind).toBe('turret');

  let priorTruth: TurretSessionView | null = null;
  let shots = 0;
  let identical = 0;
  let phase = '';
  let ticks = 0;
  const bytes: Record<string, number> = {};
  const drift = { march: 0, fly: 0, skid: 0 };
  const drawn = { march: 0, fly: 0, skid: 0 };
  const drawnSegments = new Set<string>();
  for (let i = 0; i < RUN_BOUND && phase !== 'won' && phase !== 'lost'; i++) {
    const events = sim.tick();
    ticks++;
    let fed = 0;
    for (const event of events) {
      if (event.pid !== pid) continue;
      client.route(event);
      if (event.type === 'turretDefense') fed++;
    }
    const prior = client.turretSession;
    const self = wirePass(sent, sim, pid, bytes);
    client.applyQuestSelfSnapshot(self, sim.time, sim.tickCount);

    const authoritative = turretSessionFor(sim.ctx, pid);
    expect(client.turretClock).toBe(turretClockFor(sim.ctx, pid));
    if (self.tur === undefined && self.turp === undefined && fed === 0 && prior) {
      // Nothing moved on the wire: the same object on both sides, so still equal.
      expect(client.turretSession).toBe(prior);
      expect(authoritative).toBe(priorTruth);
      identical++;
    } else {
      expectMirrors(client.turretSession, authoritative);
    }
    priorTruth = authoritative;

    const view = client.turretSession as TurretSessionView;
    for (const [index, m] of view.defense.monsters.entries()) {
      const kind = m.seg.kind;
      if (kind === 'still' || drawnSegments.has(`${m.id}:${m.seg.start}`)) continue;
      drawnSegments.add(`${m.id}:${m.seg.start}`);
      const exact = authoritative!.defense.monsters[index].seg;
      drift[kind] = Math.max(drift[kind], segmentDrift(m.seg, exact));
      drawn[kind]++;
    }
    phase = view.defense.phase;
    const clock = client.turretClock!;
    if (!aim || clock < view.defense.readyTick) continue;
    const target = nearestLive(view.defense, clock);
    if (!target) continue;
    client.useVehicleAction('turret_fire', target);
    shots++;
  }
  expect(phase).toBe(aim ? 'won' : 'lost');
  expect(identical).toBeGreaterThan(0);
  for (const kind of aim ? (['march', 'fly', 'skid'] as const) : (['march'] as const)) {
    expect(drawn[kind]).toBeGreaterThan(0);
    expect(drift[kind]).toBeLessThan(DRIFT_BOUND_YD);
  }
  return { sim, pid, client, sent, before, shots, turBytesPerSecond: bytes.tur / (ticks / 20) };
}

describe('Fire and Fly online: the socket-free round trip', () => {
  it('mirrors the authoritative seat within the wire rounding every tick of a won run, then clears on leave', () => {
    const { sim, pid, client, sent, before, shots, turBytesPerSecond } = playOnline('/dev turret');
    expect(shots).toBeGreaterThan(50);
    // The whole state per revision (D31, no delta), pruned and rounded: 13.9 KB/s over this
    // run, against 23.7 KB/s before; a later lot that grows the seat's `tur` rate fails here.
    expect(turBytesPerSecond).toBeLessThan(TUR_BYTES_PER_SECOND_CEILING);
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

  it.each(
    TURRET_SCENARIOS.filter((s) => s !== TURRET_DEFAULT_SCENARIO).map((s) => [s.boardKey, s]),
  )('mirrors every tick of a won %s run, its plan carried to the client', (key, scenario) => {
    const { client } = playOnline(`/dev turret ${key}`);
    const seat = client.turretSession!;
    expect(seat.defense.plan.scenarioId).toBe(scenario.id);
    expect(seat.defense.plan.integrity).toBe(scenario.integrity);
    expect(seat.waveCount).toBe(scenario.waves.length);
  });

  it('mirrors every tick of a lost run, its result reaching the client on the last revision', () => {
    const { sim, pid, client } = playOnline('/dev turret', false);
    const result = client.turretSession!.defense.result;
    expect(result).toMatchObject({ won: false, medal: null });
    expect(result).toEqual(turretSessionFor(sim.ctx, pid)!.defense.result);
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
});
