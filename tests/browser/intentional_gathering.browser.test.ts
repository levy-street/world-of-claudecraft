import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { corpseLootAvailabilityInWorld } from '../../src/game/corpse_loot_availability';
import {
  clearPadFocus,
  focusFirstInWindow,
  moveDpadFocus,
  pressDpadFocus,
  syncWindowFocus,
} from '../../src/game/dpad_focus_nav';
import { Input, type InputCallbacks } from '../../src/game/input';
import { Keybinds } from '../../src/game/keybinds';
import { tryNearbyInteraction } from '../../src/game/nearby_interaction';
import { FARM_CROPS } from '../../src/sim/content/farm_crops';
import type { HarvestPreference } from '../../src/sim/professions/harvest_preference';
import type { Entity } from '../../src/sim/types';
import { FocusManager, type FocusTrapHandle } from '../../src/ui/focus_manager';
import { Hud } from '../../src/ui/hud';
import {
  LootWindowController,
  type LootWindowControllerDeps,
} from '../../src/ui/hud/loot/loot_window_controller';
import { PlantSheetWindow } from '../../src/ui/hud/professions/farming_plant_sheet_window';
import { HarvestPreferenceController } from '../../src/ui/hud/professions/harvest_preference_controller';
import { ProfessionsWindow } from '../../src/ui/hud/professions/professions_window';
import { makeWindowFocus } from '../../src/ui/window_focus';
import type { CorpseHarvestInfo, IWorld } from '../../src/world_api';
import type { FarmPlotView } from '../../src/world_api/farming';
import { cleanup, stubDeps } from './_harness';

const BED = 'bed_eastbrook_1';
const CRAFTS = [
  'engineering',
  'alchemy',
  'cooking',
  'leatherworking',
  'tailoring',
  'inscription',
  'enchanting',
  'jewelcrafting',
  'weaponcrafting',
  'armorcrafting',
];
let current: ReturnType<typeof mount> | null = null;

beforeAll(() => {
  localStorage.clear();
  const canvas = document.createElement('canvas');
  new Input(
    canvas,
    stubDeps<InputCallbacks>({
      onUiKey: (key) => {
        if (key === 'interact') current?.interact();
        if (key === 'professions') current?.professions.open();
      },
      canUseGameKeys: () => true,
    }),
    new Keybinds(),
  );
});

afterEach(() => {
  current?.closeConfirm();
  current?.loot.close();
  current?.plant.close();
  current?.professions.close();
  current?.harvestPreference.close();
  current = null;
  clearPadFocus();
  cleanup();
  document.body.className = '';
});

function root(id: string, parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'window panel';
  el.style.display = 'none';
  parent.appendChild(el);
  return el;
}

