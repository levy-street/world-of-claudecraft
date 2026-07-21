// $WOC holder-tier "flexonomics" ladder.
//
// A purely cosmetic honor badge derived from how much $WOC a connected wallet
// holds. It grants NO gameplay power (the classic-formula invariant forbids
// pay-to-win); it is flair for the player card and the nameplate cosmetics.
//
// This module is intentionally free of DOM, Three.js, and network imports: it is
// plain data + a lookup, so it can be unit-tested in Node and reused anywhere.
//
// The badge art is the "Ascendant Sigils" system (approved out of band). The rank
// grammar reads at nameplate size: the frame SHAPE encodes the band, the MATERIAL
// encodes the rung. Band I (1-5) is a faceted coin with a milled edge and a
// material ramp; Band II (6-8) is a cut-gem hexagon; Band III (9-16) is an
// eight-point sigil plate whose nine-socket ring lights N sockets for an N%-of-
// supply rung (the parametric device that replaced the old shared gem-plus-dots
// glyph); Band IV (17-18) is unique regalia. Every badge is font-free inline SVG
// composed into a data URL by holderTierBadgeDataUrl(): gradients and strokes
// only, no <filter> elements, viewBox 0 0 64 64, valid when URI-encoded. Static
// gradient ids are fine because each data URL is its own SVG document.
import {
  HOLDER_TIER_DEFS,
  type HolderTierCore,
  type HolderTierKey,
  holderTierByIndex as sharedHolderTierByIndex,
  holderTierForBalance as sharedHolderTierForBalance,
  tierSupplyShare as sharedTierSupplyShare,
} from '../sim/holder_tier';
import { type TranslationKey, t } from './i18n';

export { WOC_MAX_SUPPLY } from '../sim/holder_tier';

export interface HolderTier extends Omit<HolderTierCore, 'key'> {
  /** 1-based rung (1 = Ember … 18 = Sovereign). */
  index: number;
  /** Stable machine key (used for CSS hooks / analytics). */
  key: HolderTierKey;
  /** Display name of the rung. */
  name: string;
  /** Minimum whole-$WOC balance to reach this rung. */
  threshold: number;
  /** Short hype line shown on the card. */
  flavor: string;
  /** Primary ring/accent colour (hex). Also the band III sigil hue and the halo. */
  ring: string;
  /** Outer glow colour (hex). Also the band III deep hue and the halo. */
  glow: string;
}

type HolderTierPresentation = Omit<HolderTier, keyof HolderTierCore>;

const HOLDER_TIER_PRESENTATION: Record<HolderTierKey, HolderTierPresentation> = {
  ember: { name: 'Ember', flavor: 'The spark is lit.', ring: '#ff8a4c', glow: '#ff5e1f' },
  coinbearer: {
    name: 'Coinbearer',
    flavor: 'First coin in the war chest.',
    ring: '#d79a4e',
    glow: '#b9792e',
  },
  coppercrest: {
    name: 'Coppercrest',
    flavor: 'Coppers stacked, your name spoken.',
    ring: '#d27d45',
    glow: '#a8551f',
  },
  silverbound: {
    name: 'Silverbound',
    flavor: 'Bound in silver, building the bag.',
    ring: '#cbd6e2',
    glow: '#9fb2c9',
  },
  gilded: { name: 'Gilded', flavor: 'Gilded and grinning.', ring: '#ffd24a', glow: '#e0a52a' },
  vaultwarden: {
    name: 'Vaultwarden',
    flavor: 'Guarding a real vault now: 0.01% of all $WOC.',
    ring: '#57e0b9',
    glow: '#1fae86',
  },
  whale: {
    name: 'Whale',
    flavor: 'The deep parts when you swim: 0.1% of supply.',
    ring: '#4ea8ff',
    glow: '#1f6fe0',
  },
  leviathan: {
    name: 'Leviathan',
    flavor: 'Markets feel you move: 1% of supply.',
    ring: '#9b6cff',
    glow: '#6a37e0',
  },
  tidelord: {
    name: 'Tidelord',
    flavor: 'The tide answers your call: 2% of supply.',
    ring: '#a66af2',
    glow: '#7736d1',
  },
  stormcaller: {
    name: 'Stormcaller',
    flavor: 'Storms gather at your name: 3% of supply.',
    ring: '#b168e5',
    glow: '#8434c3',
  },
  krakencrown: {
    name: 'Krakencrown',
    flavor: 'Crowned by the deep: 4% of supply.',
    ring: '#bc67d8',
    glow: '#9133b4',
  },
  titanforged: {
    name: 'Titanforged',
    flavor: 'Forged among titans: 5% of supply.',
    ring: '#c765cb',
    glow: '#9e31a5',
  },
  starhoard: {
    name: 'Starhoard',
    flavor: 'A hoard that bends starlight: 6% of supply.',
    ring: '#d363be',
    glow: '#ab3096',
  },
  voidwarden: {
    name: 'Voidwarden',
    flavor: "Keeper at the void's edge: 7% of supply.",
    ring: '#de61b1',
    glow: '#b82e88',
  },
  realmshaper: {
    name: 'Realmshaper',
    flavor: 'You reshape the realm: 8% of supply.',
    ring: '#e95fa4',
    glow: '#c52d79',
  },
  worldforger: {
    name: 'Worldforger',
    flavor: 'Forging a world of your own: 9% of supply.',
    ring: '#f45e97',
    glow: '#d22b6a',
  },
  worldbearer: {
    name: 'Worldbearer',
    flavor: 'You carry a piece of the world: 10% of supply.',
    ring: '#ff5c8a',
    glow: '#e02a5c',
  },
  sovereign: {
    name: 'Sovereign',
    flavor: 'The realm bends the knee: the entire supply.',
    ring: '#ffe27a',
    glow: '#ffaa00',
  },
};

