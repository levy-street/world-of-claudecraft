// @vitest-environment happy-dom
// The Esc menu's button list, driven straight through its seam. The Unlock
// Interface row is an ACTION that repaints in place from the seam's answer (the
// Frames tab's row, mirrored), so nothing else pins that a press reaches the
// seam, that the label follows the answer rather than an assumed flip, and
// that the press never leaks into the window's routing. The routing rows pin
// the decorations that moved here from the window painter with the list.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

import { audio } from '../src/game/audio';
import { t } from '../src/ui/i18n';
import {
  buildOptionsMenuList,
  type OptionsMainMenuDeps,
} from '../src/ui/options_main_menu_controller';
import { buildOptionsMenu, type OptionsMenuEntry } from '../src/ui/options_view';

const DESKTOP_MENU = {
  bugReportAvailable: true,
  interfaceUnlockAvailable: true,
  interfaceUnlocked: false,
};

function seam(toggle: () => boolean) {
  const dispatch = vi.fn();
  const toggleInterfaceUnlock = vi.fn(toggle);
  const deps: OptionsMainMenuDeps = { toggleInterfaceUnlock, dispatch };
  return { deps, dispatch, toggleInterfaceUnlock };
}

function buttons(list: HTMLElement): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>('.opt-btn')];
}

function entryFor(entries: OptionsMenuEntry[], kind: string, view?: string): number {
  return entries.findIndex(
    (e) =>
      e.action.kind === kind &&
      (view === undefined || ('view' in e.action && e.action.view === view)),
  );
}

describe('buildOptionsMenuList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(audio.click).mockClear();
  });

  it('paints one plate per entry in entry order, the Unlock Interface row first', () => {
    const entries = buildOptionsMenu(DESKTOP_MENU);
    const { deps } = seam(() => false);
    const list = buildOptionsMenuList(entries, deps);
    expect(list.className).toBe('opt-list');
    const plates = buttons(list);
    expect(plates).toHaveLength(entries.length);
    // The label is each plate's first text node (the bug-report row appends
    // its status span after it).
    expect(plates.map((b) => b.firstChild?.textContent)).toEqual(entries.map((e) => t(e.labelKey)));
    expect(plates[0].textContent).toBe(t('hudChrome.interfaceUnlock.unlock'));
    for (const b of plates) expect(b.className.startsWith('btn ui-btn opt-btn')).toBe(true);
    // The label-free hook the capture rigs click by (the list's order shifts by
    // host, so an index never identifies a row): the sub-view id for a routing
    // row, the action kind otherwise.
    expect(plates.map((b) => b.dataset.menuAction)).toEqual(
      entries.map((e) => (e.action.kind === 'goto' ? e.action.view : e.action.kind)),
    );
    expect(plates[0].dataset.menuAction).toBe('interfaceUnlock');
    expect(
      list.querySelector('.opt-btn[data-menu-action="interface"]')?.firstChild?.textContent,
    ).toBe(t('hud.options.interface'));
  });

  it('the Unlock Interface row toggles the seam and relabels from its answer, never routing', () => {
    let unlocked = false;
    // A refusing seam (the mobile backstop) answers false: the row must follow
    // the answer, so it never claims the interface is loose when it is not.
    const { deps, dispatch, toggleInterfaceUnlock } = seam(() => unlocked);
    const list = buildOptionsMenuList(buildOptionsMenu(DESKTOP_MENU), deps);
    const [unlock] = buttons(list);
    expect(unlock.classList.contains('ui-btn--on')).toBe(false);
    expect(unlock.hasAttribute('aria-pressed'), 'the label states the next action').toBe(false);

    unlock.click();
    expect(toggleInterfaceUnlock, 'the press reached the seam').toHaveBeenCalledTimes(1);
    expect(audio.click, 'with the shared press sound').toHaveBeenCalledTimes(1);
    expect(dispatch, 'and never the window routing').not.toHaveBeenCalled();
    expect(unlock.classList.contains('ui-btn--on')).toBe(false);
    expect(unlock.textContent).toBe(t('hudChrome.interfaceUnlock.unlock'));

    unlocked = true;
    unlock.click();
    expect(toggleInterfaceUnlock).toHaveBeenCalledTimes(2);
    expect(unlock.classList.contains('ui-btn--on'), 'the row repainted from the answer').toBe(true);
    expect(unlock.textContent).toBe(t('hudChrome.interfaceUnlock.lock'));

    unlocked = false;
    unlock.click();
    expect(unlock.classList.contains('ui-btn--on')).toBe(false);
    expect(unlock.textContent).toBe(t('hudChrome.interfaceUnlock.unlock'));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('paints the establishing state from the entry the core built, before any press', () => {
    // Reopening Esc mid-arrangement: the window builds the entry from the seam,
    // so the plate reads Lock Interface from the first paint. The seam itself is
    // not consulted until a press (one source per moment, never two).
    const { deps, toggleInterfaceUnlock } = seam(() => true);
    const entries = buildOptionsMenu({ ...DESKTOP_MENU, interfaceUnlocked: true });
    const [unlock] = buttons(buildOptionsMenuList(entries, deps));
    expect(unlock.textContent).toBe(t('hudChrome.interfaceUnlock.lock'));
    expect(unlock.classList.contains('ui-btn--on')).toBe(true);
    expect(toggleInterfaceUnlock).not.toHaveBeenCalled();
  });

  it('routes every other press back to the window with its own action', () => {
    const entries = buildOptionsMenu(DESKTOP_MENU);
    const { deps, dispatch, toggleInterfaceUnlock } = seam(() => false);
    const plates = buttons(buildOptionsMenuList(entries, deps));
    const routed = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.action.kind !== 'interfaceUnlock');
    expect(routed.length).toBe(entries.length - 1);
    for (const { entry, index } of routed) {
      dispatch.mockClear();
      plates[index].click();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(entry.action);
    }
    expect(audio.click, 'one press sound per routed press').toHaveBeenCalledTimes(routed.length);
    expect(toggleInterfaceUnlock).not.toHaveBeenCalled();
  });

  it('keeps the routing rows decorated: close, logout, the wiki chevron, the bug-report status', () => {
    const entries = buildOptionsMenu(DESKTOP_MENU);
    const { deps } = seam(() => false);
    const plates = buttons(buildOptionsMenuList(entries, deps));

    const close = plates[entryFor(entries, 'close')];
    expect(close.classList.contains('ui-btn--red')).toBe(true);
    expect(close.classList.contains('ui-btn--lg')).toBe(true);

    const logout = plates[entryFor(entries, 'logout')];
    expect(logout.classList.contains('opt-btn-hostile')).toBe(true);

    const wiki = plates[entryFor(entries, 'wiki')];
    const chevron = wiki.querySelector('.opt-btn-chevron');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.querySelector('svg')).not.toBeNull();

    const bug = plates[entryFor(entries, 'goto', 'bugreport')];
    const status = bug.querySelector('.opt-btn-status');
    expect(status?.textContent).toBe(t('hudChrome.bugReport.online'));
    expect(status?.getAttribute('aria-hidden')).toBe('true');
    expect(bug.getAttribute('aria-label')).toBe(
      `${t('hudChrome.bugReport.menuButton')}: ${t('hudChrome.bugReport.online')}`,
    );

    // The unlock row carries none of the routing decorations.
    const [unlock] = plates;
    expect(unlock.querySelector('.opt-btn-chevron, .opt-btn-status')).toBeNull();
    expect(unlock.classList.contains('opt-btn-hostile')).toBe(false);
    expect(unlock.classList.contains('ui-btn--red')).toBe(false);
  });
});
