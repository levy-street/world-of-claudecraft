// The pure half of the merged WOC armor (src/render/characters/woc_armor_merge_core.ts):
// which drawn armor meshes fold into one draw (the ones sharing a file material and a
// layout, two or more of them), the layout a draw has one of (the attributes carried,
// the draw order, the layers, the caster flag), the identity a merged geometry is
// cached under (the parts it folds, in order, and how each was converted), and the two
// small predicates the fold decides by.
import { describe, expect, it } from 'vitest';
import {
  WOC_ARMOR_MERGE_ATTRIBUTES,
  type WocArmorMergeFacts,
  type WocArmorMergeKeyPart,
  type WocArmorMergeLayoutFacts,
  wocArmorMergeBake,
  wocArmorMergeBatches,
  wocArmorMergeKey,
  wocArmorMergeLayout,
  wocMatrixIsIdentity,
  wocScaleIsUniform,
} from '../src/render/characters/woc_armor_merge_core';

const mesh = (material: string, layout = 'L', foldable = true): WocArmorMergeFacts => ({
  material,
  layout,
  foldable,
});

describe('which drawn armor meshes share a draw', () => {
  it('folds the meshes on one file material, in the order they were given', () => {
    // a warrior kit: everything on one atlas
    expect(wocArmorMergeBatches([mesh('a'), mesh('a'), mesh('a')])).toEqual([[0, 1, 2]]);
    // a mage kit: the shoulders on one material, the robe parts on another, the hood alone
    expect(
      wocArmorMergeBatches([
        mesh('robe'),
        mesh('shoulder'),
        mesh('hood'),
        mesh('robe'),
        mesh('shoulder'),
        mesh('robe'),
      ]),
    ).toEqual([
      [0, 3, 5],
      [1, 4],
    ]);
  });

  it('leaves a batch of one alone: nothing to gain from folding a single mesh', () => {
    expect(wocArmorMergeBatches([mesh('a')])).toEqual([]);
    expect(wocArmorMergeBatches([mesh('a'), mesh('b'), mesh('c')])).toEqual([]);
    expect(wocArmorMergeBatches([mesh('a'), mesh('b'), mesh('a')])).toEqual([[0, 2]]);
  });

  it('never folds a mesh that cannot, and never counts it toward a batch', () => {
    expect(wocArmorMergeBatches([mesh('a'), mesh('a', 'L', false)])).toEqual([]);
    expect(wocArmorMergeBatches([mesh('a'), mesh('a', 'L', false), mesh('a')])).toEqual([[0, 2]]);
    expect(wocArmorMergeBatches([mesh('a', 'L', false), mesh('a', 'L', false)])).toEqual([]);
  });

  it('keeps two layouts on one material in two draws', () => {
    expect(
      wocArmorMergeBatches([
        mesh('a', 'uv'),
        mesh('a', 'plain'),
        mesh('a', 'uv'),
        mesh('a', 'plain'),
      ]),
    ).toEqual([
      [0, 2],
      [1, 3],
    ]);
    // ...and a layout only one mesh has is a batch of one
    expect(wocArmorMergeBatches([mesh('a', 'uv'), mesh('a', 'plain'), mesh('a', 'uv')])).toEqual([
      [0, 2],
    ]);
  });

  it('answers nothing for nothing drawn', () => {
    expect(wocArmorMergeBatches([])).toEqual([]);
  });
});

