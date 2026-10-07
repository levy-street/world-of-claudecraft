import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  loadAccountFlair: vi.fn(async () => ({ titleId: null, cosmetics: [] })),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // A successful bank op now dereferences the fire-and-forget ledger writer.
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { courierSlotFingerprint, courierSummon, updateCourier } from '../src/sim/courier';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

describe('live courier server wiring', () => {
  it('grants, expires and renews Courier through the real online ability presentation', () => {
    const server = new GameServer();
    const socket = fakeWs();
    const session = joinServer(server, socket, 41, 'Spellcourier');
    const client = bareClient(session.pid);
    const read = () => {
      broadcast(server);
      (client as any).applySnapshot(lastSnap(socket.sent));
      return client.known.filter((ability) => ability.def.id === 'courier').length;
    };
    expect(read()).toBe(0);
    server.sim.setMembership(session.pid, 0.05);
    expect(read()).toBe(1);
    server.sim.tick();
    expect(server.sim.membershipActiveFor(session.pid)).toBe(false);
    expect(read()).toBe(0);
    server.sim.setMembership(session.pid, 60);
    expect(read()).toBe(1);
    expect(read()).toBe(1);
  });

  it('round-trips a legacy over-capacity bank and withdraws its exact high-index copy', () => {
    const server = new GameServer();
    const socket = fakeWs();
    const session = joinServer(server, socket, 31, 'Legacycourier');
    const sim = server.sim;
    const player = sim.entities.get(session.pid)!;
    player.pos.x = 0;
    player.pos.z = 0;
    sim.setMembership(session.pid, 60);
    const meta = sim.meta(session.pid)!;
    meta.bank.inventory = Array.from({ length: 10_000 }, (_, index) => ({
      itemId: 'baked_bread',
      count: 2,
      instance: { signer: `Legacy${index}` },
    }));
    courierSummon(sim.ctx, session.pid);
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(socket.sent));
    expect(client.courierInfo?.bankSlots).toHaveLength(10_000);
    const selected = client.courierInfo!.bankSlots[9999];
    expect(selected).toEqual({
      itemId: 'baked_bread',
      count: 2,
      instance: { signer: 'Legacy9999' },
    });
    (client as any).cmd = (payload: Record<string, unknown>) =>
      server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
    client.courierDispatch({
      deposits: [],
      withdrawals: [{ index: 9998, fingerprint: courierSlotFingerprint(selected) }],
    });
    expect(meta.courier?.phase).toBe('ready');
    client.courierDispatch({
      deposits: [],
      withdrawals: [{ index: 9999, fingerprint: courierSlotFingerprint(selected) }],
    });
    expect(meta.courier?.phase).toBe('outbound');
    const state = meta.courier!;
    const banker = sim.entities.get(state.bankerId!)!;
    state.x = banker.pos.x;
    state.z = banker.pos.z;
    updateCourier(sim.ctx, meta, player);
    expect(state.phase).toBe('returning');
    expect(state.cargo).toEqual([selected]);
    expect(meta.bank.inventory).toHaveLength(9999);
    expect(meta.bank.inventory[9998]).toEqual({
      itemId: 'baked_bread',
      count: 2,
      instance: { signer: 'Legacy9998' },
    });
    const journal = session.bankLedgerJournal.outbox.snapshot();
    expect(journal.rowCount).toBe(1);
    expect(journal.batches[0].rows).toMatchObject([
      {
        op: 'withdraw',
        itemId: 'baked_bread',
        count: 2,
        instanceJson: JSON.stringify({ signer: 'Legacy9999' }),
      },
    ]);
  });

  it('keeps remote bank commands gated while courier requests round-trip owner-only', () => {
    const server = new GameServer();
    const socket = fakeWs();
    const session = joinServer(server, socket, 11, 'Courierowner');
    const observerSocket = fakeWs();
    const observer = joinServer(server, observerSocket, 12, 'Observer');
    const sim = server.sim;
    const player = sim.entities.get(session.pid)!;
    player.pos.x = 0;
    player.pos.z = 0;
    sim.setMembership(session.pid, 60);
    sim.addItem('wolf_fang', 3, session.pid);
    const meta = sim.meta(session.pid)!;
    meta.bank.inventory = [{ itemId: 'wolf_pelt', count: 2 }];
    const slot = meta.inventory.findIndex((row) => row.itemId === 'wolf_fang');
    expect(sim.bankInfoFor(session.pid)).toBeNull();
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'bank_deposit', slot }));
    expect(meta.inventory[slot].count).toBe(3);
    courierSummon(sim.ctx, session.pid);
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(socket.sent));
    expect(client.courierInfo?.bankSlots).toEqual([{ itemId: 'wolf_pelt', count: 2 }]);
    expect(client.bankInfo).toBeNull();
    expect(lastSnap(observerSocket.sent).self.courier).toBeNull();
    expect(lastSnap(observerSocket.sent).self.courierData).toBeNull();
    const heavyRead = vi.spyOn(sim, 'courierInfoFor');
    meta.wireRev++;
    broadcast(server);
    const unrelatedRevision = lastSnap(socket.sent);
    expect(unrelatedRevision.self.courierData).toBeUndefined();
    expect(unrelatedRevision.self.courier.inventoryRevision).toBe(meta.wireRev);
    expect(heavyRead).not.toHaveBeenCalled();
    (client as any).applySnapshot(unrelatedRevision);
    expect(client.courierInfo?.inventoryRevision).toBe(meta.wireRev);
    expect(client.courierInfo?.bankSlots).toEqual([{ itemId: 'wolf_pelt', count: 2 }]);
    const sent: unknown[] = [];
    (client as any).cmd = (payload: Record<string, unknown>) => {
      sent.push(payload);
      server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
    };
    client.courierDispatch({
      deposits: [{ index: slot, fingerprint: courierSlotFingerprint(meta.inventory[slot]) }],
      withdrawals: [],
    });
    expect(sent).toHaveLength(1);
    expect(meta.courier?.phase).toBe('outbound');
    expect(meta.courier?.cargo).toEqual([
      { itemId: 'wolf_fang', count: 3, materialSources: [{ count: 3, source: {} }] },
    ]);
    expect(meta.inventory.some((row) => row.itemId === 'wolf_fang')).toBe(false);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(socket.sent));
    expect(client.courierInfo?.phase).toBe('outbound');
    expect(client.courierInfo?.cargo).toEqual([
      { itemId: 'wolf_fang', count: 3, materialSources: [{ count: 3, source: {} }] },
    ]);
    const before = client.courierInfo;
    broadcast(server);
    const unchanged = lastSnap(socket.sent);
    expect(unchanged.self.courierData).toBeUndefined();
    (client as any).applySnapshot(unchanged);
    expect(client.courierInfo).toBe(before);
    expect(sim.meta(observer.pid)?.courier).toBeUndefined();
    heavyRead.mockClear();
    for (let i = 0; i < 15; i++) updateCourier(sim.ctx, meta, player);
    broadcast(server);
    const moving = lastSnap(socket.sent);
    expect(moving.self.courierData).toBeUndefined();
    expect(moving.self.courier.travelDistance).toBeGreaterThan(3);
    expect(moving.self.courier.travelDistance).toBeLessThan(8);
    expect(moving.self.courier.remainingDistance).toBeGreaterThan(8);
    (client as any).applySnapshot(moving);
    expect(client.courierInfo?.travelDistance).toBe(meta.courier!.travelDistance);
    const destination = sim.entities.get(meta.courier!.bankerId!)!;
    expect(client.courierInfo?.remainingDistance).toBeCloseTo(
      Math.hypot(destination.pos.x - meta.courier!.x, destination.pos.z - meta.courier!.z),
    );
    expect(heavyRead).not.toHaveBeenCalled();
    const state = meta.courier!;
    const banker = sim.entities.get(state.bankerId!)!;
    state.x = banker.pos.x;
    state.z = banker.pos.z;
    updateCourier(sim.ctx, meta, player);
    expect(state.phase).toBe('returning');
    expect(state.cargo).toEqual([]);
    const journal = session.bankLedgerJournal.outbox.snapshot();
    expect(journal.rowCount).toBe(1);
    expect(journal.batches[0].rows).toMatchObject([
      { op: 'deposit', itemId: 'wolf_fang', count: 3 },
    ]);
  });
});
