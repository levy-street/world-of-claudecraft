// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { ITEMS, MOBS } from '../src/sim/data';
import type { Entity, ItemInstancePayload } from '../src/sim/types';
import { LootWindowController } from '../src/ui/hud/loot/loot_window_controller';
import type { IWorld } from '../src/world_api';

const itemIds = Object.keys(ITEMS);
const harvestMobId = Object.values(MOBS).find((mob) => mob.componentTags?.length)?.id;
if (itemIds.length < 2) throw new Error('loot item fixtures not found');
if (!harvestMobId) throw new Error('harvestable mob fixture not found');

const legendaryInstance: ItemInstancePayload = {
  procedural: {
    version: 1,
    uid: 'pi1:test:corpse',
    baseId: 'iron_broadsword',
    itemLevel: 20,
    rarity: 'legendary',
    affixes: [],
    legendaryPowerId: 'greyjaws_edge',
    powerRevision: 1,
    legendaryRolls: { potencyPct: 20 },
    generatedName: { baseId: 'iron_broadsword' },
    seed: 11,
  },
};

function entity(
  id: number,
  overrides: Partial<Entity> & Pick<Entity, 'kind' | 'templateId'>,
): Entity {
  return {
    id,
    name: `Entity ${id}`,
    pos: { x: 0, y: 0, z: 0 },
    lootable: true,
    harvestClaimedBy: null,
    loot: null,
    ...overrides,
  } as Entity;
}

function harness(
  initialEntities: Entity[] = [],
  corpseAvailability = (mob: Entity) => corpseLootAvailability(mob, 7),
  townFocus: Record<string, number> = {},
) {
  const element = document.createElement('div');
  element.id = 'loot-window';
  document.body.appendChild(element);
  const entities = new Map(initialEntities.map((entry) => [entry.id, entry]));
  const lootCorpse = vi.fn();
  const harvestCorpse = vi.fn();
  const collectDelveChestLoot = vi.fn();
  const world = {
    entities,
    playerId: 7,
    player: { pos: { x: 0, y: 0, z: 0 } },
    townFocus,
    lootCorpse,
    harvestCorpse,
    collectDelveChestLoot,
  } as unknown as IWorld;
  const closeTransient = vi.fn();
  const hideTooltip = vi.fn();
  const attachTooltip = vi.fn();
  const centerPopup = vi.fn();
  const placePopup = vi.fn();
  const controller = new LootWindowController({
    element,
    document,
    world: () => world,
    corpseAvailability,
    closeTransient,
    hideTooltip,
    entityName: (entry) => entry.name,
    money: (copper) => `money:${copper}`,
    coinIconUrl: () => 'coin.png',
    itemIcon: (item) => `<span data-icon="${item.id}"></span>`,
    itemTooltip: (item) => `tooltip:${item.id}`,
    attachTooltip,
    centerPopup,
    placePopup,
  });
  return {
    controller,
    element,
    entities,
    world,
    lootCorpse,
    harvestCorpse,
    collectDelveChestLoot,
    closeTransient,
    hideTooltip,
    attachTooltip,
    centerPopup,
    placePopup,
  };
}

