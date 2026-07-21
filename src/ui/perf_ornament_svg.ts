// Hand-gilded filigree ornament for the Performance Overlay window
// (#options-menu.perf-wide only; see components.css). A narrow, deliberately
// scoped pilot: it does not touch the shared .panel/.window primitive or any
// other window, and reads its own --perf-ornament-* / --color-gold-* tokens
// (tokens.css) rather than retuning --gold/--border. See PR body for the scope
// rationale; a repo-wide DESIGN.md rollout is tracked separately.
//
// Adapts the proven techniques from the (unmerged, closed) PR #2152 fantasy-HUD
// ornament redesign: shapes are COLORLESS SVG, consumed only as CSS
// `mask-image` data-URIs (never inserted into the DOM), so the element's own
// `background` supplies the visible color and the ornament repaints for free on
// a token change. Noise is a small seeded PRNG picking amplitude/phase for a
// few INTEGER-frequency sine harmonics: because sin(k*0*2*pi+phase) ==
// sin(k*1*2*pi+phase) for integer k, the resulting wave is exactly periodic
// over its sample domain, so a tiled edge ribbon has no visible seam.
//
// The corner motif went through a second full redesign against a Baroque
// acanthus-scroll reference vector (a nautilus-style volute with leaves
// wrapping its own outer curve, plus two leafy tendrils running outward
// along the edges): a single thick rounded curl (the prior round's design)
// read as too plain next to that reference's dense scrollwork. Geometry
// noise and color noise are still two SEPARATE knobs: each stroke carries
// only a small radius wobble, while the gilt gradient below supplies the
// "hand-applied, unevenly toned" color read.

function polarX(cx: number, r: number, deg: number): number {
  return cx + r * Math.cos((deg * Math.PI) / 180);
}

function polarY(cy: number, r: number, deg: number): number {
  return cy + r * Math.sin((deg * Math.PI) / 180);
}

function n(v: number): string {
  return Number(v.toFixed(2)).toString();
}

