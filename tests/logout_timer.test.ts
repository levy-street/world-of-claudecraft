// The Log Out button's countdown (server/logout_timer.ts, and the length rule
// in src/sim/logout_delay.ts): instant when the player is safe and unflagged,
// 10 seconds in combat, 15 with the PvP flag on, 30 with the flag on and a
// recent world fight. Damage taken during the wait cancels it, and so does the
// Cancel button; getting into worse trouble stretches it. Drives the real
// GameServer message path. Every OTHER way out of the game keeps the linkdead
// grace and the world fight hold (tests/world_pvp_logout_hold.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import { WORLD_FIGHT_HOLD_JOIN_ERROR } from '../server/linkdead';
import {
  LOGOUT_COMBAT_SECONDS,
  LOGOUT_PVP_COMBAT_SECONDS,
  LOGOUT_PVP_FLAGGED_SECONDS,
  logoutDelaySeconds,
} from '../src/sim/logout_delay';
import { WORLD_PVP_DEPARTURE_HOLD_WINDOW } from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import type { Sim } from '../src/sim/sim';
import type { LogoutEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const CONTESTED = { x: 60, z: 700 }; // Thornpeak Heights: the mutual-flag rule

function fakeWs() {
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => {
      ws.readyState = 2;
    }),
    ping: vi.fn(),
    terminate: vi.fn(() => {
      ws.readyState = 3;
    }),
  };
  return ws;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

function advance(sim: Sim, seconds: number): void {
  (sim as unknown as { time: number }).time += seconds;
}

/** Every logout event the server sent this session, in order. */
function logoutEvents(session: ClientSession): LogoutEvent[] {
  const out: LogoutEvent[] = [];
  for (const [raw] of vi.mocked(session.ws.send).mock.calls) {
    const frame = JSON.parse(String(raw)) as { t?: string; list?: Array<{ type: string }> };
    if (frame.t !== 'events') continue;
    for (const ev of frame.list ?? []) if (ev.type === 'logout') out.push(ev as LogoutEvent);
  }
  return out;
}

const logout = (server: GameServer, session: ClientSession): void =>
  server.handleMessage(session, JSON.stringify({ t: 'logout' }));

const hit = (sim: Sim, from: ClientSession, to: ClientSession): void =>
  void sim.ctx.dealDamage(
    sim.entities.get(from.pid)!,
    sim.entities.get(to.pid)!,
    5,
    false,
    'physical',
    'Slam',
    'hit',
  );

/** One level-20 player standing somewhere quiet, PvP flag off. */
function alone() {
  const server = new GameServer();
  const sim = server.sim;
  const session = expectJoined(server.join(fakeWs(), 11, 101, 'Aleph', 'warrior', null));
  sim.setPlayerLevel(20, session.pid);
  return { server, sim, session, body: sim.entities.get(session.pid)! };
}

/** Two level-20 strangers side by side on contested ground. `flagged` turns
 *  the PvP flag on for both; `fought` has the chaser hit the runner. */
function pair(opts: { flagged: boolean; fought: boolean }) {
  const server = new GameServer();
  const sim = server.sim;
  const chaser = expectJoined(server.join(fakeWs(), 11, 101, 'Aleph', 'warrior', null));
  const runner = expectJoined(server.join(fakeWs(), 12, 102, 'Bet', 'shaman', null));
  [chaser, runner].forEach((s, i) => {
    sim.setPlayerLevel(20, s.pid);
    const e = sim.entities.get(s.pid)!;
    e.hp = e.maxHp;
    const x = CONTESTED.x + 2 * i;
    e.pos = { x, y: groundHeight(x, CONTESTED.z, sim.cfg.seed), z: CONTESTED.z };
    e.prevPos = { ...e.pos };
  });
  if (opts.flagged) {
    for (const s of [chaser, runner]) {
      advance(sim, WORLD_PVP_TOGGLE_COOLDOWN + 1);
      sim.setWorldPvpFlag(true, s.pid);
    }
  }
  if (opts.fought) hit(sim, chaser, runner);
  return { server, sim, chaser, runner };
}

