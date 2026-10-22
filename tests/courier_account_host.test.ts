// The server half of the courier's other-character leg: one run per session,
// the committed courier replaces the live leg exactly, a refusal sends the
// stacks home, and an uncertain commit quarantines instead of guessing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/membership_bank_db', () => ({
  listMembershipBanks: vi.fn(),
  loadMembershipBank: vi.fn(),
  transferMembershipBank: vi.fn(),
  transferCourierAccountLeg: vi.fn(),
}));
vi.mock('../server/membership_service', () => ({
  getMembership: vi.fn(async () => ({
    active: true,
    expiresAt: Date.now() + 60_000,
    authorizedUntil: Date.now() + 30_000,
    recurringExpiresAt: null,
  })),
  getMembershipBatch: vi.fn(),
  bustMembership: vi.fn(),
  trustedRecurringMembershipExpiry: vi.fn(),
}));

import type { ClientSession } from '../server/game';
import { transferCourierAccountLeg } from '../server/membership_bank_db';
import { MembershipGameServices } from '../server/membership_game_services';
import type { CourierState } from '../src/sim/courier';

const transfer = vi.mocked(transferCourierAccountLeg);

function rig() {
  const courier: CourierState = {
    phase: 'outbound',
    x: 0,
    z: 0,
    bankerId: 2,
    travelDistance: 0,
    cargo: [{ itemId: 'baked_bread', count: 2 }],
    withdrawals: [],
    account: { characterId: 12, cargo: [{ itemId: 'healing_potion', count: 3 }], withdrawals: [] },
    banked: true,
    revision: 4,
    retryRemaining: 0,
  };
  const meta = { characterId: 11, courier };
  const session = {
    pid: 1,
    characterId: 11,
    accountId: 7,
    leaseNonce: 'nonce',
    left: false,
    escrowQuarantined: false,
  } as unknown as ClientSession;
  const host = {
    sim: { meta: () => meta, entities: new Map(), ctx: { trades: new Map() } },
    session: () => session,
    enqueue: vi.fn(async (_id: number, job: () => Promise<unknown>) => job()),
    capture: vi.fn(() => ({ level: 5, state: { courier: structuredClone(meta.courier) } })),
    conflict: () => false,
    acknowledge: vi.fn(() => true),
    quarantine: vi.fn(),
    send: vi.fn(),
    kick: vi.fn(),
    observeCost: vi.fn(),
    mailWrite: vi.fn(),
    database: vi.fn(),
  };
  const services = new MembershipGameServices(host as never);
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { courier, meta, session, host, services, settle };
}

describe('courier other-character leg on the server', () => {
  beforeEach(() => {
    transfer.mockReset();
  });

  it('starts one run, then replaces the live leg with the committed courier', async () => {
    const r = rig();
    const committed = {
      ...r.courier,
      account: undefined,
      cargo: [{ itemId: 'baked_bread', count: 2 }],
      revision: 5,
    };
    let finish!: () => void;
    transfer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, value: committed });
        }),
    );
    expect(r.services.courierAccountExchange(1)).toBe('pending');
    expect(r.services.courierAccountExchange(1)).toBe('pending');
    await r.settle();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][0].state.courier?.account?.characterId).toBe(12);
    finish();
    await r.settle();
    expect(r.meta.courier.account).toBeUndefined();
    expect(r.meta.courier.cargo).toEqual([{ itemId: 'baked_bread', count: 2 }]);
    expect(r.meta.courier.revision).toBe(5);
    expect(r.host.acknowledge).toHaveBeenCalledTimes(1);
    expect(r.services.courierAccountExchange(1)).toBe('settled');
  });

  it('sends the stacks home when that character is logged in', async () => {
    const r = rig();
    transfer.mockResolvedValue({ ok: false, error: 'online' });
    r.services.courierAccountExchange(1);
    await r.settle();
    expect(r.meta.courier.account).toBeUndefined();
    expect(r.meta.courier.cargo).toEqual([
      { itemId: 'baked_bread', count: 2 },
      { itemId: 'healing_potion', count: 3 },
    ]);
    expect(r.host.quarantine).not.toHaveBeenCalled();
  });

  it('quarantines an uncertain commit and leaves custody as it was', async () => {
    const r = rig();
    transfer.mockResolvedValue({ ok: false, error: 'uncertain' });
    r.services.courierAccountExchange(1);
    await r.settle();
    expect(r.host.quarantine).toHaveBeenCalledWith(1, 11, 'ambiguous', 'courier account leg');
    expect(r.meta.courier.account).toBeDefined();
  });

  it('quarantines rather than apply a commit whose live leg moved underneath it', async () => {
    const r = rig();
    transfer.mockImplementation(async () => {
      r.meta.courier.account = { ...r.meta.courier.account!, characterId: 13 };
      return { ok: true, value: { ...r.courier, account: undefined, revision: 5 } };
    });
    r.services.courierAccountExchange(1);
    await r.settle();
    expect(r.host.quarantine).toHaveBeenCalledWith(
      1,
      11,
      'ambiguous',
      'courier account leg projection',
    );
  });

  it('sends the stacks home when the write throws (it rolled back), never retrying forever', async () => {
    const r = rig();
    transfer.mockRejectedValue(new Error('malformed target bank'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    r.services.courierAccountExchange(1);
    await r.settle();
    quiet.mockRestore();
    expect(r.meta.courier.account).toBeUndefined();
    expect(r.meta.courier.cargo).toHaveLength(2);
    expect(r.host.quarantine).not.toHaveBeenCalled();
  });
});
