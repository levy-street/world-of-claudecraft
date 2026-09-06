// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The unknown-id row renders the shared fallback icon. The helper itself
// now survives a canvas-less host (it ships a blank pixel), so this stub is
// for determinism, not survival: the ghost test asserts a stable stub URL
// instead of whichever arm the environment happens to take. File-wide, so
// any future test here asserting a REAL icon URL must un-mock first.
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (kind: string, id: string) => `stub:${kind}:${id}`,
}));

// A locale-switch probe: `t()` is the real resolver with an optional suffix the
// relocalize cases flip, so a rebuild that re-resolves its text is observable
// without loading a second locale. Empty (byte-identical to the real `t`) for
// every other case; reset in beforeEach.
const i18nProbe = vi.hoisted(() => ({ suffix: '' }));
vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/i18n')>();
  return {
    ...actual,
    t: (key: Parameters<typeof actual.t>[0], values?: Parameters<typeof actual.t>[1]) =>
      actual.t(key, values) + i18nProbe.suffix,
  };
});

import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { ITEMS, MOBS } from '../src/sim/data';
import { isHarvestableCorpse } from '../src/sim/professions/gathering';
import type { Entity } from '../src/sim/types';
import { LootWindowController } from '../src/ui/hud/loot/loot_window_controller';
import type { IWorld } from '../src/world_api';
import {
  UNMAPPED_FAMILY,
  UNMAPPED_FAMILY_2,
  withRetaggedTemplates,
} from './helpers/unmapped_family';

const itemIds = Object.keys(ITEMS);
// isHarvestableCorpse, not a tag COUNT (#2513): a template can carry tags whose
// every family is unmapped (the retagged fixture below), and the sim refuses a
// harvest there. A count-based selector could pick such a template under a
// future content reorder and silently invert every harvest case in this file.
const harvestMob = Object.values(MOBS).find((mob) => isHarvestableCorpse(mob.componentTags));
if (itemIds.length < 2) throw new Error('loot item fixtures not found');
if (!harvestMob?.componentTags?.length) throw new Error('harvestable mob fixture not found');
const harvestMobId = harvestMob.id;
const harvestMobTags = harvestMob.componentTags;

// No shipped template is all-unmapped since #2905 wired claw and tusk (that
// retired fen_troll, the old all-unmapped fixture here), and no shipped
// template is MIXED since Masterwrought Phase 11m wired gills and horn (that
// retired sethrael_palecoil, the old mixed fixture here), so the #2513 cases
// below drive real templates retagged with the synthetic never-mapped
// families (tests/helpers/unmapped_family.ts) for the duration of a callback:
// the corpus's one shared retag idiom, withRetaggedTemplates from that same
// helper. warlock_imp and warlock_voidwalker carry no tags of their own
// (warlock_imp is this file's untagged fixture elsewhere), so retagging them
// borrows no other case's premise (the helper throws if that ever changes),
// and the mutation is always restored in a `finally`.
const UNMAPPED_TEMPLATE_ID = 'warlock_imp';
const UNMAPPED_TEMPLATE_TAGS = [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2];
const MIXED_TEMPLATE_ID = 'warlock_voidwalker';
const MIXED_TEMPLATE_TAGS = ['hide', 'claw', UNMAPPED_FAMILY];
function withUnmappedTemplate<T>(body: () => T): T {
  return withRetaggedTemplates({ [UNMAPPED_TEMPLATE_ID]: UNMAPPED_TEMPLATE_TAGS }, body);
}

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
    player: { pos: { x: 0, y: 0, z: 0 }, dead: false },
    townFocus,
    lootCorpse,
    harvestCorpse,
    collectDelveChestLoot,
  } as unknown as IWorld;
  const closeTransient = vi.fn();
  const hideTooltip = vi.fn();
  const showError = vi.fn();
  const attachTooltip = vi.fn();
  const centerPopup = vi.fn();
  const placePopup = vi.fn();
  // The bind-on-pickup confirm: accept immediately by default so the existing
  // Take Loot flows stay one-click in tests; assertions on the warning itself
  // inspect the mock's calls.
  const confirm = vi.fn(
    (_title: string, _body: string, _ok: string, _cancel: string, onOk: () => void) => onOk(),
  );
  // The shared window-focus bridge shape (Hud.windowFocus): capture records
  // the opener and installs the trap, restore releases it and returns focus.
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.appendChild(opener);
  const captureFocus = vi.fn(() => opener);
  const restoreFocus = vi.fn();
  const onVisibilityChange = vi.fn();
  const controller = new LootWindowController({
    element,
    document,
    world: () => world,
    corpseAvailability,
    closeTransient,
    hideTooltip,
    showError,
    entityName: (entry) => entry.name,
    money: (copper) => `money:${copper}`,
    coinIconUrl: () => 'coin.png',
    itemIcon: (item) => `<span data-icon="${item.id}"></span>`,
    itemTooltip: (item) => `tooltip:${item.id}`,
    attachTooltip,
    confirm,
    centerPopup,
    placePopup,
    captureFocus,
    restoreFocus,
    onVisibilityChange,
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
    showError,
    attachTooltip,
    confirm,
    centerPopup,
    placePopup,
    opener,
    captureFocus,
    restoreFocus,
    onVisibilityChange,
  };
}

