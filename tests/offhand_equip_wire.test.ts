// The additive 'offhand' equip slot (a post-launch slot: dual-wield weapons,
// shields, and caster held items) is on the live ALL_EQUIP_SLOTS but not the
// frozen launch-era EQUIP_SLOTS. Stale validation left offhand-targeting actions
// incomplete:
//   - unequip_item{slot:'offhand'} never reached sim.unequipItem, so an equipped
//     offhand was stuck on (the reported bug)
//   - the touch-drag drop hit test resolved the offhand paperdoll socket to no
//     target, so a finger-drag onto the offhand never registered
// The aimed equip path also needs the live slot list and the weapon-aware slot
// rule, otherwise a dual-wield drop is rejected or silently resolved to mainhand.
// These tests exercise both wire commands through the real GameServer dispatch,
// plus the pure touch hit test.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the wire/dispatch logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';
import { resolveDropTargetAt } from '../src/ui/item_drop_hit_test';

// ws is `any` to stand in for a real WebSocket without its full surface (the same
// shape tests/weapon_stow.test.ts uses for GameServer.join).
interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

describe('unequip an offhand item over the wire', () => {
  it('unequip_item{slot:offhand} moves the offhand weapon into the bags', () => {
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 1, 'Fury');
    const sim = server.sim;
    const meta = sim.meta(session.pid)!;

    // Use a Fury warrior as a build that can hold a dual-wield offhand weapon.
    sim.setPlayerLevel(40, session.pid);
    expect(sim.setSpec('fury', session.pid)).toBe(true);

    // Put a one-hand weapon in the offhand the way the game does it: the resolver
    // routes a one-hander to the offhand when the mainhand is occupied (a weapon's
    // declared slot is 'mainhand', so it cannot be *aimed* at the offhand; the
    // resolver is the real path). This swaps the starter shield out to the bags.
    sim.addItem('training_mace', 1, session.pid);
    sim.equipItem('training_mace', session.pid);
    expect(meta.equipment.offhand).toBe('training_mace'); // precondition

    // Act exactly as src/net/online.ts unequipItem does.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'unequip_item', slot: 'offhand' }),
    );

    // The offhand is now empty and the weapon is back in the bags.
    expect(meta.equipment.offhand).toBeFalsy();
    expect(meta.inventory.some((s) => s.itemId === 'training_mace')).toBe(true);
  });
});

describe('equip an aimed offhand weapon over the wire', () => {
  it('honors slot:offhand instead of falling back to the mainhand resolver', () => {
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 2, 'FuryAim');
    const sim = server.sim;
    const meta = sim.meta(session.pid)!;

    sim.setPlayerLevel(40, session.pid);
    expect(sim.setSpec('fury', session.pid)).toBe(true);
    expect(sim.unequipItem('mainhand', session.pid)).toBe(true);
    expect(sim.unequipItem('offhand', session.pid)).toBe(true);
    expect(meta.equipment.mainhand).toBeFalsy();
    expect(meta.equipment.offhand).toBeFalsy();
    sim.addItem('training_mace', 1, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'equip', item: 'training_mace', slot: 'offhand' }),
    );

    expect(meta.equipment.offhand).toBe('training_mace');
    expect(meta.equipment.mainhand).toBeFalsy();
    expect(meta.inventory.some((s) => s.itemId === 'training_mace')).toBe(false);
  });
});

describe('touch-drag hit test recognizes the offhand paperdoll socket', () => {
  it('resolves data-equip-slot="offhand" to an equip target', () => {
    // A finger released over an element carrying data-equip-slot="offhand".
    const socket = { dataset: { equipSlot: 'offhand' } };
    const el = { closest: (sel: string) => (sel === '[data-equip-slot]' ? socket : null) };
    const res = resolveDropTargetAt(0, 0, () => el as unknown as Element);
    expect(res).toEqual({ kind: 'equip', slot: 'offhand' });
  });

  it('still rejects an unknown slot value (guards against a stale attribute)', () => {
    const socket = { dataset: { equipSlot: 'not-a-slot' } };
    const el = { closest: (sel: string) => (sel === '[data-equip-slot]' ? socket : null) };
    const res = resolveDropTargetAt(0, 0, () => el as unknown as Element);
    expect(res).toEqual({ kind: 'none' });
  });
});
