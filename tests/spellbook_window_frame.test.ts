// @vitest-environment jsdom
//
// Behavioral guards for the spellbook window painter AFTER the AAA window-frame
// adoption (the pure class-kit decisions stay in spellbook_view.test.ts). These
// render the real DOM through the shared window-frame builder and assert: the
// frame chrome is stamped on an inner mount (the root stays a pristine
// .window.panel), the titlebar is a Hud drag handle but the close is not, the
// body frames a bounded flex column, the reset-bar action lives in the sticky
// footer for form-bar classes, and above all that DRAG-TO-ACTIONBAR is preserved
// EXACTLY: a dragstart on a known spell row sets the drag action, writes the
// hotbar MIME payload, and dragend clears it, while the +/- toggle still routes
// through addToBar / removeFromBar.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASSES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { encodeHotbarAction, HOTBAR_ACTION_MIME } from '../src/ui/hotbar';
import { SpellbookWindow, type SpellbookWindowDeps } from '../src/ui/spellbook_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld } from '../src/world_api';

// A class whose kit has at least two abilities, so we can exercise known/locked.
const CLASS_ID = Object.values(CLASSES).find((c) => c.abilities.length >= 2)!.id as PlayerClass;
const KIT = CLASSES[CLASS_ID].abilities;

function known(abilityId: string, rank = 1): ResolvedAbility {
  return {
    def: { id: abilityId },
    rank,
    cost: 12,
    castTime: 0,
    cooldown: 6,
  } as unknown as ResolvedAbility;
}

function fakeWorld(over: { known?: ResolvedAbility[] } = {}): IWorld {
  return {
    known: over.known ?? [known(KIT[0])],
    cfg: { playerClass: CLASS_ID },
  } as unknown as IWorld;
}

function fakeDeps(overrides: Partial<SpellbookWindowDeps> = {}): SpellbookWindowDeps {
  const el = document.createElement('div');
  el.id = 'spellbook';
  el.className = 'window panel';
  document.body.appendChild(el);
  return {
    root: () => el,
    world: () => fakeWorld(),
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    hideTooltip: () => {},
    attachTooltip: () => {},
    abilitySummary: () => 'summary',
    abilityTooltip: () => '<div>tt</div>',
    barAbilityIds: () => [],
    abilityIdByBarSlot: () => [],
    hasFreeSlot: () => true,
    addToBar: () => true,
    removeFromBar: () => true,
    hasFormBars: () => false,
    resetFormBar: () => {},
    setDragAction: () => {},
    clearActionDropTargets: () => {},
    ...overrides,
  };
}

// jsdom lacks a DataTransfer; a minimal recording stub is enough for the payload.
function fakeDataTransfer(): DataTransfer {
  const store: Record<string, string> = {};
  return {
    effectAllowed: 'none',
    setData: (type: string, val: string) => {
      store[type] = val;
    },
    getData: (type: string) => store[type] ?? '',
  } as unknown as DataTransfer;
}

