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
  dispatchBuddyRename,
  drainPendingBuddyGrants,
  emitBuddySelfKeys,
} from '../server/buddy_wire';
import { decodeBuddySelf, emptyBuddySelfMirror } from '../src/net/buddy_wire';
import { bareClient } from './helpers/bare_client';

function fakeSim() {
  return {
    ownedBuddiesFor: vi.fn(() => ['crystal_lich']),
    ownedBuddyCosmeticsFor: vi.fn(() => ['crystal_lich_frostbound']),
    equippedBuddyCosmeticsFor: vi.fn(() => ({ crystal_lich: 'crystal_lich_frostbound' })),
    pendingBuddiesFor: vi.fn(() => []),
    toggleBuddyFor: vi.fn(() => true),
    summonBuddyFor: vi.fn(() => true),
    renameBuddyFor: vi.fn(() => true),
    equipBuddyCosmeticFor: vi.fn(() => true),
    setBuddyAutolootFor: vi.fn(() => true),
    grantBuddyFor: vi.fn(() => true),
    grantBuddyCosmeticFor: vi.fn(() => false),
    players: new Map([[7, { characterId: 42 }]]),
  };
}

describe('client mirror decode (src/net/buddy_wire.ts)', () => {
  it('keeps the prior mirror when neither active key is present', () => {
    const prev = emptyBuddySelfMirror();
    expect(decodeBuddySelf({ inv: [] }, prev)).toBe(prev);
  });

  it('decodes active keys through the catalog and keeps omitted state', () => {
    const one = decodeBuddySelf({ budOwn: ['crystal_lich', 'nope'] }, emptyBuddySelfMirror());
    expect(one.owned).toEqual(['crystal_lich']);
    const two = decodeBuddySelf(
      {
        budCos: ['crystal_lich_frostbound', 3],
        budEq: { crystal_lich: 'crystal_lich_frostbound', bogus: 'x', sapling: 4 },
      },
      one,
    );
    expect(two.owned).toEqual(['crystal_lich']);
    expect(two).toBe(one);
    expect(two).not.toHaveProperty('cosmetics');
    expect(two).not.toHaveProperty('equipped');
    const three = decodeBuddySelf({ budPend: ['forgemaw'] }, two);
    expect(three.pending).toEqual(['forgemaw']);
    expect(three.owned).toEqual(['crystal_lich']);
  });

  it('drops retired companions and looks from an older server snapshot', () => {
    const decoded = decodeBuddySelf(
      {
        budOwn: ['horse', 'stag', 'sapling'],
        budCos: ['crystal_lich_frostbound', 'stag_gilded'],
        budEq: {
          crystal_lich: 'crystal_lich_frostbound',
          stag: 'stag_gilded',
          horse: 'stag_gilded',
          forgemaw: 'crystal_lich_voltaic',
        },
        budPend: ['forgemaw', 'phantom'],
      },
      emptyBuddySelfMirror(),
    );
    expect(decoded.owned).toEqual(['horse']);
    expect(decoded).not.toHaveProperty('cosmetics');
    expect(decoded).not.toHaveProperty('equipped');
    expect(decoded.pending).toEqual(['forgemaw']);
  });
});

