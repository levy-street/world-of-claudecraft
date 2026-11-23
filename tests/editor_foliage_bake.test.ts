import { describe, expect, it } from 'vitest';
import {
  BAKE_CATEGORY,
  BAKE_EXTRAS_VERSION,
  bakedAssetId,
  bakedAssetPath,
  type FoliageBakeRequest,
  foliageBakeExtras,
  foliageParamsFromExtras,
  foliageSlug,
  MAX_BAKE_BYTES,
  validateBakeRequest,
} from '../src/editor/foliage_bake_core';
import type { FoliageParams } from '../src/sim/foliage_params';

// Baking is what turns a generated plant from a recipe into an asset. These
// pin the decisions: where it is filed, and the round trip that stops a bake
// being a dead end.

const params: FoliageParams = { kind: 'bush', leafSet: 'broadleaf', footprint: 2, leaves: 120 };

describe('slugs and ids', () => {
  it('turns a maker label into a slug the catalogue can hold', () => {
    expect(foliageSlug('Round Bush')).toBe('round_bush');
    expect(foliageSlug('  Fern (forest) ')).toBe('fern_forest');
    expect(foliageSlug('bush 2')).toBe('bush_2');
  });

  it('refuses a label with nothing usable in it', () => {
    expect(foliageSlug('')).toBeNull();
    expect(foliageSlug('!!!')).toBeNull();
    // A leading digit is fine; a leading underscore is not (the id grammar).
    expect(foliageSlug('2 ferns')).toBe('2_ferns');
    expect(foliageSlug('_')).toBeNull();
  });

  it('files bakes under one category so a maker can find them', () => {
    expect(bakedAssetId('round_bush')).toBe(`${BAKE_CATEGORY}/round_bush`);
    expect(bakedAssetPath('round_bush')).toBe(`models/${BAKE_CATEGORY}/round_bush.glb`);
  });
});

describe('the parameter round trip', () => {
  it('writes the source parameters into the extras', () => {
    const extras = foliageBakeExtras('round_bush', 'Round Bush', params);
    expect(extras.wocFoliage).toBe(BAKE_EXTRAS_VERSION);
    expect(extras.kind).toBe('bush');
    expect(extras.label).toBe('Round Bush');
    // The atlas is recorded so bakes sharing a leaf set can be told apart from
    // bakes that would each drag in their own.
    expect(extras.leafSet).toBe('broadleaf');
  });

  it('reads them back, sanitized, so a bake can be re-opened and re-baked', () => {
    const extras = foliageBakeExtras('b', 'B', params);
    const back = foliageParamsFromExtras(extras);
    expect(back?.kind).toBe('bush');
    expect(back?.footprint).toBe(2);
    expect(back?.leaves).toBe(120);
  });

  it('sanitizes on the way back in: a tampered file cannot smuggle a value', () => {
    const back = foliageParamsFromExtras({
      wocFoliage: 1,
      params: { kind: 'bush', footprint: 9999, leaves: 999999 },
    });
    expect(back?.footprint).toBe(12); // FOLIAGE_LIMITS.footprint.max
    expect(back?.leaves).toBe(1400); // MAX_TREE_LEAVES
  });

  it('refuses extras that are not ours', () => {
    expect(foliageParamsFromExtras(null)).toBeNull();
    expect(foliageParamsFromExtras({})).toBeNull();
    expect(foliageParamsFromExtras({ params: { kind: 'bush' } })).toBeNull();
    expect(foliageParamsFromExtras('nope')).toBeNull();
  });
});

describe('validation (the same checks the endpoint runs)', () => {
  const good = (over: Partial<FoliageBakeRequest> = {}): FoliageBakeRequest => ({
    slug: 'round_bush',
    label: 'Round Bush',
    glbBase64: 'Z2xURg==',
    extras: foliageBakeExtras('round_bush', 'Round Bush', params),
    ...over,
  });

  it('accepts a well-formed request', () => {
    expect(validateBakeRequest(good())).toBeNull();
  });

  it('names the specific reason, so the editor need not surface an HTTP 400', () => {
    expect(validateBakeRequest(good({ slug: '../escape' }))).toBe('bad_slug');
    expect(validateBakeRequest(good({ slug: 'Round_Bush' }))).toBe('bad_slug'); // no capitals
    expect(validateBakeRequest(good({ label: '   ' }))).toBe('empty_label');
    expect(validateBakeRequest(good({ glbBase64: '' }))).toBe('no_geometry');
    expect(validateBakeRequest(good({ extras: { wocFoliage: 'x' } as never }))).toBe(
      'not_our_extras',
    );
  });

  it('caps a runaway bake before it reaches the wire', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_BAKE_BYTES * 4) / 3) + 8);
    expect(validateBakeRequest(good({ glbBase64: oversized }))).toBe('too_large');
  });
});
