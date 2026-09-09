// The REAL tooltip builder for material provenance
// (src/ui/item_instance_tooltip.ts materialSourceLines over the pure
// material_sources_view.ts model). The sibling suite covers the model; this one
// asserts the HTML a player actually gets: the exact totals in it, the exact
// wording per row, and that a hostile display-name snapshot is escaped.

import { describe, expect, it } from 'vitest';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { MaterialSource } from '../src/sim/material_sources';
import { materialSourceLines } from '../src/ui/item_instance_tooltip';
import { materialSourcesForDisplay } from '../src/ui/material_sources_view';

const MATERIAL = 'wolf_fang';
const NON_MATERIAL = 'baked_bread';

const gatherer = (id: number, name: string): MaterialSource => ({
  gatherer: { kind: 'character', id, name },
});
const held = (source: MaterialSource, count: number) => ({ source, count });

const ANA = gatherer(11, 'Ana');
const UNRECORDED: MaterialSource = {};

/** Every `>N<` text node the builder emitted, in order: the lines a player reads. */
const linesOf = (html: string): string[] =>
  [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]).filter((text) => text.trim().length > 0);

describe('material source tooltip lines', () => {
  it('runs on a REAL material with a REAL non-material beside it', () => {
    expect(isMaterialItemId(MATERIAL)).toBe(true);
    expect(isMaterialItemId(NON_MATERIAL)).toBe(false);
  });

  it('emits one line per contributor with its exact surviving total', () => {
    const html = materialSourceLines([held(UNRECORDED, 2), held(ANA, 3)]);

    expect(linesOf(html)).toEqual(['2 × No gatherer recorded', '3 × Collected by Ana']);
    // One row element per bucket, no summary row that could disagree with them.
    expect(html.match(/tt-material-source/g)).toHaveLength(2);
  });

  it('bounds the hover list and states exact omitted source and unit totals', () => {
    const many = Array.from({ length: 12 }, (_, i) => held(gatherer(i + 1, `P${i}`), i + 1));

    const lines = linesOf(materialSourceLines(many));

    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('1 × Collected by P0');
    expect(lines[4]).toBe('5 × Collected by P4');
    expect(lines[5]).toBe('+7 more sources, 63 units');
  });

  it('names a signer as the SIGNER on units nobody was recorded for', () => {
    // Legacy signed stock: the premium marker lands on it without claiming
    // anybody gathered it.
    expect(linesOf(materialSourceLines([held({ signer: 'Cyd' }, 4)]))).toEqual([
      '4 × No gatherer recorded, signed by Cyd',
    ]);
  });

  it('marks a gatherer row as signed only when it really carries a signature', () => {
    const signedGatherer: MaterialSource = { ...ANA, signer: 'Cyd' };
    expect(linesOf(materialSourceLines([held(ANA, 2)]))).toEqual(['2 × Collected by Ana']);
    expect(linesOf(materialSourceLines([held(signedGatherer, 2)]))).toEqual([
      '2 × Collected by Ana, signed by Cyd',
    ]);
  });

  it('escapes a hostile display-name snapshot instead of injecting it', () => {
    // A name is raw player text carried on the stack. It reaches the card
    // through esc(), so the markup a player sees is inert.
    const hostile = gatherer(66, '<img src=x onerror=alert(1)>');

    const html = materialSourceLines([held(hostile, 1)]);

    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders nothing at all for a stack with no composition', () => {
    expect(materialSourceLines(undefined)).toBe('');
    expect(materialSourceLines([])).toBe('');
  });
});

describe('legacy material stacks through the display projection', () => {
  it('reads a LEGACY signed material stack as unrecorded units carrying the signature', () => {
    // The whole point of the projection: the old save carried the signer on the
    // payload, and reading that as a gatherer would invent an attribution.
    const legacy = { itemId: MATERIAL, count: 5, instance: { signer: 'Cyd' } };

    const html = materialSourceLines(materialSourcesForDisplay(legacy));

    expect(linesOf(html)).toEqual(['5 × No gatherer recorded, signed by Cyd']);
    expect(html).not.toContain('Collected by');
  });

  it('leaves a NON-material legacy stack alone, so its old maker line still shows', () => {
    const bread = { itemId: NON_MATERIAL, count: 5, instance: { signer: 'Cyd' } };
    expect(materialSourcesForDisplay(bread)).toBeUndefined();
    expect(materialSourceLines(materialSourcesForDisplay(bread))).toBe('');
  });

  it('ignores an EMPTY trimmed payload rather than reading it as a signature', () => {
    // publicInstanceView can hand a surface an empty payload object, which is
    // truthy and carries nothing; an empty-string signer is legal legacy data
    // that conveys nothing either. Neither may mint a source line.
    expect(materialSourcesForDisplay({ itemId: MATERIAL, count: 3, instance: {} })).toBeUndefined();
    expect(
      materialSourcesForDisplay({ itemId: MATERIAL, count: 3, instance: { signer: '' } }),
    ).toBeUndefined();
  });

  it('prefers a recorded composition over any legacy projection', () => {
    const recorded = {
      itemId: MATERIAL,
      count: 4,
      instance: { signer: 'Cyd' },
      materialSources: [held(ANA, 4)],
    };
    expect(linesOf(materialSourceLines(materialSourcesForDisplay(recorded)))).toEqual([
      '4 × Collected by Ana',
    ]);
  });
});