describe('how long the Log Out button waits', () => {
  it('safe and unflagged: no wait at all', () => {
    const { sim, session } = alone();
    expect(logoutDelaySeconds(sim.ctx, session.pid)).toBe(0);
  });

  it('in combat with the flag off: the combat wait', () => {
    const { sim, session, body } = alone();
    body.inCombat = true;
    expect(logoutDelaySeconds(sim.ctx, session.pid)).toBe(LOGOUT_COMBAT_SECONDS);
    expect(LOGOUT_COMBAT_SECONDS).toBe(10);
  });

  it('flag on, no fight: the flagged wait, in or out of combat', () => {
    const { sim, runner } = pair({ flagged: true, fought: false });
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_PVP_FLAGGED_SECONDS);
    sim.entities.get(runner.pid)!.inCombat = true;
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_PVP_FLAGGED_SECONDS);
    expect(LOGOUT_PVP_FLAGGED_SECONDS).toBe(15);
  });

  it('flag on and a recent world fight: the longest wait, for both fighters', () => {
    const { sim, chaser, runner } = pair({ flagged: true, fought: true });
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_PVP_COMBAT_SECONDS);
    expect(logoutDelaySeconds(sim.ctx, chaser.pid)).toBe(LOGOUT_PVP_COMBAT_SECONDS);
    expect(LOGOUT_PVP_COMBAT_SECONDS).toBe(30);
  });

  it('the fight stays recent for the whole departure hold window, then drops to the flagged wait', () => {
    const { sim, runner } = pair({ flagged: true, fought: true });
    advance(sim, WORLD_PVP_DEPARTURE_HOLD_WINDOW);
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_PVP_COMBAT_SECONDS);
    advance(sim, 1);
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_PVP_FLAGGED_SECONDS);
  });

  it('a recent world fight with the flag off counts as combat, never as safe', () => {
    const { sim, runner } = pair({ flagged: false, fought: false });
    sim.ctx.worldPvpBooks.lastFightAt.set(runner.pid, sim.ctx.time);
    expect(sim.entities.get(runner.pid)!.inCombat).toBe(false);
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(LOGOUT_COMBAT_SECONDS);
  });

  it('a corpse or a ghost leaves at once, flagged or not', () => {
    const { sim, runner } = pair({ flagged: true, fought: true });
    const body = sim.entities.get(runner.pid)!;
    body.dead = true;
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(0);
    body.dead = false;
    body.ghost = true;
    expect(logoutDelaySeconds(sim.ctx, runner.pid)).toBe(0);
  });
});

