import { afterEach, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('../../server/membership_service', () => ({
  getMembershipBatch: source.batch,
  getMembership: vi.fn(),
  bustMembership: vi.fn(),
  trustedRecurringMembershipExpiry: vi.fn(),
}));
vi.mock('../../server/membership_batch', () => ({ MEMBERSHIP_REFRESH_BATCH_SIZE: 250 }));
vi.mock('../../server/membership_bank_service', () => ({
  createMembershipBankService: () => ({}),
}));
vi.mock('../../server/membership_redemption_db', () => ({
  consumeMembershipToken: vi.fn(),
  redeemMembershipTokenAtomic: vi.fn(),
}));
vi.mock('../../server/membership_token_delivery_db', () => ({
  persistMembershipTokenDelivery: vi.fn(),
}));
vi.mock('../../server/membership_token_delivery', () => ({
  createMembershipTokenDelivery: vi.fn(),
}));
vi.mock('../../server/mail_custody_overlay', () => ({
  CUSTODY_PARCEL_LETTERS: {},
  confirmCustodyParcelBooked: vi.fn(),
}));

import type { ClientSession } from '../../server/game';
import { MembershipGameServices } from '../../server/membership_game_services';
import type { MembershipAuthorization } from '../../server/membership_service';

type Host = ConstructorParameters<typeof MembershipGameServices>[0];
function fixture(count: number) {
  const sessions = new Map<number, ClientSession>();
  const deadlines = new Map<number, number>();
  const gaps: number[] = [];
  for (let id = 1; id <= count; id++) {
    sessions.set(id, {
      pid: id,
      characterId: id,
      accountId: id,
      name: `Player${id}`,
      left: false,
      membershipSlot: true,
    } as ClientSession);
    // The WS handshake has already stamped every member for one minute.
    deadlines.set(id, Date.now() + 60_000);
  }
  const kick = vi.fn();
  const stamp = vi.fn((pid: number, seconds: number) => {
    if ((deadlines.get(pid) ?? 0) <= Date.now() || seconds <= 0) gaps.push(pid);
    deadlines.set(pid, Date.now() + seconds * 1000);
  });
  const host = {
    sim: { setMembership: stamp },
    session: (id: number) => sessions.get(id) ?? null,
    kick,
    send: vi.fn(),
    observeCost: vi.fn(),
  } as unknown as Host;
  const service = new MembershipGameServices(host);
  for (const session of sessions.values()) service.onJoin(session);
  return { service, sessions, deadlines, gaps, kick, stamp };
}
afterEach(() => {
  vi.useRealTimers();
  source.batch.mockReset();
});

describe('realm membership refresh capacity', () => {
  it('keeps 5000 members continuously authorized at five-second batch latency with only four workers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let inFlight = 0;
    let peak = 0;
    source.batch.mockImplementation(async (ids: number[]) => {
      expect(ids.length).toBeLessThanOrEqual(250);
      const checkedAt = Date.now();
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      inFlight--;
      return new Map(
        ids.map((id) => [
          id,
          {
            active: true,
            expiresAt: 1_000_000,
            authorizedUntil: checkedAt + 60_000,
            recurringExpiresAt: 1_000_000,
          } satisfies MembershipAuthorization,
        ]),
      );
    });
    const { service, sessions, deadlines, gaps, kick, stamp } = fixture(5000);
    await vi.advanceTimersByTimeAsync(25_100);
    expect(stamp).toHaveBeenCalledTimes(5000);
    expect(source.batch).toHaveBeenCalledTimes(20);
    expect(peak).toBe(4);
    for (let step = 0; step < 120; step++) {
      await vi.advanceTimersByTimeAsync(1000);
      expect([...deadlines.values()].every((expiry) => expiry > Date.now())).toBe(true);
    }
    expect(gaps).toEqual([]);
    expect(kick).not.toHaveBeenCalled();
    expect(source.batch.mock.calls.every(([ids]) => ids.length === 250)).toBe(true);
    for (const session of sessions.values()) service.onLeave(session);
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('does not apply a delayed batch to a departed account and resolves recipients account-locally', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finish!: (rows: Map<number, MembershipAuthorization>) => void;
    source.batch.mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const { service, sessions, stamp } = fixture(2);
    expect(service.recipient(1)).toEqual({ characterId: 1, name: 'Player1' });
    expect(service.recipient(3)).toBeNull();
    await vi.advanceTimersByTimeAsync(25);
    const departed = sessions.get(1)!;
    service.onLeave(departed);
    sessions.delete(1);
    expect(service.recipient(1)).toBeNull();
    finish(
      new Map(
        [1, 2].map((id) => [
          id,
          { active: true, expiresAt: 1_000_000, authorizedUntil: 60_000, recurringExpiresAt: null },
        ]),
      ),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(stamp).toHaveBeenCalledOnce();
    expect(stamp).toHaveBeenCalledWith(2, expect.any(Number));
    service.onLeave(sessions.get(2)!);
  });
});
