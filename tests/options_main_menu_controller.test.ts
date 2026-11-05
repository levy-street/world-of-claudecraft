// @vitest-environment happy-dom
// The Esc menu's button list, driven straight through its seam. The Unlock
// Interface row is an ACTION that repaints in place from the seam's answer (the
// Frames tab's row, mirrored), so nothing else pins that a press reaches the
// seam, that the label follows the answer rather than an assumed flip, and
// that the press never leaks into the window's routing. The routing rows pin
// the decorations that moved here from the window painter with the list.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => {
  const music = { enabled: true, setEnabled: vi.fn((on: boolean) => (music.enabled = on)) };
  return { music };
});

import { audio } from '../src/game/audio';
import { music } from '../src/game/music';
import { attachGameMenuHooks } from '../src/ui/game_menu_hooks';
import { t } from '../src/ui/i18n';
import {
  buildOptionsMenuList,
  currentQuickState,
  type OptionsMainMenuDeps,
  openQuickLink,
  runQuickToggle,
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

function unlockPlate(list: HTMLElement): HTMLButtonElement {
  const plate = list.querySelector<HTMLButtonElement>(
    '.opt-btn[data-menu-action="interfaceUnlock"]',
  );
  if (!plate) throw new Error('no Unlock Interface plate');
  return plate;
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

  it('paints one plate per entry in entry order, Settings first and Unlock Interface next', () => {
    const entries = buildOptionsMenu(DESKTOP_MENU);
    const { deps } = seam(() => false);
    const list = buildOptionsMenuList(entries, deps);
    expect(list.className).toBe('opt-list');
    const plates = buttons(list);
    expect(plates).toHaveLength(entries.length);
    // The label is each plate's first text node (the bug-report row appends
    // its status span after it).
    expect(plates.map((b) => b.firstChild?.textContent)).toEqual(entries.map((e) => t(e.labelKey)));
    expect(plates[0].firstChild?.textContent).toBe(t('hudChrome.options.settings'));
    expect(plates[1].textContent).toBe(t('hudChrome.interfaceUnlock.unlock'));
    for (const b of plates) expect(b.className.startsWith('btn ui-btn opt-btn')).toBe(true);
    // The label-free hook the capture rigs click by (the list's order shifts by
    // host, so an index never identifies a row): the sub-view id for a routing
    // row, the action kind otherwise.
    expect(plates.map((b) => b.dataset.menuAction)).toEqual(
      entries.map((e) => (e.action.kind === 'goto' ? e.action.view : e.action.kind)),
    );
    expect(plates[0].dataset.menuAction).toBe('settings');
    expect(plates[1].dataset.menuAction).toBe('interfaceUnlock');
    expect(list.querySelector('.opt-btn[data-menu-action="wiki"]')?.firstChild?.textContent).toBe(
      t('hudChrome.options.helpWiki'),
    );
  });

  it('the Unlock Interface row toggles the seam and relabels from its answer, never routing', () => {
    let unlocked = false;
    // A refusing seam (the mobile backstop) answers false: the row must follow
    // the answer, so it never claims the interface is loose when it is not.
    const { deps, dispatch, toggleInterfaceUnlock } = seam(() => unlocked);
    const list = buildOptionsMenuList(buildOptionsMenu(DESKTOP_MENU), deps);
    const unlock = unlockPlate(list);
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
    const unlock = unlockPlate(buildOptionsMenuList(entries, deps));
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

    for (const kind of ['wiki', 'settings']) {
      const chevron = plates[entryFor(entries, kind)].querySelector('.opt-btn-chevron');
      expect(chevron?.getAttribute('aria-hidden')).toBe('true');
      expect(chevron?.querySelector('svg')).not.toBeNull();
    }

    const bug = plates[entryFor(entries, 'goto', 'bugreport')];
    const status = bug.querySelector('.opt-btn-status');
    expect(status?.textContent).toBe(t('hudChrome.bugReport.online'));
    expect(status?.getAttribute('aria-hidden')).toBe('true');
    expect(bug.getAttribute('aria-label')).toBe(
      `${t('hudChrome.bugReport.menuButton')}: ${t('hudChrome.bugReport.online')}`,
    );

    // The unlock row carries none of the routing decorations.
    const unlock = plates[entryFor(entries, 'interfaceUnlock')];
    expect(unlock.querySelector('.opt-btn-chevron, .opt-btn-status')).toBeNull();
    expect(unlock.classList.contains('opt-btn-hostile')).toBe(false);
    expect(unlock.classList.contains('ui-btn--red')).toBe(false);
  });
});

