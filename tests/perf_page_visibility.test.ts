import { describe, expect, it } from 'vitest';
import {
  bindPerfPageVisibility,
  type PageVisibilityDocument,
  pageHiddenFromState,
} from '../src/game/perf_page_visibility';

function fakeDocument(initial: string): PageVisibilityDocument & {
  listeners: Array<() => void>;
  setState: (state: string) => void;
} {
  const listeners: Array<() => void> = [];
  const doc = {
    visibilityState: initial,
    listeners,
    addEventListener: (_type: 'visibilitychange', listener: () => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
    setState: (state: string) => {
      doc.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
  };
  return doc;
}

describe('perf page visibility ledger binding', () => {
  it('feeds the page state to the monitor at bind time and on every change', () => {
    const calls: Array<[boolean, number | undefined]> = [];
    const perf = { setPageHidden: (hidden: boolean, now?: number) => calls.push([hidden, now]) };
    const doc = fakeDocument('visible');
    let clock = 1000;
    bindPerfPageVisibility(perf, doc, () => clock);
    // Applied once at bind: a monitor created behind a hidden tab must start
    // hidden rather than wait for the next flip.
    expect(calls).toEqual([[false, 1000]]);

    clock = 5000;
    doc.setState('hidden');
    clock = 65_000;
    doc.setState('visible');
    expect(calls).toEqual([
      [false, 1000],
      [true, 5000],
      [false, 65_000],
    ]);
  });

  it('starts hidden when bound behind a hidden page, and unsubscribes cleanly', () => {
    const calls: boolean[] = [];
    const perf = { setPageHidden: (hidden: boolean) => calls.push(hidden) };
    const doc = fakeDocument('hidden');
    const unbind = bindPerfPageVisibility(perf, doc);
    expect(calls).toEqual([true]);
    expect(doc.listeners).toHaveLength(1);
    unbind();
    expect(doc.listeners).toHaveLength(0);
    doc.setState('visible');
    expect(calls).toEqual([true]);
  });

  it('leaves the monitor its own clock when none is injected', () => {
    const calls: Array<number | undefined> = [];
    const perf = { setPageHidden: (_hidden: boolean, now?: number) => calls.push(now) };
    bindPerfPageVisibility(perf, fakeDocument('visible'));
    expect(calls).toEqual([undefined]);
  });

  it('reads anything but visible as hidden', () => {
    expect(pageHiddenFromState('visible')).toBe(false);
    expect(pageHiddenFromState('hidden')).toBe(true);
    expect(pageHiddenFromState('prerender')).toBe(true);
  });
});
