// @vitest-environment happy-dom
//
// DOM behavioral guard for the Harvest Journal's countdown clock, the one
// driver this window owns. The per-file perf budget can only count tokens in
// the tick's reachable body; what it cannot see is whether the tick actually
// ELIDES an unchanged write, whether a moved model actually repaints, and
// whether closing the window actually disposes the clock. Those three are the
// contract, so they are driven here over the real HarvestJournalWindow with
// stub deps and fake timers.
//
// The copy assertions deliberately pin LITERAL English rather than comparing
// one t() call against another: a self-comparison would pass with the key, the
// clock arm, and the zero padding all wrong at once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import { HARVEST_JOURNAL_TICK_MS, HarvestJournalWindow } from '../src/ui/harvest_journal_window';
import type { IWorld } from '../src/world_api';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const plot = (over: Partial<FarmPlotView> = {}): FarmPlotView => ({
  bedId: 'bed_eastbrook_1',
  cropId: 'vale_wheat',
  plantedAtMs: 0,
  readyAtMs: 10 * MINUTE,
  compost: false,
  watch: false,
  tonic: false,
  notified: false,
  status: 'growing',
  ...over,
});

/** A mutable stand-in for the live world: the test moves `nowMs` and `plots`
 *  the way a real session would, so nothing here has to reach inside the
 *  window to simulate a change. */
class StubWorld {
  nowMs = 0;
  plots: FarmPlotView[] = [plot()];
  farmingSkill = 40;
  clockReads = 0;
  get myFarmPlots(): readonly FarmPlotView[] {
    // A FRESH array per read, the Sim's shape: if the window ever memoized by
    // reference it would repaint every tick here and the elision test below
    // would catch it.
    return [...this.plots];
  }
  get farmPatches() {
    return FARM_PATCHES;
  }
  get professionsState() {
    return { skills: [{ professionId: 'farming', skill: this.farmingSkill, maxSkill: 100 }] };
  }
  farmNowMs(): number {
    this.clockReads++;
    return this.nowMs;
  }
}

let root: HTMLElement;
let world: StubWorld;
let restoredTo: HTMLElement | null | undefined;

const makeWindow = (): HarvestJournalWindow =>
  new HarvestJournalWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: (target) => {
      restoredTo = target;
    },
  });

const countdownCell = (): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-harvest-journal-countdown]');

/** Count textContent writes on ONE live node, so "the tick elided" is a
 *  measurement rather than an inference from unchanged text. */
function watchWrites(el: HTMLElement): () => number {
  let writes = 0;
  // The accessor lives somewhere up the Node prototype chain, not necessarily
  // on the element's immediate prototype, so walk to it rather than assuming.
  let proto: object | null = Object.getPrototypeOf(el);
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'textContent');
    proto = Object.getPrototypeOf(proto);
  }
  if (!desc?.get || !desc.set) throw new Error('no textContent accessor to wrap');
  const { get, set } = desc;
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get: () => get.call(el),
    set: (value) => {
      writes++;
      set.call(el, value);
    },
  });
  return () => writes;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="harvest-journal-window"></div>';
  root = document.getElementById('harvest-journal-window') as HTMLElement;
  world = new StubWorld();
  restoredTo = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('harvest journal window: paint', () => {
  it('renders one row per plot with its crop, bed, and live countdown', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    expect(root.querySelectorAll('.hj-row')).toHaveLength(1);
    expect(root.querySelector('.hj-crop')?.textContent).toBe('Vale Wheat');
    expect(root.querySelector('.hj-bed')?.textContent).toBe('Eastbrook Vale, bed 1');
    // The whole composed line, to a literal: the key, the clock arm, and the
    // zero-padded seconds all have to be right for this to hold.
    expect(countdownCell()?.textContent).toBe('Ready in 5m 00s');
    expect(countdownCell()?.dataset.harvestJournalCountdown).toBe(String(10 * MINUTE));
  });

  it('stamps the rebind attribute on the growing arm ONLY', () => {
    world.plots = [
      plot({ bedId: 'bed_eastbrook_1', status: 'growing' }),
      plot({ bedId: 'bed_eastbrook_2', status: 'ready' }),
      plot({ bedId: 'bed_eastbrook_3', status: 'withered' }),
    ];
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    expect(root.querySelectorAll('[data-harvest-journal-countdown]')).toHaveLength(1);
    const times = [...root.querySelectorAll('.hj-time')].map((el) => el.textContent);
    expect(times).toEqual(['Ready in 5m 00s', 'Ready to harvest', 'Withered']);
  });

  it("renders the zero-clamped 'finishing up' line, not Ready, past the deadline", () => {
    world.nowMs = 10 * MINUTE + 30 * SECOND;
    makeWindow().open();
    expect(root.querySelector('.hj-time')?.textContent).toBe('Finishing up');
    expect(countdownCell()).toBeNull();
  });

  it('names the paid knobs and says so plainly when none were paid', () => {
    world.plots = [plot({ compost: true, tonic: true })];
    makeWindow().open();
    expect([...root.querySelectorAll('.hj-care-chip')].map((el) => el.textContent)).toEqual([
      'Compost',
      'Growth Tonic',
    ]);
    expect(root.querySelector('.hj-care-none')).toBeNull();
    document.body.innerHTML = '<div id="harvest-journal-window"></div>';
    root = document.getElementById('harvest-journal-window') as HTMLElement;
    world.plots = [plot()];
    makeWindow().open();
    expect(root.querySelectorAll('.hj-care-chip')).toHaveLength(0);
    expect(root.querySelector('.hj-care-none')?.textContent).toBe('No extras');
  });

  it('paints the novice empty state at skill 0 and the plain one above it', () => {
    world.plots = [];
    world.farmingSkill = 0;
    const win = makeWindow();
    win.open();
    expect(root.querySelector('.hj-empty h3')?.textContent).toBe(
      'You have not worked a garden bed yet',
    );
    win.close();
    world.farmingSkill = 40;
    win.open();
    expect(root.querySelector('.hj-empty h3')?.textContent).toBe('No crops planted');
  });
});

