// The world fight departure HOLD (server/world_pvp_departure.ts,
// src/sim/pvp/world_pvp_forfeit.ts worldPvpHoldsDeparture): a deliberate
// t:'logout' within WORLD_PVP_DEPARTURE_HOLD_WINDOW of a world-hostile hit,
// taken or dealt, keeps the body in the world for the linkdead grace like a
// closed client, and while the fight window is open no other character on the
// account can log in and displace it. The forfeit (tests/world_pvp_departure
// .test.ts) still runs first: a logout inside its own window dies instead.
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
import { WORLD_PVP_ASSIST_WINDOW, WORLD_PVP_DEPARTURE_HOLD_WINDOW } from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
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

/** Two flagged level-20 strangers on contested ground. The runner (account 12)
 *  has just been hit by the chaser, then runs for `runFor` sim seconds. */
function chase(runFor: number) {
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
  for (const s of [chaser, runner]) {
    (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
    sim.setWorldPvpFlag(true, s.pid);
  }
  sim.ctx.dealDamage(
    sim.entities.get(chaser.pid)!,
    sim.entities.get(runner.pid)!,
    5,
    false,
    'physical',
    'Slam',
    'hit',
  );
  (sim as unknown as { time: number }).time += runFor;
  return { server, sim, chaser, runner };
}

const PAST_FORFEIT = WORLD_PVP_ASSIST_WINDOW + 20;

describe('a logout soon after a world fight holds the body in the world', () => {
  it('past the forfeit window but inside the hold: the body stays, alive and linkdead', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(runner.graceUntil).toBeGreaterThan(Date.now());
    const body = sim.entities.get(runner.pid)!;
    expect(body.dead).toBe(false);
    // The chaser can still finish the fight on the held body.
    expect(sim.worldPvpInfoFor(runner.pid)).toMatchObject({ deaths: 0 });
  });

  it('the one who dealt the hit is held too', () => {
    const { server, chaser } = chase(PAST_FORFEIT);
    server.handleMessage(chaser, JSON.stringify({ t: 'logout' }));
    expect(chaser.left).toBe(false);
    expect(chaser.linkdead).toBe(true);
  });

  it('closes the transport while keeping the held body in the world', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    const ws = runner.ws;
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(ws.close).toHaveBeenCalledOnce();
    expect(runner.linkdead).toBe(true);
    expect(runner.left).toBe(false);
  });

  it('ignores buffered logout frames while the body is linkdead', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    (sim as unknown as { time: number }).time += WORLD_PVP_DEPARTURE_HOLD_WINDOW;
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(server.clients.get(runner.pid)).toBe(runner);
  });

  it('inside the forfeit window the forfeit wins: the leaver dies and leaves at once', () => {
    const { server, sim, runner } = chase(1);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(runner.left).toBe(true);
    expect(sim.meta(runner.pid)!.worldPvp).toMatchObject({ deaths: 1 });
  });

  it('once the hold window has passed, a logout is a clean leave again', () => {
    const { server, runner } = chase(WORLD_PVP_DEPARTURE_HOLD_WINDOW + 1);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(runner.left).toBe(true);
    expect(runner.linkdead).toBe(false);
  });

  it('a logout with no world fight at all is a clean leave', () => {
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Calm', 'warrior', null));
    server.handleMessage(session, JSON.stringify({ t: 'logout' }));
    expect(session.left).toBe(true);
  });

  it('the page reload that follows the logout does not end the hold', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    (runner.ws as { readyState: number }).readyState = 3;
    expect(server.socketClosed(runner, runner.ws)).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(runner.left).toBe(false);
  });
});

describe('a held body cannot be pulled out by logging in another character', () => {
  it('an owner takeover holds the body and still refuses an alt', async () => {
    const { server, runner } = chase(PAST_FORFEIT);
    const oldWs = runner.ws;
    await expect(server.takeOverCharacter(12, 102)).resolves.toBe('taken-over');
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(oldWs.close).toHaveBeenCalledOnce();
    expect(oldWs.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'character taken over' }),
    );
    expect(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null)).toEqual({
      error: WORLD_FIGHT_HOLD_JOIN_ERROR,
    });
    const newWs = fakeWs();
    expect(server.join(newWs, 12, 102, 'Bet', 'shaman', null)).toBe(runner);
    expect(runner.ws).toBe(newWs);
    expect(runner.linkdead).toBe(false);
  });

  it('an alt on the same account is refused while the fight window is open', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    const alt = server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null);
    expect(alt).toEqual({ error: WORLD_FIGHT_HOLD_JOIN_ERROR });
    expect(runner.left).toBe(false);
  });

  it('the held character itself logs straight back in (a resume)', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    const back = expectJoined(server.join(fakeWs(), 12, 102, 'Bet', 'shaman', null));
    expect(back).toBe(runner);
    expect(runner.linkdead).toBe(false);
  });

  it('a closed tab mid chase is held the same way against an alt', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    (runner.ws as { readyState: number }).readyState = 3;
    expect(server.socketClosed(runner, runner.ws)).toBe(true);
    const alt = server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null);
    expect(alt).toEqual({ error: WORLD_FIGHT_HOLD_JOIN_ERROR });
  });

  it('once the fight window closes, the alt logs in and displaces the held body', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    (sim as unknown as { time: number }).time += WORLD_PVP_DEPARTURE_HOLD_WINDOW;
    expectJoined(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null));
    expect(runner.left).toBe(true);
  });
});
