// @vitest-environment happy-dom
// The Target dots painter's DOM contract, driven through a recording writers
// stub so every assertion is about a WRITE the painter made, not about what a
// browser would render.
//
// The load-bearing case is the row-key recycle. The painter pools a fixed set of
// row nodes and resolves the icon background only when the icon key changes, so
// a node that changes which ROW it carries has to drop that cache first. Pooling
// by slot index instead of by row key is what let a recycled node keep the
// previous occupant's artwork, and nothing pinned it: the nameplate twin had a
// test for the same trap, this one did not.

import { beforeEach, describe, expect, it } from 'vitest';
import type { TargetDotRow, TargetDotsState } from '../src/ui/hud/target_dots';
import { TargetDotsPainter } from '../src/ui/hud/target_dots';
import type { PainterHostWriters } from '../src/ui/painter_host';

/** A writers facet that records every call and elides nothing, so a test sees
 *  exactly the writes the painter asked for. */
function recordingWriters() {
  const calls: Array<{ kind: string; el: HTMLElement; a: string; b?: string | null }> = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => calls.push({ kind: 'text', el, a: text }),
    setDisplay: (el, display) => calls.push({ kind: 'display', el, a: display }),
    setTransform: (el, t) => calls.push({ kind: 'transform', el, a: t }),
    setWidth: (el, w) => calls.push({ kind: 'width', el, a: w }),
    setStyleProp: (el, prop, value) => calls.push({ kind: 'style', el, a: prop, b: value }),
    toggleClass: (el, cls, on) => calls.push({ kind: 'class', el, a: cls, b: String(on) }),
    setAttr: (el, name, value) => calls.push({ kind: 'attr', el, a: name, b: value }),
  };
  return { writers, calls };
}

function makeRow(over: Partial<TargetDotRow> & { key: string }): TargetDotRow {
  return {
    entityId: 1,
    targetName: 'Dummy',
    auraName: 'Blackrot',
    iconKey: 'corruption',
    school: 'shadow',
    remaining: 12,
    fraction: 0.6,
    decimals: 0,
    stacks: 0,
    onCurrentTarget: false,
    expiring: false,
    ...over,
  };
}

function stateOf(rows: TargetDotRow[], overflow = 0): TargetDotsState {
  return { rows, count: rows.length, overflow };
}