// The eighteen rungs. Thresholds climb 10× up to Leviathan (1% of supply), then
// step by whole percents through the 2%-9% whale band, then 10% and the full
// supply. Rungs from Vaultwarden up call out their share of supply in the flavor.
export const HOLDER_TIERS: readonly HolderTier[] = HOLDER_TIER_DEFS.map((tier) => ({
  ...tier,
  ...HOLDER_TIER_PRESENTATION[tier.key],
}));

// ---------------------------------------------------------------------------
// Ascendant Sigils badge art. Font-free inline SVG, 64x64 viewBox, gradients +
// strokes only (no <filter>). Static gradient ids: each badge is its own
// document, so `m`/`f` never collide.
// ---------------------------------------------------------------------------

// Shared keyline treatment: dark outer line, faint cream inner line (the HUD's
// double-hairline convention). CREAM also fills the bold glyphs so they read on
// any material.
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
function polyPoints(cx: number, cy: number, r: number, n: number, rotDeg: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (((360 / n) * i + rotDeg) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
function starPoints(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  n: number,
  rotDeg: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (((180 / n) * i + rotDeg) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

interface CoinMaterial {
  hi: string;
  mid: string;
  lo: string;
  faceHi: string;
  faceLo: string;
}
interface BandArt {
  mat: CoinMaterial;
  glyph: string;
}

type Band1Key = 'ember' | 'coinbearer' | 'coppercrest' | 'silverbound' | 'gilded';
type Band2Key = 'vaultwarden' | 'whale' | 'leviathan';

// --- Band I: faceted coin. Material ramp per rung. -------------------------
function milledTicks(): string {
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const a = (i * 10 * Math.PI) / 180;
    const x1 = 32 + 26.6 * Math.cos(a);
    const y1 = 32 + 26.6 * Math.sin(a);
    const x2 = 32 + 28.6 * Math.cos(a);
    const y2 = 32 + 28.6 * Math.sin(a);
    ticks +=
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"` +
      ` stroke="${KEYLINE}" stroke-opacity="0.35" stroke-width="1.1"/>`;
  }
  return ticks;
}
function coinBadge(mat: CoinMaterial, glyph: string, px: number): string {
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, mat.hi],
          [0.45, mat.mid],
          [1, mat.lo],
        ],
        0,
        0,
        0,
        1,
      ) +
        rad(
          'f',
          [
            [0, mat.faceHi],
            [1, mat.faceLo],
          ],
          '38%',
          '30%',
          '80%',
        ),
    ) +
      `<circle cx="32" cy="32" r="29" fill="url(#m)"/>` +
      `<circle cx="32" cy="32" r="29" fill="none" stroke="${KEYLINE}" stroke-width="2.4"/>` +
      milledTicks() +
      `<circle cx="32" cy="32" r="24" fill="url(#f)"/>` +
      `<circle cx="32" cy="32" r="24" fill="none" stroke="${KEYLINE}" stroke-opacity="0.55" stroke-width="1.2"/>` +
      `<circle cx="32" cy="32" r="22.4" fill="none" stroke="${CREAM}" stroke-opacity="0.28" stroke-width="1"/>` +
      // specular sweep, upper left
      `<path d="M13 22 A22 22 0 0 1 30 10" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2.4" stroke-linecap="round"/>` +
      glyph,
  );
}

