import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSession } from '../../server/game';
import { MembershipGameServices } from '../../server/membership_game_services';
import { redeemMembershipTokenAtomic } from '../../server/membership_redemption_db';
import { bustMembership, getMembershipBatch } from '../../server/membership_service';
import { KeyedSerialWriteAborted } from '../../server/serial_writer';
import type { CharacterState } from '../../src/sim/character_state';
import { MEMBERSHIP_ARMOUR_SLOTS } from '../../src/sim/content/membership';
import { Sim } from '../../src/sim/sim';
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
      entities: new Map([[1, { membershipActive: true }]]),
      setMembership: vi.fn(),
      claimMembershipArmour: vi.fn(),
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
    grantAnnualMount: vi.fn(),
    database: async (job) => job(),
  };
  return { host, session, inventory, service: new MembershipGameServices(host) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMembershipBatch).mockResolvedValue(new Map());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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
    expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
  });

  it('does not consume or acknowledge a proven rollback', async () => {
    const { host, session, inventory, service } = fixture();
    vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue({ ok: false, reason: 'retry' });
    await service.redeem(session, 0);
    expect(inventory[0].count).toBe(2);
    expect(host.acknowledge).not.toHaveBeenCalled();
    expect(host.quarantine).not.toHaveBeenCalled();
    expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
  });

  it('quarantines an uncertain commit without projecting stale inventory', async () => {
    const { host, session, inventory, service } = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(redeemMembershipTokenAtomic).mockRejectedValue(new Error('lost commit reply'));
    await service.redeem(session, 0);
    expect(inventory[0].count).toBe(2);
    expect(host.quarantine).toHaveBeenCalledWith(1, 11, 'ambiguous', 'membership redemption');
    expect(host.acknowledge).not.toHaveBeenCalled();
    expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
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

describe('redeemed token armour claim', () => {
  it.each([false, true])(
    'claims missing armour only after trusted refresh, previously active: %s',
    async (previouslyActive) => {
      vi.useFakeTimers();
      const { host, session } = fixture();
      const sim = new Sim({ seed: 42, playerClass: 'warrior' });
      session.pid = sim.player.id;
      const meta = sim.players.get(session.pid)!;
      meta.inventory = [];
      if (previouslyActive) {
        sim.setMembership(session.pid, 60);
        sim.equipItem('membership_helmet', session.pid);
        const chest = meta.inventory.find((slot) => slot.itemId === 'membership_chest')!;
        meta.bank.inventory.push(chest);
        meta.inventory = meta.inventory.filter(
          (slot) => slot !== chest && slot.itemId !== 'membership_feet',
        );
      }
      meta.inventory.push({ itemId: 'membership_token', count: 1 });
      host.sim = sim;
      host.capture = () => ({
        level: sim.player.level,
        state: sim.serializeCharacter(session.pid)!,
      });
      const service = new MembershipGameServices(host);
      const claim = vi.spyOn(sim, 'claimMembershipArmour');
      service.onJoin(session);
      vi.mocked(getMembershipBatch).mockResolvedValue(
        new Map([
          [
            7,
            {
              active: true,
              expiresAt: Date.now() + 100_000,
              authorizedUntil: Date.now() + 60_000,
              recurringExpiresAt: null,
            },
          ],
        ]),
      );
      vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue({
        ok: true,
        expiresAt: Date.now() + 100_000,
      });
      await service.redeem(session);
      expect(claim).not.toHaveBeenCalled();
      expect(meta.inventory.some((slot) => slot.itemId === 'membership_feet')).toBe(false);
      await vi.advanceTimersByTimeAsync(30);
      if (previouslyActive) expect(claim).toHaveBeenCalledExactlyOnceWith(session.pid);
      else expect(claim).not.toHaveBeenCalled();
      const owned = [
        ...meta.inventory.map((slot) => slot.itemId),
        ...meta.bank.inventory.map((slot) => slot.itemId),
        ...Object.values(meta.equipment),
      ];
      for (const slot of MEMBERSHIP_ARMOUR_SLOTS)
        expect(owned.filter((id) => id === `membership_${slot}`)).toHaveLength(1);
      expect(meta.inventory.some((slot) => slot.itemId === 'membership_token')).toBe(false);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(claim).toHaveBeenCalledTimes(previouslyActive ? 1 : 0);
      service.onLeave(session);
    },
  );

  it('drops a pending claim when its session leaves before the trusted refresh', async () => {
    vi.useFakeTimers();
    const { host, session, service } = fixture();
    service.onJoin(session);
    vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue({ ok: true, expiresAt: 100_000 });
    await service.redeem(session);
    service.onLeave(session);
    service.onJoin(session);
    vi.mocked(getMembershipBatch).mockResolvedValue(
      new Map([
        [
          7,
          {
            active: true,
            expiresAt: Date.now() + 60_000,
            authorizedUntil: Date.now() + 60_000,
            recurringExpiresAt: null,
          },
        ],
      ]),
    );
    await vi.advanceTimersByTimeAsync(30);
    expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
    service.onLeave(session);
  });

  it.each([
    { phase: 0, refreshAt: 31_025 },
    { phase: 980, refreshAt: 32_025 },
  ])(
    'retains a committed claim until a refresh actually confirms active authority (clock phase $phase)',
    async ({ phase, refreshAt }) => {
      vi.useFakeTimers();
      vi.setSystemTime(phase);
      const { host, session, service } = fixture();
      service.onJoin(session);
      vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue({ ok: true, expiresAt: 100_000 });
      await service.redeem(session);
      await vi.advanceTimersByTimeAsync(30);
      expect(getMembershipBatch).toHaveBeenCalledExactlyOnceWith([session.accountId]);
      expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
      vi.mocked(getMembershipBatch).mockResolvedValue(
        new Map([
          [
            7,
            {
              active: true,
              expiresAt: Date.now() + 60_000,
              authorizedUntil: Date.now() + 60_000,
              recurringExpiresAt: null,
            },
          ],
        ]),
      );
      // The first read coalesces for 25 ms, then the 30-second cohort rounds
      // up to a whole second and coalesces for another 25 ms before reading.
      await vi.advanceTimersByTimeAsync(refreshAt - Date.now() - 1);
      expect(getMembershipBatch).toHaveBeenCalledTimes(1);
      expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(getMembershipBatch).toHaveBeenCalledTimes(2);
      expect(host.sim.claimMembershipArmour).toHaveBeenCalledExactlyOnceWith(session.pid);
      service.onLeave(session);
    },
  );

  it.each(['rollback', 'projection'] as const)(
    'does not queue a claim after %s failure even when the account was already active',
    async (failure) => {
      vi.useFakeTimers();
      const { host, session, service } = fixture();
      service.onJoin(session);
      vi.mocked(getMembershipBatch).mockResolvedValue(
        new Map([
          [
            7,
            {
              active: true,
              expiresAt: Date.now() + 60_000,
              authorizedUntil: Date.now() + 60_000,
              recurringExpiresAt: null,
            },
          ],
        ]),
      );
      vi.mocked(redeemMembershipTokenAtomic).mockResolvedValue(
        failure === 'rollback' ? { ok: false, reason: 'retry' } : { ok: true, expiresAt: 100_000 },
      );
      if (failure === 'projection') vi.mocked(host.acknowledge).mockReturnValue(false);
      await service.redeem(session);
      await vi.advanceTimersByTimeAsync(30);
      expect(host.sim.claimMembershipArmour).not.toHaveBeenCalled();
      service.onLeave(session);
    },
  );
});