function svgDataUri(inner: string, viewBoxSize: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${viewBoxSize} ${viewBoxSize}'>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ---------- deterministic noise: seeded, periodic (so a tiled edge never
// shows a seam where the pattern repeats) ----------

/** mulberry32: a small, fast, deterministic PRNG. Presentation-only (this file
 * never runs in src/sim/, so the sim's Math.random ban does not apply); used
 * to pick noise-harmonic parameters once at generation time, not per-frame. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Harmonic {
  k: number;
  amp: number;
  phase: number;
}

/** Integer harmonics (k = 1, 2, 3, ...) so the resulting wave is exactly
 * periodic over t in [0, 1): a tile built from it wraps seamlessly. */
function seededHarmonics(seed: number, count: number, maxAmp: number): Harmonic[] {
  const rand = mulberry32(seed);
  const harmonics: Harmonic[] = [];
  for (let i = 0; i < count; i++) {
    const k = i + 1;
    const amp = (maxAmp * (0.35 + 0.65 * rand())) / k ** 0.85;
    const phase = rand() * Math.PI * 2;
    harmonics.push({ k, amp, phase });
  }
  return harmonics;
}

function periodicNoise(harmonics: Harmonic[], t: number): number {
  let v = 0;
  for (const h of harmonics) v += h.amp * Math.sin(h.k * t * Math.PI * 2 + h.phase);
  return v;
}

// ---------- gilt color: a repeating-conic-gradient over the gold ramp tokens,
// so the "gold" of the frame visibly shifts tone as you trace around the
// window's perimeter, the way hand-applied gold leaf catches light unevenly,
// instead of reading as one flat color ----------

// An integer divisor of 360 (9 repeats) so the gradient closes with no seam.
// Deliberately NOT a divisor of 90: each of the window's 4 corners then lands
// on a different point in the color cycle, rather than all 4 matching.
const GILT_PERIOD_DEG = 20;
const GILT_STOP_COUNT = 6;
const GILT_SEED = 2152;

/** Every candidate color is a --color-gold-* token or a color-mix() of them
 * (never a literal hex), so the gradient repaints on a future token retune.
 * Weighted toward the REALISTIC-gold mid-tones (500/400/600, repeated) with
 * the near-black and near-white extremes kept as rare accents rather than
 * equally-likely picks: an earlier, uniformly-weighted version swung too far
 * toward those extremes and read as muddy/harsh rather than "gold". */
function giltColorPalette(): string[] {
  return [
    'var(--color-gold-600)',
    'var(--color-gold-500)',
    'var(--color-gold-400)',
    'var(--color-gold-500)',
    'var(--color-gold-600)',
    'var(--color-gold-400)',
    'var(--color-gold-700)',
    'color-mix(in srgb, var(--color-gold-500) 60%, var(--color-gold-300) 40%)',
    'color-mix(in srgb, var(--color-gold-600) 65%, var(--color-gold-800) 35%)',
    'var(--color-gold-300)',
  ];
}

function giltGradientStops(): string {
  const p = GILT_PERIOD_DEG;
  const rand = mulberry32(GILT_SEED);
  const palette = giltColorPalette();
  // Both period boundaries share the SAME color so the repeat closes with no
  // visible seam, exactly like the noise harmonics' seamlessness contract.
  const anchor = palette[0];
  const positions = Array.from({ length: GILT_STOP_COUNT }, () => rand() * p).sort((a, b) => a - b);
  const stops = [`${anchor} 0deg`];
  for (const pos of positions) {
    const color = palette[1 + Math.floor(rand() * (palette.length - 1))];
    stops.push(`${color} ${n(pos)}deg`);
  }
  stops.push(`${anchor} ${n(p)}deg`);
  return stops.join(', ');
}

/**
 * `repeating-conic-gradient` centered on the element, so the same value
 * naturally colors a rectangle's perimeter (the angle from center sweeps
 * smoothly corner to corner) with no separate variant needed. Consumed as
 * `background` wherever the ornament previously used a flat token color.
 */
export function perfGiltGradientBackground(): string {
  return `repeating-conic-gradient(from 0deg, ${giltGradientStops()})`;
}

// ---------- corner motif: a Baroque acanthus scroll, matching a reference
// vector illustration of an ornate hand-carved corner flourish. THREE parts,
// all FACING OUTWARD from the corner vertex (never curling back toward the
// window's center): a tightening volute (the "spiral scroll") anchored at
// the corner with leaves wrapping its own outer curve (not just at the
// tendril tips, matching the reference's leaf-wrapped scroll rather than a
// bare wire spiral), a short leafy tendril running out along the top edge,
// and a longer leafy tendril running out along the side edge with its own
// small secondary curl partway along, matching the reference's asymmetric
// L-shaped composition (one short arm, one long arm, both rooted in one
// spiral) ----

const CORNER_SIZE = 84;
const CORNER_PIVOT_X = 20;
const CORNER_PIVOT_Y = 20;

/** Must equal `#options-menu.perf-wide`'s own `border-radius` (components.css),
 * in the SAME pixel space as `CORNER_SIZE` (the tile is stamped at 1:1 scale,
 * `mask-size: ${CORNER_SIZE}px ${CORNER_SIZE}px`). The corner motif is open
 * filigree, not a solid block, so without an explicit trace of the rounded
 * corner curve the panel's own dark background peeks through the gaps right
 * at the boundary between the outer gilded edge and the panel's rounded
 * corner, reading as a stray dark border cutting the ornament off at the
 * radius. `cornerRadiusTraceStroke` below draws a wide band centered on that
 * exact curve so gold ink covers it continuously. */
const CORNER_RADIUS_TRACE = 30;

/**
 * The 4 corner variants are mirrored by baking the flip into every emitted
 * COORDINATE (`n2` below), never via an SVG `<g transform="... scale(-1 ...)">`
 * wrapper. An earlier version used that wrapper and hit a real Chromium mask
 * rendering bug: combining SEVERAL DIFFERING large inline-SVG `mask-image`
 * data URIs in one multi-layer `mask-image` list, where the differing layers
 * relied on a negative-scale `<g transform>`, made every layer render as the
 * FIRST (unmirrored) layer's shape (confirmed by isolating the variable in a
 * minimal repro: identical-content layers combined correctly regardless of
 * transform presence; genuinely differing negative-scale-transformed layers
 * did not, even for a two-line bracket with no other complexity). Baking the
 * mirror into plain coordinate math sidesteps the whole mechanism.
 */
interface Mirror {
  x: boolean;
  y: boolean;
  size: number;
}

function n2(x: number, y: number, m: Mirror): string {
  const mx = m.x ? m.size - x : x;
  const my = m.y ? m.size - y : y;
  return `${n(mx)} ${n(my)}`;
}

/**
 * A tightening volute: `t=0` is the OUTER end (large radius, where a tendril
 * arm departs from), `t=1` is the tight inner curl. `turns` > 1 (typically
 * 1.2-1.4) is what makes it read as a scroll rather than a plain arc; the
 * radius shrinks smoothly across the whole sweep, never bulging back out.
 */
function spiralPoint(
  t: number,
  cx: number,
  cy: number,
  startDeg: number,
  turns: number,
  rOuter: number,
  rInner: number,
  wobble: Harmonic[],
): { x: number; y: number } {
  const deg = startDeg + turns * 360 * t;
  const r = rOuter + (rInner - rOuter) * t + periodicNoise(wobble, t) * 0.35;
  return { x: polarX(cx, r, deg), y: polarY(cy, r, deg) };
}

function spiralStroke(
  cx: number,
  cy: number,
  startDeg: number,
  turns: number,
  rOuter: number,
  rInner: number,
  width: number,
  seed: number,
  tMax: number,
  m: Mirror,
): string {
  const samples = 40;
  const wobble = seededHarmonics(seed, 3, 0.3);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * tMax;
    const { x, y } = spiralPoint(t, cx, cy, startDeg, turns, rOuter, rInner, wobble);
    pts.push(n2(x, y, m));
  }
  return `<path d="M ${pts.join(' L ')}" fill="none" stroke="#000" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * A pointed acanthus leaflet: a smooth main lobe curving to a point (2
 * quadratic curves, like a classic pointed leaf silhouette), with ONE small
 * secondary lobe budding off the outer edge partway along. The secondary
 * lobe is its OWN small closed curve merged into the same path (not a
 * polygon notch cut into the main outline), which is what keeps the main
 * leaf's edge smooth while still reading as multi-lobed foliage, closer to
 * the reference than a single jagged polygon (an earlier attempt at "one
 * outline with a zigzag notch" read as a chevron/arrow, not a leaf).
 * `baseX,baseY` is where it sprouts from a tendril; `angleDeg` points from
 * base toward the tip (0 = along +x).
 */
function leafletPath(
  baseX: number,
  baseY: number,
  len: number,
  width: number,
  angleDeg: number,
  m: Mirror,
): string {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pt = (x: number, y: number): string => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return n2(baseX + rx, baseY + ry, m);
  };
  const main =
    `M ${pt(0, 0)} ` +
    `Q ${pt(len * 0.4, -width)} ${pt(len, 0)} ` +
    `Q ${pt(len * 0.55, width * 0.7)} ${pt(0, 0)} Z`;
  // Secondary lobe: a smaller leaf budding off the main one's outer edge at
  // ~45% of the way along, angled back slightly toward the base.
  const budBaseX = len * 0.42;
  const budBaseY = -width * 0.55;
  const budLen = len * 0.42;
  const budWidth = width * 0.55;
  const budAngle = -32;
  const budRad = (budAngle * Math.PI) / 180;
  const budCos = Math.cos(budRad);
  const budSin = Math.sin(budRad);
  const budPt = (x: number, y: number): string => {
    const rx = x * budCos - y * budSin;
    const ry = x * budSin + y * budCos;
    return pt(budBaseX + rx, budBaseY + ry);
  };
  const bud =
    `M ${budPt(0, 0)} ` +
    `Q ${budPt(budLen * 0.4, -budWidth)} ${budPt(budLen, 0)} ` +
    `Q ${budPt(budLen * 0.5, budWidth * 0.6)} ${budPt(0, 0)} Z`;
  return `${main} ${bud}`;
}

function cornerMotifPath(m: Mirror): string {
  const px = CORNER_PIVOT_X;
  const py = CORNER_PIVOT_Y;

  // The volute: outer end at deg=-20 (pointing up-and-right, where the top
  // tendril picks up), winding 1.3 turns down to a tight inner curl. A
  // second, shorter inner stroke over just the outer ~55% of the same sweep
  // (not the full spiral) suggests the rolled leaf-surface detail line
  // visible inside the reference's volute, without literally doubling it.
  const outerBody = spiralStroke(px, py, -20, 1.3, 12.5, 2, 2.6, 401, 1, m);
  const innerDetail = spiralStroke(px, py, -20, 1.3, 9, 4.5, 1.2, 402, 0.55, m);
  // The reference's leaves do not wait for the tendrils to branch off: a
  // couple of blades wrap the spiral's own outer curve first, splaying
  // radially outward from the pivot (same angle the spiral point sits at),
  // so the volute itself reads as leaf-wrapped rather than bare wire.
  const outerBodyWobble = seededHarmonics(401, 3, 0.3);
  const spiralLeafA = spiralPoint(0.12, px, py, -20, 1.3, 12.5, 2, outerBodyWobble);
  const spiralLeafB = spiralPoint(0.3, px, py, -20, 1.3, 12.5, 2, outerBodyWobble);
  const spiralLeaves = [
    leafletPath(spiralLeafA.x, spiralLeafA.y, 9, 3.4, -20 + 1.3 * 360 * 0.12, m),
    leafletPath(spiralLeafB.x, spiralLeafB.y, 7.5, 3, -20 + 1.3 * 360 * 0.3, m),
  ].join(' ');

  // Top tendril: departs the volute's outer end, runs out along the top
  // edge (increasing x, gently rising), OUTWARD the whole way (radius from
  // the pivot only grows). The angle swing stays shallow (-20deg to -27deg)
  // so the reach (up to r=24) stays safely on-canvas (deg more negative than
  // roughly -35deg at this radius would push y negative, off the viewBox).
  const topTendril = spiralStroke(px, py, -20, -0.02, 12.5, 24, 2.2, 403, 1, m);
  const topLeaves = [
    leafletPath(px + 15, py - 4, 11, 3.6, -16, m),
    leafletPath(px + 22, py - 6, 8, 2.7, -8, m),
  ].join(' ');

  // Side tendril: departs the SAME pivot heading downward (deg near 100),
  // OUTWARD along the side edge, with its own smaller secondary curl about
  // 60% of the way down (the reference's rhythm of a second, smaller volute
  // partway along the long running arm), then continues to a leaf tip.
  const sideRun = spiralStroke(px, py, 100, -0.05, 12, 24, 2.3, 404, 0.62, m);
  const sideCurlPivot = spiralPoint(0.62, px, py, 100, -0.05, 12, 24, seededHarmonics(404, 3, 0.3));
  const sideCurl = spiralStroke(sideCurlPivot.x, sideCurlPivot.y, 60, 0.85, 6, 1.5, 1.5, 405, 1, m);
  const sideTailStart = -0.06;
  const sideTailWobble = seededHarmonics(406, 3, 0.3);
  const sideTail = spiralStroke(
    sideCurlPivot.x,
    sideCurlPivot.y,
    150,
    sideTailStart,
    6,
    30,
    1.6,
    406,
    1,
    m,
  );
  // Foliage runs the WHOLE length of both tendrils (the reference's leaves
  // stack continuously along the vine, not just near the scroll): one
  // leaflet near the base of each run, one mid-way, one at the curl/tip.
  // Positions come from the SAME spiral parameterization the stroke itself
  // uses (never hand-guessed coordinates), so a leaf always sits ON its
  // tendril regardless of future radius/angle tuning.
  const sideRunWobble = seededHarmonics(404, 3, 0.3);
  const sideRunMid = spiralPoint(0.32, px, py, 100, -0.05, 12, 24, sideRunWobble);
  const sideTailMid = spiralPoint(
    0.45,
    sideCurlPivot.x,
    sideCurlPivot.y,
    150,
    sideTailStart,
    6,
    30,
    sideTailWobble,
  );
  const sideTailTip = spiralPoint(
    0.92,
    sideCurlPivot.x,
    sideCurlPivot.y,
    150,
    sideTailStart,
    6,
    30,
    sideTailWobble,
  );
  const sideLeaves = [
    leafletPath(px + 3, py + 14, 8, 3.2, 82, m),
    leafletPath(sideRunMid.x - 1, sideRunMid.y + 1, 7, 2.8, 88, m),
    leafletPath(sideCurlPivot.x - 2, sideCurlPivot.y + 10, 7, 2.7, 95, m),
    leafletPath(sideTailMid.x - 1, sideTailMid.y + 1, 7.5, 2.9, 110, m),
    leafletPath(sideTailTip.x, sideTailTip.y, 6, 2.4, 128, m),
  ].join(' ');

  const fills = `<path d="${[spiralLeaves, topLeaves, sideLeaves].join(' ')}"/>`;
  const radiusTrace = cornerRadiusTraceStroke(m);
  return outerBody + innerDetail + topTendril + sideRun + sideCurl + sideTail + radiusTrace + fills;
}

/**
 * A wide band stroked along the exact rounded-corner curve
 * (`#options-menu.perf-wide`'s `border-radius`, in this tile's own pixel
 * space), centered at `(CORNER_RADIUS_TRACE, CORNER_RADIUS_TRACE)` and swept
 * from the point where the curve meets the left edge (deg 180) to where it
 * meets the top edge (deg 270). The band is wide enough to fully overlap
 * both the gilded frame's own outer rounding and the panel's rounded corner
 * a few pixels further in, so no dark sliver of the panel shows through
 * between them.
 */
