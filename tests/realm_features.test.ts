import { describe, expect, it } from 'vitest';

import { computeRealmFeatures, type RealmFeatures } from '../server/realm_features';

const ALL_OFF: RealmFeatures = {
  casino: false,
  wagering: false,
  dexSwap: false,
  trade: false,
  slots: false,
  packs: false,
  hilo: false,
  sportsbook: false,
};

describe('computeRealmFeatures', () => {
  it('is all-off on a normal realm (no p2w flag, no env)', () => {
    expect(computeRealmFeatures({}, [])).toEqual(ALL_OFF);
    // Even a stray casino env cannot arm features on a non-p2w realm.
    expect(computeRealmFeatures({ RIVERBOAT_CASINO_ENABLED: '1' }, ['web'])).toEqual(ALL_OFF);
  });

  it('arms only the casino master with the flag + env, sub-features still off', () => {
    const f = computeRealmFeatures({ RIVERBOAT_CASINO_ENABLED: '1' }, ['p2w']);
    expect(f.casino).toBe(true);
    expect(f.wagering).toBe(false);
    expect(f.slots).toBe(false);
    expect(f.sportsbook).toBe(false);
  });

  it('every sub-feature requires BOTH the casino master and its own flag', () => {
    // Sub-flags set but casino master off: all sub-features stay off.
    const noMaster = computeRealmFeatures(
      {
        WOC_ARENA_WAGER_ENABLED: '1',
        WOC_DEX_SWAP_ENABLED: '1',
        WOC_TRADE_ENABLED: '1',
        SPIN_ENABLED: '1',
        PACKS_ENABLED: '1',
        RIVERBOAT_HILO_ENABLED: '1',
        SPORTSBOOK_ENABLED: '1',
      },
      ['p2w'],
    );
    expect(noMaster).toEqual(ALL_OFF);

    // Master on + all sub-flags on: every feature true.
    const all = computeRealmFeatures(
      {
        RIVERBOAT_CASINO_ENABLED: '1',
        WOC_ARENA_WAGER_ENABLED: '1',
        WOC_DEX_SWAP_ENABLED: '1',
        WOC_TRADE_ENABLED: '1',
        SPIN_ENABLED: '1',
        PACKS_ENABLED: '1',
        RIVERBOAT_HILO_ENABLED: '1',
        SPORTSBOOK_ENABLED: '1',
      },
      ['p2w'],
    );
    expect(all).toEqual({
      casino: true,
      wagering: true,
      dexSwap: true,
      trade: true,
      slots: true,
      packs: true,
      hilo: true,
      sportsbook: true,
    });
  });

  it('treats any value other than "1" as off (fail-closed)', () => {
    expect(computeRealmFeatures({ RIVERBOAT_CASINO_ENABLED: 'true' }, ['p2w']).casino).toBe(false);
    expect(computeRealmFeatures({ RIVERBOAT_CASINO_ENABLED: '0' }, ['p2w']).casino).toBe(false);
    expect(computeRealmFeatures({ RIVERBOAT_CASINO_ENABLED: ' 1 ' }, ['p2w']).casino).toBe(true);
  });
});
