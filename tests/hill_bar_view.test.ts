// @vitest-environment happy-dom
// The King of the Hill bar (src/ui/hud/hill/): the pure view core (when the bar
// shows, the rival count, the edge distance, the contest fraction, the
// structural sig) and the thin painter (one skeleton write per sig, every
// per-second value through the elided writers, the tone classes chosen from
// the union, the mount attributes, the language switch), plus the ring's pure
// core and the sim matcher rows for the hill's lines.
import { afterEach, describe, expect, it } from 'vitest';
import {
  HILL_COLOR_OTHERS,
  HILL_COLOR_UNHELD,
  HILL_COLOR_YOURS,
  HILL_RADIAL_STEP_YARDS,
  HILL_RIM_INNER_T,
  HILL_RIM_OUTER_T,
  hillFillAlpha,
  hillPulseSpeed,
  hillRadialStops,
  hillRimAlpha,
  hillRingKey,
  hillRingPlan,
} from '../src/render/hill_ring_core';
import { HILL_CAPTURE_SECONDS } from '../src/sim/pvp';
import {
  HILL_LOST_LINE,
  HILL_TAKEN_LINE,
  hillFallenLine,
  hillRiseLine,
  hillWarningLine,
} from '../src/sim/pvp/hill';
import { buildHillBarView, HillBar, hillEdgeDistance, hillRivalCount } from '../src/ui/hud/hill';
import { setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { localizeSimText } from '../src/ui/sim_i18n';
import type { HillInfo } from '../src/world_api';

const info = (over: Partial<HillInfo> = {}): HillInfo => ({
  zoneId: 'drakelands',
  x: 360,
  z: 1540,
  radius: 50,
  phase: 'active',
  minutesLeft: 42,
  standing: 'counted',
  inZone: true,
  inside: false,
  holder: 'none',
  holderCount: 0,
  yourCount: 0,
  challenger: 'none',
  challengerCount: 0,
  contest: 0,
  ...over,
});

afterEach(() => setLanguage('en'));

describe('buildHillBarView', () => {
  it("hides without a hill or outside the hill's zone", () => {
    expect(buildHillBarView(null, { x: 0, z: 0 }).visible).toBe(false);
    expect(buildHillBarView(info({ inZone: false }), { x: 360, z: 1540 }).visible).toBe(false);
  });

  it('measures you against the holder, or the largest rival while unheld', () => {
    expect(
      hillRivalCount(
        info({ holder: 'other', holderCount: 3, challenger: 'you', challengerCount: 4 }),
      ),
    ).toBe(3);
    expect(hillRivalCount(info({ holder: 'none', challenger: 'other', challengerCount: 2 }))).toBe(
      2,
    );
    expect(
      hillRivalCount(
        info({ holder: 'you', holderCount: 2, challenger: 'other', challengerCount: 3 }),
      ),
    ).toBe(3);
    expect(hillRivalCount(info({ holder: 'you', holderCount: 2 }))).toBe(0);
    expect(hillRivalCount(info({ holder: 'none', challenger: 'you', challengerCount: 2 }))).toBe(0);
  });

  it('reports the whole-yard distance to the edge, zero inside', () => {
    expect(hillEdgeDistance(info(), 360, 1540)).toBe(0);
    expect(hillEdgeDistance(info(), 360 + 49, 1540)).toBe(0);
    expect(hillEdgeDistance(info(), 360 + 80, 1540)).toBe(30);
    expect(hillEdgeDistance(info(), 360, 1540 - 100.4)).toBe(50);
  });

  it('carries the contest against the capture length and a structural sig', () => {
    const view = buildHillBarView(
      info({
        holder: 'other',
        holderCount: 2,
        yourCount: 3,
        challenger: 'you',
        challengerCount: 3,
        contest: 15,
      }),
      { x: 400, z: 1540 },
    );
    expect(view.visible).toBe(true);
    if (!view.visible) return;
    expect(view).toMatchObject({
      yours: 3,
      theirs: 2,
      contest: 15,
      capture: HILL_CAPTURE_SECONDS,
      contestFraction: 0.25,
      distanceYards: 0,
      minutesLeft: 42,
      phase: 'active',
      standing: 'counted',
    });
    // The sig moves on the structural fields and stays put on the live ones.
    const a = buildHillBarView(info({ contest: 3 }), null).sig;
    const b = buildHillBarView(info({ contest: 9, yourCount: 4, minutesLeft: 1 }), null).sig;
    expect(b).toBe(a);
    expect(buildHillBarView(info({ holder: 'you' }), null).sig).not.toBe(a);
    expect(buildHillBarView(info({ challenger: 'other' }), null).sig).not.toBe(a);
    expect(buildHillBarView(info({ inside: true }), null).sig).not.toBe(a);
    expect(buildHillBarView(info({ x: 361 }), null).sig).not.toBe(a);
    expect(buildHillBarView(info({ phase: 'warning' }), null).sig).not.toBe(a);
    expect(buildHillBarView(info({ standing: 'raid' }), null).sig).not.toBe(a);
    // A contest past the capture length (a stale readout) clamps.
    const over = buildHillBarView(info({ contest: 999 }), null);
    expect(over.visible && over.contestFraction).toBe(1);
  });
});

describe('HillBar (the painter)', () => {
  function harness() {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const calls: string[] = [];
    const writers: PainterHostWriters = {
      setText: (el, text) => {
        if (el.textContent !== text) {
          el.textContent = text;
          calls.push(`text:${text}`);
        }
      },
      setDisplay: (el, display) => {
        if (el.style.display !== display) {
          el.style.display = display;
          calls.push(`display:${display}`);
        }
      },
      setTransform: (el, transform) => {
        el.style.transform = transform;
      },
      setWidth: (el, width) => {
        if (el.style.width !== width) {
          el.style.width = width;
          calls.push(`width:${width}`);
        }
      },
      setStyleProp: (el, prop, value) => {
        el.style.setProperty(prop, value);
      },
      toggleClass: (el, cls, on) => {
        if (el.classList.contains(cls) !== on) {
          el.classList.toggle(cls, on);
          calls.push(`class:${cls}:${on}`);
        }
      },
      setAttr: (el, name, value) => {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      },
    };
    const bar = new HillBar({ layer: () => layer, writers });
    return { layer, bar, calls };
  }

  it('mounts once with the status attributes and paints the unheld state', () => {
    const { layer, bar, calls } = harness();
    bar.update(
      buildHillBarView(info({ challenger: 'other', challengerCount: 2, contest: 12 }), {
        x: 460,
        z: 1540,
      }),
    );
    const root = layer.querySelector('#hill-bar') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.style.display).toBe('block');
    expect(root.textContent).toContain('King of the Hill');
    expect(root.textContent).toContain('The Drakelands');
    expect(root.textContent).toContain('Nobody holds the hill');
    expect(root.textContent).toContain('Inside: you 0, largest rival 2');
    expect(root.textContent).toContain('Losing the hill: 12 seconds of 1 minute');
    expect(root.textContent).toContain('50 yd to the circle');
    expect(root.textContent).toContain('Falls in 42 minutes');
    expect(root.querySelector('.hill-note')).toBeNull();
    expect((root.querySelector('.hill-fill') as HTMLElement).style.width).toBe('20%');
    expect(root.classList.contains('is-contested')).toBe(true);
    expect(root.classList.contains('is-you-contesting')).toBe(false);
    bar.update(
      buildHillBarView(info({ challenger: 'you', challengerCount: 1, yourCount: 1, contest: 5 }), {
        x: 360,
        z: 1540,
      }),
    );
    expect(root.classList.contains('is-you-contesting')).toBe(true);
    expect(root.classList.contains('is-you')).toBe(false);
    expect(root.classList.contains('is-other')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('a repeated frame writes nothing; a live change writes only its slot', () => {
    const { bar, calls } = harness();
    const view = buildHillBarView(
      info({ holder: 'you', holderCount: 2, yourCount: 2, inside: true }),
      { x: 360, z: 1540 },
    );
    bar.update(view);
    calls.length = 0;
    bar.update(view);
    expect(calls).toEqual([]);
    bar.update(
      buildHillBarView(info({ holder: 'you', holderCount: 3, yourCount: 3, inside: true }), {
        x: 360,
        z: 1540,
      }),
    );
    expect(calls).toEqual(['text:Inside: you 3, rival 0']);
  });

  it('the tone follows the holder and the sig rebuilds the skeleton on a holder change', () => {
    const { layer, bar } = harness();
    bar.update(
      buildHillBarView(info({ holder: 'you', holderCount: 1, yourCount: 1, inside: true }), {
        x: 360,
        z: 1540,
      }),
    );
    const root = layer.querySelector('#hill-bar') as HTMLElement;
    expect(root.classList.contains('is-you')).toBe(true);
    expect(root.textContent).toContain('Your group holds the hill');
    expect(root.textContent).toContain('You are inside the circle');
    expect(root.textContent).toContain('Hold a majority inside for 1 minute to take it');
    bar.update(
      buildHillBarView(
        info({ holder: 'other', holderCount: 2, yourCount: 1, challenger: 'none' }),
        { x: 360, z: 1540 },
      ),
    );
    expect(root.classList.contains('is-you')).toBe(false);
    expect(root.classList.contains('is-other')).toBe(true);
    expect(root.textContent).toContain('Another group holds the hill');
    expect(root.textContent).not.toContain('Your group holds the hill');
  });

  it('while announced: no contest rows, the rise countdown, and still the distance', () => {
    const { layer, bar } = harness();
    bar.update(buildHillBarView(info({ phase: 'warning', minutesLeft: 15 }), { x: 460, z: 1540 }));
    const root = layer.querySelector('#hill-bar') as HTMLElement;
    expect(root.textContent).toContain('The hill has not risen yet');
    expect(root.textContent).toContain('Rises in 15 minutes');
    expect(root.textContent).toContain('50 yd to the circle');
    expect(root.querySelector('.hill-counts')).toBeNull();
    expect(root.querySelector('.hill-track')).toBeNull();
    // The rise rebuilds the skeleton with the contest rows.
    bar.update(buildHillBarView(info({ minutesLeft: 45 }), { x: 460, z: 1540 }));
    expect(root.querySelector('.hill-counts')).not.toBeNull();
    expect(root.textContent).toContain('Falls in 45 minutes');
  });

  it('tells a raid member they do not count', () => {
    const { layer, bar } = harness();
    bar.update(buildHillBarView(info({ standing: 'raid' }), { x: 360, z: 1540 }));
    const root = layer.querySelector('#hill-bar') as HTMLElement;
    expect(root.querySelector('.hill-note')?.textContent).toBe(
      'Raid members do not count: only parties can hold the hill',
    );
    bar.update(buildHillBarView(info(), { x: 360, z: 1540 }));
    expect(root.querySelector('.hill-note')).toBeNull();
  });

  it('hides when the hill closes or the player leaves the zone, and relocalizes in place', () => {
    const { layer, bar } = harness();
    bar.update(buildHillBarView(info(), { x: 360, z: 1540 }));
    const root = layer.querySelector('#hill-bar') as HTMLElement;
    bar.update(buildHillBarView(null, null));
    expect(root.style.display).toBe('none');
    bar.update(buildHillBarView(info({ inZone: false }), null));
    expect(root.style.display).toBe('none');
    bar.update(buildHillBarView(info(), { x: 360, z: 1540 }));
    expect(root.style.display).toBe('block');
    // A language switch rebuilds the skeleton (fresh nodes) with the same facts.
    const heldBefore = root.querySelector('.hill-held');
    bar.relocalize();
    const heldAfter = root.querySelector('.hill-held');
    expect(heldAfter).not.toBe(heldBefore);
    expect(root.textContent).toContain('Nobody holds the hill');
    expect(root.style.display).toBe('block');
    bar.dispose();
    expect(layer.querySelector('#hill-bar')).toBeNull();
  });
});

describe('the ring core', () => {
  it('colours by holder, pulses only while contested, and keys by geometry', () => {
    const risen = { phase: 'active' } as const;
    expect(hillRingPlan(0, { ...risen, holder: 'none', challenger: 'none' }).color).toBe(
      HILL_COLOR_UNHELD,
    );
    expect(hillRingPlan(0, { ...risen, holder: 'you', challenger: 'none' }).color).toBe(
      HILL_COLOR_YOURS,
    );
    expect(hillRingPlan(0, { ...risen, holder: 'other', challenger: 'you' }).color).toBe(
      HILL_COLOR_OTHERS,
    );
    const calm = hillRingPlan(Math.PI * 1.5, { ...risen, holder: 'none', challenger: 'none' });
    const contested = hillRingPlan(Math.PI * 1.5, {
      ...risen,
      holder: 'none',
      challenger: 'other',
    });
    expect(calm.ringOpacity).toBeGreaterThan(contested.ringOpacity);
    // Announced: still and fainter than any risen frame.
    const warn = hillRingPlan(0, { phase: 'warning', holder: 'none', challenger: 'none' });
    expect(warn.color).toBe(HILL_COLOR_UNHELD);
    expect(warn.ringOpacity).toBeLessThan(contested.ringOpacity);
    expect(hillRingPlan(2, { phase: 'warning', holder: 'none', challenger: 'none' })).toEqual(warn);
    expect(hillPulseSpeed(true)).toBeGreaterThan(hillPulseSpeed(false));
    expect(hillRingKey(info())).toBe('360,1540,50');
    expect(hillRingKey(info({ x: 361 }))).not.toBe(hillRingKey(info()));
  });
});

describe('the sim lines the client matcher re-localizes', () => {
  it('matches the warning, rise and fall lines, the capture notices and the /hill readouts', () => {
    setLanguage('en');
    expect(localizeSimText(hillWarningLine('The Drakelands', 15))).toBe(
      'A hill will rise in The Drakelands in 15 minutes.',
    );
    // The countdown re-renders through the locale's plural rules: one minute, not "1 minutes".
    expect(localizeSimText(hillWarningLine('The Drakelands', 1))).toBe(
      'A hill will rise in The Drakelands in 1 minute.',
    );
    expect(localizeSimText(hillRiseLine('The Drakelands'))).toBe(
      'A hill has risen in The Drakelands: hold it to earn Honor.',
    );
    expect(localizeSimText(hillFallenLine('The Nightbloom'))).toBe(
      'The hill in The Nightbloom has fallen.',
    );
    expect(localizeSimText(HILL_TAKEN_LINE)).toBe(HILL_TAKEN_LINE);
    expect(localizeSimText(HILL_LOST_LINE)).toBe(HILL_LOST_LINE);
    expect(
      localizeSimText('The hill stands in The Evergarden: nobody holds it. It falls in 7 minutes.'),
    ).toBe('The hill stands in The Evergarden: nobody holds it. It falls in 7 minutes.');
    expect(
      localizeSimText(
        'The hill stands in The Evergarden: your group holds it. It falls in 1 minute.',
      ),
    ).toBe('The hill stands in The Evergarden: your group holds it. It falls in 1 minute.');
    // Under another language the rule still matches (the zone name resolves through
    // the entity table, whose locale chunks a unit test does not load, so only the
    // match is asserted here).
    setLanguage('zh_CN');
    expect(localizeSimText(hillRiseLine('The Drakelands'))).not.toBeNull();
    expect(localizeSimText(hillWarningLine('The Drakelands', 15))).not.toBeNull();
    expect(localizeSimText(hillFallenLine('The Drakelands'))).not.toBeNull();
  });
});

describe('the hill circle radial profile (hill_ring_core)', () => {
  it('keeps the wash clear at the centre and strongest toward the edge, nothing outside', () => {
    expect(hillFillAlpha(0)).toBe(0);
    expect(hillFillAlpha(0.25)).toBeLessThan(hillFillAlpha(0.5));
    expect(hillFillAlpha(0.5)).toBeLessThan(hillFillAlpha(0.95));
    expect(hillFillAlpha(1)).toBe(0);
    expect(hillFillAlpha(1.2)).toBe(0);
  });

  it('peaks the rim glow on the true radius and feathers it to nothing both ways', () => {
    expect(hillRimAlpha(1)).toBeCloseTo(1, 10);
    expect(hillRimAlpha(HILL_RIM_INNER_T)).toBe(0);
    expect(hillRimAlpha(HILL_RIM_OUTER_T)).toBe(0);
    expect(hillRimAlpha(0.5)).toBe(0);
    const inside = hillRimAlpha((HILL_RIM_INNER_T + 1) / 2);
    const outside = hillRimAlpha((1 + HILL_RIM_OUTER_T) / 2);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(1);
    expect(outside).toBeGreaterThan(0);
    expect(outside).toBeLessThan(1);
  });

  it('spaces the draped rings no further apart than the step, ends included', () => {
    // The flat centre-to-rim fan cut through slopes; a stop every couple of
    // yards drapes the circle on the ground.
    const stops = hillRadialStops(50, 0, 1, HILL_RADIAL_STEP_YARDS);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect((stops[i] - stops[i - 1]) * 50).toBeLessThanOrEqual(HILL_RADIAL_STEP_YARDS + 1e-9);
    }
    expect(hillRadialStops(50, 0.9, 0.9, 1)).toEqual([0.9, 0.9]);
  });
});