describe('the Log Out button on the server', () => {
  it('safe and unflagged: leaves on the spot and tells the client it is done', () => {
    const { server, session } = alone();
    logout(server, session);
    expect(session.left).toBe(true);
    expect(session.linkdead).toBe(false);
    expect(logoutEvents(session)).toEqual([{ type: 'logout', phase: 'completed' }]);
  });

  it('in combat: starts a 10 second countdown and stays in the world until it ends', () => {
    const { server, sim, session, body } = alone();
    body.inCombat = true;
    logout(server, session);
    expect(session.left).toBe(false);
    expect(server.logouts.isPending(session)).toBe(true);
    expect(logoutEvents(session)).toEqual([{ type: 'logout', phase: 'started', seconds: 10 }]);

    // The client keeps no clock: it is told each second once, as it passes.
    advance(sim, 1);
    server.logouts.tick(sim);
    server.logouts.tick(sim);
    advance(sim, 2.5);
    server.logouts.tick(sim);
    expect(logoutEvents(session).slice(1)).toEqual([
      { type: 'logout', phase: 'countdown', seconds: 9 },
      { type: 'logout', phase: 'countdown', seconds: 7 },
    ]);

    advance(sim, LOGOUT_COMBAT_SECONDS - 4);
    server.logouts.tick(sim);
    expect(session.left).toBe(false);

    advance(sim, 0.5);
    server.logouts.tick(sim);
    expect(session.left).toBe(true);
    expect(session.linkdead).toBe(false);
    expect(server.logouts.isPending(session)).toBe(false);
    expect(logoutEvents(session).at(-1)).toEqual({ type: 'logout', phase: 'completed' });
  });

  it('taking damage interrupts the countdown, and it does not come back by itself', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: false });
    logout(server, runner);
    expect(logoutEvents(runner)).toEqual([{ type: 'logout', phase: 'started', seconds: 15 }]);

    advance(sim, 5);
    hit(sim, chaser, runner);
    server.logouts.tick(sim);
    expect(server.logouts.isPending(runner)).toBe(false);
    expect(logoutEvents(runner).at(-1)).toEqual({
      type: 'logout',
      phase: 'cancelled',
      reason: 'damaged',
    });

    advance(sim, 120);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(false);
  });

  it('pressing Log Out again after an interruption waits the longer, fresher delay', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: false });
    logout(server, runner);
    hit(sim, chaser, runner);
    server.logouts.tick(sim);
    logout(server, runner);
    expect(logoutEvents(runner).at(-1)).toEqual({ type: 'logout', phase: 'started', seconds: 30 });
  });

  it('getting into worse trouble mid countdown stretches the wait, measured from the press', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: false });
    logout(server, chaser); // flagged, no fight: 15 seconds
    advance(sim, 5);
    hit(sim, chaser, runner); // now a recent world fight: 30 seconds are owed
    server.logouts.tick(sim);
    expect(logoutEvents(chaser).at(-1)).toEqual({ type: 'logout', phase: 'started', seconds: 25 });

    advance(sim, 10); // the original 15 seconds are up
    server.logouts.tick(sim);
    expect(chaser.left).toBe(false);
    // Asked once per change, not once per tick.
    expect(logoutEvents(chaser).filter((ev) => ev.phase === 'started')).toHaveLength(2);
  });

  it('the wait never shrinks: leaving combat mid countdown does not end it early', () => {
    const { server, sim, session, body } = alone();
    body.inCombat = true;
    logout(server, session);
    advance(sim, 3);
    body.inCombat = false;
    server.logouts.tick(sim);
    expect(session.left).toBe(false);
    expect(logoutEvents(session).filter((ev) => ev.phase === 'started')).toHaveLength(1);
  });

  it('the world loop itself runs the countdown', () => {
    // Every other test here ticks the timers by hand; this pins the one call
    // in server/game.ts that makes a countdown ever end in production.
    const src = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    expect(src.match(/this\.logouts\.tick\(this\.sim\);/g)).toHaveLength(1);
    expect(src).toMatch(/this\.expireLinkdeadSessions\(\);\s*this\.logouts\.tick\(this\.sim\);/);
  });

  it('dealing damage does not interrupt the countdown', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: false });
    logout(server, chaser);
    hit(sim, chaser, runner);
    server.logouts.tick(sim);
    expect(server.logouts.isPending(chaser)).toBe(true);
  });

  it('the Cancel button stops the countdown', () => {
    const { server, sim, session, body } = alone();
    body.inCombat = true;
    logout(server, session);
    server.handleMessage(session, JSON.stringify({ t: 'logout', cancel: true }));
    expect(server.logouts.isPending(session)).toBe(false);
    expect(logoutEvents(session).at(-1)).toEqual({
      type: 'logout',
      phase: 'cancelled',
      reason: 'cancelled',
    });
    advance(sim, 60);
    server.logouts.tick(sim);
    expect(session.left).toBe(false);
  });

  it('cancel frames draw from the command lane, so a start/cancel loop cannot outrun it', () => {
    const { server, session, body } = alone();
    body.inCombat = true;
    // Far more start/cancel pairs than the lane's burst, all in one instant.
    for (let i = 0; i < 500 && !session.left; i++) {
      logout(server, session);
      server.handleMessage(session, JSON.stringify({ t: 'logout', cancel: true }));
    }
    const cancels = logoutEvents(session).filter((ev) => ev.phase === 'cancelled').length;
    expect(cancels).toBeGreaterThan(0);
    expect(cancels).toBeLessThan(200);
    // Once the lane is dry a cancel is shed: the countdown it aimed at survives
    // (or the flood got the session kicked, which is the same bound).
    expect(session.left || server.logouts.isPending(session)).toBe(true);
  });

  it('a cancel with no countdown running does nothing', () => {
    const { server, session } = alone();
    server.handleMessage(session, JSON.stringify({ t: 'logout', cancel: true }));
    expect(session.left).toBe(false);
    expect(logoutEvents(session)).toEqual([]);
  });

  it('repeated Log Out frames neither restart nor shorten a running countdown', () => {
    const { server, sim, session, body } = alone();
    body.inCombat = true;
    logout(server, session);
    advance(sim, 6);
    body.inCombat = false; // safe now: a FRESH request would be instant
    logout(server, session);
    logout(server, session);
    expect(session.left).toBe(false);
    expect(logoutEvents(session).filter((ev) => ev.phase === 'started')).toHaveLength(1);
    advance(sim, 4);
    server.logouts.tick(sim);
    expect(session.left).toBe(true);
  });
});

