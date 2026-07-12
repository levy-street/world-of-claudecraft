// @vitest-environment jsdom
//
// Behavioral guards for the character window's AAA frame adoption (the pure
// paperdoll decisions are unit-tested in char_view.test.ts; the source-level
// a11y/token pins live in char_window.test.ts). These render the real DOM
// through the shared window-frame builder and assert: the frame chrome is
// stamped on an INNER mount (the shared #char-window root stays pristine so its
// id-scoped clamp/resize/mobile rules keep matching), the two-pane paperdoll +
// stats grammar renders in the body, the equip/unequip flow still dispatches
// through the injected deps, the stat cells still wire their focusable lazy
// tooltip, the titlebar is a Hud-recognized drag handle (never the close, never
// under mobile-touch), and the close routes through the frame to close().

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipSlot } from '../src/sim/types';
import { CharWindow, type CharWindowDeps } from '../src/ui/char_window';
import type { StatId } from '../src/ui/stat_tooltip';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld } from '../src/world_api';

// The paperdoll's empty-slot icon and the identity portrait resolve procedural
// icons through a 2D canvas, which jsdom lacks; stub the icon + portrait modules
// so the DOM-render assertions can run without a real canvas (the icon pixels are
// out of this suite's scope; the equip/stat wiring is what it guards).
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:image/png;base64,stub',
  QUALITY_COLOR: {},
}));
vi.mock('../src/ui/portrait_chip', () => ({
  portraitChipHtml: () => '<span class="portrait-chip"></span>',
  hydratePortraits: () => {},
}));

function fakeWorld(overrides: Partial<Record<string, unknown>> = {}): IWorld {
  return {
    player: { level: 12, name: 'Yumi', skin: 0 },
    cfg: { playerClass: 'warrior' },
    equipment: { helmet: 'cryptbone_helm', mainhand: 'worn_sword' } as Partial<
      Record<EquipSlot, string>
    >,
    archetypeTitle: null,
    hobbyCraft: null,
    professionsState: { skills: [] },
    ...overrides,
  } as unknown as IWorld;
}

function charEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'char-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return el;
}

function fakeDeps(
  el: HTMLElement,
  world: IWorld,
  overrides: Partial<CharWindowDeps> = {},
): CharWindowDeps {
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    root: () => el,
    world: () => world,
    closeOthers: () => {},
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    slotName: (slot: EquipSlot) => slot,
    statCellHtml: (stat: StatId) => `<div class="stat-cell" data-stat="${stat}">${stat}</div>`,
    statTooltipHtml: (stat: StatId) => `breakdown:${stat}`,
    talentSummaryHtml: () => '<div class="char-progression tal-summary"></div>',
    progressionHtml: () => '<div class="char-progression cp-prog"></div>',
    unequip: () => {},
    beginUnequipDrag: () => {},
    endUnequipDrag: () => {},
    renderPreview: () => {},
    renderSkinPicker: () => {},
    openPlayerCard: () => {},
    openPrestige: () => {},
    ...overrides,
  };
}

afterEach(() => {
  document.body.classList.remove('mobile-touch');
  document.body.innerHTML = '';
});

describe('CharWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, body, close, and NO footer', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    // The shared root never carries builder state; the frame lives on an inner mount.
    expect(el.classList.contains('window-frame')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('char-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The character sheet is a footer-less window (no transactional action row).
    expect(frame?.querySelector('.window-footer')).toBeNull();
  });

  it('titles the frame "Character" (the reused action label)', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    expect(el.querySelector('.window-title')?.textContent).toBe('Character');
  });

  it('keeps the shared root a pristine .window.panel (no builder class / role / aria)', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    expect(el.hasAttribute('aria-modal')).toBe(false);
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const el = charEl();
    const win = new CharWindow(fakeDeps(el, fakeWorld()));
    win.render();
    const firstBody = el.querySelector('.window-body');
    win.render();
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });

  it('frames a pinned titlebar then a scrollable body (footer-less flex column)', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body']);
    expect(frame?.querySelectorAll('.window-body').length).toBe(1);
  });
});