function dragRow(row: HTMLElement, type: 'dragstart' | 'dragend', dt: DataTransfer): void {
  const ev = new Event(type, { bubbles: true }) as Event & { dataTransfer: DataTransfer };
  ev.dataTransfer = dt;
  row.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('SpellbookWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, body, close', () => {
    const deps = fakeDeps();
    const w = new SpellbookWindow(deps);
    w.toggle();
    const root = deps.root();
    expect(root.classList.contains('window-frame')).toBe(false);
    expect(root.hasAttribute('role')).toBe(false);
    const frame = root.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('spellbook-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    expect(root.style.display).toBe('flex');
  });

  it('renders the class kit as .spell-list listitem rows inside the frame body', () => {
    const deps = fakeDeps();
    const w = new SpellbookWindow(deps);
    w.toggle();
    const list = deps.root().querySelector('.window-body .spell-list');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('role')).toBe('list');
    expect(deps.root().querySelectorAll('.spell-row').length).toBe(KIT.length);
  });

  it('reuses the frame on a re-render instead of rebuilding it cold', () => {
    const deps = fakeDeps();
    const w = new SpellbookWindow(deps);
    w.toggle();
    const firstBody = deps.root().querySelector('.window-body');
    w.render();
    expect(deps.root().querySelector('.window-body')).toBe(firstBody);
    expect(deps.root().querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('SpellbookWindow: move / resize / fit parity', () => {
  it('makes the titlebar a Hud drag handle, but never the close control', () => {
    const deps = fakeDeps();
    const w = new SpellbookWindow(deps);
    w.toggle();
    const root = deps.root();
    const titlebar = root.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = root.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, root)).toBe(true);
    expect(isWindowDragHandle(closeBtn, root)).toBe(false);
  });

  it('frames a bounded flex column: titlebar then a scrollable body then a footer', () => {
    const deps = fakeDeps({ hasFormBars: () => true });
    const w = new SpellbookWindow(deps);
    w.toggle();
    const frame = deps.root().querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body', 'window-footer']);
  });
});

describe('SpellbookWindow: drag-to-actionbar (the sacred flow, preserved EXACTLY)', () => {
  it('a dragstart on a known row sets the drag action and writes the hotbar MIME payload', () => {
    const setDragAction = vi.fn();
    const deps = fakeDeps({ setDragAction, world: () => fakeWorld({ known: [known(KIT[0])] }) });
    const w = new SpellbookWindow(deps);
    w.toggle();
    const row = deps.root().querySelector<HTMLElement>('.spell-row[draggable="true"]');
    expect(row).not.toBeNull();
    const dt = fakeDataTransfer();
    dragRow(row as HTMLElement, 'dragstart', dt);
    expect(setDragAction).toHaveBeenCalledWith({ type: 'ability', id: KIT[0] });
    expect(dt.getData(HOTBAR_ACTION_MIME)).toBe(
      encodeHotbarAction({ type: 'ability', id: KIT[0] }),
    );
    expect(dt.getData('text/plain')).toBe(KIT[0]);
    expect(dt.effectAllowed).toBe('move');
  });

  it('a dragend clears the drag action and the drop targets', () => {
    const setDragAction = vi.fn();
    const clearActionDropTargets = vi.fn();
    const deps = fakeDeps({
      setDragAction,
      clearActionDropTargets,
      world: () => fakeWorld({ known: [known(KIT[0])] }),
    });
    const w = new SpellbookWindow(deps);
    w.toggle();
    const row = deps
      .root()
      .querySelector<HTMLElement>('.spell-row[draggable="true"]') as HTMLElement;
    dragRow(row, 'dragend', fakeDataTransfer());
    expect(setDragAction).toHaveBeenLastCalledWith(null);
    expect(clearActionDropTargets).toHaveBeenCalled();
  });

  it('the +/- toggle routes through addToBar / removeFromBar', () => {
    const addToBar = vi.fn(() => true);
    const removeFromBar = vi.fn(() => true);
    const deps = fakeDeps({
      addToBar,
      removeFromBar,
      world: () => fakeWorld({ known: [known(KIT[0])] }),
      barAbilityIds: () => [],
    });
    const w = new SpellbookWindow(deps);
    w.toggle();
    const toggle = deps
      .root()
      .querySelector<HTMLButtonElement>('.spell-hotbar-toggle') as HTMLButtonElement;
    toggle.click();
    expect(addToBar).toHaveBeenCalledWith(KIT[0]);
  });
});

describe('SpellbookWindow: footer reset-bar + close', () => {
  it('puts the reset-bar action in the sticky footer only for form-bar classes', () => {
    const withBars = fakeDeps({ hasFormBars: () => true });
    const w1 = new SpellbookWindow(withBars);
    w1.toggle();
    expect(withBars.root().querySelector('.window-footer [data-reset-bar]')).not.toBeNull();

    const noBars = fakeDeps({ hasFormBars: () => false });
    const w2 = new SpellbookWindow(noBars);
    w2.toggle();
    expect(noBars.root().querySelector('[data-reset-bar]')).toBeNull();
  });

  it('routes the reset-bar action to resetFormBar', () => {
    const resetFormBar = vi.fn();
    const deps = fakeDeps({ hasFormBars: () => true, resetFormBar });
    const w = new SpellbookWindow(deps);
    w.toggle();
    deps.root().querySelector<HTMLButtonElement>('[data-reset-bar]')?.click();
    expect(resetFormBar).toHaveBeenCalled();
  });

  it('routes the frame close control to close() and restores opener focus', () => {
    const restoreFocus = vi.fn();
    const deps = fakeDeps({ restoreFocus });
    const w = new SpellbookWindow(deps);
    w.toggle();
    expect(w.isOpen).toBe(true);
    deps.root().querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(w.isOpen).toBe(false);
    expect(deps.root().style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalled();
  });
});

describe('SpellbookWindow: in-place hotbar refresh (per-frame, tickOpen)', () => {
  it('refreshHotbarControls updates the toggle aria-pressed + disabled from the bar', () => {
    let bar: string[] = [];
    const deps = fakeDeps({
      world: () => fakeWorld({ known: [known(KIT[0])] }),
      barAbilityIds: () => bar,
      hasFreeSlot: () => bar.length === 0,
    });
    const w = new SpellbookWindow(deps);
    w.toggle();
    const toggle = deps
      .root()
      .querySelector<HTMLButtonElement>('.spell-hotbar-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    bar = [KIT[0]];
    w.refreshHotbarControls();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});
