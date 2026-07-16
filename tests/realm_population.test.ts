import { describe, expect, it } from 'vitest';
import { realmPopulation } from '../src/net/realm_population';

// The realm-picker population banding: pure keys + CSS class, no rendered text.
// Every literal key ('realm.full', 'realm.popTipFull', ...) and the CSS class are
// pinned as literals so a silent reword of a band or a shifted edge reds here.
describe('realmPopulation', () => {
  it('an offline realm is offline regardless of players or cap', () => {
    // Offline wins first: even a stale count at or past the cap stays offline, and
    // a disabled cap (0) does not change that.
    expect(realmPopulation(false, 999, 5)).toEqual({
      labelKey: 'realm.offline',
      tipKey: 'realm.popTipOffline',
      cls: 'offline',
    });
    expect(realmPopulation(false, 0, 0)).toEqual({
      labelKey: 'realm.offline',
      tipKey: 'realm.popTipOffline',
      cls: 'offline',
    });
  });

  it('a live realm at or over its cap is Full', () => {
    // players === cap is the refusal point.
    expect(realmPopulation(true, 5, 5)).toEqual({
      labelKey: 'realm.full',
      tipKey: 'realm.popTipFull',
      cls: 'full',
    });
    // Strictly over the cap is also Full.
    expect(realmPopulation(true, 6, 5)).toEqual({
      labelKey: 'realm.full',
      tipKey: 'realm.popTipFull',
      cls: 'full',
    });
  });

  it('one below the cap falls through to the normal bands, never Full', () => {
    // cap 5, players 4: below the refusal point, so the ordinary count bands
    // decide (4 < 15 -> low), never a Full at four players.
    expect(realmPopulation(true, 4, 5)).toEqual({
      labelKey: 'realm.low',
      tipKey: 'realm.popTipLow',
      cls: 'low',
    });
  });

  it('a disabled cap (0) never reports Full, even at a large count', () => {
    // cap 0 removes the refusal point: a busy realm is High, never a misleading Full.
    expect(realmPopulation(true, 999, 0)).toEqual({
      labelKey: 'realm.high',
      tipKey: 'realm.popTipHigh',
      cls: 'high',
    });
  });

  it('bands normally below a positive cap: the cap only adds the Full refusal point', () => {
    // cap 100: counts below it band exactly as the cap-disabled table does, so a
    // configured cap never shifts the High/Medium/Low edges.
    expect(realmPopulation(true, 85, 100)).toEqual({
      labelKey: 'realm.high',
      tipKey: 'realm.popTipHigh',
      cls: 'high',
    });
    expect(realmPopulation(true, 50, 100)).toEqual({
      labelKey: 'realm.medium',
      tipKey: 'realm.popTipMedium',
      cls: 'med',
    });
    expect(realmPopulation(true, 10, 100)).toEqual({
      labelKey: 'realm.low',
      tipKey: 'realm.popTipLow',
      cls: 'low',
    });
  });

  it('bands the count when the cap is disabled: high >= 80, medium >= 15, else low', () => {
    const band = (players: number) => realmPopulation(true, players, 0);
    // High band opens at exactly 80 (79 is still Medium).
    expect(band(80)).toEqual({ labelKey: 'realm.high', tipKey: 'realm.popTipHigh', cls: 'high' });
    expect(band(79)).toEqual({
      labelKey: 'realm.medium',
      tipKey: 'realm.popTipMedium',
      cls: 'med',
    });
    // Medium band opens at exactly 15 (14 is still Low).
    expect(band(15)).toEqual({
      labelKey: 'realm.medium',
      tipKey: 'realm.popTipMedium',
      cls: 'med',
    });
    expect(band(14)).toEqual({ labelKey: 'realm.low', tipKey: 'realm.popTipLow', cls: 'low' });
    // The low floor.
    expect(band(0)).toEqual({ labelKey: 'realm.low', tipKey: 'realm.popTipLow', cls: 'low' });
  });
});
