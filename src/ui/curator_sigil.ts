// The Curator sigil: the Reliquary's rank-5 honor mark ("the Eternal Seal").
//
// The fourth identity-flair badge on the click-inspect card, beside the $WOC
// holder tier, the linked-Discord status, and the contributor ladder. Unlike
// those three this is a SINGLE rung, not a ladder: only an Eternal Curator
// (Curator rank 5, the 100-relic threshold in src/sim/reliquary.ts) carries it,
// which is what keeps it exclusive, so there is no tier table here, just the one
// mark plus its glow hue.
//
// Purely cosmetic identity, exactly like its three siblings: it grants nothing,
// encodes no health / range / threat, and no surface may substitute it for a
// value a player reacts to.
//
// Art follows the holder_tier.ts / dev_tier.ts recipe verbatim so the four
// badges read as one family: font-free inline SVG composed into a data URL,
// gradients and strokes only (no <filter> elements), viewBox 0 0 64 64, valid
// when URI-encoded. Static gradient ids are fine because each data URL is its
// own SVG document. The motif is a struck wax seal (the rank's sealId is
// 'eternal'): a milled gilt roundel carrying a lemniscate, the one shape that
// reads as "without end" at 32px, where a word or a numeral could not.
//
// DOM-free apart from building a string, so a Vitest pins the whole surface.

// Shared keyline + cream tones (the same the holder and dev badges use).
const KEYLINE = '#140f0a';
const CREAM = '#fff6df';

// The seal's own gilt ramp. Deliberately NOT any Book of Deeds border-accent
// value: those four palettes are single-sourced in deed_border_view.ts and
// pinned exact-once, and a badge is not a border.
const SEAL_HI = '#ffeeb4';
const SEAL_MID = '#dfa733';
const SEAL_LO = '#6d4c15';
const SEAL_FACE_HI = '#7d5b1a';
const SEAL_FACE_LO = '#3b2b0c';
const SEAL_ACCENT = '#f6cd4e';
const SEAL_ACCENT_DEEP = '#5d3f10';

/** The badge halo hue, handed to the stylesheet as the inline `--curator-glow`
 *  custom property (the same shape holder/dev badges use for their own hue). */
export const CURATOR_SIGIL_GLOW = '#ffe39a';

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

// The milled edge: twelve struck studs around the rim, the coin-edge cue the
// holder band I badges use, so the seal reads as struck metal rather than a
// flat disc at nameplate-adjacent sizes.
function milledEdge(): string {
  let out = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = 32 + Math.cos(a) * 25.6;
    const y = 32 + Math.sin(a) * 25.6;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="${SEAL_HI}" stroke="${KEYLINE}" stroke-width="0.7"/>`;
  }
  return out;
}

// The lemniscate ("without end"), drawn as one closed path of two lobes: a deep
// understroke plus a cream over-stroke, the same beveled-rail treatment the dev
// badge's merge trunk uses, with a small accent bead at the crossing.
function eternalKnot(): string {
  const d =
    'M32 32 C26.5 24, 18.5 24.5, 18.5 32 C18.5 39.5, 26.5 40, 32 32' +
    ' C37.5 24, 45.5 24.5, 45.5 32 C45.5 39.5, 37.5 40, 32 32 Z';
  return (
    `<path d="${d}" fill="none" stroke="${SEAL_ACCENT_DEEP}" stroke-width="4.4" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${CREAM}" stroke-width="2.3" stroke-linejoin="round"/>` +
    `<circle cx="32" cy="32" r="2.6" fill="${SEAL_ACCENT}"/>` +
    `<circle cx="32" cy="32" r="2.6" fill="none" stroke="${SEAL_ACCENT_DEEP}" stroke-width="0.9" stroke-opacity="0.7"/>`
  );
}

/**
 * A standalone SVG data URL for the Curator sigil: the milled gilt seal carrying
 * the eternal knot. Suitable for an <img> src or a canvas draw. `px` sets the
 * rasterised pixel box (the viewBox is always 0 0 64 64, so the art scales
 * crisply). Font-free, filter-free; each URL is its own document.
 */
export function curatorSigilDataUrl(px = 128): string {
  return wrapSvg(
    px,
    defs(
      lin(
        'm',
        [
          [0, SEAL_HI],
          [0.5, SEAL_MID],
          [1, SEAL_LO],
        ],
        0,
        0,
        0.35,
        1,
      ) +
        rad(
          'f',
          [
            [0, SEAL_FACE_HI],
            [1, SEAL_FACE_LO],
          ],
          '42%',
          '26%',
          '90%',
        ),
    ) +
      milledEdge() +
      `<circle cx="32" cy="32" r="25" fill="url(#m)"/>` +
      `<circle cx="32" cy="32" r="25" fill="none" stroke="${KEYLINE}" stroke-width="2.4"/>` +
      `<circle cx="32" cy="32" r="19" fill="url(#f)"/>` +
      `<circle cx="32" cy="32" r="19" fill="none" stroke="${KEYLINE}" stroke-opacity="0.55" stroke-width="1.1"/>` +
      `<path d="M20 20 A17 17 0 0 1 40 15.6" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.6" stroke-linecap="round"/>` +
      eternalKnot(),
  );
}

/**
 * The class list for the sigil `<img>` on the inspect card: the shared badge box
 * plus the halo opt-in. The glow hue is supplied separately by the caller via an
 * inline `--curator-glow`, mirroring holderCardBadgeClass / devCardBadgeClass.
 * One rung, so there is no strong-halo branch to decide.
 */
export function curatorSigilBadgeClass(): string {
  return 'inspect-holder-badge inspect-curator-halo';
}
