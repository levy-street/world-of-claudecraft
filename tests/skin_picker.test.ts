import { describe, expect, it, vi } from 'vitest';
import { wireSkinPicker } from '../src/ui/hud/cosmetics/skin_picker';

// Hand-rolled fake DOM (jsdom is deliberately not a dependency; see
// tests/CLAUDE.md). addEventListener models the real contract the module relies
// on: multiple handlers per type, and { signal } removal when the AbortController
// aborts. fire() runs every live handler for a type; count() reports how many
// remain (so a test can prove stale handlers were removed, not stacked).
interface Listener {
  type: string;
  h: () => void;
}
function makeTarget() {
  const listeners: Listener[] = [];
  return {
    listeners,
    addEventListener(type: string, h: () => void, opts?: { signal?: AbortSignal }) {
      if (opts?.signal?.aborted) return;
      const entry: Listener = { type, h };
      listeners.push(entry);
      opts?.signal?.addEventListener('abort', () => {
        const i = listeners.indexOf(entry);
        if (i >= 0) listeners.splice(i, 1);
      });
    },
    fire(type: string) {
      for (const l of listeners.filter((l) => l.type === type)) l.h();
    },
    count(type: string) {
      return listeners.filter((l) => l.type === type).length;
    },
  };
}

function fakeSwatch(skin: number, selected: boolean) {
  const classes = new Set<string>(selected ? ['sel'] : []);
  const target = makeTarget();
  return {
    ...target,
    dataset: { skin: String(skin) },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    isSel: () => classes.has('sel'),
    hasHandler: (type: string) => target.count(type) > 0,
  };
}

function fakeRow() {
  return makeTarget();
}

type Swatch = ReturnType<typeof fakeSwatch>;

function setup(count: number, selected: number) {
  const row = fakeRow();
  const swatches = Array.from({ length: count }, (_, i) => fakeSwatch(i, i === selected));
  const onPreview = vi.fn();
  const onRevert = vi.fn();
  const onPick = vi.fn();
  wireSkinPicker(row as unknown as HTMLElement, swatches as unknown as HTMLElement[], selected, {
    onPreview,
    onRevert,
    onPick,
  });
  return { row, swatches, onPreview, onRevert, onPick };
}

describe('wireSkinPicker (char-creator chroma preview, issue 1464)', () => {
  it('previews every swatch on hover, including the one adjacent to the selected swatch', () => {
    // The reported repro: outfit 2 (index 1) is selected, then the user hovers
    // outfit 1 (index 0, its left neighbour) and it must preview. The old
    // per-swatch mouseleave revert raced this mouseenter and clobbered it.
    const { swatches, onPreview } = setup(4, 1);
    for (const s of swatches as Swatch[]) s.fire('mouseenter');
    expect(onPreview.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3]);
  });

  it('does not revert while moving between swatches; only when leaving the row', () => {
    const { row, swatches, onRevert } = setup(4, 1);
    // No swatch carries a mouseleave handler at all: moving swatch-to-swatch
    // can never revert (that per-swatch revert was the bug).
    for (const s of swatches as Swatch[]) {
      expect(s.hasHandler('mouseleave')).toBe(false);
      s.fire('mouseleave'); // no-op; would revert under the old wiring
    }
    expect(onRevert).not.toHaveBeenCalled();
    // Leaving the whole picker reverts to the committed selection (index 1).
    row.fire('mouseleave');
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledWith(1);
  });

  it('commits the clicked swatch, moves the sel class, and reverts to it afterwards', () => {
    const { row, swatches, onPick, onRevert } = setup(4, 1);
    (swatches[3] as Swatch).fire('click');
    expect(onPick).toHaveBeenCalledWith(3);
    expect((swatches[3] as Swatch).isSel()).toBe(true);
    expect((swatches[1] as Swatch).isSel()).toBe(false);
    row.fire('mouseleave');
    expect(onRevert).toHaveBeenLastCalledWith(3);
  });

  it('does not stack listeners when the same row is re-wired (class switch)', () => {
    // renderSkinPicker reuses the persistent row across class switches, so a
    // second wiring must replace the first, not stack on it: otherwise one row
    // mouseleave fires every stale revert and retains the removed swatches.
    const row = fakeRow();
    const first = { onPreview: vi.fn(), onRevert: vi.fn(), onPick: vi.fn() };
    const swatchesA = Array.from({ length: 3 }, (_, i) => fakeSwatch(i, i === 0));
    wireSkinPicker(row as unknown as HTMLElement, swatchesA as unknown as HTMLElement[], 0, first);

    const second = { onPreview: vi.fn(), onRevert: vi.fn(), onPick: vi.fn() };
    const swatchesB = Array.from({ length: 3 }, (_, i) => fakeSwatch(i, i === 2));
    wireSkinPicker(row as unknown as HTMLElement, swatchesB as unknown as HTMLElement[], 2, second);

    expect(row.count('mouseleave')).toBe(1); // the first wiring's handler was aborted
    row.fire('mouseleave');
    expect(first.onRevert).not.toHaveBeenCalled();
    expect(second.onRevert).toHaveBeenCalledTimes(1);
    expect(second.onRevert).toHaveBeenCalledWith(2); // reads the current selection
  });

  it('reverts to the fallback skin when no swatch is marked selected', () => {
    const row = fakeRow();
    const swatches = Array.from({ length: 3 }, (_, i) => fakeSwatch(i, false));
    const onRevert = vi.fn();
    wireSkinPicker(row as unknown as HTMLElement, swatches as unknown as HTMLElement[], 2, {
      onPreview: vi.fn(),
      onRevert,
      onPick: vi.fn(),
    });
    row.fire('mouseleave');
    expect(onRevert).toHaveBeenCalledWith(2);
  });
});
