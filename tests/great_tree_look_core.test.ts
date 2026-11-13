// How big the realms' great trees stand (src/render/great_tree_look_core.ts): grand trees
// with their crowns in view, never again a hundred-yard trunk, each with its root flare on
// the trunk collider the sim builds from the same record.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BANYAN_SCALE_BASE,
  GREAT_TREE_SCALE_BASE,
  GREAT_TREE_SCALE_SPREAD,
  greatTreeScale,
  REALM_GREAT_TREE_SCALE,
} from '../src/render/great_tree_look_core';
import { EVERGARDEN_PROPS } from '../src/sim/content/evergarden';
import { PALMREACH_PROPS } from '../src/sim/content/palmreach';
import { REALM_PROPS } from '../src/sim/content/realm';
import { WRAITHWOOD_PROPS } from '../src/sim/content/wraithwood';

// foliage/twisted_1 at unit scale: 16.4 yards tall, 0.85 across its foot, a root flare of
// about a yard and a half (tests/world_prop_conversion.test.ts measures the model itself)
const MODEL_HEIGHT = 16.4;
const MODEL_FOOT = 0.85;
const MODEL_FLARE = 1.5;
// sim/colliders.ts builds each trunk collider 1.45 times the record's radius
const COLLIDER_PER_RADIUS = 1.45;

describe('great tree scale', () => {
  it('grows with the record radius and the tree own jitter', () => {
    expect(greatTreeScale(3, 0)).toBeCloseTo(3 * GREAT_TREE_SCALE_BASE, 12);
    expect(greatTreeScale(3, 1)).toBeCloseTo(
      3 * (GREAT_TREE_SCALE_BASE + GREAT_TREE_SCALE_SPREAD),
      12,
    );
    expect(greatTreeScale(2.6, 0.5, BANYAN_SCALE_BASE)).toBeGreaterThan(greatTreeScale(2.6, 0.5));
  });

  it('stands every drawn giant as a grand tree, well under the old hundred yards', () => {
    // each zone at the base its own draw module passes (the banyans a touch broader)
    const zones: [string, readonly { x: number; z: number; r: number }[], number][] = [
      ['evergarden', EVERGARDEN_PROPS.greatTrees ?? [], GREAT_TREE_SCALE_BASE],
      ['wraithwood', WRAITHWOOD_PROPS.greatTrees ?? [], GREAT_TREE_SCALE_BASE],
      ['palmreach', PALMREACH_PROPS.greatTrees ?? [], BANYAN_SCALE_BASE],
    ];
    let count = 0;
    for (const [zone, records, base] of zones) {
      for (const tree of records) {
        count++;
        for (const jitter of [0, 0.999]) {
          const height = greatTreeScale(tree.r, jitter, base) * MODEL_HEIGHT;
          expect(height, `${zone} ${tree.x},${tree.z}`).toBeGreaterThan(30);
          expect(height, `${zone} ${tree.x},${tree.z}`).toBeLessThan(56);
        }
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(REALM_GREAT_TREE_SCALE * MODEL_HEIGHT).toBeGreaterThan(30);
    expect(REALM_GREAT_TREE_SCALE * MODEL_HEIGHT).toBeLessThan(45);
  });

  it('is the one place the draw modules and the editor take their scale from', () => {
    // a module that went back to its own formula would draw a giant this file no longer pins
    const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    expect(read('render/haunt_features.ts')).toContain(
      'tree.scale.setScalar(greatTreeScale(t.r, hash2(t.x, t.z, seed + 4101)));',
    );
    expect(read('render/garden_features.ts')).toContain(
      'const scale = greatTreeScale(t.r, hash2(t.x, t.z, seed + 6301));',
    );
    expect(read('render/jungle_features.ts')).toContain(
      'greatTreeScale(t.r, hash2(t.x, t.z, seed + 5201), BANYAN_SCALE_BASE)',
    );
    expect(read('render/realm_flora.ts')).toContain(
      'tree.scale.setScalar(REALM_GREAT_TREE_SCALE);',
    );
    const editor = read('editor/world_prop_conversion.ts');
    expect(editor).toContain('scale: REALM_GREAT_TREE_SCALE');
    expect(editor.match(/greatTreeScale\(tree\.r, hash2\(/g)).toHaveLength(3);
    // (the Nightbloom's ten records are trunk colliders with no drawn giant, as the editor's
    // conversion already says: nothing of theirs is scaled here)
    for (const file of [
      'render/haunt_features.ts',
      'render/garden_features.ts',
      'render/jungle_features.ts',
    ]) {
      expect(read(file), file).not.toMatch(/t\.r \* \(2\.[45] \+/);
    }
  });

  it('lands the root flare on the trunk collider, so a walker stops at the roots', () => {
    for (const tree of [
      ...(EVERGARDEN_PROPS.greatTrees ?? []),
      ...(WRAITHWOOD_PROPS.greatTrees ?? []),
    ]) {
      const collider = tree.r * COLLIDER_PER_RADIUS;
      for (const jitter of [0, 0.999]) {
        const flare = greatTreeScale(tree.r, jitter) * MODEL_FLARE;
        expect(Math.abs(flare - collider)).toBeLessThan(0.5);
      }
    }
  });

  it('keeps the Eldershine record on the foot of the tree the square draws', () => {
    const tree = REALM_PROPS.greatTrees?.[0];
    if (!tree) throw new Error('expected the Eldershine great tree');
    // the record is the trunk foot at the town scale (content/realm.ts)
    expect(tree.r).toBeCloseTo(REALM_GREAT_TREE_SCALE * MODEL_FOOT, 1);
    // and the collider built from it reaches the root flare, not past it
    expect(tree.r * COLLIDER_PER_RADIUS).toBeLessThan(REALM_GREAT_TREE_SCALE * MODEL_FLARE + 0.1);
  });
});
