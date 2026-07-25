// Hand-gilded ring for the circular minimap disc. Reuses the vocabulary built
// for the Performance Overlay's gilded frame (#2196, src/ui/perf_ornament_svg.ts)
// rather than inventing a second implementation: `perfGiltGradientBackground()`
// as-is for the ring's base hand-applied, uneven TONE (varies by ANGLE), plus
// the same seeded `mulberry32` PRNG and polar helpers that file exports, reused
// here to scatter a sparse field of small dark tarnish spots across the ring
// (varies by POSITION). The ring is thin (matching a real gold ring's
// proportions, see hud.css), and a circular disc needs none of that window's
// rectangular corner/edge SVG masks: the whole ring is one `::before` sized a
// few px larger than the canvas, painted behind it (z-index: -1, see hud.css
// "minimap" section), so the canvas's own fully opaque pixels cover the
// center and only the extra outer band ever reads as the ring.
//
// The speckle SVG is a real colored image, not a colorless mask like this
// file's other consumers: real hand-gilded gold reads as textured because of
// slight dark spotting across the surface, which a single colorless mask
// (one shape, one CSS `background` color) cannot express. Baking resolved
// --color-gold-* values into each speckle's `fill`
// is safe here specifically because that ramp is a static, non-themed design
// constant (tokens.css: "purely additive... never retunes an existing
// consumer"), and this function re-resolves it fresh every time it runs (once
// at boot, same as perfGiltGradientBackground()), so a future ramp retune
// still repaints correctly on the next boot.
import { mulberry32, perfGiltGradientBackground, polarX, polarY } from './perf_ornament_svg';

const SPECKLE_VIEWBOX = 200;
const SPECKLE_SEED = 91501;
// A THIN ring at this element's real size (164px canvas diameter, hud.css
// inset: -6px) leaves a visible band only ~6px wide: a fine 150-dot field
// (an earlier pass) worked out to sub-pixel radii there and vanished on
// screen. Fewer, deliberately larger spots read as real dark tarnish marks
// instead, the way the reference art's ring shows a handful of distinct
// spots rather than a fine, invisible grain.
const SPECKLE_COUNT = 70;
// Normalized radii (of a viewBox where 100 is the ring's own edge): only the
// outer band ever shows, everything inside it is covered by the opaque
// canvas. Measured against the real rendered box (82px canvas radius + 6px
// inset = 88px box radius), the canvas covers the inner 82/88 = 93.2% of
// this element's own radius, so the visible band is the outer ~7%; the
// margin has to sit ABOVE 93.2, not below, or the speckle lands under the
// opaque canvas and never renders at all.
export const SPECKLE_R_MIN = 94;
export const SPECKLE_R_MAX = 100;
const GOLD_STEPS = [300, 400, 500, 600, 700, 800, 900];

function resolveGoldTones(root: HTMLElement): string[] {
  const style = getComputedStyle(root);
  const tones = GOLD_STEPS.map((step) =>
    style.getPropertyValue(`--color-gold-${step}`).trim(),
  ).filter(Boolean);
  // A detached/test root (or a real root read before tokens.css applied) has
  // no computed --color-gold-* values: fall back to a single neutral gold so
  // the generated SVG still has a paintable fill rather than an empty string.
  return tones.length > 0 ? tones : ['#bc8732'];
}

/**
 * A weighted draw pool over the resolved gold tones, biased heavily toward
 * the DARK end of the ramp: the reference art's ring reads as a warm brass
 * base with slight dark tarnish spots scattered across it, not bright
 * flecks. `tones` is `[300, 400, 500, 600, 700, 800, 900]` in that order
 * (see GOLD_STEPS); repeating the dark entries makes them roughly 3x as
 * likely to be drawn as the light ones, with the mid tone in between.
 */
function darkWeightedPool(tones: string[]): string[] {
  if (tones.length < GOLD_STEPS.length) return tones;
  const [t300, t400, t500, t600, t700, t800, t900] = tones;
  return [t700, t700, t700, t800, t800, t800, t900, t900, t900, t600, t600, t300, t400, t500];
}

/**
 * A sparse field of small dark tarnish spots scattered across the ring's
 * thin visible band: mostly small and moderate-opacity, with an occasional
 * larger or fainter one for irregularity, matching how real hand-gilded
 * brass shows slight dark spotting rather than one flat painted color.
 */
export function minimapGiltSpeckleBackground(root: HTMLElement = document.documentElement): string {
  const pool = darkWeightedPool(resolveGoldTones(root));
  const rand = mulberry32(SPECKLE_SEED);
  const cx = SPECKLE_VIEWBOX / 2;
  const cy = SPECKLE_VIEWBOX / 2;
  const circles: string[] = [];
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    const deg = rand() * 360;
    const r = SPECKLE_R_MIN + rand() * (SPECKLE_R_MAX - SPECKLE_R_MIN);
    const x = polarX(cx, r, deg);
    const y = polarY(cy, r, deg);
    // Squaring biases toward small radii most of the time, with an occasional
    // larger spot breaking through: the same "mostly small, rarely large"
    // distribution real hammered/hand-applied gold leaf shows.
    const radius = 1.2 + rand() * rand() * 2.6;
    const tone = pool[Math.floor(rand() * pool.length)];
    const opacity = (0.55 + rand() * 0.4).toFixed(2);
    circles.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${tone}" fill-opacity="${opacity}"/>`,
    );
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${SPECKLE_VIEWBOX} ${SPECKLE_VIEWBOX}'>${circles.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Sets the `--minimap-gilt` / `--minimap-speckle` custom properties
 * `#minimap-disc::before` (hud.css) consumes. Called once at game boot
 * (main.ts, next to `applyPerfOrnamentVars()`); both values are static per
 * boot, so this never needs to re-run on a theme switch.
 */
export function applyMinimapOrnamentVars(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--minimap-gilt', perfGiltGradientBackground());
  root.style.setProperty('--minimap-speckle', minimapGiltSpeckleBackground(root));
}
