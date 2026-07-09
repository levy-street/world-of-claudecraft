import { describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import { gauntletRunForPlayer } from '../src/sim/gauntlet/runs';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// The three player-facing join modes (src/sim/gauntlet/modes.ts): the fair rolling
// queue, the always-on Practice run vs bots, and the free-roaming Spectator.

// noPlayer world with the event window open (gauntletAlwaysOpen), so joins are
// accepted. gauntletInstantLobby stays false, so a queue lobby actually waits and
// the rolling matchmaker is exercised (offline single-player uses the instant path).
const makeSim = (seed = 7, open = true) =>
  new Sim({ seed, playerClass: 'warrior', noPlayer: true, gauntletAlwaysOpen: open });

function recruiter(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter')!;
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Stand a fresh player beside the recruiter (the join geo-gate) and return its pid.
function addNear(sim: Sim, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  const r = recruiter(sim);
  teleport(sim, pid, r.pos.x, r.pos.z);
  return pid;
}

function advanceUntil(sim: Sim, pred: () => boolean, maxTicks = 20 * 60): void {
  for (let i = 0; i < maxTicks && !pred(); i++) sim.tick();
}

describe('The Gauntlet queue (fair, rolling)', () => {
  it('queues players FIFO and reports 1-based positions', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Aay');
    const b = addNear(sim, 'Bee');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([a, b]);
    expect(sim.gauntletQueuePositionOf(a)).toBe(1);
    expect(sim.gauntletQueuePositionOf(b)).toBe(2);
    // A player who is not queued reports 0.
    const c = addNear(sim, 'Cee');
    expect(sim.gauntletQueuePositionOf(c)).toBe(0);
  });

  it('the matchmaker forms one lobby from the front of the queue', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Aay');
    const b = addNear(sim, 'Bee');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    sim.tick(); // the queue matchmaker runs each tick before the run driver
    // Both seated into a single forming lobby (2 < maxRealPlayers), queue drained.
    expect(sim.gauntletQueue.length).toBe(0);
    expect(sim.gauntletRuns.length).toBe(1);
    expect(gauntletRunForPlayer(sim.ctx, a)).not.toBeNull();
    expect(gauntletRunForPlayer(sim.ctx, b)).not.toBeNull();
    expect(sim.gauntletRuns[0]!.practice).toBe(false);
  });

  it('rolls sequentially: a new queuer waits for the running game, then gets the next', () => {
    const sim = makeSim();
    const a = addNear(sim, 'First');
    sim.gauntletQueueJoin(a);
    // Advance until a's game has actually started (left the lobby phase).
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    expect(gauntletRunForPlayer(sim.ctx, a)!.phase).not.toBe('lobby');

    // b queues WHILE a's game runs: the matchmaker holds one queue game at a time.
    const b = addNear(sim, 'Second');
    sim.gauntletQueueJoin(b);
    sim.tick();
    expect(gauntletRunForPlayer(sim.ctx, b)).toBeNull(); // still waiting, not seated
    expect(sim.gauntletQueuePositionOf(b)).toBeGreaterThan(0);
    expect(sim.gauntletRuns.length).toBe(1);

    // a leaves; their run empties and times out, and the NEXT game forms for b.
    sim.gauntletLeave(a);
    advanceUntil(sim, () => gauntletRunForPlayer(sim.ctx, b) !== null, 20 * 45);
    expect(gauntletRunForPlayer(sim.ctx, b)).not.toBeNull();
    expect(sim.gauntletQueuePositionOf(b)).toBe(0); // pulled out of the queue
  });

  it('rejoin sends a finisher to the BACK of the queue (fairness)', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Runner');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    // b is already waiting in the queue behind a's live game.
    const b = addNear(sim, 'Waiter');
    sim.gauntletQueueJoin(b);
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([b]);

    // a rejoins from their run: detached, then appended AFTER b (never jumping them).
    sim.gauntletRejoin(a);
    expect(gauntletRunForPlayer(sim.ctx, a)).toBeNull();
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([b, a]);
  });
});

describe('The Gauntlet Practice (instant, solo vs bots, always available)', () => {
  it('starts instantly with a full NPC field even when the event is closed', () => {
    const sim = makeSim(7, false); // event window CLOSED
    expect(sim.gauntletOpen).toBe(false);
    const a = addNear(sim, 'Trainee');

    // The queue is gated by the event window; Practice ignores it.
    sim.gauntletQueueJoin(a);
    expect(sim.gauntletQueuePositionOf(a)).toBe(0); // rejected while closed

    sim.gauntletPractice(a);
    const run = gauntletRunForPlayer(sim.ctx, a);
    expect(run).not.toBeNull();
    expect(run!.practice).toBe(true);
    expect(run!.phase).not.toBe('lobby'); // instant start, no fill window
    // A full field: the one real player plus NPC backfill up to fieldSize.
    expect(run!.contestants.length).toBe(GAUNTLET.fieldSize);
    expect(run!.contestants.filter((c) => c.player).length).toBe(1);
  });

  it('records no ladder stats (practice never inflates runs/wins)', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Trainee');
    sim.gauntletPractice(a);
    expect(sim.gauntletRuns[0]!.practice).toBe(true);
    const meta = sim.players.get(a)!;
    expect(meta.gauntletStats.runs).toBe(0);
  });

  it('is invisible to the queue matchmaker (does not block a rolling game)', () => {
    const sim = makeSim();
    const practicer = addNear(sim, 'Solo');
    sim.gauntletPractice(practicer);
    // A separate player queues; the matchmaker must still form their game despite
    // the live practice run occupying a slot.
    const q = addNear(sim, 'Queuer');
    sim.gauntletQueueJoin(q);
    advanceUntil(sim, () => gauntletRunForPlayer(sim.ctx, q) !== null);
    expect(gauntletRunForPlayer(sim.ctx, q)).not.toBeNull();
    expect(gauntletRunForPlayer(sim.ctx, q)!.practice).toBe(false);
  });
});

describe('The Gauntlet Spectate (free-roaming observer)', () => {
  it('is in no run, watches the live board, and renders faint via the entity flag', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Contender');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');

    const s = addNear(sim, 'Watcher');
    const savedPos = { ...sim.entities.get(s)!.pos };
    sim.gauntletSpectate(s);

    // Not a contestant anywhere, but flagged + tracked as a free spectator.
    expect(gauntletRunForPlayer(sim.ctx, s)).toBeNull();
    expect(sim.entities.get(s)!.spectator).toBe(true);
    expect(sim.gauntletSpectators.has(s)).toBe(true);
    expect(sim.gauntletSpectatingOf(s)).toBe(true);

    // The self view is the watched run's board (spectating, never "you").
    const view = sim.gauntletRunWire(s);
    expect(view).not.toBeNull();
    expect(view!.spectating).toBe(true);
    expect(view!.board.length).toBeGreaterThan(0);
    expect(view!.board.some((row) => row.you)).toBe(false);

    // Leaving clears the flag and returns them to their pre-spectate spot.
    sim.gauntletLeave(s);
    expect(sim.entities.get(s)!.spectator).toBe(false);
    expect(sim.gauntletSpectators.has(s)).toBe(false);
    expect(sim.gauntletSpectatingOf(s)).toBe(false);
    const back = sim.entities.get(s)!.pos;
    expect(Math.hypot(back.x - savedPos.x, back.z - savedPos.z)).toBeLessThan(1);
  });
});