describe('TargetDotsPainter', () => {
  let root: HTMLElement;
  let rec: ReturnType<typeof recordingWriters>;
  let painter: TargetDotsPainter;
  let backgroundsResolved: string[];

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    rec = recordingWriters();
    backgroundsResolved = [];
    painter = new TargetDotsPainter({
      root: () => root,
      writers: rec.writers,
      iconBackground: (key) => {
        backgroundsResolved.push(key);
        return `url(${key})`;
      },
      rowLabel: (aura, target) => `${aura} on ${target}`,
      frameLabel: () => 'Target Dots',
      overflowLabel: (n) => `${n} more not shown`,
      secondsSuffix: () => 's',
    });
    backgroundsResolved.length = 0;
    rec.calls.length = 0;
  });

  it('resolves a row background once and not again while the row stays put', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    expect(backgroundsResolved).toEqual(['corruption']);
    backgroundsResolved.length = 0;
    // Same row, later tick, different remaining time.
    painter.update(stateOf([makeRow({ key: '1:corruption', remaining: 9 })]));
    expect(backgroundsResolved).toEqual([]);
  });

  it('re-resolves when a DIFFERENT row takes the same slot', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    backgroundsResolved.length = 0;
    // Slot 0 now carries a different (enemy, aura) pair.
    painter.update(
      stateOf([makeRow({ key: '2:agony', iconKey: 'curse_of_agony', auraName: 'Hex of Anguish' })]),
    );
    expect(backgroundsResolved).toEqual(['curse_of_agony']);
  });

  it('re-resolves when a row leaves its slot and later comes back to it', () => {
    // The exact index-pooling trap: corruption owns slot 0, is replaced, and
    // returns. A slot-keyed cache would still be holding its icon key and skip
    // the resolve, leaving whatever the middle row painted.
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    painter.update(stateOf([makeRow({ key: '2:agony', iconKey: 'curse_of_agony' })]));
    backgroundsResolved.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    expect(backgroundsResolved).toEqual(['corruption']);
  });

  it('re-resolves a slot that was parked empty before being reused', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    painter.update(stateOf([]));
    backgroundsResolved.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    expect(backgroundsResolved).toEqual(['corruption']);
  });

  it('hides the whole frame when nothing is out, and shows it when something is', () => {
    painter.update(stateOf([]));
    expect(rec.calls.find((c) => c.el === root && c.kind === 'display')?.a).toBe('none');
    rec.calls.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    expect(rec.calls.find((c) => c.el === root && c.kind === 'display')?.a).toBe('flex');
  });

  it('writes the fill width from the fraction and tints it by school', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption', fraction: 0.25, school: 'fire' })]));
    expect(rec.calls.some((c) => c.kind === 'width' && c.a === '25%')).toBe(true);
    expect(
      rec.calls.some((c) => c.kind === 'attr' && c.a === 'data-school' && c.b === 'fire'),
    ).toBe(true);
  });

  it('clears the school attribute rather than writing an empty one', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption', school: '' })]));
    expect(rec.calls.some((c) => c.kind === 'attr' && c.a === 'data-school' && c.b === null)).toBe(
      true,
    );
  });

  it('prints the countdown at the precision the row asked for', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption', remaining: 4.25, decimals: 1 })]));
    expect(rec.calls.some((c) => c.kind === 'text' && c.a === '4.3s')).toBe(true);
    rec.calls.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption', remaining: 12.4, decimals: 0 })]));
    expect(rec.calls.some((c) => c.kind === 'text' && c.a === '12s')).toBe(true);
  });

  it('marks the current target and the expiring row with their classes', () => {
    painter.update(
      stateOf([makeRow({ key: '1:corruption', onCurrentTarget: true, expiring: true })]),
    );
    expect(
      rec.calls.some((c) => c.kind === 'class' && c.a === 'td-on-target' && c.b === 'true'),
    ).toBe(true);
    expect(
      rec.calls.some((c) => c.kind === 'class' && c.a === 'td-expiring' && c.b === 'true'),
    ).toBe(true);
  });

  it('shows the stack badge only above one stack', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption', stacks: 3 })]));
    const stacksEl = root.querySelector('.td-stacks') as HTMLElement;
    expect(rec.calls.some((c) => c.el === stacksEl && c.kind === 'display' && c.a === '')).toBe(
      true,
    );
    expect(rec.calls.some((c) => c.el === stacksEl && c.kind === 'text' && c.a === '3')).toBe(true);
    rec.calls.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption', stacks: 0 })]));
    expect(rec.calls.some((c) => c.el === stacksEl && c.kind === 'display' && c.a === 'none')).toBe(
      true,
    );
  });

  it('reveals the overflow line only when the cap dropped rows', () => {
    const overflowEl = root.querySelector('.td-overflow') as HTMLElement;
    painter.update(stateOf([makeRow({ key: '1:corruption' })], 0));
    expect(
      rec.calls.some((c) => c.el === overflowEl && c.kind === 'display' && c.a === 'none'),
    ).toBe(true);
    rec.calls.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption' })], 6));
    expect(
      rec.calls.some((c) => c.el === overflowEl && c.kind === 'text' && c.a === '6 more not shown'),
    ).toBe(true);
  });

  it('parks every pooled row past the painted count', () => {
    painter.update(stateOf([makeRow({ key: '1:corruption' }), makeRow({ key: '2:agony' })]));
    rec.calls.length = 0;
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    const rows = [...root.querySelectorAll<HTMLElement>('.td-row')];
    const hidden = rec.calls.filter(
      (c) => c.kind === 'display' && c.a === 'none' && rows.includes(c.el),
    );
    expect(hidden.length).toBe(rows.length - 1);
  });

  it('re-resolves the frame accessible name on a language switch', () => {
    rec.calls.length = 0;
    painter.relocalize();
    expect(rec.calls.some((c) => c.el === root && c.kind === 'attr' && c.a === 'aria-label')).toBe(
      true,
    );
  });

  it('builds its skeleton once, never per update', () => {
    const before = root.innerHTML;
    painter.update(stateOf([makeRow({ key: '1:corruption' })]));
    painter.update(stateOf([]));
    // Structure is identical; only attributes/text the writers stub recorded
    // (and never applied) would have changed it.
    expect(root.innerHTML).toBe(before);
  });
});
