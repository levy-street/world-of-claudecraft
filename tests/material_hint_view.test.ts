// Purpose hints: the hint table is keyed on exactly the eight arcane/resonant
// enchanting ids plus the nine fine gathered grades and nothing else, every row
// resolves to real English, and the rendered line is the muted description
// style the tooltip's other def-driven use lines share.
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import {
  ARMOR_SECONDARY_BY_TYPE,
  TIMBER_WEAPON_TYPES,
} from '../src/sim/professions/disenchant_reagents';
import { DISENCHANT_MATERIAL_BY_QUALITY } from '../src/sim/professions/enchanting';
import {
  baseMaterialFor,
  MATERIAL_GRADES,
  materialGradeIds,
} from '../src/sim/professions/material_grades';
import {
  MATERIAL_HINT_KEYS,
  materialHintKey,
  materialHintLine,
} from '../src/ui/material_hint_view';

const ENCHANTING_IDS = [
  'arcane_dust',
  'arcane_essence',
  'arcane_shard',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_thread',
  'resonant_timber',
];
// Derived from the live grade table rather than restated, so a tenth gathered
// material cannot ship with a tooltip that says nothing about its grade.
const FINE_IDS = Object.values(MATERIAL_GRADES).map((row) => row.fineItemId);
const EXPECTED_IDS = [...ENCHANTING_IDS, ...FINE_IDS].sort();

describe('material_hint_view', () => {
  it('covers exactly the enchanting materials and the fine grades, no more and no less', () => {
    expect(Object.keys(MATERIAL_HINT_KEYS).slice().sort()).toEqual(EXPECTED_IDS);
    expect(FINE_IDS).toHaveLength(9);
  });

  it('every fine grade carries the one shared hint, and its BASE carries none', () => {
    // The base/grade split is the whole point of the line: an ordinary copper
    // ore needs no explanation, a Fine Copper Ore does. One key for all nine,
    // so the nine rows cannot drift into nine slightly different sentences.
    const keys = new Set(FINE_IDS.map((id) => materialHintKey(id)));
    expect(keys.size, 'the nine grades must share exactly one key').toBe(1);
    expect([...keys][0]).toBe('hudChrome.materialHint.fineGrade');
    for (const baseItemId of Object.keys(MATERIAL_GRADES)) {
      expect(materialHintKey(baseItemId), baseItemId).toBeUndefined();
      expect(materialHintLine(baseItemId)).toBe('');
    }
    // And it renders as the same muted line the others use, naming both halves
    // of what a player cannot otherwise learn: where it comes from, and that it
    // stands in for the ordinary grade.
    const line = materialHintLine('fine_copper_ore');
    expect(line).toContain('class="tt-desc"');
    expect(line).toContain('Fine grade.');
    expect(line).toContain('above the material');
    expect(line).toContain('ordinary version');
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

  it('every enchanting-hinted material is really consumed by at least one enchant', () => {
    // The hint claims each material is an enchanting reagent, so it had better
    // be one; a dead-end currency would make the line a lie. Scoped to the
    // enchanting family: the fine grades carry a different sentence, checked
    // against its own claim below.
    const consumed = new Set(
      Object.values(ENCHANTS).flatMap((e) => e.reagents.map((r) => r.itemId)),
    );
    for (const id of ENCHANTING_IDS) {
      expect(consumed.has(id), `${id} is consumed by an enchant`).toBe(true);
    }
    // The scoping is real, not a widening: no fine grade is an enchant reagent,
    // which is exactly why it needed a different sentence.
    for (const id of FINE_IDS) {
      expect(consumed.has(id), `${id} must not be an enchant reagent`).toBe(false);
    }
  });

  it('every fine-grade hint is true of the grade it is attached to', () => {
    // The fine hint claims two things. Both are checked against the sim rather
    // than trusted: the id really is a gathered grade of some base material,
    // and that base really does accept it (the downward substitution the
    // sentence promises).
    for (const [baseItemId, row] of Object.entries(MATERIAL_GRADES)) {
      expect(baseMaterialFor(row.fineItemId), row.fineItemId).toBe(baseItemId);
      expect(
        materialGradeIds(baseItemId).includes(row.fineItemId),
        `${row.fineItemId} must stand in for ${baseItemId}`,
      ).toBe(true);
      // And never the reverse, which the sentence does NOT promise.
      expect(materialGradeIds(row.fineItemId)).toEqual([row.fineItemId]);
    }
  });
});
