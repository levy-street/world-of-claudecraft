// The Book of Deeds BORDER channel: the one place that turns a deed id into a
// cosmetic frame accent, shared by the overhead nameplate (canvas shapes) and the
// unit-frame portrait ring (CSS custom properties). Pure and host-agnostic: no
// DOM, no i18n, no render/game/net import, so a Vitest drives it directly and both
// consumers resolve the SAME palette from the SAME table.
//
// Two separate lookups, deliberately: a client can hold a deed id whose content
// record was removed (saves persist ids forever), and a border deed can exist
// whose slug has no palette yet. deedBorderSlug resolves id -> slug through the
// live DEEDS catalog and borderAccent resolves slug -> colors, each returning the
// empty/null "no accent" answer rather than guessing, so a stale or drifted id
// renders exactly like a borderless player.
//
// The accent is COSMETIC IDENTITY, never actionable information: it carries no
// health, range, rank, or threat meaning, so no surface may substitute it for a
// value the player reacts to.
//
// On the nameplate the slug is resolved on the same cadenced resolveContent
// pass as the name and the title, whose interval is TIER-SCALED (the 1/24s to
// 1/15s plate staleness floor). That is the sanctioned envelope every plate
// field shares, not a per-field gate: a border never resolves later than the
// name beside it, so two players on different presets read the same plate.

import { DEEDS } from '../sim/content/deeds';

/** Per-slug seal-face discriminant shared by every Deed Heraldry surface. */
export type BorderMotifKind = 'catalogue' | 'vault' | 'ward' | 'laurel';

/** One line in normalized seal space. Renderers transform these static
 *  coordinates into their own seal bounds without creating a second motif
 *  catalogue or allocating transformed arrays. */
