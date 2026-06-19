// $WOC holder-tier "flexonomics" ladder.
//
// A purely cosmetic honor badge derived from how much $WOC a connected wallet
// holds. It grants NO gameplay power (the vanilla-formula invariant forbids
// pay-to-win) — it is flair for the player card and, later, nameplate cosmetics.
//
// This module is intentionally free of DOM, Three.js, and network imports: it is
// plain data + a lookup, so it can be unit-tested in Node and reused anywhere.
// The SVG glyphs are placeholder vector art; a PR note tracks reskinning them
// with proper assets once the feature is proven (see PR discussion).

/** $WOC max supply (1,000,000,000). Percentages on the ladder are relative to this. */
export const WOC_MAX_SUPPLY = 1_000_000_000;

export interface HolderTier {
  /** 1-based rung (1 = Ember … 10 = Sovereign). */
  index: number;
  /** Stable machine key (used for CSS hooks / analytics). */
  key: string;
  /** Display name of the rung. */
  name: string;
  /** Minimum whole-$WOC balance to reach this rung. */
  threshold: number;
  /** Short hype line shown on the card. */
  flavor: string;
  /** Primary ring/accent colour (hex). */
  ring: string;
  /** Outer glow colour (hex). */
  glow: string;
  /** Inner SVG markup for the rung's glyph, drawn centred in a 0 0 64 64 box. */
  glyph: string;
}

// Glyphs are filled with the cream tone below so they read on the dark card and
// against any ring colour.
const GLYPH_FILL = '#fff6df';

// The ten rungs. Thresholds climb by 10× per rung so the ladder spans a single
// $WOC up to the entire supply. Rungs 6-10 also call out their share of supply.
export const HOLDER_TIERS: readonly HolderTier[] = [
  {
    index: 1, key: 'ember', name: 'Ember', threshold: 1,
    flavor: 'The spark is lit.',
    ring: '#ff8a4c', glow: '#ff5e1f',
    glyph: `<path d="M32 7c5 9 15 15 12 27-2 9-8 16-12 22-4-6-10-13-12-22C17 22 27 16 32 7Z" fill="${GLYPH_FILL}"/><path d="M32 26c3 5 7 8 5 14-1 4-3 7-5 9-2-2-4-5-5-9-2-6 2-9 5-14Z" fill="#ff7a3c"/>`,
  },
  {
    index: 2, key: 'coinbearer', name: 'Coinbearer', threshold: 10,
    flavor: 'First coin in the war chest.',
    ring: '#d79a4e', glow: '#b9792e',
    glyph: `<circle cx="32" cy="32" r="17" fill="none" stroke="${GLYPH_FILL}" stroke-width="4"/><path d="M32 21v22M26 26h9a4 4 0 0 1 0 8h-7m0 0h8a4 4 0 0 1 0 8h-9" fill="none" stroke="${GLYPH_FILL}" stroke-width="3.4" stroke-linecap="round"/>`,
  },
  {
    index: 3, key: 'coppercrest', name: 'Coppercrest', threshold: 100,
    flavor: 'Coppers stacked, your name spoken.',
    ring: '#d27d45', glow: '#a8551f',
    glyph: `<path d="M32 8l20 7v15c0 12-9 21-20 26-11-5-20-14-20-26V15l20-7Z" fill="none" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="29" r="6.5" fill="${GLYPH_FILL}"/>`,
  },
  {
    index: 4, key: 'silverbound', name: 'Silverbound', threshold: 1_000,
    flavor: 'Bound in silver, building the bag.',
    ring: '#cbd6e2', glow: '#9fb2c9',
    glyph: `<g fill="none" stroke="${GLYPH_FILL}" stroke-width="3.4"><ellipse cx="32" cy="44" rx="16" ry="6"/><ellipse cx="32" cy="34" rx="16" ry="6"/><ellipse cx="32" cy="24" rx="16" ry="6"/></g>`,
  },
  {
    index: 5, key: 'gilded', name: 'Gilded', threshold: 10_000,
    flavor: 'Gilded and grinning.',
    ring: '#ffd24a', glow: '#e0a52a',
    glyph: `<path d="M32 8l6.6 13.8L54 24l-11 10.8L45.8 50 32 42.6 18.2 50 21 34.8 10 24l15.4-2.2Z" fill="${GLYPH_FILL}"/>`,
  },
  {
    index: 6, key: 'vaultwarden', name: 'Vaultwarden', threshold: 100_000,
    flavor: 'Guarding a real vault now — 0.01% of all $WOC.',
    ring: '#57e0b9', glow: '#1fae86',
    glyph: `<rect x="12" y="16" width="40" height="32" rx="4" fill="none" stroke="${GLYPH_FILL}" stroke-width="4"/><circle cx="32" cy="32" r="7" fill="none" stroke="${GLYPH_FILL}" stroke-width="3.4"/><path d="M32 25v-3M32 39v3M25 32h-3M39 32h3" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round"/>`,
  },
  {
    index: 7, key: 'whale', name: 'Whale', threshold: 1_000_000,
    flavor: 'The deep parts when you swim — 0.1% of supply.',
    ring: '#4ea8ff', glow: '#1f6fe0',
    glyph: `<path d="M10 30c10-10 30-12 40-2 3 3 5 3 8 1-1 7-7 11-14 11 1 4-1 8-5 9l2-7c-9 3-21 1-27-6-3-3-5-4-7-3 0-2 1-3 3-4Z" fill="${GLYPH_FILL}"/><circle cx="22" cy="30" r="2.2" fill="${'#1f6fe0'}"/>`,
  },
  {
    index: 8, key: 'leviathan', name: 'Leviathan', threshold: 10_000_000,
    flavor: 'Markets feel you move — 1% of supply.',
    ring: '#9b6cff', glow: '#6a37e0',
    glyph: `<path d="M8 40c4 0 6-6 10-6s6 6 10 6 6-9 10-9 6 9 10 9 5-4 8-4" fill="none" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round"/><path d="M48 30c3-4 9-4 9-4s-2 6-6 7" fill="none" stroke="${GLYPH_FILL}" stroke-width="3.4" stroke-linecap="round"/><circle cx="51" cy="26" r="2" fill="${GLYPH_FILL}"/>`,
  },
  {
    index: 9, key: 'worldbearer', name: 'Worldbearer', threshold: 100_000_000,
    flavor: 'You carry a piece of the world — 10% of supply.',
    ring: '#ff5c8a', glow: '#e02a5c',
    glyph: `<circle cx="32" cy="32" r="18" fill="none" stroke="${GLYPH_FILL}" stroke-width="4"/><ellipse cx="32" cy="32" rx="8" ry="18" fill="none" stroke="${GLYPH_FILL}" stroke-width="3"/><path d="M14 32h36M17 22h30M17 42h30" stroke="${GLYPH_FILL}" stroke-width="3"/>`,
  },
  {
    index: 10, key: 'sovereign', name: 'Sovereign', threshold: 1_000_000_000,
    flavor: 'The realm bends the knee — the entire supply.',
    ring: '#ffe27a', glow: '#ffaa00',
    glyph: `<path d="M12 22l8 12 12-18 12 18 8-12v24H12V22Z" fill="${GLYPH_FILL}"/><circle cx="12" cy="20" r="3.4" fill="${GLYPH_FILL}"/><circle cx="32" cy="14" r="3.4" fill="${GLYPH_FILL}"/><circle cx="52" cy="20" r="3.4" fill="${GLYPH_FILL}"/><rect x="14" y="48" width="36" height="5" fill="${GLYPH_FILL}"/>`,
  },
] as const;