describe('CharWindow: move / resize / fit parity', () => {
  it('makes the frame titlebar a Hud drag handle, but never the close button', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD, and recognizes it again without it', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('CharWindow: paperdoll + stats body grammar', () => {
  it('renders the identity strip, the two-pane paperdoll, and the stat grid in the frame body', () => {
    const el = charEl();
    new CharWindow(fakeDeps(el, fakeWorld())).render();
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    expect(body.querySelector('.char-identity')).not.toBeNull();
    expect(body.querySelector('.char-identity .char-title-text')?.textContent).toContain('Yumi');
    expect(body.querySelector('.paperdoll #equip-col-left')).not.toBeNull();
    expect(body.querySelector('.paperdoll #equip-col-right')).not.toBeNull();
    expect(body.querySelector('.char-model-panel #char-model-preview')).not.toBeNull();
    // Two columns of equip slots, driven by the pure char_view core.
    expect(el.querySelectorAll('#equip-col-left .equip-slot').length).toBe(5);
    expect(el.querySelectorAll('#equip-col-right .equip-slot').length).toBe(6);
    expect(body.querySelectorAll('.char-stats [data-stat]').length).toBeGreaterThan(0);
  });

  it('escapes the user-controlled player name through esc() (no live injection)', () => {
    const el = charEl();
    const world = fakeWorld({
      player: { level: 3, name: '<img src=x onerror=alert(1)>', skin: 0 },
    });
    new CharWindow(fakeDeps(el, world)).render();
    const identity = el.querySelector<HTMLElement>('.char-identity') as HTMLElement;
    // The portrait chip is mocked to a span, so any <img> here would be an injection.
    expect(identity.querySelector('img')).toBeNull();
    expect(identity.querySelector('.char-title-text')?.innerHTML).toContain('&lt;img');
  });

  it('wires each stat cell to its lazily-resolved breakdown tooltip', () => {
    const el = charEl();
    const attachTooltip = vi.fn();
    new CharWindow(fakeDeps(el, fakeWorld(), { attachTooltip })).render();
    // One attach per stat cell; the html factory is lazy (resolved on show).
    const statCells = el.querySelectorAll('.char-stats [data-stat]').length;
    const statAttachCalls = attachTooltip.mock.calls.filter((c) =>
      (c[0] as HTMLElement).matches?.('[data-stat]'),
    );
    expect(statAttachCalls.length).toBe(statCells);
    const factory = statAttachCalls[0][1] as () => string;
    expect(factory()).toContain('breakdown:');
  });
});

describe('CharWindow: equip / unequip flow (sacred)', () => {
  it('routes the corner-x unequip through deps.unequip and keeps focus on the rebuilt slot', () => {
    const el = charEl();
    const unequip = vi.fn();
    const restoreFocus = vi.fn();
    const win = new CharWindow(fakeDeps(el, fakeWorld(), { unequip, restoreFocus }));
    win.render();
    const helmetRow = el.querySelector<HTMLElement>('#equip-slot-helmet') as HTMLElement;
    expect(helmetRow).not.toBeNull();
    const x = helmetRow.querySelector<HTMLButtonElement>('.equip-unequip-btn') as HTMLButtonElement;
    expect(x).not.toBeNull();
    x.click();
    expect(unequip).toHaveBeenCalledWith('helmet');
    // keyboard/touch x hands focus back to the rebuilt slot row.
    expect(restoreFocus).toHaveBeenCalled();
  });

  it('unequips on right-click (contextmenu) without demanding focus return', () => {
    const el = charEl();
    const unequip = vi.fn();
    new CharWindow(fakeDeps(el, fakeWorld(), { unequip })).render();
    const mainhand = el.querySelector<HTMLElement>('#equip-slot-mainhand') as HTMLElement;
    mainhand.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(unequip).toHaveBeenCalledWith('mainhand');
  });

  it('begins a drag-to-unequip through deps.beginUnequipDrag', () => {
    const el = charEl();
    const beginUnequipDrag = vi.fn();
    new CharWindow(fakeDeps(el, fakeWorld(), { beginUnequipDrag })).render();
    const helmetRow = el.querySelector<HTMLElement>('#equip-slot-helmet') as HTMLElement;
    expect(helmetRow.draggable).toBe(true);
    helmetRow.dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(beginUnequipDrag).toHaveBeenCalledWith('helmet');
  });
});

describe('CharWindow: close routing', () => {
  it('routes the frame close control through close(): hides the root and restores focus', () => {
    const el = charEl();
    const restoreFocus = vi.fn();
    const win = new CharWindow(fakeDeps(el, fakeWorld(), { restoreFocus }));
    // Open (the module's own display:block, checked by hud.ts) so close() acts.
    el.style.display = 'block';
    win.render();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});
