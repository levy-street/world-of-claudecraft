// Presentation layer for the developer-badge tier ladder.
//
// Mirrors src/ui/holder_tier.ts and src/ui/discord_tier.ts: the pure thresholds
// live in src/sim/dev_tier.ts; this module adds the localized display name, the
// flavor line, the accent colors, and the procedural SVG badge art the HUD,
// nameplate, and player card render. It is DOM-free apart from building an SVG
// data URL string, so it stays unit-testable. All display names/flavors resolve
// through t() against the English-only hudChrome.devBadge.* keys.
//
// The SVG glyph is a procedural "merge graph" device (a trunk of merge nodes
// with branch lanes folding back in, growing richer per rung), deliberately
// distinct from the holder coins/gems and the Discord numerals; a reskin with
// bespoke art can swap the glyphs later without touching the ladder. The visual
// doubles as an apt metaphor for the unit it represents (merged pull requests).
import {
  DEV_TIER_DEFS,
  type DevTierCore,
  type DevTierKey,
  isSignificantDevTier,
  devTierByIndex as sharedDevTierByIndex,
} from '../sim/dev_tier';
import { type TranslationKey, t } from './i18n';

export { DEV_TIER_SIGNIFICANT_INDEX, isSignificantDevTier } from '../sim/dev_tier';

export interface DevTier extends Omit<DevTierCore, 'key'> {
  /** 1-based rung (1 = Tinkerer, 5 = Worldwright). */
  index: number;
  /** Stable machine key (used for CSS hooks / analytics). */
  key: DevTierKey;
  /** Minimum merged-pull-request count to reach this rung. */
  threshold: number;
  /** Display name of the rung. */
  name: string;
  /** Short flavor line shown on the card and inspect screen. */
  flavor: string;
  /** Primary ring/accent colour (hex). */
  ring: string;
  /** Outer glow colour (hex). */
  glow: string;
  /** Inner SVG markup for the rung's glyph, drawn centred in a 0 0 64 64 box. */
  glyph: string;
}

// Glyphs are filled with the cream tone below so they read on the dark card and
// against any ring colour (the same fill the holder glyphs use).
const GLYPH_FILL = '#fff6df';

// One merged side branch off the trunk: a fork-out, a parallel lane, a merge-back
// polyline with a node at its midpoint (one merged pull request). `sign` picks
// the side (-1 left, +1 right). Pure string builder, font-free so it rasterises
// crisply.
function mergeBranch(cx: number, top: number, bot: number, sign: number): string {
  const bx = cx + sign * 16;
  const forkY = top + (bot - top) * 0.28;
  const mergeY = top + (bot - top) * 0.72;
  const midY = (forkY + mergeY) / 2;
  return (
    `<path d="M${cx} ${forkY.toFixed(1)} L${bx} ${(forkY + 7).toFixed(1)} L${bx} ${(mergeY - 7).toFixed(1)} L${cx} ${mergeY.toFixed(1)}" fill="none" stroke="${GLYPH_FILL}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="${bx}" cy="${midY.toFixed(1)}" r="3.4" fill="${GLYPH_FILL}"/>`
  );
}

// A merge-graph glyph: a vertical trunk with `nodes` merge dots (the topmost an
// emphasised hollow HEAD ring) and `branches` merged side lanes. Node count and
// branch count climb per rung so a higher tier reads as more of the tree at a
// glance.
function mergeGraphGlyph(nodes: number, branches: number): string {
  const cx = branches === 1 ? 39 : 32;
  const top = 13;
  const bot = 53;
  let out = `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bot}" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round"/>`;
  if (branches >= 1) out += mergeBranch(cx, top, bot, -1);
  if (branches >= 2) out += mergeBranch(cx, top, bot, 1);
  for (let i = 0; i < nodes; i++) {
    const y = nodes === 1 ? (top + bot) / 2 : top + (i * (bot - top)) / (nodes - 1);
    if (i === 0) {
      out += `<circle cx="${cx}" cy="${y.toFixed(1)}" r="5.4" fill="${GLYPH_FILL}"/><circle cx="${cx}" cy="${y.toFixed(1)}" r="2.6" fill="#1c140a"/>`;
    } else {
      out += `<circle cx="${cx}" cy="${y.toFixed(1)}" r="4" fill="${GLYPH_FILL}"/>`;
    }
  }
  return out;
}

type DevTierPresentation = Omit<DevTier, keyof DevTierCore>;

