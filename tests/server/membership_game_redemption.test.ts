import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSession } from '../../server/game';
import { MembershipGameServices } from '../../server/membership_game_services';
import { redeemMembershipTokenAtomic } from '../../server/membership_redemption_db';
import { bustMembership } from '../../server/membership_service';
import { KeyedSerialWriteAborted } from '../../server/serial_writer';
import type { CharacterState } from '../../src/sim/character_state';
import type { Sim } from '../../src/sim/sim';
import type { InvSlot } from '../../src/sim/types';

vi.mock('../../server/membership_service', () => ({
  getMembership: vi.fn(async () => ({ active: false, expiresAt: null, authorizedUntil: 0 })),
  getMembershipBatch: vi.fn(async () => new Map()),
  bustMembership: vi.fn(),
  trustedRecurringMembershipExpiry: vi.fn(() => null),
}));
vi.mock('../../server/membership_redemption_db', async (original) => ({
  ...(await original<typeof import('../../server/membership_redemption_db')>()),
  redeemMembershipTokenAtomic: vi.fn(),
}));

function fixture() {
  const inventory: InvSlot[] = [{ itemId: 'membership_token', count: 2 }];
  const meta = { inventory };
  const session = { accountId: 7, characterId: 11, pid: 1, leaseNonce: 'nonce' } as ClientSession;
  const host: ConstructorParameters<typeof MembershipGameServices>[0] = {
    sim: {
      ctx: { trades: new Map(), onInventoryChangedForQuests: vi.fn() },
      meta: () => meta,
      entities: new Map(),
    } as unknown as Sim,
    session: () => session,
    enqueue: async (_id, job) => job(),
    capture: () => ({ level: 1, state: structuredClone({ inventory }) as CharacterState }),
    conflict: () => false,
    acknowledge: vi.fn(() => true),
    quarantine: vi.fn(),
    send: vi.fn(),
    kick: vi.fn(),
    observeCost: vi.fn(),
    mailWrite: async (job) => job(),
    database: async (job) => job(),
  };
  return { host, session, inventory, service: new MembershipGameServices(host) };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('live membership redemption', () => {
  it('projects one committed token while preserving passive inventory additions', async () => {
    const { host, session, inventory, service } = fixture();
    vi.mocked(redeemMembershipTokenAtomic).mockImplementation(async () => {
      expect(service.isBusy(7)).toBe(true);
      inventory.push({ itemId: 'baked_bread', count: 3 });
      return { ok: true, expiresAt: 12345 };
    });
    await service.redeem(session, 0);
    expect(inventory).toEqual([
      { itemId: 'membership_token', count: 1 },
      { itemId: 'baked_bread', count: 3 },
    ]);
    expect(host.acknowledge).toHaveBeenCalledOnce();
    expect(bustMembership).toHaveBeenCalledExactlyOnceWith(7);
    expect(service.isBusy(7)).toBe(false);
    expect(host.quarantine).not.toHaveBeenCalled();
  });

  it('does not consume or acknowledge a proven rollback', async () => {
    const { host, session, inventory, service } = fixture();
    vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue({ ok: false, reason: 'retry' });
    await service.redeem(session, 0);
    expect(inventory[0].count).toBe(2);
    expect(host.acknowledge).not.toHaveBeenCalled();
    expect(host.quarantine).not.toHaveBeenCalled();
  });

  it('quarantines an uncertain commit without projecting stale inventory', async () => {
    const { host, session, inventory, service } = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(redeemMembershipTokenAtomic).mockRejectedValue(new Error('lost commit reply'));
    await service.redeem(session, 0);
    expect(inventory[0].count).toBe(2);
    expect(host.quarantine).toHaveBeenCalledWith(1, 11, 'ambiguous', 'membership redemption');
    expect(host.acknowledge).not.toHaveBeenCalled();
    expect(service.isBusy(7)).toBe(false);
  });

  it('cancels queued work before capture or token mutation', async () => {
    const { host, session, service } = fixture();
    host.enqueue = async () => {
      throw new KeyedSerialWriteAborted();
    };
    await service.redeem(session, 0);
    expect(redeemMembershipTokenAtomic).not.toHaveBeenCalled();
    expect(host.quarantine).not.toHaveBeenCalled();
    expect(service.isBusy(7)).toBe(false);
  });

  it('does not quarantine when shared database admission times out before starting', async () => {
    vi.useFakeTimers();
    const { host, session, service } = fixture();
    host.enqueue = async (_id, _job, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        );
      });
    const pending = service.redeem(session, 0);
    await vi.advanceTimersByTimeAsync(5001);
    await pending;
    expect(redeemMembershipTokenAtomic).not.toHaveBeenCalled();
    expect(host.quarantine).not.toHaveBeenCalled();
    expect(service.isBusy(7)).toBe(false);
    vi.useRealTimers();
  });

  it('rejects a concurrent redemption for the same account', async () => {
    const { session, service } = fixture();
    let release: (() => void) | undefined;
    vi.mocked(redeemMembershipTokenAtomic).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: false, reason: 'retry' };
    });
    const first = service.redeem(session, 0);
    await vi.waitFor(() => expect(release).toBeDefined());
    await service.redeem(session, 0);
    expect(redeemMembershipTokenAtomic).toHaveBeenCalledOnce();
    release?.();
    await first;
    expect(service.isBusy(7)).toBe(false);
  });
});
