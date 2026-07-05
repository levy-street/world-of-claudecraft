// Routing + no-magic-values guard for the XP-bar painter (decisions 5a / 12). A
// recording facet captures every writer call so we can assert the painter drives
// the SIX elided writers with byte-identical values (the Top-risk-1 guard against a
// non-byte-identical cache key: the --xp-fill .toFixed(4) and the .toFixed(1)
// percent widths must match the former inline block exactly), and a source scan
// proves it makes NO raw DOM write. The label is already localized by xpBarView, so
// the painter passes it straight through (no t() here).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { XpBarView } from '../src/ui/xp_bar';
import { XpBarPainter } from '../src/ui/xp_bar_painter';

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

const BAR = { tag: 'xpbar' } as unknown as HTMLElement;
const FILL = { tag: 'fill' } as unknown as HTMLElement;
const RESTED = { tag: 'rested' } as unknown as HTMLElement;
const LABEL = { tag: 'label' } as unknown as HTMLElement;
const PF = { tag: 'player-frame' } as unknown as HTMLElement;

function paint(view: XpBarView): Call[] {
  const { calls, writers } = recordingFacet();
  new XpBarPainter(writers, BAR, FILL, RESTED, LABEL, PF).paint(view);
  return calls;
}

describe('XpBarPainter: routes every write through the elided writers', () => {
  it('drives fill width, --xp-fill on BOTH bar and player frame, rested geometry, label, classes', () => {
    const calls = paint({ fillFrac: 0.5, restedFrac: 0.1, label: 'XP 1 / 2', postCap: false });
    expect(calls).toEqual([
      { m: 'setWidth', args: [FILL, '50.0%'] },
      { m: 'setStyleProp', args: [BAR, '--xp-fill', '0.5000'] },
      { m: 'setStyleProp', args: [PF, '--xp-fill', '0.5000'] },
      { m: 'setStyleProp', args: [RESTED, 'left', '50.0%'] },
      { m: 'setStyleProp', args: [RESTED, 'width', '10.0%'] },
      { m: 'setText', args: [LABEL, 'XP 1 / 2'] },
      { m: 'toggleClass', args: [BAR, 'overflow', false] },
      { m: 'toggleClass', args: [BAR, 'rested', true] },
    ]);
  });

  it('post-cap overflow with no rested: overflow class on, rested class off, width 0.0%', () => {
    const calls = paint({ fillFrac: 1, restedFrac: 0, label: 'Lv 20 (+7)', postCap: true });
    expect(calls).toEqual([
      { m: 'setWidth', args: [FILL, '100.0%'] },
      { m: 'setStyleProp', args: [BAR, '--xp-fill', '1.0000'] },
      { m: 'setStyleProp', args: [PF, '--xp-fill', '1.0000'] },
      { m: 'setStyleProp', args: [RESTED, 'left', '100.0%'] },
      { m: 'setStyleProp', args: [RESTED, 'width', '0.0%'] },
      { m: 'setText', args: [LABEL, 'Lv 20 (+7)'] },
      { m: 'toggleClass', args: [BAR, 'overflow', true] },
      { m: 'toggleClass', args: [BAR, 'rested', false] },
    ]);
  });
});

describe('XpBarPainter: no raw DOM writes, no magic values (decisions 5a / 12)', () => {
  const src = readFileSync(new URL('../src/ui/xp_bar_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex or rgb color (percent VALUE strings + --xp-fill excepted)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
  });
});
