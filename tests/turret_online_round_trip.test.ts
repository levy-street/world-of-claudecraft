import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire, isWorldQuestWireCommand } from '../server/quest_command_wire';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import { emitTurretSelfKeys, turretWireNumber } from '../server/turret_self_wire';
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
import { resolveTurretPlan, turretChargesLeft } from '../src/sim/minigames/turret_defense_plan';
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
// Regression guards per trial, set about 10 percent over the measured won runs (introduction about
// 7.1 KB/s, the Veterans' Test about 27.5 KB/s with its 99 monsters); all stay under the fleet's
// mean egress per account (BANDWIDTH_OPINION.md), so no trim is owed, only no silent growth.
const TUR_BYTES_PER_SECOND_BY_TRIAL: Record<string, number> = { introduction: 8_000, hard: 30_500 };
// The same guard per mission, about 10 percent over its measured won run (The Pack about
// 27.6 KB/s and The Deluge about 26.0 with their hundred-odd monsters, as high as the
// Veterans' Test; Heavy Tread 8.8, The Cracked Tower 13.4, The Powder Store 15.2).
const TUR_BYTES_PER_SECOND_BY_MISSION: Record<string, number> = {
  pack: 30_500,
  giants: 9_700,
  deluge: 28_700,
  brittle: 14_800,
  powder: 16_700,
};
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
function playOnline(command: string, aim = true, armed = false) {
  const { sim, pid } = serverPlayer();
  const client = new WireClient(sim, pid);
  const sent: Record<string, string> = {};
  const before = { ...sim.entities.get(pid)!.pos };
  sim.chat(command, pid);
  expect(sim.meta(pid)?.vehicle?.kind).toBe('turret');

  let priorTruth: TurretSessionView | null = null;
  let shots = 0;
  let slams = 0;
  let lullTried = false;
  let lullWatch = false;
  const routed = new Set<string>();
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
      if (event.type !== 'turretDefense') continue;
      fed++;
      const e = event.event;
      if (lullWatch) expect(['fired', 'shockwave']).not.toContain(e.type);
      routed.add(e.type === 'fired' && e.weapon ? `fired ${e.weapon}` : e.type);
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
    if (authoritative) {
      expect(turretChargesLeft(view.defense)).toEqual(turretChargesLeft(authoritative.defense));
      expect(view.defense.shockReadyTick).toBe(authoritative.defense.shockReadyTick);
    }
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
  expect(lullTried).toBe(armed);
  expect(identical).toBeGreaterThan(0);
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
    turBytesPerSecond: bytes.tur / (ticks / 20),
  };
}

describe('Fire and Fly online: the socket-free round trip', () => {
  it('mirrors the authoritative seat within the wire rounding every tick of a won run, then clears on leave', () => {
    const { sim, pid, client, sent, before, shots, turBytesPerSecond } = playOnline('/dev turret');
    expect(shots).toBeGreaterThan(50);
    // The whole state per revision (D31, no delta), pruned and rounded: 14.8 KB/s over this
    // run (14.5 before the limited weapons' stats and rearm tick joined the seat, 23.7 before
    // the pruning); a later lot that grows the seat's `tur` rate fails here.
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

  it("mirrors every tick of a won run that spends its limited weapons: charges, rearm and every weapon's entries", () => {
    const { sim, pid, client, slams, routed, turBytesPerSecond } = playOnline(
      '/dev turret',
      true,
      true,
    );
    const truth = turretSessionFor(sim.ctx, pid)!;
    const plan = truth.defense.plan;
    expect(truth.defense.stats.frags).toBe(plan.arsenal.fragmentation);
    expect(truth.defense.stats.shockwaves).toBe(plan.arsenal.shockwave);
    expect(slams).toBeGreaterThanOrEqual(plan.arsenal.shockwave);
    expect(client.turretSession!.defense.stats).toEqual(truth.defense.stats);
    expect(turretChargesLeft(client.turretSession!.defense)).toEqual({
      shockwave: 0,
      fragmentation: 0,
    });
    // Each weapon's entries reached the client and matched the server's ring every tick.
    for (const kind of ['fired frag', 'fragBurst', 'bomblet', 'shockwave', 'shockwaveHit'])
      expect(routed.has(kind), kind).toBe(true);
    // 14.6 KB/s over this run: the ring and the bomblets never ride `tur`, only the charges
    // spent (in the stats) and the Shockwave's rearm tick do.
    expect(turBytesPerSecond).toBeLessThan(TUR_BYTES_PER_SECOND_CEILING);
  });

  it.each(
    TURRET_SCENARIOS.filter((s) => s !== TURRET_DEFAULT_SCENARIO).map((s) => [s.boardKey, s]),
  )('mirrors every tick of a won %s run, its plan carried to the client', (key, scenario) => {
    const { client, turBytesPerSecond } = playOnline(`/dev turret ${key}`);
    expect(turBytesPerSecond).toBeLessThan(TUR_BYTES_PER_SECOND_BY_TRIAL[key]);
    const seat = client.turretSession!;
    expect(seat.defense.plan.scenarioId).toBe(scenario.id);
    expect(seat.defense.plan.integrity).toBe(scenario.integrity);
    expect(seat.waveCount).toBe(scenario.waves.length);
  });

  it.each(TURRET_MISSIONS.map((s) => [s.boardKey, s] as const))(
    'mirrors every tick of a won %s mission, its plan carried to the client',
    (key, mission) => {
      const { client, turBytesPerSecond } = playOnline(`/dev turret ${key}`);
      expect(turBytesPerSecond).toBeLessThan(TUR_BYTES_PER_SECOND_BY_MISSION[key]);
      const seat = client.turretSession!;
      expect(seat.defense.phase).toBe('won');
      expect(seat.defense.plan.scenarioId).toBe(mission.id);
      expect(seat.defense.plan.waves.map((w) => w.barrels)).toEqual(
        resolveTurretPlan(mission).waves.map((w) => w.barrels),
      );
    },
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
        stats: { kills: 20, barrelKills: 0, bowled: 0 },
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