// --- Band II: cut-gem hexagon. --------------------------------------------
function hexBadge(mat: CoinMaterial, glyph: string, px: number): string {
  const hexOuter = polyPoints(32, 32, 29, 6, -90);
  const hexInner = polyPoints(32, 32, 23.5, 6, -90);
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
        0.6,
        1,
      ) +
        rad(
          'f',
          [
            [0, mat.faceHi],
            [1, mat.faceLo],
          ],
          '40%',
          '28%',
          '85%',
        ),
    ) +
      `<polygon points="${hexOuter}" fill="url(#m)"/>` +
      `<polygon points="${hexOuter}" fill="none" stroke="${KEYLINE}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<polygon points="${hexInner}" fill="url(#f)"/>` +
      `<polygon points="${hexInner}" fill="none" stroke="${KEYLINE}" stroke-opacity="0.55" stroke-width="1.2"/>` +
      `<polygon points="${polyPoints(32, 32, 22, 6, -90)}" fill="none" stroke="${CREAM}" stroke-opacity="0.26" stroke-width="1"/>` +
      // bevel facets: light upper-left edge, dark lower-right edge
      `<path d="M32 3 L6.9 17.5 L6.9 32 L12.6 32 L12.6 20.8 L32 9.6 Z" fill="#ffffff" opacity="0.16"/>` +
      `<path d="M32 61 L57.1 46.5 L57.1 32 L51.4 32 L51.4 43.2 L32 54.4 Z" fill="#000000" opacity="0.28"/>` +
      glyph,
  );
}

// --- Band III: sigil plate + nine-socket ring. -----------------------------
// A rank at N% of supply lights N of the nine sockets, joined by an arc, so the
// count survives close-up and the arc length reads at nameplate distance. The
// lit-socket cream pip (r="1") is the stable marker the socket-count test pins.
function sigilBadge(hue: string, hueDeep: string, percent: number, px: number): string {
  const plate = starPoints(32, 32, 30, 24.6, 8, -90);
  let sockets = '';
  for (let i = 0; i < 9; i++) {
    const a = ((-90 + i * 40) * Math.PI) / 180;
    const cx = 32 + 19.2 * Math.cos(a);
    const cy = 32 + 19.2 * Math.sin(a);
    const lit = i < percent;
    if (lit) {
      sockets +=
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.4" fill="${hue}" fill-opacity="0.35"/>` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.3" fill="${hue}"/>` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1" fill="${CREAM}"/>`;
    } else {
      sockets +=
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.1" fill="#120a18"/>` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.1" fill="none" stroke="${hue}" stroke-opacity="0.3" stroke-width="0.9"/>`;
    }
  }
  // connecting arc through the lit sockets
  let arc = '';
  if (percent > 1) {
    const a0 = (-90 * Math.PI) / 180;
    const a1 = ((-90 + (percent - 1) * 40) * Math.PI) / 180;
    const large = (percent - 1) * 40 > 180 ? 1 : 0;
    arc =
      `<path d="M${(32 + 19.2 * Math.cos(a0)).toFixed(1)} ${(32 + 19.2 * Math.sin(a0)).toFixed(1)}` +
      ` A19.2 19.2 0 ${large} 1 ${(32 + 19.2 * Math.cos(a1)).toFixed(1)} ${(32 + 19.2 * Math.sin(a1)).toFixed(1)}"` +
      ` fill="none" stroke="${hue}" stroke-width="1.6" stroke-opacity="0.75"/>`;
  }
  const crystal =
    `<polygon points="32,22.5 37.4,30.5 32,43.5 26.6,30.5" fill="${CREAM}"/>` +
    `<polygon points="32,22.5 37.4,30.5 32,43.5 26.6,30.5" fill="none" stroke="${hueDeep}" stroke-opacity="0.5" stroke-width="1.1"/>` +
    `<path d="M26.6 30.5h10.8M32 22.5v21" stroke="${hueDeep}" stroke-opacity="0.4" stroke-width="1.1" fill="none"/>` +
    `<polygon points="32,25.4 35.2,30.3 32,33.4 28.8,30.3" fill="${hue}" fill-opacity="0.75"/>`;
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, hue],
          [0.55, hueDeep],
          [1, '#160b22'],
        ],
        0,
        0,
        0.7,
        1,
      ) +
        rad(
          'f',
          [
            [0, '#241536'],
            [1, '#120a1c'],
          ],
          '42%',
          '30%',
          '85%',
        ),
    ) +
      `<polygon points="${plate}" fill="url(#m)"/>` +
      `<polygon points="${plate}" fill="none" stroke="${KEYLINE}" stroke-width="2.2" stroke-linejoin="round"/>` +
      `<circle cx="32" cy="32" r="23" fill="url(#f)"/>` +
      `<circle cx="32" cy="32" r="23" fill="none" stroke="${KEYLINE}" stroke-opacity="0.6" stroke-width="1.1"/>` +
      `<circle cx="32" cy="32" r="21.8" fill="none" stroke="${CREAM}" stroke-opacity="0.2" stroke-width="0.9"/>` +
      arc +
      sockets +
      crystal,
  );
}

