import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DoomMeterPainter } from '../src/ui/hud/warlock/doom_meter_painter';
import type { DoomMeterState } from '../src/ui/hud/warlock/doom_meter_view';
import type { PainterHostWriters } from '../src/ui/painter_host';

type Call = { method: keyof PainterHostWriters; element: HTMLElement; value: unknown };

function recordingWriters(): { calls: Call[]; writers: PainterHostWriters } {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (element, value) => calls.push({ method: 'setText', element, value }),
    setDisplay: (element, value) => calls.push({ method: 'setDisplay', element, value }),
    setTransform: (element, value) => calls.push({ method: 'setTransform', element, value }),
    setWidth: (element, value) => calls.push({ method: 'setWidth', element, value }),
    setStyleProp: (element, property, value) =>
      calls.push({ method: 'setStyleProp', element, value: [property, value] }),
    toggleClass: (element, className, enabled) =>
      calls.push({ method: 'toggleClass', element, value: [className, enabled] }),
    setAttr: (element, attribute, value) =>
      calls.push({ method: 'setAttr', element, value: [attribute, value] }),
  };
  return { calls, writers };
}

function element(name: string): HTMLElement {
  return { name } as unknown as HTMLElement;
}

function state(fateThreads: number): DoomMeterState {
  return {
    visible: true,
    value: 60,
    fillFrac: 0.6,
    warning: false,
    ready: false,
    fateThreads,
    fateThreadsReady: fateThreads === 3,
    label: '60 / 100',
    ariaValueText: '60 of 100',
    fateThreadsAriaValueText: `${fateThreads} of 3`,
  };
}

describe('Affliction Condemnation meter painter', () => {
  it('lights exactly the held Fate Threads and marks the bank ready only at three', () => {
    const { calls, writers } = recordingWriters();
    const frame = element('frame');
    const root = element('root');
    const fill = element('fill');
    const label = element('label');
    const fateRoot = element('fate-root');
    const pips = [element('fate-1'), element('fate-2'), element('fate-3')];
    const painter = new DoomMeterPainter(writers, frame, root, fill, label, fateRoot, pips);

    painter.paint(state(2));
    expect(calls).toContainEqual({
      method: 'toggleClass',
      element: fateRoot,
      value: ['ready', false],
    });
    expect(
      calls
        .filter((call) => call.method === 'toggleClass' && pips.includes(call.element))
        .map((call) => call.value),
    ).toEqual([
      ['on', true],
      ['on', true],
      ['on', false],
    ]);

    calls.length = 0;
    painter.paint(state(3));
    expect(calls).toContainEqual({
      method: 'toggleClass',
      element: fateRoot,
      value: ['ready', true],
    });
    expect(calls).toContainEqual({
      method: 'setAttr',
      element: fateRoot,
      value: ['aria-valuetext', '3 of 3'],
    });
  });

  it('routes every DOM mutation through the painter writer seam', () => {
    const source = readFileSync(
      new URL('../src/ui/hud/warlock/doom_meter_painter.ts', import.meta.url),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
  });
});
