import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { talentsFor } from '../../src/sim/content/talents';
import { ALL_CLASSES, type PlayerClass } from '../../src/sim/types';
import { STAT_DEFENSE, STAT_OFFENSE, STAT_TILES } from '../../src/ui/char_stats_view';
import { CharWindow } from '../../src/ui/char_window';
import { formatNumber, type TranslationKey, t } from '../../src/ui/i18n';
import { InspectWindow } from '../../src/ui/inspect_window';
import { ItemDragState } from '../../src/ui/item_drag_state';
import { statCellHtml } from '../../src/ui/stat_tooltip_view';
import { cleanup, host, stubDeps } from './_harness';

// Real painter and style barrel, with populated stat cells and the actual Arms
// mastery prose. Empty dependency fragments would hide the rail overflow.
function mountCharacter(playerClass: PlayerClass = 'warrior', talentSpec = 'arms'): HTMLElement {
  const root = host('char-window');
  root.style.display = 'none';
  const win = new CharWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({
          cfg: { playerClass },
          player: { name: 'Aurelia', level: 60, skin: 0 },
          equipment: {},
          talentSpec,
          honor: 1200,
          archetypeTitle: null,
          hobbyCraft: null,
          professionsState: { skills: [] },
        }) as never,
      statCellHtml: (stat) =>
        statCellHtml(
          {
            stat,
            isPrimary: STAT_TILES.includes(stat),
            statValue: 125,
            effects: [],
            minorForClass: false,
            baseChanceNote: false,
            dpsApproxNote: false,
            sources: [],
          },
          { t: (key, params) => t(key as TranslationKey, params), fmt: formatNumber },
          { colon: false },
        ),
      statTooltipHtml: () => '',
      slotName: (slot) => slot,
      captureFocus: () => null,
      dragState: new ItemDragState(),
    }),
  );
  win.toggle();
  return root;
}

function element(root: HTMLElement, selector: string): HTMLElement {
  const result = root.querySelector<HTMLElement>(selector);
  expect(result, selector).not.toBeNull();
  return result as HTMLElement;
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  for (const key of ['--app-vw', '--app-vh', '--ui-scale']) {
    document.documentElement.style.removeProperty(key);
  }
});

