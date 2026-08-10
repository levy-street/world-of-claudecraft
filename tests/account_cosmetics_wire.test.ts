// The account cosmetics self-snapshot decoder (src/net/account_cosmetics_wire.ts):
// undefined/malformed input yields all-empty defaults, and a well-formed payload
// passes real entries through while filtering out anything the wrong shape.
import { describe, expect, it } from 'vitest';

import { normalizeAccountCosmetics } from '../src/net/account_cosmetics_wire';

describe('normalizeAccountCosmetics', () => {
  it('returns all-empty defaults for undefined', () => {
    expect(normalizeAccountCosmetics(undefined)).toEqual({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });
  });

  it('returns all-empty defaults for an empty object', () => {
    expect(normalizeAccountCosmetics({})).toEqual({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });
  });

  it('passes through well-formed id arrays and filters non-string entries', () => {
    const result = normalizeAccountCosmetics({
      completedQuestIds: ['quest_a', 'quest_b', 7, null],
      mechChromaIds: ['chroma_red', 42, 'chroma_blue'],
      weaponSkinIds: ['skin_gold', false, 'skin_shadow'],
    });
    expect(result.completedQuestIds).toEqual(['quest_a', 'quest_b']);
    expect(result.mechChromaIds).toEqual(['chroma_red', 'chroma_blue']);
    expect(result.weaponSkinIds).toEqual(['skin_gold', 'skin_shadow']);
  });

  it('keeps only string, non-empty-string values in weaponSkinLoadout', () => {
    const result = normalizeAccountCosmetics({
      weaponSkinLoadout: {
        sword: 'skin_gold',
        axe: '',
        mace: 12,
        bow: null,
        staff: 'skin_shadow',
      },
    });
    expect(result.weaponSkinLoadout).toEqual({
      sword: 'skin_gold',
      staff: 'skin_shadow',
    });
  });
});
