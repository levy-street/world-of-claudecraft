// The server half of the World PvP forfeit (server/world_pvp_departure.ts):
// every departure the player controls, or cannot be told apart from one, runs
// the sim's forfeit hook BEFORE the departure's save. Drives the real
// GameServer session lifecycle: a dropped socket (a closed client or a lost
// connection), a deliberate t:'logout', and a takeover from another login.
// The rule itself is pinned in tests/world_pvp_forfeit.test.ts.
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
import { WORLD_PVP_KILL_HONOR } from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import { groundHeight } from '../src/sim/world';

const CONTESTED = { x: 60, z: 700 }; // Thornpeak Heights: the mutual-flag rule

function fakeWs() {
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
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

/** Two flagged level-20 strangers on contested ground, the leaver just hit. */
function midFight() {
  const server = new GameServer();
  const sim = server.sim;
  const winnerWs = fakeWs();
  const leaverWs = fakeWs();
  const winner = expectJoined(server.join(winnerWs, 11, 101, 'Aleph', 'warrior', null));
  const leaver = expectJoined(server.join(leaverWs, 12, 102, 'Bet', 'warrior', null));
  [winner, leaver].forEach((s, i) => {
    sim.setPlayerLevel(20, s.pid);
    const e = sim.entities.get(s.pid)!;
    e.hp = e.maxHp;
    const x = CONTESTED.x + 2 * i;
    e.pos = { x, y: groundHeight(x, CONTESTED.z, sim.cfg.seed), z: CONTESTED.z };
    e.prevPos = { ...e.pos };
  });
  for (const s of [winner, leaver]) {
    (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
    sim.setWorldPvpFlag(true, s.pid);
  }
  const w = sim.entities.get(winner.pid)!;
  const l = sim.entities.get(leaver.pid)!;
  sim.ctx.dealDamage(w, l, 5, false, 'physical', 'Slam', 'hit');
  return { server, sim, winner, leaver, leaverWs };
}

describe('a departure mid world fight forfeits it on the server', () => {
  it('a dropped socket: the linkdead body dies to the opponent before the grace begins', () => {
    const { server, sim, winner, leaver, leaverWs } = midFight();
    leaverWs.readyState = 3;
    expect(server.socketClosed(leaver, leaverWs)).toBe(true);
    expect(leaver.linkdead).toBe(true);
    expect(sim.entities.get(leaver.pid)!.dead).toBe(true);
    expect(sim.meta(winner.pid)!.honor).toBe(WORLD_PVP_KILL_HONOR);
    expect(sim.worldPvpInfoFor(winner.pid)).toMatchObject({ kills: 1 });
    expect(sim.worldPvpInfoFor(leaver.pid)).toMatchObject({ deaths: 1 });
  });

  it("a deliberate t:'logout': the forfeit resolves before the leave", () => {
    const { server, sim, winner, leaver } = midFight();
    const leaverMeta = sim.meta(leaver.pid)!;
    server.handleMessage(leaver, JSON.stringify({ t: 'logout' }));
    expect(leaver.left).toBe(true);
    expect(leaverMeta.worldPvp).toMatchObject({ deaths: 1 });
    expect(sim.meta(winner.pid)!.honor).toBe(WORLD_PVP_KILL_HONOR);
    expect(sim.worldPvpInfoFor(winner.pid)).toMatchObject({ kills: 1 });
  });

  it('a takeover from another login forfeits the fight of the session it displaces', async () => {
    const { server, sim, winner, leaver } = midFight();
    const leaverEntity = sim.entities.get(leaver.pid)!;
    await expect(server.takeOverCharacter(12, 102)).resolves.toBe('taken-over');
    expect(leaverEntity.dead).toBe(true);
    expect(sim.meta(winner.pid)!.honor).toBe(WORLD_PVP_KILL_HONOR);
  });

  it('a departure outside any fight changes nothing', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Calm', 'warrior', null));
    ws.readyState = 3;
    expect(server.socketClosed(session, ws)).toBe(true);
    expect(server.sim.entities.get(session.pid)!.dead).toBe(false);
    expect(server.sim.worldPvpInfoFor(session.pid)).toMatchObject({ deaths: 0 });
  });
});