describe('LootWindowController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('renders a keyboard-inspectable legendary corpse row with a local rune anchor', () => {
    const mob = entity(9, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        items: [{ itemId: 'iron_broadsword', count: 1, instance: legendaryInstance }],
      },
    });
    const test = harness([mob]);

    test.controller.openCorpse(9, 400, 300);

    const row = test.element.querySelector<HTMLElement>('[data-loot-index="0"]');
    expect(row?.classList.contains('q-legendary')).toBe(true);
    expect(row?.dataset.proceduralRarity).toBe('legendary');
    expect(row?.style.getPropertyValue('--loot-slot-quality')).toBe('#ff8000');
    expect(row?.tabIndex).toBe(0);
    expect(row?.getAttribute('aria-label')).toBe(
      "Greyjaw's Edge, Legendary, item level 20, quantity 1",
    );
    expect(row?.querySelector('.loot-icon-wrap [data-icon="iron_broadsword"]')).not.toBeNull();
    const rune = row?.querySelector('.loot-icon-wrap .loot-power-rune');
    expect(rune?.getAttribute('aria-hidden')).toBe('true');
    expect(rune?.getAttribute('focusable')).toBe('false');
  });

  it('renders only authoritative personal corpse loot and delegates Take Loot', () => {
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 25,
        items: [
          { itemId: itemIds[0], count: 2, personalFor: [7] },
          { itemId: itemIds[1], count: 1, personalFor: [8] },
        ],
      },
    });
    const test = harness([mob]);

    test.controller.openCorpse(10, 400, 300);

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain(`data-item="${itemIds[0]}"`);
    expect(test.element.innerHTML).not.toContain(`data-item="${itemIds[1]}"`);
    expect(test.element.innerHTML).toContain('money:25');
    expect(test.placePopup).toHaveBeenCalledWith(test.element, 285, 270, 260, 280, 10, 10);
    // One visible item row plus the two buttons, all on the shared tooltip
    // idiom (hover, mobile long-press, keyboard focus).
    expect(test.attachTooltip).toHaveBeenCalledTimes(3);

    const takeLoot = test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)');
    const harvest = test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    // Legibility fix: the corpse arm's button is "Take Loot" (the
    // old "Take All" label promised the harvest too); native title attributes
    // stay empty so touch players are never without the tooltip.
    expect(takeLoot?.textContent).toBe('Take Loot');
    expect(takeLoot?.title).toBe('');
    expect(harvest?.title).toBe('');
    const tooltipFor = (el: Element | null | undefined) =>
      test.attachTooltip.mock.calls.find(([target]) => target === el)?.[1]();
    expect(tooltipFor(takeLoot)).toBe(
      'Takes the coins and dropped items. Does not use up the harvest.',
    );
    expect(tooltipFor(harvest)).toBe(
      'Gathers the checked components. Each corpse can be harvested once, first come. Does not take the loot.',
    );
    expect(test.element.querySelector('.town-focus-hint')?.textContent).toBe(
      'The interact key loots and harvests in one press, using your town focus.',
    );
    takeLoot?.click();

    expect(test.lootCorpse).toHaveBeenCalledWith(10);
    expect(test.element.style.display).toBe('none');
    expect(test.hideTooltip).toHaveBeenCalledTimes(1);
  });

  it('uses the shared corpse availability gate before opening', () => {
    const mob = entity(12, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: null,
    });
    const corpseAvailability = vi.fn(() => ({
      componentTags: undefined,
      harvestable: false,
      visibleItems: [],
      hasLoot: false,
      canOpen: false,
    }));
    const test = harness([mob], corpseAvailability);

    test.controller.openCorpse(12, 0, 0);

    expect(corpseAvailability).toHaveBeenCalledWith(mob);
    expect(test.closeTransient).not.toHaveBeenCalled();
    expect(test.element.style.display).not.toBe('block');
  });

  it('passes the selected harvest components through the IWorld seam', () => {
    const mob = entity(11, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: null,
    });
    const test = harness([mob]);
    test.controller.openCorpse(11, 0, 0);
    const boxes = test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    boxes[0].checked = true;

    test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();

    expect(test.harvestCorpse).toHaveBeenCalledWith(11, [boxes[0].value]);
    expect(test.element.style.display).toBe('none');
  });

  it('pre-checks the town-focus components in the harvest picker', () => {
    const tags = Object.values(MOBS).find((mob) => mob.componentTags?.length)?.componentTags;
    if (!tags) throw new Error('harvest component fixtures not found');
    expect(tags.length).toBeGreaterThanOrEqual(2); // a strict focused subset must be expressible
    const mob = entity(13, { kind: 'mob', templateId: harvestMobId, loot: null });
    const test = harness([mob], (entry) => corpseLootAvailability(entry, 7), { [tags[0]]: 5 });

    test.controller.openCorpse(13, 0, 0);

    const boxes = [...test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
    expect(boxes.map((box) => [box.value, box.checked])).toEqual(
      tags.map((tag) => [tag, tag === tags[0]]),
    );
  });

  it('deselecting every pre-checked box still submits an explicit empty pick (spread)', () => {
    const tags = Object.values(MOBS).find((mob) => mob.componentTags?.length)?.componentTags;
    if (!tags) throw new Error('harvest component fixtures not found');
    const mob = entity(14, { kind: 'mob', templateId: harvestMobId, loot: null });
    const test = harness([mob], (entry) => corpseLootAvailability(entry, 7), { [tags[0]]: 5 });

    test.controller.openCorpse(14, 0, 0);
    for (const box of test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')) {
      box.checked = false;
    }
    test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();

    expect(test.harvestCorpse).toHaveBeenCalledWith(14, []);
  });

  it('owns delve chest state and collection while empty rewards stay closed', () => {
    const chest = entity(20, { kind: 'object', templateId: 'delve_chest' });
    const test = harness([chest]);

    test.controller.openChest(20, []);
    expect(test.closeTransient).not.toHaveBeenCalled();
    expect(test.controller.hasOpenChest).toBe(false);

    test.controller.openChest(20, [{ itemId: itemIds[0], count: 1 }]);
    expect(test.controller.hasOpenChest).toBe(true);
    expect(test.centerPopup).toHaveBeenCalledWith(test.element);
    // The delve-chest arm keeps "Take All": there is no harvest half here, so
    // "all" stays accurate (only the corpse arm was renamed to Take Loot).
    expect(test.element.querySelector<HTMLButtonElement>('.btn')?.textContent).toBe('Take All');
    test.element.querySelector<HTMLButtonElement>('.btn')?.click();

    expect(test.collectDelveChestLoot).toHaveBeenCalledWith(20);
    expect(test.controller.hasOpenChest).toBe(false);
    expect(test.element.style.display).toBe('none');
  });

  it('closes corpse and chest popups when their authoritative entity is invalid', () => {
    const mob = entity(30, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: { copper: 1, items: [] },
    });
    const chest = entity(31, { kind: 'object', templateId: 'delve_chest' });
    const test = harness([mob, chest]);

    test.controller.openCorpse(30, 0, 0);
    mob.lootable = false;
    test.controller.updateProximity();
    expect(test.element.style.display).toBe('none');

    test.controller.openChest(31, [{ itemId: itemIds[0], count: 1 }]);
    test.entities.delete(31);
    test.controller.updateProximity();
    expect(test.element.style.display).toBe('none');
    expect(test.controller.hasOpenChest).toBe(false);
  });

  it('centers corpse loot on touch layouts instead of using pointer geometry', () => {
    document.body.classList.add('mobile-touch');
    const mob = entity(40, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: { copper: 1, items: [] },
    });
    const test = harness([mob]);
    document.body.classList.add('mobile-touch');

    test.controller.openCorpse(40, 400, 300);

    expect(test.centerPopup).toHaveBeenCalledWith(test.element);
    expect(test.placePopup).not.toHaveBeenCalled();
  });
});