function mount(mobile: boolean) {
  document.body.className = mobile
    ? 'game-active mobile-touch mobile-window-open hud-mobile-compact ' +
      (innerWidth > innerHeight ? 'hud-mobile-landscape' : 'hud-mobile-portrait')
    : 'game-active';
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  // Match the production entry's DOM order. Loot is mounted before Professions.
  const lootRoot = root('loot-window', ui);
  const profRoot = root('professions-window', ui);
  const plantRoot = root('plant-sheet-window', ui);
  const harvestPreferenceRoot = root('harvest-preference-window', ui);
  profRoot.style.zIndex = mobile ? '95' : '51';
  lootRoot.style.zIndex = mobile ? '95' : '52';
  plantRoot.style.zIndex = mobile ? '95' : '53';
  harvestPreferenceRoot.style.zIndex = mobile ? '95' : '54';
  const fm = new FocusManager();
  const corpse = {
    id: 90,
    kind: 'mob',
    templateId: 'forest_wolf',
    name: 'Forest Wolf',
    pos: { x: 1, y: 0, z: 0 },
    dead: true,
    hostile: true,
    lootable: true,
    corpseTimer: 10,
    lootFfaTimer: 0,
    tappedById: 7,
    ownerId: null,
    harvestClaimedBy: null,
    loot: { copper: 2, items: [] },
  } as unknown as Entity;
  const player = {
    id: 7,
    name: 'Gatherer',
    dead: false,
    targetId: null,
    level: 1,
    pos: { x: 0, y: 0, z: 0 },
  } as Entity;
  const world = {
    player,
    playerId: 7,
    entities: new Map([[90, corpse]]),
    partyInfo: null,
    inventory: [],
    townFocus: {},
    questLog: new Map(),
    questsDone: new Set<string>(),
    myFarmPlots: [] as FarmPlotView[],
    farmPatches: [] as IWorld['farmPatches'],
    professionsState: { skills: [] },
    gatheringProficiency: {},
    toolEffectSlots: [],
    harvestPreference: { kind: 'all' } as HarvestPreference | null,
    setHarvestPreference: vi.fn<(raw: string) => void>(),
    craftingIdentity: {
      version: 1,
      synced: true,
      craftSkills: Object.fromEntries(CRAFTS.map((id) => [id, 0])),
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
      switchCount: 0,
      amendsProgress: 0,
      amendsRequired: 11,
    },
    lootCorpse: vi.fn(() => {
      corpse.loot = null;
    }),
    // A real boolean (cast-started outcome), not a controlled promise: this
    // fixture always answers synchronously. tests/harvest_preference_*.test.ts
    // cover the async wire path; this rig only proves the real controllers
    // wire the outcome through correctly.
    harvestCorpse: vi.fn(() => true),
    harvestCrop: vi.fn(),
    harvestNode: vi.fn(),
    plantCrop: vi.fn(),
    corpseHarvestInfo: vi.fn(
      (id: number): CorpseHarvestInfo => ({
        corpseId: id,
        componentTags: ['hide', 'fang'],
        preference: world.harvestPreference,
        denial: null,
        reservation: null,
        tierBonus: 0,
      }),
    ),
  };
  const live = () => world as unknown as IWorld;
  const centerPopup = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    el.style.left = Math.max(10, (innerWidth - rect.width) / 2) + 'px';
    el.style.top = Math.max(10, (innerHeight - rect.height) / 2) + 'px';
    el.style.transform = 'none';
  };
  const errors = vi.fn();
  // Exercise the shipped confirm method without booting the HUD or renderer.
  const modalHost = {
    focusManager: fm,
    confirmTrap: null as FocusTrapHandle | null,
    confirmOnCancel: null as (() => void) | null,
    fireConfirmCancel: vi.fn(),
    bringWindowToFront: (el: HTMLElement) => {
      el.style.zIndex = '60';
    },
  };
  const confirm = (
    Hud.prototype as unknown as {
      confirmDialog: LootWindowControllerDeps['confirm'];
    }
  ).confirmDialog.bind(modalHost);
  // The real shared picker (Intentional Gathering PR3), wired the way hud.ts
  // wires it: closeOthers is a no-op like the real Hud.closeOtherWindows
  // (siblings are never closed by opening another window), so a corpse Change
  // press must never close the corpse popup underneath it.
  const harvestPreference = new HarvestPreferenceController(
    stubDeps({
      root: () => harvestPreferenceRoot,
      world: live,
      closeOthers: () => {},
      ...makeWindowFocus(fm, () => harvestPreferenceRoot),
    }),
  );
  const loot = new LootWindowController(
    stubDeps({
      element: lootRoot,
      document,
      world: live,
      corpseAvailability: (entity: Entity) => corpseLootAvailabilityInWorld(live(), entity),
      entityName: (entity: Entity) => entity.name,
      showError: errors,
      money: (copper: number) => copper + 'c',
      coinIconUrl: () => 'data:,',
      itemIcon: () => '',
      itemTooltip: () => '',
      centerPopup,
      placePopup: (el: HTMLElement) => centerPopup(el),
      confirm,
      openHarvestPreference: (componentTags: readonly string[]) =>
        harvestPreference.open(componentTags),
      now: () => Date.now(),
      ...makeWindowFocus(fm, () => lootRoot),
    }),
  );
  const professions = new ProfessionsWindow(
    stubDeps({
      root: () => profRoot,
      world: live,
      consumePeek: () => false,
      itemIcon: () => '',
      moneyHtml: () => '',
      itemTooltip: () => '',
      harvestBody: () => loot.openHarvestBodyChoice(),
      openHarvestPreference: () => harvestPreference.open(),
      ...makeWindowFocus(fm, () => profRoot),
    }),
  );
  const plant = new PlantSheetWindow(
    stubDeps({
      root: () => plantRoot,
      world: live,
      ...makeWindowFocus(fm, () => plantRoot),
    }),
  );
  const nearbyHud = stubDeps<Parameters<typeof tryNearbyInteraction>[1]>({
    openPlantSheet: (id: string) => plant.open(id),
    showError: errors,
  });
  const rig = {
    world,
    corpse,
    loot,
    plant,
    professions,
    harvestPreference,
    lootRoot,
    profRoot,
    plantRoot,
    harvestPreferenceRoot,
    errors,
    closeConfirm: () => modalHost.confirmTrap?.release(false),
    interact: () =>
      tryNearbyInteraction(world as unknown as IWorld, nearbyHud, 'Escort away', 'Nothing nearby'),
  };
  current = rig;
  return rig;
}

