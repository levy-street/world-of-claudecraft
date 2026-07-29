// Offline Fiesta practice-bot steering (src/sim/social/fiesta_bots.ts).
// advanceBotSteer is the pure stuck-recovery core the coliseum revamp added:
// these tests pin its whole contract (wedge detection, perpendicular detours,
// side alternation, leg escalation and its clamp, mid-leg abort, the caller
// leg cap, and the free-run reset), then drive the real bot path around a
// centre-diamond pillar and replay it for determinism.
import { describe, expect, it } from 'vitest';
import { arenaOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  advanceBotSteer,
  BOT_DETOUR_MAX_LEGS,
  BOT_DETOUR_TICKS,
  BOT_FREE_TICKS,
  BOT_STUCK_TICKS,
  type BotSteer,
  freshBotSteer,
} from '../src/sim/social/fiesta_bots';

const GOAL = 0; // steering goal heading used throughout; bends are +-PI/2 off it

// Feed one progressing tick (position advances well past BOT_STUCK_EPSILON).
function progress(st: BotSteer, i: number, cap?: number): number {
  return advanceBotSteer(st, 0, i * 0.3, GOAL, cap);
}

// Feed one wedged tick (position frozen).
function wedge(st: BotSteer, cap?: number): number {
  return advanceBotSteer(st, st.x, st.z, GOAL, cap);
}

// Drive wedged ticks until a leg starts; returns how many it took.
function wedgeUntilBent(st: BotSteer): number {
  for (let i = 1; i <= BOT_STUCK_TICKS + 1; i++) {
    if (wedge(st) !== GOAL) return i;
  }
  throw new Error('no detour started');
}

describe('fiesta bots: advanceBotSteer', () => {
  it('returns the goal heading and stays detour-free while progress is made', () => {
    const st = freshBotSteer();
    for (let i = 0; i < BOT_FREE_TICKS + 5; i++) {
      expect(progress(st, i)).toBe(GOAL);
    }
    expect(st.detour).toBe(0);
    expect(st.attempts).toBe(0);
  });

  it('starts a perpendicular detour after BOT_STUCK_TICKS wedged ticks', () => {
    const st = freshBotSteer();
    progress(st, 0); // first sample is progress by definition (NaN start)
    expect(wedgeUntilBent(st)).toBe(BOT_STUCK_TICKS);
    expect(st.sign).toBe(-1); // first leg flips the initial sign
    expect(st.detour).toBe(BOT_DETOUR_TICKS);
    // heading is goal-derived, bent a quarter turn to the chosen side
    expect(wedge(st)).toBeCloseTo(GOAL - Math.PI / 2, 10);
  });

  it('rides a full leg while it makes progress, then resumes the goal', () => {
    const st = freshBotSteer();
    progress(st, 0);
    wedgeUntilBent(st);
    let bent = 0;
    for (let i = 1; i <= BOT_DETOUR_TICKS + 5; i++) {
      if (progress(st, i) !== GOAL) bent++;
      else break;
    }
    expect(bent).toBe(BOT_DETOUR_TICKS);
    expect(st.detour).toBe(0);
  });

  it('alternates sides and escalates the leg length on consecutive wedges', () => {
    const st = freshBotSteer();
    progress(st, 0);
    wedgeUntilBent(st);
    expect(st.sign).toBe(-1);
    // ride leg 1 out with progress, then wedge again immediately
    for (let i = 1; st.detour > 0; i++) progress(st, i);
    wedgeUntilBent(st);
    expect(st.sign).toBe(1);
    expect(st.attempts).toBe(2);
    expect(st.detour).toBe(2 * BOT_DETOUR_TICKS);
  });

  it('clamps escalation at BOT_DETOUR_MAX_LEGS', () => {
    const st = freshBotSteer();
    st.attempts = BOT_DETOUR_MAX_LEGS;
    progress(st, 0);
    wedgeUntilBent(st);
    expect(st.attempts).toBe(BOT_DETOUR_MAX_LEGS);
    expect(st.detour).toBe(BOT_DETOUR_MAX_LEGS * BOT_DETOUR_TICKS);
  });

  it('aborts a leg early when the detour itself stops making progress', () => {
    const st = freshBotSteer();
    st.attempts = BOT_DETOUR_MAX_LEGS - 1; // next leg would be very long
    progress(st, 0);
    wedgeUntilBent(st);
    const legAtStart = st.detour;
    // the leg immediately wedges on a wall: it must abort within
    // BOT_STUCK_TICKS, not ride out the whole escalated length
    let aborted = -1;
    for (let i = 1; i <= BOT_STUCK_TICKS + 1; i++) {
      if (wedge(st) === GOAL) {
        aborted = i;
        break;
      }
    }
    expect(aborted).toBe(BOT_STUCK_TICKS);
    expect(st.detour).toBe(0);
    expect(legAtStart).toBeGreaterThan(BOT_STUCK_TICKS); // it really cut short
  });

  it('caps an in-flight leg to the caller maxDetourTicks (ring escape)', () => {
    const st = freshBotSteer();
    st.detour = 6 * BOT_DETOUR_TICKS; // long escalated chase leg in flight
    st.sign = 1;
    progress(st, 0, BOT_DETOUR_TICKS);
    expect(st.detour).toBeLessThanOrEqual(BOT_DETOUR_TICKS);
    // and a NEW leg started under the cap is born capped
    const st2 = freshBotSteer();
    st2.attempts = BOT_DETOUR_MAX_LEGS - 1;
    advanceBotSteer(st2, 0, 0, GOAL, BOT_DETOUR_TICKS);
    for (let i = 0; i < BOT_STUCK_TICKS; i++) wedge(st2, BOT_DETOUR_TICKS);
    expect(st2.detour).toBeLessThanOrEqual(BOT_DETOUR_TICKS);
  });

  it('resets the escalation after a sustained stretch of free pursuit', () => {
    const st = freshBotSteer();
    progress(st, 0);
    wedgeUntilBent(st);
    for (let i = 1; st.detour > 0; i++) progress(st, i);
    expect(st.attempts).toBe(1);
    for (let i = 0; i < BOT_FREE_TICKS; i++) progress(st, 100 + i);
    expect(st.attempts).toBe(0);
  });
});

