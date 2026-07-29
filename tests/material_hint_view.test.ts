// Purpose hints on the enchanting materials: the hint table is keyed on exactly
// the eight arcane/resonant ids and nothing else, every row resolves to real
// English, and the rendered line is the muted description style the tooltip's
// other def-driven use lines share.
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import {
  ARMOR_SECONDARY_BY_TYPE,
  TIMBER_WEAPON_TYPES,
} from '../src/sim/professions/disenchant_reagents';
import { DISENCHANT_MATERIAL_BY_QUALITY } from '../src/sim/professions/enchanting';
import {
  MATERIAL_HINT_KEYS,
  materialHintKey,
  materialHintLine,
} from '../src/ui/material_hint_view';

const EXPECTED_IDS = [
  'arcane_dust',
  'arcane_essence',
  'arcane_shard',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_thread',
  'resonant_timber',
];

describe('material_hint_view', () => {
  it('covers exactly the eight enchanting materials, no more and no less', () => {
    expect(Object.keys(MATERIAL_HINT_KEYS).slice().sort()).toEqual(EXPECTED_IDS);
  });

  it('covers every material the sim can actually yield or consume', () => {
    // Both halves of the ladder: the primaries a disenchant grants, and the
    // typed secondaries, so a new material cannot ship hint-less by accident.
    for (const id of Object.values(DISENCHANT_MATERIAL_BY_QUALITY)) {
      expect(MATERIAL_HINT_KEYS[id], `hint for primary ${id}`).toBeDefined();
    }
    for (const id of Object.values(ARMOR_SECONDARY_BY_TYPE)) {
      expect(MATERIAL_HINT_KEYS[id], `hint for secondary ${id}`).toBeDefined();
    }
    expect(MATERIAL_HINT_KEYS.resonant_steel).toBeDefined();
    expect(MATERIAL_HINT_KEYS.resonant_timber).toBeDefined();
    expect(TIMBER_WEAPON_TYPES.size).toBeGreaterThan(0);
  });

  it('every hinted id is a real item', () => {
    for (const id of Object.keys(MATERIAL_HINT_KEYS)) expect(ITEMS[id], id).toBeDefined();
  });

  it('no other item gets a hint, including the gear and the other materials', () => {
    for (const id of ['copper_ore', 'bone_fragments', 'linen_scrap', 'spider_leg']) {
      expect(materialHintKey(id), id).toBeUndefined();
      expect(materialHintLine(id)).toBe('');
    }
    // A broad sweep: nothing outside the eight ids carries a hint.
    const hinted = Object.keys(ITEMS).filter((id) => materialHintKey(id) !== undefined);
    expect(hinted.slice().sort()).toEqual(EXPECTED_IDS);
  });

  it('renders each hint as a muted description line naming its source', () => {
    const dust = materialHintLine('arcane_dust');
    expect(dust).toContain('class="tt-desc"');
    expect(dust).toContain('Enchanting reagent.');
    expect(dust).toContain('common and uncommon');
    expect(materialHintLine('arcane_essence')).toContain('rare gear');
    expect(materialHintLine('arcane_shard')).toContain('epic and legendary');
    expect(materialHintLine('resonant_thread')).toContain('cloth armor');
    expect(materialHintLine('resonant_hide')).toContain('leather armor');
    expect(materialHintLine('resonant_links')).toContain('mail armor');
    expect(materialHintLine('resonant_steel')).toContain('melee weapons');
    expect(materialHintLine('resonant_timber')).toContain('staves');
  });

  it('every hinted material is really consumed by at least one enchant', () => {
    // The hint claims each material is an enchanting reagent, so it had better
    // be one; a dead-end currency would make the line a lie.
    const consumed = new Set(
      Object.values(ENCHANTS).flatMap((e) => e.reagents.map((r) => r.itemId)),
    );
    for (const id of Object.keys(MATERIAL_HINT_KEYS)) {
      expect(consumed.has(id), `${id} is consumed by an enchant`).toBe(true);
    }
  });
});
