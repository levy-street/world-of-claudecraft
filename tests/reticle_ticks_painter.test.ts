// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { ReticleTickSlot, ReticleTicksState } from '../src/ui/reticle_ticks_core';
import { ReticleTicksPainter } from '../src/ui/reticle_ticks_painter';

// A raw, recording facet: applies every class write to the DOM, keeps the last
// value of every custom property per node, and counts the writes, so a test can
// pin both the outcome and how many writes a frame asked for. The elision of
// repeat frames is the production PainterHost's job, not this painter's.
function recordingWriters() {
  let writes = 0;
  const props = new Map<HTMLElement, Map<string, string>>();
  const writers = {
    toggleClass: (el: HTMLElement, cls: string, on: boolean) => {
      writes++;
      el.classList.toggle(cls, on);
    },
    setStyleProp: (el: HTMLElement, prop: string, value: string) => {
      writes++;
      const own = props.get(el) ?? new Map<string, string>();
      own.set(prop, value);
      props.set(el, own);
    },
  } as unknown as PainterHostWriters;
  return {
    writers,
    count: () => writes,
    prop: (el: Element, name: string) => props.get(el as HTMLElement)?.get(name),
  };
}

const tick = (id: string, active: boolean, angleDeg: number): ReticleTickSlot => ({
  id,
  color: '#ffe14d',
  active,
  angleDeg,
});
const state = (...slots: ReticleTickSlot[]): ReticleTicksState => ({
  slots,
  count: slots.length,
});

describe('ReticleTicksPainter', () => {
  it('builds an aria-hidden ring root the sheet addresses by id', () => {
    const root = ReticleTicksPainter.buildRoot(document);
    expect(root.id).toBe('reticle-ticks');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.childElementCount).toBe(0);
  });

  it('mints one node per slot up to the high-water count and never shrinks the pool', () => {
    const root = ReticleTicksPainter.buildRoot(document);
    const rec = recordingWriters();
    const painter = new ReticleTicksPainter(rec.writers, root);
    painter.paint(state(tick('a', false, -48), tick('b', true, 48)));
    expect(root.childElementCount).toBe(2);
    const [first, second] = Array.from(root.children);
    expect(first.classList.contains('reticle-tick')).toBe(true);
    expect(first.classList.contains('present')).toBe(true);
    expect(first.classList.contains('lit')).toBe(false);
    expect(rec.prop(first, '--tick-angle')).toBe('-48deg');
    expect(second.classList.contains('lit')).toBe(true);
    expect(rec.prop(second, '--tick-color')).toBe('#ffe14d');

    painter.paint(state(tick('a', false, 0)));
    expect(root.childElementCount).toBe(2);
    expect(root.children[0]).toBe(first);
    expect(rec.prop(first, '--tick-angle')).toBe('0deg');
  });

  it('clears BOTH present and lit on a node that leaves the ring', () => {
    // Unrouting or unwatching a proc while its aura is up: the node drops out of
    // the painted count while still lit. .reticle-tick.lit paints at full opacity
    // on its own, so a lit class left behind kept the mark glowing at its old
    // angle until the pool grew again.
    const root = ReticleTicksPainter.buildRoot(document);
    const painter = new ReticleTicksPainter(recordingWriters().writers, root);
    painter.paint(state(tick('a', false, -48), tick('b', true, 48)));
    painter.paint(state(tick('a', false, 0)));
    const orphan = root.children[1];
    expect(orphan.classList.contains('present')).toBe(false);
    expect(orphan.classList.contains('lit')).toBe(false);

    // And it lights again cleanly when the ring grows back.
    painter.paint(state(tick('a', false, -48), tick('b', true, 48)));
    expect(orphan.classList.contains('present')).toBe(true);
    expect(orphan.classList.contains('lit')).toBe(true);
  });

  it('writes only class and per-tick property state, never the radius', () => {
    // The radius is the sheet's (--tick-radius on #reticle-ticks): a per-node,
    // per-frame write of a constant was pure churn.
    const root = ReticleTicksPainter.buildRoot(document);
    const rec = recordingWriters();
    const painter = new ReticleTicksPainter(rec.writers, root);
    painter.paint(state(tick('a', true, 0)));
    expect(rec.prop(root.children[0], '--tick-radius')).toBeUndefined();
    // present, lit, angle, colour: four writes for one present slot.
    expect(rec.count()).toBe(4);
    // An absent pooled node costs exactly its two class writes.
    painter.paint(state());
    expect(rec.count()).toBe(6);
  });
});
