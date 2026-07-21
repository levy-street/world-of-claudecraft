// Leaderboard "Top N%" percentile tiers — a cosmetic rank ladder for the
// shareable player card, parallel to the $WOC holder-tier flair but driven by
// the character's realm standing by lifetime XP (server: lifetimeXpStanding),
// not wallet balance. Purely presentational: it grants no gameplay power.
//
// A character's raw percentile (rank/total × 100, e.g. 3.2) buckets to the
// ceiling whole percent — 3.2 → "Top 4%", 0.6 → "Top 1%" — so each of Top 1%
// through Top 10% has its own tier medal. Above 10% there is no tier (the card
// shows a plain "Top N%" chip instead).
//
// Each rung carries an MMO-style RARITY (legendary at the apex → common), which
// drives a rarity-graded radiant glow (and an apex sunburst) baked into the medal
// SVG — brightest at the top, plain at the bottom. The medal is only ever drawn
// onto the card canvas, so it renders as one static glowing frame.
//
// DOM/Three/network-free: plain data + an SVG data-URL builder, unit-testable in
// Node and drawable onto a canvas.

/** Highest percentile bucket that earns a tier medal (Top 1%…Top 10%). */
export const PERCENTILE_TIER_MAX = 10;

/** MMO item-quality grades, apex to floor, driving glow + pulse intensity. */
export type PercentileRarity = 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common';

export interface PercentileTier {
  /** Whole-percent bucket and 1-based rung: 1 = Top 1% (apex) … 10 = Top 10%. */
  percent: number;
  /** Stable machine key (CSS hooks / analytics). */
  key: string;
  /** Primary ring/accent colour (hex). */
  ring: string;
  /** Outer glow colour (hex). */
  glow: string;
  /** Item-quality grade — sets the medal's radiance (halo + apex sunburst). */
  rarity: PercentileRarity;
}

// Gold → silver → bronze → copper prestige gradient, brightest at the apex. Each
// rung is a distinct shade so the ten medals never read as the same colour. The
// rarity grade escalates the visual treatment toward the top: only the rarest
// ranks earn a halo glow (and the legendary apex a sunburst), the way only
// epic/legendary loot glows.
export const PERCENTILE_TIERS: readonly PercentileTier[] = [
  { percent: 1, key: 'top1', ring: '#ffe27a', glow: '#ffaa00', rarity: 'legendary' },
  { percent: 2, key: 'top2', ring: '#ffd24a', glow: '#e0a52a', rarity: 'epic' },
  { percent: 3, key: 'top3', ring: '#f0c674', glow: '#c99a3e', rarity: 'epic' },
  { percent: 4, key: 'top4', ring: '#e6dab4', glow: '#bfb083', rarity: 'rare' },
  { percent: 5, key: 'top5', ring: '#dfe7f0', glow: '#aebccd', rarity: 'rare' },
  { percent: 6, key: 'top6', ring: '#c6d0dc', glow: '#93a3b6', rarity: 'rare' },
  { percent: 7, key: 'top7', ring: '#e0a45a', glow: '#b9792e', rarity: 'uncommon' },
  { percent: 8, key: 'top8', ring: '#d18f4a', glow: '#a8551f', rarity: 'uncommon' },
  { percent: 9, key: 'top9', ring: '#c07f44', glow: '#8a4f24', rarity: 'common' },
  { percent: 10, key: 'top10', ring: '#a86b3a', glow: '#6e3d1c', rarity: 'common' },
] as const;

export interface RarityStyle {
  /** Opacity of the outer halo bloom (0 = no halo). */
  halo: number;
  /** Whether to draw a sunburst of rays behind the disc (apex only). */
  rays: boolean;
}

const RARITY_STYLE: Record<PercentileRarity, RarityStyle> = {
  legendary: { halo: 0.95, rays: true },
  epic: { halo: 0.7, rays: false },
  rare: { halo: 0.4, rays: false },
  uncommon: { halo: 0, rays: false },
  common: { halo: 0, rays: false },
};

/** The glow treatment for a rarity grade (halo opacity + apex sunburst rays). */
export function percentileRarityStyle(rarity: PercentileRarity): RarityStyle {
  return RARITY_STYLE[rarity];
}

