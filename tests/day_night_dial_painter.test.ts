// @vitest-environment jsdom
//
// The minimap rim day/night dial, extracted out of the hud.ts coordinator. Driven
// through a recording 2D context (the map_window_painter.ts idiom) so the sun/moon
// branch, the token-resolved colors, the one cached getComputedStyle and the ~1Hz
// throttle are behaviour assertions rather than source-text guesses. The source pins
// cover only what a fake context cannot express: zero hex literals, and the token
// table matching the design-token sheet.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDayNightPhaseOverride } from '../src/render/day_night_clock';
import {
  DAY_NIGHT_DIAL_COLOR_TOKENS,
  DAY_NIGHT_DIAL_REDRAW_MS,
  DAY_NIGHT_DIAL_SIZE,
  DayNightDialPainter,
} from '../src/ui/day_night_dial_painter';

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, `file://${__filename}`)), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const painterSource = stripComments(repoFile('../src/ui/day_night_dial_painter.ts'));
// Comments stripped like the other source pins below: a commented-out call is not a
// call, and must not satisfy the drive assertions.
const hudSource = stripComments(repoFile('../src/ui/hud.ts'));
const tokensCss = stripComments(repoFile('../src/styles/tokens.css'));

const TOKEN_VALUES: Record<string, string> = {
  '--color-daynight-sun': 'rgb(1, 1, 1)',
  '--color-daynight-moon': 'rgb(2, 2, 2)',
  '--color-daynight-marker': 'rgb(3, 3, 3)',
  '--color-daynight-marker-outline': 'rgb(4, 4, 4)',
};

/** A 2D context that records the calls the dial makes, and nothing else. */
function recordingCtx() {
  const fills: string[] = [];
  const strokes: string[] = [];
  const arcs: Array<[number, number, number]> = [];
  const calls: string[] = [];
  const ctx = {
    lineWidth: 0,
    lineCap: '',
    shadowColor: '',
    shadowBlur: 0,
    set fillStyle(v: string) {
      this._fill = v;
    },
    get fillStyle(): string {
      return this._fill;
    },
    set strokeStyle(v: string) {
      this._stroke = v;
    },
    get strokeStyle(): string {
      return this._stroke;
    },
    _fill: '',
    _stroke: '',
    clearRect: (..._a: number[]) => {
      calls.push('clearRect');
    },
    beginPath: () => {
      calls.push('beginPath');
    },
    arc: (x: number, y: number, r: number) => {
      arcs.push([x, y, r]);
    },
    moveTo: () => {
      calls.push('moveTo');
    },
    lineTo: () => {
      calls.push('lineTo');
    },
    fill() {
      fills.push(this._fill);
    },
    stroke() {
      strokes.push(this._stroke);
    },
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
  };
  return { ctx, fills, strokes, arcs, calls };
}

/** A canvas whose getContext returns the recording context. */
function canvasFor(ctx: unknown): HTMLCanvasElement {
  return { getContext: () => ctx } as unknown as HTMLCanvasElement;
}

function stubTokens(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => TOKEN_VALUES[name] ?? '',
  } as unknown as CSSStyleDeclaration);
}

afterEach(() => {
  vi.restoreAllMocks();
  setDayNightPhaseOverride(null);
});

describe('day_night_dial_painter: no magic values', () => {
  it('carries no literal hex color in TS', () => {
    const hex = painterSource.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
  });

  it('defines every dial color token it reads in the design-token sheet', () => {
    for (const token of Object.values(DAY_NIGHT_DIAL_COLOR_TOKENS)) {
      expect(painterSource, `painter never reads ${token}`).toContain(token);
      expect(tokensCss, `tokens.css missing ${token}`).toContain(`${token}:`);
    }
    // The hand list in TOKEN_VALUES cannot see a table entry it was never told
    // about, and the resolve freezes the WHOLE set on first success, so one
    // missing token would draw default ink for the session. Pin both directions.
    expect(Object.keys(TOKEN_VALUES).sort()).toEqual(
      Object.values(DAY_NIGHT_DIAL_COLOR_TOKENS).sort(),
    );
  });

  it('names its geometry rather than sprinkling raw numbers through the draw', () => {
    for (const name of ['RING_RADIUS', 'RING_WIDTH', 'RING_SEGMENTS', 'MARKER_RADIUS']) {
      expect(painterSource).toContain(`const ${name} =`);
    }
    expect(DAY_NIGHT_DIAL_SIZE).toBe(88);
  });
});