// --- Band IV: regalia. Unique badges, never a shared frame. -----------------
function worldbearerBadge(px: number): string {
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, '#ff8fae'],
          [0.5, '#e0355f'],
          [1, '#5c0f26'],
        ],
        0,
        0,
        0.6,
        1,
      ) +
        rad(
          'f',
          [
            [0, '#3a1020'],
            [1, '#1c0810'],
          ],
          '40%',
          '30%',
          '85%',
        ),
    ) +
      `<circle cx="32" cy="32" r="29" fill="url(#m)"/>` +
      `<circle cx="32" cy="32" r="29" fill="none" stroke="${KEYLINE}" stroke-width="2.4"/>` +
      `<circle cx="32" cy="32" r="24" fill="url(#f)"/>` +
      `<circle cx="32" cy="32" r="24" fill="none" stroke="${KEYLINE}" stroke-opacity="0.55" stroke-width="1.2"/>` +
      // cradling crescents
      `<path d="M15 41c1.8 6.2 7 10.6 13 11.8-8.6 1-15.6-3.4-17.6-10Z" fill="${CREAM}"/>` +
      `<path d="M49 41c-1.8 6.2-7 10.6-13 11.8 8.6 1 15.6-3.4 17.6-10Z" fill="${CREAM}"/>` +
      // the world: orb with ring
      `<circle cx="32" cy="29.5" r="11.4" fill="${CREAM}"/>` +
      `<circle cx="32" cy="29.5" r="11.4" fill="none" stroke="#5c0f26" stroke-opacity="0.5" stroke-width="1.2"/>` +
      `<ellipse cx="32" cy="29.5" rx="5" ry="11.4" fill="none" stroke="#e0355f" stroke-width="1.6" stroke-opacity="0.85"/>` +
      `<path d="M20.9 27h22.2M20.9 32h22.2" stroke="#e0355f" stroke-width="1.5" stroke-opacity="0.85" fill="none"/>` +
      `<ellipse cx="32" cy="30.5" rx="15.4" ry="5" fill="none" stroke="${CREAM}" stroke-width="2" transform="rotate(-18 32 30.5)"/>`,
  );
}
function sovereignBadge(px: number): string {
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, '#fff0b8'],
          [0.45, '#e8b23c'],
          [1, '#7a4c0e'],
        ],
        0,
        0,
        0.6,
        1,
      ) +
        rad(
          'f',
          [
            [0, '#8a5c17'],
            [1, '#3c250a'],
          ],
          '40%',
          '28%',
          '85%',
        ),
    ) +
      `<polygon points="${starPoints(32, 32, 31, 25, 12, -90)}" fill="url(#m)"/>` +
      `<polygon points="${starPoints(32, 32, 31, 25, 12, -90)}" fill="none" stroke="${KEYLINE}" stroke-width="2" stroke-linejoin="round"/>` +
      `<circle cx="32" cy="32" r="23.4" fill="url(#f)"/>` +
      `<circle cx="32" cy="32" r="23.4" fill="none" stroke="${KEYLINE}" stroke-opacity="0.6" stroke-width="1.2"/>` +
      `<circle cx="32" cy="32" r="22" fill="none" stroke="${CREAM}" stroke-opacity="0.3" stroke-width="1"/>` +
      // regal crown: three peaks, orb tips, jeweled band
      `<path d="M17.5 25l6.4 8.6L32 20.5l8.1 13.1 6.4-8.6v16.4h-29Z" fill="${CREAM}"/>` +
      `<path d="M17.5 25l6.4 8.6L32 20.5l8.1 13.1 6.4-8.6v16.4h-29Z" fill="none" stroke="#7a4c0e" stroke-opacity="0.45" stroke-width="1.2"/>` +
      `<circle cx="17.5" cy="22.4" r="2.6" fill="${CREAM}"/>` +
      `<circle cx="32" cy="17.6" r="2.9" fill="${CREAM}"/>` +
      `<circle cx="46.5" cy="22.4" r="2.6" fill="${CREAM}"/>` +
      `<rect x="18.6" y="43.6" width="26.8" height="4.6" rx="1.4" fill="${CREAM}"/>` +
      `<circle cx="24.4" cy="45.9" r="1.5" fill="#e8b23c"/>` +
      `<circle cx="32" cy="45.9" r="1.5" fill="#e0355f"/>` +
      `<circle cx="39.6" cy="45.9" r="1.5" fill="#2268cf"/>`,
  );
}

