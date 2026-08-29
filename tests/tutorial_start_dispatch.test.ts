import { describe, expect, it, vi } from 'vitest';

import { COMMAND_NAMES } from '../src/world_api';

// Mock the db layer so no Postgres is needed: only the command-dispatch hop is
// under test here (the tab_target_server_dispatch mock shape).
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
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { GameServer } from '../server/game';
import { isOnProvingShore } from '../src/sim/content/proving_shore';
import type { Entity } from '../src/sim/types';

// The server half of the tutorial ferry (PR #3467 review, finding 11): the
// command_schema suite pins that a 'tutorial_start' case EXISTS, which cannot
// tell `sim.startTutorial(pid)` apart from a copy-paste that forgets the pid
// and sails the primary player. This drives the real dispatch switch with TWO
// sessions and asserts the sender, and only the sender, lands on the island.

function dispatch(server: GameServer, session: unknown, cmd: string): void {
  const raw = JSON.stringify({ t: 'cmd', cmd });
  (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
    session,
    JSON.parse(raw),
    raw,
    0,
  );
}

describe('tutorial_start server dispatch', () => {
  it('sails the dispatching session, and only that session, to the island', () => {
    const server = new GameServer();
    const a = server.join(
      { readyState: 1, send: () => {} } as never,
      97,
      97,
      'Alpha',
      'warrior',
      null,
    );
    if ('error' in a) throw new Error(a.error);
    const b = server.join(
      { readyState: 1, send: () => {} } as never,
      98,
      98,
      'Bravo',
      'mage',
      null,
    );
    if ('error' in b) throw new Error(b.error);
    const sim = server.sim;
    const pa = sim.entities.get(a.pid) as Entity;
    const pb = sim.entities.get(b.pid) as Entity;
    expect(isOnProvingShore(pa.pos.x, pa.pos.z)).toBe(false);
    expect(isOnProvingShore(pb.pos.x, pb.pos.z)).toBe(false);

    expect(COMMAND_NAMES).toContain('tutorial_start');
    dispatch(server, b, 'tutorial_start');

    // The sender crossed; the bystander did not move an inch.
    expect(isOnProvingShore(pb.pos.x, pb.pos.z)).toBe(true);
    expect(isOnProvingShore(pa.pos.x, pa.pos.z)).toBe(false);
  });
});