describe('character sheet desktop geometry', () => {
  const longestMastery = ALL_CLASSES.flatMap((playerClass) =>
    (talentsFor(playerClass)?.specs ?? []).map((spec) => ({ playerClass, spec })),
  ).sort((a, b) => b.spec.mastery.description.length - a.spec.mastery.description.length)[0];
  if (!longestMastery) throw new Error('Expected an authored talent specialization');
  it.each([
    { width: 1920, height: 1080, playerClass: 'warrior' as PlayerClass, talentSpec: 'arms' },
    { width: 1366, height: 768, playerClass: 'warrior' as PlayerClass, talentSpec: 'arms' },
    {
      width: 1366,
      height: 768,
      playerClass: longestMastery.playerClass,
      talentSpec: longestMastery.spec.id,
    },
  ])('shows $playerClass/$talentSpec without scrolling at $width x $height', async (size) => {
    await page.viewport(size.width, size.height);
    document.body.className = 'game-active';
    document.documentElement.style.setProperty('--app-vw', `${size.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${size.height}px`);
    document.documentElement.style.setProperty('--ui-scale', '1');
    const root = mountCharacter(size.playerClass, size.talentSpec);
    await document.fonts.ready;
    const rail = element(root, '.char-stats-rail');
    const footer = element(root, '.char-footer');
    const bounds = root.getBoundingClientRect();

    for (const region of [root, rail, element(root, '.char-sheet')]) {
      expect
        .soft(region.scrollHeight, `${region.className} vertical overflow`)
        .toBeLessThanOrEqual(region.clientHeight + 1);
      expect
        .soft(region.scrollWidth, `${region.className} horizontal overflow`)
        .toBeLessThanOrEqual(region.clientWidth + 1);
    }
    expect.soft(bounds.top).toBeGreaterThanOrEqual(0);
    expect.soft(bounds.bottom).toBeLessThanOrEqual(size.height + 1);
    const footerBounds = footer.getBoundingClientRect();
    for (const stat of [...STAT_TILES, ...STAT_OFFENSE, ...STAT_DEFENSE]) {
      const cell = element(root, `[data-stat="${stat}"]`).getBoundingClientRect();
      expect.soft(cell.height, stat).toBeGreaterThan(0);
      expect.soft(cell.top, stat).toBeGreaterThanOrEqual(bounds.top);
      expect.soft(cell.bottom, stat).toBeLessThanOrEqual(footerBounds.top + 1);
    }
    for (const selector of ['.char-spec-identity', '.char-spec-mastery']) {
      const rect = element(root, selector).getBoundingClientRect();
      expect.soft(rect.height, selector).toBeGreaterThan(0);
      expect
        .soft(rect.bottom, selector)
        .toBeLessThanOrEqual(rail.getBoundingClientRect().bottom + 1);
      expect.soft(rect.bottom, selector).toBeLessThanOrEqual(footerBounds.top + 1);
    }
    expect.soft(footerBounds.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
    expect(root.querySelectorAll('.char-footer [role="tab"]')).toHaveLength(5);
    const slots = Array.from(
      root.querySelectorAll<HTMLElement>('#equip-row-weapons [data-equip-slot]'),
      (slot) => slot.dataset.equipSlot,
    );
    expect(slots).toEqual(['mainhand', 'offhand']);
    expect(element(root, '#equip-slot-offhand').getBoundingClientRect().bottom).toBeLessThanOrEqual(
      footerBounds.top,
    );
  });
});

describe('mobile paperdoll geometry', () => {
  it.each([
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])('keeps Character and Inspect sockets reachable at $width x $height', async (size) => {
    await page.viewport(size.width, size.height);
    document.body.className = 'mobile-touch game-active';
    document.documentElement.style.setProperty('--app-vw', `${size.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${size.height}px`);
    document.documentElement.style.setProperty('--ui-scale', '1');
    const character = mountCharacter();
    await document.fonts.ready;
    assertReachableSlots(character, '.equip-slot', size.width, size.height);
    character.remove();

    const inspect = host('inspect-window');
    new InspectWindow(
      stubDeps({
        root: () => inspect,
        slotName: (slot) => slot,
        captureFocus: () => null,
        showDevBadges: () => false,
      }),
    ).openInspect(
      {
        templateId: 'warrior',
        name: 'Aurelia',
        level: 60,
        equippedItems: {},
        equippedInstances: {},
      },
      0,
    );
    expect(
      Array.from(
        inspect.querySelectorAll('#inspect-equip-weapons .slot-name'),
        (el) => el.textContent,
      ),
    ).toEqual(['mainhand', 'offhand']);
    assertReachableSlots(inspect, '.equip-slot', size.width, size.height);
  });
});

function assertReachableSlots(
  root: HTMLElement,
  selector: string,
  width: number,
  height: number,
): void {
  expect
    .soft(root.scrollWidth, `${root.id} horizontal overflow`)
    .toBeLessThanOrEqual(root.clientWidth + 1);
  const slots = root.querySelectorAll<HTMLElement>(selector);
  expect(slots).toHaveLength(12);
  for (const slot of slots) {
    slot.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const bounds = root.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    const label = `${root.id} ${slot.querySelector('.slot-name')?.textContent}`;
    expect.soft(rect.width, label).toBeGreaterThan(0);
    expect.soft(rect.height, label).toBeGreaterThan(0);
    expect.soft(rect.left, label).toBeGreaterThanOrEqual(Math.max(0, bounds.left) - 1);
    expect.soft(rect.right, label).toBeLessThanOrEqual(Math.min(width, bounds.right) + 1);
    expect.soft(rect.top, label).toBeGreaterThanOrEqual(Math.max(0, bounds.top) - 1);
    expect.soft(rect.bottom, label).toBeLessThanOrEqual(Math.min(height, bounds.bottom) + 1);
    for (const child of slot.querySelectorAll<HTMLElement>('.item-icon, .slot-name, .slot-item')) {
      const childRect = child.getBoundingClientRect();
      expect
        .soft(childRect.left, `${label} ${child.className}`)
        .toBeGreaterThanOrEqual(Math.max(0, bounds.left) - 1);
      expect
        .soft(childRect.right, `${label} ${child.className}`)
        .toBeLessThanOrEqual(Math.min(width, bounds.right) + 1);
    }
  }
}