describe('day_night_dial_painter: what it draws', () => {
  it('resolves the tokens through exactly one getComputedStyle, then caches', () => {
    const spy = stubTokens();
    const { ctx } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    painter.paint(DAY_NIGHT_DIAL_REDRAW_MS);
    painter.paint(DAY_NIGHT_DIAL_REDRAW_MS * 2);
    expect(spy).toHaveBeenCalledTimes(1);
    // One call site in the source, so the resolve can never move into the ring loop.
    expect(painterSource.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('draws the sun in the sun token by day', () => {
    stubTokens();
    setDayNightPhaseOverride(0.5); // noon sits at phase 0.5; phase 0 is midnight
    const { ctx, fills, strokes } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    expect(fills).toContain(TOKEN_VALUES['--color-daynight-sun']);
    expect(fills).not.toContain(TOKEN_VALUES['--color-daynight-moon']);
    // eight rays, each a stroke in the sun color, plus the ring's 60 sky arcs
    const rays = strokes.filter((s) => s === TOKEN_VALUES['--color-daynight-sun']);
    expect(rays).toHaveLength(8);
  });

  it('draws the crescent moon in the moon token by night', () => {
    stubTokens();
    setDayNightPhaseOverride(0); // midnight
    const { ctx, fills, strokes } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    expect(fills).toContain(TOKEN_VALUES['--color-daynight-moon']);
    expect(fills).not.toContain(TOKEN_VALUES['--color-daynight-sun']);
    expect(strokes).not.toContain(TOKEN_VALUES['--color-daynight-sun']);
  });

  it('rides the "now" pip on the ring in the marker token, outlined', () => {
    stubTokens();
    setDayNightPhaseOverride(0.25);
    const { ctx, fills, strokes, arcs } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    expect(fills).toContain(TOKEN_VALUES['--color-daynight-marker']);
    expect(strokes).toContain(TOKEN_VALUES['--color-daynight-marker-outline']);
    expect(ctx.shadowColor).toBe(TOKEN_VALUES['--color-daynight-marker']);
    // the pip sits on the ring centreline, 34 from the dial centre
    const centre = DAY_NIGHT_DIAL_SIZE / 2;
    const pip = arcs.filter(([, , r]) => r === 5.2);
    expect(pip).toHaveLength(2); // the glowing fill and its outline
    for (const [x, y] of pip) {
      expect(Math.hypot(x - centre, y - centre)).toBeCloseTo(34, 6);
    }
  });

  it('paints the sky ring in 60 segments', () => {
    stubTokens();
    const { ctx, strokes } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    // 60 ring segments, plus (by day) 8 sun rays, whose stub token value also
    // starts with 'rgb(', so those are filtered out by value.
    const ring = strokes.filter(
      (s) => s.startsWith('rgb(') && !Object.values(TOKEN_VALUES).includes(s),
    );
    expect(ring).toHaveLength(60);
  });
});

describe('day_night_dial_painter: cadence and lifecycle', () => {
  it('throttles to ~1Hz and redraws once the interval passes', () => {
    stubTokens();
    const { ctx, calls } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    const draws = () => calls.filter((c) => c === 'clearRect').length;
    painter.paint(1000);
    expect(draws()).toBe(1);
    painter.paint(1000 + DAY_NIGHT_DIAL_REDRAW_MS - 1);
    expect(draws()).toBe(1);
    painter.paint(1000 + DAY_NIGHT_DIAL_REDRAW_MS);
    expect(draws()).toBe(2);
  });

  it('draws immediately on the first paint whatever the clock reads', () => {
    // The /daynight dev command depends on this: the latch is "due" rather than
    // a zero timestamp, so a monotonic clock near zero cannot suppress a redraw.
    stubTokens();
    const { ctx, calls } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(12);
    expect(calls.filter((c) => c === 'clearRect')).toHaveLength(1);
  });

  it('redraws on the next paint after invalidate(), inside the throttle window', () => {
    stubTokens();
    const { ctx, calls } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(5000);
    painter.invalidate();
    painter.paint(5001);
    expect(calls.filter((c) => c === 'clearRect')).toHaveLength(2);
  });

  it('is inert without a canvas', () => {
    const painter = new DayNightDialPainter();
    painter.attach(null);
    expect(() => painter.paint(0)).not.toThrow();
  });

  it('does not freeze an unresolved token set (it self-heals next redraw)', () => {
    const spy = vi
      .spyOn(globalThis, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: () => '' } as unknown as CSSStyleDeclaration);
    const { ctx } = recordingCtx();
    const painter = new DayNightDialPainter();
    painter.attach(canvasFor(ctx));
    painter.paint(0);
    painter.paint(DAY_NIGHT_DIAL_REDRAW_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('day_night_dial_painter: the hud drives it and owns nothing else', () => {
  it('left no dial drawing behind in the coordinator', () => {
    expect(hudSource).not.toContain('updateDayNightDial');
    expect(hudSource).not.toContain('dayNightCtx');
    expect(hudSource).toContain('this.dayNightDial.paint(now);');
    expect(hudSource).toContain('this.dayNightDial.attach(');
  });

  it('keeps the forced redraw the /daynight dev command calls', () => {
    expect(hudSource).toContain('refreshDayNightDial(): void {');
    expect(hudSource).toContain('this.dayNightDial.invalidate();');
  });
});
