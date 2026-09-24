// The extracted cast-bar label resolver (src/ui/cast_display_name.ts, moved
// whole from hud.ts at the v0.38.0 fourteenth absorb). The painter suite
// exercises it incidentally; these arms pin the resolver ORDER directly: the
// named system casts, the rift mechanic keys, the ability catalog, then the
// raw id as the last resort.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { CORPSE_HARVEST_CAST_ID, CRAFT_CAST_ID, FISHING_CAST_ID } from '../src/sim/types';
import { castDisplayName, targetCastDisplayName } from '../src/ui/cast_display_name';
import { setLanguage, t } from '../src/ui/i18n';

describe('castDisplayName', () => {
  it('maps the named system casts to their abilityUi keys', () => {
    expect(castDisplayName(FISHING_CAST_ID)).toBe(t('abilityUi.cast.fishing'));
    expect(castDisplayName(CRAFT_CAST_ID)).toBe(t('abilityUi.cast.crafting'));
    // The two labels must actually differ, or the arms above prove nothing.
    expect(castDisplayName(FISHING_CAST_ID)).not.toBe(castDisplayName(CRAFT_CAST_ID));
  });

  it('has no farming arm: planting is instant and starts no cast (the farming-tools report)', () => {
    // The retired plant cast's id falls through to the raw-id arm like any
    // unknown id, so a stale wire token could never resurrect a label.
    expect(castDisplayName('farming')).toBe('farming');
  });

  it('reuses the existing "Harvest" label for the corpse-harvest cast, no new key', () => {
    expect(castDisplayName(CORPSE_HARVEST_CAST_ID)).toBe(t('hudChrome.corpseHarvest.title'));
    expect(castDisplayName(CORPSE_HARVEST_CAST_ID)).not.toBe(CORPSE_HARVEST_CAST_ID);
  });

  it('resolves a rift mechanic wind-up through its dedicated key', () => {
    expect(castDisplayName('rift_frost_execution')).toBe(t('abilityUi.cast.rift_frost_execution'));
  });

  it('falls through to the ability catalog, then to the raw id', () => {
    const abilityId = Object.keys(ABILITIES)[0];
    expect(abilityId).toBeTruthy();
    const label = castDisplayName(abilityId);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(castDisplayName('no_such_cast_id_ever')).toBe('no_such_cast_id_ever');
  });
});

describe('targetCastDisplayName (the target frame cast bar)', () => {
  it('names a cave boss wind-up instead of printing its raw cast id', () => {
    // A Deeprake or Voracious Chest wind-up reaches the target bar as a cast
    // ID, not an authored name: before this resolver the bar printed
    // "hoard_cast_mole_rake" while the overhead text read "Claw Rake".
    expect(targetCastDisplayName('hoard_cast_mole_rake')).toBe('Claw Rake');
    expect(targetCastDisplayName('hoard_cast_mimic_bite')).toBe('Voracious Bite');
    expect(targetCastDisplayName('hoard_cast_mole_rake')).toBe(
      castDisplayName('hoard_cast_mole_rake'),
    );
  });

  it('keeps resolving authored mechanic names through the ability matcher', () => {
    const ability = Object.values(ABILITIES)[0];
    expect(targetCastDisplayName(ability.name)).toBe(ability.name);
  });

  it('localizes the wind-up name with the language', async () => {
    const { ensureLocaleLoaded } = await import('../src/ui/i18n');
    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      expect(targetCastDisplayName('hoard_cast_mole_rake')).toBe(
        t('abilityUi.cast.hoard_cast_mole_rake'),
      );
      expect(targetCastDisplayName('hoard_cast_mole_rake')).not.toBe('hoard_cast_mole_rake');
    } finally {
      setLanguage('en');
    }
  });
});
