// @vitest-environment happy-dom

// The boss guide detached from the party frames: the room's guide button lives
// in its own movable, scalable frame (#boss-guide-launcher, an "Unlock
// interface" row), and the side menu's #mm-bossguide opens the journal anywhere,
// with a picker over every guide the game ships.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_SOURCES } from '../src/ui/boss_journal/registry';
import { setLanguage } from '../src/ui/i18n';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
import { MICRO_MENU_LAUNCHERS } from '../src/ui/micro_menu_state_view';
import { RaidBossGuideModelController } from '../src/ui/raid_boss_guide_model_controller';
import { LAUNCHER_EMPTY_CLASS, RaidBossGuideWindow } from '../src/ui/raid_boss_guide_window';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (_kind: string, id: string) => `mock:${id}`,
}));

const SANCTUM = 'gravewyrm_sanctum';
const CRYPT = 'hollow_crypt';

describe('boss guide launcher and side-menu browsing', () => {
  let root: HTMLDivElement;
  let host: HTMLDivElement;
  let menu: HTMLButtonElement;
  let guide: RaidBossGuideWindow;

  beforeEach(() => {
    setLanguage('en');
    document.body.innerHTML =
      '<button id="mm-bossguide">Boss Guide</button>' +
      '<div id="boss-guide-launcher" class="is-empty"></div>' +
      '<div id="raid-boss-guide-window"></div>';
    root = document.querySelector<HTMLDivElement>('#raid-boss-guide-window') as HTMLDivElement;
    host = document.querySelector<HTMLDivElement>('#boss-guide-launcher') as HTMLDivElement;
    menu = document.querySelector<HTMLButtonElement>('#mm-bossguide') as HTMLButtonElement;
    const controller = new RaidBossGuideModelController(
      document,
      async () => {
        throw new Error('no viewer in tests');
      },
      () => false,
    );
    vi.spyOn(controller, 'mount').mockImplementation(() => undefined);
    guide = new RaidBossGuideWindow(
      {
        root: () => root,
        closeOthers: vi.fn(),
        captureFocus: () => document.activeElement as HTMLElement | null,
        restoreFocus: (target) => target?.focus(),
        contextFallback: () => null,
        attachTooltip: vi.fn(),
        hideTooltip: vi.fn(),
        dungeonRun: () => null,
        launcherHost: () => host,
      },
      document,
      controller,
    );
  });

  it('seats the room button in its own frame and hides the frame outside a guided room', () => {
    expect(guide.syncAvailability(SANCTUM)).toBe(guide.button);
    expect(guide.button.parentElement).toBe(host);
    expect(host.classList.contains(LAUNCHER_EMPTY_CLASS)).toBe(false);
    expect(guide.button.textContent).toBe('Boss Guide: Gravewyrm Sanctum');

    expect(guide.syncAvailability(null)).toBeNull();
    expect(host.classList.contains(LAUNCHER_EMPTY_CLASS)).toBe(true);
    // The node stays seated so the mover chrome and keyboard focus never churn.
    expect(guide.button.parentElement).toBe(host);
  });

  it('opens the raid guide from the side menu outside any instance', () => {
    guide.syncAvailability(null);
    menu.focus();
    guide.openBrowser();
    expect(root.style.display).toBe('block');
    const sources = [...root.querySelectorAll<HTMLButtonElement>('[data-source]')];
    expect(sources.map((tab) => tab.dataset.source)).toEqual(
      JOURNAL_SOURCES.map((source) => source.id),
    );
    expect(sources[0].textContent).toBe('Raids');
    expect(sources[0].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.rbg-source-nav')?.getAttribute('aria-label')).toBe('Guides');
    expect(root.querySelector('.rbg-boss-nav')?.getAttribute('aria-label')).toBe('Raid bosses');

    // A second press on the menu closes it and returns focus to the menu button.
    guide.openBrowser();
    expect(root.style.display).toBe('none');
    expect(document.activeElement).toBe(menu);
  });

  it('switches guides from the picker and reopens the last guide read', () => {
    guide.syncAvailability(null);
    guide.openBrowser();
    root.querySelector<HTMLButtonElement>(`[data-source="${CRYPT}"]`)?.click();
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Hollow Crypt');
    expect(root.querySelector(`[data-source="${CRYPT}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    const secondBoss = root.querySelectorAll<HTMLButtonElement>('[data-boss]')[1];
    secondBoss.click();
    const bossKey = secondBoss.dataset.boss;

    guide.close();
    guide.openBrowser();
    expect(root.querySelector(`[data-source="${CRYPT}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(root.querySelector('[data-boss][aria-pressed="true"]')?.getAttribute('data-boss')).toBe(
      bossKey,
    );
  });

  it("opens the room's own guide from the side menu inside a guided instance", () => {
    guide.syncAvailability(SANCTUM);
    guide.openBrowser();
    expect(root.querySelector(`[data-source="${SANCTUM}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Browsing another guide from the picker keeps the room's button live.
    root.querySelector<HTMLButtonElement>(`[data-source="${CRYPT}"]`)?.click();
    expect(guide.syncAvailability(SANCTUM)).toBe(guide.button);
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Hollow Crypt');
  });

  it('keeps a menu-opened guide open when the player leaves the room', () => {
    guide.syncAvailability(SANCTUM);
    menu.focus();
    guide.openBrowser();
    expect(root.querySelector(`[data-source="${SANCTUM}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Picking the room's guide again from the picker keeps it a menu window.
    root.querySelector<HTMLButtonElement>(`[data-source="${CRYPT}"]`)?.click();
    root.querySelector<HTMLButtonElement>(`[data-source="${SANCTUM}"]`)?.click();
    guide.syncAvailability(null);
    expect(root.style.display).toBe('block');
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Gravewyrm Sanctum');
    guide.close();
    expect(document.activeElement).toBe(menu);
  });

  it('touches the launcher DOM only when availability flips', () => {
    guide.syncAvailability(SANCTUM);
    const toggle = vi.spyOn(host.classList, 'toggle');
    guide.syncAvailability(SANCTUM);
    guide.syncAvailability(CRYPT);
    expect(toggle).not.toHaveBeenCalled();
    guide.syncAvailability(null);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('registers the launcher as a movable, scalable frame and rings the menu button', () => {
    const spec = HUD_FRAME_SPECS.find((row) => row.id === 'bossGuideButton');
    expect(spec).toMatchObject({
      elementId: 'boss-guide-launcher',
      storageKey: 'woc_hud_frame_boss_guide_button',
      detachToUiRoot: false,
    });
    expect(spec?.scalable).not.toBe(false);
    expect(MICRO_MENU_LAUNCHERS).toContainEqual({
      selector: '#mm-bossguide',
      windowId: 'raid-boss-guide-window',
    });
    for (const page of ['index.html', 'play.html']) {
      const html = readFileSync(resolve(process.cwd(), page), 'utf8');
      expect(html, page).toContain('<div id="boss-guide-launcher" class="is-empty"></div>');
      expect(html, page).toMatch(/<div id="side-buttons-col-[ab]"[\s\S]*id="mm-bossguide"/);
    }
  });
});
