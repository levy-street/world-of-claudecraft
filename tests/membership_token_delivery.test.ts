import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustodyParcelRow } from '../server/mail_custody_overlay';
import {
  createMembershipTokenDelivery,
  TOKEN_DELIVERY_QUEUE_WAIT_MS,
} from '../server/membership_token_delivery';
import { MembershipTokenCommitUncertain } from '../server/membership_token_delivery_db';

const recipient = { characterId: 13, name: 'Alice' };
const parcel: CustodyParcelRow = {
  custodyRef: 'membership-token:receipt-1234567890',
  recipient: { key: '13', name: 'Alice' },
  letter: 'membership_token',
  items: [{ itemId: 'membership_token', count: 1 }],
};
const immediate = <T>(job: () => Promise<T>) => job();
afterEach(() => vi.useRealTimers());
describe.each([
  ['token', parcel],
  [
    'annual mount',
    {
      ...parcel,
      custodyRef: 'membership-annual:receipt-1234567890',
      letter: 'membership_annual',
      items: [{ itemId: 'reins_terrorspark_groundshaker', count: 1 }],
    } as CustodyParcelRow,
  ],
] as const)('membership %s live delivery recovery', (_kind, parcel) => {
  it('recovers a lost COMMIT acknowledgement after immutable receipt verification, exactly once', async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(
        new MembershipTokenCommitUncertain(parcel, new Error('lost acknowledgement')),
      )
      .mockResolvedValue(null);
    const book = vi.fn(() => true);
    const deliver = createMembershipTokenDelivery({
      persist,
      book,
      mailWrite: immediate,
      database: immediate,
    });
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(false);
    expect(book).not.toHaveBeenCalled();
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(true);
    expect(book).toHaveBeenCalledExactlyOnceWith(parcel);
    // Collection and mailbox baking may remove the parcel; a later replay cannot rebook it.
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(true);
    expect(book).toHaveBeenCalledTimes(1);
  });
  it('does not book retained proof when database identity verification fails', async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new MembershipTokenCommitUncertain(parcel, null))
      .mockRejectedValueOnce(new Error('identity mismatch'))
      .mockResolvedValueOnce(parcel);
    const book = vi.fn(() => true);
    const deliver = createMembershipTokenDelivery({
      persist,
      book,
      mailWrite: immediate,
      database: immediate,
    });
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(false);
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(false);
    expect(book).not.toHaveBeenCalled();
    // If the first commit rolled back, retry returns a newly durable parcel instead.
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(true);
    expect(book).toHaveBeenCalledTimes(1);
  });
  it('retries definitely refused live booking but never blindly rebooks an existing receipt', async () => {
    const persist = vi.fn().mockResolvedValueOnce(parcel).mockResolvedValue(null);
    const book = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const deliver = createMembershipTokenDelivery({
      persist,
      book,
      mailWrite: immediate,
      database: immediate,
    });
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(false);
    expect(await deliver(7, recipient, 'receipt-1234567890')).toBe(true);
    expect(await deliver(8, { characterId: 14, name: 'Bob' }, 'previously-collected')).toBe(true);
    expect(book).toHaveBeenCalledTimes(2);
  });
  it('coalesces a receipt, rejects competing account work and caps realm queue depth', async () => {
    const release: Array<() => void> = [];
    const queued = vi.fn();
    const mailWrite = <T>(job: () => Promise<T>): Promise<T> => {
      queued();
      return new Promise<T>((resolve) => {
        release.push(() => {
          void job().then(resolve);
        });
      });
    };
    const deliver = createMembershipTokenDelivery({
      persist: async () => null,
      book: () => true,
      mailWrite,
      database: immediate,
    });
    const first = deliver(1, recipient, 'receipt-1234567890');
    expect(deliver(1, recipient, 'receipt-1234567890')).toBe(first);
    expect(await deliver(1, recipient, 'other-receipt')).toBe(false);
    const pending = [
      first,
      deliver(2, recipient, 'two'),
      deliver(3, recipient, 'three'),
      deliver(4, recipient, 'four'),
    ];
    expect(await deliver(5, recipient, 'five')).toBe(false);
    await Promise.resolve();
    expect(queued).toHaveBeenCalledTimes(4);
    for (const done of release) done();
    expect(await Promise.all(pending)).toEqual([true, true, true, true]);
  });
  it('expires waiting work without starting SQL and retains admission until the queue settles', async () => {
    vi.useFakeTimers();
    let start!: () => void;
    const mailWrite = <T>(job: () => Promise<T>) =>
      new Promise<T>((resolve) => {
        start = () => {
          void job().then(resolve);
        };
      });
    const persist = vi.fn(async () => null);
    const deliver = createMembershipTokenDelivery({
      persist,
      book: () => true,
      mailWrite,
      database: immediate,
    });
    const pending = deliver(7, recipient, 'receipt-1234567890');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(TOKEN_DELIVERY_QUEUE_WAIT_MS + 1);
    expect(await deliver(7, recipient, 'different-receipt')).toBe(false);
    start();
    expect(await pending).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
