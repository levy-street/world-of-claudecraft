// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { ITEMS, MOBS } from '../src/sim/data';
import { isHarvestableCorpse } from '../src/sim/professions/gathering';
import type { Entity } from '../src/sim/types';
import { LootWindowController } from '../src/ui/hud/loot/loot_window_controller';
import type { IWorld } from '../src/world_api';

const itemIds = Object.keys(ITEMS);
// isHarvestableCorpse, not a tag COUNT (#2513): a template can carry tags whose
// every family is unmapped (fen_troll: claw, tusk), and the sim refuses a
// harvest there. A count-based selector could pick such a template under a
// future content reorder and silently invert every harvest case in this file.
const harvestMob = Object.values(MOBS).find((mob) => isHarvestableCorpse(mob.componentTags));
if (itemIds.length < 2) throw new Error('loot item fixtures not found');
if (!harvestMob?.componentTags?.length) throw new Error('harvestable mob fixture not found');
const harvestMobId = harvestMob.id;
const harvestMobTags = harvestMob.componentTags;

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
      visibleCopper: 0,
      hasLoot: false,
      canOpen: false,
    }));
    const test = harness([mob], corpseAvailability);

    test.controller.openCorpse(12, 0, 0);

    expect(corpseAvailability).toHaveBeenCalledWith(mob);
    expect(test.closeTransient).not.toHaveBeenCalled();
    expect(test.element.style.display).not.toBe('block');
  });

  it("hides a stranger's owner-locked copper and shared items, listing only my personal drop", () => {
    // Tapped by 9, owner-lock still counting: viewer 7 has no shared rights, so
    // the coin row and the plain slot must not be advertised (the take would
    // deny them); only the personal slot naming 7 renders.
    const mob = entity(15, {
      kind: 'mob',
      templateId: harvestMobId,
      tappedById: 9,
      lootFfaTimer: 60,
      harvestClaimedBy: 9,
      loot: {
        copper: 25,
        items: [
          { itemId: itemIds[0], count: 1 },
          { itemId: itemIds[1], count: 1, personalFor: [7] },
        ],
      },
    });
    const test = harness([mob]);

    test.controller.openCorpse(15, 400, 300);

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).not.toContain('money:25');
    expect(test.element.innerHTML).not.toContain(`data-item="${itemIds[0]}"`);
    expect(test.element.innerHTML).toContain(`data-item="${itemIds[1]}"`);
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

  it('opens for the coin but draws NO harvest picker on an all-unmapped corpse (#2513)', () => {
    // The gate the whole "no reason line is owed" argument rests on, pinned
    // instead of asserted in prose. fen_troll carries claw and tusk, neither
    // mapped, so `harvestable` is false and openCorpse must skip the picker; it
    // must still open, because the corpse holds copper the player can take.
    // Driven through the REAL corpseLootAvailability against a real template, so
    // loosening `if (harvestable && componentTags)` back to `if (componentTags)`
    // reds here rather than passing with every other gate green.
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    const troll = entity(20, {
      kind: 'mob',
      templateId: 'fen_troll',
      loot: { copper: 50, items: [] },
    });
    const test = harness([troll], (entry) => corpseLootAvailability(entry, 7));

    test.controller.openCorpse(20, 0, 0);

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('money:50');
    expect(test.element.querySelector('.corpse-harvest')).toBeNull();
    expect(test.element.querySelector('.corpse-harvest-btn')).toBeNull();
    expect(test.element.querySelectorAll('.corpse-harvest-check')).toHaveLength(0);
    // No dead control anywhere: nothing disabled, and nothing to click.
    expect(test.element.querySelectorAll('button[disabled]')).toHaveLength(0);
    // ...and no sentence promising a harvest half this corpse does not have. The
    // unified-press hint says the interact key "loots and harvests"; on a
    // loot-only corpse that is simply false, so it is not rendered.
    expect(test.element.querySelector('.town-focus-hint')).toBeNull();
    // The discriminator on the identical rig: a MIXED template carrying the same
    // unmapped `tusk` beside two mapped families still draws its picker, so this
    // is the predicate and not the controller refusing every corpse.
    expect(MOBS.wild_boar.componentTags).toEqual(['hide', 'tusk', 'meat']);
    const boar = entity(21, {
      kind: 'mob',
      templateId: 'wild_boar',
      loot: { copper: 50, items: [] },
    });
    const boarTest = harness([boar], (entry) => corpseLootAvailability(entry, 7));
    boarTest.controller.openCorpse(21, 0, 0);
    expect(boarTest.element.querySelector('.corpse-harvest')).not.toBeNull();
    expect(boarTest.element.querySelectorAll('.corpse-harvest-check')).toHaveLength(3);
    // The hint's other arm, on the same rig: where a harvest really is on offer
    // the sentence is true and still rendered, so the gate is not a blanket
    // removal.
    expect(boarTest.element.querySelector('.town-focus-hint')?.textContent).toBe(
      'The interact key loots and harvests in one press, using your town focus.',
    );
  });

  it('drops the unified-press hint on an untagged corpse too, where it was also false', () => {
    // The 101 shipped templates with no componentTags carried the same false
    // sentence long before #2513; fen_troll joining that set is what made it
    // worth fixing rather than widening. warlock_imp is the reference case.
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    const imp = entity(24, {
      kind: 'mob',
      templateId: 'warlock_imp',
      loot: { copper: 12, items: [] },
    });
    const test = harness([imp], (entry) => corpseLootAvailability(entry, 7));

    test.controller.openCorpse(24, 0, 0);

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('money:12');
    expect(test.element.querySelector('.town-focus-hint')).toBeNull();
    expect(test.element.querySelector('.corpse-harvest')).toBeNull();
  });

  it('does not open at all for an all-unmapped corpse with nothing left to loot (#2513)', () => {
    // Once the coin is gone there is no reason to open: `canOpen` is
    // `hasLoot || harvestable` and both are now false, so the popup stays shut
    // instead of presenting an empty body with a dead Harvest button.
    const troll = entity(22, { kind: 'mob', templateId: 'fen_troll', loot: null });
    const test = harness([troll], (entry) => corpseLootAvailability(entry, 7));

    test.controller.openCorpse(22, 0, 0);

    expect(test.element.style.display).not.toBe('block');
    expect(test.closeTransient).not.toHaveBeenCalled();
    // The discriminator: a depleted corpse WITH a mapped family still opens for
    // its harvest half, which is the behavior this must not have broken.
    const wolf = entity(23, { kind: 'mob', templateId: harvestMobId, loot: null });
    const wolfTest = harness([wolf], (entry) => corpseLootAvailability(entry, 7));
    wolfTest.controller.openCorpse(23, 0, 0);
    expect(wolfTest.element.style.display).toBe('block');
    expect(wolfTest.element.querySelector('.corpse-harvest')).not.toBeNull();
  });

  it('pre-checks the town-focus components in the harvest picker', () => {
    const tags = harvestMobTags;
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
    const tags = harvestMobTags;
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