function cornerRadiusTraceStroke(m: Mirror): string {
  const samples = 24;
  const r = CORNER_RADIUS_TRACE;
  const cx = r;
  const cy = r;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const deg = 180 + t * 90;
    pts.push(n2(polarX(cx, r, deg), polarY(cy, r, deg), m));
  }
  return `<path d="M ${pts.join(' L ')}" fill="none" stroke="#000" stroke-width="12" stroke-linecap="round"/>`;
}

/** One `mask-image` layer per corner (top-left orientation, then the same
 * geometry mirrored in coordinate space for the other three; see the
 * `Mirror` doc comment above for why this avoids an SVG `<g transform>`). */
function cornerMotifDataUri(mirrorX: boolean, mirrorY: boolean): string {
  const inner = cornerMotifPath({ x: mirrorX, y: mirrorY, size: CORNER_SIZE });
  return svgDataUri(inner, CORNER_SIZE);
}

/** All four corners as one comma-separated `mask-image` value (top-left,
 * top-right, bottom-left, bottom-right, in that order). */
export function perfCornerOrnamentMaskImage(): string {
  return [
    cornerMotifDataUri(false, false),
    cornerMotifDataUri(true, false),
    cornerMotifDataUri(false, true),
    cornerMotifDataUri(true, true),
  ].join(', ');
}