const BAND1: Record<Band1Key, BandArt> = {
  ember: {
    mat: { hi: '#e0763a', mid: '#8a3c18', lo: '#3a1608', faceHi: '#5a2410', faceLo: '#2a0f06' },
    glyph:
      `<path d="M32 15c4.5 8 12 12.5 9.8 22-1.6 7-6.4 11.6-9.8 16.5-3.4-4.9-8.2-9.5-9.8-16.5C20 27.5 27.5 23 32 15Z" fill="${CREAM}"/>` +
      `<path d="M32 29.5c2.4 4 5.3 6.4 4 11-0.9 3.1-2.5 5.3-4 7-1.5-1.7-3.1-3.9-4-7-1.3-4.6 1.6-7 4-11Z" fill="#e0763a"/>` +
      `<circle cx="32" cy="43.4" r="2.1" fill="#ffd9b0"/>`,
  },
  coinbearer: {
    mat: { hi: '#d9a35c', mid: '#96622c', lo: '#402611', faceHi: '#5e3b1a', faceLo: '#2c1a0b' },
    glyph:
      `<circle cx="32" cy="32" r="13.6" fill="${CREAM}"/>` +
      `<circle cx="32" cy="32" r="13.6" fill="none" stroke="#402611" stroke-opacity="0.5" stroke-width="1.4"/>` +
      `<circle cx="32" cy="32" r="5" fill="#96622c"/>` +
      `<circle cx="32" cy="32" r="5" fill="none" stroke="#402611" stroke-opacity="0.6" stroke-width="1.2"/>` +
      `<path d="M32 20.5v4M32 39.5v4M20.5 32h4M39.5 32h4" stroke="#96622c" stroke-width="2.6" stroke-linecap="round"/>`,
  },
  coppercrest: {
    mat: { hi: '#e08a4e', mid: '#a04e20', lo: '#42200c', faceHi: '#61300f', faceLo: '#2e1607' },
    glyph:
      `<path d="M32 14l14.5 5v10.6c0 8.8-6.4 15.3-14.5 19-8.1-3.7-14.5-10.2-14.5-19V19Z" fill="${CREAM}"/>` +
      `<path d="M32 19.6l9.6 3.3v7.1c0 5.9-4.2 10.3-9.6 13-5.4-2.7-9.6-7.1-9.6-13v-7.1Z" fill="#a04e20"/>` +
      `<path d="M25.4 31.4l4.6 4.6 8.6-8.6" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  silverbound: {
    mat: { hi: '#eef3f8', mid: '#9fb0c2', lo: '#414f60', faceHi: '#5d6d80', faceLo: '#2b3542' },
    glyph:
      `<g stroke="#2b3542" stroke-opacity="0.55" stroke-width="1.2">` +
      `<path d="M24.5 40h15l3.2 7h-21.4Z" fill="${CREAM}"/>` +
      `<path d="M18 31h15l3.2 7H14.8Z" fill="#cfdae4"/>` +
      `<path d="M31 31h15l3.2 7H34.2Z" fill="${CREAM}"/>` +
      `<path d="M24.5 22h15l3.2 7h-21.4Z" fill="#cfdae4"/>` +
      `</g>`,
  },
  gilded: {
    mat: { hi: '#ffe9a8', mid: '#d8a437', lo: '#6b4310', faceHi: '#8a5c17', faceLo: '#41290a' },
    glyph:
      `<polygon points="${starPoints(32, 32.5, 15.5, 6.4, 5, -90)}" fill="${CREAM}"/>` +
      `<polygon points="${starPoints(32, 32.5, 15.5, 6.4, 5, -90)}" fill="none" stroke="#6b4310" stroke-opacity="0.45" stroke-width="1.2"/>` +
      `<polygon points="${starPoints(32, 32.5, 8.6, 3.6, 5, -90)}" fill="#d8a437"/>`,
  },
};

const BAND2: Record<Band2Key, BandArt> = {
  vaultwarden: {
    mat: { hi: '#63e6c0', mid: '#1e9a75', lo: '#0a3f30', faceHi: '#0f5442', faceLo: '#072b21' },
    glyph:
      `<circle cx="32" cy="32" r="12.6" fill="none" stroke="${CREAM}" stroke-width="3.4"/>` +
      `<circle cx="32" cy="32" r="4.6" fill="${CREAM}"/>` +
      `<path d="M32 19.4v-4.6M32 44.6v4.6M19.4 32h-4.6M44.6 32h4.6M23.1 23.1l-3.2-3.2M40.9 40.9l3.2 3.2M40.9 23.1l3.2-3.2M23.1 40.9l-3.2 3.2" stroke="${CREAM}" stroke-width="2.8" stroke-linecap="round"/>` +
      `<circle cx="32" cy="32" r="8.4" fill="none" stroke="#63e6c0" stroke-width="1.6" stroke-opacity="0.85"/>`,
  },
  whale: {
    mat: { hi: '#5fb2ff', mid: '#2268cf', lo: '#0b2a5e', faceHi: '#123a7d', faceLo: '#081f47' },
    glyph:
      `<path d="M12.5 34c6-8.5 17-12 26.5-8.5 4.5 1.7 7.5 4.4 9.5 8-2.6-0.4-4.8-0.2-6.8 0.8 1.4 3.4 0.6 6.9-1.7 9.4l-2.4-5.4c-6.8 4.4-17.1 4-22.6-1.4-1.4-1.4-2.3-2.3-2.5-2.9Z" fill="${CREAM}"/>` +
      `<path d="M44 25.5c1.2-3 0.6-5.7-1.2-8 3.4 0.4 6 2.3 7.4 5.4Z" fill="${CREAM}"/>` +
      `<circle cx="21.5" cy="33" r="1.9" fill="#123a7d"/>` +
      `<path d="M16 39.5c3.5 2.6 8 3.7 12.6 3.4" fill="none" stroke="#5fb2ff" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.9"/>`,
  },
  leviathan: {
    // Band II capstone: a full-mass leviathan coiled inside the amethyst gem, the
    // only Band II badge with a whole creature (roaring maw, crest spikes, dorsal
    // fins, belly plates, tail fluke, and bioluminescent flank lights).
    mat: { hi: '#a884ff', mid: '#5c2ed1', lo: '#1e0b52', faceHi: '#2c1370', faceLo: '#120735' },
    glyph:
      // faint abyss ring
      `<circle cx="32" cy="33" r="18.5" fill="none" stroke="#a884ff" stroke-opacity="0.12" stroke-width="1.1"/>` +
      // dorsal spikes along the back (outer edge of the arch)
      `<path d="M16.5 26.5 L12.3 24.6 L15.2 29.5 Z" fill="${CREAM}"/>` +
      `<path d="M14.6 33.5 L12.1 36.8 L16 37.4 Z" fill="${CREAM}"/>` +
      `<path d="M18.3 43 L16.4 47.2 L21.2 46 Z" fill="${CREAM}"/>` +
      // the body: one thick tapering arch, closed fill = mass
      `<path d="M28 20.5 C18.5 23 13.5 30 15 38 C16.5 45.5 24 50.5 33 50.5 C39.5 50.5 44.5 48 47.5 43.5 C48.8 41.2 48 38.6 45.2 38.4 C43.8 42.2 39.5 44.8 34 45 C26.5 45.2 21.8 41.5 20.8 35.5 C20 30.2 23.5 25.5 29.5 23.8 Z" fill="${CREAM}"/>` +
      `<path d="M28 20.5 C18.5 23 13.5 30 15 38 C16.5 45.5 24 50.5 33 50.5 C39.5 50.5 44.5 48 47.5 43.5 C48.8 41.2 48 38.6 45.2 38.4 C43.8 42.2 39.5 44.8 34 45 C26.5 45.2 21.8 41.5 20.8 35.5 C20 30.2 23.5 25.5 29.5 23.8 Z" fill="none" stroke="#1e0b52" stroke-opacity="0.55" stroke-width="1.4" stroke-linejoin="round"/>` +
      // belly plates across the inner curve
      `<path d="M20.9 31 L16.2 29.5 M20.7 36.5 L15.8 36.9 M22.5 41.5 L18.6 44 M27.5 44.6 L25.6 48.9 M33.5 45 L33.3 49.6 M39 44.2 L41 48.2" stroke="#5c2ed1" stroke-opacity="0.75" stroke-width="1.7" fill="none"/>` +
      // tail fluke fan, contained against the right edge
      `<path d="M45.8 39.5 L51.8 36.2 L50.4 41.4 Z" fill="${CREAM}"/>` +
      `<path d="M46.6 41.8 L51.4 44.6 L47.3 45.8 Z" fill="${CREAM}"/>` +
      // head: heavy skull, roaring open maw, fangs, crest spikes
      `<path d="M26.5 20.8 C26 15.4 30.5 11.8 35.8 12.2 C41 12.6 45.6 14.4 47.8 16.8 L37.6 19.7 L46.8 24.8 C44.2 27.8 39.2 28.8 34.8 27.2 L36.4 24 L31.5 25.6 C28.6 24.8 26.8 23.2 26.5 20.8 Z" fill="${CREAM}"/>` +
      // fangs in the maw gap
      `<path d="M41.2 17.9 L41.9 20.8 L43.6 18.4 Z" fill="${CREAM}"/>` +
      `<path d="M41.6 23.8 L42.5 20.9 L44.4 23.4 Z" fill="${CREAM}"/>` +
      // crest spikes off the skull, short to stay inside the pinched top
      `<path d="M29.5 13.4 L26.6 9.8 L31.4 11 Z" fill="${CREAM}"/>` +
      `<path d="M33.4 12.2 L32.6 7.6 L36.2 10.6 Z" fill="${CREAM}"/>` +
      // fierce eye: angular brow over a glowing pupil
      `<path d="M31.2 16.2 L36.2 15.4 L35.8 17 Z" fill="#5c2ed1"/>` +
      `<circle cx="33.8" cy="17.6" r="1.5" fill="#5c2ed1"/>` +
      `<circle cx="33.8" cy="17.6" r="0.6" fill="#e8dcff"/>` +
      // bioluminescent spots along the flank
      `<circle cx="18.6" cy="31.5" r="1.3" fill="#b99bff"/>` +
      `<circle cx="22" cy="40.8" r="1.3" fill="#b99bff"/>`,
  },
};

