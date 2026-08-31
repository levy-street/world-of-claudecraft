// Regression coverage for the PR #3623 review finding: a resumed session
// (page refresh, crash, phone lock, dropped link within the linkdead grace)
// rebuilds ClientWorld with riftFloor starting null, since enter/descend/exit
// are the only ordinary riftState emit sites and none of them fire on a
// resume. That left the resumed client blind to the rift floor geometry and,
// since #3479's rift prediction, running the self-motion predictor with no
// lift/wall data until the player's next transition.
//
// Two layers: riftStateEventFor's pure sim-level behavior (src/sim/rift/runs.ts),
// then resumeSession's wiring (server/game.ts) proven through the real
// join/socketClosed/join(resume) session lifecycle.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { isRiftPos } from '../src/sim/data';
import { riftStateEventFor } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { broadcast, type FakeClient, fakeWs, joinServer } from './helpers/bare_client';

const RIFT_SEED = 4242;
const RIFT_BASE_LEVEL = 20;

function makeSoloSim(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true, autoEquip: true });
  const pid = sim.addPlayer('warrior', 'Solo');
  return { sim, pid };
}

// biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON, the harness idiom
function riftStateFramesSent(fc: FakeClient): any[] {
  return (fc.sent as any[])
    .filter((m) => m.t === 'events')
    .flatMap((f) => f.list)
    .filter((e) => e.type === 'riftState');
}

describe('riftStateEventFor (pure sim query)', () => {
  it('is null for a player who is not inside a rift', () => {
    const { sim, pid } = makeSoloSim();
    expect(riftStateEventFor(sim.ctx, pid)).toBeNull();
  });

  it('describes the live instance a player is standing inside', () => {
    const { sim, pid } = makeSoloSim();
    sim.enterRift(RIFT_SEED, RIFT_BASE_LEVEL, pid);
    expect(isRiftPos(sim.entities.get(pid)!.pos.x)).toBe(true);

    const ev = riftStateEventFor(sim.ctx, pid);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('riftState');
    expect(ev?.active).toBe(true);
    expect(ev?.pid).toBe(pid);
    expect(ev?.seed).toBe(RIFT_SEED >>> 0);
    expect(ev?.baseLevel).toBe(RIFT_BASE_LEVEL);
    expect(ev?.floorIndex).toBe(0);
  });

  it('is null once the player has left the rift', () => {
    const { sim, pid } = makeSoloSim();
    sim.enterRift(RIFT_SEED, RIFT_BASE_LEVEL, pid);
    sim.leaveRift(pid);
    expect(riftStateEventFor(sim.ctx, pid)).toBeNull();
  });
});

describe('resumeSession re-sends riftState (server/game.ts)', () => {
  it('ships an active riftState frame to a session resumed while standing inside a rift', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 91, 'Comeback');
    server.sim.enterRift(RIFT_SEED, RIFT_BASE_LEVEL, session.pid);
    expect(isRiftPos(server.sim.entities.get(session.pid)!.pos.x)).toBe(true);

    // Simulate the drop, then the resume: the same lifecycle a page refresh,
    // crash, phone lock, or dropped link within the 5-minute linkdead grace
    // drives (server/linkdead.ts planJoin's resume branch).
    server.socketClosed(session, fc.ws);
    const fc2 = fakeWs();
    const resumed = server.join(fc2.ws, 91, 91, 'Comeback', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);

    const riftStates = riftStateFramesSent(fc2);
    expect(riftStates).toHaveLength(1);
    expect(riftStates[0]).toMatchObject({
      type: 'riftState',
      active: true,
      pid: resumed.pid,
      seed: RIFT_SEED >>> 0,
      baseLevel: RIFT_BASE_LEVEL,
    });
  });

  it('sends no riftState frame resuming a session that was never in a rift', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 92, 'Overworlder');
    expect(isRiftPos(server.sim.entities.get(session.pid)!.pos.x)).toBe(false);

    server.socketClosed(session, fc.ws);
    const fc2 = fakeWs();
    const resumed = server.join(fc2.ws, 92, 92, 'Overworlder', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);

    expect(riftStateFramesSent(fc2)).toHaveLength(0);
  });

  it('the resumed session keeps mirroring rift updates after a real tick (broadcast still works)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 93, 'BackAgain');
    server.sim.enterRift(RIFT_SEED, RIFT_BASE_LEVEL, session.pid);
    server.socketClosed(session, fc.ws);
    const fc2 = fakeWs();
    const resumed = server.join(fc2.ws, 93, 93, 'BackAgain', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    fc2.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    expect(isRiftPos(server.sim.entities.get(resumed.pid)!.pos.x)).toBe(true);
    expect(fc2.sent.some((m) => m.t === 'snap')).toBe(true);
  });
});
