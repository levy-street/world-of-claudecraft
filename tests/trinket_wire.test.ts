import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { ITEMS } from '../src/sim/data';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const ID = 'test_wire_trinket';
beforeEach(() => {
  ITEMS[ID] = {
    ...ITEMS.seal_of_the_nine_oaths,
    id: ID,
    kind: 'armor',
    slot: 'trinket',
    armorType: undefined,
    weapon: undefined,
  };
});
afterEach(() => {
  delete ITEMS[ID];
});

describe('trinket server and client wire parity', () => {
  it('uses existing client equip and unequip commands without mutating the mirror optimistically', () => {
    const cmd = vi.fn();
    const client = bareClient(7, { cmd });
    client.equipItemToSlot(ID, 'trinket', { slotIndex: 2 });
    client.unequipItem('trinket');
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'equip', item: ID, slot: 'trinket', bagSlot: 2 }],
      [{ cmd: 'unequip_item', slot: 'trinket' }],
    ]);
    expect(client.equipment.trinket).toBeUndefined();
  });

  it('validates aimed equip, snapshots item and instance, then unequips through real dispatch', () => {
    const server = new GameServer();
    const socket = fakeWs();
    const session = joinServer(server, socket, 1, 'Trinket');
    const sim = server.sim;
    const meta = sim.meta(session.pid)!;
    sim.setPlayerLevel(20, session.pid);
    sim.addItem(ID, 1, session.pid);
    const bag = meta.inventory.find((row) => row.itemId === ID)!;
    bag.instance = { signer: 'Wire Smith' };
    const send = (cmd: object) =>
      server.handleMessage(session, JSON.stringify({ t: 'cmd', ...cmd }));
    send({ cmd: 'equip', item: ID, slot: 'neck' });
    expect(meta.equipment.trinket).toBeUndefined();
    expect(sim.countItem(ID, session.pid)).toBe(1);
    send({ cmd: 'equip', item: ID, slot: 'trinket' });
    expect(meta.equipment.trinket).toBe(ID);
    broadcast(server);
    const snapshot = lastSnap(socket.sent);
    expect(snapshot.self.equip.trinket).toBe(ID);
    expect(snapshot.self.einst.trinket).toEqual(bag.instance);
    const client = bareClient(session.pid);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot(snapshot);
    expect(client.equipment.trinket).toBe(ID);
    expect(client.equipmentInstances.trinket).toEqual(bag.instance);
    send({ cmd: 'unequip_item', slot: 'trinket2' });
    expect(meta.equipment.trinket).toBe(ID);
    send({ cmd: 'unequip_item', slot: 'trinket' });
    expect(meta.equipment.trinket).toBeUndefined();
    expect(meta.inventory.find((row) => row.itemId === ID)?.instance).toEqual(bag.instance);
    sim.tick();
    broadcast(server);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot(
      lastSnap(socket.sent),
    );
    expect(client.equipment.trinket).toBeUndefined();
    expect(client.equipmentInstances.trinket).toBeUndefined();
  });
});
