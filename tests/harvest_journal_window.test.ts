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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import {
  HARVEST_JOURNAL_TICK_MS,
  HarvestJournalWindow,
} from '../src/ui/hud/professions/harvest_journal_window';
import type { IWorld } from '../src/world_api';
import { stripComments } from './helpers/strip_comments';

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

  it('paints settled statuses as themselves past the deadline, never as finishing', () => {
    // The authority's everyday shape: ready and withered only ever arrive
    // once the deadline is behind the clock, so a painter that let the zero
    // clamp win here would show every real settled bed as 'Finishing up'.
    world.plots = [
      plot({ bedId: 'bed_eastbrook_1', status: 'ready' }),
      plot({ bedId: 'bed_eastbrook_2', status: 'withered' }),
    ];
    world.nowMs = 10 * MINUTE + 30 * SECOND;
    makeWindow().open();
    const times = [...root.querySelectorAll('.hj-time')].map((el) => el.textContent);
    expect(times).toEqual(['Ready to harvest', 'Withered']);
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

  it('announces a ready flip through the in-dialog status line (a11y batch)', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    const status = () => root.querySelector<HTMLElement>('.hj-live-status');
    // The line exists from the first paint (a live region must be PRESENT
    // before its content changes) and starts empty: rows already ready at
    // open are shown, never announced.
    expect(status()).not.toBeNull();
    expect(status()?.getAttribute('role')).toBe('status');
    expect(status()?.textContent).toBe('');
    const node = status();
    // The repaint wrapper's identity is the decisive never-detached proof: a
    // regression that rebuilds the wrapper each paint would re-append the
    // SAME cached status element (identity alone stays green) while still
    // detaching it from the tree every repaint.
    const wrapper = root.querySelector<HTMLElement>('.hj-content');
    expect(wrapper).not.toBeNull();
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelector<HTMLElement>('.hj-content')).toBe(wrapper);
    // The SAME node carries the announcement across the whole repaint AND it
    // was never detached: the repaint targets the inner content element, so
    // the region's parent stays the root (a region that leaves and re-enters
    // the tree announces unreliably; assistive tech drops or repeats it).
    expect(status()).toBe(node);
    expect(status()?.parentNode).toBe(root);
    expect(status()?.textContent).toBe('Ready to harvest: Vale Wheat');
  });

  it('a repeat flip of the same crop still mutates the region (fresh child span)', () => {
    world.nowMs = 5 * MINUTE;
    makeWindow().open();
    const status = root.querySelector<HTMLElement>('.hj-live-status');
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    const firstSpan = status?.firstChild;
    expect(firstSpan?.textContent).toBe('Ready to harvest: Vale Wheat');
    // Harvested (row gone) then replanted and ready again: byte-identical
    // announcement text. Writing the same string into textContent would
    // mutate nothing, so AT would announce nothing; the fresh child span is
    // what makes the repeat a real mutation.
    world.plots = [];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    const secondSpan = status?.firstChild;
    expect(secondSpan?.textContent).toBe('Ready to harvest: Vale Wheat');
    expect(root.querySelector('.hj-live-status')).toBe(status);
    expect(secondSpan).not.toBe(firstSpan);
    // The mechanism pin: the announcement is an ELEMENT child, the explicit
    // engine-optimization-proof form. A bare textContent write would also
    // land a fresh Text node per the DOM's string-replace-all, but that
    // leaves the mutation property to engine behavior; the span makes it
    // deliberate (and killable in the mutation battery).
    expect((secondSpan as HTMLElement)?.nodeName).toBe('SPAN');
  });

  it('a language switch clears the standing announcement (no stale locale)', () => {
    world.nowMs = 5 * MINUTE;
    const win = makeWindow();
    win.open();
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelector('.hj-live-status')?.textContent).toBe('Ready to harvest: Vale Wheat');
    // The Hud's language-switch arm: the standing announcement was minted in
    // the OLD locale and no flip re-mints it, so relocalize clears it and
    // re-renders the window (which stays painted).
    win.relocalize();
    expect(root.querySelector('.hj-live-status')?.textContent).toBe('');
    expect(root.querySelector('#harvest-journal-title')).not.toBeNull();
  });

  it('a journal opened onto an already-ready plot stays quiet; a close clears the line', () => {
    world.plots = [plot({ status: 'ready' })];
    const win = makeWindow();
    win.open();
    expect(root.querySelector('.hj-live-status')?.textContent).toBe('');
    // A second bed flips under the open window: announced. Then a close and
    // reopen must start quiet again (no stale announcement to re-read).
    world.plots = [plot({ status: 'ready' }), plot({ bedId: 'bed_eastbrook_2', status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    expect(root.querySelector('.hj-live-status')?.textContent).toBe('Ready to harvest: Vale Wheat');
    win.close();
    win.open();
    expect(root.querySelector('.hj-live-status')?.textContent).toBe('');
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
    expect(root.style.display).toBe('flex');
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

  it('does NOT steal focus on a whole repaint when focus was outside the window', () => {
    // The negative arm of the carry: a plot flipping to ready under an open
    // journal while the player is typing in chat (or standing on another
    // window's control) must leave focus exactly where it was. Only a control
    // INSIDE this root earns a re-focus after the innerHTML rebuild.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const win = makeWindow();
    win.open();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    world.nowMs = 11 * MINUTE;
    world.plots = [plot({ status: 'ready' })];
    vi.advanceTimersByTime(HARVEST_JOURNAL_TICK_MS);
    // The repaint really happened (the row is the ready arm now) ...
    expect(root.querySelector('.hj-time')?.textContent).toBe('Ready to harvest');
    // ... and focus stayed outside the dialog.
    expect(document.activeElement).toBe(outside);
    outside.remove();
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

describe('harvest journal window (source contract)', () => {
  // The window's components rule is flex-column (#harvest-journal-window
  // flex-direction: column; .hj-body flex: 1 1 auto + overflow-y), so per
  // the window-frame family every show-site must set display = 'flex' (a
  // 'block' leaves the body's flex sizing inert, and the inset-pinned
  // mobile rule's overflow: hidden then clips a long bed list with no
  // scroller) and every read-guard must test the value it writes. The #bags
  // pin in tests/client_shell.test.ts is the precedent. The behavioral pin
  // above also reds on a whole-window flip; this source pin's added value
  // is a SECOND show-site or a read-guard shape no behavioral case drives,
  // and the CSS half below is what keeps the column contract itself from
  // being deleted out from under a green TS pin. Comments are stripped so
  // prose about 'block' can neither satisfy nor trip a needle.
  const src = stripComments(
    readFileSync(join(process.cwd(), 'src/ui/hud/professions/harvest_journal_window.ts'), 'utf8'),
  );

  it('opens and closes with inline flex, with no block write or block-shaped guard', () => {
    expect(src).toContain("root.style.display = 'flex';");
    expect(src).toContain("root.style.display = 'none';");
    expect(src).toContain("return this.deps.root().style.display === 'flex';");
    expect(src).not.toContain("style.display = 'block'");
    expect(src).not.toContain("=== 'block'");
    expect(src).not.toContain("!== 'block'");
  });

  it('keeps the flex-column components rule the inline flex engages', () => {
    const componentsCss = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(componentsCss).toMatch(/#harvest-journal-window \{[^}]*flex-direction: column;/s);
  });
});

describe('harvest journal window: the root div ships in BOTH entries', () => {
  // The painter resolves #harvest-journal-window, and since the v0.40.0 sync of
  // release tip 35a6481825 the root is also a CHROME_GUARDED_PANELS entry, so
  // wireChromeFocus($) queries it at HUD construction: a dropped div there is no
  // longer one broken window but a throw that fails the whole HUD boot. Read the
  // real entry HTML, never a fixture (the plant-sheet idiom, mirrored).
  it.each(['index.html', 'play.html'])('%s carries id="harvest-journal-window"', (entry) => {
    // Comments stripped FIRST, the entry_window_parity idiom: a raw occurrence
    // count is comment-gameable, so a commented-out div kept the count at 1 and
    // this pin green while the root was gone (Phase 11d QA pin audit found the
    // arm vacuous for the exact case its own comment claimed). entry_window_parity
    // catches only an ASYMMETRIC edit, so with both entries commented out nothing
    // in the tree red-flagged it.
    const html = readFileSync(join(process.cwd(), entry), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    // Exactly once: a duplicate id would make querySelector's pick arbitrary,
    // and zero is a TypeError at HUD construction rather than one dead window,
    // because the root is a CHROME_GUARDED_PANELS entry that wireChromeFocus
    // resolves through `$` at boot.
    expect(html.split('id="harvest-journal-window"').length - 1).toBe(1);
  });
});
