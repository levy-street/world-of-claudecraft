import { describe, expect, it } from 'vitest';
import {
  applyStudioPropEdits,
  editsReshapingGround,
  propRecordAnchor,
  STUDIO_REWORK_PROP_EDITS,
  unmatchedStudioPropEdits,
} from '../src/sim/content/studio_rework_props';
import { BUILTIN_WORLD, GROUND_PROPS, PROPS, SHIPPED_PROPS } from '../src/sim/data';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import type { ZonePropsDef } from '../src/sim/types';

const anchorsOf = (records: readonly unknown[]) =>
  records.map(propRecordAnchor).filter((a): a is { x: number; z: number } => a !== null);
const near = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

describe('Studio town rework prop edits', () => {
  it('every edit still matches a shipped record', () => {
    expect(unmatchedStudioPropEdits(SHIPPED_PROPS)).toEqual([]);
  });

  it('removes and moves exactly the edited records in the world props', () => {
    expect(BUILTIN_WORLD.props.fences).toBe(PROPS.fences);
    for (const edit of STUDIO_REWORK_PROP_EDITS) {
      const before = anchorsOf(SHIPPED_PROPS[edit.table] as unknown[]);
      const after = anchorsOf(PROPS[edit.table] as unknown[]);
      const countAt = (list: { x: number; z: number }[], p: { x: number; z: number }) =>
        list.filter((a) => near(a, p)).length;
      expect(countAt(after, edit.at), `${edit.table} ${edit.at.x},${edit.at.z}`).toBe(
        countAt(before, edit.at) - 1,
      );
      if (edit.to) expect(countAt(after, edit.to)).toBeGreaterThan(0);
    }
    const removed = STUDIO_REWORK_PROP_EDITS.filter((e) => e.remove).length;
    const total = (p: ZonePropsDef) =>
      Object.values(p).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
    expect(total(PROPS)).toBe(total(SHIPPED_PROPS) - removed);
  });

  it('moves a record rigidly: dict, tuple and fence shapes', () => {
    const props = {
      tents: [{ x: 1, z: 2, rot: 0.5, scale: 1 }],
      crates: [[3, 4]],
      fences: [{ x1: 0, z1: 0, x2: 2, z2: 0 }],
    } as unknown as ZonePropsDef;
    const out = applyStudioPropEdits(props, [
      { table: 'tents', at: { x: 1, z: 2 }, to: { x: 10, z: 20, turn: 0.25 } },
      { table: 'crates', at: { x: 3, z: 4 }, remove: true },
      { table: 'fences', at: { x: 1, z: 0 }, to: { x: 5, z: 5, turn: Math.PI / 2 } },
    ]);
    expect(out.tents[0]).toMatchObject({ x: 10, z: 20, rot: 0.75, scale: 1 });
    expect(out.crates).toEqual([]);
    const fence = out.fences[0] as unknown as Record<string, number>;
    expect(fence.x1).toBeCloseTo(5, 9);
    expect(fence.z1).toBeCloseTo(6, 9);
    expect(fence.x2).toBeCloseTo(5, 9);
    expect(fence.z2).toBeCloseTo(4, 9);
    // the input is never mutated
    expect(props.tents[0]).toMatchObject({ x: 1, z: 2, rot: 0.5 });
  });

  it('an edit for a record that is gone is inert', () => {
    const props = { wells: [{ x: 0, z: 0, r: 1 }] } as unknown as ZonePropsDef;
    const edits = [{ table: 'wells' as const, at: { x: 9, z: 9 }, remove: true as const }];
    expect(applyStudioPropEdits(props, edits).wells).toEqual(props.wells);
    expect(unmatchedStudioPropEdits(props, edits)).toEqual(edits);
  });

  it('a keepGround edit leaves its shipped record shaping the terrain', () => {
    const kept = STUDIO_REWORK_PROP_EDITS.filter((edit) => edit.keepGround);
    // the Wickharbor harbor and ferry wharf models' ground (scripts/assets/wickharbor_*)
    expect(kept.length).toBeGreaterThan(0);
    expect(editsReshapingGround()).toHaveLength(STUDIO_REWORK_PROP_EDITS.length - kept.length);
    const pads = collectCalmAnchorPads();
    for (const edit of kept) {
      const label = `${edit.table} ${edit.at.x},${edit.at.z}`;
      const shipped = anchorsOf(SHIPPED_PROPS[edit.table] as unknown[]);
      const ground = anchorsOf(GROUND_PROPS[edit.table] as unknown[]);
      const world = anchorsOf(PROPS[edit.table] as unknown[]);
      const countAt = (list: { x: number; z: number }[]) =>
        list.filter((a) => near(a, edit.at)).length;
      // gone (or moved) in the world, still where it shipped for the terrain
      expect(countAt(world), label).toBe(countAt(shipped) - 1);
      expect(countAt(ground), label).toBe(countAt(shipped));
      expect(
        pads.some((pad) => near(pad, edit.at)),
        label,
      ).toBe(true);
    }
  });

  it('every other edit reshapes the ground: its shipped record leaves the terrain too', () => {
    for (const edit of editsReshapingGround()) {
      const label = `${edit.table} ${edit.at.x},${edit.at.z}`;
      const countAt = (records: readonly unknown[]) =>
        anchorsOf(records).filter((a) => near(a, edit.at)).length;
      expect(countAt(GROUND_PROPS[edit.table] as unknown[]), label).toBe(
        countAt(SHIPPED_PROPS[edit.table] as unknown[]) - 1,
      );
    }
  });

  it('a turn only lands on a record that can turn (a fence run or a record with rot)', () => {
    for (const edit of STUDIO_REWORK_PROP_EDITS) {
      if (!edit.to || edit.to.turn === 0) continue;
      const record = (SHIPPED_PROPS[edit.table] as unknown[]).find((r) => {
        const a = propRecordAnchor(r);
        return a !== null && near(a, edit.at);
      }) as Record<string, unknown> | undefined;
      const turns =
        !!record &&
        !Array.isArray(record) &&
        (typeof record.x1 === 'number' || typeof record.rot === 'number');
      expect(turns, `${edit.table} ${edit.at.x},${edit.at.z}`).toBe(true);
    }
  });
});
