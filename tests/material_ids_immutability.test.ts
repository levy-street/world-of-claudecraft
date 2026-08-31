import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { materialItemIds } from '../src/sim/material_ids';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { vaultMaterialIds } from '../src/sim/materials_vault';

describe('material id registry', () => {
  it('sources gathering and salvage tables from runtime-dependency-free leaves', () => {
    const leaves = [
      '../src/sim/professions/gathering_materials.ts',
      '../src/sim/professions/salvage_materials.ts',
    ];
    for (const relative of leaves) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
      expect(source.match(/^import\s+(?!type\b)/gm), relative).toBeNull();
      expect(source, relative).not.toContain("from '../sim'");
    }
  });

  it('is one eager canonical view for sim and presentation consumers', () => {
    const first = materialItemIds();
    expect(first).toBe(materialItemIds());
    expect(first).toBe(MATERIAL_ITEM_IDS);
    expect(first).toBe(vaultMaterialIds());
    expect(first.has('copper_ore')).toBe(true);
  });

  it('exposes no runtime mutation surface', () => {
    const ids = materialItemIds();
    const unsafe = ids as unknown as {
      add?: (value: string) => unknown;
      clear?: () => unknown;
      delete?: (value: string) => unknown;
    };

    expect(Object.isFrozen(ids)).toBe(true);
    expect(unsafe.add).toBeUndefined();
    expect(unsafe.clear).toBeUndefined();
    expect(unsafe.delete).toBeUndefined();
    expect(() => Object.defineProperty(ids, 'add', { value: () => ids })).toThrow();
    expect(ids.has('not_a_real_material')).toBe(false);
  });

  it('preserves the complete ReadonlySet iteration contract', () => {
    const ids = materialItemIds();
    // Floors: an empty set would satisfy every derived toEqual arm below.
    expect(ids.size).toBeGreaterThan(0);
    const fromIterator = [...ids];
    expect(fromIterator.length).toBeGreaterThan(0);
    expect([...ids.keys()]).toEqual(fromIterator);
    expect([...ids.values()]).toEqual(fromIterator);
    expect([...ids.entries()]).toEqual(fromIterator.map((id) => [id, id]));

    const visited: string[] = [];
    ids.forEach((value, key, owner) => {
      expect(key).toBe(value);
      expect(owner).toBe(ids);
      visited.push(value);
    });
    expect(visited.length).toBe(ids.size);
    expect(visited).toEqual(fromIterator);
  });
});
