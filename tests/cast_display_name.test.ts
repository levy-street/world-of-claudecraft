// The extracted cast-bar label resolver (src/ui/cast_display_name.ts, moved
// whole from hud.ts at the v0.38.0 fourteenth absorb). The painter suite
// exercises it incidentally; these arms pin the resolver ORDER directly: the
// named system casts, the rift mechanic keys, the ability catalog, then the
// raw id as the last resort.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import {
  CORPSE_HARVEST_CAST_ID,
  CRAFT_CAST_ID,
  FARMING_CAST_ID,
  FISHING_CAST_ID,
} from '../src/sim/types';
import { castDisplayName, targetCastDisplayLabel } from '../src/ui/cast_display_name';
import { t } from '../src/ui/i18n';

describe('castDisplayName', () => {
  it('maps the named system casts to their abilityUi keys', () => {
    expect(castDisplayName(FARMING_CAST_ID)).toBe(t('abilityUi.cast.farming'));
    expect(castDisplayName(FISHING_CAST_ID)).toBe(t('abilityUi.cast.fishing'));
    // The two labels must actually differ, or the arms above prove nothing.
    expect(castDisplayName(FARMING_CAST_ID)).not.toBe(castDisplayName(FISHING_CAST_ID));
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

describe('targetCastDisplayLabel (the #tf-castbar resolver)', () => {
  it('localizes exactly the farming cast (the Phase 14 discharge)', () => {
    expect(targetCastDisplayLabel(FARMING_CAST_ID)).toBe(t('abilityUi.cast.farming'));
    // Non-vacuity: the localized label is not the raw id, so the arm above
    // really proves a resolution happened.
    expect(targetCastDisplayLabel(FARMING_CAST_ID)).not.toBe(FARMING_CAST_ID);
  });

  it('keeps every other id raw, the deliberate pre-existing class boundary', () => {
    // The other trades' raw ids are the same pre-existing class the handoff
    // row scoped OUT (the class-wide fix is a maintainer call): pin the
    // boundary so a silent widening or narrowing is a deliberate edit here.
    expect(targetCastDisplayLabel(FISHING_CAST_ID)).toBe(FISHING_CAST_ID);
    expect(targetCastDisplayLabel(CRAFT_CAST_ID)).toBe(CRAFT_CAST_ID);
    // A REAL ability id stays raw too: the boundary is farming-only, not
    // "trades raw, abilities localized" (the widening a later reviewer would
    // actually reach for passes the two trade arms untouched).
    const abilityId = Object.keys(ABILITIES)[0];
    expect(abilityId).toBeTruthy();
    expect(targetCastDisplayLabel(abilityId)).toBe(abilityId);
    expect(targetCastDisplayLabel('no_such_cast_id_ever')).toBe('no_such_cast_id_ever');
  });
});