/** The 1-based band a rung belongs to: I coins (1-5), II gems (6-8), III sigils (9-16), IV regalia (17-18). */
function badgeBand(index: number): 1 | 2 | 3 | 4 {
  if (index <= 5) return 1;
  if (index <= 8) return 2;
  if (index <= 16) return 3;
  return 4;
}

/**
 * Whether a rung is Band IV regalia (Worldbearer / Sovereign). Consumers use this
 * to pick the stronger halo strength for the two apex badges (see the badge CSS).
 */
export function holderTierIsRegalia(tier: Pick<HolderTier, 'index'>): boolean {
  return badgeBand(tier.index) === 4;
}

/**
 * The class list for the holder badge `<img>` on the player/inspect card: the base
 * badge, the halo opt-in, and (regalia rungs only) the stronger-halo modifier. The
 * glow hue is supplied separately by the caller via an inline `--holder-glow`. Kept
 * here as a pinned pure helper so the strong-halo branch has a decisive test rather
 * than living inline in the card-build HTML.
 */
export function holderCardBadgeClass(tier: Pick<HolderTier, 'index'>): string {
  const base = 'inspect-holder-badge inspect-holder-halo';
  return holderTierIsRegalia(tier) ? `${base} inspect-holder-halo-strong` : base;
}