describe('the layout two parts must agree on', () => {
  const base: WocArmorMergeLayoutFacts = {
    attributes: { position: 3, normal: 3, uv: 2 },
    renderOrder: 0,
    layers: 1,
    caster: true,
  };

  it('lists the carried attributes in one fixed order, whatever order a geometry holds them in', () => {
    const a = wocArmorMergeLayout(base);
    const b = wocArmorMergeLayout({ ...base, attributes: { uv: 2, normal: 3, position: 3 } });
    expect(a).toBe('normal3,uv2|0|1|c');
    expect(b).toBe(a);
  });

  it('ignores the skin attributes: a rigid part has none and a skinned one is given the same draw', () => {
    const skinned = wocArmorMergeLayout({
      ...base,
      attributes: { ...base.attributes, skinIndex: 4, skinWeight: 4 },
    });
    expect(skinned).toBe(wocArmorMergeLayout(base));
  });

  it('separates parts by any attribute a program reads, by draw order, layers and the caster flag', () => {
    const plain = wocArmorMergeLayout(base);
    const variants: WocArmorMergeLayoutFacts[] = [
      { ...base, attributes: { position: 3, normal: 3 } },
      { ...base, attributes: { ...base.attributes, uv1: 2 } },
      { ...base, attributes: { ...base.attributes, tangent: 4 } },
      { ...base, attributes: { ...base.attributes, color: 3 } },
      { ...base, attributes: { ...base.attributes, color: 4 } },
      { ...base, renderOrder: 2 },
      { ...base, layers: 4 },
      { ...base, caster: false },
    ];
    const seen = new Set([plain]);
    for (const variant of variants) {
      const layout = wocArmorMergeLayout(variant);
      expect(layout, JSON.stringify(variant)).not.toBeNull();
      expect(seen.has(layout), JSON.stringify(variant)).toBe(false);
      seen.add(layout);
    }
  });

  it('refuses a mesh no merged draw can carry', () => {
    // no position, or one that is not three components
    expect(wocArmorMergeLayout({ ...base, attributes: { normal: 3 } })).toBeNull();
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 2 } })).toBeNull();
    // a carried attribute at an item size the fold does not write
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, normal: 4 } })).toBeNull();
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, uv: 3 } })).toBeNull();
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, tangent: 3 } })).toBeNull();
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, color: 2 } })).toBeNull();
    for (const name of ['uv1', 'uv2', 'uv3']) {
      expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, [name]: 3 } })).toBeNull();
      expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, [name]: 2 } })).toBe(
        `${name}2|0|1|c`,
      );
    }
    // an attribute outside the carried set: a merged buffer would silently drop it
    expect(wocArmorMergeLayout({ ...base, attributes: { position: 3, aCustom: 1 } })).toBeNull();
    // ...including a name that happens to live on every object
    expect(
      wocArmorMergeLayout({ ...base, attributes: { position: 3, constructor: 3 } }),
    ).toBeNull();
  });

  it('carries exactly the attributes three reads besides the position and the skin', () => {
    expect([...WOC_ARMOR_MERGE_ATTRIBUTES.keys()]).toEqual([
      'normal',
      'uv',
      'uv1',
      'uv2',
      'uv3',
      'tangent',
      'color',
    ]);
  });
});

describe('the identity a merged geometry is cached under', () => {
  const skinned = (geometry: string, bake = ''): WocArmorMergeKeyPart => ({
    geometry,
    material: 'm',
    bone: null,
    bake,
  });
  const rigid = (geometry: string, bone: number, bake = 'b'): WocArmorMergeKeyPart => ({
    geometry,
    material: 'm',
    bone,
    bake,
  });

  it('is the same for the same parts in the same order', () => {
    const parts = [skinned('boots'), skinned('chest'), rigid('pad', 7)];
    expect(wocArmorMergeKey(parts)).toBe(wocArmorMergeKey(parts.map((p) => ({ ...p }))));
    expect(wocArmorMergeKey(parts)).toBe('boots:m:s:|chest:m:s:|pad:m:r7:b');
  });

  it('changes with a part more, a part less, another part, or another order', () => {
    const kit = [skinned('boots'), skinned('chest'), rigid('pad', 7)];
    const keys = new Set([
      wocArmorMergeKey(kit),
      wocArmorMergeKey(kit.slice(0, 2)),
      wocArmorMergeKey([...kit, skinned('waist')]),
      wocArmorMergeKey([skinned('boots'), skinned('hood'), rigid('pad', 7)]),
      wocArmorMergeKey([skinned('chest'), skinned('boots'), rigid('pad', 7)]),
    ]);
    expect(keys.size).toBe(5);
  });

  it('tells a rigid part from a skinned one, one bone from another, and one conversion from another', () => {
    const keys = new Set([
      wocArmorMergeKey([skinned('pad')]),
      wocArmorMergeKey([rigid('pad', 0, '')]),
      wocArmorMergeKey([rigid('pad', 1, '')]),
      wocArmorMergeKey([rigid('pad', 1, 'f')]),
      wocArmorMergeKey([skinned('pad', 'j1,0')]),
    ]);
    expect(keys.size).toBe(5);
  });

  it('tells one material from another over the same geometry', () => {
    expect(wocArmorMergeKey([{ ...skinned('g'), material: 'low' }])).not.toBe(
      wocArmorMergeKey([{ ...skinned('g'), material: 'high' }]),
    );
  });
});

