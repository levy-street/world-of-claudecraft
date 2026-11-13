// The world fight departure HOLD (server/world_pvp_departure.ts,
// src/sim/pvp/world_pvp_forfeit.ts worldPvpHoldsDeparture): a player who gets
// out of the game WITHOUT the Log Out button (a closed client, a dropped
// connection, a takeover from another login) within
// WORLD_PVP_DEPARTURE_HOLD_WINDOW of a world-hostile hit, taken or dealt, has
// their body kept in the world for the linkdead grace, and while the fight
// window is open no other character on the account can log in and displace it.
// The forfeit (tests/world_pvp_departure.test.ts) still runs first: leaving
// inside its own window dies instead. The Log Out button is a different road
// out: it waits a countdown and then leaves cleanly, with no hold
// (server/logout_timer.ts, tests/logout_timer.test.ts).
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

/** Leave the game without the Log Out button: the client is simply gone. */
function closeClient(server: GameServer, session: ClientSession): boolean {
  (session.ws as { readyState: number }).readyState = 3;
  return server.socketClosed(session, session.ws);
}

describe('leaving without the Log Out button soon after a world fight holds the body', () => {
  it('past the forfeit window but inside the hold: the body stays, alive and linkdead', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    expect(closeClient(server, runner)).toBe(true);
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
    expect(closeClient(server, chaser)).toBe(true);
    expect(chaser.left).toBe(false);
    expect(server.join(fakeWs(), 11, 104, 'Dalet', 'warrior', null)).toEqual({
      error: WORLD_FIGHT_HOLD_JOIN_ERROR,
    });
  });

  it('ignores a logout frame for a body that is already linkdead', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    closeClient(server, runner);
    (sim as unknown as { time: number }).time += WORLD_PVP_DEPARTURE_HOLD_WINDOW;
    server.handleMessage(runner, JSON.stringify({ t: 'logout' }));
    expect(server.logouts.isPending(runner)).toBe(false);
    server.logouts.tick(sim);
    expect(runner.left).toBe(false);
    expect(runner.linkdead).toBe(true);
    expect(server.clients.get(runner.pid)).toBe(runner);
  });

  it('inside the forfeit window the forfeit wins: the leaver dies, and a corpse holds nothing', () => {
    const { server, sim, runner } = chase(1);
    closeClient(server, runner);
    expect(sim.entities.get(runner.pid)!.dead).toBe(true);
    expect(sim.meta(runner.pid)!.worldPvp).toMatchObject({ deaths: 1 });
    expectJoined(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null));
    expect(runner.left).toBe(true);
  });

  it('a closed client with no world fight at all is not held against an alt', () => {
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Calm', 'warrior', null));
    closeClient(server, session);
    expectJoined(server.join(fakeWs(), 11, 104, 'Dalet', 'warrior', null));
    expect(session.left).toBe(true);
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
    closeClient(server, runner);
    const alt = server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null);
    expect(alt).toEqual({ error: WORLD_FIGHT_HOLD_JOIN_ERROR });
    expect(runner.left).toBe(false);
  });

  it('the held character itself logs straight back in (a resume)', () => {
    const { server, runner } = chase(PAST_FORFEIT);
    closeClient(server, runner);
    const back = expectJoined(server.join(fakeWs(), 12, 102, 'Bet', 'shaman', null));
    expect(back).toBe(runner);
    expect(runner.linkdead).toBe(false);
  });

  it('once the fight window closes, the alt logs in and displaces the held body', () => {
    const { server, sim, runner } = chase(PAST_FORFEIT);
    closeClient(server, runner);
    (sim as unknown as { time: number }).time += WORLD_PVP_DEPARTURE_HOLD_WINDOW;
    expectJoined(server.join(fakeWs(), 12, 103, 'Gimel', 'warrior', null));
    expect(runner.left).toBe(true);
  });
});