describe('the Log Out button after a world fight', () => {
  it('waits 30 seconds, then leaves cleanly: no linkdead hold, and an alt can log in', () => {
    const { server, sim, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30); // past the forfeit window, well inside the hold window
    logout(server, runner);
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(false);
    expect(runner.ws.close).not.toHaveBeenCalled();
    expect(logoutEvents(runner)).toEqual([{ type: 'logout', phase: 'started', seconds: 30 }]);

    advance(sim, LOGOUT_PVP_COMBAT_SECONDS);
    server.logouts.tick(sim);
    expect(runner.left).toBe(true);
    expect(runner.linkdead).toBe(false);
    expect(sim.entities.get(runner.pid)?.dead).toBe(false); // nothing was forfeited
    // The page reload that follows is no second departure.
    expect(server.socketClosed(runner, runner.ws)).toBe(false);
    expectJoined(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null));
  });

  it('the chaser landing a hit during the wait keeps the runner in the world', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30);
    logout(server, runner);
    advance(sim, 29);
    hit(sim, chaser, runner);
    advance(sim, 1);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(logoutEvents(runner).at(-1)).toMatchObject({ phase: 'cancelled', reason: 'damaged' });
  });

  it('pressing Log Out and then closing the client: the body waits out the countdown, then leaves', () => {
    // Also what a client from before the countdown does: frame, then reload.
    const { server, sim, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30);
    logout(server, runner);
    (runner.ws as { readyState: number }).readyState = 3;
    expect(server.socketClosed(runner, runner.ws)).toBe(true);
    expect(runner.linkdead).toBe(true);

    // Held in the world, alts refused, for as long as the wait runs.
    advance(sim, LOGOUT_PVP_COMBAT_SECONDS - 1);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null)).toEqual({
      error: WORLD_FIGHT_HOLD_JOIN_ERROR,
    });

    advance(sim, 1);
    server.logouts.tick(sim);
    expect(runner.left).toBe(true);
  });

  it('a hit on that waiting body cancels the logout: it is an ordinary held body again', () => {
    const { server, sim, chaser, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30);
    logout(server, runner);
    (runner.ws as { readyState: number }).readyState = 3;
    server.socketClosed(runner, runner.ws);
    advance(sim, 5);
    hit(sim, chaser, runner);
    server.logouts.tick(sim);
    expect(server.logouts.isPending(runner)).toBe(false);

    advance(sim, LOGOUT_PVP_COMBAT_SECONDS);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null)).toEqual({
      error: WORLD_FIGHT_HOLD_JOIN_ERROR,
    });
  });

  it('a takeover mid countdown is not the button: the body is held and no logout completes', async () => {
    const { server, sim, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30);
    logout(server, runner);
    await expect(server.takeOverCharacter(12, 102)).resolves.toBe('taken-over');
    expect(runner.linkdead).toBe(true);
    // The owner comes straight back on a new socket: the countdown is over.
    expect(expectJoined(server.join(fakeWs(), 12, 102, 'Bet', 'shaman', null))).toBe(runner);
    advance(sim, LOGOUT_PVP_COMBAT_SECONDS);
    server.logouts.tick(sim);
    expect(server.logouts.isPending(runner)).toBe(false);
    expect(runner.left).toBe(false);
  });

  it('a session kicked mid countdown gets no second leave and no completed event', async () => {
    const { server, sim, session, body } = alone();
    body.inCombat = true;
    logout(server, session);
    await server.leave(session, 'kick');
    advance(sim, LOGOUT_COMBAT_SECONDS);
    server.logouts.tick(sim);
    expect(server.logouts.isPending(session)).toBe(false);
    expect(logoutEvents(session).some((ev) => ev.phase === 'completed')).toBe(false);
  });

  it('a Log Out frame for a session that is already linkdead starts nothing', () => {
    const { server, session, body } = alone();
    body.inCombat = true;
    (session.ws as { readyState: number }).readyState = 3;
    server.socketClosed(session, session.ws);
    logout(server, session);
    expect(server.logouts.isPending(session)).toBe(false);
    expect(session.left).toBe(false);
  });

  it('a countdown does not carry over to the socket a dropped session resumes on', () => {
    const { server, sim, runner } = pair({ flagged: true, fought: true });
    advance(sim, 30);
    logout(server, runner);
    (runner.ws as { readyState: number }).readyState = 3;
    server.socketClosed(runner, runner.ws);
    // Back before the world loop ever looked at the abandoned countdown.
    expect(expectJoined(server.join(fakeWs(), 12, 102, 'Bet', 'shaman', null))).toBe(runner);
    advance(sim, LOGOUT_PVP_COMBAT_SECONDS);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(server.logouts.isPending(runner)).toBe(false);
  });
});
