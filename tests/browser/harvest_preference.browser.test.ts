// Real-browser coverage for the shared corpse-harvest preference picker
// (Intentional Gathering PR3): composes the REAL HarvestPreferenceController
// and the REAL LootWindowController (the corpse Change entrance) over the
// real FocusManager/window_focus bridge and the real CSS barrel, so the
// picker's roving-radio APG pattern, Apply/Cancel commit boundary, and focus
// return are proven against actual rendered DOM rather than a reimplemented
// stand-in. The corpse cast admission itself is covered by the sim suites
// (src/sim/professions/harvest_admission.ts and friends); nothing here
// claims to prove the mocked `harvestCorpse`/`corpseHarvestInfo` outcomes
// are real gameplay.
//
// Async popup reply/stale-generation boundary cases already have dedicated
// coverage (tests/loot_window_controller.test.ts, tests/harvest_preference_
// controller.test.ts); this file does not re-run that matrix.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { corpseLootAvailabilityInWorld } from '../../src/game/corpse_loot_availability';
import type { HarvestPreference } from '../../src/sim/professions/harvest_preference';
import type { Entity } from '../../src/sim/types';
import { FocusManager, type FocusTrapHandle } from '../../src/ui/focus_manager';
import { Hud } from '../../src/ui/hud';
import {
  LootWindowController,
  type LootWindowControllerDeps,
} from '../../src/ui/hud/loot/loot_window_controller';
import { HarvestPreferenceController } from '../../src/ui/hud/professions/harvest_preference_controller';
import { makeWindowFocus } from '../../src/ui/window_focus';
import type { CorpseHarvestInfo, IWorld } from '../../src/world_api';
import { cleanup, stubDeps } from './_harness';

let current: ReturnType<typeof mount> | null = null;

afterEach(() => {
  current?.harvestPreference.close();
  current?.loot.close();
  current = null;
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

function button(el: HTMLElement, selector: string): HTMLButtonElement {
  const found = el.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error('Missing control: ' + selector);
  return found;
}

function radioRows(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function expectTouchable(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  expect(r.width).toBeGreaterThanOrEqual(40);
  expect(r.height).toBeGreaterThanOrEqual(40);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(innerWidth);
  expect(r.bottom).toBeLessThanOrEqual(innerHeight);
}

function expectNoHorizontalOverflow(el: HTMLElement): void {
  expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
}

function mount(mobile: boolean, info: CorpseHarvestInfo | null) {
  document.body.className = mobile
    ? 'game-active mobile-touch mobile-window-open hud-mobile-compact ' +
      (innerWidth > innerHeight ? 'hud-mobile-landscape' : 'hud-mobile-portrait')
    : 'game-active';
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const lootRoot = root('loot-window', ui);
  const harvestPreferenceRoot = root('harvest-preference-window', ui);
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
    loot: null,
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
    // The SAME stored character preference the corpse-status query (`info`)
    // reports back: both read off one PlayerMeta.harvestPreference in
    // production, so a fixture that hardcoded this to All while `info` named
    // a material desynced the picker (reading this field) from the corpse
    // panel (reading `info.preference`). `info === null` is the malformed
    // load itself, kept explicitly null rather than normalized to All.
    harvestPreference: (info ? info.preference : null) as HarvestPreference | null,
    setHarvestPreference: vi.fn<(raw: string) => void>(),
    harvestCorpse: vi.fn(() => true),
    corpseHarvestInfo: vi.fn<() => ReturnType<IWorld['corpseHarvestInfo']>>(() => info),
  };
  const live = () => world as unknown as IWorld;
  const centerPopup = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    el.style.left = Math.max(10, (innerWidth - rect.width) / 2) + 'px';
    el.style.top = Math.max(10, (innerHeight - rect.height) / 2) + 'px';
    el.style.transform = 'none';
  };
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
    Hud.prototype as unknown as { confirmDialog: LootWindowControllerDeps['confirm'] }
  ).confirmDialog.bind(modalHost);
  // Mirrors real hud.ts wiring: opening the picker's closeOthers is a no-op
  // (Hud.closeOtherWindows only clears transient overlays, never a sibling
  // window), so the corpse popup underneath a Change press must stay open.
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
      showError: vi.fn(),
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
  const rig = { world, corpse, loot, harvestPreference, lootRoot, harvestPreferenceRoot };
  current = rig;
  return rig;
}

function openCorpse(h: ReturnType<typeof mount>): void {
  h.loot.openCorpse(90, 200, 200);
}

async function openChange(h: ReturnType<typeof mount>): Promise<void> {
  openCorpse(h);
  await userEvent.click(button(h.lootRoot, '.corpse-harvest-change-btn'));
}

