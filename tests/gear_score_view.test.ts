import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemLevel } from '../src/sim/item_level';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import type { EquipSlot, ItemDef, ItemInstancePayload } from '../src/sim/types';
import { buildPaperdollView } from '../src/ui/char_view';
import { gearScore, wornItemLevel } from '../src/ui/gear_score_view';
import { itemLevelReadout } from '../src/ui/rift_band_tooltip';

const score = (equipment: Partial<Record<EquipSlot, string>>): number | null =>
  gearScore(buildPaperdollView(equipment, ITEMS));

const levelOf = (id: string): number => {
  const level = itemLevel(ITEMS[id]);
  if (level === undefined) throw new Error(`${id} has no item level`);
  return level;
};

// Any live two-hand weapon with an item level, for the one-vs-pair cases.
const TWO_HANDER = Object.values(ITEMS).find(
  (it: ItemDef) => it.kind === 'weapon' && it.hand === 'twohand' && itemLevel(it) !== undefined,
) as ItemDef;

describe('gear_score_view: Gearscore (average worn item level)', () => {
  it('is null with nothing worn', () => {
    expect(score({})).toBeNull();
  });

  it('is null when nothing worn has an item level', () => {
    expect(itemLevel(ITEMS.recruit_tunic)).toBeUndefined();
    expect(score({ chest: 'recruit_tunic' })).toBeNull();
  });

  it('a single piece is its own item level: empty slots never count', () => {
    expect(score({ legs: 'moonscorch_legs' })).toBe(levelOf('moonscorch_legs'));
  });

  it('averages only the pieces that have an item level', () => {
    const equipment = {
      chest: 'recruit_tunic',
      legs: 'moonscorch_legs',
      feet: 'thornhide_boots',
      waist: 'thornhide_cinch',
    };
    const levels = [
      levelOf('moonscorch_legs'),
      levelOf('thornhide_boots'),
      levelOf('thornhide_cinch'),
    ];
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    expect(score(equipment)).toBe(Math.round(avg * 10) / 10);
  });

  it('keeps one decimal', () => {
    // 35 + 31 + 31 = 97 over 3 = 32.33..., shown as 32.3.
    expect(levelOf('moonscorch_legs')).toBe(35);
    expect(levelOf('thornhide_boots')).toBe(31);
    expect(levelOf('thornhide_cinch')).toBe(31);
    expect(
      score({ legs: 'moonscorch_legs', feet: 'thornhide_boots', waist: 'thornhide_cinch' }),
    ).toBe(32.3);
  });

  it('a two-hander counts once; a dual-wielded pair of two-handers counts twice', () => {
    expect(TWO_HANDER).toBeDefined();
    const two = levelOf(TWO_HANDER.id);
    const legs = levelOf('moonscorch_legs');
    expect(score({ mainhand: TWO_HANDER.id, legs: 'moonscorch_legs' })).toBe(
      Math.round(((two + legs) / 2) * 10) / 10,
    );
    expect(
      score({ mainhand: TWO_HANDER.id, offhand: TWO_HANDER.id, legs: 'moonscorch_legs' }),
    ).toBe(Math.round(((2 * two + legs) / 3) * 10) / 10);
  });

  it('matches tooltip levels for quality, Perfected and Riftbound worn copies', () => {
    const band = createRiftGearInstance('gearscore', 'A', 'warrior', 1, 3);
    const equipment = {
      chest: 'crucible_str_mail_chest',
      legs: 'moonscorch_legs',
      ring1: band.itemId,
    } satisfies Partial<Record<EquipSlot, string>>;
    const instances: Partial<Record<EquipSlot, ItemInstancePayload>> = {
      chest: { perfected: true },
      legs: { lootQuality: { version: 1, tier: 2, weights: [500, 200, 300, 400, 100] } },
      ring1: band.instance,
    };
    // Read tooltip levels from the original copies, before the paperdoll's
    // worn-payload projection, so dropping any earned-level field is caught.
    const levels = (['chest', 'legs', 'ring1'] as const).map(
      (slot) => itemLevelReadout(ITEMS[equipment[slot]], instances[slot])?.level,
    );
    expect(levels).toEqual([38, 39, 29]);
    const view = buildPaperdollView(equipment, ITEMS, instances);
    expect(gearScore(view)).toBe(35.3);
    expect(gearScore(view)).not.toBe(gearScore(buildPaperdollView(equipment, ITEMS)));
  });

  it('reads the worn copy level the tooltip prints', () => {
    expect(wornItemLevel(ITEMS.moonscorch_legs)).toBe(levelOf('moonscorch_legs'));
    expect(wornItemLevel(ITEMS.recruit_tunic)).toBeUndefined();
  });
});
