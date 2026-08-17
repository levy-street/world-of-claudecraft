import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/moderation_db', () => ({
  accountCheaterMarkSeconds: vi.fn(async () => 0),
  burnAccountCheaterMark: vi.fn(async () => {}),
}));

import {
  applyCheaterMarkLive,
  type CheaterMarkSession,
  persistCheaterMark,
  refreshCheaterMark,
} from '../../server/cheater_mark_runtime';
import { accountCheaterMarkSeconds, burnAccountCheaterMark } from '../../server/moderation_db';
import { CHEATER_MARK_AURA_ID } from '../../src/sim/moderation';

// The Cheater mark's server runtime, extracted from server/game.ts behind
// structural views so these behaviors are pinned directly: the live apply hits
// every session of the account, the join restore respects the leave-mid-fetch
// guard, and the per-save write-back is gated by the latch and keeps the LAST
// (zeroing) write.

function session(accountId: number, pid: number, cheaterMarked = false): CheaterMarkSession {
  return { accountId, pid, cheaterMarked };
}

function fakeSim() {
  return { setCheaterMark: vi.fn() };
}

beforeEach(() => {
  vi.mocked(accountCheaterMarkSeconds).mockReset().mockResolvedValue(0);
  vi.mocked(burnAccountCheaterMark).mockReset().mockResolvedValue(undefined);
});

describe('applyCheaterMarkLive', () => {
  it('marks every live session of the account and no one else', () => {
    const sim = fakeSim();
    const alt1 = session(41858, 7);
    const alt2 = session(41858, 9);
    const bystander = session(25817, 8);
    applyCheaterMarkLive([alt1, bystander, alt2], sim, 41858, 10800);
    expect(alt1.cheaterMarked).toBe(true);
    expect(alt2.cheaterMarked).toBe(true);
    expect(bystander.cheaterMarked).toBe(false);
    expect(sim.setCheaterMark.mock.calls).toEqual([
      [10800, 7],
      [10800, 9],
    ]);
  });

  it('latches even on a lift (seconds = 0) so the zeroing save still happens', () => {
    const sim = fakeSim();
    const live = session(41858, 7);
    applyCheaterMarkLive([live], sim, 41858, 0);
    expect(live.cheaterMarked).toBe(true);
    expect(sim.setCheaterMark).toHaveBeenCalledWith(0, 7);
  });
});

describe('refreshCheaterMark', () => {
  it('restores a positive budget onto the joining character and latches', async () => {
    vi.mocked(accountCheaterMarkSeconds).mockResolvedValue(7200);
    const sim = fakeSim();
    const joining = session(41858, 7);
    await refreshCheaterMark(joining, sim, () => true);
    expect(joining.cheaterMarked).toBe(true);
    expect(sim.setCheaterMark).toHaveBeenCalledWith(7200, 7);
  });

  it('does nothing for an unmarked account', async () => {
    const sim = fakeSim();
    const joining = session(41858, 7);
    await refreshCheaterMark(joining, sim, () => true);
    expect(joining.cheaterMarked).toBe(false);
    expect(sim.setCheaterMark).not.toHaveBeenCalled();
  });

  it('does nothing when the player left mid-fetch', async () => {
    vi.mocked(accountCheaterMarkSeconds).mockResolvedValue(7200);
    const sim = fakeSim();
    const gone = session(41858, 7);
    await refreshCheaterMark(gone, sim, () => false);
    expect(gone.cheaterMarked).toBe(false);
    expect(sim.setCheaterMark).not.toHaveBeenCalled();
  });

  it('evaluates the leave guard AFTER the row fetch, not before', async () => {
    // The guard exists for the player who disconnects DURING the db read, so a
    // regression that hoists it above the await passes a constant-closure test.
    // This one flips to "gone" only when the fetch resolves, so hoisting fails.
    let current = true;
    vi.mocked(accountCheaterMarkSeconds).mockImplementation(async () => {
      current = false;
      return 7200;
    });
    const sim = fakeSim();
    const leaving = session(41858, 7);
    await refreshCheaterMark(leaving, sim, () => current);
    expect(leaving.cheaterMarked).toBe(false);
    expect(sim.setCheaterMark).not.toHaveBeenCalled();
  });

  it('reads the row for the session account', async () => {
    vi.mocked(accountCheaterMarkSeconds).mockResolvedValue(60);
    await refreshCheaterMark(session(25817, 3), fakeSim(), () => true);
    expect(accountCheaterMarkSeconds).toHaveBeenCalledWith(25817);
  });
});

