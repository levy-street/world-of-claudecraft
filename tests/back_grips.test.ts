// src/render/characters/back_grips.ts: the pure on-back transform table for
// sheathed weapons (family dispatch, side mirroring, unknown-family fallback).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BACK_GRIP_FAMILIES,
  backGripFor,
  quatFromEulerXYZ,
} from '../src/render/characters/back_grips';
import { KAYKIT_SHIELD_ACCESSORIES } from '../src/render/characters/held_item_grips';

function quatLength(q: [number, number, number, number]): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

describe('quatFromEulerXYZ', () => {
  it('matches known rotations', () => {
    expect(quatFromEulerXYZ(0, 0, 0)).toEqual([0, 0, 0, 1]);
    const [x, y, z, w] = quatFromEulerXYZ(0, Math.PI, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(w).toBeCloseTo(0, 12);
  });

  it('always yields a unit quaternion', () => {
    for (const [x, y, z] of [
      [0.3, -1.2, 2.9],
      [Math.PI * 0.85, 0, 0],
      [-0.5, 0.5, -2.2],
    ]) {
      expect(quatLength(quatFromEulerXYZ(x, y, z))).toBeCloseTo(1, 12);
    }
  });
});

describe('backGripFor', () => {
  it('an unknown family and null fall back to the same default', () => {
    expect(backGripFor('NOT_A_FAMILY', 'r')).toEqual(backGripFor(null, 'r'));
  });

  it('families dispatch to distinct transforms (long hafts vs short blades)', () => {
    const staff = backGripFor('2H_Staff', 'r');
    const knife = backGripFor('Knife', 'r');
    expect(staff.position).not.toEqual(knife.position);
    // Crossbows lie flat across the back: a different rotation axis entirely.
    const bow = backGripFor('2H_Crossbow', 'r');
    expect(bow.quaternion).not.toEqual(staff.quaternion);
  });

  it('mirrors the left side across X so dual-wield reads crossed', () => {
    const r = backGripFor('Knife', 'r');
    const l = backGripFor('Knife', 'l');
    expect(l.position[0]).toBeCloseTo(-r.position[0], 12);
    expect(l.position[1]).toBeCloseTo(r.position[1], 12);
    expect(l.position[2]).toBeCloseTo(r.position[2], 12);
    expect(l.quaternion).not.toEqual(r.quaternion);
    expect(quatLength(l.quaternion)).toBeCloseTo(1, 12);
  });

  it('every declared family yields a unit quaternion', () => {
    for (const fam of [
      '1H_Sword',
      '2H_Sword',
      '1H_Axe',
      '2H_Axe',
      '2H_Staff',
      'Knife',
      '1H_Wand',
      '1H_Crossbow',
      '2H_Crossbow',
      'VAR_SWORD',
      'VAR_DAGGER',
      'VAR_STAFF',
      'VAR_AXE',
      'VAR_POLEARM',
      'VAR_WAND',
      ...Object.values(KAYKIT_SHIELD_ACCESSORIES),
    ]) {
      expect(quatLength(backGripFor(fam, 'r').quaternion), fam).toBeCloseTo(1, 12);
      expect(quatLength(backGripFor(fam, 'l').quaternion), fam).toBeCloseTo(1, 12);
    }
  });

  it('a shield lies flat on the back instead of sheathing like a sword', () => {
    for (const fam of Object.values(KAYKIT_SHIELD_ACCESSORIES)) {
      const shield = backGripFor(fam, 'l');
      const sword = backGripFor('1H_Sword', 'l');
      expect(shield.position, fam).not.toEqual(sword.position);
      expect(shield.quaternion, fam).not.toEqual(sword.quaternion);
    }
  });
});

// The asset tables (assets.ts) import three.js, so they cannot be imported in the
// plain-Node env: scan the source instead. This is the guard that would have caught
// the Season 1 Armory families (maces, wands, bows, crossbows) sheathing as swords.
describe('every weapon grip family has a tuned on-back carry', () => {
  const assetsSrc = readFileSync(
    new URL('../src/render/characters/assets.ts', import.meta.url),
    'utf8',
  );

  const variantFamilies = (): string[] => {
    const table = assetsSrc.match(/const VARIANT_GRIPS[^{]*\{([\s\S]*?)\n\};/);
    expect(table, 'VARIANT_GRIPS table not found in assets.ts').toBeTruthy();
    return [...(table as RegExpMatchArray)[1].matchAll(/^\s*([A-Za-z0-9_']+):/gm)].map((m) =>
      m[1].replace(/'/g, ''),
    );
  };

  // KAYKIT_WEAPON_ACCESSORY also spreads in KAYKIT_SHIELD_ACCESSORIES from
  // held_item_grips.ts (`...KAYKIT_SHIELD_ACCESSORIES,`), which a source-text
  // regex over assets.ts alone cannot see: it produced no literal `key: 'Value'`
  // pairs, so shield families silently escaped this guard (the exact gap that
  // let Round_Shield/Rectangle_Shield/Badge_Shield sheathe with the sword pose
  // instead of a tuned carry). Merge the spread module's own values in directly.
  const accessoryFamilies = (): string[] => {
    const table = assetsSrc.match(/const KAYKIT_WEAPON_ACCESSORY[^{]*\{([\s\S]*?)\n\};/);
    expect(table, 'KAYKIT_WEAPON_ACCESSORY table not found in assets.ts').toBeTruthy();
    const literal = [...(table as RegExpMatchArray)[1].matchAll(/:\s*'([A-Za-z0-9_]+)'/g)].map(
      (m) => m[1],
    );
    return [...literal, ...Object.values(KAYKIT_SHIELD_ACCESSORIES)];
  };

  it('covers every VARIANT_GRIPS family (the weapon-skin variant packs)', () => {
    const families = variantFamilies();
    expect(families.length).toBeGreaterThan(5);
    const missing = families.filter((f) => !BACK_GRIP_FAMILIES.has(f));
    expect(missing, `variant families with no BACK_GRIPS carry: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers every family a held item model resolves to', () => {
    const families = [...new Set(accessoryFamilies())];
    expect(families.length).toBeGreaterThan(5);
    const missing = families.filter((f) => !BACK_GRIP_FAMILIES.has(f));
    expect(missing, `item families with no BACK_GRIPS carry: ${missing.join(', ')}`).toEqual([]);
  });
});