/**
 * The highest rung a balance qualifies for, or null when there is no connected
 * wallet (balance === null) or the balance is below the first rung (< 1 $WOC).
 */
export function holderTierForBalance(balance: number | null): HolderTier | null {
  if (balance === null || !Number.isFinite(balance) || balance < HOLDER_TIERS[0].threshold) return null;
  let tier: HolderTier | null = null;
  for (const t of HOLDER_TIERS) {
    if (balance >= t.threshold) tier = t;
    else break;
  }
  return tier;
}

/** The rung at a 1-based index (1-10), or undefined for 0/out-of-range. */
export function holderTierByIndex(index: number): HolderTier | undefined {
  return index >= 1 && index <= HOLDER_TIERS.length ? HOLDER_TIERS[index - 1] : undefined;
}

/** This rung's share of max supply, as a fraction in [0, 1]. */
export function tierSupplyShare(tier: HolderTier): number {
  return tier.threshold / WOC_MAX_SUPPLY;
}

/**
 * A standalone SVG data URL for the rung's badge: a glowing ring filled with a
 * ring→glow radial, the glyph centred on top. Suitable for an <img> src or for
 * drawing onto a canvas. `px` sets the rasterised pixel box (the viewBox is
 * always 0 0 64 64, so the glyph scales crisply).
 */
export function holderTierBadgeDataUrl(tier: HolderTier, px = 128): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">` +
    `<defs>` +
    `<radialGradient id="g" cx="38%" cy="32%" r="72%">` +
    `<stop offset="0%" stop-color="${tier.ring}"/>` +
    `<stop offset="100%" stop-color="${tier.glow}"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<circle cx="32" cy="32" r="30" fill="url(#g)"/>` +
    `<circle cx="32" cy="32" r="30" fill="none" stroke="#1c140a" stroke-width="2"/>` +
    `<circle cx="32" cy="32" r="26" fill="none" stroke="#fff6df" stroke-opacity="0.35" stroke-width="1.5"/>` +
    tier.glyph +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
