// The disenchant confirm's expected-yield preview: it must model exactly what
// src/sim/professions/enchanting.ts resolveDisenchant grants, per quality arm.
// The pins below read the sim's own tables (DISENCHANT_MATERIAL_BY_QUALITY,
// typedSecondaryFor, baseDisenchantYield/maxDisenchantYield) so a tuning change
// on either side surfaces as a mismatch here rather than as a silently wrong
// promise in an irreversible confirm dialog.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { typedSecondaryFor } from '../src/sim/professions/disenchant_reagents';
import {
  baseDisenchantYield,
  DISENCHANT_MATERIAL_BY_QUALITY,
  isDisenchantable,
  maxDisenchantYield,
} from '../src/sim/professions/enchanting';
import type { ItemDef } from '../src/sim/types';
import { disenchantYieldLines, disenchantYieldPreview } from '../src/ui/disenchant_yield_view';

/** A live disenchantable def of the requested quality and kind, so every arm is
 *  exercised against real content rather than a fixture. */
function defFor(
  quality: NonNullable<ItemDef['quality']>,
  predicate: (def: ItemDef) => boolean = () => true,
): ItemDef {
  const found = Object.values(ITEMS).find(
    (def) => isDisenchantable(def) && def.quality === quality && predicate(def),
  );
  if (!found) throw new Error(`no disenchantable ${quality} def matching the predicate`);
  return found;
}

describe('disenchantYieldPreview', () => {
  it('returns null for an item that cannot be disenchanted at all', () => {
    expect(disenchantYieldPreview(ITEMS.arcane_dust)).toBeNull();
    expect(disenchantYieldPreview(undefined)).toBeNull();
  });

  it('a sub-rare piece previews a RANGE of the ladder material and no secondary', () => {
    for (const quality of ['common', 'uncommon'] as const) {
      const def = defFor(quality);
      const preview = disenchantYieldPreview(def);
      expect(preview?.primary.itemId).toBe(DISENCHANT_MATERIAL_BY_QUALITY[quality]);
      expect(preview?.primary.min).toBe(baseDisenchantYield(def));
      expect(preview?.primary.max).toBe(maxDisenchantYield(def));
      // The rng bonus is exactly +0 or +1, so the range always spans one unit.
      expect((preview?.primary.max ?? 0) - (preview?.primary.min ?? 0)).toBe(1);
      expect(preview?.secondary).toBeUndefined();
    }
  });

  it('a rare piece previews exactly one essence plus exactly one typed secondary', () => {
    const def = defFor('rare', (d) => typedSecondaryFor(d) !== null);
    const preview = disenchantYieldPreview(def);
    expect(preview?.primary).toEqual({ itemId: 'arcane_essence', min: 1, max: 1 });
    expect(preview?.secondary).toEqual({ itemId: typedSecondaryFor(def), min: 1, max: 1 });
  });

  it('an epic piece previews one shard plus one to two typed secondaries', () => {
    const def = defFor('epic', (d) => typedSecondaryFor(d) !== null);
    const preview = disenchantYieldPreview(def);
    expect(preview?.primary).toEqual({ itemId: 'arcane_shard', min: 1, max: 1 });
    expect(preview?.secondary).toEqual({ itemId: typedSecondaryFor(def), min: 1, max: 2 });
  });

  it('a rare+ piece with NO typed material (jewelry) previews the primary alone', () => {
    // Jewelry carries no armor class, so typedSecondaryFor returns null and the
    // preview must not promise a secondary. Live jewelry is epic-tier here.
    const def = defFor('epic', (d) => typedSecondaryFor(d) === null);
    expect(def.slot === 'ring' || def.slot === 'neck').toBe(true);
    const preview = disenchantYieldPreview(def);
    expect(preview?.primary).toEqual({ itemId: 'arcane_shard', min: 1, max: 1 });
    expect(preview?.secondary).toBeUndefined();
    expect(disenchantYieldLines(def).length).toBe(2);
  });

  it('names the same primary material the sim would grant, for every quality', () => {
    for (const quality of ['common', 'uncommon', 'rare', 'epic'] as const) {
      const def = defFor(quality);
      expect(disenchantYieldPreview(def)?.primary.itemId).toBe(
        DISENCHANT_MATERIAL_BY_QUALITY[quality],
      );
    }
  });
});

describe('disenchantYieldLines', () => {
  it('renders a header plus one localized line per material', () => {
    const def = defFor('rare', (d) => typedSecondaryFor(d) !== null);
    const lines = disenchantYieldLines(def);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('Expected materials:');
    expect(lines[1]).toBe('1 Chime Essence');
    // The typed secondary names its own material, so the player can tell a
    // Resonant Thread windfall from a Resonant Steel one before destroying.
    expect(lines[2]).toContain('1 ');
    expect(lines[2]).toContain('Resonant');
  });

  it('a sub-rare range reads as a range, not a single count', () => {
    const def = defFor('common');
    const lines = disenchantYieldLines(def);
    const preview = disenchantYieldPreview(def);
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(`${preview?.primary.min} to ${preview?.primary.max} Chime Dust`);
  });

  it('an epic secondary reads as the one-to-two range', () => {
    const def = defFor('epic', (d) => typedSecondaryFor(d) !== null);
    const lines = disenchantYieldLines(def);
    expect(lines[1]).toBe('1 Chime Shard');
    expect(lines[2]).toMatch(/^1 to 2 Resonant /);
  });

  it('renders nothing at all for a non-disenchantable item', () => {
    expect(disenchantYieldLines(ITEMS.arcane_dust)).toEqual([]);
  });
});
