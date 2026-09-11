// The minimap rim day/night dial: a ring painted with the world sky cycle (deep
// navy night, warm dawn/dusk glow, bright day blue), a "now" marker that sweeps it
// once per cycle, and a centre sun or moon. Purely visual (the canvas is
// aria-hidden) and reads the shared UTC-anchored cycle, so a glance shows the
// current time of day and how far the marker sits from the coming day or night.
//
// Extracted verbatim from Hud.updateDayNightDial(). The only behavioural change is
// where the colors come from: the sun, moon and marker are design tokens resolved
// through ONE cached getComputedStyle pass (the minimap_painter.ts idiom) instead of
// hex literals baked into the coordinator. The ring and the centre disc keep reading
// the shared sky model, whose tint is a numeric triple, so those stay composed here.

import { currentDayNightPhase } from '../render/day_night_clock';
import { globalDayness, skyTintForDayness } from '../render/day_night_core';

/**
 * The design tokens the dial resolves once and caches (they are static `:root`
 * values, same contract as `MINIMAP_COLOR_TOKENS`). Exported so the suite can pin
 * every entry against tokens.css: a token missing there freezes as '' for the
 * session once the resolve caches, and the glyph would then draw default black.
 */
export const DAY_NIGHT_DIAL_COLOR_TOKENS = {
  sun: '--color-daynight-sun',
  moon: '--color-daynight-moon',
  marker: '--color-daynight-marker',
  markerOutline: '--color-daynight-marker-outline',
} as const;

/** The resolved dial colors for one redraw. */
export type DayNightDialColors = Record<keyof typeof DAY_NIGHT_DIAL_COLOR_TOKENS, string>;

/** Backing resolution of #minimap-daynight (CSS shows it at 44px, so 2x for crispness). */
export const DAY_NIGHT_DIAL_SIZE = 88;
/** The marker crawls across a 20-minute cycle, so ~1Hz is ample. */
export const DAY_NIGHT_DIAL_REDRAW_MS = 1000;

const RING_RADIUS = 34; // ring centreline radius
const RING_WIDTH = 11;
const RING_SEGMENTS = 60;
const SEGMENT_OVERLAP = 0.02; // hides the seams between butt-capped arcs
const CENTRE_INSET = 2; // gap between the ring's inner edge and the centre disc
const SUN_RADIUS = 8;
const SUN_RAY_COUNT = 8;
const SUN_RAY_INNER = 11.5;
const SUN_RAY_OUTER = 15.5;
const MOON_RADIUS = 8.8;
const MOON_BITE_DX = 4.4;
const MOON_BITE_DY = -3.2;
const MARKER_RADIUS = 5.2;
const MARKER_GLOW_BLUR = 8;
const STROKE_WIDTH = 2;
const DAY_THRESHOLD = 0.5; // at or above this dayness the centre shows the sun

/** noon (brightest) sits at the top, midnight at the bottom; the marker sweeps
 *  clockwise once per cycle. angle = pi/2 + phase*2pi (canvas y is down). */
const angleForPhase = (phase: number): number => Math.PI / 2 + phase * Math.PI * 2;

