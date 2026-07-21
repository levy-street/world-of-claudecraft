// Presentation layer for the developer-badge tier ladder ("The Contributor
// Ladder", part of the Ascendant Sigils system).
//
// Mirrors src/ui/holder_tier.ts and src/ui/discord_tier.ts: the pure thresholds
// live in src/sim/dev_tier.ts; this module adds the localized display name, the
// flavor line, the accent colors, and the procedural SVG badge art the HUD,
// nameplate, and player card render. It is DOM-free apart from building an SVG
// data URL string, so it stays unit-testable. All display names/flavors resolve
// through t() against the English-only hudChrome.devBadge.* keys.
//
// A separate honor gets a separate silhouette so earned rank is never mistaken for
// bought rank: contributors keep their merge-graph metaphor (every node a merged
// pull request, more nodes and more merged lanes per rung) on a riveted
// banner-shield frame, climbing a maker's material ramp (steel, blued steel, runed
// violet, gold, and a crested pale gold for Worldwright). Every badge is font-free
// inline SVG, gradients and strokes only (no <filter>), viewBox 0 0 64 64. Static
// gradient ids are fine because each data URL is its own document.
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
  /** Primary ring/accent colour (hex). Also the badge halo hue (CSS `--dev-glow`). */
  ring: string;
  /** Outer glow colour (hex). */
  glow: string;
}

type DevTierPresentation = Omit<DevTier, keyof DevTierCore>;

const DEV_TIER_PRESENTATION: Record<DevTierKey, DevTierPresentation> = {
  tinkerer: {
    name: 'Tinkerer',
    flavor: 'Your first pull request landed in the realm.',
    ring: '#9aa7b4',
    glow: '#5d6b78',
  },
  artificer: {
    name: 'Artificer',
    flavor: 'Five pull requests in, and the world bends to your code.',
    ring: '#5aa9e6',
    glow: '#2f6fb0',
  },
  runesmith: {
    name: 'Runesmith',
    flavor: 'Fifteen pull requests forged into the running game.',
    ring: '#9b6cff',
    glow: '#6a37e0',
  },
  architect: {
    name: 'Architect',
    flavor: 'An architect of the realm: 30 pull requests merged.',
    ring: '#ffd24a',
    glow: '#e0a52a',
  },
  worldwright: {
    name: 'Worldwright',
    flavor: 'A wright of worlds: 70 pull requests shape the game.',
    ring: '#ffe9a8',
    glow: '#ffaa00',
  },
};

// The five rungs: the shared pure definition spread with presentation data.
export const DEV_TIERS: readonly DevTier[] = DEV_TIER_DEFS.map((tier) => ({
  ...tier,
  ...DEV_TIER_PRESENTATION[tier.key],
}));

// ---------------------------------------------------------------------------
// Banner-shield badge art. Font-free inline SVG, 64x64 viewBox, gradients +
// strokes only (no <filter>). Static gradient ids: each badge is its own
// document, so `m`/`f` never collide.
// ---------------------------------------------------------------------------

// Shared keyline + cream tones (the same the holder badges use).
const KEYLINE = '#140f0a';
const CREAM = '#fff6df';

type GradientStop = readonly [offset: number | string, color: string];