export const PERF_CORNER_SIZE = CORNER_SIZE;

// ---------- mid-edge ornament: a small flourish centered on each edge's
// midpoint (between the two corner scrolls), so the frame reads as
// continuously ornamented rather than corners-only. Built from the SAME
// spiral/leaflet vocabulary as the corner motif, but reused directly: since
// spiralStroke/leafletPath both work in absolute polar degrees around a
// pivot, a "point outward" requirement is just an angle, so the one motif
// below is reused for all 4 edges by rotating `outwardDeg` (top = -90 (up),
// right = 0, bottom = 90 (down), left = 180) instead of needing a second
// coordinate-mirroring scheme like the corner's `Mirror`. The two side
// tendrils are generated at symmetric angle offsets around `outwardDeg`
// (never independently placed), so every edge motif is exactly left-right
// symmetric and, like the corner tendrils, grows outward (radius from the
// pivot only increases) the whole way, never curling back toward the
// window's interior. ----------

const MID_EDGE_SIZE = 44;
const MID_EDGE_CENTER = MID_EDGE_SIZE / 2;
// Distance from the tile's center to the pivot, placing the pivot close to
// the tile's OWN edge in the outward direction (never at the tile's dead
// center): the tile is stamped with its outward side flush against the
// window's actual edge line (`mask-position: center top` etc, components.css),
// so a center-pivoted motif would read as growing INTO the panel, with only
// its thin outer tip ever reaching the edge. Anchoring the pivot near the
// edge instead, the same way the corner motif's pivot sits right at the
// corner vertex, makes the whole motif hug and grow from the boundary line.
const MID_EDGE_PIVOT_OFFSET = MID_EDGE_CENTER - 16;
// Identity: the mid-edge motif needs no coordinate mirroring (unlike the
// corner motif's 4 variants), only angle rotation.
const MID_EDGE_IDENTITY: Mirror = { x: false, y: false, size: MID_EDGE_SIZE };

