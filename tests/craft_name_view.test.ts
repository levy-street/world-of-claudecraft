// The shared craft display-name table (src/ui/craft_name_view.ts): every
// craft id on the ring resolves to a real hudChrome.craftName.* key, so no
// surface that names a craft (char_window skill rows, the Used-by tooltip
// line) can ever leak a raw snake_case id into player-visible text. A new
// CRAFT_RING entry without a matching key fails here, not in a tooltip.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { CRAFT_NAME_KEYS, craftNameKey, craftNameText } from '../src/ui/craft_name_view';

describe('craft_name_view', () => {
  it('covers every CRAFT_RING id, with no stale extras', () => {
    const ringIds = CRAFT_RING.map((craft) => craft.id).sort();
    expect(Object.keys(CRAFT_NAME_KEYS).sort()).toEqual(ringIds);
    for (const craft of CRAFT_RING) {
      expect(craftNameKey(craft.id), craft.id).toBe(`hudChrome.craftName.${craft.id}`);
    }
  });

  it('renders a real display name for every ring craft, never the raw id', () => {
    for (const craft of CRAFT_RING) {
      const name = craftNameText(craft.id);
      expect(name, craft.id).not.toBe(craft.id);
      expect(name.length, craft.id).toBeGreaterThan(0);
    }
    // The English exemplar, so the arm is not satisfied by any non-empty junk.
    expect(craftNameText('leatherworking')).toBe('Leatherworking');
  });

  it('off-ring and null ids fall back safely', () => {
    expect(craftNameKey('blacksmithing')).toBeUndefined();
    expect(craftNameKey('mining')).toBeUndefined();
    // craftNameText keeps the shared "none" copy for null/unknown, and it is
    // localized text, never the raw input id.
    expect(craftNameText(null)).toBe(craftNameText('blacksmithing'));
    expect(craftNameText('blacksmithing')).not.toBe('blacksmithing');
  });
});
