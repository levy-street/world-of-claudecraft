// The paired suite for server/craft_activity.ts, imported DIRECTLY.
//
// The module is the profession-moment Discord card emit (masterwork procs,
// legendary forgings, golden harvests), extracted from game.ts detectActivity
// as a move-not-rewrite. Until now it was covered only transitively, through
// tests/discord_activity_professions.test.ts driving a whole GameServer over a
// mocked db, so the module's own contract (the account-scoped key claimed
// SYNCHRONOUSLY ahead of the opt-out read, the fire-and-forget tail, the
// release-on-failure with the claim stamp) was never asserted at the seam that
// owns it, and a rewrite that kept the end-to-end card while moving the claim
// after the db read would have stayed green.
//
// Both collaborators are mocked at the module boundary rather than reached
// through a server rig: the point of this file is the ORDER and the ARGUMENTS
// craft_activity chooses, and a fake that records calls is the only thing that
// can see them.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimDedupeKey = vi.fn<(key: string, now: number) => boolean>();
const releaseDedupeKey = vi.fn<(key: string, claimedAt: number) => void>();
const enqueueActivity =
  vi.fn<(item: Record<string, unknown>, dedupeKey: string | null, now: number) => void>();
const getDeedBroadcasts = vi.fn<(accountId: number) => Promise<boolean>>();

vi.mock('../../server/discord_activity', () => ({
  claimDedupeKey: (key: string, now: number) => claimDedupeKey(key, now),
  releaseDedupeKey: (key: string, claimedAt: number) => releaseDedupeKey(key, claimedAt),
  enqueueActivity: (item: Record<string, unknown>, dedupeKey: string | null, now: number) =>
    enqueueActivity(item, dedupeKey, now),
}));
vi.mock('../../server/deeds_db', () => ({
  getDeedBroadcasts: (accountId: number) => getDeedBroadcasts(accountId),
}));

import { emitCraftActivityCard } from '../../server/craft_activity';

const NOW = 1_700_000_000_000;
const KINDS = ['masterwork', 'legendary', 'golden_harvest'] as const;

function emit(overrides: Partial<Parameters<typeof emitCraftActivityCard>[0]> = {}): void {
  emitCraftActivityCard({
    kind: 'masterwork',
    accountId: 41,
    name: 'Bronn',
    itemName: 'Duskforged Warblade',
    realm: 'eastbrook',
    now: NOW,
    profileUrlFor: (name: string) => `https://example.test/u/${name}`,
    ...overrides,
  });
}