// A laurel wreath framing a five-point star — the universal "top rank" motif,
// filled in the cream tone so it reads on every ring colour. Shared by all rungs;
// the ring colour + rarity glow are what distinguish them.
const GLYPH_FILL = '#fff6df';
const LAUREL_STAR =
  `<path d="M32 17.5l2.7 6 6.5.6-4.9 4.4 1.4 6.4-5.7-3.3-5.7 3.3 1.4-6.4-4.9-4.4 6.5-.6z" fill="${GLYPH_FILL}"/>` +
  `<g fill="none" stroke="${GLYPH_FILL}" stroke-width="2.3" stroke-linecap="round">` +
  `<path d="M23 45c-6.5-3.5-9.5-10.5-7.5-19"/>` +
  `<path d="M41 45c6.5-3.5 9.5-10.5 7.5-19"/>` +
  `</g>` +
  `<g fill="${GLYPH_FILL}">` +
  `<ellipse cx="17.5" cy="30" rx="2.2" ry="3.4" transform="rotate(-32 17.5 30)"/>` +
  `<ellipse cx="19.5" cy="37" rx="2.2" ry="3.4" transform="rotate(-20 19.5 37)"/>` +
  `<ellipse cx="46.5" cy="30" rx="2.2" ry="3.4" transform="rotate(32 46.5 30)"/>` +
  `<ellipse cx="44.5" cy="37" rx="2.2" ry="3.4" transform="rotate(20 44.5 37)"/>` +
  `</g>`;

/**
 * The percentile tier a raw realm percentile earns, or null when there is none —
 * no standing (`pct === null`), a non-finite/non-positive value, or a percentile
 * worse than Top {@link PERCENTILE_TIER_MAX}% (which the card shows as a plain
 * chip). The bucket is the ceiling whole percent, clamped so a sub-1% rank maps
 * to the apex Top 1% rung.
 */
export function percentileTierForPercent(pct: number | null): PercentileTier | null {
  if (pct === null || !Number.isFinite(pct) || pct <= 0 || pct > PERCENTILE_TIER_MAX) return null;
  const bucket = Math.max(1, Math.ceil(pct));
  return PERCENTILE_TIERS[bucket - 1] ?? null;
}

// A 12-spoke sunburst behind the disc (apex legendary only): thin static rays
// near the rim, in the ring colour, behind the halo.
function sunburstRays(color: string): string {
  let spokes = '';
  for (let i = 0; i < 12; i++) {
    spokes += `<rect x="31.2" y="0.5" width="1.6" height="5" rx="0.8" fill="${color}" transform="rotate(${i * 30} 32 32)"/>`;
  }
  return `<g opacity="0.55">${spokes}</g>`;
}

/**
 * A standalone SVG data URL for a tier's medal: a ring→glow radial disc with the
 * laurel-and-star glyph, plus a rarity-graded outer halo (and, for the legendary
 * apex, a sunburst). Drawn onto the card canvas it renders one static glowing
 * frame. The viewBox is always `0 0 64 64`; `px` sets the rasterised pixel box.
 */
export function percentileTierBadgeDataUrl(tier: PercentileTier, px = 128): string {
  const gid = `g${tier.key}`; // per-tier ids so two medals in one document never collide
  const hid = `h${tier.key}`;
  const style = RARITY_STYLE[tier.rarity];

  const defs =
    `<radialGradient id="${gid}" cx="38%" cy="32%" r="72%">` +
    `<stop offset="0%" stop-color="${tier.ring}"/>` +
    `<stop offset="100%" stop-color="${tier.glow}"/>` +
    `</radialGradient>` +
    (style.halo > 0
      ? `<radialGradient id="${hid}" cx="50%" cy="50%" r="50%">` +
        `<stop offset="74%" stop-color="${tier.ring}" stop-opacity="0"/>` +
        `<stop offset="88%" stop-color="${tier.ring}" stop-opacity="0.7"/>` +
        `<stop offset="100%" stop-color="${tier.ring}" stop-opacity="0"/>` +
        `</radialGradient>`
      : '');

  const glow = style.halo > 0
    ? `<circle cx="32" cy="32" r="31.5" fill="url(#${hid})" opacity="${style.halo}"/>`
    : '';
  const rays = style.rays ? sunburstRays(tier.ring) : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">` +
    `<defs>${defs}</defs>` +
    glow +
    rays +
    `<circle cx="32" cy="32" r="27" fill="url(#${gid})"/>` +
    `<circle cx="32" cy="32" r="27" fill="none" stroke="#1c140a" stroke-width="2"/>` +
    `<circle cx="32" cy="32" r="23.5" fill="none" stroke="#fff6df" stroke-opacity="0.35" stroke-width="1.5"/>` +
    LAUREL_STAR +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
