import { describe, expect, it } from 'vitest';
import {
  HOLDER_TIER_DEFS,
  holderTierIndexForBalance,
  holderTierByIndex as sharedHolderTierByIndex,
} from '../src/sim/holder_tier';
import {
  HOLDER_TIERS,
  type HolderTier,
  holderCardBadgeClass,
  holderTierBadgeDataUrl,
  holderTierByIndex,
  holderTierForBalance,
  holderTierIsRegalia,
  tierSupplyShare,
  WOC_MAX_SUPPLY,
} from '../src/ui/holder_tier';

describe('holder-tier ladder', () => {
  it('has eighteen rungs with strictly increasing thresholds and 1-based indexes', () => {
    expect(HOLDER_TIERS.length).toBe(18);
    expect(WOC_MAX_SUPPLY).toBe(1_000_000_000);
    for (let i = 0; i < HOLDER_TIERS.length; i++) {
      expect(HOLDER_TIERS[i].index).toBe(i + 1);
      if (i > 0) expect(HOLDER_TIERS[i].threshold).toBeGreaterThan(HOLDER_TIERS[i - 1].threshold);
    }
    expect(HOLDER_TIERS[0].threshold).toBe(1);
    expect(HOLDER_TIERS[HOLDER_TIERS.length - 1].threshold).toBe(WOC_MAX_SUPPLY);
  });

  it('fills the 2%-9% supply-whale band with one rung per whole percent (20M-90M $WOC)', () => {
    for (let percent = 2; percent <= 9; percent++) {
      const tier = holderTierForBalance(percent * 10_000_000)!; // 20M..90M
      expect(tier).not.toBeNull();
      expect(tier.threshold).toBe(percent * 10_000_000);
      expect(tierSupplyShare(tier)).toBeCloseTo(percent / 100, 10); // 2%..9%
      // The band sits strictly between Leviathan (1%) and Worldbearer (10%).
      expect(tier.index).toBeGreaterThan(8);
      expect(tier.index).toBeLessThan(17);
    }
  });

  it('keeps UI presentation rungs aligned with the shared pure tier definitions', () => {
    expect(HOLDER_TIERS.map(({ index, key, threshold }) => ({ index, key, threshold }))).toEqual(
      HOLDER_TIER_DEFS,
    );
  });

  it('returns null with no wallet or a sub-threshold balance', () => {
    expect(holderTierForBalance(null)).toBeNull();
    expect(holderTierForBalance(0)).toBeNull();
    expect(holderTierForBalance(0.99)).toBeNull();
    expect(holderTierForBalance(Number.NaN)).toBeNull();
  });

  it('rejects non-finite and negative balances as null', () => {
    expect(holderTierForBalance(Number.POSITIVE_INFINITY)).toBeNull();
    expect(holderTierForBalance(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(holderTierForBalance(-5)).toBeNull();
  });

  it('treats each threshold as inclusive and just-below as the rung beneath', () => {
    // Exactly at a threshold maps up to that rung…
    expect(holderTierForBalance(1)!.name).toBe('Ember');
    expect(holderTierForBalance(10)!.name).toBe('Coinbearer');
    expect(holderTierForBalance(1_000)!.name).toBe('Silverbound');
    // …and a hair below stays on the rung beneath (or null below the first).
    expect(holderTierForBalance(0.99)).toBeNull();
    expect(holderTierForBalance(9.99)!.name).toBe('Ember');
    expect(holderTierForBalance(999.99)!.name).toBe('Coppercrest');
  });

  it('maps balances to the highest qualifying rung', () => {
    expect(holderTierForBalance(1)!.name).toBe('Ember');
    expect(holderTierForBalance(9)!.name).toBe('Ember');
    expect(holderTierForBalance(10)!.name).toBe('Coinbearer');
    expect(holderTierForBalance(100)!.name).toBe('Coppercrest');
    expect(holderTierForBalance(1_000)!.name).toBe('Silverbound');
    expect(holderTierForBalance(10_000)!.name).toBe('Gilded');
    expect(holderTierForBalance(100_000)!.name).toBe('Vaultwarden');
    expect(holderTierForBalance(1_000_000)!.name).toBe('Whale');
    expect(holderTierForBalance(10_000_000)!.name).toBe('Leviathan');
    expect(holderTierForBalance(20_000_000)!.name).toBe('Tidelord');
    expect(holderTierForBalance(50_000_000)!.name).toBe('Titanforged');
    expect(holderTierForBalance(90_000_000)!.name).toBe('Worldforger');
    expect(holderTierForBalance(100_000_000)!.name).toBe('Worldbearer');
    expect(holderTierForBalance(1_000_000_000)!.name).toBe('Sovereign');
  });

  it('clamps balances above max supply to the top rung', () => {
    expect(holderTierForBalance(5_000_000_000)!.name).toBe('Sovereign');
  });

  it('exposes a server-safe numeric tier lookup from the shared pure module', () => {
    expect(holderTierIndexForBalance(null)).toBe(0);
    expect(holderTierIndexForBalance(0.99)).toBe(0);
    expect(holderTierIndexForBalance(10_000)).toBe(5);
    expect(holderTierIndexForBalance(5_000_000_000)).toBe(18);
  });

  it('reports supply share', () => {
    const sovereign = HOLDER_TIERS[17];
    const vaultwarden = HOLDER_TIERS[5];
    expect(sovereign.name).toBe('Sovereign');
    expect(tierSupplyShare(sovereign)).toBe(1);
    expect(tierSupplyShare(vaultwarden)).toBeCloseTo(0.0001, 10);
  });

  it('builds a valid 64-viewBox SVG data URL for every rung', () => {
    for (const tier of HOLDER_TIERS) {
      const url = holderTierBadgeDataUrl(tier);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 64 64"');
    }
  });

  it('parameterises the band III sigil plate from the rung ring and glow hues', () => {
    // Band III (2%-9% of supply) is the one band whose SVG is drawn straight from
    // the tier ring/glow hues (they double as the halo drivers); bands I/II/IV
    // carry their own material palettes.
    const stormcaller = holderTierByIndex(10)!; // 3% of supply, band III
    expect(stormcaller.glow).not.toBe(stormcaller.ring);
    const svg = decodeURIComponent(holderTierBadgeDataUrl(stormcaller));
    expect(svg).toContain(stormcaller.ring);
    expect(svg).toContain(stormcaller.glow);
    expect(svg).toContain('Gradient'); // gradient fill (no <filter>)
  });

  it('computes each rung supply share as its own threshold over 1e9', () => {
    for (const t of HOLDER_TIERS) {
      expect(tierSupplyShare(t)).toBeCloseTo(t.threshold / 1_000_000_000);
    }
  });

  it('looks up rungs by 1-based index and returns undefined out of range', () => {
    // In range: index n returns the rung whose .index === n.
    const ember = holderTierByIndex(1);
    expect(ember).toBeDefined();
    expect(ember!.name).toBe('Ember');
    expect(ember!.index).toBe(1);

    const gilded = holderTierByIndex(5);
    expect(gilded!.name).toBe('Gilded');
    expect(gilded!.index).toBe(5);

    const sovereign = holderTierByIndex(18);
    expect(sovereign!.name).toBe('Sovereign');
    expect(sovereign!.index).toBe(18);

    // A mid-band rung resolves to its name too.
    const titanforged = holderTierByIndex(12);
    expect(titanforged!.name).toBe('Titanforged');

    // Out of range / zero / negative.
    expect(holderTierByIndex(0)).toBeUndefined();
    expect(holderTierByIndex(19)).toBeUndefined();
    expect(holderTierByIndex(-1)).toBeUndefined();
  });

  it('returns undefined for a non-integer index even within the 1-18 span', () => {
    // 1.5 sits inside the inclusive bounds but addresses no rung.
    expect(holderTierByIndex(1.5)).toBeUndefined();
    expect(holderTierByIndex(9.5)).toBeUndefined();
    expect(sharedHolderTierByIndex(1.5)).toBeUndefined();
    expect(sharedHolderTierByIndex(9.5)).toBeUndefined();
  });

  it('round-trips every rung through holderTierByIndex by its own index', () => {
    for (const t of HOLDER_TIERS) {
      expect(holderTierByIndex(t.index)).toBe(t);
    }
  });

  it('builds a decodable SVG badge for all eighteen rungs', () => {
    expect(HOLDER_TIERS.length).toBe(18);
    for (const t of HOLDER_TIERS) {
      const url = holderTierBadgeDataUrl(t);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg');
    }
  });
});

// The frozen ring/glow hue ramp: the reskin KEEPS these (they are CSS hooks, and
// now also drive the per-tier halo). A drift here is a data regression, caught
// independently of the sim ladder pin below.
const EXPECTED_HUES: Record<string, { ring: string; glow: string }> = {
  ember: { ring: '#ff8a4c', glow: '#ff5e1f' },
  coinbearer: { ring: '#d79a4e', glow: '#b9792e' },
  coppercrest: { ring: '#d27d45', glow: '#a8551f' },
  silverbound: { ring: '#cbd6e2', glow: '#9fb2c9' },
  gilded: { ring: '#ffd24a', glow: '#e0a52a' },
  vaultwarden: { ring: '#57e0b9', glow: '#1fae86' },
  whale: { ring: '#4ea8ff', glow: '#1f6fe0' },
  leviathan: { ring: '#9b6cff', glow: '#6a37e0' },
  tidelord: { ring: '#a66af2', glow: '#7736d1' },
  stormcaller: { ring: '#b168e5', glow: '#8434c3' },
  krakencrown: { ring: '#bc67d8', glow: '#9133b4' },
  titanforged: { ring: '#c765cb', glow: '#9e31a5' },
  starhoard: { ring: '#d363be', glow: '#ab3096' },
  voidwarden: { ring: '#de61b1', glow: '#b82e88' },
  realmshaper: { ring: '#e95fa4', glow: '#c52d79' },
  worldforger: { ring: '#f45e97', glow: '#d22b6a' },
  worldbearer: { ring: '#ff5c8a', glow: '#e02a5c' },
  sovereign: { ring: '#ffe27a', glow: '#ffaa00' },
};

// --- Ascendant Sigils reskin: badge-art regression pins. ---
describe('Ascendant Sigils holder badges', () => {
  const decode = (tier: HolderTier, px = 64) =>
    decodeURIComponent(holderTierBadgeDataUrl(tier, px).slice('data:image/svg+xml,'.length));

  it('produces eighteen pairwise-distinct badge data URLs', () => {
    // The shipped placeholder art leaned on one shared gem device across the whole
    // 2%-9% band (visually near-identical, differing only by dot count); this pins
    // that the reskin keeps every rung its own distinguishable badge.
    const urls = HOLDER_TIERS.map((t) => holderTierBadgeDataUrl(t, 64));
    expect(new Set(urls).size).toBe(18);
  });

  it('lights exactly N of the nine sockets on the band III plate for an N% rung', () => {
    // Each 2%-9% rung lights that many sockets. The lit-socket cream pip (an
    // r="1" cream circle) is the stable per-lit-socket marker in the SVG; unlit
    // sockets have none. Red before the reskin (the old art had zero sockets).
    for (let percent = 2; percent <= 9; percent++) {
      const tier = holderTierForBalance(percent * 10_000_000)!; // 20M..90M
      const lit = (decode(tier).match(/r="1" fill="#fff6df"/g) ?? []).length;
      expect(lit).toBe(percent);
    }
  });

  it('emits no SVG <filter> in any badge (gradients and strokes only)', () => {
    for (const t of HOLDER_TIERS) {
      expect(decode(t)).not.toContain('<filter');
      // Also guard the URI-encoded form the browser actually parses. The word
      // "filter" appears nowhere legitimately, so any occurrence is a smell.
      expect(holderTierBadgeDataUrl(t, 64).toLowerCase()).not.toContain('filter');
    }
  });

  it('freezes the ring/glow hue ramp and keeps the ladder keys/thresholds in lockstep with sim', () => {
    // The reskin must not drift the data the sim, CSS hooks, and halo depend on.
    expect(HOLDER_TIERS.map((t) => t.key)).toEqual(HOLDER_TIER_DEFS.map((d) => d.key));
    expect(HOLDER_TIERS.map((t) => t.threshold)).toEqual(HOLDER_TIER_DEFS.map((d) => d.threshold));
    for (const t of HOLDER_TIERS) {
      const hues = EXPECTED_HUES[t.key];
      expect(hues).toBeDefined();
      expect(t.ring).toBe(hues.ring);
      expect(t.glow).toBe(hues.glow);
    }
  });

  it('marks only the two band IV rungs (Worldbearer, Sovereign) as regalia for the stronger halo', () => {
    for (const t of HOLDER_TIERS) {
      expect(holderTierIsRegalia(t)).toBe(t.index >= 17);
    }
    expect(holderTierIsRegalia(holderTierByIndex(17)!)).toBe(true); // worldbearer
    expect(holderTierIsRegalia(holderTierByIndex(18)!)).toBe(true); // sovereign
    expect(holderTierIsRegalia(holderTierByIndex(16)!)).toBe(false); // worldforger, band III
  });

  it('opts the player-card badge into the halo, with the strong modifier only for regalia', () => {
    // Pins the wiring the inspect/player card threads: every rung gets the halo
    // opt-in class, and only the two band IV regalia get the stronger-halo class.
    for (const t of HOLDER_TIERS) {
      const cls = holderCardBadgeClass(t);
      expect(cls).toContain('inspect-holder-badge');
      expect(cls).toContain('inspect-holder-halo');
      expect(cls.includes('inspect-holder-halo-strong')).toBe(t.index >= 17);
    }
    // The non-regalia class must not accidentally carry the strong modifier as a
    // substring artifact.
    expect(holderCardBadgeClass(holderTierByIndex(16)!)).toBe(
      'inspect-holder-badge inspect-holder-halo',
    );
    expect(holderCardBadgeClass(holderTierByIndex(18)!)).toBe(
      'inspect-holder-badge inspect-holder-halo inspect-holder-halo-strong',
    );
  });

  it('embeds the band II Leviathan full-creature glyph', () => {
    const leviathan = holderTierByIndex(8)!;
    expect(leviathan.name).toBe('Leviathan');
    const svg = decode(leviathan);
    // The bioluminescent flank light and the glowing eye pupil are part of the
    // Leviathan glyph.
    expect(svg).toContain('#b99bff');
    expect(svg).toContain('#e8dcff');
  });
});
