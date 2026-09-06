// The single-pending inspectCorpseHarvest transport
// (src/net/corpse_harvest_info_request.ts): one specialized pending read per
// CorpseHarvestInfoRequest instance, correlated on both `id` and `rid`.

import { describe, expect, it, vi } from 'vitest';
import { CorpseHarvestInfoRequest } from '../src/net/corpse_harvest_info_request';
import type { CorpseHarvestInfo } from '../src/world_api';

function info(over: Partial<CorpseHarvestInfo> = {}): CorpseHarvestInfo {
  return {
    corpseId: 1,
    componentTags: [],
    preference: null,
    denial: null,
    reservation: null,
    tierBonus: 0,
    ...over,
  };
}

function replyFrame(id: number, rid: number, payload: CorpseHarvestInfo | null) {
  return { t: 'corpseHarvestInfo', id, rid, info: payload };
}

describe('CorpseHarvestInfoRequest', () => {
  it('sends one command per issue and resolves on the matching reply', async () => {
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
    const p = req.issue(7);
    expect(sent).toEqual([[7, 1]]);
    req.onReply(replyFrame(7, 1, info({ corpseId: 7 })));
    await expect(p).resolves.toEqual(info({ corpseId: 7 }));
  });

  it('the same subject while pending shares one promise and sends only once', () => {
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
    const p1 = req.issue(7);
    const p2 = req.issue(7);
    expect(p1).toBe(p2);
    expect(sent).toEqual([[7, 1]]);
  });

  it('a different subject supersedes the prior pending read and settles it null', async () => {
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
    const first = req.issue(7);
    const second = req.issue(8);
    expect(sent).toEqual([
      [7, 1],
      [8, 2],
    ]);
    await expect(first).resolves.toBeNull();

    req.onReply(replyFrame(8, 2, info({ corpseId: 8 })));
    await expect(second).resolves.toEqual(info({ corpseId: 8 }));
  });

  it('matches BOTH id and rid: a reply naming the right corpse but a stale rid is ignored', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    const p = req.issue(7);
    req.onReply(replyFrame(7, 999, info({ corpseId: 7 })));
    // Still pending: advance a task tick without resolving via a real timer.
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('matches BOTH id and rid: a reply with the right rid but the wrong id is ignored', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    req.issue(7);
    const second = req.issue(8); // rid 2, supersedes 7
    req.onReply(replyFrame(999, 2, info({ corpseId: 999 })));
    let settled = false;
    second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('ignores a late reply for a superseded subject even if it arrives after the new one settles', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    const first = req.issue(7);
    const second = req.issue(8);
    req.onReply(replyFrame(8, 2, info({ corpseId: 8 })));
    await expect(second).resolves.toEqual(info({ corpseId: 8 }));
    // The late rid-1 reply must not resolve anything a second time or throw.
    expect(() => req.onReply(replyFrame(7, 1, info({ corpseId: 7 })))).not.toThrow();
    await expect(first).resolves.toBeNull();
  });

  it('a malformed frame is ignored (no state change, no resolution)', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    const p = req.issue(7);
    req.onReply({ t: 'corpseHarvestInfo', id: 7, rid: 1, info: { corpseId: 'nope' } });
    req.onReply(null);
    req.onReply(42);
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // A real, matching reply afterwards still resolves normally.
    req.onReply(replyFrame(7, 1, info({ corpseId: 7 })));
    await expect(p).resolves.toEqual(info({ corpseId: 7 }));
  });

  it('a synchronous send throw rejects with the EXACT thrown value and leaves a clean pending state', async () => {
    let shouldThrow = true;
    const thrown = { reason: 'transport' };
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => {
      sent.push([id, rid]);
      if (shouldThrow) throw thrown;
    });
    const p = req.issue(7);
    await expect(p).rejects.toBe(thrown); // identity, never wrapped into an Error

    // Clean state on the SAME instance: a follow-up issue for the same id
    // sends again (a fresh rid) rather than being treated as still-pending.
    shouldThrow = false;
    req.issue(7);
    expect(sent).toEqual([
      [7, 1],
      [7, 2],
    ]);
  });

  it('a synchronous send throw after a synchronous reply resolves with the real answer, not a rejection', async () => {
    const req = new CorpseHarvestInfoRequest((id, rid) => {
      req.onReply(replyFrame(id, rid, info({ corpseId: id })));
      throw new Error('boom-after-reply');
    });
    await expect(req.issue(7)).resolves.toEqual(info({ corpseId: 7 }));
  });

  it('a send throw with a reentrant SAME-subject issue() shares the one promise, rejected with the exact thrown value', async () => {
    const thrown = { reason: 'transport' };
    let nested: Promise<CorpseHarvestInfo | null> | undefined;
    const req = new CorpseHarvestInfoRequest((id) => {
      nested = req.issue(id); // same subject: shares the already-installed pending
      throw thrown;
    });
    const outer = req.issue(7);
    expect(outer).toBe(nested);
    const results = await Promise.allSettled([outer, nested as Promise<CorpseHarvestInfo | null>]);
    expect(results[0]).toEqual({ status: 'rejected', reason: thrown });
    expect(results[1]).toEqual({ status: 'rejected', reason: thrown });
  });

  it("a throw after a reentrant DIFFERENT-subject issue() never wipes the new subject's pending", async () => {
    let reentered = false;
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => {
      sent.push([id, rid]);
      if (id === 7 && !reentered) {
        reentered = true;
        req.issue(99); // a genuinely different subject: supersedes id 7 now
        throw new Error('boom-after-supersede');
      }
    });
    const first = req.issue(7);
    await expect(first).resolves.toBeNull(); // superseded, settled null, never rejected

    // The reentrant id-99 pending must be intact: same instance shares it
    // (no second send), and a real reply still resolves it normally.
    const shared = req.issue(99);
    expect(sent).toEqual([
      [7, 1],
      [99, 2],
    ]);
    req.onReply(replyFrame(99, 2, info({ corpseId: 99 })));
    await expect(shared).resolves.toEqual(info({ corpseId: 99 }));
  });

  it('times out after 5 seconds and settles null, clearing pending state', async () => {
    vi.useFakeTimers();
    try {
      const req = new CorpseHarvestInfoRequest(() => {});
      const p = req.issue(7);
      vi.advanceTimersByTime(5000);
      await expect(p).resolves.toBeNull();

      // Pending is clear: a fresh issue for the same id sends again.
      const sent: Array<[number, number]> = [];
      const req2 = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
      req2.issue(9);
      vi.advanceTimersByTime(4999);
      expect(sent).toEqual([[9, 1]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a reply arriving right at the timeout boundary still resolves with the real answer', async () => {
    vi.useFakeTimers();
    try {
      const req = new CorpseHarvestInfoRequest(() => {});
      const p = req.issue(7);
      vi.advanceTimersByTime(4999);
      req.onReply(replyFrame(7, 1, info({ corpseId: 7 })));
      vi.advanceTimersByTime(1);
      await expect(p).resolves.toEqual(info({ corpseId: 7 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset() settles any pending read null and clears state', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    const p = req.issue(7);
    req.reset();
    await expect(p).resolves.toBeNull();

    const sent: Array<[number, number]> = [];
    const req2 = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
    req2.reset(); // repeated/no-pending reset is a safe no-op
    req2.reset();
    req2.issue(3);
    expect(sent).toEqual([[3, 1]]);
  });

  it('repeated reset with nothing pending never throws and never double-resolves', async () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    const p = req.issue(7);
    req.reset();
    expect(() => req.reset()).not.toThrow();
    expect(() => req.reset()).not.toThrow();
    await expect(p).resolves.toBeNull();
  });

  it('with no pending request, onReply of any frame is a harmless no-op', () => {
    const req = new CorpseHarvestInfoRequest(() => {});
    expect(() => req.onReply(replyFrame(1, 1, info()))).not.toThrow();
  });

  it('wraps rid safely before Number.MAX_SAFE_INTEGER rather than overflowing', () => {
    const sent: number[] = [];
    const req = new CorpseHarvestInfoRequest((_id, rid) => sent.push(rid));
    (req as unknown as { nextRid: number }).nextRid = Number.MAX_SAFE_INTEGER;
    req.issue(7);
    req.reset();
    req.issue(8);
    expect(sent).toEqual([Number.MAX_SAFE_INTEGER, 1]);
    expect(sent.every(Number.isSafeInteger)).toBe(true);
  });

  it('never resets the rid counter on reset(), so a stale rid cannot match a fresh read', () => {
    const sent: number[] = [];
    const req = new CorpseHarvestInfoRequest((_id, rid) => sent.push(rid));
    req.issue(7);
    req.reset();
    req.issue(8);
    req.reset();
    req.issue(9);
    expect(sent).toEqual([1, 2, 3]);
  });

  it('issues fresh incrementing rids across independent (non-overlapping) requests', () => {
    const sent: Array<[number, number]> = [];
    const req = new CorpseHarvestInfoRequest((id, rid) => sent.push([id, rid]));
    req.issue(7);
    req.onReply(replyFrame(7, 1, info({ corpseId: 7 })));
    req.issue(8);
    req.onReply(replyFrame(8, 2, info({ corpseId: 8 })));
    req.issue(9);
    expect(sent).toEqual([
      [7, 1],
      [8, 2],
      [9, 3],
    ]);
  });
});