const rgb = (c: readonly [number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

/**
 * Owns the #minimap-daynight canvas. One instance is built by Hud, handed the
 * canvas at HUD init, and painted on the same fast band the clock rides; it
 * self-throttles to DAY_NIGHT_DIAL_REDRAW_MS off the caller's monotonic clock.
 */
export class DayNightDialPainter {
  private ctx: CanvasRenderingContext2D | null = null;
  // The resolved dial tokens, cached after the first successful resolve. Static
  // `:root` tokens with no runtime mutation, so re-reading them per redraw would be
  // wasted work and would risk a synchronous style recalc. If a runtime theme or
  // contrast toggle is ever added, invalidate this cache from that signal.
  private colors: DayNightDialColors | null = null;
  // null means "due now", so the first paint after attach or invalidate draws
  // whatever the caller's clock reads (it need only be monotonic).
  private lastDrawAt: number | null = null;

  /** Bind the dial canvas. A missing canvas leaves the painter inert. */
  attach(canvas: HTMLCanvasElement | null): void {
    this.ctx = canvas?.getContext('2d') ?? null;
  }

  /** Force a redraw on the next paint (the /daynight dev command calls this so an
   *  override shows without the throttle wait). */
  invalidate(): void {
    this.lastDrawAt = null;
  }

  /** Resolve the dial color tokens in one getComputedStyle pass (a 2D context can
   *  only read a CSS var this way), then cache them. */
  private resolveColors(): DayNightDialColors {
    if (this.colors) return this.colors;
    const cs = getComputedStyle(document.documentElement);
    const colors = {} as DayNightDialColors;
    for (const key of Object.keys(
      DAY_NIGHT_DIAL_COLOR_TOKENS,
    ) as (keyof typeof DAY_NIGHT_DIAL_COLOR_TOKENS)[]) {
      colors[key] = cs.getPropertyValue(DAY_NIGHT_DIAL_COLOR_TOKENS[key]).trim();
    }
    // Cache only once the tokens actually resolved: a redraw before the stylesheet
    // is applied reads '' and must not freeze (it self-heals on the next redraw).
    if (colors.marker) this.colors = colors;
    return colors;
  }

  paint(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.lastDrawAt !== null && now - this.lastDrawAt < DAY_NIGHT_DIAL_REDRAW_MS) return;
    this.lastDrawAt = now;
    const colors = this.resolveColors();

    const size = DAY_NIGHT_DIAL_SIZE;
    const cx = size / 2;
    const cy = size / 2;
    const rInner = RING_RADIUS - RING_WIDTH / 2 - CENTRE_INSET;

    ctx.clearRect(0, 0, size, size);

    // the ring: sample the cycle in segments, each an arc of its sky color. The
    // small angular overlap hides seams between the butt-capped arc segments.
    ctx.lineWidth = RING_WIDTH;
    ctx.lineCap = 'butt';
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const p0 = i / RING_SEGMENTS;
      const p1 = (i + 1) / RING_SEGMENTS;
      ctx.strokeStyle = rgb(skyTintForDayness(globalDayness((p0 + p1) / 2)));
      ctx.beginPath();
      ctx.arc(cx, cy, RING_RADIUS, angleForPhase(p0), angleForPhase(p1) + SEGMENT_OVERLAP);
      ctx.stroke();
    }

    const phaseNow = currentDayNightPhase();
    const daynessNow = globalDayness(phaseNow);
    const skyNow = skyTintForDayness(daynessNow);

    // centre disc tinted to the current sky, with a sun by day or a moon by night
    ctx.fillStyle = rgb(skyNow);
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fill();
    if (daynessNow >= DAY_THRESHOLD) {
      ctx.fillStyle = colors.sun;
      ctx.beginPath();
      ctx.arc(cx, cy, SUN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.sun;
      ctx.lineWidth = STROKE_WIDTH;
      for (let i = 0; i < SUN_RAY_COUNT; i++) {
        const a = (i / SUN_RAY_COUNT) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * SUN_RAY_INNER, cy + Math.sin(a) * SUN_RAY_INNER);
        ctx.lineTo(cx + Math.cos(a) * SUN_RAY_OUTER, cy + Math.sin(a) * SUN_RAY_OUTER);
        ctx.stroke();
      }
    } else {
      // crescent: a pale disc minus an offset disc repainted in the sky color
      ctx.fillStyle = colors.moon;
      ctx.beginPath();
      ctx.arc(cx, cy, MOON_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(skyNow);
      ctx.beginPath();
      ctx.arc(cx + MOON_BITE_DX, cy + MOON_BITE_DY, MOON_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // the "now" marker: a glowing pip riding the ring at the current phase,
    // sized and haloed so the cycle position reads at a glance
    const am = angleForPhase(phaseNow);
    const mx = cx + Math.cos(am) * RING_RADIUS;
    const my = cy + Math.sin(am) * RING_RADIUS;
    ctx.save();
    ctx.shadowColor = colors.marker;
    ctx.shadowBlur = MARKER_GLOW_BLUR;
    ctx.beginPath();
    ctx.arc(mx, my, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = colors.marker;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(mx, my, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = colors.markerOutline;
    ctx.stroke();
  }
}
