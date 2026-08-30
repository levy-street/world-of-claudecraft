// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IGNIVAR_RAID_ARENA_ID, IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING } from '../src/sim/varkhul_shared_pyre';
import { ensureLocaleLoaded, formatNumber, setLanguage } from '../src/ui/i18n';
import {
  RaidBossGuideWindow,
  raidBossGuideContextFallback,
} from '../src/ui/raid_boss_guide_window';

vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (_kind: string, id: string) => `mock:${id}`,
}));

describe('RaidBossGuideWindow', () => {
  let root: HTMLDivElement;
  let fallback: HTMLButtonElement;
  let closeOthers: ReturnType<typeof vi.fn<() => void>>;
  let restoreFocus: ReturnType<typeof vi.fn<(target: HTMLElement | null) => void>>;
  let attachTooltip: ReturnType<typeof vi.fn<(element: HTMLElement, html: () => string) => void>>;
  let hideTooltip: ReturnType<typeof vi.fn<() => void>>;
  let guide: RaidBossGuideWindow;

  beforeAll(async () => ensureLocaleLoaded('es'));

  beforeEach(() => {
    setLanguage('en');
    document.body.innerHTML =
      '<button id="stable-fallback">Character</button><div id="raid-boss-guide-window"></div>';
    const guideRoot = document.querySelector<HTMLDivElement>('#raid-boss-guide-window');
    const fallbackButton = document.querySelector<HTMLButtonElement>('#stable-fallback');
    if (!guideRoot || !fallbackButton) throw new Error('Raid boss guide fixture did not mount');
    root = guideRoot;
    fallback = fallbackButton;
    closeOthers = vi.fn<() => void>();
    restoreFocus = vi.fn<(target: HTMLElement | null) => void>((target) => target?.focus());
    attachTooltip = vi.fn<(element: HTMLElement, html: () => string) => void>();
    hideTooltip = vi.fn<() => void>();
    guide = new RaidBossGuideWindow({
      root: () => root,
      closeOthers,
      captureFocus: () =>
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null,
      restoreFocus,
      contextFallback: () => fallback,
      attachTooltip,
      hideTooltip,
    });
  });

  afterEach(() => setLanguage('en'));

  it('opens a phased Ignivar journal with boss navigation, difficulty, and portrait', () => {
    expect(guide.syncAvailability('some_other_room')).toBeNull();

    const button = guide.syncAvailability(IGNIVAR_RAID_ARENA_ID);
    expect(button).toBe(guide.button);
    expect(button?.textContent).toContain('Ignivar');
    button?.click();

    expect(closeOthers).toHaveBeenCalledOnce();
    expect(root.style.display).toBe('block');
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.querySelectorAll<HTMLButtonElement>('[data-boss]')).toHaveLength(2);
    expect(
      root.querySelector<HTMLButtonElement>('[data-boss="ignivar"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(root.querySelectorAll<HTMLButtonElement>('[data-difficulty]')).toHaveLength(2);
    expect(root.querySelector<HTMLImageElement>('.rbg-model-poster')?.src).toContain(
      '/ui/mobs/ignivar_herald_of_the_last_flame.webp',
    );
    const journal = root.querySelector<HTMLElement>('.rbg-journal');
    expect(journal?.tabIndex).toBe(0);
    expect(journal?.getAttribute('aria-label')).toBe('Boss Guide');
    expect(root.querySelectorAll('.rbg-phase')).toHaveLength(4);
    expect(root.querySelectorAll('.rbg-ability')).toHaveLength(9);
    expect(root.querySelectorAll('.rbg-ability-detail')).toHaveLength(0);
    expect(document.activeElement).toBe(root.querySelector('[data-boss="ignivar"]'));
  });

  it('never emits an aria-controls reference without its controlled detail', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();

    for (const control of root.querySelectorAll<HTMLElement>('[aria-controls]')) {
      const id = control.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      expect(root.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('participates in the graphics-preview context reset and restore lifecycle', () => {
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    const reset = hud.slice(
      hud.indexOf('resetGraphicsPreviewContexts(): void {'),
      hud.indexOf('restoreGraphicsPreviewContexts(): void {'),
    );
    const restore = hud.slice(
      hud.indexOf('restoreGraphicsPreviewContexts(): void {'),
      hud.indexOf('prewarmStaticUiAssets(): void {'),
    );

    expect(reset).toContain('this.raidBossGuideWindow.resetGraphicsPreviewContext();');
    expect(restore).toContain('this.raidBossGuideWindow.restoreGraphicsPreviewContext();');
  });

  it('scrolls the journal with the mouse wheel and dedicated keyboard navigation', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    const journal = root.querySelector<HTMLElement>('.rbg-journal');
    if (!journal) throw new Error('journal did not render');
    Object.defineProperties(journal, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    });

    const wheel = new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true });
    journal.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(journal.scrollTop).toBe(240);

    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    journal.dispatchEvent(end);

    expect(end.defaultPrevented).toBe(true);
    expect(journal.scrollTop).toBe(700);
  });

  it('releases the retained model host when the window close control is used', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();

    expect(root.querySelector('.rbg-model-viewer')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-close]')?.click();

    expect(root.style.display).toBe('none');
    expect(root.querySelector('.rbg-model-viewer')).toBeNull();
  });

  it('lets players browse both bosses and preserves a manual selection in the same room', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    root.querySelector<HTMLButtonElement>('[data-boss="varkhul"]')?.click();

    expect(root.textContent).toContain("Maker's Brand");
    expect(root.textContent).toContain("The Master's Assembly");
    expect(root.textContent).not.toContain('Worldfire');
    expect(root.querySelectorAll('.rbg-ability')).toHaveLength(11);

    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID);
    expect(
      root.querySelector<HTMLButtonElement>('[data-boss="varkhul"]')?.getAttribute('aria-pressed'),
    ).toBe('true');

    root.querySelector<HTMLButtonElement>('[data-difficulty="heroic"]')?.click();
    expect(root.textContent).toContain('Worldfire');
    expect(root.querySelectorAll('.rbg-ability')).toHaveLength(12);
  });

  it('formats phase thresholds and mechanic percentages for the active locale', () => {
    setLanguage('es');
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    const localizedTwenty = formatNumber(0.2, {
      style: 'percent',
      maximumFractionDigits: 0,
    });
    expect(root.textContent).toContain(localizedTwenty);

    root.querySelector<HTMLButtonElement>('[data-boss="varkhul"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-mechanic="shared-pyre"]')?.click();
    const localizedPenalty = formatNumber(VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING, {
      style: 'percent',
      maximumFractionDigits: 0,
    });
    expect(root.querySelector('[data-detail="shared-pyre"]')?.textContent).toContain(
      localizedPenalty,
    );
  });

  it('expands an ability inline and attaches its complete tooltip to the same control', () => {
    guide.syncAvailability(IGNIVAR_SECOND_WING_ID)?.click();
    const sharedPyre = root.querySelector<HTMLButtonElement>('[data-mechanic="shared-pyre"]');

    expect(sharedPyre?.getAttribute('aria-expanded')).toBe('false');
    sharedPyre?.click();
    const expandedSharedPyre = root.querySelector<HTMLButtonElement>(
      '[data-mechanic="shared-pyre"]',
    );
    const detail = root.querySelector<HTMLElement>('[data-detail="shared-pyre"]');
    expect(expandedSharedPyre?.getAttribute('aria-expanded')).toBe('true');
    expect(expandedSharedPyre?.getAttribute('aria-label')).toContain('All roles');
    expect(expandedSharedPyre?.getAttribute('aria-label')).toContain('Important');
    expect(detail?.textContent).toContain('4 players');
    expect(detail?.textContent).toContain('15%');
    expect(detail?.textContent).toContain('What to do');

    const tooltipCall = attachTooltip.mock.calls.find(
      ([element]) => element === expandedSharedPyre,
    );
    expect(tooltipCall?.[1]()).toContain('Shared Pyre');
    expect(tooltipCall?.[1]()).toContain('What to do');
  });

  it('switches room context only when the next boss actually changes', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    root.querySelector<HTMLButtonElement>('[data-boss="varkhul"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-mechanic="shared-pyre"]')?.click();

    guide.syncAvailability(IGNIVAR_SECOND_WING_ID);

    expect(
      root.querySelector<HTMLButtonElement>('[data-boss="varkhul"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(root.querySelector('[data-detail="shared-pyre"]')).not.toBeNull();
  });

  it('returns focus to a connected fallback when the current room loses its guide', () => {
    const button = guide.syncAvailability(IGNIVAR_SECOND_WING_ID);
    button?.click();
    expect(guide.syncAvailability(null)).toBeNull();
    button?.remove();

    expect(root.style.display).toBe('none');
    expect(hideTooltip).toHaveBeenCalled();
    expect(restoreFocus).toHaveBeenCalledWith(fallback);
    expect(document.activeElement).toBe(fallback);
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it('moves focus before a closed launcher disappears with the room context', () => {
    const button = guide.syncAvailability(IGNIVAR_SECOND_WING_ID);
    if (button) document.body.append(button);
    button?.focus();

    expect(guide.syncAvailability(null)).toBeNull();
    button?.remove();

    expect(restoreFocus).toHaveBeenCalledWith(fallback);
    expect(document.activeElement).toBe(fallback);
  });

  it('does not restore stale launcher focus after pointer activation', () => {
    const button = guide.syncAvailability(IGNIVAR_RAID_ARENA_ID);
    if (button) document.body.append(button);
    button?.focus();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(root.style.display).toBe('block');
    guide.close();

    expect(restoreFocus).toHaveBeenCalledWith(null);
    expect(document.activeElement).not.toBe(button);
  });

  it('relocalizes stable controls and restores focus to the same logical ability', () => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    const oldAbility = root.querySelector<HTMLButtonElement>('[data-mechanic="searing-torrent"]');
    oldAbility?.focus();

    setLanguage('es');
    guide.relocalize();

    const newAbility = root.querySelector<HTMLButtonElement>('[data-mechanic="searing-torrent"]');
    expect(guide.button.textContent).toContain('Guía');
    expect(root.textContent).toContain('Guía de jefes');
    expect(newAbility).not.toBe(oldAbility);
    expect(document.activeElement).toBe(newAbility);
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it.each([
    ['journal', '.rbg-journal'],
    ['model loader', '.rbg-model-load'],
  ])('preserves focus on the %s across a relocalized render', (_label, selector) => {
    guide.syncAvailability(IGNIVAR_RAID_ARENA_ID)?.click();
    const oldControl = root.querySelector<HTMLElement>(selector);
    oldControl?.focus();

    guide.relocalize();

    const newControl = root.querySelector<HTMLElement>(selector);
    expect(document.activeElement).toBe(newControl);
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it('selects the visible platform launcher as the contextual focus fallback', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="mm-char">Character</button><button id="mobile-more">More</button>',
    );
    expect(raidBossGuideContextFallback(document, false)?.id).toBe('mm-char');
    expect(raidBossGuideContextFallback(document, true)?.id).toBe('mobile-more');
  });
});