function button(root: HTMLElement, selector: string): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(selector);
  if (!el) throw new Error('Missing control: ' + selector);
  return el;
}

function readyBed(h: ReturnType<typeof mount>): void {
  h.world.entities.clear();
  h.world.farmPatches = [
    {
      id: 'test_patch',
      zoneId: 'eastbrook_vale',
      tier: 1,
      x: 0,
      z: 0,
      beds: [{ id: BED, x: 0, z: 0 }],
    },
  ];
  h.world.myFarmPlots = [
    {
      bedId: BED,
      cropId: FARM_CROPS.vale_wheat.id,
      plantedAtMs: 0,
      readyAtMs: 1,
      compost: false,
      watch: false,
      tonic: false,
      notified: true,
      status: 'ready',
    },
  ];
}

function expectTouchable(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  expect(r.width).toBeGreaterThanOrEqual(40);
  expect(r.height).toBeGreaterThanOrEqual(40);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(innerWidth);
  expect(r.bottom).toBeLessThanOrEqual(innerHeight);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  expect(hit === el || (hit !== null && el.contains(hit))).toBe(true);
}

describe('intentional gathering through real browser input', () => {
  it('repeated F takes ordinary loot and opens a crop choice without gathering', async () => {
    await page.viewport(1280, 720);
    const h = mount(false);
    await userEvent.keyboard('[KeyF][KeyF][KeyF]');
    expect(h.world.lootCorpse).toHaveBeenCalledTimes(1);
    expect(h.world.harvestCorpse).not.toHaveBeenCalled();
    expect(h.world.harvestNode).not.toHaveBeenCalled();
    expect(h.corpse.harvestClaimedBy).toBeNull();
    readyBed(h);
    await userEvent.keyboard('[KeyF][KeyF]');
    expect(h.plantRoot.style.display).toBe('flex');
    expect(h.world.harvestCrop).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(h.plantRoot, '[data-close]'));
    focusFirstInWindow();
    expect(document.activeElement).toBe(button(h.plantRoot, '[data-close]'));
    await page.screenshot({
      path: '../../docs/screenshots/intentional-gathering-pr1/crop-choice-desktop.png',
    });
    await userEvent.keyboard('[Tab][Enter]');
    expect(h.world.harvestCrop).toHaveBeenCalledExactlyOnceWith(BED);
  });

  it.each([false, true])(
    'keyboard and pad choose Harvest explicitly, mobile=%s',
    async (mobile) => {
      await page.viewport(mobile ? 844 : 1280, mobile ? 390 : 720);
      const h = mount(mobile);
      h.corpse.loot = null;
      await userEvent.keyboard('[ShiftLeft>][KeyP][/ShiftLeft]');
      const entry = button(h.profRoot, '[data-harvest-body]');
      await userEvent.keyboard('[Tab][Enter]');
      expect(h.lootRoot.style.display).toBe('block');
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
      const close = button(h.lootRoot, '[data-close]');
      expect(document.activeElement).toBe(close);
      if (!mobile)
        await page.screenshot({
          path: '../../docs/screenshots/intentional-gathering-pr1/corpse-choice-desktop.png',
        });
      // The real pad navigator must follow the popup, despite production DOM order.
      focusFirstInWindow();
      expect(document.activeElement).toBe(close);
      expect(pressDpadFocus()).toBe(true);
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(document.activeElement).toBe(entry));
      await userEvent.keyboard('[Enter]');
      syncWindowFocus();
      expect(document.activeElement).toBe(button(h.lootRoot, '[data-close]'));
      const harvest = button(h.lootRoot, '.corpse-harvest-btn');
      for (let i = 0; i < 10 && document.activeElement !== harvest; i++) moveDpadFocus('down');
      expect(document.activeElement).toBe(harvest);
      if (mobile) expectTouchable(harvest);
      expect(pressDpadFocus()).toBe(true);
      expect(h.world.harvestCorpse).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { layout: 'landscape', width: 844, height: 390 },
    { layout: 'portrait', width: 390, height: 844 },
  ])(
    'mobile $layout can inspect a body and explicitly harvest',
    async ({ layout, width, height }) => {
      await page.viewport(width, height);
      const h = mount(true);
      h.corpse.loot = null;
      h.professions.open();
      const entry = button(h.profRoot, '[data-harvest-body]');
      expectTouchable(entry);
      await userEvent.click(entry);
      const harvest = button(h.lootRoot, '.corpse-harvest-btn');
      expectTouchable(harvest);
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
      await page.screenshot({
        path: `../../docs/screenshots/intentional-gathering-pr1/corpse-choice-mobile-${layout}.png`,
      });
      await userEvent.click(harvest);
      expect(h.world.harvestCorpse).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { layout: 'landscape', width: 844, height: 390 },
    { layout: 'portrait', width: 390, height: 844 },
  ])(
    'mobile $layout opens a crop choice without collecting it',
    async ({ layout, width, height }) => {
      await page.viewport(width, height);
      const h = mount(true);
      readyBed(h);
      await userEvent.keyboard('[KeyF][KeyF]');
      const harvest = button(h.plantRoot, '[data-harvest]');
      expect(h.world.harvestCrop).not.toHaveBeenCalled();
      expectTouchable(harvest);
      await page.screenshot({
        path: `../../docs/screenshots/intentional-gathering-pr1/crop-choice-mobile-${layout}.png`,
      });
      await userEvent.click(harvest);
      expect(h.world.harvestCrop).toHaveBeenCalledExactlyOnceWith(BED);
    },
  );

  it.each([false, true])(
    'the bind confirmation keeps pad focus above the corpse, mobile=%s',
    async (mobile) => {
      await page.viewport(mobile ? 844 : 1280, mobile ? 390 : 720);
      const h = mount(mobile);
      h.corpse.loot = {
        copper: 0,
        items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }],
      };
      h.professions.open();
      button(h.profRoot, '[data-harvest-body]').focus();
      await userEvent.keyboard('[Enter]');
      await userEvent.click(button(h.lootRoot, '.btn:not(.corpse-harvest-btn)'));
      const modal = document.getElementById('confirm-dialog');
      expect(modal).not.toBeNull();
      if (!modal) throw new Error('Bind confirmation did not open');
      focusFirstInWindow();
      expect(modal.contains(document.activeElement)).toBe(true);
      const ok = button(modal, '[data-ok]');
      if (mobile) expectTouchable(ok);
      ok.focus();
      h.world.entities.clear();
      h.loot.updateProximity();
      // The window-focus bridge settles its return in a zero-delay timer.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(document.activeElement).toBe(ok);
      expect(h.lootRoot.style.display).toBe('none'); // the body really did go away
      expect(modal.isConnected).toBe(true); // the confirmation did not
      await userEvent.click(ok);
      expect(h.world.lootCorpse).not.toHaveBeenCalled();
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
      // Answering it returns to the opener the corpse popup handed up, never a
      // control stranded inside the closed popup.
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(button(h.profRoot, '[data-harvest-body]')),
      );
    },
  );

  it.each([false, true])(
    'the bind confirmation survives a live corpse repaint before the body goes, mobile=%s',
    async (mobile) => {
      // The popup is a LIVE view: an ordinary loot change repaints its body and
      // destroys the very button the confirmation was opened from. Whatever
      // decides where that confirmation returns cannot depend on finding that
      // element again, because by then it is not in the document at all.
      await page.viewport(mobile ? 844 : 1280, mobile ? 390 : 720);
      const h = mount(mobile);
      h.corpse.loot = {
        copper: 0,
        items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }],
      };
      h.professions.open();
      const entry = button(h.profRoot, '[data-harvest-body]');
      entry.focus();
      await userEvent.keyboard('[Enter]');
      const take = button(h.lootRoot, '.btn:not(.corpse-harvest-btn)');
      await userEvent.click(take);
      const modal = document.getElementById('confirm-dialog');
      if (!modal) throw new Error('Bind confirmation did not open');
      const ok = button(modal, '[data-ok]');
      ok.focus();

      // A harmless visible loot change (coin appears), NOT the bind item leaving.
      h.corpse.loot = { copper: 1, items: [{ itemId: 'heroic_mark', count: 1, personalFor: [7] }] };
      h.loot.updateProximity();
      expect(take.isConnected).toBe(false); // the opener was rebuilt away
      expect(h.lootRoot.style.display).toBe('block'); // ... while the popup lives on
      expect(document.activeElement).toBe(ok); // a repaint never steals focus

      h.world.entities.clear();
      h.loot.updateProximity();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(document.activeElement).toBe(ok);
      expect(modal.isConnected).toBe(true);
      await userEvent.click(ok);
      expect(h.world.lootCorpse).not.toHaveBeenCalled();
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(document.activeElement).toBe(entry));
    },
  );
});
