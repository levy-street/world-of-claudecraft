import { describe, expect, it } from 'vitest';
import {
  DEV_TIER_DEFS,
  DEV_TIER_SIGNIFICANT_INDEX,
  devTierIndexForMergedPrs,
  isSignificantDevTier,
  devTierByIndex as sharedDevTierByIndex,
} from '../src/sim/dev_tier';
import {
  DEV_TIERS,
  type DevTier,
  devCardBadgeClass,
  devTierBadgeDataUrl,
  devTierByIndex,
} from '../src/ui/dev_tier';

// Mirrors the real data flow exactly (the server resolves a merged-PR count to
// an index via devTierIndexForMergedPrs and broadcasts only the index; the
// client always looks the presentation rung up by that index, never re-derives
// one from a raw count), rather than testing through a client-side count lookup
// the codebase doesn't actually have.
function tierNameForMergedPrs(mergedPrs: number | null): string | undefined {
  return devTierByIndex(devTierIndexForMergedPrs(mergedPrs))?.name;
}

describe('dev-tier ladder', () => {
  it('has five rungs with strictly increasing thresholds and 1-based indexes', () => {
    expect(DEV_TIERS.length).toBe(5);
    for (let i = 0; i < DEV_TIERS.length; i++) {
      expect(DEV_TIERS[i].index).toBe(i + 1);
      if (i > 0) expect(DEV_TIERS[i].threshold).toBeGreaterThan(DEV_TIERS[i - 1].threshold);
    }
    expect(DEV_TIERS[0].threshold).toBe(1);
    expect(DEV_TIERS[DEV_TIERS.length - 1].threshold).toBe(70);
  });

  it('keeps UI presentation rungs aligned with the shared pure tier definitions', () => {
    expect(DEV_TIERS.map(({ index, key, threshold }) => ({ index, key, threshold }))).toEqual(
      DEV_TIER_DEFS,
    );
  });

  it('resolves to no rung with no link or a sub-threshold merged-PR count', () => {
    expect(tierNameForMergedPrs(null)).toBeUndefined();
    expect(tierNameForMergedPrs(0)).toBeUndefined();
    expect(tierNameForMergedPrs(0.5)).toBeUndefined();
    expect(tierNameForMergedPrs(Number.NaN)).toBeUndefined();
  });

  it('rejects non-finite and negative merged-PR counts as no rung', () => {
    expect(tierNameForMergedPrs(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(tierNameForMergedPrs(Number.NEGATIVE_INFINITY)).toBeUndefined();
    expect(tierNameForMergedPrs(-5)).toBeUndefined();
  });

  it('treats each threshold as inclusive and just-below as the rung beneath', () => {
    expect(tierNameForMergedPrs(1)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(5)).toBe('Artificer');
    expect(tierNameForMergedPrs(30)).toBe('Architect');
    expect(tierNameForMergedPrs(0.99)).toBeUndefined();
    expect(tierNameForMergedPrs(4)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(14)).toBe('Artificer');
    expect(tierNameForMergedPrs(29)).toBe('Runesmith');
  });

  it('maps merged-PR counts to the highest qualifying rung', () => {
    expect(tierNameForMergedPrs(1)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(4)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(5)).toBe('Artificer');
    expect(tierNameForMergedPrs(15)).toBe('Runesmith');
    expect(tierNameForMergedPrs(30)).toBe('Architect');
    expect(tierNameForMergedPrs(70)).toBe('Worldwright');
    expect(tierNameForMergedPrs(500)).toBe('Worldwright');
  });

  it('exposes a server-safe numeric tier lookup from the shared pure module', () => {
    expect(devTierIndexForMergedPrs(null)).toBe(0);
    expect(devTierIndexForMergedPrs(0)).toBe(0);
    expect(devTierIndexForMergedPrs(0.5)).toBe(0);
    expect(devTierIndexForMergedPrs(5)).toBe(2);
    expect(devTierIndexForMergedPrs(30)).toBe(4);
    expect(devTierIndexForMergedPrs(500)).toBe(5);
  });

  it('looks up rungs by 1-based index and returns undefined out of range', () => {
    expect(devTierByIndex(1)!.name).toBe('Tinkerer');
    expect(devTierByIndex(5)!.name).toBe('Worldwright');
    expect(devTierByIndex(0)).toBeUndefined();
    expect(devTierByIndex(6)).toBeUndefined();
    expect(devTierByIndex(-1)).toBeUndefined();
  });

  it('returns undefined for a non-integer index even within the 1-5 span', () => {
    expect(devTierByIndex(1.5)).toBeUndefined();
    expect(devTierByIndex(3.5)).toBeUndefined();
    expect(sharedDevTierByIndex(2.5)).toBeUndefined();
  });

  it('round-trips every rung through devTierByIndex by its own index', () => {
    for (const t of DEV_TIERS) {
      expect(devTierByIndex(t.index)).toBe(t);
    }
  });

  it('marks Architect and Worldwright as significant contributors, the lower rungs not', () => {
    expect(DEV_TIER_SIGNIFICANT_INDEX).toBe(4);
    expect(isSignificantDevTier(0)).toBe(false);
    expect(isSignificantDevTier(1)).toBe(false);
    expect(isSignificantDevTier(2)).toBe(false);
    expect(isSignificantDevTier(3)).toBe(false);
    expect(isSignificantDevTier(4)).toBe(true);
    expect(isSignificantDevTier(5)).toBe(true);
    expect(isSignificantDevTier(6)).toBe(false);
    expect(isSignificantDevTier(4.5)).toBe(false);
  });

  it('builds a valid, decodable 64-viewBox banner-shield SVG for every rung', () => {
    for (const t of DEV_TIERS) {
      const url = devTierBadgeDataUrl(t);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 64 64"');
      // The ring hue doubles as the merge-graph accent (and the halo hue), so it is
      // present in the art even though the frame gradients use the material ramp.
      expect(svg).toContain(t.ring);
    }
  });
});

// The frozen ring/glow hue ramp (KEPT by the reskin: CSS hooks, name outline, and
// now the badge halo), plus the per-rung merge-graph geometry.
const EXPECTED_DEV_HUES: Record<string, { ring: string; glow: string }> = {
  tinkerer: { ring: '#9aa7b4', glow: '#5d6b78' },
  artificer: { ring: '#5aa9e6', glow: '#2f6fb0' },
  runesmith: { ring: '#9b6cff', glow: '#6a37e0' },
  architect: { ring: '#ffd24a', glow: '#e0a52a' },
  worldwright: { ring: '#ffe9a8', glow: '#ffaa00' },
};
const EXPECTED_BRANCHES: Record<string, number> = {
  tinkerer: 0,
  artificer: 0,
  runesmith: 1,
  architect: 1,
  worldwright: 2,
};
const EXPECTED_NODES: Record<string, number> = {
  tinkerer: 2,
  artificer: 3,
  runesmith: 4,
  architect: 5,
  worldwright: 5,
};

// --- Ascendant Sigils reskin: contributor banner-shield regression pins. ---
describe('Ascendant Sigils contributor badges', () => {
  const decode = (tier: DevTier, px = 64) =>
    decodeURIComponent(devTierBadgeDataUrl(tier, px).slice('data:image/svg+xml,'.length));
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it('produces five pairwise-distinct badge data URLs', () => {
    const urls = DEV_TIERS.map((t) => devTierBadgeDataUrl(t, 64));
    expect(new Set(urls).size).toBe(5);
  });

  it('grows the merge graph per rung: node and merged-lane counts climb', () => {
    // The lit cream markers are the stable per-node / per-lane markers: the head
    // node is r="4.8", body nodes r="3.3", merged-lane midpoints r="2.9". Red
    // before the reskin (the old glyph used a different r="3.4" branch node).
    for (const t of DEV_TIERS) {
      const svg = decode(t);
      const heads = count(svg, 'r="4.8" fill="#fff6df"');
      const bodyNodes = count(svg, 'r="3.3" fill="#fff6df"');
      const lanes = count(svg, 'r="2.9" fill="#fff6df"');
      expect(heads).toBe(1); // exactly one emphasised head node
      expect(1 + bodyNodes).toBe(EXPECTED_NODES[t.key]); // head + body = total nodes
      expect(lanes).toBe(EXPECTED_BRANCHES[t.key]);
    }
  });

  it('gives the five-ray crest to Worldwright alone', () => {
    for (const t of DEV_TIERS) {
      const crestRays = count(decode(t), 'stroke="#140f0a" stroke-width="1"/>');
      expect(crestRays).toBe(t.key === 'worldwright' ? 5 : 0);
    }
  });

  it('emits no SVG <filter> in any badge (gradients and strokes only)', () => {
    for (const t of DEV_TIERS) {
      expect(decode(t)).not.toContain('<filter');
      expect(devTierBadgeDataUrl(t, 64).toLowerCase()).not.toContain('filter');
    }
  });

  it('freezes the ring/glow hue ramp and keeps keys/thresholds in lockstep with sim', () => {
    expect(DEV_TIERS.map((t) => t.key)).toEqual(DEV_TIER_DEFS.map((d) => d.key));
    expect(DEV_TIERS.map((t) => t.threshold)).toEqual(DEV_TIER_DEFS.map((d) => d.threshold));
    for (const t of DEV_TIERS) {
      const hues = EXPECTED_DEV_HUES[t.key];
      expect(hues).toBeDefined();
      expect(t.ring).toBe(hues.ring);
      expect(t.glow).toBe(hues.glow);
    }
  });

  it('opts the inspect dev badge into the halo, strong only for the significant tiers', () => {
    for (const t of DEV_TIERS) {
      const cls = devCardBadgeClass(t);
      expect(cls).toContain('inspect-holder-badge');
      expect(cls).toContain('inspect-dev-halo');
      // significant = Architect (4) and Worldwright (5)
      expect(cls.includes('inspect-dev-halo-strong')).toBe(t.index >= 4);
    }
    expect(devCardBadgeClass(devTierByIndex(3)!)).toBe('inspect-holder-badge inspect-dev-halo');
    expect(devCardBadgeClass(devTierByIndex(5)!)).toBe(
      'inspect-holder-badge inspect-dev-halo inspect-dev-halo-strong',
    );
  });
});