describe('harvest journal window: the countdown clock', () => {
  it('rewrites the time cell in place as the countdown drains, without repainting', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    const cell = countdownCell();
    const row = root.querySelector('.hj-row');
    expect(cell?.textContent).toBe('Ready in 5m 00s');
    world.nowMs = 5 * MINUTE + 10 * SECOND;
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(cell?.textContent).toBe('Ready in 4m 50s');
    // The SAME nodes, which is what "rewrites textContent only" means: a full
    // repaint would have replaced them.
    expect(countdownCell()).toBe(cell);
    expect(root.querySelector('.hj-row')).toBe(row);
  });

  it('ELIDES the write when the rendered string has not moved', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    const cell = countdownCell();
    if (!cell) throw new Error('no countdown cell');
    const writes = watchWrites(cell);
    // A tick with the world clock standing still: same string, so nothing at
    // all should be written.
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(writes()).toBe(0);
    // The positive control, so the counter is not simply blind: move the clock
    // and exactly one write lands.
    world.nowMs = 5 * MINUTE + SECOND;
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(writes()).toBe(1);
    expect(cell.textContent).toBe('Ready in 4m 59s');
  });

  it('repaints whole the tick after the authority flips a plot to ready', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    const row = root.querySelector('.hj-row');
    // The server answers: this plot is ready. Its deadline is untouched, so
    // ONLY `status` moved.
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelector('.hj-row')).not.toBe(row);
    expect(root.querySelector('.hj-time')?.textContent).toBe('Ready to harvest');
    expect(countdownCell()).toBeNull();
  });

  it('repaints whole the tick a countdown crosses its own deadline', () => {
    world.nowMs = 10 * MINUTE - 2 * SECOND;
    makeWindow().open();
    expect(countdownCell()?.textContent).toBe('Ready in 2s');
    world.nowMs = 10 * MINUTE + SECOND;
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(countdownCell()).toBeNull();
    expect(root.querySelector('.hj-time')?.textContent).toBe('Finishing up');
  });

  it('picks up a plot planted or harvested elsewhere on the next tick', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    expect(root.querySelectorAll('.hj-row')).toHaveLength(1);
    world.plots = [plot(), plot({ bedId: 'bed_eastbrook_2' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelectorAll('.hj-row')).toHaveLength(2);
    world.plots = [];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelectorAll('.hj-row')).toHaveLength(0);
    expect(root.querySelector('.hj-empty h3')?.textContent).toBe('No crops planted');
  });

  // These two count the LIVE TIMER, not the work the timer does. The tick's
  // own `isOpen` guard makes a leaked interval invisible from the outside: it
  // keeps firing forever and returns immediately, so a world-read count on a
  // closed window reads exactly like a disposed clock. Only the timer itself
  // tells the two apart.
  it('arms the clock on open and DISPOSES it on close', () => {
    const win = makeWindow();
    expect(vi.getTimerCount()).toBe(0);
    win.open();
    expect(vi.getTimerCount()).toBe(1);
    const armed = world.clockReads;
    vi.advanceTimersByTime(3 * HARVEST_JOURNAL_TICK_MS);
    expect(world.clockReads).toBeGreaterThan(armed);
    win.close();
    expect(win.isOpen).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const atClose = world.clockReads;
    vi.advanceTimersByTime(10 * HARVEST_JOURNAL_TICK_MS);
    expect(world.clockReads).toBe(atClose);
  });

  it('arms exactly one clock across repeated opens, and disposes it once', () => {
    const win = makeWindow();
    win.open();
    win.open();
    win.open();
    // A re-open that re-armed would leave a second interval behind that
    // close() has no handle for.
    expect(vi.getTimerCount()).toBe(1);
    world.nowMs = SECOND;
    const before = world.clockReads;
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(world.clockReads - before).toBe(1);
    win.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('harvest journal window: open, close, and focus', () => {
  it('toggles display and returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const win = new HarvestJournalWindow({
      root: () => root,
      world: () => world as unknown as IWorld,
      closeOthers: () => {},
      captureFocus: () => opener,
      restoreFocus: (target) => {
        restoredTo = target;
      },
    });
    expect(win.isOpen).toBe(false);
    win.toggle();
    expect(win.isOpen).toBe(true);
    expect(root.style.display).toBe('block');
    win.toggle();
    expect(win.isOpen).toBe(false);
    expect(root.style.display).toBe('none');
    expect(restoredTo).toBe(opener);
  });

  it('closes from its own X button', () => {
    const win = makeWindow();
    win.open();
    root.querySelector<HTMLElement>('[data-close]')?.click();
    expect(win.isOpen).toBe(false);
  });

  it('render() on a closed window paints nothing (the language-switch guard)', () => {
    const win = makeWindow();
    win.render();
    expect(root.innerHTML).toBe('');
    expect(win.isOpen).toBe(false);
  });

  it('carries keyboard focus across a signature-forced whole repaint', () => {
    const win = makeWindow();
    win.open();
    const closeBtn = root.querySelector<HTMLElement>('[data-close]');
    expect(closeBtn).not.toBeNull();
    closeBtn?.focus();
    expect(document.activeElement).toBe(closeBtn);
    // A plot flipping to ready moves the value signature, so the next tick
    // repaints WHOLE, destroying the focused button's node. The rebuild must
    // hand focus to the rebuilt control, not strand it on <body> while the
    // dialog is still up.
    world.nowMs = 11 * MINUTE;
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    const rebuilt = root.querySelector<HTMLElement>('[data-close]');
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).not.toBe(closeBtn);
    expect(document.activeElement).toBe(rebuilt);
  });
});

