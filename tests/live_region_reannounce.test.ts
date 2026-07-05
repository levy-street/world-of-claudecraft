import { describe, expect, it } from 'vitest';
import { ReannounceMarker } from '../src/ui/live_region_reannounce';

// The shared re-announce marker: forces a byte-different string on an identical
// consecutive live-region write so a screen reader that suppresses unchanged live text still
// re-reads it. Used by the combat + chat announcers and the target-name region. DOM-free and
// deterministic (internal toggle, no clock / randomness), so a Vitest drives it directly.
const NBSP = String.fromCharCode(0xa0);

describe('ReannounceMarker', () => {
  it('returns a changed value byte-faithful (no marker on non-identical text)', () => {
    const m = new ReannounceMarker();
    expect(m.mark('Mark Wolf')).toBe('Mark Wolf');
    expect(m.mark('Mark Bear')).toBe('Mark Bear');
  });

  it('forces a byte-different value on an identical consecutive call, alternating', () => {
    const m = new ReannounceMarker();
    const a = m.mark('Mark Wolf'); // first: clean
    const b = m.mark('Mark Wolf'); // identical: marked
    const c = m.mark('Mark Wolf'); // identical: unmarked again (toggle off)
    const d = m.mark('Mark Wolf'); // identical: marked again
    expect(a).toBe('Mark Wolf');
    expect(b).toBe(`Mark Wolf${NBSP}`);
    expect(c).toBe('Mark Wolf');
    expect(d).toBe(`Mark Wolf${NBSP}`);
    // The marker never changes how the value reads aloud: trimming returns the original.
    expect(b.trim()).toBe('Mark Wolf');
    expect(d.trim()).toBe('Mark Wolf');
  });

  it('resets the toggle when the value changes, so a later repeat starts clean', () => {
    const m = new ReannounceMarker();
    expect(m.mark('a')).toBe('a');
    expect(m.mark('a')).toBe(`a${NBSP}`); // toggle on
    expect(m.mark('b')).toBe('b'); // different: resets toggle
    expect(m.mark('b')).toBe(`b${NBSP}`); // toggle on again from a clean base
  });

  it('reset() forgets the last value so the next identical value is byte-faithful', () => {
    const m = new ReannounceMarker();
    expect(m.mark('Mark Wolf')).toBe('Mark Wolf');
    m.reset();
    // After a clear (e.g. losing the target) re-acquiring the same name announces cleanly.
    expect(m.mark('Mark Wolf')).toBe('Mark Wolf');
  });

  it('is deterministic: the same call sequence yields the same outputs', () => {
    const run = (): string[] => {
      const m = new ReannounceMarker();
      return ['x', 'x', 'x', 'y', 'x'].map((s) => m.mark(s));
    };
    expect(run()).toEqual(run());
  });
});