const HOLDER_TIER_TEXT_KEYS = {
  ember: { name: 'wallet.holderTiers.ember.name', flavor: 'wallet.holderTiers.ember.flavor' },
  coinbearer: {
    name: 'wallet.holderTiers.coinbearer.name',
    flavor: 'wallet.holderTiers.coinbearer.flavor',
  },
  coppercrest: {
    name: 'wallet.holderTiers.coppercrest.name',
    flavor: 'wallet.holderTiers.coppercrest.flavor',
  },
  silverbound: {
    name: 'wallet.holderTiers.silverbound.name',
    flavor: 'wallet.holderTiers.silverbound.flavor',
  },
  gilded: { name: 'wallet.holderTiers.gilded.name', flavor: 'wallet.holderTiers.gilded.flavor' },
  vaultwarden: {
    name: 'wallet.holderTiers.vaultwarden.name',
    flavor: 'wallet.holderTiers.vaultwarden.flavor',
  },
  whale: { name: 'wallet.holderTiers.whale.name', flavor: 'wallet.holderTiers.whale.flavor' },
  leviathan: {
    name: 'wallet.holderTiers.leviathan.name',
    flavor: 'wallet.holderTiers.leviathan.flavor',
  },
  tidelord: {
    name: 'wallet.holderTiers.tidelord.name',
    flavor: 'wallet.holderTiers.tidelord.flavor',
  },
  stormcaller: {
    name: 'wallet.holderTiers.stormcaller.name',
    flavor: 'wallet.holderTiers.stormcaller.flavor',
  },
  krakencrown: {
    name: 'wallet.holderTiers.krakencrown.name',
    flavor: 'wallet.holderTiers.krakencrown.flavor',
  },
  titanforged: {
    name: 'wallet.holderTiers.titanforged.name',
    flavor: 'wallet.holderTiers.titanforged.flavor',
  },
  starhoard: {
    name: 'wallet.holderTiers.starhoard.name',
    flavor: 'wallet.holderTiers.starhoard.flavor',
  },
  voidwarden: {
    name: 'wallet.holderTiers.voidwarden.name',
    flavor: 'wallet.holderTiers.voidwarden.flavor',
  },
  realmshaper: {
    name: 'wallet.holderTiers.realmshaper.name',
    flavor: 'wallet.holderTiers.realmshaper.flavor',
  },
  worldforger: {
    name: 'wallet.holderTiers.worldforger.name',
    flavor: 'wallet.holderTiers.worldforger.flavor',
  },
  worldbearer: {
    name: 'wallet.holderTiers.worldbearer.name',
    flavor: 'wallet.holderTiers.worldbearer.flavor',
  },
  sovereign: {
    name: 'wallet.holderTiers.sovereign.name',
    flavor: 'wallet.holderTiers.sovereign.flavor',
  },
} satisfies Record<HolderTierKey, { name: TranslationKey; flavor: TranslationKey }>;

