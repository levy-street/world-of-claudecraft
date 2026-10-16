import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/membership_bank_db', () => ({
  listMembershipBanks: vi.fn(),
  loadMembershipBank: vi.fn(),
  transferMembershipBank: vi.fn(),
}));

import type { MembershipBankCommitted } from '../server/membership_bank_db';
import {
  createMembershipBankService,
  type MembershipBankHost,
  type MembershipBankSession,
} from '../server/membership_bank_service';
import type { CharacterState } from '../src/sim/character_state';
import { membershipBankView } from '../src/sim/membership_bank';

const item = { itemId: 'baked_bread', count: 3 };
const request = { direction: 'deposit' as const, slotIndex: 0, expectedSlot: item };
const member = {
  active: true,
  expiresAt: 100_000,
  authorizedUntil: 50_000,
  recurringExpiresAt: 100_000,
};
const session = (): MembershipBankSession => ({
  accountId: 1,
  characterId: 11,
  leaseNonce: 'lease',
});
function fixture() {
  const calls: string[] = [];
  const committed: MembershipBankCommitted = {
    inventoryBefore: [item],
    inventory: [],
    bank: membershipBankView(undefined),
    moved: 3,
  };
  const host: MembershipBankHost<MembershipBankSession> = {
    authorized: vi.fn(() => true),
    membership: vi.fn(async () => member),
    enqueueExclusive: vi.fn(async (_s, job) => {
      calls.push('fifo');
      return job();
    }),
    capture: vi.fn(() => {
      calls.push('capture');
      return { state: { inventory: [item] } as CharacterState };
    }),
    apply: vi.fn(() => {
      calls.push('apply');
      return true;
    }),
    acknowledge: vi.fn(() => {
      calls.push('ack');
      return true;
    }),
    quarantine: vi.fn(),
    publish: vi.fn(),
    onError: vi.fn(),
  };
  const db = {
    list: vi.fn(async () => [
      { characterId: 11, name: 'Current' },
      { characterId: 12, name: 'Alt' },
    ]),
    load: vi.fn(async () => ({ ok: true as const, value: membershipBankView(undefined) })),
    transfer: vi.fn(async () => {
      calls.push('commit');
      return { ok: true as const, value: committed };
    }),
  };
  const service = createMembershipBankService(host, db, () => 1000);
  return { host, db, service, calls };
}

describe('membership bank admission and live apply', () => {
  it('does metadata work only on list and loads only a deliberately selected bank', async () => {
    const { service, db, host } = fixture();
    const s = session();
    await service.list(s);
    expect(db.load).not.toHaveBeenCalled();
    expect(host.publish).toHaveBeenLastCalledWith(s, {
      characters: [{ characterId: 12, name: 'Alt' }],
      selectedCharacterId: null,
      bank: null,
    });
    await service.select(s, 12);
    expect(db.load).toHaveBeenCalledExactlyOnceWith(1, 12);
  });

  it('serializes capture, commit, live delta and durable acknowledgements in that order', async () => {
    const { service, calls } = fixture();
    await service.transfer(session(), 12, request);
    expect(calls).toEqual(['fifo', 'capture', 'commit', 'apply', 'ack']);
  });

  it('refuses expired membership before any bank database read', async () => {
    const { host, service, db } = fixture();
    vi.mocked(host.membership).mockResolvedValue({ ...member, authorizedUntil: 999 });
    await service.list(session());
    expect(db.list).not.toHaveBeenCalled();
    expect(host.publish).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ error: 'membership_required' }),
    );
  });

  it('rechecks banker authority after an asynchronous read', async () => {
    const { host, service, db } = fixture();
    db.load.mockImplementation(async () => {
      vi.mocked(host.authorized).mockReturnValue(false);
      return { ok: true, value: membershipBankView(undefined) };
    });
    await service.select(session(), 12);
    expect(host.publish).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ bank: null }),
    );
  });

  it('allows only one pending operation per account across different sockets', async () => {
    const { host, service, db } = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.list.mockImplementation(async () => {
      await pending;
      return [];
    });
    const first = service.list(session());
    await service.select({ ...session(), characterId: 22 }, 12);
    expect(db.load).not.toHaveBeenCalled();
    expect(host.publish).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ error: 'busy' }),
    );
    release();
    await first;
  });

  it('meters repeat requests even after their promises have completed', async () => {
    const { host, service, db } = fixture();
    const s = session();
    for (let i = 0; i < 7; i++) await service.list(s);
    expect(db.list).toHaveBeenCalledTimes(6);
    expect(host.publish).toHaveBeenLastCalledWith(
      s,
      expect.objectContaining({ error: 'rate_limited' }),
    );
  });

  it.each(['uncertain', 'lease_lost'] as const)(
    'quarantines %s without applying or acknowledging',
    async (error) => {
      const { host, service, db } = fixture();
      db.transfer.mockResolvedValue({ ok: false, error } as never);
      const s = session();
      await service.transfer(s, 12, request);
      expect(host.quarantine).toHaveBeenCalledExactlyOnceWith(s, error);
      expect(host.apply).not.toHaveBeenCalled();
      expect(host.acknowledge).not.toHaveBeenCalled();
    },
  );

  it.each(['conflict', 'throw'] as const)(
    'quarantines a postcommit %s and never resumes old state',
    async (mode) => {
      const { host, service } = fixture();
      const s = session();
      vi.mocked(host.apply).mockImplementation(() => {
        if (mode === 'throw') throw new Error('unexpected');
        return false;
      });
      await service.transfer(s, 12, request);
      expect(host.quarantine).toHaveBeenCalledExactlyOnceWith(s, 'changed');
      expect(host.acknowledge).not.toHaveBeenCalled();
    },
  );

  it('never captures or starts SQL for a cancelled queued job', async () => {
    vi.useFakeTimers();
    try {
      const { host, service, db } = fixture();
      vi.mocked(host.enqueueExclusive).mockImplementation(async (_session, job, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return job(); // Even a host that missed unlinking is stopped by the second check.
      });
      const work = service.transfer(session(), 12, request);
      await vi.advanceTimersByTimeAsync(5001);
      await work;
      expect(host.capture).not.toHaveBeenCalled();
      expect(db.transfer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
