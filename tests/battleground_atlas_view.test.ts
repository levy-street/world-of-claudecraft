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

  it('draws only crowns, boulders and headstones, each with a real radius', () => {
    expect(marks.length).toBeGreaterThan(100);
    for (const mark of marks) {
      expect(['crown', 'boulder', 'headstone']).toContain(mark.kind);
      expect(mark.r).toBeGreaterThan(0);
      expect(Number.isFinite(mark.x) && Number.isFinite(mark.z)).toBe(true);
    }
    // All three kinds are really present, so a filter that silently stopped
    // matching one of the asset families fails here.
    expect(marks.some((m) => m.kind === 'crown')).toBe(true);
    expect(marks.some((m) => m.kind === 'boulder')).toBe(true);
    expect(marks.some((m) => m.kind === 'headstone')).toBe(true);
  });

  it('stipples each graveyard plot with a fixed grid of headstones inside its rails', () => {
    // The plot is drawn GROUND on the plate (its own surface family in the
    // relief core), and these are the marks that say what that ground is. They
    // are a deterministic grid read off the authored plot rectangle: no
    // randomness, and never outside the rails, where they would read as loose
    // rock on the field instead of as a graveyard.
    const stones = marks.filter((m) => m.kind === 'headstone');
    expect(stones.length).toBe(6 * TH_GRAVEYARDS.length);
    for (const plot of TH_GRAVEYARDS) {
      const mine = stones.filter(
        (m) => Math.abs(m.x - plot.x) <= plot.hw && Math.abs(m.z - plot.z) <= plot.hd,
      );
      expect(mine, `headstones on the plot at (${plot.x}, ${plot.z})`).toHaveLength(6);
      // Two rows of three, so the grid is a plot and not a line of pips.
      expect(new Set(mine.map((m) => m.z)).size).toBe(2);
      expect(new Set(mine.map((m) => m.x)).size).toBe(3);
      // Small: a headstone must stipple, never blot out the plot it stands on.
      for (const stone of mine) expect(stone.r).toBeLessThan(plot.hd / 4);
    }
  });

  it('stands every mark on a real placement of the matching asset family', () => {
    // Decisive against invented dressing: each mark must sit exactly on a
    // placement whose assetId is a tree (crown) or rock/rubble (boulder). The
    // headstones are the one drawn kind with no placement of its own: they come
    // off the authored graveyard rectangles (arm above), so they are excluded
    // here rather than exempted from being checked at all.
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
      if (mark.kind === 'headstone') continue;
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
    for (const kind of ['crown', 'boulder', 'headstone'] as const) {
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
    // ONE title per end of the field: the old separate "Crimson Field" and
    // "Azure Field" names are gone, and the keep name titles the whole
    // territory. A regression that re-added them shows up as an extra id here.
    expect(Object.fromEntries(counts)).toEqual({
      crimsonKeep: 1,
      azureKeep: 1,
      ruinCourtyard: 1,
      graveyard: TH_GRAVEYARDS.length,
    });
  });

  it('resolves every region label against a LOCATION the map still declares', () => {
    // The anchors are read by NAME off a generated table. If the map renames or
    // drops one, the label silently disappears from the plate; this is where
    // that shows up instead. The two field chambers are still read (the merged
    // keep title is anchored halfway to the chamber it owns), they are just no
    // longer written on the plate under their own names.
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
    expect(labels.filter((l) => l.tier === 'region')).toHaveLength(3);
    expect(labels.filter((l) => l.tier === 'place')).toHaveLength(TH_GRAVEYARDS.length);
  });

  it('anchors every label inside the field, and titles each whole territory', () => {
    for (const l of labels) {
      expect(Math.abs(l.x)).toBeLessThanOrEqual(TH_HALF_X);
      expect(Math.abs(l.z)).toBeLessThanOrEqual(TH_HALF_Z);
    }
    // The merged title names the keep AND the chamber in front of it, so it
    // sits midway between the two anchors it replaced: the old back-of-the-keep
    // anchor (the keep rect's far end, inset past the flag stand's banner
    // glyph) and the chamber rectangle's centre. Derived here from the same
    // authored rectangles, so a moved keep or a moved chamber moves the title.
    const KEEP_LABEL_INSET = 6;
    for (const [id, keepName, fieldName] of [
      ['crimsonKeep', 'Crimson Keep', 'Crimson Field'],
      ['azureKeep', 'Azure Keep', 'Azure Field'],
    ] as const) {
      const keep = TH_LOCATIONS.find((l) => l.name === keepName);
      const field = TH_LOCATIONS.find((l) => l.name === fieldName);
      const label = labels.find((l) => l.id === id);
      expect(keep && field && label).toBeTruthy();
      const keepCentre = ((keep?.minZ ?? 0) + (keep?.maxZ ?? 0)) / 2;
      const keepAnchor =
        (keepCentre < 0 ? (keep?.minZ ?? 0) : (keep?.maxZ ?? 0)) -
        Math.sign(keepCentre) * KEEP_LABEL_INSET;
      const fieldAnchor = ((field?.minZ ?? 0) + (field?.maxZ ?? 0)) / 2;
      expect(label?.z).toBeCloseTo((keepAnchor + fieldAnchor) / 2, 9);
      expect(label?.x).toBeCloseTo(((keep?.minX ?? 0) + (keep?.maxX ?? 0)) / 2, 9);
      // It really moved OFF the keep, toward the field it now also names, and
      // it stayed on its own end of the map.
      expect(Math.abs(label?.z ?? 0)).toBeLessThan(Math.abs(keepAnchor));
      expect(Math.abs(label?.z ?? 0)).toBeGreaterThan(Math.abs(fieldAnchor));
      expect(Math.sign(label?.z ?? 0)).toBe(Math.sign(keepCentre));
    }
  });

  it('keeps each graveyard name OUT of the plot the headstones stand on', () => {
    // The plot is drawn ground with headstone stipples on it, so a name
    // anchored inside the rails fights the stones for the same few pixels. The
    // anchor has to clear the plot's own half-depth, on the field side of it.
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
    // The two territory titles mirror each other and the two graveyards mirror
    // each other (the courtyard sits on the origin): after the 180-degree turn
    // every name lands where a name already was. This is the mirror-honesty
    // half of the merged titles: both ends read at the same distance in.
    for (const label of labels) {
      expect(
        hasMirror(labels, label.x, label.z),
        `${label.id} at (${label.x}, ${label.z}) has no mirrored twin`,
      ).toBe(true);
    }
  });
});
