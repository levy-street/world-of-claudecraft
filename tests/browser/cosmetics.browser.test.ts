// Real painter, shipped CSS, and account fixtures for the new cosmetics dialog.
// Before-change UI evidence: docs/screenshots/clue-character-panel/current-polish-keyboard-focus.png
// and docs/screenshots/clue-character-panel/current-polish-mobile-tabs.png.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ALL_MOUNT_SKIN_IDS, MOUNT_SKIN_IDS } from '../../src/sim/content/mount_skins';
import { CosmeticsWindow } from '../../src/ui/hud/cosmetics/cosmetics_window';
import { axeSeriousViolations, cleanup, formatViolations, host, stubDeps } from './_harness';

afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-touch');
});
function mountWindow() {
  const root = host('cosmetics-window');
  root.style.display = '';
  const world = {
    player: {
      templateId: 'warrior',
      mainhandItemId: 'worn_sword',
      skinCatalog: 'class',
      skin: 0,
      mountSkinId: null as string | null,
    },
    ownedMounts: () => [],
    accountCosmetics: {
      completedQuestIds: [],
      mountSkinIds: [...MOUNT_SKIN_IDS],
      collectibleMountSkinIds: ['valorsteed', 'grag_bear', 'stormfeather_griffin'],
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: {},
      mechChromaIds: ['amber_crimson'],
    },
    changeMountSkin: vi.fn((id: string | null) => {
      world.player.mountSkinId = id;
    }),
  };
  const win = new CosmeticsWindow(
    stubDeps({ root: () => root, world: () => world as never, captureFocus: () => null }),
  );
  win.open();
  return { root, world, win };
}
describe('cosmetics accessibility and interaction', () => {
  it.each([
    { width: 1920, height: 1080, mobile: false },
    { width: 1366, height: 768, mobile: false },
    { width: 390, height: 844, mobile: true },
    { width: 844, height: 390, mobile: true },
  ])('gives collection art and actions room at $width x $height', async (size) => {
    await page.viewport(size.width, size.height);
    if (size.mobile) document.body.classList.add('mobile-touch');
    const { root, win } = mountWindow();
    for (const tab of ['mounts', 'skins', 'mech'] as const) {
      win.open(tab);
      await document.fonts.ready;
      expect.soft(root.scrollWidth, tab).toBeLessThanOrEqual(root.clientWidth + 1);
      if (tab === 'mounts' && (size.width === 1366 || size.width === 390)) {
        root.querySelector<HTMLElement>('.cos-body')!.scrollTop = 0;
        await page.screenshot({
          path: `../../docs/screenshots/cosmetics-window/mounts-after-${size.mobile ? 'mobile' : 'desktop'}.png`,
        });
      }
      const cards = root.querySelectorAll<HTMLElement>('.cos-card');
      expect(cards.length).toBeGreaterThan(0);
      if (tab !== 'mech') expect(root.querySelectorAll('.cos-card img').length).toBeGreaterThan(0);
      for (const card of cards) {
        if (!size.mobile)
          expect.soft(card.getBoundingClientRect().width, tab).toBeGreaterThanOrEqual(250);
        const art = card.querySelector<HTMLImageElement>('img');
        if (art && tab !== 'mech') {
          expect.soft(art.getBoundingClientRect().height, `${tab} art`).toBeGreaterThanOrEqual(96);
          expect.soft(art.getBoundingClientRect().width, `${tab} art`).toBeGreaterThanOrEqual(96);
        }
      }
      const actions = root.querySelectorAll<HTMLButtonElement>('.cos-action, .cos-preview');
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        action.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = action.getBoundingClientRect();
        expect.soft(rect.height, tab).toBeGreaterThanOrEqual(40);
        expect.soft(rect.width, tab).toBeGreaterThanOrEqual(40);
        expect.soft(rect.left, tab).toBeGreaterThanOrEqual(0);
        expect.soft(rect.right, tab).toBeLessThanOrEqual(size.width + 1);
        expect.soft(rect.top, tab).toBeGreaterThanOrEqual(0);
        expect.soft(rect.bottom, tab).toBeLessThanOrEqual(size.height + 1);
      }
    }
  });
  it.each(['mounts', 'skins', 'mech'] as const)(
    '%s has a named dialog and no serious WCAG violations',
    async (tab) => {
      await page.viewport(1280, 900);
      const { root, win } = mountWindow();
      win.open(tab);
      expect(root.getAttribute('aria-label')).toBe('Cosmetics');
      expect(root.querySelectorAll('.cos-card').length).toBeGreaterThan(0);
      const violations = await axeSeriousViolations(root);
      expect(violations, formatViolations(violations)).toEqual([]);
    },
  );
  it('keeps keyboard focus on Wear/Take off through actions and a live refresh', async () => {
    await page.viewport(1280, 900);
    const { root, world, win } = mountWindow();
    const control = () =>
      root.querySelector<HTMLButtonElement>('.cos-action[data-id="mech_bird"]')!;
    control().focus();
    await userEvent.keyboard('{Enter}');
    expect(world.player.mountSkinId).toBe('mech_bird');
    expect(document.activeElement).toBe(control());
    expect(control().dataset.act).toBe('takeoff-mount');
    await page.screenshot({
      path: '../../docs/screenshots/cosmetics-window/mounts-after-keyboard-focus.png',
    });
    world.accountCosmetics.mountSkinIds = ['mech_bird'];
    win.refreshIfChanged();
    expect(document.activeElement).toBe(control());
    await userEvent.keyboard(' ');
    expect(world.player.mountSkinId).toBeNull();
    expect(document.activeElement).toBe(control());
    expect(control().dataset.act).toBe('wear-mount');
  });
  it('wears a skin held by an alternate character and removes the action after its last item is gone', async () => {
    await page.viewport(1280, 900);
    const { root, world, win } = mountWindow();
    expect(root.querySelectorAll('.cos-mount').length).toBe(ALL_MOUNT_SKIN_IDS.length);
    const wear = root.querySelector<HTMLButtonElement>(
      '[data-act="wear-mount"][data-id="grag_bear"]',
    )!;
    wear.scrollIntoView({ block: 'center', behavior: 'instant' });
    await userEvent.click(wear);
    expect(world.player.mountSkinId).toBe('grag_bear');
    expect(root.querySelector('[data-card="grag_bear"]')?.classList.contains('worn')).toBe(true);
    world.accountCosmetics.collectibleMountSkinIds = ['valorsteed'];
    world.player.mountSkinId = null;
    win.refreshIfChanged();
    expect(root.querySelector('[data-act="wear-mount"][data-id="grag_bear"]')).toBeNull();
    expect(root.querySelector('[data-act="takeoff-mount"][data-id="grag_bear"]')).toBeNull();
    expect(root.querySelector('[data-card="grag_bear"]')?.classList.contains('owned')).toBe(false);
  });

  it('makes every mount skin reachable with Wear and Take off on short mobile landscape', async () => {
    await page.viewport(844, 390);
    document.body.classList.add('mobile-touch');
    const { root, world } = mountWindow();
    const bounds = root.getBoundingClientRect();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(844);
    expect(bounds.bottom).toBeLessThanOrEqual(390);
    for (const tab of root.querySelectorAll<HTMLElement>('.cos-tab')) {
      expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      expect(tab.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({
      path: '../../docs/screenshots/cosmetics-window/mounts-after-mobile-landscape.png',
    });
    for (const id of [...MOUNT_SKIN_IDS, ...world.accountCosmetics.collectibleMountSkinIds]) {
      const button = root.querySelector<HTMLButtonElement>(
        `[data-act="wear-mount"][data-id="${id}"]`,
      )!;
      button.scrollIntoView({ block: 'center' });
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      button.click();
      expect(world.player.mountSkinId).toBe(id);
      root.querySelector<HTMLButtonElement>('[data-act="takeoff-mount"]')!.click();
      expect(world.player.mountSkinId).toBeNull();
    }
    // One wear plus one take-off per live skin.
    expect(world.changeMountSkin).toHaveBeenCalledTimes(
      (MOUNT_SKIN_IDS.length + world.accountCosmetics.collectibleMountSkinIds.length) * 2,
    );
  });
});