function midEdgeMotifPath(outwardDeg: number, seedBase: number): string {
  const cx = MID_EDGE_CENTER + MID_EDGE_PIVOT_OFFSET * Math.cos((outwardDeg * Math.PI) / 180);
  const cy = MID_EDGE_CENTER + MID_EDGE_PIVOT_OFFSET * Math.sin((outwardDeg * Math.PI) / 180);
  const m = MID_EDGE_IDENTITY;

  // A short, nearly-straight stem running from the pivot straight out
  // (`outwardDeg`, toward and slightly past the edge line), tipped with a
  // single leaf so it doesn't dead-end bare.
  const stem = spiralStroke(cx, cy, outwardDeg, 0.03, 2, 14, 2.4, seedBase, 1, m);
  const stemTip = spiralPoint(
    1,
    cx,
    cy,
    outwardDeg,
    0.03,
    2,
    14,
    seededHarmonics(seedBase, 3, 0.3),
  );
  const stemLeaf = leafletPath(stemTip.x, stemTip.y, 7.5, 3, outwardDeg, m);

  // Two side tendrils, angled symmetrically around `outwardDeg` (mirrored
  // offsets, and mirrored `turns` sign so they curl toward each other
  // rather than both the same way), each growing outward from the SAME
  // edge-hugging pivot the whole way, staying close to the boundary rather
  // than reaching back toward the tile's (and so the window's) center.
  const spread = 50;
  const sideADeg = outwardDeg - spread;
  const sideBDeg = outwardDeg + spread;
  const sideA = spiralStroke(cx, cy, sideADeg, 0.14, 2.5, 13, 2.2, seedBase + 1, 1, m);
  const sideB = spiralStroke(cx, cy, sideBDeg, -0.14, 2.5, 13, 2.2, seedBase + 1, 1, m);
  const sideAWobble = seededHarmonics(seedBase + 1, 3, 0.3);
  const sideATip = spiralPoint(1, cx, cy, sideADeg, 0.14, 2.5, 13, sideAWobble);
  const sideBTip = spiralPoint(1, cx, cy, sideBDeg, -0.14, 2.5, 13, sideAWobble);
  const sideATipDeg = sideADeg + 0.14 * 360;
  const sideBTipDeg = sideBDeg - 0.14 * 360;
  const sideALeaf = leafletPath(sideATip.x, sideATip.y, 6, 2.5, sideATipDeg, m);
  const sideBLeaf = leafletPath(sideBTip.x, sideBTip.y, 6, 2.5, sideBTipDeg, m);

  const fills = `<path d="${[stemLeaf, sideALeaf, sideBLeaf].join(' ')}"/>`;
  return stem + sideA + sideB + fills;
}

