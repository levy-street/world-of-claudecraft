// The wire half of sitting on furniture (server/game.ts): the sit_seat command reaches the
// Sim's own checks (src/sim/seating.ts) with a string seat id; any other payload is a
// malformed frame and is ignored. The command-schema suite pins the token structurally;
// this drives the real dispatch switch and asserts on the sim state that results.
import { describe, expect, it, vi } from 'vitest';

import { COMMAND_NAMES } from '../src/world_api';

// Mock the db layer so no Postgres is needed: only the dispatch hop is under test.
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
  // The branch's db surface (integration/world-quests-v0440): every export
  // server/game.ts imports, so a future arm of this file never trips
  // "No X export is defined on the mock" (the canonical shape is
  // tests/character_lease_game.test.ts).
  grantAccountMountSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveMarketState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { seatById } from '../src/sim/seat_registry';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function dispatch(server: GameServer, session: unknown, payload: Record<string, unknown>): void {
  const raw = JSON.stringify({ t: 'cmd', ...payload });
  (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
    session,
    JSON.parse(raw),
    raw,
    0,
  );
}

function joinedAt(seatId: string) {
  const server = new GameServer();
  const session = server.join(
    { readyState: 1, send: () => {} } as never,
    98,
    98,
    'Sitter',
    'warrior',
    null,
  );
  if ('error' in session) throw new Error(session.error);
  const seat = seatById(seatId);
  if (!seat) throw new Error(seatId);
  const p = server.sim.entities.get(session.pid) as Entity;
  p.pos.x = seat.standX + 0.2;
  p.pos.z = seat.standZ;
  p.pos.y = groundHeight(p.pos.x, p.pos.z, WORLD_SEED);
  return { server, session, p, seat };
}

describe('sit_seat server dispatch', () => {
  it('is a wire token', () => {
    expect(COMMAND_NAMES).toContain('sit_seat');
  });

  it('seats the player through the Sim when the seat is free and in reach', () => {
    const { server, session, p, seat } = joinedAt('tavern_chair_1');
    dispatch(server, session, { cmd: 'sit_seat', seat: seat.id });
    expect(p.sitting).toBe(true);
    expect(p.pos.x).toBe(seat.standX);
    expect(p.pos.z).toBe(seat.standZ);
    expect(p.facing).toBe(seat.facing);
  });

  it('ignores a malformed payload and leaves the checks to the Sim', () => {
    const { server, session, p } = joinedAt('tavern_chair_1');
    dispatch(server, session, { cmd: 'sit_seat', seat: 42 });
    dispatch(server, session, { cmd: 'sit_seat' });
    dispatch(server, session, { cmd: 'sit_seat', seat: 'x'.repeat(65) });
    expect(p.sitting).toBe(false);
    // a patron's seat is held: the Sim refuses it
    const held = joinedAt('tavern_barstool_1');
    dispatch(held.server, held.session, { cmd: 'sit_seat', seat: held.seat.id });
    expect(held.p.sitting).toBe(false);
  });
});