function defs(inner: string): string {
  return `<defs>${inner}</defs>`;
}
function lin(
  id: string,
  stops: GradientStop[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return (
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('') +
    `</linearGradient>`
  );
}
function rad(id: string, stops: GradientStop[], cx: string, cy: string, r: string): string {
  return (
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">` +
    stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('') +
    `</radialGradient>`
  );
}
function wrapSvg(px: number, inner: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${inner}</svg>`,
  )}`;
}

interface BannerMaterial {
  hi: string;
  mid: string;
  lo: string;
  faceHi: string;
  faceLo: string;
  accent: string;
  accentDeep: string;
}
interface BannerArt {
  mat: BannerMaterial;
  /** merge-graph trunk nodes (the topmost drawn as an emphasised HEAD). */
  nodes: number;
  /** merged side lanes folding back into the trunk (0, 1, or 2). */
  branches: number;
  /** the five-ray crest, Worldwright only. */
  crest: boolean;
}

// The refined merge graph: a beveled cream trunk with `nodes` nodes (the topmost an
// emphasised head) and `branches` merged side lanes in the tier accent. More nodes
// and lanes per rung so a higher tier reads as more of the tree at a glance.
function refinedMergeGraph(
  nodes: number,
  branches: number,
  accent: string,
  accentDeep: string,
): string {
  const cx = 32;
  const top = 17;
  const bot = 47;
  let out = '';
  const lane = (sign: number): string => {
    const bx = cx + sign * 11.5;
    const forkY = top + (bot - top) * 0.24;
    const mergeY = top + (bot - top) * 0.76;
    const midY = (forkY + mergeY) / 2;
    const d =
      `M${cx} ${forkY.toFixed(1)} Q${bx} ${forkY.toFixed(1)} ${bx} ${(midY - 3).toFixed(1)}` +
      ` L${bx} ${(midY + 3).toFixed(1)} Q${bx} ${mergeY.toFixed(1)} ${cx} ${mergeY.toFixed(1)}`;
    return (
      `<path d="${d}" fill="none" stroke="${accentDeep}" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<circle cx="${bx}" cy="${midY.toFixed(1)}" r="2.9" fill="${CREAM}"/>` +
      `<circle cx="${bx}" cy="${midY.toFixed(1)}" r="2.9" fill="none" stroke="${accentDeep}" stroke-width="1" stroke-opacity="0.6"/>`
    );
  };
  if (branches >= 1) out += lane(-1);
  if (branches >= 2) out += lane(1);
  // trunk: dark understroke + cream over = beveled rail
  out += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bot}" stroke="${accentDeep}" stroke-width="4.6" stroke-linecap="round"/>`;
  out += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bot}" stroke="${CREAM}" stroke-width="2.4" stroke-linecap="round"/>`;
  for (let i = 0; i < nodes; i++) {
    const y = nodes === 1 ? (top + bot) / 2 : top + (i * (bot - top)) / (nodes - 1);
    if (i === 0) {
      out +=
        `<circle cx="${cx}" cy="${y.toFixed(1)}" r="4.8" fill="${CREAM}"/>` +
        `<circle cx="${cx}" cy="${y.toFixed(1)}" r="4.8" fill="none" stroke="${accentDeep}" stroke-width="1.1" stroke-opacity="0.7"/>` +
        `<circle cx="${cx}" cy="${y.toFixed(1)}" r="2.2" fill="${accent}"/>`;
    } else {
      out +=
        `<circle cx="${cx}" cy="${y.toFixed(1)}" r="3.3" fill="${CREAM}"/>` +
        `<circle cx="${cx}" cy="${y.toFixed(1)}" r="3.3" fill="none" stroke="${accentDeep}" stroke-width="1" stroke-opacity="0.55"/>`;
    }
  }
  return out;
}

// The riveted banner-shield frame carrying the merge graph. A crest (five rays over
// the top edge) marks the apex rung only.
function bannerBadge(art: BannerArt, px: number): string {
  const { mat, nodes, branches, crest } = art;
  const outer = 'M12 8 H52 V42 L32 57 L12 42 Z';
  const inner = 'M16 12 H48 V40 L32 52 L16 40 Z';
  let crestRays = '';
  if (crest) {
    for (let i = -2; i <= 2; i++) {
      const x = 32 + i * 8.4;
      const h = i === 0 ? 6.4 : Math.abs(i) === 1 ? 4.6 : 3;
      crestRays += `<path d="M${x - 2.4} 8 L${x} ${(8 - h).toFixed(1)} L${x + 2.4} 8 Z" fill="${mat.hi}" stroke="${KEYLINE}" stroke-width="1"/>`;
    }
  }
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, mat.hi],
          [0.5, mat.mid],
          [1, mat.lo],
        ],
        0,
        0,
        0.35,
        1,
      ) +
        rad(
          'f',
          [
            [0, mat.faceHi],
            [1, mat.faceLo],
          ],
          '42%',
          '26%',
          '90%',
        ),
    ) +
      crestRays +
      `<path d="${outer}" fill="url(#m)"/>` +
      `<path d="${outer}" fill="none" stroke="${KEYLINE}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="${inner}" fill="url(#f)"/>` +
      `<path d="${inner}" fill="none" stroke="${KEYLINE}" stroke-opacity="0.55" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<path d="M17.2 13.2 H46.8" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.6" stroke-linecap="round"/>` +
      // corner rivets
      `<circle cx="14.8" cy="10.8" r="1.5" fill="${CREAM}" fill-opacity="0.8"/>` +
      `<circle cx="49.2" cy="10.8" r="1.5" fill="${CREAM}" fill-opacity="0.8"/>` +
      `<circle cx="14.8" cy="40.6" r="1.5" fill="${CREAM}" fill-opacity="0.8"/>` +
      `<circle cx="49.2" cy="40.6" r="1.5" fill="${CREAM}" fill-opacity="0.8"/>` +
      refinedMergeGraph(nodes, branches, mat.accent, mat.accentDeep),
  );
}