describe('server wire (server/buddy_wire.ts)', () => {
  it('emits only active collection keys without reading cosmetic state', () => {
    const sim = fakeSim();
    const maybe = vi.fn();
    emitBuddySelfKeys(sim as never, 7, maybe);
    expect(maybe.mock.calls.map((c) => c[0])).toEqual(['budOwn', 'budPend']);
    expect(sim.ownedBuddyCosmeticsFor).not.toHaveBeenCalled();
    expect(sim.equippedBuddyCosmeticsFor).not.toHaveBeenCalled();
  });

  it('dispatches each buddy command with its validated argument', () => {
    const sim = fakeSim();
    dispatchBuddyCommand(sim as never, 7, 'buddy_toggle', {});
    dispatchBuddyCommand(sim as never, 7, 'buddy_summon', { key: 'crystal_lich' });
    dispatchBuddyCommand(sim as never, 7, 'buddy_summon', { key: 4 });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', {
      key: 'crystal_lich',
      id: 'crystal_lich_frostbound',
    });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', { key: 'crystal_lich', id: null });
    dispatchBuddyCommand(sim as never, 7, 'buddy_cosmetic', { key: 'crystal_lich', id: 9 });
    dispatchBuddyCommand(sim as never, 7, 'buddy_autoloot', { on: true });
    dispatchBuddyCommand(sim as never, 7, 'buddy_autoloot', { on: 'yes' });
    expect(sim.toggleBuddyFor).not.toHaveBeenCalled();
    expect(sim.summonBuddyFor).toHaveBeenCalledTimes(1);
    expect(sim.summonBuddyFor).toHaveBeenCalledWith(7, 'crystal_lich');
    expect(sim.equipBuddyCosmeticFor).not.toHaveBeenCalled();
    expect(sim.setBuddyAutolootFor).toHaveBeenCalledTimes(1);
  });

  it('accepts only active buddy grants and refuses every cosmetic grant', () => {
    expect(buddyGrantBodyError({})).toBeTruthy();
    expect(
      buddyGrantBodyError({ buddyKey: 'crystal_lich', cosmeticId: 'crystal_lich_frostbound' }),
    ).toBeTruthy();
    expect(buddyGrantBodyError({ buddyKey: 'nope' })).toBe('unknown buddy key');
    expect(buddyGrantBodyError({ cosmeticId: 'nope' })).toBe('unknown cosmetic id');
    expect(buddyGrantBodyError({ buddyKey: 'stag' })).toBe('unknown buddy key');
    expect(buddyGrantBodyError({ cosmeticId: 'stag_gilded' })).toBe('unknown cosmetic id');
    expect(buddyGrantBodyError({ buddyKey: 'crystal_lich' })).toBeNull();
    expect(buddyGrantBodyError({ cosmeticId: 'crystal_lich_frostbound' })).toBe(
      'unknown cosmetic id',
    );
    expect(buddyGrantBodyError({ buddyKey: 'sapling' })).toBe('unknown buddy key');
    expect(buddyGrantBodyError({ buddyKey: 'horse', cosmeticId: null })).toBe(
      'unknown cosmetic id',
    );
  });

  it('applies a grant through the sim entry points and reports already-owned', () => {
    const sim = fakeSim();
    expect(applyBuddyGrantToSim(sim as never, 7, { buddyKey: 'crystal_lich' })).toBe(true);
    expect(applyBuddyGrantToSim(sim as never, 7, { cosmeticId: 'crystal_lich_frostbound' })).toBe(
      false,
    );
    expect(applyBuddyGrantToSim(sim as never, 7, {})).toBe(false);
    expect(applyBuddyGrantToSim(sim as never, 7, { buddyKey: 'horse', cosmeticId: 'old' })).toBe(
      false,
    );
    expect(sim.grantBuddyFor).toHaveBeenCalledTimes(1);
    expect(sim.grantBuddyCosmeticFor).not.toHaveBeenCalled();
  });

  it('drains the offline queue at join and saves once when something landed', async () => {
    const sim = fakeSim();
    vi.mocked(takePendingBuddyGrants).mockResolvedValueOnce([
      { buddyKey: 'crystal_lich' },
      { cosmeticId: 'crystal_lich_frostbound' },
    ]);
    const save = vi.fn(async () => true);
    await drainPendingBuddyGrants(sim as never, 7, 42, 'Owner', save);
    expect(sim.grantBuddyFor).toHaveBeenCalledWith(7, 'crystal_lich');
    expect(sim.grantBuddyCosmeticFor).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    // Nothing queued: no save.
    save.mockClear();
    await drainPendingBuddyGrants(sim as never, 7, 42, 'Owner', save);
    expect(save).not.toHaveBeenCalled();
  });

  it('ignores historical cosmetic-only queues without mutating or saving the character', async () => {
    const sim = fakeSim();
    vi.mocked(takePendingBuddyGrants).mockResolvedValueOnce([
      { cosmeticId: 'crystal_lich_frostbound' },
    ]);
    const save = vi.fn(async () => true);
    await drainPendingBuddyGrants(sim as never, 7, 42, 'Owner', save);
    expect(sim.grantBuddyFor).not.toHaveBeenCalled();
    expect(sim.grantBuddyCosmeticFor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('never applies a queued grant to a pid that no longer holds the character', async () => {
    const sim = fakeSim();
    vi.mocked(takePendingBuddyGrants).mockResolvedValueOnce([{ buddyKey: 'crystal_lich' }]);
    const save = vi.fn(async () => true);
    await drainPendingBuddyGrants(sim as never, 7, 43, 'Owner', save);
    expect(sim.grantBuddyFor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('buddy rename transport', () => {
  it('sends the clicked entity id and name without mutating the client mirror', () => {
    const cmd = vi.fn();
    const client = bareClient(7, { cmd });
    client.renameBuddy(12, 'Sparky');
    expect(cmd).toHaveBeenCalledExactlyOnceWith({ cmd: 'buddy_rename', id: 12, name: 'Sparky' });
    expect(client.ownedBuddies()).toEqual([]);
  });

  it('screens and dispatches the same normalized name to the authenticated player', () => {
    const sim = fakeSim();
    const screen = vi.fn(() => false);
    const reject = vi.fn();
    dispatchBuddyRename(sim as never, 7, { id: 12, name: '  Sparky  ', pid: 99 }, screen, reject);
    expect(screen).toHaveBeenCalledExactlyOnceWith('Sparky');
    expect(sim.renameBuddyFor).toHaveBeenCalledExactlyOnceWith(7, 12, 'Sparky');
    expect(reject).not.toHaveBeenCalled();
  });

  it('rejects offensive names before invoking the sim', () => {
    const sim = fakeSim();
    const screen = vi.fn(() => true);
    const reject = vi.fn();
    dispatchBuddyRename(sim as never, 7, { id: 12, name: 'Refused' }, screen, reject);
    expect(screen).toHaveBeenCalledExactlyOnceWith('Refused');
    expect(sim.renameBuddyFor).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledOnce();
  });

  it.each(['', 'A', 'A'.repeat(17), 'Rex123', '<script>', 'A'.repeat(16000)])(
    'skips costly screening for a malformed name and lets sim provide its refusal',
    (name) => {
      const sim = fakeSim();
      const screen = vi.fn(() => false);
      const reject = vi.fn();
      dispatchBuddyRename(sim as never, 7, { id: 12, name }, screen, reject);
      expect(screen).not.toHaveBeenCalled();
      expect(sim.renameBuddyFor).toHaveBeenCalledExactlyOnceWith(7, 12, name);
      expect(reject).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { id: 12 },
    { id: '12', name: 'Rex' },
    { id: 12, name: 1 },
    { id: 0, name: 'Rex' },
    { id: -1, name: 'Rex' },
    { id: 1.5, name: 'Rex' },
    { id: Number.NaN, name: 'Rex' },
    { id: Number.POSITIVE_INFINITY, name: 'Rex' },
    { id: Number.MAX_SAFE_INTEGER + 1, name: 'Rex' },
  ])('drops malformed wire fields before screening or sim dispatch', (msg) => {
    const sim = fakeSim();
    const screen = vi.fn(() => false);
    const reject = vi.fn();
    dispatchBuddyRename(sim as never, 7, msg, screen, reject);
    expect(screen).not.toHaveBeenCalled();
    expect(sim.renameBuddyFor).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });
});
