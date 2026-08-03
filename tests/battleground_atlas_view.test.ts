// The M-map atlas plate's pure furniture (src/ui/hud/battleground/battleground_atlas_view.ts):
// the drawn marks and the landmark label anchors.
//
// Both tables are read off the authored map rather than authored here, so what
// is worth pinning is the reading: that a mark stands where a real placement
// stands (and that the two mark kinds are the ones the plate can actually
// draw), that every label resolves to a rectangle the map still declares (a
// renamed LOCATION would otherwise silently drop a name off the plate), and
// that both tables come out point-symmetric, which is what lets the away team's
// plate be the same ground turned 180 degrees.

import { describe, expect, it } from 'vitest';
import {
  TH_GRAVEYARDS,
  TH_HALF_X,
  TH_HALF_Z,
  TH_LOCATIONS,
  TH_PLACEMENTS,
} from '../src/sim/thornhollow_field.generated';
import {
  BG_ATLAS_MARK_MARGIN,
  type BgAtlasLabelId,
  bgAtlasLabels,
  bgAtlasMarks,
} from '../src/ui/hud/battleground/battleground_atlas_view';

/** Does `points` hold the point mirror of (x, z)? */
function hasMirror(points: ReadonlyArray<{ x: number; z: number }>, x: number, z: number): boolean {
  return points.some((p) => Math.hypot(p.x + x, p.z + z) <= 1e-6);
}

describe('bg atlas marks: the plate draws the field the map really placed', () => {
  const marks = bgAtlasMarks();

  it('memoizes: the same table object, so a plate rebuild re-reads nothing', () => {
    expect(bgAtlasMarks()).toBe(marks);
  });

  it('draws only crowns and boulders, each with a real radius', () => {
    expect(marks.length).toBeGreaterThan(100);
    for (const mark of marks) {
      expect(['crown', 'boulder']).toContain(mark.kind);
      expect(mark.r).toBeGreaterThan(0);
      expect(Number.isFinite(mark.x) && Number.isFinite(mark.z)).toBe(true);
    }
    // Both kinds are really present, so a filter that silently stopped matching
    // one of the two asset families fails here.
    expect(marks.some((m) => m.kind === 'crown')).toBe(true);
    expect(marks.some((m) => m.kind === 'boulder')).toBe(true);
  });

  it('stands every mark on a real placement of the matching asset family', () => {
    // Decisive against invented dressing: each mark must sit exactly on a
    // placement whose assetId is a tree (crown) or rock/rubble (boulder).
    const kindOf = new Map<string, string>();
    for (const p of TH_PLACEMENTS) {
      const kind = /^foliage\/(?:oak|pine|twisted)/.test(p.assetId)
        ? 'crown'
        : /^(?:foliage\/rock|dungeon\/rubble_large)/.test(p.assetId)
          ? 'boulder'
          : '';
      if (kind) kindOf.set(`${p.x},${p.z}`, kind);
    }
    for (const mark of marks) {
      expect(kindOf.get(`${mark.x},${mark.z}`), `mark at (${mark.x}, ${mark.z})`).toBe(mark.kind);
    }
    // ...and it harvested the WOODED LIP outside the ramparts too, which is the
    // whole reason the plate keeps a margin.
    expect(marks.some((m) => Math.abs(m.z) > TH_HALF_Z)).toBe(true);
  });

  it('stays inside the harvest margin', () => {
    for (const mark of marks) {
      expect(Math.abs(mark.x)).toBeLessThanOrEqual(TH_HALF_X + BG_ATLAS_MARK_MARGIN);
      expect(Math.abs(mark.z)).toBeLessThanOrEqual(TH_HALF_Z + BG_ATLAS_MARK_MARGIN);
    }
  });

  it('is point-symmetric, so the away team sees the same wood', () => {
    for (const kind of ['crown', 'boulder'] as const) {
      const set = marks.filter((m) => m.kind === kind);
      for (const mark of set) {
        expect(hasMirror(set, mark.x, mark.z), `${kind} (${mark.x}, ${mark.z}) has no mirror`).toBe(
          true,
        );
      }
    }
  });
});