// The quick toggles and links that left the mobile More tray (issue #1653,
// audit 3.7): painted as one group ahead of Return to Game, each running the
// SAME action the tray ran through the attached game-menu hooks.
describe('the Game Menu quick group', () => {
  const QUICK = {
    nameplates: true,
    music: true,
    haptics: false,
    discord: true,
    donate: true,
    steamWishlist: true,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.mocked(audio.click).mockClear();
  });

  it('groups the quick rows in one .opt-quick block between Log Out and Return to Game', () => {
    const entries = buildOptionsMenu({ ...DESKTOP_MENU, quick: QUICK });
    const list = buildOptionsMenuList(entries, seam(() => false).deps);
    const group = list.querySelector('.opt-quick');
    expect(group).not.toBeNull();
    expect([...(group?.children ?? [])].map((b) => (b as HTMLElement).dataset.menuAction)).toEqual([
      'nameplates',
      'music',
      'haptics',
      'discord',
      'donate',
      'steamWishlist',
    ]);
    const top = [...list.children] as HTMLElement[];
    expect(top.at(-2)).toBe(group);
    expect(top.at(-3)?.dataset.menuAction).toBe('logout');
    expect(top.at(-1)?.dataset.menuAction).toBe('close');
  });

  it('paints each toggle state accessibly and repaints from the seam answer, never routing', () => {
    const entries = buildOptionsMenu({ ...DESKTOP_MENU, quick: QUICK });
    let answer = false;
    const toggleQuick = vi.fn(() => answer);
    const dispatch = vi.fn();
    const list = buildOptionsMenuList(entries, {
      toggleInterfaceUnlock: () => false,
      dispatch,
      toggleQuick,
    });
    const plate = (id: string) =>
      list.querySelector<HTMLButtonElement>(
        `.opt-btn[data-menu-action="${id}"]`,
      ) as HTMLButtonElement;
    const nameplates = plate('nameplates');
    expect(nameplates.getAttribute('aria-pressed')).toBe('true');
    expect(nameplates.querySelector('.opt-btn-status')?.textContent).toBe(t('hud.options.on'));
    expect(plate('haptics').getAttribute('aria-pressed')).toBe('false');
    expect(plate('haptics').querySelector('.opt-btn-status')?.textContent).toBe(
      t('hud.options.off'),
    );
    // The visible label stays the setting's name (first text node).
    expect(nameplates.firstChild?.textContent).toBe(t('hudChrome.options.nameplates'));

    nameplates.click();
    expect(toggleQuick).toHaveBeenCalledWith('nameplates');
    expect(nameplates.getAttribute('aria-pressed')).toBe('false');
    expect(nameplates.classList.contains('ui-btn--on')).toBe(false);
    answer = true;
    nameplates.click();
    expect(nameplates.getAttribute('aria-pressed')).toBe('true');
    expect(nameplates.classList.contains('ui-btn--on')).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(audio.click).toHaveBeenCalledTimes(2);
  });

  it('opens each link through the seam; the wishlist row carries the shared suppression class', () => {
    const entries = buildOptionsMenu({ ...DESKTOP_MENU, quick: QUICK });
    const openLink = vi.fn();
    const dispatch = vi.fn();
    const list = buildOptionsMenuList(entries, {
      toggleInterfaceUnlock: () => false,
      dispatch,
      openLink,
    });
    for (const id of ['discord', 'donate', 'steamWishlist']) {
      list.querySelector<HTMLButtonElement>(`.opt-btn[data-menu-action="${id}"]`)?.click();
      expect(openLink).toHaveBeenLastCalledWith(id);
    }
    expect(dispatch).not.toHaveBeenCalled();
    const steam = list.querySelector('.opt-btn[data-menu-action="steamWishlist"]');
    expect(steam?.classList.contains('steam-wishlist')).toBe(true);
    expect(steam?.getAttribute('aria-label')).toBe(t('hudChrome.steam.wishlistAria'));
  });

  it('runs the SAME tray actions through the attached hooks', () => {
    const renderer = { showNameplates: true };
    const haptics = {
      touchActive: true,
      hapticsEnabled: true,
      toggleHaptics: vi.fn(() => false),
    };
    const discord = vi.fn();
    attachGameMenuHooks(renderer, haptics, discord);
    expect(runQuickToggle('nameplates')).toBe(false);
    expect(renderer.showNameplates).toBe(false);
    music.enabled = true;
    expect(runQuickToggle('music')).toBe(false);
    expect(music.setEnabled).toHaveBeenCalledWith(false);
    expect(runQuickToggle('haptics')).toBe(false);
    expect(haptics.toggleHaptics).toHaveBeenCalledOnce();
    openQuickLink('discord');
    expect(discord).toHaveBeenCalledOnce();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openQuickLink('donate');
    expect(open).toHaveBeenLastCalledWith(
      'https://ko-fi.com/worldofclaudecraft',
      '_blank',
      'noopener,noreferrer',
    );
    openQuickLink('steamWishlist');
    expect(String(open.mock.lastCall?.[0])).toContain('store.steampowered.com/app/');
    open.mockRestore();
  });

  it('gates per host: Haptics only on touch, Donate never on native, the wishlist per its policy', () => {
    const haptics = { touchActive: false, hapticsEnabled: true, toggleHaptics: () => true };
    attachGameMenuHooks({ showNameplates: true }, haptics, null);
    const desktop = currentQuickState();
    expect(desktop?.haptics).toBeNull();
    expect(desktop?.discord).toBe(false);
    expect(desktop?.donate).toBe(true);
    expect(desktop?.steamWishlist).toBe(true);

    attachGameMenuHooks({ showNameplates: true }, { ...haptics, touchActive: true }, vi.fn());
    document.body.classList.add('native-app');
    const native = currentQuickState();
    expect(native?.haptics).toBe(true);
    expect(native?.discord).toBe(true);
    expect(native?.donate).toBe(false);
    expect(native?.steamWishlist).toBe(false);

    document.body.className = 'steam-build';
    const steam = currentQuickState();
    expect(steam?.donate).toBe(true);
    expect(steam?.steamWishlist).toBe(false);
  });
});
