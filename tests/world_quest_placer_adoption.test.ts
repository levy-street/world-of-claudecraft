import { describe, expect, it } from 'vitest';
import { adoptShippedShipwreckDraft } from '../src/game/world_quest_placer_adoption';
import {
  FARSHORE_HULL_FRAGMENT_PLACEMENT,
  FARSHORE_SALVAGE_PLACEMENTS,
  FARSHORE_SHIPWRECK_PLACEMENT,
} from '../src/sim/content/farshore_shipwreck_layout';

function draft(): Array<{
  key: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}> {
  return [
    FARSHORE_SHIPWRECK_PLACEMENT,
    FARSHORE_HULL_FRAGMENT_PLACEMENT,
    ...FARSHORE_SALVAGE_PLACEMENTS,
  ].map((row) => ({ ...row }));
}

describe('shipwreck draft adoption', () => {
  it('reconnects the submitted export to all thirteen live sources without moving anything', () => {
    const entries = draft();
    const before = JSON.stringify(entries);
    const adopted = adoptShippedShipwreckDraft(entries)!;
    expect(adopted.importedSources).toEqual([
      'shipwreck:ship',
      ...Array.from({ length: 12 }, (_, index) => `salvage:${2147100100 + index}`),
    ]);
    expect(adopted.entries.map((row) => (row as { sourceId?: string }).sourceId)).toEqual(
      adopted.importedSources,
    );
    for (const [index, row] of entries.entries()) expect(adopted.entries[index]).toMatchObject(row);
    expect(JSON.stringify(entries)).toBe(before);
    expect(adoptShippedShipwreckDraft(adopted.entries)).toEqual(adopted);
  });

  it('preserves later edits, partial layouts and other saved plans', () => {
    const moved = draft();
    moved[3].x += 1;
    expect(adoptShippedShipwreckDraft(moved)).toBeNull();
    expect(adoptShippedShipwreckDraft(draft().slice(1))).toBeNull();
    expect(adoptShippedShipwreckDraft(draft().map((row) => ({ ...row, pitch: 3 })))).toBeNull();
    expect(
      adoptShippedShipwreckDraft(draft().map((row) => ({ ...row, x: Number.NaN }))),
    ).toBeNull();
    expect(adoptShippedShipwreckDraft([])).toBeNull();
  });

  it.each(['x', 'y', 'z', 'rot', 'scale'] as const)('keeps a later %s edit', (field) => {
    const entries = draft();
    entries[3][field] += 0.01;
    expect(adoptShippedShipwreckDraft(entries)).toBeNull();
  });

  it('keeps later model, roll and ordering edits', () => {
    const changedKey = draft();
    changedKey[3].key = 'wq_broken_planks';
    expect(adoptShippedShipwreckDraft(changedKey)).toBeNull();
    expect(adoptShippedShipwreckDraft(draft().map((row) => ({ ...row, roll: 3 })))).toBeNull();
    const reordered = draft();
    [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
    expect(adoptShippedShipwreckDraft(reordered)).toBeNull();
  });

  it('allows numeric serialization noise but preserves a change outside its tolerance', () => {
    const noise = draft();
    noise[0].x += 1e-10;
    expect(adoptShippedShipwreckDraft(noise)).not.toBeNull();
    noise[0].x += 1e-7;
    expect(adoptShippedShipwreckDraft(noise)).toBeNull();
  });
});