describe('bg atlas labels: the names the authored map itself declares', () => {
  const labels = bgAtlasLabels();

  it('memoizes, and names every landmark exactly once (the graveyards twice)', () => {
    expect(bgAtlasLabels()).toBe(labels);
    const counts = new Map<BgAtlasLabelId, number>();
    for (const l of labels) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      crimsonKeep: 1,
      azureKeep: 1,
      crimsonField: 1,
      azureField: 1,
      ruinCourtyard: 1,
      graveyard: TH_GRAVEYARDS.length,
    });
  });

  it('resolves every region label against a LOCATION the map still declares', () => {
    // The anchors are read by NAME off a generated table. If the map renames or
    // drops one, the label silently disappears from the plate; this is where
    // that shows up instead.
    const names = new Set<string>(TH_LOCATIONS.map((l) => l.name));
    for (const name of [
      'Crimson Keep',
      'Azure Keep',
      'Crimson Field',
      'Azure Field',
      'The Ruin Courtyard',
    ]) {
      expect(names.has(name), `${name} is no longer an authored LOCATION`).toBe(true);
    }
    expect(labels.filter((l) => l.tier === 'region')).toHaveLength(5);
    expect(labels.filter((l) => l.tier === 'place')).toHaveLength(TH_GRAVEYARDS.length);
  });

  it('anchors every label inside the field, and each keep label behind its flag', () => {
    for (const l of labels) {
      expect(Math.abs(l.x)).toBeLessThanOrEqual(TH_HALF_X);
      expect(Math.abs(l.z)).toBeLessThanOrEqual(TH_HALF_Z);
    }
    // The keep centre is the flag stand, and the stand's banner is the largest
    // glyph on the map: the name sits BEHIND it, deeper into the keep.
    for (const id of ['crimsonKeep', 'azureKeep'] as const) {
      const keepName = id === 'crimsonKeep' ? 'Crimson Keep' : 'Azure Keep';
      const rect = TH_LOCATIONS.find((l) => l.name === keepName);
      const label = labels.find((l) => l.id === id);
      expect(rect && label).toBeTruthy();
      const centre = ((rect?.minZ ?? 0) + (rect?.maxZ ?? 0)) / 2;
      expect(Math.abs(label?.z ?? 0)).toBeGreaterThan(Math.abs(centre));
      expect(Math.sign(label?.z ?? 0)).toBe(Math.sign(centre));
    }
  });

  it('keeps each graveyard name OUT of the plot the redraw repaints over it', () => {
    // The plot's dirt and its side tint are drawn per redraw on top of the
    // cached plate, so a name anchored inside the rails is buried on the next
    // frame. The anchor has to clear the plot's own half-depth, on the field
    // side of it.
    for (const plot of TH_GRAVEYARDS) {
      const label = bgAtlasLabels().find(
        (l) => l.id === 'graveyard' && Math.sign(l.z) === Math.sign(plot.z),
      );
      expect(label, `graveyard label for plot at z=${plot.z}`).toBeTruthy();
      expect(label?.x).toBe(plot.x);
      expect(Math.abs(label?.z ?? 0)).toBeLessThan(Math.abs(plot.z) - plot.hd);
      // ...and on the FIELD side, not off the back of the map.
      expect(Math.abs(label?.z ?? 0)).toBeGreaterThan(0);
    }
  });

  it('is point-symmetric as a SET, so the turned plate reads the same', () => {
    // The two keeps mirror each other, the two fields mirror each other, and
    // the two graveyards mirror each other: after the 180-degree turn every
    // name lands where a name already was.
    for (const label of labels) {
      expect(
        hasMirror(labels, label.x, label.z),
        `${label.id} at (${label.x}, ${label.z}) has no mirrored twin`,
      ).toBe(true);
    }
  });
});