const SETTLED_ALL: CorpseHarvestInfo = {
  corpseId: 90,
  componentTags: ['hide', 'fang'],
  preference: { kind: 'all' },
  denial: null,
  reservation: null,
  tierBonus: 0,
};

describe('harvest-preference picker: real controllers, real DOM', () => {
  it('opening the corpse never auto-harvests', () => {
    const h = mount(false, SETTLED_ALL);
    openCorpse(h);
    expect(h.world.harvestCorpse).not.toHaveBeenCalled();
  });

  it('Change opens the shared picker without sending a preference or a harvest', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    expect(h.harvestPreference.isOpen).toBe(true);
    expect(h.harvestPreferenceRoot.style.display).toBe('flex');
    // The corpse popup underneath stays open: Hud.closeOtherWindows only
    // clears transient overlays, never a sibling window.
    expect(h.lootRoot.style.display).toBe('block');
    expect(h.world.setHarvestPreference).not.toHaveBeenCalled();
    expect(h.world.harvestCorpse).not.toHaveBeenCalled();
  });

  it('a draft row pick does not persist until Apply', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const rows = radioRows(h.harvestPreferenceRoot);
    const hideRow = rows.find((r) => r.dataset.token === 'rough_hide');
    if (!hideRow) throw new Error('rough_hide row not rendered');
    await userEvent.click(hideRow);
    expect(hideRow.getAttribute('aria-checked')).toBe('true');
    expect(h.world.setHarvestPreference).not.toHaveBeenCalled();

    await userEvent.click(button(h.harvestPreferenceRoot, '.harvest-preference-actions .btn'));
    expect(h.world.setHarvestPreference).toHaveBeenCalledExactlyOnceWith('rough_hide');
  });

  it('Cancel discards the draft and preserves the stored preference', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const rows = radioRows(h.harvestPreferenceRoot);
    const fangRow = rows.find((r) => r.dataset.token === 'wolf_fang');
    if (!fangRow) throw new Error('wolf_fang row not rendered');
    await userEvent.click(fangRow);
    expect(h.world.setHarvestPreference).not.toHaveBeenCalled();

    const cancelBtn = button(h.harvestPreferenceRoot, '.btn-secondary');
    await userEvent.click(cancelBtn);

    expect(h.world.setHarvestPreference).not.toHaveBeenCalled();
    expect(h.harvestPreference.isOpen).toBe(false);

    // Reopening starts a fresh visit off the untouched stored preference (All).
    await openChange(h);
    const allRow = radioRows(h.harvestPreferenceRoot).find((r) => r.dataset.token === 'all');
    expect(allRow?.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the checked All row for an All preference', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const rows = radioRows(h.harvestPreferenceRoot);
    const checked = rows.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked?.dataset.token).toBe('all');
    expect(
      h.harvestPreferenceRoot.querySelector('.harvest-preference-current-unavailable'),
    ).toBeNull();
  });

  it('shows the checked material row for a material preference this body offers', async () => {
    const h = mount(false, {
      ...SETTLED_ALL,
      preference: { kind: 'material', itemId: 'rough_hide' },
    });
    await openChange(h);
    const checked = radioRows(h.harvestPreferenceRoot).find(
      (r) => r.getAttribute('aria-checked') === 'true',
    );
    expect(checked?.dataset.token).toBe('rough_hide');
  });

  it('names a stored material this body does not offer as unavailable, never checked', async () => {
    const h = mount(false, {
      ...SETTLED_ALL,
      preference: { kind: 'material', itemId: 'spider_silk' },
      denial: 'material_unavailable',
    });
    await openChange(h);
    const checked = radioRows(h.harvestPreferenceRoot).find(
      (r) => r.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toBeUndefined();
    const note = h.harvestPreferenceRoot.querySelector('.harvest-preference-current-unavailable');
    expect(note?.textContent).toContain('Spider Silk');
  });

  it('a retired/unknown stored material id falls back to the generic unavailable line, never the raw id', async () => {
    const h = mount(false, {
      ...SETTLED_ALL,
      preference: { kind: 'material', itemId: 'zzz_no_longer_a_real_item' },
      denial: 'material_unavailable',
    });
    await openChange(h);
    const note = h.harvestPreferenceRoot.querySelector('.harvest-preference-current-unavailable');
    expect(note?.textContent).not.toContain('zzz_no_longer_a_real_item');
    expect(note?.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('Home/End and both-axis arrows move the roving radio pick, never sending a command', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const rows = () => radioRows(h.harvestPreferenceRoot);
    const allRow = rows().find((r) => r.dataset.token === 'all');
    allRow?.focus();
    expect(document.activeElement).toBe(allRow);

    await userEvent.keyboard('[End]');
    const last = rows()[rows().length - 1];
    expect(document.activeElement).toBe(last);
    expect(last.getAttribute('aria-checked')).toBe('true');

    await userEvent.keyboard('[Home]');
    expect(document.activeElement).toBe(rows()[0]);
    expect(rows()[0].getAttribute('aria-checked')).toBe('true');

    await userEvent.keyboard('[ArrowDown]');
    expect(document.activeElement).toBe(rows()[1]);
    await userEvent.keyboard('[ArrowRight]');
    expect(document.activeElement).toBe(rows()[2 % rows().length]);
    await userEvent.keyboard('[ArrowUp]');

    expect(h.world.setHarvestPreference).not.toHaveBeenCalled();
  });

  it('Tab reaches Apply then Cancel after the roving radio group', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const rows = radioRows(h.harvestPreferenceRoot);
    const checked = rows.find((r) => r.getAttribute('aria-checked') === 'true');
    checked?.focus();
    await userEvent.keyboard('[Tab]');
    expect(document.activeElement).toBe(
      button(h.harvestPreferenceRoot, '.harvest-preference-actions .btn'),
    );
    await userEvent.keyboard('[Tab]');
    expect(document.activeElement).toBe(button(h.harvestPreferenceRoot, '.btn-secondary'));
  });

  it('returns focus to the corpse body Change control on Cancel', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const changeBtn = button(h.lootRoot, '.corpse-harvest-change-btn');
    await userEvent.click(button(h.harvestPreferenceRoot, '.btn-secondary'));
    expect(document.activeElement).toBe(changeBtn);
  });

  it('returns focus to the corpse body Change control on Apply too', async () => {
    const h = mount(false, SETTLED_ALL);
    await openChange(h);
    const changeBtn = button(h.lootRoot, '.corpse-harvest-change-btn');
    const allRow = radioRows(h.harvestPreferenceRoot).find((r) => r.dataset.token === 'all');
    if (!allRow) throw new Error('all row not rendered');
    await userEvent.click(allRow);
    await userEvent.click(button(h.harvestPreferenceRoot, '.harvest-preference-actions .btn'));
    expect(document.activeElement).toBe(changeBtn);
  });

  it.each([
    { layout: 'landscape', width: 844, height: 390 },
    { layout: 'portrait', width: 390, height: 844 },
  ])(
    'mobile $layout: every picker control clears the 40x40 touch floor',
    async ({ width, height }) => {
      await page.viewport(width, height);
      const h = mount(true, SETTLED_ALL);
      await openChange(h);
      for (const row of radioRows(h.harvestPreferenceRoot)) expectTouchable(row);
      expectTouchable(button(h.harvestPreferenceRoot, '.harvest-preference-actions .btn'));
      expectTouchable(button(h.harvestPreferenceRoot, '.btn-secondary'));
    },
  );

  it('mobile landscape: the panel stays within the viewport with internal scroll, no horizontal overflow', async () => {
    await page.viewport(844, 390);
    const h = mount(true, SETTLED_ALL);
    await openChange(h);
    const rect = h.harvestPreferenceRoot.getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(innerWidth + 1);
    expect(rect.bottom).toBeLessThanOrEqual(innerHeight + 1);
    expectNoHorizontalOverflow(h.harvestPreferenceRoot);
  });

  it('a long unbroken status line wraps instead of forcing horizontal scroll (picker and corpse body)', async () => {
    await page.viewport(1280, 720);
    const longName = 'X'.repeat(120);
    const h = mount(false, {
      ...SETTLED_ALL,
      denial: 'reserved',
      reservation: { name: longName, self: false },
    });
    openCorpse(h);
    expectNoHorizontalOverflow(h.lootRoot);
    expect(h.lootRoot.querySelector('.corpse-harvest-hint')?.textContent).toContain(longName);

    await userEvent.click(button(h.lootRoot, '.corpse-harvest-change-btn'));
    expectNoHorizontalOverflow(h.harvestPreferenceRoot);
  });
  it('retains keyboard focus on Harvest while its status refresh is pending', async () => {
    const h = mount(false, SETTLED_ALL);
    openCorpse(h);
    const harvest = button(h.lootRoot, '.corpse-harvest-btn');
    harvest.focus();
    expect(document.activeElement).toBe(harvest);
    let resolve!: (value: CorpseHarvestInfo | null) => void;
    const reply = new Promise<CorpseHarvestInfo | null>((done) => {
      resolve = done;
    });
    h.world.corpseHarvestInfo.mockReturnValue(reply);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 501);
    try {
      h.loot.updateProximity();
      expect(document.activeElement).toBe(harvest);
      harvest.click();
      expect(h.world.harvestCorpse).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      resolve(SETTLED_ALL);
      await reply;
    }
  });
});
