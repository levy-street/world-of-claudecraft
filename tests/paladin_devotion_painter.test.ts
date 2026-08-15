import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { PaladinDevotionPainter } from '../src/ui/paladin_devotion_painter';
import type { PaladinDevotionState } from '../src/ui/paladin_devotion_view';

type Call = { method: keyof PainterHostWriters; args: unknown[] };

function recordingWriters(): { calls: Call[]; writers: PainterHostWriters } {
  const calls: Call[] = [];
  const record =
    (method: keyof PainterHostWriters) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  return {
    calls,
    writers: {
      setText: record('setText') as PainterHostWriters['setText'],
      setDisplay: record('setDisplay') as PainterHostWriters['setDisplay'],
      setTransform: record('setTransform') as PainterHostWriters['setTransform'],
      setWidth: record('setWidth') as PainterHostWriters['setWidth'],
      setStyleProp: record('setStyleProp') as PainterHostWriters['setStyleProp'],
      toggleClass: record('toggleClass') as PainterHostWriters['toggleClass'],
      setAttr: record('setAttr') as PainterHostWriters['setAttr'],
    },
  };
}

const ROOT = { id: 'root' } as unknown as HTMLElement;
const FRAME = { id: 'frame' } as unknown as HTMLElement;
const FILL = { id: 'fill' } as unknown as HTMLElement;
const LABEL = { id: 'label' } as unknown as HTMLElement;
const STATUS = { id: 'status' } as unknown as HTMLElement;
const CHARGES = Array.from(
  { length: 5 },
  (_, index) => ({ id: `charge-${index}` }) as unknown as HTMLElement,
) as unknown as HTMLCollection;

function paint(state: PaladinDevotionState): Call[] {
  const { calls, writers } = recordingWriters();
  new PaladinDevotionPainter(writers, FRAME, ROOT, FILL, LABEL, CHARGES, STATUS).paint(state);
  return calls;
}

describe('PaladinDevotionPainter', () => {
  it('paints a ready Devotion bar without active Ascension charges', () => {
    const calls = paint({
      visible: true,
      value: 20,
      fillFrac: 1,
      ready: true,
      ascended: false,
      charges: 0,
      lastCharge: false,
      label: '20 / 20',
      ariaValueText: 'Devotion 20 of 20',
      announcement: '',
    });

    expect(calls.slice(0, 9)).toEqual([
      { method: 'setDisplay', args: [FRAME, 'flex'] },
      { method: 'setStyleProp', args: [FILL, '--devotion-scale', '1.000'] },
      { method: 'setText', args: [LABEL, '20 / 20'] },
      { method: 'setAttr', args: [ROOT, 'aria-valuenow', '20'] },
      { method: 'setAttr', args: [ROOT, 'aria-valuetext', 'Devotion 20 of 20'] },
      { method: 'setText', args: [STATUS, ''] },
      { method: 'toggleClass', args: [ROOT, 'ready', true] },
      { method: 'toggleClass', args: [ROOT, 'ascended', false] },
      { method: 'toggleClass', args: [ROOT, 'last-charge', false] },
    ]);
    expect(calls.slice(9)).toEqual(
      CHARGES_ARRAY.map((charge) => ({
        method: 'toggleClass',
        args: [charge, 'on', false],
      })),
    );
  });

  it('lights exactly the remaining Ascension charges', () => {
    const calls = paint({
      visible: true,
      value: 6,
      fillFrac: 0.3,
      ready: false,
      ascended: true,
      charges: 3,
      lastCharge: false,
      label: '6 / 20',
      ariaValueText: 'Devotion 6 of 20. Ascension 3 charges.',
      announcement: '',
    });

    expect(calls).toContainEqual({
      method: 'setStyleProp',
      args: [FILL, '--devotion-scale', '0.300'],
    });
    expect(calls).toContainEqual({ method: 'toggleClass', args: [ROOT, 'ascended', true] });
    expect(calls.slice(9).map((call) => call.args[2])).toEqual([true, true, true, false, false]);
  });

  it('marks the final Ascension charge as a visual warning', () => {
    const calls = paint({
      visible: true,
      value: 2,
      fillFrac: 0.1,
      ready: false,
      ascended: true,
      charges: 1,
      lastCharge: true,
      label: '2 / 20',
      ariaValueText: 'Devotion 2 of 20. Ascension final charge.',
      announcement: 'Ascension final charge',
    });

    expect(calls).toContainEqual({
      method: 'toggleClass',
      args: [ROOT, 'last-charge', true],
    });
  });

  it('routes all DOM changes through PainterHost writers', () => {
    const source = readFileSync(
      new URL('../src/ui/paladin_devotion_painter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/\.style\b|\.textContent\b|\.classList\b|\.setAttribute\b/);
  });

  it('styles Devotion as a bottom-up liquid medallion with a distinct full state', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const mobileCss = readFileSync(
      new URL('../src/styles/hud.mobile.css', import.meta.url),
      'utf8',
    );
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

    expect(css).toMatch(/\.paladin-devotion::before[\s\S]*clip-path:\s*polygon\(/);
    expect(css).toMatch(
      /\.paladin-devotion-fill::before[\s\S]*transform:\s*scaleY\(var\(--devotion-scale\)\)/,
    );
    expect(css).toMatch(/\.paladin-devotion\.ready \.paladin-devotion-fill::after/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.paladin-devotion-fill::before/,
    );
    expect(css).toMatch(
      /\.paladin-devotion-frame\s*\{[\s\S]*position:\s*fixed;[\s\S]*width:\s*96px/,
    );
    expect(mobileCss).toMatch(/body\.mobile-touch \.paladin-devotion-frame[\s\S]*width:\s*72px/);

    const devotionAt = html.indexOf('id="paladin-devotion"');
    const playerFrameAt = html.indexOf('id="player-frame"');
    const bottomBarAt = html.indexOf('id="bottom-bar"');
    expect(devotionAt).toBeGreaterThan(-1);
    expect(devotionAt).toBeLessThan(bottomBarAt);
    expect(playerFrameAt).toBeGreaterThan(bottomBarAt);
    for (const entry of [html, playHtml]) {
      expect(entry.match(/id="paladin-devotion-frame"/g)).toHaveLength(1);
      expect(entry.match(/id="paladin-devotion"/g)).toHaveLength(1);
      expect(entry).toMatch(/id="paladin-devotion-frame"[^>]*tabindex="0"/);
    }
    expect(hud).toContain("attachOverlayDrag(this.paladinDevotionFrameEl, 'paladinDevotionAnchor'");
    expect(hud).not.toContain('devotionFrameMover');
    expect(css).toMatch(/\.paladin-devotion-frame\s*\{[\s\S]*cursor:\s*grab/);
    expect(css).toMatch(/\.paladin-devotion-frame\.dragging\s*\{[\s\S]*cursor:\s*grabbing/);
  });
});

const CHARGES_ARRAY = Array.from(CHARGES) as HTMLElement[];
