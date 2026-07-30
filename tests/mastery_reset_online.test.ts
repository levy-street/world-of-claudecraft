// THE ONE-TIME MASTERY RESET, ONLINE: the offline
// suite (tests/professions_mastery_reset.test.ts) pins the reset through
// Sim.addPlayer directly; this suite pins the AUTHORITATIVE SERVER arm, the
// same blob arriving through GameServer.join, so the one funnel claim (the
// reset fires identically on every host) is held by a live server test and
// not only by code reading. Postgres is mocked (the deeds_reconcile.test.ts
// boilerplate): GameServer runs with no live DB.
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/deeds_db', () => ({
  insertCharacterDeed: vi.fn(async () => {}),
  insertCharacterDeeds: vi.fn(async () => {}),
  getDeedBroadcasts: vi.fn(async () => true),
}));

vi.mock('../server/steam/mirror', () => ({
  onDeedRecorded: vi.fn(),
  reconcileOnLogin: vi.fn(),
}));

import { GameServer } from '../server/game';
import { MASTERY_RESET_LETTER_ID } from '../src/sim/professions/mastery_reset';

function fakeWs() {
  const fc = {
    sent: [] as unknown[],
    ws: { readyState: 1, send: (p: string) => fc.sent.push(JSON.parse(p)) },
  };
  return fc;
}

// A pre-curve online save: no masteryResetApplied flag, nonzero values in
// both maps (plus the legacy professions mirror), mailWelcomed so the only
// letter in flight is the reset notice.
function preCurveState() {
  return {
    level: 10,
    xp: 100,
    lifetimeXp: 100,
    copper: 500,
    hp: 100,
    resource: 0,
    pos: { x: 2, z: -2 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    questsDone: [],
    craftSkills: { armorcrafting: 80, cooking: 30 },
    gatheringProficiency: { mining: 90 },
    professions: { mining: 90 },
    mailWelcomed: true,
    deeds: {
      prog_first_craft: '2026-01-01',
      prog_first_harvest: '2026-01-01',
      exp_first_ore: '2026-01-01',
      prog_craft_specialist: '2026-01-01',
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the one-time mastery reset through GameServer.join', () => {
  it('zeroes both maps at join, books the notice exactly once, serializes the flag', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(
      fc.ws as never,
      7,
      42,
      'Online',
      'warrior',
      preCurveState() as never,
    );
    if ('error' in session) throw new Error(session.error);
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('missing meta');
    // The shared load funnel applied the reset on the server host.
    expect(meta.craftSkills.armorcrafting).toBe(0);
    expect(meta.craftSkills.cooking).toBe(0);
    expect(meta.gatheringProficiency.mining).toBe(0);
    // The authoritative tick books the authored notice exactly once.
    server.sim.tick();
    expect(server.sim.mailUnreadFor(session.pid)).toBe(1);
    for (let i = 0; i < 40; i++) server.sim.tick();
    expect(server.sim.mailUnreadFor(session.pid)).toBe(1);
    const box = server.sim.entities.get(server.sim.postOffice.mailboxIds[0]);
    const p = server.sim.entities.get(session.pid);
    if (!box || !p) throw new Error('missing mailbox or player');
    p.pos = { ...box.pos };
    p.prevPos = { ...p.pos };
    server.sim.rebucket(p);
    const info = server.sim.mailInfoFor(session.pid);
    const notices = info?.messages.filter((m) => m.letterId === MASTERY_RESET_LETTER_ID) ?? [];
    expect(notices).toHaveLength(1);
    // What the server would persist carries the one-shot flag as literal true.
    const blob = server.sim.serializeCharacter(session.pid);
    if (!blob) throw new Error('serializeCharacter returned null');
    expect(blob.masteryResetApplied).toBe(true);
    // The legacy mirror serializes zeroed too: no resurrection path.
    // biome-ignore lint/suspicious/noExplicitAny: the legacy dual-write mirror
    expect((blob as any).professions.mining).toBe(0);
  });

  it('a server restart + relog with the persisted blob never re-fires the reset', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(
      fc.ws as never,
      7,
      42,
      'Online',
      'warrior',
      preCurveState() as never,
    );
    if ('error' in session) throw new Error(session.error);
    server.sim.tick();
    const blob = server.sim.serializeCharacter(session.pid);
    if (!blob) throw new Error('serializeCharacter returned null');
    // Regain skill post-reset, then relog against a FRESH server process.
    blob.craftSkills = { ...blob.craftSkills, armorcrafting: 40 };
    const server2 = new GameServer();
    const fc2 = fakeWs();
    const session2 = server2.join(fc2.ws as never, 7, 42, 'Online', 'warrior', blob as never);
    if ('error' in session2) throw new Error(session2.error);
    const meta2 = server2.sim.meta(session2.pid);
    if (!meta2) throw new Error('missing meta');
    expect(meta2.craftSkills.armorcrafting).toBe(40);
    // No second notice on the relogged character.
    for (let i = 0; i < 40; i++) server2.sim.tick();
    expect(server2.sim.mailUnreadFor(session2.pid)).toBe(0);
  });
});