describe('harvest journal window: the ClientWorld mirror shape', () => {
  it('repaints on an in-place content change behind a STABLE array identity', () => {
    // ClientWorld keeps ONE array until the next fplot delta (the read-identity
    // trap, the opposite of Sim's fresh-array-per-read shape the other suites
    // drive). A window that diffed by array or row identity would never see an
    // in-place change here; only the value signature may be the change gate.
    const stable: FarmPlotView[] = [plot()];
    const mirrorWorld = {
      myFarmPlots: stable as readonly FarmPlotView[],
      farmPatches: FARM_PATCHES,
      professionsState: { skills: [{ professionId: 'farming', skill: 40, maxSkill: 100 }] },
      nowMs: 0,
      farmNowMs(): number {
        return this.nowMs;
      },
    };
    const win = new HarvestJournalWindow({
      root: () => root,
      world: () => mirrorWorld as unknown as IWorld,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
    });
    win.open();
    expect(countdownCell()).not.toBeNull();
    // Same array instance, same row object, content mutated in place.
    stable[0].status = 'ready';
    stable[0].notified = true;
    mirrorWorld.nowMs = 11 * MINUTE;
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    // The whole repaint replaced the growing row with the settled ready arm:
    // no countdown cell remains and the ready label is up.
    expect(countdownCell()).toBeNull();
    expect(root.textContent).toContain('Ready to harvest');
    win.close();
  });
});