const DEV_TIER_PRESENTATION: Record<DevTierKey, DevTierPresentation> = {
  tinkerer: {
    name: 'Tinkerer',
    flavor: 'Your first pull request landed in the realm.',
    ring: '#9aa7b4',
    glow: '#5d6b78',
    glyph: mergeGraphGlyph(2, 0),
  },
  artificer: {
    name: 'Artificer',
    flavor: 'Five pull requests in, and the world bends to your code.',
    ring: '#5aa9e6',
    glow: '#2f6fb0',
    glyph: mergeGraphGlyph(3, 0),
  },
  runesmith: {
    name: 'Runesmith',
    flavor: 'Fifteen pull requests forged into the running game.',
    ring: '#9b6cff',
    glow: '#6a37e0',
    glyph: mergeGraphGlyph(4, 1),
  },
  architect: {
    name: 'Architect',
    flavor: 'An architect of the realm: 30 pull requests merged.',
    ring: '#ffd24a',
    glow: '#e0a52a',
    glyph: mergeGraphGlyph(5, 1),
  },
  worldwright: {
    name: 'Worldwright',
    flavor: 'A wright of worlds: 70 pull requests shape the game.',
    ring: '#ffe9a8',
    glow: '#ffaa00',
    glyph: mergeGraphGlyph(5, 2),
  },
};

// The five rungs: the shared pure definition spread with presentation data.
export const DEV_TIERS: readonly DevTier[] = DEV_TIER_DEFS.map((tier) => ({
  ...tier,
  ...DEV_TIER_PRESENTATION[tier.key],
}));

const DEV_TIER_TEXT_KEYS = {
  tinkerer: {
    name: 'hudChrome.devBadge.tiers.tinkerer',
    flavor: 'hudChrome.devBadge.flavors.tinkerer',
  },
  artificer: {
    name: 'hudChrome.devBadge.tiers.artificer',
    flavor: 'hudChrome.devBadge.flavors.artificer',
  },
  runesmith: {
    name: 'hudChrome.devBadge.tiers.runesmith',
    flavor: 'hudChrome.devBadge.flavors.runesmith',
  },
  architect: {
    name: 'hudChrome.devBadge.tiers.architect',
    flavor: 'hudChrome.devBadge.flavors.architect',
  },
  worldwright: {
    name: 'hudChrome.devBadge.tiers.worldwright',
    flavor: 'hudChrome.devBadge.flavors.worldwright',
  },
} satisfies Record<DevTierKey, { name: TranslationKey; flavor: TranslationKey }>;

/** Localized display name for a dev-tier rung. */
export function devTierDisplayName(tier: DevTier): string {
  return t(DEV_TIER_TEXT_KEYS[tier.key].name);
}

/** Localized flavor line for a dev-tier rung. */
export function devTierFlavorText(tier: DevTier): string {
  return t(DEV_TIER_TEXT_KEYS[tier.key].flavor);
}

// No devTierForMergedPrs() here (unlike holderTierForBalance(), which the
// player card derives client-side from a raw $WOC balance): the server always
// resolves and broadcasts the tier INDEX (the wire `dvt` field), never a raw
// merged-PR count for the client to re-derive a tier from, so every consumer
// looks the rung up by index. Add a count-based lookup only if a client-side
// derivation actually needs one (src/sim/dev_tier.ts's devTierForMergedPrs is
// the place to wrap, mirroring this file's other thin wrappers).

/** The presentation rung at a 1-based index (1-5), or undefined for 0/out-of-range. */
export function devTierByIndex(index: number): DevTier | undefined {
  const shared = sharedDevTierByIndex(index);
  return shared ? DEV_TIERS[shared.index - 1] : undefined;
}

/**
 * The glowing nameplate-outline colour for a 1-based rung index, or null when the
 * rung is not a "significant contributor" (or out of range). Drives the distinct
 * name outline that composes on top of the existing name colour (Discord
 * staff/default) for Architect and Worldwright.
 */
export function devTierNameOutlineColor(index: number): string | null {
  const tier = devTierByIndex(index);
  return tier && isSignificantDevTier(index) ? tier.ring : null;
}

/**
 * A standalone SVG data URL for the rung's badge: a glowing ring filled with a
 * ring->glow radial, the merge-graph glyph centred on top. Suitable for an <img>
 * src or for drawing onto a canvas. `px` sets the rasterised pixel box (the
 * viewBox is always 0 0 64 64, so the glyph scales crisply).
 */
export function devTierBadgeDataUrl(tier: DevTier, px = 128): string {
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