const DEV_TIER_ART: Record<DevTierKey, BannerArt> = {
  tinkerer: {
    mat: {
      hi: '#cfd8e0',
      mid: '#7c8a96',
      lo: '#323c46',
      faceHi: '#46525e',
      faceLo: '#232b33',
      accent: '#9aa7b4',
      accentDeep: '#3a444e',
    },
    nodes: 2,
    branches: 0,
    crest: false,
  },
  artificer: {
    mat: {
      hi: '#7cbcf0',
      mid: '#2f6fb0',
      lo: '#122f52',
      faceHi: '#1b3f66',
      faceLo: '#0d2138',
      accent: '#5aa9e6',
      accentDeep: '#173a5e',
    },
    nodes: 3,
    branches: 0,
    crest: false,
  },
  runesmith: {
    mat: {
      hi: '#b391ff',
      mid: '#6a37e0',
      lo: '#2a1266',
      faceHi: '#3a1f7d',
      faceLo: '#1c0d44',
      accent: '#9b6cff',
      accentDeep: '#301660',
    },
    nodes: 4,
    branches: 1,
    crest: false,
  },
  architect: {
    mat: {
      hi: '#ffe08a',
      mid: '#d8a437',
      lo: '#63400f',
      faceHi: '#7d5514',
      faceLo: '#3c2809',
      accent: '#ffd24a',
      accentDeep: '#6b4310',
    },
    nodes: 5,
    branches: 1,
    crest: false,
  },
  worldwright: {
    mat: {
      hi: '#fff0bc',
      mid: '#e8b23c',
      lo: '#7a4c0e',
      faceHi: '#8a5c17',
      faceLo: '#41290a',
      accent: '#ffe9a8',
      accentDeep: '#7a4c0e',
    },
    nodes: 5,
    branches: 2,
    crest: true,
  },
};

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
 * The class list for the dev badge `<img>` on the inspect/player card: the base
 * badge, the halo opt-in, and (significant-contributor rungs only) the stronger
 * modifier. The glow hue is supplied separately by the caller via an inline
 * `--dev-glow`. Mirrors holderCardBadgeClass so the strong-halo branch has a
 * decisive test rather than living inline in the card-build HTML.
 */
export function devCardBadgeClass(tier: Pick<DevTier, 'index'>): string {
  const base = 'inspect-holder-badge inspect-dev-halo';
  return isSignificantDevTier(tier.index) ? `${base} inspect-dev-halo-strong` : base;
}

/**
 * A standalone SVG data URL for the rung's banner-shield badge: the riveted frame
 * carrying the refined merge graph, in the rung's material. Suitable for an <img>
 * src or a canvas draw. `px` sets the rasterised pixel box (the viewBox is always
 * 0 0 64 64, so the art scales crisply). Font-free, filter-free; each URL is its
 * own document.
 */
export function devTierBadgeDataUrl(tier: DevTier, px = 128): string {
  return bannerBadge(DEV_TIER_ART[tier.key], px);
}