// Intentional gathering PR1: the corpse popup is a real dialog. It registers
// the shared focus trap through the injected bridge, marks its root, lands
// keyboard focus on Close on a FRESH open, and never runs an action on open.
// Re-opening the SAME body (the Professions entry pressed twice, a second
// click on the corpse) only refreshes, keeping the player's checkbox picks and
// focus; opening ANOTHER body is a fresh choice.
describe('LootWindowController: focus trap and re-entry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  const harvestOnly = (id: number, x = 0) =>
    entity(id, { kind: 'mob', templateId: harvestMobId, pos: { x, y: 0, z: 0 } });

  it('marks the dialog root, traps focus once, focuses Close, and sends nothing on a fresh open', () => {
    const test = harness([harvestOnly(10)]);
    test.opener.focus();

    test.controller.openCorpse(10, 400, 300);

    expect(test.element.getAttribute('role')).toBe('dialog');
    expect(test.element.getAttribute('aria-label')).toBe('Entity 10');
    expect(test.captureFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
    expect(test.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(test.harvestCorpse).not.toHaveBeenCalled();
    expect(test.lootCorpse).not.toHaveBeenCalled();
  });

  it('re-opening the SAME body only refreshes: picks and focus survive, the trap is not re-armed', () => {
    const test = harness([harvestOnly(10)]);
    test.controller.openCorpse(10, 400, 300);
    const box = test.element.querySelector<HTMLInputElement>('.corpse-harvest-check');
    if (!box) throw new Error('expected a harvest checkbox');
    box.checked = false;
    box.focus();

    test.controller.openCorpse(10, 410, 310);

    // The same node: no rebuild, so the unchecked pick and the focus both hold.
    expect(test.element.querySelector('.corpse-harvest-check')).toBe(box);
    expect(box.checked).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(test.captureFocus).toHaveBeenCalledTimes(1);
    expect(test.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(test.harvestCorpse).not.toHaveBeenCalled();
    expect(test.lootCorpse).not.toHaveBeenCalled();
  });

  it('opening ANOTHER body is a fresh choice: rebuilt, Close focused, the original opener kept', () => {
    const test = harness([harvestOnly(10), harvestOnly(11, 2)]);
    test.controller.openCorpse(10, 400, 300);
    test.element.querySelector<HTMLInputElement>('.corpse-harvest-check')?.focus();

    test.controller.openCorpse(11, 400, 300);

    expect(test.element.querySelector('.panel-title')?.textContent).toContain('Entity 11');
    expect(test.element.getAttribute('aria-label')).toBe('Entity 11');
    expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
    // One trap for the whole visit: re-capturing here would record a control
    // inside the popup itself as the opener, which the switch just discarded.
    expect(test.captureFocus).toHaveBeenCalledTimes(1);
    expect(test.restoreFocus).not.toHaveBeenCalled();
    expect(test.harvestCorpse).not.toHaveBeenCalled();
  });

  it('close releases the trap to the opener and syncs the window-open body state', () => {
    const test = harness([harvestOnly(10)]);
    test.controller.openCorpse(10, 400, 300);

    test.controller.close();

    expect(test.restoreFocus).toHaveBeenCalledTimes(1);
    expect(test.restoreFocus).toHaveBeenCalledWith(test.opener);
    expect(test.onVisibilityChange).toHaveBeenCalledTimes(2);
    expect(test.element.style.display).toBe('none');

    // A second close is a no-op: nothing to release twice.
    test.controller.close();
    expect(test.restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('refuses to open for a dead viewer or a body out of the popup range', () => {
    const dead = harness([harvestOnly(10)]);
    (dead.world.player as { dead: boolean }).dead = true;
    dead.controller.openCorpse(10, 400, 300);
    expect(dead.element.style.display).not.toBe('block');
    expect(dead.captureFocus).not.toHaveBeenCalled();

    const far = harness([harvestOnly(10, 7.5)]);
    far.controller.openCorpse(10, 400, 300);
    expect(far.element.style.display).not.toBe('block');
    expect(far.captureFocus).not.toHaveBeenCalled();
  });
});

describe('LootWindowController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    i18nProbe.suffix = '';
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
    // Intentional gathering PR1: the interact key takes ordinary loot only, so
    // the footer hint must not promise a one-press harvest. No key name: the
    // interact key is remappable.
    expect(test.element.querySelector('.town-focus-hint')?.textContent).toBe(
      'The interact key only takes the loot. To gather components, use Harvest here.',
    );
    takeLoot?.click();

    expect(test.lootCorpse).toHaveBeenCalledWith(10);
    // An ordinary drop never triggers the bind-on-pickup confirm.
    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.element.style.display).toBe('none');
    expect(test.hideTooltip).toHaveBeenCalledTimes(1);
  });

  it('warns once via the shared confirm before taking loot that contains a soulbound item', () => {
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        // heroic_mark is a live soulbound def; picking it up binds it.
        items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }],
      },
    });
    const test = harness([mob]);
    test.controller.openCorpse(10, 400, 300);

    const takeLoot = test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)');
    takeLoot?.click();

    expect(test.confirm).toHaveBeenCalledTimes(1);
    const [title, body, okText, cancelText] = test.confirm.mock.calls[0];
    expect(title).toBe('Binds when picked up');
    expect(body).toContain('bind to you when taken');
    expect(body).toContain('players who shared its drop');
    expect(okText).toBe('Take Loot');
    expect(cancelText).toBe('Cancel');
    // The harness confirm auto-accepts, so the take still lands.
    expect(test.lootCorpse).toHaveBeenCalledWith(10);
    expect(test.element.style.display).toBe('none');
  });

  it('a declined bind confirm leaves the corpse unlooted and the window open', () => {
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }],
      },
    });
    const test = harness([mob]);
    // Decline: never invoke onOk.
    test.confirm.mockImplementation(() => {});
    test.controller.openCorpse(10, 400, 300);

    const takeLoot = test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)');
    takeLoot?.click();

    expect(test.confirm).toHaveBeenCalledTimes(1);
    expect(test.lootCorpse).not.toHaveBeenCalled();
    expect(test.element.style.display).toBe('block');
  });

  it('renders an unknown-id drop as an occupied row instead of throwing (R34)', () => {
    // Corpse loot is server truth: a bundle one deploy behind can be handed
    // an id with no local def. The row must still paint (raw id label,
    // fallback icon markup) and carry its tooltip, because the unguarded
    // deref used to throw before innerHTML was assigned, leaving the corpse
    // un-lootable.
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        items: [
          { itemId: 'future_expansion_drop_x', count: 2, personalFor: [7] },
          // The prototype-key arm is what discriminates knownItemDef from a
          // bare ITEMS read: 'constructor' resolves truthy on the bare read
          // and the known arm derefs a Function.
          { itemId: 'constructor', count: 1, personalFor: [7] },
        ],
      },
    });
    const test = harness([mob]);
    test.controller.openCorpse(10, 400, 300);
    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('data-item="future_expansion_drop_x"');
    expect(test.element.innerHTML).toContain('future_expansion_drop_x');
    // The prototype key renders as its RAW ID (the unknown arm), never a
    // Function's display name.
    const constructorRow = /data-item="constructor"[^>]*>([\s\S]*?)<\/div>/.exec(
      test.element.innerHTML,
    );
    expect(constructorRow).toBeTruthy();
    expect(constructorRow?.[1] ?? '').toContain('constructor');
    expect(constructorRow?.[1] ?? '').not.toContain('Object');
    // The unknown rows ride the same tooltip idiom as a known one.
    expect(test.attachTooltip).toHaveBeenCalled();
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
    // instead of asserted in prose. The retagged fixture carries the two
    // synthetic families, neither mapped, so `harvestable` is false and
    // openCorpse must skip the picker; it must still open, because the corpse
    // holds copper the player can take. Driven through the REAL
    // corpseLootAvailability against a real (retagged) template, so loosening
    // `if (harvestable && componentTags)` back to `if (componentTags)` reds
    // here rather than passing with every other gate green. The premise pin
    // goes red the day a synthetic family gets a row, which is the cue to move
    // this fixture again (as #2905 mapping claw and tusk retired fen_troll
    // here, and Phase 11m mapping gills and horn retired that pair).
    expect(isHarvestableCorpse(UNMAPPED_TEMPLATE_TAGS)).toBe(false);
    withUnmappedTemplate(() => {
      const imp = entity(20, {
        kind: 'mob',
        templateId: UNMAPPED_TEMPLATE_ID,
        loot: { copper: 50, items: [] },
      });
      const test = harness([imp], (entry) => corpseLootAvailability(entry, 7));

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
    });
    // The discriminator on the identical rig: a MIXED template carrying the same
    // unmapped family beside two mapped families still draws its picker, so
    // this is the predicate and not the controller refusing every corpse. Both
    // halves of "mixed" are pinned: the synthetic family alone is
    // unharvestable (so it is genuinely unmapped), and the retagged list is
    // the shape sethrael_palecoil shipped with (hide, claw, horn) until Phase
    // 11m mapped horn.
    expect(isHarvestableCorpse([UNMAPPED_FAMILY])).toBe(false);
    withRetaggedTemplates({ [MIXED_TEMPLATE_ID]: MIXED_TEMPLATE_TAGS }, () => {
      expect(MOBS[MIXED_TEMPLATE_ID].componentTags).toEqual(['hide', 'claw', UNMAPPED_FAMILY]);
      const mixed = entity(21, {
        kind: 'mob',
        templateId: MIXED_TEMPLATE_ID,
        loot: { copper: 50, items: [] },
      });
      const mixedTest = harness([mixed], (entry) => corpseLootAvailability(entry, 7));
      mixedTest.controller.openCorpse(21, 0, 0);
      expect(mixedTest.element.querySelector('.corpse-harvest')).not.toBeNull();
      expect(mixedTest.element.querySelectorAll('.corpse-harvest-check')).toHaveLength(3);
      // The hint's other arm, on the same rig: where a harvest really is on offer
      // the sentence is true and still rendered, so the gate is not a blanket
      // removal.
      expect(mixedTest.element.querySelector('.town-focus-hint')?.textContent).toBe(
        'The interact key only takes the loot. To gather components, use Harvest here.',
      );
    });
    // ...and on real content, where every shipped tag maps since Phase 11m:
    // sethrael_palecoil still carries horn, and its picker draws every row.
    expect(MOBS.sethrael_palecoil.componentTags).toContain('horn');
    expect(isHarvestableCorpse(['horn'])).toBe(true);
    const palecoil = entity(22, {
      kind: 'mob',
      templateId: 'sethrael_palecoil',
      loot: { copper: 50, items: [] },
    });
    const shippedTest = harness([palecoil], (entry) => corpseLootAvailability(entry, 7));
    shippedTest.controller.openCorpse(22, 0, 0);
    expect(shippedTest.element.querySelector('.corpse-harvest')).not.toBeNull();
    // The exact list as a literal, not derived from the template: the view
    // renders the same componentTags a derived expectation would read, so it
    // would move with a dropped tag and pass; the exact list also reds a
    // same-count tag SWAP a bare length could not (11m QA).
    expect(MOBS.sethrael_palecoil.componentTags).toEqual(['hide', 'claw', 'horn', 'venomSac']);
    expect(shippedTest.element.querySelectorAll('.corpse-harvest-check')).toHaveLength(4);
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
    withUnmappedTemplate(() => {
      const imp = entity(22, { kind: 'mob', templateId: UNMAPPED_TEMPLATE_ID, loot: null });
      const test = harness([imp], (entry) => corpseLootAvailability(entry, 7));

      test.controller.openCorpse(22, 0, 0);

      expect(test.element.style.display).not.toBe('block');
      expect(test.closeTransient).not.toHaveBeenCalled();
    });
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

  it('renders an unknown-id loot stack with the fallback icon and raw id, never a throw (R34)', () => {
    // Corpse loot is server truth: a stale bundle can be handed an id it
    // predates. The unguarded shape threw before innerHTML was assigned,
    // leaving the corpse un-lootable with the player's windows already
    // closed; the guarded row must render beside a known stack, carry the
    // raw id as its label, and attach no def-derived tooltip.
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        items: [
          { itemId: itemIds[0], count: 1, personalFor: [7] },
          { itemId: 'ghost_future_item', count: 3, personalFor: [7] },
        ],
      },
    });
    const h = harness([mob]);
    expect(() => h.controller.openCorpse(10, 0, 0)).not.toThrow();
    const rows = [...h.element.querySelectorAll<HTMLElement>('[data-item]')];
    const ghost = rows.find((row) => row.dataset.item === 'ghost_future_item');
    expect(ghost).toBeTruthy();
    expect(ghost?.textContent).toContain('ghost_future_item');
    expect(ghost?.textContent).toContain('x3');
    expect(ghost?.querySelector('img.item-icon')).toBeTruthy();
    // The known sibling still renders through the injected itemIcon dep.
    expect(rows.some((row) => row.dataset.item === itemIds[0])).toBe(true);
    // The def-less row gets the same minimal tooltip its bag and bank
    // siblings render (raw id + unknown sub-line), never the def-derived
    // body (the injected itemTooltip dep would throw on undefined).
    const ghostAttach = h.attachTooltip.mock.calls.find((call) => call[0] === ghost);
    if (!ghostAttach) throw new Error('the ghost row must have a tooltip attached');
    const tooltipHtml = (ghostAttach[1] as () => string)();
    expect(tooltipHtml).toContain('ghost_future_item');
    expect(tooltipHtml).not.toContain('tooltip:');
  });

  // Intentional gathering PR1: the popup is a view over a server-authoritative
  // snapshot, and the next snapshot can retire an action it advertises (another
  // player claims the harvest, the loot is taken or expires, the corpse decays).
  // updateProximity is the one per-frame hook the coordinator already drives, so
  // it re-reads corpseLootAvailability and refreshes the body ONLY when the
  // advertised set changes, and every button re-checks the live availability
  // before it dispatches.
  describe('live availability after later snapshots', () => {
    function openHarvestAndLoot(id = 50) {
      const mob = entity(id, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 25, items: [{ itemId: itemIds[0], count: 1, personalFor: [7] }] },
      });
      const test = harness([mob]);
      test.controller.openCorpse(id, 400, 300);
      expect(test.element.querySelector('.corpse-harvest')).not.toBeNull();
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).not.toBeNull();
      return { mob, test };
    }

    it('drops the Harvest section once another player claims the harvest, keeping Take Loot', () => {
      const { mob, test } = openHarvestAndLoot();

      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('block');
      expect(test.element.querySelector('.corpse-harvest')).toBeNull();
      expect(test.element.querySelector('.corpse-harvest-btn')).toBeNull();
      expect(test.element.querySelector('.town-focus-hint')).toBeNull();
      const takeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );
      expect(takeLoot?.textContent).toBe('Take Loot');
      expect(test.element.innerHTML).toContain('money:25');
      // A refresh never re-places the popup: the player is looking at it.
      expect(test.placePopup).toHaveBeenCalledTimes(1);
      expect(test.closeTransient).toHaveBeenCalledTimes(1);
    });

    it('drops the loot rows and Take Loot once the loot is gone, keeping the Harvest picker', () => {
      const { mob, test } = openHarvestAndLoot();

      mob.loot = null;
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).not.toContain('money:25');
      expect(test.element.innerHTML).not.toContain(`data-item="${itemIds[0]}"`);
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).toBeNull();
      expect(test.element.querySelector('.corpse-harvest-btn')).not.toBeNull();
    });

    it('closes when nothing advertised remains (claimed harvest AND emptied loot)', () => {
      const { mob, test } = openHarvestAndLoot();

      mob.harvestClaimedBy = 9;
      mob.loot = null;
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('none');
      expect(test.hideTooltip).toHaveBeenCalledTimes(1);
    });

    it('closes when the corpse entity leaves the snapshot', () => {
      const { test } = openHarvestAndLoot(51);

      test.entities.delete(51);
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('none');
    });

    it('leaves the DOM untouched across identical frames', () => {
      const { test } = openHarvestAndLoot();
      const before = test.element.innerHTML;
      const takeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );
      const attachCalls = test.attachTooltip.mock.calls.length;

      test.controller.updateProximity();
      test.controller.updateProximity();

      expect(test.element.innerHTML).toBe(before);
      // Same node identity: no rebuild happened, so no listener was re-attached.
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).toBe(takeLoot);
      expect(test.attachTooltip).toHaveBeenCalledTimes(attachCalls);
    });

    it("a refresh keeps the player's checkbox choices and their keyboard focus", () => {
      const tags = harvestMobTags;
      const mob = entity(52, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 25, items: [] },
      });
      const test = harness([mob], (entry) => corpseLootAvailability(entry, 7), { [tags[0]]: 5 });
      test.controller.openCorpse(52, 400, 300);
      const boxes = [...test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
      // Invert the town-focus default: uncheck the focused box, check the second.
      boxes[0].checked = false;
      boxes[1].checked = true;
      boxes[1].focus();
      expect(document.activeElement).toBe(boxes[1]);

      // The coin is taken by a party member: the loot half changes, the harvest half stays.
      mob.loot = null;
      test.controller.updateProximity();

      const after = [...test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
      expect(after.map((box) => [box.value, box.checked])).toEqual(
        tags.map((tag) => [tag, tag === tags[1]]),
      );
      expect(document.activeElement).toBe(after[1]);
      expect(test.element.innerHTML).not.toContain('money:25');

      // The rebuilt picker still submits the carried selection.
      test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
      expect(test.harvestCorpse).toHaveBeenCalledWith(52, [tags[1]]);
    });

    it('a refresh keeps focus on Take Loot when the harvest half disappears', () => {
      const { mob, test } = openHarvestAndLoot();
      const takeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );
      takeLoot?.focus();
      expect(document.activeElement).toBe(takeLoot);

      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      const rebuilt = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );
      expect(rebuilt).not.toBeNull();
      expect(document.activeElement).toBe(rebuilt);
    });

    it('a refresh never promotes focus from Harvest to Take Loot: it degrades to Close', () => {
      // Focus was on the destructive control that just disappeared. Landing on
      // the OTHER destructive control would turn the player's pending Enter into
      // a take they never chose; Close is the only safe rung.
      const { mob, test } = openHarvestAndLoot();
      test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.focus();

      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      expect(test.element.querySelector('.corpse-harvest-btn')).toBeNull();
      expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
      expect(document.activeElement).not.toBe(
        test.element.querySelector('.btn:not(.corpse-harvest-btn)'),
      );
    });

    it('a refresh never promotes focus from Take Loot to Harvest: it degrades to Close', () => {
      const { mob, test } = openHarvestAndLoot();
      test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)')?.focus();

      mob.loot = null;
      test.controller.updateProximity();

      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).toBeNull();
      expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
      expect(document.activeElement).not.toBe(test.element.querySelector('.corpse-harvest-btn'));
    });

    it('a focused checkbox whose picker disappears degrades to Close, never to Take Loot', () => {
      const { mob, test } = openHarvestAndLoot();
      test.element.querySelector<HTMLInputElement>('.corpse-harvest-check')?.focus();

      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
    });

    it('a changed loot pool repaints the rows (copper moved) and keeps the popup open', () => {
      const { mob, test } = openHarvestAndLoot();
      expect(test.element.innerHTML).toContain('money:25');

      if (mob.loot) mob.loot.copper = 10;
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).toContain('money:10');
      expect(test.element.innerHTML).not.toContain('money:25');
    });

    it("a detached Take Loot button from a previous corpse never acts on the new corpse's availability", () => {
      // Corpse A is open; the player opens corpse B (a new open replaces the
      // body). A's button is detached but still holds its handler. Clicking it
      // must neither take A (the popup no longer stands for A) nor close B.
      const a = entity(70, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 5, items: [] },
      });
      const b = entity(71, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 6, items: [] },
      });
      const test = harness([a, b]);
      test.controller.openCorpse(70, 0, 0);
      const staleTakeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );
      const staleHarvest = test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
      test.controller.openCorpse(71, 0, 0);

      staleTakeLoot?.click();
      staleHarvest?.click();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).toContain('money:6');
    });

    function openBindingLoot(id = 80) {
      const mob = entity(id, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 0, items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }] },
      });
      const test = harness([mob]);
      // Hold the confirm open: capture onOk instead of accepting.
      let pendingOk: (() => void) | null = null;
      test.confirm.mockImplementation((_t, _b, _o, _c, onOk) => {
        pendingOk = onOk;
      });
      test.controller.openCorpse(id, 0, 0);
      test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)')?.click();
      expect(test.confirm).toHaveBeenCalledTimes(1);
      const accept = (): void => {
        if (!pendingOk) throw new Error('confirm was not opened');
        pendingOk();
      };
      return { mob, test, accept };
    }

    it('a pending bind confirm re-checks the loot when accepted (loot gone: no take)', () => {
      const { mob, test, accept } = openBindingLoot();

      mob.loot = null;
      accept();

      expect(test.lootCorpse).not.toHaveBeenCalled();
    });

    it('a pending bind confirm never takes a DIFFERENT corpse opened meanwhile', () => {
      const { test, accept } = openBindingLoot(81);
      const other = entity(82, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 9, items: [] },
      });
      test.entities.set(82, other);
      test.controller.openCorpse(82, 0, 0);

      accept();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      // The switched-to popup is left standing.
      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).toContain('money:9');
    });

    it('closing and reopening the same corpse retires its old confirmation', () => {
      const { test, accept } = openBindingLoot(89);
      test.controller.close();
      test.controller.openCorpse(89, 0, 0);

      accept();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
    });

    it('closing and reopening the same corpse retires its old harvest choice', () => {
      const { test } = openHarvestAndLoot(90);
      const oldHarvest = test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
      expect(oldHarvest).not.toBeNull();
      test.controller.close();
      test.controller.openCorpse(90, 0, 0);

      oldHarvest?.click();

      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
    });

    it('a pending bind confirm does nothing once the player has died', () => {
      const { test, accept } = openBindingLoot(83);

      (test.world.player as { dead: boolean }).dead = true;
      accept();

      expect(test.lootCorpse).not.toHaveBeenCalled();
    });

    it('a pending bind confirm does nothing once the corpse left the snapshot', () => {
      const { test, accept } = openBindingLoot(84);

      test.entities.delete(84);
      accept();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('none');
    });

    it('a pending bind confirm still takes when everything is unchanged', () => {
      const { test, accept } = openBindingLoot(85);

      accept();

      expect(test.lootCorpse).toHaveBeenCalledWith(85);
      expect(test.element.style.display).toBe('none');
    });

    it("closes the corpse popup on the player's death (nothing here can be taken while dead)", () => {
      const { test } = openHarvestAndLoot(86);

      (test.world.player as { dead: boolean }).dead = true;
      test.controller.updateProximity();

      expect(test.element.style.display).toBe('none');
    });

    it('Take Loot re-checks the live loot before dispatching (stale snapshot, no take)', () => {
      const { mob, test } = openHarvestAndLoot();
      const takeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );

      // The snapshot moved but no frame has refreshed the popup yet.
      mob.loot = null;
      takeLoot?.click();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.confirm).not.toHaveBeenCalled();
      // The click brought the popup up to date instead: the harvest half stays.
      expect(test.element.style.display).toBe('block');
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).toBeNull();
      expect(test.element.querySelector('.corpse-harvest-btn')).not.toBeNull();
    });

    it('Take Loot never harvests, even when it is the only action left', () => {
      const { mob, test } = openHarvestAndLoot();
      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      test.element.querySelector<HTMLButtonElement>('.btn:not(.corpse-harvest-btn)')?.click();

      expect(test.lootCorpse).toHaveBeenCalledWith(50);
      expect(test.harvestCorpse).not.toHaveBeenCalled();
    });

    it('Harvest re-checks the live claim before dispatching (stale snapshot, no harvest)', () => {
      const { mob, test } = openHarvestAndLoot();
      const harvest = test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn');

      mob.harvestClaimedBy = 9;
      harvest?.click();

      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
      expect(test.element.querySelector('.corpse-harvest')).toBeNull();
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')).not.toBeNull();
    });

    it('a stale click with nothing left closes the popup without dispatching', () => {
      const { mob, test } = openHarvestAndLoot();
      const takeLoot = test.element.querySelector<HTMLButtonElement>(
        '.btn:not(.corpse-harvest-btn)',
      );

      mob.loot = null;
      mob.harvestClaimedBy = 9;
      takeLoot?.click();

      expect(test.lootCorpse).not.toHaveBeenCalled();
      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('none');
    });

    it('Harvest never takes the loot', () => {
      const { test } = openHarvestAndLoot();

      test.element.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();

      expect(test.harvestCorpse).toHaveBeenCalledTimes(1);
      expect(test.lootCorpse).not.toHaveBeenCalled();
    });

    it('relocalize() rebuilds an open corpse popup once with fresh text, keeping picks and focus', () => {
      // The body is repaint-signature gated on DATA, so a language switch alone
      // never moves it; the Hud fan-out calls relocalize() (the
      // tests/language_fanout_registry contract): exactly one rebuild, re-latched.
      const tags = harvestMobTags;
      const mob = entity(90, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 3, items: [] },
      });
      const test = harness([mob], (entry) => corpseLootAvailability(entry, 7), { [tags[0]]: 5 });
      test.controller.openCorpse(90, 0, 0);
      const boxes = [...test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
      boxes[0].checked = false;
      boxes[1].checked = true;
      boxes[1].focus();
      const hintBefore = test.element.querySelector('.town-focus-hint')?.textContent ?? '';

      i18nProbe.suffix = ' [xx]';
      test.controller.relocalize();

      const hint = test.element.querySelector('.town-focus-hint');
      expect(hint?.textContent).toBe(`${hintBefore} [xx]`);
      expect(test.element.querySelector('.btn:not(.corpse-harvest-btn)')?.textContent).toBe(
        'Take Loot [xx]',
      );
      const after = [...test.element.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
      expect(after.map((box) => [box.value, box.checked])).toEqual(
        tags.map((tag) => [tag, tag === tags[1]]),
      );
      expect(document.activeElement).toBe(after[1]);
      // Re-latched, not cleared: the next poll rebuilds nothing.
      test.controller.updateProximity();
      expect(test.element.querySelector('.town-focus-hint')).toBe(hint);
    });

    it('relocalize() is a no-op while nothing is open and while a chest is open', () => {
      const chest = entity(91, { kind: 'object', templateId: 'delve_chest' });
      const test = harness([chest]);
      test.controller.relocalize();
      expect(test.element.innerHTML).toBe('');
      expect(test.element.style.display).not.toBe('block');

      test.controller.openChest(91, [{ itemId: itemIds[0], count: 1 }]);
      const takeAll = test.element.querySelector<HTMLButtonElement>('.btn');
      i18nProbe.suffix = ' [xx]';
      test.controller.relocalize();
      // The chest body is built once on open and is not rebuilt here (no signature,
      // nothing to re-latch); its node survives.
      expect(test.element.querySelector<HTMLButtonElement>('.btn')).toBe(takeAll);
    });

    it('the chest arm is untouched: Take All still collects and proximity only checks the entity', () => {
      const chest = entity(60, { kind: 'object', templateId: 'delve_chest' });
      const corpseAvailability = vi.fn(() => {
        throw new Error('the chest arm must never consult corpse availability');
      });
      const test = harness([chest], corpseAvailability);

      test.controller.openChest(60, [{ itemId: itemIds[0], count: 1 }]);
      test.controller.updateProximity();
      expect(corpseAvailability).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
      test.element.querySelector<HTMLButtonElement>('.btn')?.click();
      expect(test.collectDelveChestLoot).toHaveBeenCalledWith(60);
    });
  });
});

describe('LootWindowController: Professions entry orchestration', () => {
  it('opens a centered choice without collecting either loot half', () => {
    const h = harness([
      entity(90, { kind: 'mob', templateId: harvestMobId, dead: true, corpseTimer: 10 }),
    ]);
    h.controller.openHarvestBodyChoice();
    expect(h.element.style.display).toBe('block');
    expect(h.centerPopup).toHaveBeenCalledWith(h.element);
    expect(h.lootCorpse).not.toHaveBeenCalled();
    expect(h.harvestCorpse).not.toHaveBeenCalled();
  });

  it('reports no body in reach and leaves the dialog closed', () => {
    const h = harness([]);
    h.controller.openHarvestBodyChoice();
    expect(h.showError).toHaveBeenCalledWith('Nothing to interact with.');
    expect(h.element.style.display).not.toBe('block');
    expect(h.harvestCorpse).not.toHaveBeenCalled();
  });
});