describe('persistCheaterMark', () => {
  it('costs an unmarked session zero writes', async () => {
    await persistCheaterMark(session(41858, 7, false), []);
    expect(burnAccountCheaterMark).not.toHaveBeenCalled();
  });

  it('burns the floored live-aura remainder and keeps the latch while serving', async () => {
    const marked = session(41858, 7, true);
    // The decoy pins the find-by-id: matching auras[0] instead would burn 999.
    await persistCheaterMark(marked, [
      { id: 'regen', remaining: 999 },
      { id: CHEATER_MARK_AURA_ID, remaining: 5400.9 },
    ]);
    expect(burnAccountCheaterMark).toHaveBeenCalledWith(41858, 5400);
    expect(marked.cheaterMarked).toBe(true);
  });

  it('clamps a non-positive live remainder to the zeroing write and clears the latch', async () => {
    const edge = session(41858, 7, true);
    await persistCheaterMark(edge, [{ id: CHEATER_MARK_AURA_ID, remaining: -3 }]);
    expect(burnAccountCheaterMark).toHaveBeenCalledWith(41858, 0);
    expect(edge.cheaterMarked).toBe(false);
  });

  it('burns 0 and clears the latch once the aura is gone (the zeroing write)', async () => {
    const served = session(41858, 7, true);
    await persistCheaterMark(served, []);
    expect(burnAccountCheaterMark).toHaveBeenCalledWith(41858, 0);
    expect(served.cheaterMarked).toBe(false);
  });

  it('skips the write entirely when there was no entity to read, keeping the latch', async () => {
    // The call site passes `entities.get(pid)?.auras`, so a save that lands
    // while the character is not in the sim hands this undefined. That is
    // absence of EVIDENCE, not a served sanction: collapsing it onto the empty
    // list above would zero a live budget off a read that never happened.
    const offSim = session(41858, 7, true);
    await persistCheaterMark(offSim, undefined);
    expect(burnAccountCheaterMark).not.toHaveBeenCalled();
    expect(offSim.cheaterMarked).toBe(true);
  });

  it('keeps the two absent-aura meanings distinct on the SAME session', async () => {
    // Pinned together so a regression that re-merges the cases cannot pass by
    // satisfying one of them: the undefined save writes nothing and holds the
    // latch, and the very next save with a real (empty) list does the zeroing.
    const marked = session(41858, 7, true);
    await persistCheaterMark(marked, undefined);
    expect(burnAccountCheaterMark).not.toHaveBeenCalled();
    expect(marked.cheaterMarked).toBe(true);
    await persistCheaterMark(marked, []);
    expect(burnAccountCheaterMark).toHaveBeenCalledTimes(1);
    expect(burnAccountCheaterMark).toHaveBeenCalledWith(41858, 0);
    expect(marked.cheaterMarked).toBe(false);
  });

  it('swallows a write-back failure instead of failing the save', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(burnAccountCheaterMark).mockRejectedValue(new Error('pg down'));
    const marked = session(41858, 7, true);
    await expect(
      persistCheaterMark(marked, [{ id: CHEATER_MARK_AURA_ID, remaining: 60 }]),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('keeps the latch when the ZEROING write fails, so the next save retries it', async () => {
    // The latch is what gates the write-back at all. Clearing it before the
    // burn resolved meant one transient failure on the final write disabled
    // every later save's write-back, and the next login restored a budget the
    // player had already served.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(burnAccountCheaterMark).mockRejectedValueOnce(new Error('pg down'));
    const served = session(41858, 7, true);

    await persistCheaterMark(served, []);
    expect(served.cheaterMarked).toBe(true);

    // The retry on the next save succeeds, and only THEN does the latch release.
    await persistCheaterMark(served, []);
    expect(burnAccountCheaterMark).toHaveBeenCalledTimes(2);
    expect(served.cheaterMarked).toBe(false);
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });
});