export interface BorderMotifPrimitive {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

// The four existing identities from the original cartouche, normalized around
// the center of the forged seal: Catalogue page lines, the Vault diamond knot,
// the Ward key, and mirrored Laurel sprigs. The arrays and every line record are
// frozen because every heraldry surface receives these exact shared objects.
const BORDER_MOTIF_PRIMITIVES: Readonly<Record<BorderMotifKind, readonly BorderMotifPrimitive[]>> =
  Object.freeze({
    catalogue: Object.freeze([
      Object.freeze({ x1: -0.8, y1: -0.6, x2: 0.8, y2: -0.6 }),
      Object.freeze({ x1: -0.8, y1: 0, x2: 0.8, y2: 0 }),
      Object.freeze({ x1: -0.8, y1: 0.6, x2: 0.8, y2: 0.6 }),
    ]),
    vault: Object.freeze([
      Object.freeze({ x1: 0, y1: -0.85, x2: 0.85, y2: 0 }),
      Object.freeze({ x1: 0.85, y1: 0, x2: 0, y2: 0.85 }),
      Object.freeze({ x1: 0, y1: 0.85, x2: -0.85, y2: 0 }),
      Object.freeze({ x1: -0.85, y1: 0, x2: 0, y2: -0.85 }),
      Object.freeze({ x1: -0.85, y1: 0, x2: 0.85, y2: 0 }),
    ]),
    ward: Object.freeze([
      Object.freeze({ x1: 0, y1: -0.9, x2: 0, y2: 0.6 }),
      Object.freeze({ x1: 0, y1: -0.9, x2: -0.45, y2: -0.4 }),
      Object.freeze({ x1: 0, y1: -0.9, x2: 0.45, y2: -0.4 }),
      Object.freeze({ x1: 0, y1: 0.6, x2: 0.75, y2: 0.6 }),
    ]),
    laurel: Object.freeze([
      Object.freeze({ x1: -0.1, y1: 0, x2: -0.75, y2: -0.75 }),
      Object.freeze({ x1: -0.1, y1: 0, x2: -0.9, y2: 0 }),
      Object.freeze({ x1: -0.1, y1: 0, x2: -0.75, y2: 0.75 }),
      Object.freeze({ x1: 0.1, y1: 0, x2: 0.75, y2: -0.75 }),
      Object.freeze({ x1: 0.1, y1: 0, x2: 0.9, y2: 0 }),
      Object.freeze({ x1: 0.1, y1: 0, x2: 0.75, y2: 0.75 }),
    ]),
  });

/** Return the stored normalized lines for one existing motif identity. */
export function borderMotifPrimitives(kind: BorderMotifKind): readonly BorderMotifPrimitive[] {
  return BORDER_MOTIF_PRIMITIVES[kind];
}

// DOM surfaces consume the same normalized line sets as the world canvas, expressed
// as one cached SVG path per motif. The cache is populated while the frozen accent
// table below is built, so the per-frame unit painter only reads stored strings.
// No coordinate is copied: every M/L pair is derived from BORDER_MOTIF_PRIMITIVES.
const BORDER_MOTIF_PATH_CACHE = new Map<BorderMotifKind, string>();
const BORDER_MOTIF_VIEWBOX_CENTER = 12;
const BORDER_MOTIF_VIEWBOX_SCALE = 7;

function motifSvgCoordinate(value: number): number {
  return Number((BORDER_MOTIF_VIEWBOX_CENTER + value * BORDER_MOTIF_VIEWBOX_SCALE).toFixed(2));
}

/** Stable SVG path generated from the canonical normalized primitive set. */
export function borderMotifPath(kind: BorderMotifKind): string {
  const cached = BORDER_MOTIF_PATH_CACHE.get(kind);
  if (cached !== undefined) return cached;
  let path = '';
  const primitives = borderMotifPrimitives(kind);
  for (let i = 0; i < primitives.length; i++) {
    const line = primitives[i];
    path +=
      `M${motifSvgCoordinate(line.x1)} ${motifSvgCoordinate(line.y1)}` +
      `L${motifSvgCoordinate(line.x2)} ${motifSvgCoordinate(line.y2)}`;
  }
  BORDER_MOTIF_PATH_CACHE.set(kind, path);
  return path;
}

export type DeedHeraldryMotifSvgClass = 'deed-heraldry-seal-art' | 'deed-heraldry-pattern';

/** Code-native motif art for cold DOM surfaces. The hot unit-frame path uses a
 *  pre-existing SVG path node and writes this same cached `d` through its elided
 *  attribute writer. */
export function deedHeraldryMotifSvg(
  kind: BorderMotifKind,
  className: DeedHeraldryMotifSvgClass,
): string {
  return `<svg class="${className}" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="${borderMotifPath(kind)}"></path></svg>`;
}

/** The colors one border slug paints with. Consumed as canvas stroke colors by
 *  the nameplate and as CSS custom properties by the portrait ring, so both
 *  surfaces of one identity always agree:
 *  - `frame`: the bright primary line, the color the slug reads as at distance.
 *  - `edge`: the dark contour under/inside the frame line that keeps it legible
 *    against a bright sky or a pale portrait.
 *  - `glow`: the light highlight tint (an inner hairline on the canvas, the
 *    outer bloom on the ring).
 *  - `motif`: which normalized forged-seal primitive set the surface draws.
 *  - `motifPath`: the module-initialized SVG expression of that SAME primitive
 *    set, for DOM surfaces that cannot draw the canvas lines directly. */
export interface BorderAccent {
  readonly frame: string;
  readonly edge: string;
  readonly glow: string;
  readonly motif: BorderMotifKind;
  readonly motifPath: string;
}

// One CSS-token convention for every DOM surface. The world canvas imports the
// same well-fill value below; only its measured alpha differs at world distance.
export const DEED_HERALDRY_ATTR = 'data-border';
export const DEED_HERALDRY_MOTIF_ATTR = 'data-motif';
export const DEED_HERALDRY_FRAME_PROP = '--border-accent-frame';
export const DEED_HERALDRY_EDGE_PROP = '--border-accent-edge';
export const DEED_HERALDRY_GLOW_PROP = '--border-accent-glow';
export const DEED_HERALDRY_WELL_PROP = '--deed-heraldry-well';
export const DEED_HERALDRY_WELL_FILL = '#14110c';

/** Canonical style fragment for cold surfaces. Callers HTML-escape the returned
 *  fragment as one attribute value. */
export function deedHeraldryStyle(accent: Pick<BorderAccent, 'frame' | 'edge' | 'glow'>): string {
  return (
    `${DEED_HERALDRY_FRAME_PROP}:${accent.frame};` +
    `${DEED_HERALDRY_EDGE_PROP}:${accent.edge};` +
    `${DEED_HERALDRY_GLOW_PROP}:${accent.glow};` +
    `${DEED_HERALDRY_WELL_PROP}:${DEED_HERALDRY_WELL_FILL};`
  );
}

// THE palette table: the single source of truth for every border slug's colors
// and motif kind. Literal color strings, not CSS vars, because the canvas
// cannot read a custom property cheaply per plate per frame; the portrait
// ring receives these same literals through the painter instead of
// duplicating them in hud.css. Four deliberately distinct reads at nameplate
// distance: laurel green, deep teal, Catalogue antique brass, and Eternal
// Spoils gold. Every value here is unique repo-wide ON PURPOSE, and
// reliquary_gilt's pair carries a MECHANICAL nudge for it: the classic
// elite/quest gold (#f2c84b, plus #ffdf8a) already lives on the scanned
// accent path, so reusing those exact bytes would force the exact-once scan
// in tests/deed_border_accent.test.ts to carry a collision allowlist, and an
// allowlist is where a real duplicated accent could hide.
// Catalogue brass sits near #c9b17a / ink #2a2214 / cream #f3ead0 and must
// not collide with reliquary_gilt #f4ca43, elite/quest #f2c84b, or any other
// scanned hex (the cream glow is one step off #f3ead0, which already lives
// on the components sheet).
// Each record is Object.frozen, not merely `Readonly` (which is compile-time
// only): borderAccent hands the SAME record straight to a canvas strokeStyle and
// to CSS custom properties on both surfaces, so a stray runtime write to one
// field would silently repaint every plate and ring of that slug. Freezing makes
// such a write throw in strict mode instead.
const BORDER_ACCENTS: Readonly<Record<string, BorderAccent>> = Object.freeze({
  curators_gilt: Object.freeze({
    frame: '#c9b17a',
    edge: '#2a2214',
    glow: '#f3ebcf',
    motif: 'catalogue',
    motifPath: borderMotifPath('catalogue'),
  }),
  deepward: Object.freeze({
    frame: '#4fb3c8',
    edge: '#123a4a',
    glow: '#8fe3f2',
    motif: 'ward',
    motifPath: borderMotifPath('ward'),
  }),
  prestige_laurels: Object.freeze({
    frame: '#8fbf6a',
    edge: '#2f4a1e',
    glow: '#c6e79a',
    motif: 'laurel',
    motifPath: borderMotifPath('laurel'),
  }),
  reliquary_gilt: Object.freeze({
    frame: '#f4ca43',
    edge: '#6b4a12',
    glow: '#ffe28f',
    motif: 'vault',
    motifPath: borderMotifPath('vault'),
  }),
});

/** Every slug the palette table covers, sorted. Derived from the table so the
 *  two can never disagree; the literal pin lives in the test. */
export const BORDER_ACCENT_SLUGS: readonly string[] = Object.keys(BORDER_ACCENTS).sort();

/**
 * The border slug for a deed id, or '' when there is no accent to draw:
 * null/undefined (borderless), an id the live catalog no longer has (content
 * drift against a persisted save), or a deed whose reward is a title.
 * Allocation-free (returns the stored slug), so a per-frame caller can call it
 * on the hot path.
 */
export function deedBorderSlug(deedId: string | null | undefined): string {
  if (!deedId) return '';
  // DEEDS is a plain object, so a bare index with a prototype key
  // ('__proto__', 'constructor') resolves truthy for a hostile or drifted id.
  const def = Object.hasOwn(DEEDS, deedId) ? DEEDS[deedId] : undefined;
  const reward = def?.reward;
  return reward?.kind === 'border' ? reward.slug : '';
}

/** Resolve target-frame heraldry only for a player entity. The identity wire
 *  already omits `border` on other kinds, but this explicit gate keeps a stale or
 *  malformed NPC/mob/object view from inheriting player reward chrome. */
export function deedTargetBorderSlug(
  entityKind: string,
  deedId: string | null | undefined,
): string {
  return entityKind === 'player' ? deedBorderSlug(deedId) : '';
}

/**
 * The palette for a border slug, or null for '' (no border) and for any slug the
 * table does not cover. Returns the stored record itself, never a fresh object,
 * so a per-frame consumer allocates nothing.
 */
export function borderAccent(slug: string): BorderAccent | null {
  if (!slug) return null;
  return Object.hasOwn(BORDER_ACCENTS, slug) ? BORDER_ACCENTS[slug] : null;
}
