import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/buddy_grants_db', () => ({
  takePendingBuddyGrants: vi.fn(async () => []),
  queueBuddyGrant: vi.fn(async () => {}),
}));

import { takePendingBuddyGrants } from '../server/buddy_grants_db';
import {
  applyBuddyGrantToSim,
  buddyGrantBodyError,
  dispatchBuddyCommand,
  drainPendingBuddyGrants,
  emitBuddySelfKeys,
} from '../server/buddy_wire';
import { decodeBuddySelf, emptyBuddySelfMirror } from '../src/net/buddy_wire';

function fakeSim() {
  return {
    ownedBuddiesFor: vi.fn(() => ['stag']),
    ownedBuddyCosmeticsFor: vi.fn(() => ['stag_gilded']),
    equippedBuddyCosmeticsFor: vi.fn(() => ({ stag: 'stag_gilded' })),
    pendingBuddiesFor: vi.fn(() => []),
    toggleBuddyFor: vi.fn(() => true),
    summonBuddyFor: vi.fn(() => true),
    equipBuddyCosmeticFor: vi.fn(() => true),
    setBuddyAutolootFor: vi.fn(() => true),
    grantBuddyFor: vi.fn(() => true),
    grantBuddyCosmeticFor: vi.fn(() => false),
    players: new Map([[7, { characterId: 42 }]]),
  };
}

describe('client mirror decode (src/net/buddy_wire.ts)', () => {
  it('keeps the prior mirror when none of the four keys is present', () => {
    const prev = emptyBuddySelfMirror();
    expect(decodeBuddySelf({ inv: [] }, prev)).toBe(prev);
  });

  it('decodes each key through the catalog and keeps the others', () => {
    const one = decodeBuddySelf({ budOwn: ['stag', 'nope'] }, emptyBuddySelfMirror());
    expect(one.owned).toEqual(['stag']);
    const two = decodeBuddySelf(
      { budCos: ['stag_gilded', 3], budEq: { stag: 'stag_gilded', bogus: 'x', moss_hare: 4 } },
      one,
    );
    expect(two.owned).toEqual(['stag']);
    expect(two.cosmetics).toEqual(['stag_gilded']);
    expect(two.equipped).toEqual({ stag: 'stag_gilded' });
    const three = decodeBuddySelf({ budPend: ['phantom'] }, two);
    expect(three.pending).toEqual(['phantom']);
    expect(three.equipped).toEqual({ stag: 'stag_gilded' });
  });
});

describe('server wire (server/buddy_wire.ts)', () => {
  it('emits the four self keys', () => {
    const sim = fakeSim();
    const maybe = vi.fn();
    emitBuddySelfKeys(sim as never, 7, maybe);
    expect(maybe.mock.calls.map((c) => c[0])).toEqual(['budOwn', 'budCos', 'budEq', 'budPend']);
    expect(maybe).toHaveBeenCalledWith('budEq', { stag: 'stag_gilded' });
  });

  it('dispatches each buddy command with its validated argument', () => {
    const sim = fakeSim();
    dispatchBuddyCommand(sim as never, 7, 'buddy_toggle', {});
    dispatchBuddyCommand(sim as never, 7, 'buddy_summon', { key: 'stag' });
    dispatchBuddyCommand(sim as never, 7, 'buddy_summon', { key: 4 });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', { key: 'stag', id: 'stag_gilded' });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', { key: 'stag', id: null });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', { key: 'stag', id: 9 });
    dispatchBuddyCommand(sim as never, 7, 'buddy_autoloot', { on: true });
    dispatchBuddyCommand(sim as never, 7, 'buddy_autoloot', { on: 'yes' });
    expect(sim.toggleBuddyFor).toHaveBeenCalledWith(7);
    expect(sim.summonBuddyFor).toHaveBeenCalledTimes(1);
    expect(sim.summonBuddyFor).toHaveBeenCalledWith(7, 'stag');
    expect(sim.equipBuddyCosmeticFor).toHaveBeenCalledTimes(2);
    expect(sim.equipBuddyCosmeticFor).toHaveBeenLastCalledWith(7, 'stag', null);
    expect(sim.setBuddyAutolootFor).toHaveBeenCalledTimes(1);
  });

  it('validates a grant body: exactly one known id', () => {
    expect(buddyGrantBodyError({})).toBeTruthy();
    expect(buddyGrantBodyError({ buddyKey: 'stag', cosmeticId: 'stag_gilded' })).toBeTruthy();
    expect(buddyGrantBodyError({ buddyKey: 'nope' })).toBe('unknown buddy key');
    expect(buddyGrantBodyError({ cosmeticId: 'nope' })).toBe('unknown cosmetic id');
    expect(buddyGrantBodyError({ buddyKey: 'stag' })).toBeNull();
    expect(buddyGrantBodyError({ cosmeticId: 'stag_gilded' })).toBeNull();
  });

  it('applies a grant through the sim entry points and reports already-owned', () => {
    const sim = fakeSim();
    expect(applyBuddyGrantToSim(sim as never, 7, { buddyKey: 'stag' })).toBe(true);
    expect(applyBuddyGrantToSim(sim as never, 7, { cosmeticId: 'stag_gilded' })).toBe(false);
    expect(applyBuddyGrantToSim(sim as never, 7, {})).toBe(false);
  });

  it('drains the offline queue at join and saves once when something landed', async () => {
    const sim = fakeSim();
    vi.mocked(takePendingBuddyGrants).mockResolvedValueOnce([
      { buddyKey: 'stag' },
      { cosmeticId: 'stag_gilded' },
    ]);
    const save = vi.fn(async () => true);
    await drainPendingBuddyGrants(sim as never, 7, 42, 'Owner', save);
    expect(sim.grantBuddyFor).toHaveBeenCalledWith(7, 'stag');
    expect(sim.grantBuddyCosmeticFor).toHaveBeenCalledWith(7, 'stag_gilded');
    expect(save).toHaveBeenCalledTimes(1);
    // Nothing queued: no save.
    save.mockClear();
    await drainPendingBuddyGrants(sim as never, 7, 42, 'Owner', save);
    expect(save).not.toHaveBeenCalled();
  });

  it('never applies a queued grant to a pid that no longer holds the character', async () => {
    const sim = fakeSim();
    vi.mocked(takePendingBuddyGrants).mockResolvedValueOnce([{ buddyKey: 'stag' }]);
    const save = vi.fn(async () => true);
    await drainPendingBuddyGrants(sim as never, 7, 43, 'Owner', save);
    expect(sim.grantBuddyFor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
