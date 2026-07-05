// Routing + no-magic-values guard for the swing-timer painter (decisions 5a / 12).
// A recording facet captures every writer call so we can assert the painter drives
// the SIX elided writers with byte-identical values (the Top-risk-1 guard against a
// non-byte-identical cache key) and a source scan proves it makes NO raw DOM write.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatNumber, t } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { SwingTimerState } from '../src/ui/swing_timer';
import { SwingTimerPainter } from '../src/ui/swing_timer_painter';

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      calls.push({ m: 'setText', args: [el, text] });
    },
    setDisplay: (el, display) => {
      calls.push({ m: 'setDisplay', args: [el, display] });
    },
    setTransform: (el, transform) => {
      calls.push({ m: 'setTransform', args: [el, transform] });
    },
    setWidth: (el, width) => {
      calls.push({ m: 'setWidth', args: [el, width] });
    },
    setStyleProp: (el, prop, value) => {
      calls.push({ m: 'setStyleProp', args: [el, prop, value] });
    },
    toggleClass: (el, cls, on) => {
      calls.push({ m: 'toggleClass', args: [el, cls, on] });
    },
    setAttr: (el, name, value) => {
      calls.push({ m: 'setAttr', args: [el, name, value] });
    },
  };
  return { calls, writers };
}

const BAR = { tag: 'swingbar' } as unknown as HTMLElement;
const FILL = { tag: 'fill' } as unknown as HTMLElement;
const LABEL = { tag: 'label' } as unknown as HTMLElement;

function paint(state: SwingTimerState): Call[] {
  const { calls, writers } = recordingFacet();
  new SwingTimerPainter(writers, BAR, FILL, LABEL).paint(state);
  return calls;
}

describe('SwingTimerPainter: routes every write through the elided writers', () => {
  it('hidden state writes only setDisplay(none) on the bar (no fill/label churn)', () => {
    const calls = paint({
      visible: false,
      frac: 0,
      ready: false,
      labelKind: 'seconds',
      seconds: 0,
      nextPeriod: 0,
      nextTimer: 0,
    });
    expect(calls).toEqual([{ m: 'setDisplay', args: [BAR, 'none'] }]);
  });

  it('visible + counting down: display block, fill width, ready off, the seconds label', () => {
    const calls = paint({
      visible: true,
      frac: 0.5,
      ready: false,
      labelKind: 'seconds',
      seconds: 1.4,
      nextPeriod: 2,
      nextTimer: 1,
    });
    const expectedLabel = t('hudChrome.swing.seconds', {
      seconds: formatNumber(1.4, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    });
    expect(calls).toEqual([
      { m: 'setDisplay', args: [BAR, 'block'] },
      { m: 'setWidth', args: [FILL, '50.0%'] },
      { m: 'toggleClass', args: [BAR, 'ready', false] },
      { m: 'setText', args: [LABEL, expectedLabel] },
    ]);
  });

  it('visible + ready: ready class on, full fill, the localized ready label', () => {
    const calls = paint({
      visible: true,
      frac: 1,
      ready: true,
      labelKind: 'ready',
      seconds: 0,
      nextPeriod: 2,
      nextTimer: 0,
    });
    expect(calls).toEqual([
      { m: 'setDisplay', args: [BAR, 'block'] },
      { m: 'setWidth', args: [FILL, '100.0%'] },
      { m: 'toggleClass', args: [BAR, 'ready', true] },
      { m: 'setText', args: [LABEL, t('hudChrome.swing.ready')] },
    ]);
  });
});

describe('SwingTimerPainter: no raw DOM writes, no magic values (decisions 5a / 12)', () => {
  const src = readFileSync(new URL('../src/ui/swing_timer_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex or rgb color (percent VALUE strings excepted)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
  });
});