function midEdgeMotifDataUri(outwardDeg: number, seedBase: number): string {
  return svgDataUri(midEdgeMotifPath(outwardDeg, seedBase), MID_EDGE_SIZE);
}

/** One `mask-image` layer per edge midpoint (top, bottom, left, right, in
 * that order, matching the `mask-position` list in components.css). */
export function perfMidEdgeOrnamentMaskImage(): string {
  return [
    midEdgeMotifDataUri(-90, 501),
    midEdgeMotifDataUri(90, 502),
    midEdgeMotifDataUri(180, 503),
    midEdgeMotifDataUri(0, 504),
  ].join(', ');
}

export const PERF_MID_EDGE_SIZE = MID_EDGE_SIZE;

// ---------- noisy gilt edge: a seamlessly tileable ribbon. The centerline
// stays essentially straight (a hand-gilded line follows the edge, it does
// not wander off it) and only the stroke width wavers, ever so slightly; the
// "hand-applied, not machine-drawn" read comes mainly from the gilt
// gradient's color noise above, not from geometric waviness ----------

const EDGE_TILE_LENGTH = 96;
const EDGE_TILE_THICKNESS = 12;
const EDGE_BASE_WIDTH = 2.6;
const EDGE_MIN_HALF_WIDTH = 0.6;