/** Let the fire-and-forget `.then`/`.catch` tail run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  claimDedupeKey.mockReset().mockReturnValue(true);
  releaseDedupeKey.mockReset();
  enqueueActivity.mockReset();
  getDeedBroadcasts.mockReset().mockResolvedValue(true);
});

describe('emitCraftActivityCard', () => {
  it('claims an ACCOUNT-scoped key, and does so before any db read', async () => {
    emit();
    // The claim is synchronous: it has already happened on return, ahead of the
    // opt-out read, which is the whole reason the key is account-scoped rather
    // than per-proc. Asserted as an ORDER, not just a pair of counts.
    expect(claimDedupeKey).toHaveBeenCalledTimes(1);
    expect(claimDedupeKey).toHaveBeenCalledWith('masterwork:41', NOW);
    expect(
      claimDedupeKey.mock.invocationCallOrder[0],
      'the claim runs before the opt-out read',
    ).toBeLessThan(getDeedBroadcasts.mock.invocationCallOrder[0]);
    await settle();
    expect(getDeedBroadcasts).toHaveBeenCalledWith(41);
  });

  it('spends NO db read when the claim is refused', async () => {
    claimDedupeKey.mockReturnValue(false);
    emit();
    await settle();
    // The contract the account-scoped key buys: a repeat inside the TTL costs
    // token math, never one db read per proc.
    expect(getDeedBroadcasts).not.toHaveBeenCalled();
    expect(enqueueActivity).not.toHaveBeenCalled();
    expect(releaseDedupeKey).not.toHaveBeenCalled();
  });

  it('enqueues the card with the exact payload, and a NULL dedupe key', async () => {
    emit();
    await settle();
    expect(enqueueActivity).toHaveBeenCalledTimes(1);
    const [item, dedupeKey, now] = enqueueActivity.mock.calls[0];
    expect(item).toEqual({
      kind: 'masterwork',
      accountIds: [41],
      names: ['Bronn'],
      realm: 'eastbrook',
      profileUrl: 'https://example.test/u/Bronn',
      itemName: 'Duskforged Warblade',
    });
    // Null, because the moment already owns its TTL window through the claim
    // above: a second key here would dedupe the same moment twice.
    expect(dedupeKey, 'the enqueue carries no key of its own').toBeNull();
    expect(now).toBe(NOW);
  });

  it('resolves the profile url from the NAME, and carries a null through', async () => {
    const profileUrlFor = vi.fn((name: string) => (name === 'Bronn' ? '/p/bronn' : null));
    emit({ profileUrlFor });
    // Captured before the await, so the identity cannot move under the card.
    expect(profileUrlFor).toHaveBeenCalledWith('Bronn');
    expect(
      profileUrlFor.mock.invocationCallOrder[0],
      'the url is resolved before the opt-out read settles',
    ).toBeLessThan(getDeedBroadcasts.mock.invocationCallOrder[0]);
    await settle();
    expect(enqueueActivity.mock.calls[0][0].profileUrl).toBe('/p/bronn');

    enqueueActivity.mockClear();
    emit({ name: 'Unlinked', profileUrlFor });
    await settle();
    expect(enqueueActivity.mock.calls[0][0].profileUrl).toBeNull();
  });

  it('publishes NOTHING when the player has deed broadcasts off, and keeps the claim', async () => {
    getDeedBroadcasts.mockResolvedValue(false);
    emit();
    await settle();
    expect(enqueueActivity).not.toHaveBeenCalled();
    // The gate answered: the window was spent legitimately, so the claim stands
    // (releasing it would let the next proc pay another db read immediately).
    expect(releaseDedupeKey).not.toHaveBeenCalled();
  });

  it('RELEASES the claim with its own stamp when the opt-out read fails', async () => {
    const error = new Error('pool down');
    getDeedBroadcasts.mockRejectedValue(error);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    emit();
    await settle();
    expect(enqueueActivity).not.toHaveBeenCalled();
    // Same key, and the CLAIM STAMP rather than a fresh clock: a late rejection
    // must not delete a window a newer claimant owns.
    expect(releaseDedupeKey).toHaveBeenCalledTimes(1);
    expect(releaseDedupeKey).toHaveBeenCalledWith('masterwork:41', NOW);
    expect(logged).toHaveBeenCalledWith('masterwork activity failed:', error);
    logged.mockRestore();
  });

  it.each(KINDS)('%s: keys, gates and labels the card by its own kind', async (kind) => {
    emit({ kind });
    await settle();
    expect(claimDedupeKey).toHaveBeenCalledWith(`${kind}:41`, NOW);
    expect(enqueueActivity.mock.calls[0][0].kind).toBe(kind);
    // Every kind rides the SAME player-controllable gate: these moments repeat,
    // so none of them may publish to a third-party channel unasked.
    expect(getDeedBroadcasts).toHaveBeenCalledWith(41);
  });

  it.each(KINDS)('%s: releases under its own key when the read fails', async (kind) => {
    getDeedBroadcasts.mockRejectedValue(new Error('pool down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    emit({ kind });
    await settle();
    expect(releaseDedupeKey).toHaveBeenCalledWith(`${kind}:41`, NOW);
    expect(logged.mock.calls[0][0]).toBe(`${kind} activity failed:`);
    logged.mockRestore();
  });

  it('keys per ACCOUNT, so two crafters in the same moment each get a card', async () => {
    emit({ accountId: 41, name: 'Bronn' });
    emit({ accountId: 42, name: 'Sylla' });
    await settle();
    expect(claimDedupeKey.mock.calls.map(([key]) => key)).toEqual([
      'masterwork:41',
      'masterwork:42',
    ]);
    expect(enqueueActivity).toHaveBeenCalledTimes(2);
    expect(enqueueActivity.mock.calls.map(([item]) => item.accountIds)).toEqual([[41], [42]]);
  });
});
