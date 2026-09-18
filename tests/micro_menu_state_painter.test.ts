// @vitest-environment jsdom
//
// Routing + elision guard for the micro-menu rail painter. A REAL writer facet over
// real elements proves three things a source scan cannot: the ring and the badge
// land on the right buttons, an unchanged rail performs ZERO DOM writes on the next
// tick, and the badge span is minted exactly once. The open-state reader is checked
// against the `data-window-open` marker Hud's window observer maintains.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MICRO_MENU_BADGE_CLASS,
  MicroMenuStatePainter,
  microMenuWindowOpen,
} from '../src/ui/micro_menu_state_painter';
import { createMicroMenuStateView, MICRO_MENU_LAUNCHERS } from '../src/ui/micro_menu_state_view';
import { makeWriterFacet } from '../src/ui/painter_host';

function facet() {
  const counts = { writes: 0, skips: 0 };
  const writers = makeWriterFacet(
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { writers, counts };
}

/** The rail plus the windows the registry names, as the entry documents seat them. */
function mountRail(): void {
  document.body.innerHTML = '';
  for (const { selector, windowId } of MICRO_MENU_LAUNCHERS) {
    const btn = document.createElement('button');
    btn.id = selector.slice(1);
    btn.className = 'micro-btn ui-icon-btn ui-icon-btn--micro';
    document.body.appendChild(btn);
    const win = document.createElement('div');
    win.id = windowId;
    win.className = 'window panel';
    document.body.appendChild(win);
  }
}

const openWindow = (windowId: string, open: boolean): void => {
  const el = document.getElementById(windowId);
  if (!el) throw new Error(`no #${windowId} mounted`);
  if (open) el.dataset.windowOpen = '1';
  else delete el.dataset.windowOpen;
};

const view = () => createMicroMenuStateView((value) => String(value));

beforeEach(() => {
  mountRail();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('microMenuWindowOpen: reads the shared open-window marker', () => {
  it('reports a window open only while data-window-open is set', () => {
    expect(microMenuWindowOpen('map-window')).toBe(false);
    openWindow('map-window', true);
    expect(microMenuWindowOpen('map-window')).toBe(true);
    openWindow('map-window', false);
    expect(microMenuWindowOpen('map-window')).toBe(false);
  });

  it('reports a window that is not in the document as closed', () => {
    expect(microMenuWindowOpen('no-such-window')).toBe(false);
  });

  it('resolves each window element once and reads the marker off the cache after that', () => {
    const v = view();
    const painter = new MicroMenuStatePainter(facet().writers);
    const lookups = vi.spyOn(document, 'getElementById');
    // Only the WINDOW ids: jsdom routes the painter's own `#mm-*` querySelector
    // through getElementById too, and that cache is not what this pins.
    const windowIds = new Set(MICRO_MENU_LAUNCHERS.map((spec) => spec.windowId));
    const windowLookups = () =>
      lookups.mock.calls.filter(([id]) => windowIds.has(String(id))).length;

    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    expect(windowLookups()).toBe(MICRO_MENU_LAUNCHERS.length);
    lookups.mockClear();

    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));

    expect(windowLookups()).toBe(0);
  });

  it('re-queries a window element that left the document, and still sees it reopen', () => {
    expect(microMenuWindowOpen('map-window')).toBe(false);
    document.getElementById('map-window')?.remove();

    const replacement = document.createElement('div');
    replacement.id = 'map-window';
    replacement.className = 'window panel';
    replacement.dataset.windowOpen = '1';
    document.body.appendChild(replacement);

    expect(microMenuWindowOpen('map-window')).toBe(true);
  });

  it('caches no miss, so a window minted after the first paint still lights its ring', () => {
    document.getElementById('deeds-window')?.remove();
    expect(microMenuWindowOpen('deeds-window')).toBe(false);

    const late = document.createElement('div');
    late.id = 'deeds-window';
    late.className = 'window panel';
    late.dataset.windowOpen = '1';
    document.body.appendChild(late);

    expect(microMenuWindowOpen('deeds-window')).toBe(true);
  });
});

describe('MicroMenuStatePainter: the open-window ring', () => {
  it('rings the open launcher and clears the rest', () => {
    const { writers } = facet();
    const painter = new MicroMenuStatePainter(writers);
    openWindow('bags', true);
    painter.paint(view().tick(microMenuWindowOpen, { talentPoints: 0 }));
    const bag = document.getElementById('mm-bag');
    const char = document.getElementById('mm-char');
    expect(bag?.classList.contains('is-on')).toBe(true);
    expect(bag?.getAttribute('aria-pressed')).toBe('true');
    expect(char?.classList.contains('is-on')).toBe(false);
    expect(char?.getAttribute('aria-pressed')).toBe('false');
  });

  it('drops the ring when the window closes', () => {
    const { writers } = facet();
    const painter = new MicroMenuStatePainter(writers);
    const v = view();
    openWindow('char-window', true);
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    openWindow('char-window', false);
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    const char = document.getElementById('mm-char');
    expect(char?.classList.contains('is-on')).toBe(false);
    expect(char?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('MicroMenuStatePainter: the count badge', () => {
  it('mints one badge span carrying the library primitive classes', () => {
    const { writers } = facet();
    const painter = new MicroMenuStatePainter(writers);
    const v = view();
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 2 }));
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 3 }));
    const badges = document.querySelectorAll('#mm-talents .mm-badge');
    expect(badges).toHaveLength(1);
    const badge = badges[0] as HTMLElement;
    expect(badge.getAttribute('class')).toBe(MICRO_MENU_BADGE_CLASS);
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).toBe('3');
  });

  it('renders empty text at zero rather than a 0 (the :empty hide)', () => {
    const { writers } = facet();
    const painter = new MicroMenuStatePainter(writers);
    const v = view();
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 2 }));
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    const badge = document.querySelector<HTMLElement>('#mm-talents .mm-badge');
    expect(badge?.textContent).toBe('');
  });

  it('badges no other launcher', () => {
    const { writers } = facet();
    new MicroMenuStatePainter(writers).paint(view().tick(microMenuWindowOpen, { talentPoints: 5 }));
    expect(document.querySelectorAll('.mm-badge')).toHaveLength(1);
  });
});

describe('MicroMenuStatePainter: write elision', () => {
  it('performs no DOM write at all on an unchanged repaint', () => {
    const { writers, counts } = facet();
    const painter = new MicroMenuStatePainter(writers);
    const v = view();
    openWindow('quest-log-window', true);
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 1 }));
    expect(counts.writes).toBeGreaterThan(0);
    const settled = counts.writes;
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 1 }));
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 1 }));
    expect(counts.writes).toBe(settled);
    expect(counts.skips).toBeGreaterThan(0);
  });

  it('writes again the moment a window opens', () => {
    const { writers, counts } = facet();
    const painter = new MicroMenuStatePainter(writers);
    const v = view();
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    const settled = counts.writes;
    openWindow('deeds-window', true);
    painter.paint(v.tick(microMenuWindowOpen, { talentPoints: 0 }));
    // one class toggle plus one aria-pressed flip on the one launcher that moved
    expect(counts.writes).toBe(settled + 2);
  });

  it('survives a launcher that is missing from the document', () => {
    document.getElementById('mm-cardduel')?.remove();
    const { writers } = facet();
    const painter = new MicroMenuStatePainter(writers);
    expect(() =>
      painter.paint(view().tick(microMenuWindowOpen, { talentPoints: 0 })),
    ).not.toThrow();
  });
});