/** `vertical` swaps the sampled axis so the SAME noise profile tiles along a
 * vertical (left/right) edge instead of a horizontal (top/bottom) one. */
function noisyEdgeInner(seed: number, vertical: boolean): string {
  const samples = 56;
  const centerHarmonics = seededHarmonics(seed, 6, 0.3);
  const widthHarmonics = seededHarmonics(seed + 1000, 5, 1.1);
  const cross = EDGE_TILE_THICKNESS / 2;
  const topPts: string[] = [];
  const botPts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const along = t * EDGE_TILE_LENGTH;
    const center = cross + periodicNoise(centerHarmonics, t);
    const halfW = Math.max(
      EDGE_MIN_HALF_WIDTH,
      (EDGE_BASE_WIDTH + periodicNoise(widthHarmonics, t)) / 2,
    );
    const a = center - halfW;
    const b = center + halfW;
    if (vertical) {
      topPts.push(`${n(a)} ${n(along)}`);
      botPts.push(`${n(b)} ${n(along)}`);
    } else {
      topPts.push(`${n(along)} ${n(a)}`);
      botPts.push(`${n(along)} ${n(b)}`);
    }
  }
  const d = `M ${topPts.join(' L ')} L ${botPts.reverse().join(' L ')} Z`;
  return `<path d="${d}"/>`;
}

/**
 * A horizontal (or, transposed, vertical) tile of the noisy gilt edge.
 * `seed` varies per axis so the horizontal and vertical edges don't wobble in
 * lockstep.
 */
export function perfNoisyEdgeMaskImage(seed: number, vertical: boolean): string {
  const viewBox = vertical
    ? `0 0 ${EDGE_TILE_THICKNESS} ${EDGE_TILE_LENGTH}`
    : `0 0 ${EDGE_TILE_LENGTH} ${EDGE_TILE_THICKNESS}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${noisyEdgeInner(seed, vertical)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const PERF_EDGE_TILE_LENGTH = EDGE_TILE_LENGTH;
export const PERF_EDGE_TILE_THICKNESS = EDGE_TILE_THICKNESS;

// ---------- boot wiring ----------

/**
 * Sets the `--perf-ornament-*` custom properties the #options-menu.perf-wide
 * CSS consumes. Called once at game boot (main.ts, next to `hydrateIcons()`);
 * shapes are static, so this never needs to re-run on a theme switch.
 *
 * Each of the 4 edge tiles gets its OWN seed (never the top tile's value
 * reused for the bottom, or the left tile's for the right): the combined
 * `#options-menu.perf-wide::before` mask-image list (components.css)
 * references all 4 individually. This isn't just "so opposite edges don't
 * wobble in lockstep" (the reason every OTHER seed in this file is distinct)
 * -- it also works around a real Chromium multi-layer-mask rendering bug,
 * confirmed by isolating the variable in a minimal repro: a `mask-image`
 * list that repeats the literal SAME `url(...)` value at two different
 * `mask-position` slots only renders the FIRST occurrence; every later
 * occurrence of that identical value silently fails to paint. Distinct
 * seeds make every layer's data URI byte-different, sidestepping it.
 */
export function applyPerfOrnamentVars(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--perf-ornament-corner', perfCornerOrnamentMaskImage());
  root.style.setProperty('--perf-ornament-mid-edge', perfMidEdgeOrnamentMaskImage());
  root.style.setProperty('--perf-ornament-edge-top', perfNoisyEdgeMaskImage(1, false));
  root.style.setProperty('--perf-ornament-edge-bottom', perfNoisyEdgeMaskImage(3, false));
  root.style.setProperty('--perf-ornament-edge-left', perfNoisyEdgeMaskImage(2, true));
  root.style.setProperty('--perf-ornament-edge-right', perfNoisyEdgeMaskImage(4, true));
  root.style.setProperty('--perf-ornament-gilt', perfGiltGradientBackground());
}
