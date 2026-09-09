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
import type { CorpseHarvestInfo, IWorld } from '../src/world_api';

const itemIds = Object.keys(ITEMS);
// isHarvestableCorpse, not a tag COUNT: the same real predicate the ordinary
// availability gate (corpse_loot_availability.ts) and the sim's own command
// boundary use, so a harvestable fixture here really draws the section.
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

/** A frozen `CorpseHarvestInfo` fixture, defaulting to an admitted All-materials
 *  read with no reservation and no tier shift; override the fields a case cares
 *  about. */
function harvestInfo(over: Partial<CorpseHarvestInfo> = {}): CorpseHarvestInfo {
  return {
    corpseId: 0,
    componentTags: [],
    preference: { kind: 'all' },
    denial: null,
    reservation: null,
    tierBonus: 0,
    ...over,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush one microtask turn, enough for a `.then` chained off `issue an
 *  already-resolved/rejected promise`. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

type HarvestInfoImpl = (id: number) => CorpseHarvestInfo | null | Promise<CorpseHarvestInfo | null>;

function harness(
  initialEntities: Entity[] = [],
  corpseAvailability = (mob: Entity) => corpseLootAvailability(mob, 7),
  townFocus: Record<string, number> = {},
  // Defaults to "no usable current answer" (the contract's own null case), so
  // any test not about the harvest section itself gets a harmless, disabled
  // section rather than an admitted one it never asked for.
  harvestInfoImpl: HarvestInfoImpl = () => null,
) {
  const element = document.createElement('div');
  element.id = 'loot-window';
  document.body.appendChild(element);
  const entities = new Map(initialEntities.map((entry) => [entry.id, entry]));
  const lootCorpse = vi.fn();
  const harvestCorpse = vi.fn();
  const collectDelveChestLoot = vi.fn();
  const corpseHarvestInfo = vi.fn(harvestInfoImpl);
  const world = {
    entities,
    playerId: 7,
    player: { pos: { x: 0, y: 0, z: 0 }, dead: false },
    townFocus,
    lootCorpse,
    harvestCorpse,
    collectDelveChestLoot,
    corpseHarvestInfo,
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
  const openHarvestPreference = vi.fn();
  let nowMs = 0;
  const now = vi.fn(() => nowMs);
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
    openHarvestPreference,
    now,
  });
  return {
    controller,
    element,
    entities,
    world,
    lootCorpse,
    harvestCorpse,
    collectDelveChestLoot,
    corpseHarvestInfo,
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
    openHarvestPreference,
    advanceClock(ms: number) {
      nowMs += ms;
    },
  };
}

function takeLootBtn(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(
    '.btn:not(.corpse-harvest-btn):not(.corpse-harvest-change-btn)',
  );
}
function harvestBtn(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
}
function changeBtn(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn');
}

// Intentional gathering PR1/PR3: the corpse popup is a real dialog. It
// registers the shared focus trap through the injected bridge, marks its
// root, lands keyboard focus on Close on a FRESH open, and never runs an
// action on open (including asking for the live harvest status: that read is
// query-only, never a write). Re-opening the SAME body (the Professions
// entry pressed twice, a second click on the corpse) only refreshes,
// keeping focus; opening ANOTHER body is a fresh choice.
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
    expect(test.openHarvestPreference).not.toHaveBeenCalled();
    // The status query itself is read-only: it fires, but writes nothing.
    expect(test.corpseHarvestInfo).toHaveBeenCalledWith(10);
  });

  it('re-opening the SAME body only refreshes: focus survives, the trap is not re-armed', () => {
    const test = harness([harvestOnly(10)]);
    test.controller.openCorpse(10, 400, 300);
    const change = changeBtn(test.element);
    if (!change) throw new Error('expected a Change control');
    change.focus();

    test.controller.openCorpse(10, 410, 310);

    // The same node: no rebuild (the settled status did not change), so focus holds.
    expect(changeBtn(test.element)).toBe(change);
    expect(document.activeElement).toBe(change);
    expect(test.captureFocus).toHaveBeenCalledTimes(1);
    expect(test.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(test.harvestCorpse).not.toHaveBeenCalled();
    expect(test.lootCorpse).not.toHaveBeenCalled();
    // A same-body reopen is a REFRESH, not a fresh visit: it still honors the
    // poll floor rather than forcing a second read through with no time
    // elapsed (corpse-status-contract.md's 2Hz cadence is a controller-owned
    // bound, not merely a courtesy to the server's own limit).
    expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(1);

    // Advancing past the floor and reopening again DOES ask.
    test.advanceClock(500);
    test.controller.openCorpse(10, 420, 320);
    expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(2);
  });

  it('opening ANOTHER body is a fresh choice: rebuilt, Close focused, the original opener kept', () => {
    const test = harness([harvestOnly(10), harvestOnly(11, 2)]);
    test.controller.openCorpse(10, 400, 300);
    changeBtn(test.element)?.focus();

    test.controller.openCorpse(11, 400, 300);

    expect(test.element.querySelector('.panel-title')?.textContent).toContain('Entity 11');
    expect(test.element.getAttribute('aria-label')).toBe('Entity 11');
    expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
    // One trap for the whole visit: re-capturing here would record a control
    // inside the popup itself as the opener, which the switch just discarded.
    expect(test.captureFocus).toHaveBeenCalledTimes(1);
    expect(test.restoreFocus).not.toHaveBeenCalled();
    expect(test.harvestCorpse).not.toHaveBeenCalled();
    expect(test.corpseHarvestInfo).toHaveBeenCalledWith(11);
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
    expect(dead.corpseHarvestInfo).not.toHaveBeenCalled();

    const far = harness([harvestOnly(10, 7.5)]);
    far.controller.openCorpse(10, 400, 300);
    expect(far.element.style.display).not.toBe('block');
    expect(far.captureFocus).not.toHaveBeenCalled();
    expect(far.corpseHarvestInfo).not.toHaveBeenCalled();
  });

  it('no queries while nothing is open: updateProximity is a no-op query-wise', () => {
    const test = harness([harvestOnly(10)]);
    test.controller.updateProximity();
    expect(test.corpseHarvestInfo).not.toHaveBeenCalled();
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

    const takeLoot = takeLootBtn(test.element);
    const harvest = harvestBtn(test.element);
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
    // Live placeholders off the real HARVEST_CAST_SECONDS (1.5) and
    // HARVEST_PRIORITY_SECONDS (10) admission constants.
    expect(tooltipFor(harvest)).toBe(
      'Harvests with your current preference over 1.5 seconds. Requires a Field Kit. Each body can be harvested once. The killer and their party have priority for 10 seconds. Dropped loot stays available.',
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

    takeLootBtn(test.element)?.click();

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

    takeLootBtn(test.element)?.click();

    expect(test.confirm).toHaveBeenCalledTimes(1);
    expect(test.lootCorpse).not.toHaveBeenCalled();
    expect(test.element.style.display).toBe('block');
  });

  it('renders an unknown-id drop as an occupied row instead of throwing (R34)', () => {
    const mob = entity(10, {
      kind: 'mob',
      templateId: harvestMobId,
      loot: {
        copper: 0,
        items: [
          { itemId: 'future_expansion_drop_x', count: 2, personalFor: [7] },
          { itemId: 'constructor', count: 1, personalFor: [7] },
        ],
      },
    });
    const test = harness([mob]);
    test.controller.openCorpse(10, 400, 300);
    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('data-item="future_expansion_drop_x"');
    expect(test.element.innerHTML).toContain('future_expansion_drop_x');
    const constructorRow = /data-item="constructor"[^>]*>([\s\S]*?)<\/div>/.exec(
      test.element.innerHTML,
    );
    expect(constructorRow).toBeTruthy();
    expect(constructorRow?.[1] ?? '').toContain('constructor');
    expect(constructorRow?.[1] ?? '').not.toContain('Object');
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
    expect(test.corpseHarvestInfo).not.toHaveBeenCalled();
  });

  it("hides a stranger's owner-locked copper and shared items, listing only my personal drop", () => {
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

  it('draws no harvest section at all on an unharvestable corpse (already claimed)', () => {
    const mob = entity(20, {
      kind: 'mob',
      templateId: harvestMobId,
      harvestClaimedBy: 9,
      loot: { copper: 50, items: [] },
    });
    const test = harness([mob], (entry) => corpseLootAvailability(entry, 7));

    test.controller.openCorpse(20, 0, 0);

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('money:50');
    expect(test.element.querySelector('.corpse-harvest')).toBeNull();
    expect(harvestBtn(test.element)).toBeNull();
    expect(changeBtn(test.element)).toBeNull();
    expect(test.element.querySelector('.town-focus-hint')).toBeNull();
    expect(test.corpseHarvestInfo).not.toHaveBeenCalled();
  });

  it('drops the unified-press hint on an untagged corpse too, where a harvest was never on offer', () => {
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

  it('does not open at all for an unharvestable corpse with nothing left to loot', () => {
    const claimed = entity(22, {
      kind: 'mob',
      templateId: harvestMobId,
      harvestClaimedBy: 9,
      loot: null,
    });
    const test = harness([claimed], (entry) => corpseLootAvailability(entry, 7));

    test.controller.openCorpse(22, 0, 0);

    expect(test.element.style.display).not.toBe('block');
    expect(test.closeTransient).not.toHaveBeenCalled();

    // The discriminator: a depleted corpse that IS still harvestable still
    // opens for its harvest half.
    const wolf = entity(23, { kind: 'mob', templateId: harvestMobId, loot: null });
    const wolfTest = harness([wolf], (entry) => corpseLootAvailability(entry, 7));
    wolfTest.controller.openCorpse(23, 0, 0);
    expect(wolfTest.element.style.display).toBe('block');
    expect(wolfTest.element.querySelector('.corpse-harvest')).not.toBeNull();
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
    expect(rows.some((row) => row.dataset.item === itemIds[0])).toBe(true);
    const ghostAttach = h.attachTooltip.mock.calls.find((call) => call[0] === ghost);
    if (!ghostAttach) throw new Error('the ghost row must have a tooltip attached');
    const tooltipHtml = (ghostAttach[1] as () => string)();
    expect(tooltipHtml).toContain('ghost_future_item');
    expect(tooltipHtml).not.toContain('tooltip:');
  });

  // The corpse popup's harvest STATUS section (Intentional Gathering PR3,
  // corpse-status-contract.md): the ONE remembered global preference plus its
  // live status against THIS body, replacing the retired per-tag picker.
  describe('harvest status section', () => {
    function openWithInfo(info: HarvestInfoImpl, id = 50) {
      const mob = entity(id, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 25, items: [{ itemId: itemIds[0], count: 1, personalFor: [7] }] },
      });
      const test = harness([mob], (entry) => corpseLootAvailability(entry, 7), {}, info);
      test.controller.openCorpse(id, 400, 300);
      return { mob, test, id };
    }

    it('shows the checking status before any answer has settled, disabling Harvest', () => {
      const { promise } = deferred<CorpseHarvestInfo | null>();
      const { test } = openWithInfo(() => promise);

      expect(test.element.querySelector('.corpse-harvest')).not.toBeNull();
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Checking harvest status...',
      );
      // Change is never gated on the query: a player may always switch away.
      expect(changeBtn(test.element)?.disabled).toBeFalsy();
    });

    it('an All-materials admitted answer enables Harvest and states the spread benefit', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();

      expect(harvestBtn(test.element)?.disabled).toBe(false);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Gathers every available material from this body.',
      );
      expect(test.element.querySelector('.corpse-harvest-title')?.textContent).toBe(
        'Harvest preference: All materials',
      );
    });

    it('a material preference with a tier bonus states the focus AND the bonus', async () => {
      const itemId = itemIds[0];
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'material', itemId }, tierBonus: 2 }),
      );
      await flush();

      expect(harvestBtn(test.element)?.disabled).toBe(false);
      const hint = test.element.querySelector('.corpse-harvest-hint')?.textContent ?? '';
      expect(hint).toContain('+2 tier over All materials');
    });

    it('a null (no usable answer) settle disables Harvest with the unavailable status', async () => {
      const { test } = openWithInfo(() => null);
      await flush();

      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Harvest status is not available right now.',
      );
    });

    it('a reservation held by someone else names them, and by self reads distinctly', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({
          corpseId: id,
          denial: 'reserved',
          reservation: { name: 'Rival', self: false },
        }),
      );
      await flush();
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Rival is harvesting this body.',
      );

      const self = openWithInfo(
        (id) =>
          harvestInfo({
            corpseId: id,
            denial: 'reserved',
            reservation: { name: 'Me', self: true },
          }),
        51,
      );
      await flush();
      expect(self.test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'You are already harvesting this body.',
      );
    });

    it('an unavailable chosen material names it and lists what the body DOES offer', async () => {
      const itemId = itemIds[0];
      const { test } = openWithInfo((id) =>
        harvestInfo({
          corpseId: id,
          preference: { kind: 'material', itemId },
          denial: 'material_unavailable',
          componentTags: [], // no tags: availableMaterialItemIds derives empty here
        }),
      );
      await flush();
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      const withoutList = test.element.querySelector('.corpse-harvest-hint')?.textContent ?? '';
      expect(withoutList).toContain('is not on this body.');
      expect(withoutList).not.toContain('Available:');
    });

    it("Change always stays enabled and opens the shared picker with this body's tags, sending nothing", async () => {
      const tags = harvestMobTags;
      const { test } = openWithInfo((id) =>
        harvestInfo({
          corpseId: id,
          componentTags: tags,
          denial: 'material_unavailable',
          preference: { kind: 'material', itemId: 'no-such-item' },
        }),
      );
      await flush();

      changeBtn(test.element)?.click();

      expect(test.openHarvestPreference).toHaveBeenCalledTimes(1);
      expect(test.openHarvestPreference).toHaveBeenCalledWith(tags);
      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.element.style.display).toBe('block');
    });

    it('Harvest sends id ONLY, disables itself while pending, and closes on a started cast', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);

      harvestBtn(test.element)?.click();

      expect(test.harvestCorpse).toHaveBeenCalledTimes(1);
      expect(test.harvestCorpse).toHaveBeenCalledWith(50);
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Starting harvest...',
      );

      outcome.resolve(true);
      await flush();

      expect(test.element.style.display).toBe('none');
    });

    it('a false (refused) outcome keeps the panel open, clears pending, and resets to an honest checking state', async () => {
      // A stateful status factory: the FIRST read (at open) admits; the
      // SECOND (the post-refusal re-ask) is held pending so the transient
      // "checking" state is actually observable rather than racing past it.
      const requery = deferred<CorpseHarvestInfo | null>();
      let calls = 0;
      const { test } = openWithInfo((id) => {
        calls += 1;
        return calls === 1
          ? harvestInfo({ corpseId: id, preference: { kind: 'all' } })
          : requery.promise;
      });
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);

      harvestBtn(test.element)?.click();
      // Past the poll floor, so the post-refusal re-ask is not itself blocked.
      test.advanceClock(500);
      outcome.resolve(false);
      await flush();

      expect(test.element.style.display).toBe('block');
      // The stale "admitted" answer is now known wrong: Harvest goes back to
      // a disabled, honestly-checking state rather than staying enabled on
      // an answer the server just refused.
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Checking harvest status...',
      );
      expect(calls).toBe(2);

      requery.resolve(harvestInfo({ corpseId: 50, preference: { kind: 'all' } }));
      await flush();
      expect(harvestBtn(test.element)?.disabled).toBe(false);
    });

    it('a refusal re-ask still honors the poll floor: no time elapsed, no second read yet', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);

      harvestBtn(test.element)?.click();
      const callsBeforeSettle = test.corpseHarvestInfo.mock.calls.length;
      outcome.resolve(false);
      await flush();

      // No time elapsed since the last read: still floor-gated, so no second
      // query fires, and the honest checking state simply waits for the next
      // natural poll.
      expect(test.corpseHarvestInfo.mock.calls.length).toBe(callsBeforeSettle);
      expect(harvestBtn(test.element)?.disabled).toBe(true);
    });

    it('a thrown/rejected outcome is treated exactly like a refusal, never left unhandled', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      test.harvestCorpse.mockRejectedValue(new Error('boom'));

      harvestBtn(test.element)?.click();
      await flush();

      expect(test.element.style.display).toBe('block');
      // Honest: the rejection resets to checking (disabled) rather than
      // silently keeping the stale accepting answer displayed.
      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Checking harvest status...',
      );
    });

    it('a second click while a Harvest command is already pending never sends twice', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);

      const btn = harvestBtn(test.element);
      btn?.click();
      // The button is already disabled, so a real user cannot click it again,
      // but the controller's own guard is asserted directly too.
      btn?.click();

      expect(test.harvestCorpse).toHaveBeenCalledTimes(1);
    });

    it('Take Loot stays independent and usable while a Harvest command is pending', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);
      harvestBtn(test.element)?.click();

      takeLootBtn(test.element)?.click();

      expect(test.lootCorpse).toHaveBeenCalledWith(50);
    });

    it('a stale Harvest outcome cannot close or repaint a newer visit to a DIFFERENT body', async () => {
      const first = openWithInfo(
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
        50,
      );
      await flush();
      const outcome = deferred<boolean>();
      first.test.harvestCorpse.mockReturnValue(outcome.promise);
      harvestBtn(first.test.element)?.click();

      // Switch to another body before the command settles.
      const other = entity(60, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 9, items: [] },
      });
      first.test.entities.set(60, other);
      first.test.controller.openCorpse(60, 0, 0);
      const newContent = first.test.element.innerHTML;

      outcome.resolve(true);
      await flush();

      // The newer visit is untouched: no close, no repaint from the stale reply.
      expect(first.test.element.style.display).toBe('block');
      expect(first.test.element.innerHTML).toBe(newContent);
    });

    it('a stale Harvest outcome after a close/reopen of the SAME id never acts', async () => {
      const { test, id } = openWithInfo(
        (bodyId) => harvestInfo({ corpseId: bodyId, preference: { kind: 'all' } }),
        50,
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);
      harvestBtn(test.element)?.click();

      test.controller.close();
      test.controller.openCorpse(id, 0, 0);
      const contentAfterReopen = test.element.innerHTML;

      outcome.resolve(true);
      await flush();

      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).toBe(contentAfterReopen);
    });

    it('a stale Harvest outcome after a world swap (reconnect) never acts', async () => {
      const { test } = openWithInfo((id) =>
        harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      await flush();
      const outcome = deferred<boolean>();
      test.harvestCorpse.mockReturnValue(outcome.promise);
      harvestBtn(test.element)?.click();

      // Swap the world instance under the open popup (a reconnect).
      const swapped = { ...test.world } as unknown as IWorld;
      (test.controller as unknown as { deps: { world(): IWorld } }).deps.world = () => swapped;

      outcome.resolve(true);
      await flush();

      // The stale settle must not have closed the popup against the OLD world.
      expect(test.element.style.display).toBe('block');
    });

    it('a stale status reply for a superseded body never enables/repaints/closes it', async () => {
      const first = deferred<CorpseHarvestInfo | null>();
      const second = deferred<CorpseHarvestInfo | null>();
      let calls = 0;
      const test = harness(
        [
          entity(50, { kind: 'mob', templateId: harvestMobId, loot: { copper: 1, items: [] } }),
          entity(60, { kind: 'mob', templateId: harvestMobId, loot: { copper: 2, items: [] } }),
        ],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        () => {
          calls += 1;
          return calls === 1 ? first.promise : second.promise;
        },
      );

      test.controller.openCorpse(50, 0, 0);
      test.controller.openCorpse(60, 0, 0);
      const contentAfterSwitch = test.element.innerHTML;

      first.resolve(harvestInfo({ corpseId: 50, preference: { kind: 'all' } }));
      await flush();

      expect(test.element.style.display).toBe('block');
      expect(test.element.innerHTML).toBe(contentAfterSwitch);
      expect(test.element.querySelector('.panel-title')?.textContent).toContain('Entity 60');
    });

    it('throttles the poll to at most one read per 500ms', () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(1);

      test.advanceClock(100);
      test.controller.updateProximity();
      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(1);

      test.advanceClock(400);
      test.controller.updateProximity();
      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(2);

      test.advanceClock(100);
      test.controller.updateProximity();
      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(2);
    });

    it('an unchanged settled answer across repeated polls repaints nothing (no idle DOM writes)', async () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      await flush();
      const harvest = harvestBtn(test.element);
      const before = test.element.innerHTML;

      test.advanceClock(500);
      test.controller.updateProximity();
      await flush();

      expect(test.element.innerHTML).toBe(before);
      expect(harvestBtn(test.element)).toBe(harvest);
    });

    it('a synchronous (offline-Sim-shaped) answer works without any promise machinery', () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );

      test.controller.openCorpse(50, 0, 0);

      expect(harvestBtn(test.element)?.disabled).toBe(false);
    });

    // The parent's sixth boundary regression: a slow status refresh after a
    // previously admitted answer must not leave Harvest enabled/dispatchable
    // on that now-stale answer, and must not pay for a wholesale rebuild to
    // say so.
    describe('a slow refresh while a previous answer is displayed', () => {
      function openAdmittedThenSlowRefresh() {
        const mob = entity(50, {
          kind: 'mob',
          templateId: harvestMobId,
          loot: { copper: 1, items: [] },
        });
        const refresh = deferred<CorpseHarvestInfo | null>();
        let calls = 0;
        const test = harness(
          [mob],
          (entry) => corpseLootAvailability(entry, 7),
          {},
          (id) => {
            calls += 1;
            return calls === 1
              ? harvestInfo({ corpseId: id, preference: { kind: 'all' } })
              : refresh.promise;
          },
        );
        test.controller.openCorpse(50, 0, 0);
        const harvest = harvestBtn(test.element);
        const change = changeBtn(test.element);
        const title = test.element.querySelector('.corpse-harvest-title');
        const hint = test.element.querySelector('.corpse-harvest-hint')?.textContent;
        expect(harvest?.disabled).toBe(false);

        test.advanceClock(500);
        test.controller.updateProximity(); // issues the slow (still-pending) re-ask

        return { test, harvest, change, title, hint, refresh };
      }

      it('disables the EXISTING Harvest button in place: no rebuild, readable previous status, Take Loot still works', () => {
        const { test, harvest, change, title, hint } = openAdmittedThenSlowRefresh();

        expect(harvestBtn(test.element)).toBe(harvest);
        // A busy refresh over a PRIOR ADMITTED answer disables via
        // aria-disabled, not native `disabled`, so the control stays
        // focusable while a background poll is in flight (Intentional
        // Gathering PR3 keyboard-focus review): semantic disabled either
        // way, never plain native here.
        expect(harvestBtn(test.element)?.disabled).toBe(false);
        expect(harvestBtn(test.element)?.getAttribute('aria-disabled')).toBe('true');
        expect(harvestBtn(test.element)?.matches(':disabled, [aria-disabled="true"]')).toBe(true);
        expect(changeBtn(test.element)).toBe(change);
        expect(test.element.querySelector('.corpse-harvest-title')).toBe(title);
        // Previous status stays READABLE: not overwritten to "checking".
        expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(hint);
        expect(takeLootBtn(test.element)).not.toBeNull();
      });

      it("the handler itself refuses while pending, even if a stale caller bypasses the button's own aria-disabled flag", () => {
        const { test, harvest } = openAdmittedThenSlowRefresh();
        // Simulate a detached/bypassing caller: the busy overlay is
        // aria-disabled, not native `disabled`, so a caller could clear the
        // attribute and dispatch a raw click; the controller's own
        // `isHarvestQueryPendingFor` guard (independent of any DOM attribute)
        // is what actually refuses it.
        harvest?.removeAttribute('aria-disabled');

        harvest?.click();

        expect(test.harvestCorpse).not.toHaveBeenCalled();
      });

      it('restores the EXISTING button in place on a same-answer settle: no rebuild, no duplicate tooltip listener', async () => {
        const { test, harvest, hint, refresh } = openAdmittedThenSlowRefresh();
        const attachCallsBefore = test.attachTooltip.mock.calls.length;

        refresh.resolve(harvestInfo({ corpseId: 50, preference: { kind: 'all' } }));
        await flush();

        expect(harvestBtn(test.element)).toBe(harvest);
        expect(harvestBtn(test.element)?.disabled).toBe(false);
        // The busy overlay left by the in-flight refresh is cleared on settle.
        expect(harvestBtn(test.element)?.hasAttribute('aria-disabled')).toBe(false);
        expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(hint);
        expect(test.attachTooltip.mock.calls.length).toBe(attachCallsBefore);
      });

      it('a rebuild forced by an unrelated loot change WHILE a refresh is pending still shows the busy overlay on the fresh button', () => {
        const { test } = openAdmittedThenSlowRefresh();
        const mob = test.entities.get(50);
        if (!mob?.loot) throw new Error('fixture loot missing');

        // Unrelated data changes (a coin/loot bump), forcing renderCorpseBody
        // to rebuild the WHOLE popup body while the status refresh above is
        // still outstanding: the freshly minted Harvest button must be born
        // busy, never a plain enabled node that only a later toggle disables.
        mob.loot.copper += 1;
        test.controller.updateProximity();

        const rebuilt = harvestBtn(test.element);
        expect(rebuilt?.disabled).toBe(false);
        expect(rebuilt?.getAttribute('aria-disabled')).toBe('true');
        expect(rebuilt?.matches(':disabled, [aria-disabled="true"]')).toBe(true);
        rebuilt?.click();
        expect(test.harvestCorpse).not.toHaveBeenCalled();
      });

      it('relocalize() while a refresh is pending rebuilds with fresh text but keeps the busy overlay', () => {
        const { test } = openAdmittedThenSlowRefresh();

        i18nProbe.suffix = ' [xx]';
        test.controller.relocalize();

        const rebuilt = harvestBtn(test.element);
        expect(rebuilt?.textContent).toBe('Harvest [xx]');
        expect(rebuilt?.disabled).toBe(false);
        expect(rebuilt?.getAttribute('aria-disabled')).toBe('true');
      });

      it('a null settle while pending leaves Harvest honestly disabled, with no unhandled rejection', async () => {
        const { test, refresh } = openAdmittedThenSlowRefresh();

        refresh.resolve(null);
        await flush();

        expect(harvestBtn(test.element)?.disabled).toBe(true);
        expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
          'Harvest status is not available right now.',
        );
      });

      it('a rejected settle while pending is treated like null, with no unhandled rejection', async () => {
        const mob = entity(50, {
          kind: 'mob',
          templateId: harvestMobId,
          loot: { copper: 1, items: [] },
        });
        let calls = 0;
        let reject!: (err: unknown) => void;
        const rejectable = new Promise<CorpseHarvestInfo | null>((_res, rej) => {
          reject = rej;
        });
        const test = harness(
          [mob],
          (entry) => corpseLootAvailability(entry, 7),
          {},
          (id) => {
            calls += 1;
            return calls === 1
              ? harvestInfo({ corpseId: id, preference: { kind: 'all' } })
              : rejectable;
          },
        );
        test.controller.openCorpse(50, 0, 0);
        test.advanceClock(500);
        test.controller.updateProximity();

        reject(new Error('boom'));
        await flush();

        expect(harvestBtn(test.element)?.disabled).toBe(true);
      });
    });

    it('a synchronous same-answer read never toggles the button (no busy flicker, idle-DOM-write contract)', () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      const btn = harvestBtn(test.element);
      if (!btn) throw new Error('expected a Harvest button');
      let proto: object | null = Object.getPrototypeOf(btn);
      let accessor: PropertyDescriptor | undefined;
      while (proto && !accessor) {
        accessor = Object.getOwnPropertyDescriptor(proto, 'disabled');
        proto = Object.getPrototypeOf(proto);
      }
      if (!accessor?.get || !accessor.set) throw new Error('expected a disabled accessor');
      const getter = accessor.get;
      const setter = accessor.set;
      let writes = 0;
      Object.defineProperty(btn, 'disabled', {
        configurable: true,
        get: () => getter.call(btn),
        set: (v: boolean) => {
          writes += 1;
          setter.call(btn, v);
        },
      });

      test.advanceClock(500);
      test.controller.updateProximity();

      expect(writes).toBe(0);
      expect(btn.disabled).toBe(false);
    });

    it('a focused Change control degrades to Close, never to Harvest or Take Loot, on a rebuild', () => {
      const mob = entity(50, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 1, items: [] },
      });
      const { promise } = deferred<CorpseHarvestInfo | null>();
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        () => promise,
      );
      test.controller.openCorpse(50, 0, 0);
      changeBtn(test.element)?.focus();
      expect(document.activeElement).toBe(changeBtn(test.element));

      mob.harvestClaimedBy = 9;
      test.controller.updateProximity();

      expect(test.element.querySelector('.corpse-harvest')).toBeNull();
      expect(document.activeElement).toBe(test.element.querySelector('[data-close]'));
    });

    it('relocalize() rebuilds an open corpse popup once with fresh text, keeping focus', async () => {
      const mob = entity(90, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 3, items: [] },
      });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(90, 0, 0);
      await flush();
      changeBtn(test.element)?.focus();
      const hintBefore = test.element.querySelector('.town-focus-hint')?.textContent ?? '';

      i18nProbe.suffix = ' [xx]';
      test.controller.relocalize();

      const hint = test.element.querySelector('.town-focus-hint');
      expect(hint?.textContent).toBe(`${hintBefore} [xx]`);
      expect(takeLootBtn(test.element)?.textContent).toBe('Take Loot [xx]');
      expect(document.activeElement).toBe(changeBtn(test.element));
      // Re-latched, not cleared: the next poll rebuilds nothing.
      test.advanceClock(1000);
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

    it('keeps exactly one pending inspection across slow-driver polls AND repeated open events, reentrant sends included', () => {
      const reply = deferred<CorpseHarvestInfo | null>();
      let sendCalls = 0;
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        () => {
          sendCalls += 1;
          return reply.promise;
        },
      );

      test.controller.openCorpse(50, 0, 0);
      test.advanceClock(500);
      test.controller.updateProximity();
      test.controller.openCorpse(50, 0, 0);
      test.advanceClock(10_000);
      test.controller.updateProximity();
      test.controller.openCorpse(50, 0, 0);

      // Every poll/reopen above happened while the FIRST read was still
      // pending: one send, one attached handler set, however far past the
      // floor time advances.
      expect(sendCalls).toBe(1);
      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(1);
    });

    it('a synchronous (reentrant) settle installs its pending marker before the send, so a same-tick reopen shares it', () => {
      // The send callback itself calls back into the controller (an offline
      // Sim answering inline through a caller that also drives updateProximity
      // synchronously); the request identity must already be recorded before
      // `corpseHarvestInfo` is invoked, or this reentrant read would see no
      // pending marker and fire a second send.
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      let reentered = false;
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => {
          if (!reentered) {
            reentered = true;
            test.controller.updateProximity(); // reentrant, same tick
          }
          return harvestInfo({ corpseId: id, preference: { kind: 'all' } });
        },
      );

      test.controller.openCorpse(50, 0, 0);

      expect(test.corpseHarvestInfo).toHaveBeenCalledTimes(1);
    });

    it('retires the visit when the world identity changes, even with a reused entity id: no query, refresh, Harvest, or Change acts on the new world', () => {
      const mob = entity(50, {
        kind: 'mob',
        templateId: harvestMobId,
        loot: { copper: 1, items: [] },
      });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      const staleHarvest = harvestBtn(test.element);
      const staleChange = changeBtn(test.element);
      const staleTakeLoot = takeLootBtn(test.element);
      expect(staleHarvest?.disabled).toBe(false);

      // Swap the world identity under the open popup (a reconnect), reusing
      // the SAME numeric entity id in a structurally different world object.
      const swappedWorld = { ...test.world } as unknown as IWorld;
      (test.controller as unknown as { deps: { world(): IWorld } }).deps.world = () => swappedWorld;

      staleHarvest?.click();
      staleChange?.click();
      staleTakeLoot?.click();
      test.controller.updateProximity();

      expect(test.harvestCorpse).not.toHaveBeenCalled();
      expect(test.openHarvestPreference).not.toHaveBeenCalled();
      expect(test.lootCorpse).not.toHaveBeenCalled();
      // The stale visit was retired (closed) rather than silently continuing
      // against the new world.
      expect(test.element.style.display).toBe('none');
    });

    it('a detached Change control cannot open settings after its visit closes', () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      const stale = changeBtn(test.element);

      test.controller.close();
      stale?.click();

      expect(test.openHarvestPreference).not.toHaveBeenCalled();
    });

    it('a detached Change control cannot open settings after a DIFFERENT body is opened', () => {
      const a = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const b = entity(51, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [a, b],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) => harvestInfo({ corpseId: id, preference: { kind: 'all' } }),
      );
      test.controller.openCorpse(50, 0, 0);
      const stale = changeBtn(test.element);

      test.controller.openCorpse(51, 0, 0);
      stale?.click();

      expect(test.openHarvestPreference).not.toHaveBeenCalled();
    });

    it('never enables harvesting from an answer naming a different corpse than the one queried', async () => {
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        () => harvestInfo({ corpseId: 999, preference: { kind: 'all' } }),
      );

      test.controller.openCorpse(50, 0, 0);
      await flush();

      expect(harvestBtn(test.element)?.disabled).toBe(true);
      expect(test.element.querySelector('.corpse-harvest-hint')?.textContent).toBe(
        'Harvest status is not available right now.',
      );
      harvestBtn(test.element)?.click();
      expect(test.harvestCorpse).not.toHaveBeenCalled();
    });

    it('Change uses the AUTHORITATIVE server-confirmed tags once answered, never the local availability tags, and never falls back to All for a retired choice', async () => {
      // The local (synchronous) availability tags differ from what the
      // server actually confirms for this body; once answered, Change (and
      // the available-materials list) must follow the authoritative tags.
      const authoritativeTags = ['fang'];
      const mob = entity(50, { kind: 'mob', templateId: harvestMobId, loot: null });
      const test = harness(
        [mob],
        (entry) => corpseLootAvailability(entry, 7),
        {},
        (id) =>
          harvestInfo({
            corpseId: id,
            componentTags: authoritativeTags,
            preference: { kind: 'material', itemId: 'no-such-retired-item' },
            denial: 'material_unavailable',
          }),
      );
      test.controller.openCorpse(50, 0, 0);
      await flush();

      // Never silently retargeted to All: the denial and the named material
      // both stay exactly what the server answered.
      const hint = test.element.querySelector('.corpse-harvest-hint')?.textContent ?? '';
      expect(hint).toContain('is not on this body');
      expect(hint).not.toContain('All materials');

      changeBtn(test.element)?.click();
      expect(test.openHarvestPreference).toHaveBeenCalledWith(authoritativeTags);
      // NOT the local fallback (harvestMobTags), which differs from the
      // authoritative answer above.
      expect(test.openHarvestPreference).not.toHaveBeenCalledWith(harvestMobTags);
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
