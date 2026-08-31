import { describe, expect, it } from 'vitest';
import { SET_PROC_FX_BY_NAME } from '../src/render/set_proc_fx';

describe('set-proc swirl color resolution', () => {
  // Arrange happens at module load: the map derives from ITEM_SETS plus
  // SET_ENGINE_BONUSES, so these pins prove both resolution walks ran.

  it('resolves the incumbent stat-set proc names to their themed colors', () => {
    // Act
    const clearcasting = SET_PROC_FX_BY_NAME.get('Clearcasting');

    // Assert: a legacy ITEM_SETS proc resolved through the display name.
    expect(clearcasting).toBe(0x8ed2ff);
  });

  it('resolves the Crucible engine-proc arm: the Creed instant hymn swirl', () => {
    // Act
    const hymn = SET_PROC_FX_BY_NAME.get('Scouring Hymn');

    // Assert: the SET_ENGINE_BONUSES walk wired the empowerNext proc, the
    // one Crucible proc that lands a named aura.
    expect(hymn).toBe(0xffc46b);
  });

  it('gives the aura-less cooldown-refund procs no swirl row', () => {
    // Assert: refund procs fire no aura event, so a row would be dead data;
    // absence here keeps the table honest.
    for (const name of [
      'Slagbreaker Momentum',
      'Forgewall Tempering',
      'Smolderstrike Rhythm',
      'Vesperash Communion',
    ]) {
      expect(SET_PROC_FX_BY_NAME.has(name), name).toBe(false);
    }
  });
});
