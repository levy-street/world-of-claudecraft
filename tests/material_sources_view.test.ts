// The tooltip model for a material stack's per-unit provenance
// (src/ui/material_sources_view.ts). These are the identity rules a naive
// "group by display name" would break, plus the counting rule that keeps a
// contributor list honest.

import { describe, expect, it } from 'vitest';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import { materialSourceKey } from '../src/sim/material_sources';
import {
  boundedMaterialSourceRows,
  materialSourceSummary,
  suppressesLegacyGatheredLine,
} from '../src/ui/material_sources_view';

const gatherer = (id: number, name: string): MaterialSource => ({
  gatherer: { kind: 'character', id, name },
});
const held = (source: MaterialSource, count: number) => ({ source, count });

const ANA = gatherer(11, 'Ana');
const BRU = gatherer(12, 'Bru');
const UNRECORDED: MaterialSource = {};
const SIGNED: MaterialSource = { signer: 'Cyd' };

describe('material source rows', () => {
  it('states each descriptor with its own surviving unit count', () => {
    const summary = materialSourceSummary([held(UNRECORDED, 2), held(ANA, 3)]);

    expect(summary?.rows).toEqual([
      {
        kind: 'unrecorded',
        name: '',
        count: 2,
        premium: false,
        signer: '',
        key: materialSourceKey(UNRECORDED),
      },
      {
        kind: 'gatherer',
        name: 'Ana',
        count: 3,
        premium: false,
        signer: '',
        key: materialSourceKey(ANA),
      },
    ]);
    expect(summary?.total).toBe(5);
    expect(summary?.mixed).toBe(true);
  });

  it('renders nothing for a stack with no composition at all', () => {
    // Every non-material item, and every legacy stack that predates provenance.
    expect(materialSourceSummary(undefined)).toBeNull();
    expect(materialSourceSummary([])).toBeNull();
  });

  it('keeps two name SNAPSHOTS of one person apart, inventing no rename history', () => {
    // Same stable id, an older display name on the earlier units. Folding these
    // would assert a rename nobody recorded, and would have to pick one name to
    // show for units gathered under the other.
    const older = gatherer(11, 'Anastasia');
    const summary = materialSourceSummary([held(older, 2), held(ANA, 3)]);

    expect(summary?.rows.map((r) => [r.name, r.count])).toEqual([
      ['Anastasia', 2],
      ['Ana', 3],
    ]);
    // Two rows, two distinct selection keys: acting on one cannot touch the other.
    expect(new Set(summary?.rows.map((r) => r.key)).size).toBe(2);
  });

  it('keeps two PEOPLE who share a display name apart', () => {
    // Same label, different stable ids. Collapsing them would merge two
    // players' contributions behind one name.
    const twin = gatherer(99, 'Ana');
    const summary = materialSourceSummary([held(ANA, 3), held(twin, 1)]);

    expect(summary?.rows).toHaveLength(2);
    expect(summary?.rows.map((r) => r.count)).toEqual([3, 1]);
    expect(summary?.rows[0].key).not.toBe(summary?.rows[1].key);
  });

  it('never caps, drops or folds a long contributor list', () => {
    const many: MaterialComposition = Array.from({ length: 40 }, (_, i) =>
      held(gatherer(i + 1, `P${i}`), i + 1),
    );

    const summary = materialSourceSummary(many);

    // Every contributor survives, and the counts still sum to the stack.
    expect(summary?.rows).toHaveLength(40);
    expect(summary?.total).toBe((40 * 41) / 2);
    expect(summary?.rows.reduce((n, r) => n + r.count, 0)).toBe(summary?.total);
  });
});

describe('premium signatures versus recorded gatherers', () => {
  it('treats a recorded gatherer as provenance ONLY, never a signature', () => {
    // The crafting benefit is the legacy signer's; attribution alone must not
    // claim it, or every gathered stack would read as signed.
    const summary = materialSourceSummary([held(ANA, 4)]);
    expect(summary?.rows[0].premium).toBe(false);
    expect(summary?.premiumUnits).toBe(0);
  });

  it('reads legacy signer-only stock as unrecorded units that carry the marker', () => {
    // Nobody recorded who gathered these, so the row says exactly that and
    // names the signer AS the signer rather than inventing a gatherer.
    const summary = materialSourceSummary([held(SIGNED, 2)]);

    expect(summary?.rows).toEqual([
      {
        kind: 'unrecorded',
        name: 'Cyd',
        count: 2,
        premium: true,
        signer: 'Cyd',
        key: materialSourceKey(SIGNED),
      },
    ]);
    expect(summary?.premiumUnits).toBe(2);
  });

  it('counts premium units per bucket in a mixed stack', () => {
    const signedGatherer: MaterialSource = { ...ANA, signer: 'Ana' };
    const summary = materialSourceSummary([held(UNRECORDED, 5), held(signedGatherer, 2)]);

    expect(summary?.rows.map((r) => r.premium)).toEqual([false, true]);
    // The marker lands on the two units that hold it, not on all seven.
    expect(summary?.premiumUnits).toBe(2);
    expect(summary?.total).toBe(7);
  });

  it('does not treat an empty-string signer as premium', () => {
    // A legal legacy value that conveys nothing, matching the shared algebra's
    // own truthiness rule.
    const summary = materialSourceSummary([held({ signer: '' }, 3)]);
    expect(summary?.rows[0].premium).toBe(false);
    expect(summary?.premiumUnits).toBe(0);
  });
});

describe('the legacy whole-stack mark', () => {
  it('is suppressed whenever per-unit rows render, and kept otherwise', () => {
    // Mixed: the old single "Gathered by" line cannot be true of every unit.
    expect(suppressesLegacyGatheredLine(materialSourceSummary([held(ANA, 1), held(BRU, 1)]))).toBe(
      true,
    );
    // Single bucket: the old line would merely repeat the row, less precisely.
    expect(suppressesLegacyGatheredLine(materialSourceSummary([held(SIGNED, 2)]))).toBe(true);
    // No composition: nothing replaced it, so it still renders.
    expect(suppressesLegacyGatheredLine(materialSourceSummary(undefined))).toBe(false);
  });
});

describe('bounded material source rows', () => {
  it('keeps the first five rows and counts every omitted descriptor and unit', () => {
    const many: MaterialComposition = Array.from({ length: 8 }, (_, i) =>
      held(gatherer(i + 1, `P${i}`), i + 1),
    );
    expect(boundedMaterialSourceRows(materialSourceSummary(many))).toMatchObject({
      rows: many.slice(0, 5).map(({ source, count }) => ({
        kind: 'gatherer',
        name: source.gatherer?.name,
        count,
      })),
      hiddenSources: 3,
      hiddenUnits: 21,
    });
  });

  it('does not hide anything when the source list fits the bound', () => {
    const summary = materialSourceSummary([held(ANA, 2)]);
    expect(boundedMaterialSourceRows(summary)).toEqual({
      rows: summary?.rows,
      hiddenSources: 0,
      hiddenUnits: 0,
    });
  });
});
