import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { EquipSlot } from '../src/sim/types';
import {
  buildPaperdollView,
  PAPERDOLL_LEFT_SLOTS,
  PAPERDOLL_RIGHT_SLOTS,
} from '../src/ui/char_view';

const FULL: Partial<Record<EquipSlot, string>> = {
  helmet: 'cryptbone_helm',
  shoulder: 'cryptbone_pauldrons',
  chest: 'recruit_tunic',
  mainhand: 'worn_sword',
  gloves: 'mistveil_grips',
  waist: 'mistveil_cord',
  legs: 'quilted_trousers',
  feet: 'oiled_boots',
};

describe('char_view: paperdoll data model', () => {
  it('lays the classic two columns: head/shoulder/chest/weapon, then hands/waist/legs/feet', () => {
    expect(PAPERDOLL_LEFT_SLOTS).toEqual(['helmet', 'shoulder', 'chest', 'mainhand']);
    expect(PAPERDOLL_RIGHT_SLOTS).toEqual(['gloves', 'waist', 'legs', 'feet']);
  });

  it('resolves every equipped slot to its item, in column order', () => {
    const view = buildPaperdollView(FULL, ITEMS);
    expect(view.left.map((c) => c.slot)).toEqual(['helmet', 'shoulder', 'chest', 'mainhand']);
    expect(view.right.map((c) => c.slot)).toEqual(['gloves', 'waist', 'legs', 'feet']);
    expect(view.left[0].item).toBe(ITEMS.cryptbone_helm);
    expect(view.left[3].item).toBe(ITEMS.worn_sword);
    expect(view.right[3].item).toBe(ITEMS.oiled_boots);
  });

  it('renders an empty cell for an unequipped slot or an unknown item id', () => {
    const view = buildPaperdollView({ helmet: 'cryptbone_helm', chest: 'no_such_item' }, ITEMS);
    expect(view.left[0].item).toBe(ITEMS.cryptbone_helm);
    expect(view.left[1].item).toBeNull(); // shoulder: unequipped
    expect(view.left[2].item).toBeNull(); // chest: id present but unknown -> empty
    // every right-column slot is empty when nothing is equipped there
    expect(view.right.every((c) => c.item === null)).toBe(true);
  });
});

describe('char_view: determinism + ClientWorld-vs-Sim parity', () => {
  it('is a pure function: same equipment yields an equal paperdoll', () => {
    expect(buildPaperdollView(FULL, ITEMS)).toEqual(buildPaperdollView(FULL, ITEMS));
  });

  it('yields an identical paperdoll from a Sim-shaped and a ClientWorld-mirror equipment record', () => {
    // Offline Sim hands a prototyped record carrying offline-only fields the core
    // must ignore; the ClientWorld mirror is a JSON round-trip of the snapshot.
    const simEquip = Object.assign(Object.create({ dirty: true }), FULL) as Partial<
      Record<EquipSlot, string>
    >;
    const mirrorEquip = JSON.parse(JSON.stringify(simEquip)) as Partial<Record<EquipSlot, string>>;
    expect(buildPaperdollView(simEquip, ITEMS)).toEqual(buildPaperdollView(mirrorEquip, ITEMS));
  });
});

describe('char_view: scoped to deterministic paperdoll data (no Three, no RNG)', () => {
  // The 3D model preview and the skin-event randomness stay on the painter; this
  // core stays pure so the purity guard can register it. (The purity guard also
  // scans for RNG; this is the explicit shape assertion.)
  const src = readFileSync(new URL('../src/ui/char_view.ts', import.meta.url), 'utf8');

  it('draws no randomness or wall-clock time', () => {
    expect(src).not.toMatch(/\bMath\.random\b/);
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/\bperformance\.now\b/);
  });

  it('emits no Three types and imports nothing from the render layer', () => {
    expect(src).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/\bCharacterPreview\b/);
    expect(src).not.toMatch(/\bTHREE\b/);
  });
});