describe('the conversion a part carries into the key', () => {
  it('is empty for a part copied as stored', () => {
    expect(wocArmorMergeBake({ matrix: null, normal: null, joints: null, flip: false })).toBe('');
  });

  it('carries the numbers themselves: any difference at all is another buffer', () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1];
    const normal = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const bake = wocArmorMergeBake({ matrix, normal, joints: null, flip: false });
    expect(bake).toBe(`m${matrix.join(',')};n${normal.join(',')}`);
    const nudged = [...matrix];
    nudged[12] += 1e-12;
    expect(wocArmorMergeBake({ matrix: nudged, normal, joints: null, flip: false })).not.toBe(bake);
    const turned = [...normal];
    turned[0] = -1;
    expect(wocArmorMergeBake({ matrix, normal: turned, joints: null, flip: false })).not.toBe(bake);
    expect(wocArmorMergeBake({ matrix, normal, joints: null, flip: true })).toBe(`${bake};f`);
    expect(wocArmorMergeBake({ matrix: null, normal: null, joints: [2, 0, 1], flip: false })).toBe(
      'j2,0,1',
    );
  });
});

describe('the two predicates the fold decides by', () => {
  it('calls a scale uniform by its size on each axis, a mirror included', () => {
    expect(wocScaleIsUniform(1, 1, 1)).toBe(true);
    expect(wocScaleIsUniform(0.09, 0.09, 0.09)).toBe(true);
    // a left shoulder is its right one under a negative axis: still one size
    expect(wocScaleIsUniform(-0.09, 0.09, 0.09)).toBe(true);
    // the float residue a glTF node scale carries
    expect(wocScaleIsUniform(0.12493896484375, 0.12493896485345465, 0.12493895740651205)).toBe(
      true,
    );
    expect(wocScaleIsUniform(1, 1.02, 1)).toBe(false);
    expect(wocScaleIsUniform(1, 1, 0.99)).toBe(false);
    expect(wocScaleIsUniform(2, 2, -2.1)).toBe(false);
    // the tolerance is a float residue, not a squash: a part in a thousand is one
    expect(wocScaleIsUniform(1, 1.001, 1)).toBe(false);
    expect(wocScaleIsUniform(1, 1, 1.0001)).toBe(false);
    expect(wocScaleIsUniform(1, 1.000001, 1)).toBe(true);
    // ...measured against the scale itself where that is the larger
    expect(wocScaleIsUniform(100, 100.0005, 100)).toBe(true);
    expect(wocScaleIsUniform(100, 100.01, 100)).toBe(false);
  });

  it('calls a matrix the identity only when it is one exactly', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(wocMatrixIsIdentity(identity)).toBe(true);
    // a negative zero is a zero
    expect(wocMatrixIsIdentity(identity.map((v) => (v === 0 ? -0 : v)))).toBe(true);
    for (let i = 0; i < 16; i++) {
      const off = [...identity];
      off[i] += 1e-9;
      expect(wocMatrixIsIdentity(off), `element ${i}`).toBe(false);
    }
  });
});
