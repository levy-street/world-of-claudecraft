import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetComposedRows,
  trackComposedChipRow,
  trackComposedRow,
} from '../src/ui/charselect_composed_refresh';

// The portrait module is faked so this stays a unit test: the real one owns an
// offscreen WebGL rig (covered in portrait_live_capture.test.ts), and all this
// module needs from it is "a listener slot plus a composed-key predicate".
// Rows are plain liveness flags, so no DOM is needed either.
const portrait = vi.hoisted(() => ({
  listeners: [] as Array<(visualKey: string, skin: number, key?: string) => void>,
  readyListeners: [] as Array<() => void>,
  ready: true,
}));

vi.mock('../src/render/characters/portrait', () => ({
  onPortraitUpdate: (cb: (visualKey: string, skin: number, key?: string) => void) => {
    portrait.listeners.push(cb);
  },
  onPortraitsReady: (cb: () => void) => {
    portrait.readyListeners.push(cb);
  },
  portraitsReady: () => portrait.ready,
  isComposedPortraitKey: (key?: string) => key?.includes(':mod:') === true,
}));

/** A roster row with one composed chip: the swap replaces the chip's HTML. */
function chipRow(): {
  row: {
    isConnected: boolean;
    querySelector: (s: string) => { isConnected: boolean; outerHTML: string } | null;
  };
  chip: { isConnected: boolean; outerHTML: string };
} {
  const chip = {
    isConnected: true,
    outerHTML: '<div class="portrait-chip" data-portrait-composed="1"></div>',
  };
  const row = {
    isConnected: true,
    querySelector: (selector: string) =>
      selector === '.portrait-chip[data-portrait-composed]' ? chip : null,
  };
  return { row, chip };
}

const COMPOSED_KEY = 'player_warrior_modular:mod:a1b2:headshot';
const CLASS_KEY = 'player_warrior:2:headshot';

const emit = (key: string): void => {
  for (const cb of portrait.listeners) cb('player_warrior_modular', -1, key);
};

describe('the character-select roster repaints on a landed composed portrait', () => {
  beforeEach(() => {
    resetComposedRows();
  });

  it('rebuilds every connected tracked row', () => {
    const first = vi.fn();
    const second = vi.fn();
    trackComposedRow({ isConnected: true }, first);
    trackComposedRow({ isConnected: true }, second);

    emit(COMPOSED_KEY);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('skips a row that left the DOM, whose rebuild would paint nothing', () => {
    const gone = vi.fn();
    const live = vi.fn();
    trackComposedRow({ isConnected: false }, gone);
    trackComposedRow({ isConnected: true }, live);

    emit(COMPOSED_KEY);

    expect(gone).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledTimes(1);
  });

  it('ignores a class-keyed update, which hydratePortraits already handles', () => {
    const rebuild = vi.fn();
    trackComposedRow({ isConnected: true }, rebuild);

    emit(CLASS_KEY);

    expect(rebuild).not.toHaveBeenCalled();
  });

  it('drops the previous roster on reset, so a stale row never rebuilds', () => {
    const stale = vi.fn();
    trackComposedRow({ isConnected: true }, stale);

    resetComposedRows();
    emit(COMPOSED_KEY);

    expect(stale).not.toHaveBeenCalled();
  });

  it('subscribes once for the whole module, however many rows register', () => {
    trackComposedRow({ isConnected: true }, vi.fn());
    trackComposedRow({ isConnected: true }, vi.fn());

    // One listener for every track() call in this file, not one per row: a
    // subscription per roster row would multiply every landed capture.
    expect(portrait.listeners).toHaveLength(1);
  });

  it('repaints the roster chip in place and re-arms its crest fallback', () => {
    portrait.ready = true;
    const { row, chip } = chipRow();
    const hydrate = vi.fn();
    trackComposedChipRow(row, () => '<div class="portrait-chip">fresh</div>', hydrate);

    emit(COMPOSED_KEY);

    expect(chip.outerHTML).toBe('<div class="portrait-chip">fresh</div>');
    expect(hydrate).toHaveBeenCalledTimes(1);
    // Assets were ready, so no readiness hook was armed for this row.
    expect(portrait.readyListeners).toHaveLength(0);
  });

  it('also repaints once the assets land when the row was built before they were ready', () => {
    portrait.ready = false;
    const { row, chip } = chipRow();
    trackComposedChipRow(row, () => '<div class="portrait-chip">ready</div>', vi.fn());
    expect(portrait.readyListeners).toHaveLength(1);

    for (const cb of portrait.readyListeners) cb();

    expect(chip.outerHTML).toBe('<div class="portrait-chip">ready</div>');
    portrait.readyListeners.length = 0;
    portrait.ready = true;
  });
});
