// The trophy skull's presentation (src/ui/item_copy_name_core.ts and the
// provenance rows in src/ui/item_instance_tooltip.ts): every skull shares one
// stack like a gathered material, and the stack says whose skulls it holds.
// A stack (or a body's single skull) naming exactly one victim reads
// "<victim>'s Skull"; a mixed stack reads "Trophy Skull" and lists each victim
// on its own tooltip row, "2 × Taken from Bet", the way a material lists its
// gatherers; a legendary's chosen name still wins everywhere.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { MaterialComposition } from '../src/sim/material_sources';
import { WORLD_PVP_SKULL_ITEM_ID } from '../src/sim/pvp';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { t } from '../src/ui/i18n';
import {
  itemCopyDisplayName,
  itemCopyOwnName,
  soleSkullVictim,
} from '../src/ui/item_copy_name_core';
import { materialMakersMarkLines, materialSourceLines } from '../src/ui/item_instance_tooltip';

const skull = ITEMS[WORLD_PVP_SKULL_ITEM_ID];
const from = (id: number, name: string, count: number) => ({
  source: { gatherer: { kind: 'character' as const, id, name } },
  count,
});
const onlyBet: MaterialComposition = [from(2, 'Bet', 2)];
const mixed: MaterialComposition = [from(2, 'Bet', 2), from(3, 'Gimel', 1)];

describe('the trophy skull stack name', () => {
  it("names a single-victim stack <victim>'s Skull and a mixed one Trophy Skull", () => {
    expect(t('hudChrome.worldPvp.skullName', { name: 'Bet' })).toBe("Bet's Skull");
    expect(soleSkullVictim(onlyBet)).toBe('Bet');
    expect(soleSkullVictim(mixed)).toBeNull();
    expect(soleSkullVictim(undefined)).toBeNull();
    expect(itemCopyDisplayName(skull, undefined, onlyBet)).toBe("Bet's Skull");
    expect(itemCopyDisplayName(skull, undefined, mixed)).toBe('Trophy Skull');
    expect(itemCopyOwnName(skull)).toBeNull();
    expect(itemDisplayName(skull)).toBe('Trophy Skull');
  });

  it('only the skull reads a victim out of its sources; a chosen legendary name wins', () => {
    const ore = Object.values(ITEMS).find((def) => def.kind === 'junk' && def.id !== skull.id)!;
    expect(itemCopyOwnName(ore, undefined, onlyBet)).toBeNull();
    const crafted = Object.values(ITEMS).find((def) => def.kind === 'armor')!;
    expect(itemCopyDisplayName(crafted, { name: 'Oathkeeper' })).toBe('Oathkeeper');
  });
});

describe('the skull provenance rows', () => {
  it('lists each victim as "Taken from", never "Collected by"', () => {
    const html = materialSourceLines(mixed, WORLD_PVP_SKULL_ITEM_ID);
    expect(html).toContain(
      t('hudChrome.itemTooltip.trophySkullSource', { count: '2', name: 'Bet' }),
    );
    expect(html).toContain(
      t('hudChrome.itemTooltip.trophySkullSource', { count: '1', name: 'Gimel' }),
    );
    expect(t('hudChrome.itemTooltip.trophySkullSource', { count: '2', name: 'Bet' })).toBe(
      '2 × Taken from Bet',
    );
    expect(html).not.toContain('Collected by');
    // The shared item card routes the skull through the same wording.
    expect(materialMakersMarkLines(skull, undefined, mixed)).toContain('Taken from Gimel');
  });

  it('a gathered material keeps its gatherer wording', () => {
    const html = materialSourceLines(onlyBet, 'copper_ore');
    expect(html).toContain('Collected by Bet');
    expect(html).not.toContain('Taken from');
  });
});
