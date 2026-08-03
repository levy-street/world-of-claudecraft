// Regression for issue #2426 (bug 3 of the rogue bug bundle): a stunned target
// could still turn to face away from a positional attack (Backstab's requiresBehind),
// defeating the whole point of the stun. src/sim/player_motion.ts already blocks
// turnLeft/turnRight while stunned (offline keyboard-turn control), but mouselook
// facing streams to the AUTHORITATIVE server on its own out-of-band `input.facing`
// wire field and was applied unconditionally (server/game.ts). This drives the real
// GameServer.handleMessage entry point end to end, mirroring the tests/CLAUDE.md
// "Server tests" recipe (mocked db, new GameServer(), a fake socket).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { describe, expect, it, vi } from 'vitest';
import { GameServer } from '../server/game';
import type { Aura } from '../src/sim/types';

function joinSession(server: any, id: number, name: string) {
  const ws = { readyState: 1, send: () => {} };
  const session = server.join(ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  return session;
}

function sendFacing(server: any, session: any, seq: number, facing: number): void {
  server.handleMessage(session, JSON.stringify({ t: 'input', seq, mi: {}, facing }));
}

function stunAura(sourceId: number): Aura {
  return {
    id: 'test_stun',
    name: 'Test Stun',
    kind: 'stun',
    remaining: 5,
    duration: 5,
    value: 0,
    sourceId,
    school: 'physical',
  };
}

describe('stunned facing lock (issue #2426)', () => {
  it('rejects a mouselook facing update from the client while the entity is stunned', () => {
    const server: any = new GameServer();
    const session = joinSession(server, 1, 'Aleph');
    const e = server.sim.entities.get(session.pid);
    const startFacing = e.facing;

    e.auras.push(stunAura(e.id));
    sendFacing(server, session, 1, startFacing + 1.5);

    expect(e.facing).toBe(startFacing); // the stun held the heading in place
  });

  it('applies the facing update again once the stun has worn off', () => {
    const server: any = new GameServer();
    const session = joinSession(server, 2, 'Bet');
    const e = server.sim.entities.get(session.pid);
    const startFacing = e.facing;

    e.auras.push(stunAura(e.id));
    sendFacing(server, session, 1, startFacing + 1.5);
    expect(e.facing).toBe(startFacing);

    e.auras.length = 0; // the stun expires
    sendFacing(server, session, 2, startFacing + 1.5);
    expect(e.facing).toBeCloseTo(startFacing + 1.5, 5);
  });

  it('still lets a released spirit (ghost) turn with the camera, stun predicate unaffected', () => {
    const server: any = new GameServer();
    const session = joinSession(server, 3, 'Ghost');
    const e = server.sim.entities.get(session.pid);
    e.dead = true;
    e.ghost = true;
    const target = e.facing + 1.2;

    sendFacing(server, session, 1, target);

    expect(e.facing).toBeCloseTo(target, 5);
  });
});