// Real-path proof: a driven bot whose nearest enemy sits directly across the
// centre-diamond pillar (numerically in melee reach, no line of sight) must
// round the pillar and land hits, and the whole run must replay identically.
function runWedgedBot(): { trace: string[]; hpDropTick: number } {
  const sim = new Sim({ seed: 11, playerClass: 'warrior' });
  expect(sim.startFiestaPractice()).toBe(true);
  let match: ReturnType<typeof sim.arenaMatchFor> = null;
  for (let i = 0; i < 20 * 30 && match?.state !== 'active'; i++) {
    sim.updateFiestaBots();
    sim.tick();
    match = sim.arenaMatchFor(sim.playerId);
  }
  expect(match?.state).toBe('active');
  const o = arenaOrigin(match!.slot);
  const enemyTeam = match!.teamA.includes(sim.playerId) ? match!.teamB : match!.teamA;
  const botPid = enemyTeam.find((pid) => sim.fiestaBotPids.includes(pid))!;
  sim.fiestaBotPids = [botPid]; // drive ONLY the bot under test
  const park = (pid: number, x: number, z: number): void => {
    const e = sim.entities.get(pid)!;
    e.pos.x = o.x + x;
    e.pos.z = o.z + z;
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
    const m = sim.meta(pid);
    if (m) m.moveInput.forward = false; // undo any countdown-tick drive input
  };
  for (const pid of [...match!.teamA, ...match!.teamB]) {
    if (pid !== botPid && pid !== sim.playerId) park(pid, -16, 20);
  }
  // idle local player south of the (0,-4) diamond pillar, bot due north of it
  park(sim.playerId, 0, -7);
  park(botPid, 0, -1.2);
  const me = sim.entities.get(sim.playerId)!;
  const bot = sim.entities.get(botPid)!;
  const hp0 = me.hp;
  const trace: string[] = [];
  let hpDropTick = -1;
  for (let i = 0; i < 20 * 20; i++) {
    sim.updateFiestaBots();
    sim.tick();
    trace.push(`${bot.pos.x.toFixed(3)},${bot.pos.z.toFixed(3)}`);
    if (hpDropTick < 0 && me.hp < hp0) {
      hpDropTick = i;
      break;
    }
  }
  return { trace, hpDropTick };
}

describe('fiesta bots: cover recovery on the real drive path', () => {
  it('rounds the centre-diamond pillar and lands a hit, identically on replay', () => {
    const a = runWedgedBot();
    expect(a.hpDropTick).toBeGreaterThan(0); // it did connect
    expect(a.hpDropTick).toBeLessThan(20 * 20); // within the budget
    const b = runWedgedBot();
    expect(b.hpDropTick).toBe(a.hpDropTick);
    expect(b.trace).toEqual(a.trace);
  });
});