export function holderTierDisplayName(tier: HolderTier): string {
  const keys = HOLDER_TIER_TEXT_KEYS[tier.key];
  return keys ? t(keys.name) : t('wallet.holder');
}

export function holderTierFlavorText(tier: HolderTier): string {
  const keys = HOLDER_TIER_TEXT_KEYS[tier.key];
  return keys ? t(keys.flavor) : t('wallet.holder');
}

/**
 * The highest rung a balance qualifies for, or null when there is no connected
 * wallet (balance === null) or the balance is below the first rung (< 1 $WOC).
 */
export function holderTierForBalance(balance: number | null): HolderTier | null {
  const shared = sharedHolderTierForBalance(balance);
  return shared ? (holderTierByIndex(shared.index) ?? null) : null;
}

/** The rung at a 1-based index (1-18), or undefined for 0/out-of-range. */
export function holderTierByIndex(index: number): HolderTier | undefined {
  const shared = sharedHolderTierByIndex(index);
  return shared ? HOLDER_TIERS[shared.index - 1] : undefined;
}

/** This rung's share of max supply, as a fraction in [0, 1]. */
export function tierSupplyShare(tier: Pick<HolderTier, 'threshold'>): number {
  return sharedTierSupplyShare(tier);
}

/**
 * A standalone SVG data URL for the rung's Ascendant Sigils badge. The frame
 * shape encodes the band and the material encodes the rung; Band III lights N of
 * nine sockets for an N%-of-supply rung. Suitable for an <img> src or a canvas
 * draw. `px` sets the rasterised pixel box (the viewBox is always 0 0 64 64, so
 * the art scales crisply). Font-free, filter-free; each URL is its own document.
 */
export function holderTierBadgeDataUrl(tier: HolderTier, px = 128): string {
  const band = badgeBand(tier.index);
  if (band === 1) {
    const art = BAND1[tier.key as Band1Key];
    return coinBadge(art.mat, art.glyph, px);
  }
  if (band === 2) {
    const art = BAND2[tier.key as Band2Key];
    return hexBadge(art.mat, art.glyph, px);
  }
  if (band === 3) {
    const percent = Math.round(tier.threshold / 10_000_000);
    return sigilBadge(tier.ring, tier.glow, percent, px);
  }
  return tier.key === 'worldbearer' ? worldbearerBadge(px) : sovereignBadge(px);
}
