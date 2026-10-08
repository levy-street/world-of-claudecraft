import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: {}, runWithStatementTimeout: vi.fn() }));

import {
  createReportRewardsDelivery,
  REPORT_REWARD_NOTICE,
  type ReportRewardsDb,
  type ReportRewardsHost,
} from '../server/report_rewards';
import { BOT_REPORT_REWARD_LETTER } from '../src/sim/content/letters';

function setup() {
  const row = { id: 1, accountId: 4, characterId: 9, name: 'Reporter' };
  let booked = false;
  let notified = false;
  let online = true;
  let full = false;
  const refs = new Set<string>();
  const db: ReportRewardsDb = {
    due: vi.fn(async () => (booked ? [] : [row])),
    claim: vi.fn(async () => {
      if (booked) return false;
      booked = true;
      return true;
    }),
    retry: vi.fn(async () => {}),
    notices: vi.fn(async (ids) => (!notified && ids.includes(4) ? [{ id: 1, accountId: 4 }] : [])),
    notified: vi.fn(async (ids) => {
      if (ids.includes(1)) notified = true;
    }),
  };
  const host: ReportRewardsHost = {
    book: {
      mailSystemParcel: vi.fn((_recipient, _letter, _items, ref) => {
        if (!booked) throw new Error('mail before durable claim');
        if (!ref || refs.has(ref)) return false;
        refs.add(ref);
        return true;
      }),
      hasCustodyParcel: (ref) => refs.has(ref),
    },
    canBook: () => !full,
    onlineAccounts: () => (online ? [4] : []),
    notice: vi.fn(() => online),
    measure: (work) => work(),
  };
  return {
    db,
    host,
    refs,
    delivery: createReportRewardsDelivery(db, host),
    setOnline: (value: boolean) => {
      online = value;
    },
    setFull: (value: boolean) => {
      full = value;
    },
  };
}

describe('successful report reward delivery', () => {
  it('pins the exact requested on-screen notice without punctuation', () => {
    expect(REPORT_REWARD_NOTICE).toBe('An account you reported has been banned');
  });
  it('books the attachment-free thank-you letter once and sends the exact notice', async () => {
    const f = setup();
    await f.delivery.poll();
    expect(f.host.book.mailSystemParcel).toHaveBeenCalledWith(
      { key: '9', name: 'Reporter' },
      BOT_REPORT_REWARD_LETTER,
      [],
      'report_reward:1',
    );
    expect(BOT_REPORT_REWARD_LETTER.copper).toBe(0);
    expect(BOT_REPORT_REWARD_LETTER.items ?? []).toEqual([]);
    expect(BOT_REPORT_REWARD_LETTER.body).toContain('Thank you for helping us keep the game fair.');
    expect(BOT_REPORT_REWARD_LETTER.body).not.toContain('gold');
    expect(f.host.notice).toHaveBeenCalledWith(4, REPORT_REWARD_NOTICE);
    f.refs.clear(); // Player collects and deletes the letter before another poll.
    await f.delivery.poll();
    expect(f.host.book.mailSystemParcel).toHaveBeenCalledTimes(1);
    expect(f.host.notice).toHaveBeenCalledTimes(1);
  });

  it('delivers offline mail while retaining the popup until the player returns', async () => {
    const f = setup();
    f.setOnline(false);
    await f.delivery.poll();
    expect(f.refs.size).toBe(1);
    expect(f.host.notice).not.toHaveBeenCalled();
    f.setOnline(true);
    await f.delivery.poll();
    expect(f.host.notice).toHaveBeenCalledTimes(1);
  });

  it('backs off a full mailbox without booking or losing its durable claim', async () => {
    const f = setup();
    f.setFull(true);
    await f.delivery.poll();
    expect(f.db.retry).toHaveBeenCalledWith([1]);
    expect(f.db.claim).not.toHaveBeenCalled();
    f.setFull(false);
    await f.delivery.poll();
    expect(f.refs.size).toBe(1);
  });

  it('never creates live mail after an ambiguous failed claim write', async () => {
    const f = setup();
    vi.mocked(f.db.claim).mockRejectedValue(new Error('connection lost'));
    await expect(f.delivery.poll()).rejects.toThrow('connection lost');
    expect(f.host.book.mailSystemParcel).not.toHaveBeenCalled();
  });

  it('shares one flight across overlapping delivery polls', async () => {
    const f = setup();
    const first = f.delivery.poll();
    const second = f.delivery.poll();
    expect(first).toBe(second);
    await first;
    expect(f.db.due).toHaveBeenCalledTimes(1);
  });

  it('retains an undeliverable popup when the socket disappeared after the query', async () => {
    const f = setup();
    vi.mocked(f.host.notice).mockReturnValue(false);
    await f.delivery.poll();
    expect(f.db.notified).toHaveBeenCalledWith([]);
  });

  it('starts immediately, waits between completed passes and stops its recurring work', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      f.delivery.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.db.due).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9999);
      expect(f.db.due).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.db.due).toHaveBeenCalledTimes(2);
      await f.delivery.stop();
      await vi.advanceTimersByTimeAsync(30000);
      expect(f.db.due).toHaveBeenCalledTimes(2);
    } finally {
      await f.delivery.stop();
      vi.useRealTimers();
    }
  });

  it('drains its in-flight database work before shutdown completes', async () => {
    const f = setup();
    let finish!: (rows: []) => void;
    vi.mocked(f.db.due).mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const flight = f.delivery.poll();
    const stopped = vi.fn();
    const drain = f.delivery.stop().then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    finish([]);
    await Promise.all([flight, drain]);
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});
