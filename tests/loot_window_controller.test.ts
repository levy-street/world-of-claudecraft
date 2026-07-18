// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { ITEMS, MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { LootWindowController } from '../src/ui/hud/loot/loot_window_controller';
import type { IWorld } from '../src/world_api';

const itemIds = Object.keys(ITEMS);
const harvestMobId = Object.values(MOBS).find((mob) => mob.componentTags?.length)?.id;
if (itemIds.length < 2) throw new Error('loot item fixtures not found');
if (!harvestMobId) throw new Error('harvestable mob fixture not found');

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

  it('renders only authoritative personal corpse loot and delegates Take All', () => {
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
    expect(test.attachTooltip).toHaveBeenCalledTimes(1);

    const takeAll = test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)');
    expect(takeAll?.title).toBeTruthy();
    expect(takeAll?.title).not.toBe(
      test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.title,
    );
    takeAll?.click();

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

  it('owns delve chest state and collection while empty rewards stay closed', () => {
    const chest = entity(20, { kind: 'object', templateId: 'delve_chest' });
    const test = harness([chest]);

    test.controller.openChest(20, []);
    expect(test.closeTransient).not.toHaveBeenCalled();
    expect(test.controller.hasOpenChest).toBe(false);

    test.controller.openChest(20, [{ itemId: itemIds[0], count: 1 }]);
    expect(test.controller.hasOpenChest).toBe(true);
    expect(test.centerPopup).toHaveBeenCalledWith(test.element);
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
