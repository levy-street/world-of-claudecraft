// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { LootWindowController } from '../src/ui/hud/loot/loot_window_controller';
import type { CorpseHarvestInfo, IWorld } from '../src/world_api';

function info(corpseId = 10): CorpseHarvestInfo {
  return {
    corpseId,
    componentTags: ['hide', 'fang'],
    preference: { kind: 'all' },
    denial: null,
    reservation: null,
    tierBonus: 0,
  };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function rig(read: (id: number) => ReturnType<IWorld['corpseHarvestInfo']>) {
  const root = document.createElement('div');
  document.body.append(root);
  const mob = createMob(10, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 60;
  mob.lootable = true;
  mob.loot = { copper: 10, items: [] };
  const query = vi.fn(read);
  const harvest = vi.fn(() => true);
  let world = {
    entities: new Map([[10, mob]]),
    playerId: 7,
    player: { dead: false, pos: { x: 0, y: 0, z: 0 } },
    corpseHarvestInfo: query,
    harvestCorpse: harvest,
    lootCorpse: vi.fn(() => true),
  } as unknown as IWorld;
  let now = 0;
  const change = vi.fn();
  const controller = new LootWindowController({
    element: root,
    document,
    world: () => world,
    corpseAvailability: (body) => corpseLootAvailability(body, 7),
    closeTransient: vi.fn(),
    hideTooltip: vi.fn(),
    showError: vi.fn(),
    entityName: (body) => body.name,
    money: String,
    coinIconUrl: () => '',
    itemIcon: () => '',
    itemTooltip: () => '',
    attachTooltip: vi.fn(),
    confirm: vi.fn(),
    centerPopup: vi.fn(),
    placePopup: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    openHarvestPreference: change,
    now: () => now,
  });
  return {
    root,
    mob,
    query,
    harvest,
    change,
    controller,
    advance: (ms: number) => {
      now += ms;
    },
    swapWorld: () => {
      world = { ...world, harvestCorpse: vi.fn(() => true) };
      return world;
    },
    harvestButton: () => root.querySelector<HTMLButtonElement>('.corpse-harvest-btn'),
  };
}
beforeEach(() => {
  document.body.replaceChildren();
});

describe('corpse popup asynchronous boundaries', () => {
  it('keeps one pending inspection across slow-driver polls and repeated open events', () => {
    const reply = pending<CorpseHarvestInfo | null>();
    const r = rig(() => reply.promise);
    r.controller.openCorpse(10, 100, 100);
    r.advance(500);
    r.controller.updateProximity();
    r.controller.openCorpse(10, 100, 100);
    expect(r.query).toHaveBeenCalledTimes(1);
    r.controller.close();
    reply.resolve(null);
  });
  it('never enables harvesting from an answer naming a different corpse', () => {
    const r = rig(() => info(11));
    r.controller.openCorpse(10, 100, 100);
    expect(r.harvestButton()?.disabled).toBe(true);
    r.harvestButton()?.click();
    expect(r.harvest).not.toHaveBeenCalled();
  });
  it('keeps repeated open events within the status read cadence', () => {
    const r = rig(() => info());
    r.controller.openCorpse(10, 100, 100);
    r.controller.openCorpse(10, 100, 100);
    expect(r.query).toHaveBeenCalledTimes(1);
  });
  it('retires the old visit when the world changes even if entity ids are reused', () => {
    const r = rig(() => info());
    r.controller.openCorpse(10, 100, 100);
    const stale = r.harvestButton();
    const newer = r.swapWorld();
    stale?.click();
    expect(newer.harvestCorpse).not.toHaveBeenCalled();
  });
  it('a detached Change control cannot open settings after its visit closes', () => {
    const r = rig(() => info());
    r.controller.openCorpse(10, 100, 100);
    const stale = r.root.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn');
    r.controller.close();
    stale?.click();
    expect(r.change).not.toHaveBeenCalled();
  });
  it('disables Harvest in place during a slow refresh while retaining status and Take Loot', async () => {
    const reply = pending<CorpseHarvestInfo | null>();
    let reads = 0;
    const r = rig(() => (++reads === 1 ? info() : reply.promise));
    r.controller.openCorpse(10, 100, 100);
    const harvest = r.harvestButton();
    const hint = r.root.querySelector('.corpse-harvest-hint');
    const status = hint?.textContent;
    const take = r.root.querySelector<HTMLButtonElement>(
      '.btn:not(.corpse-harvest-btn):not(.corpse-harvest-change-btn)',
    );
    r.advance(500);
    r.controller.updateProximity();
    expect(r.harvestButton()).toBe(harvest);
    expect(harvest?.matches(':disabled, [aria-disabled="true"]')).toBe(true);
    expect(r.root.querySelector('.corpse-harvest-hint')).toBe(hint);
    expect(hint?.textContent).toBe(status);
    expect(take?.disabled).toBe(false);
    harvest?.click();
    expect(r.harvest).not.toHaveBeenCalled();
    reply.resolve(info());
    await Promise.resolve();
    expect(r.harvestButton()).toBe(harvest);
    expect(harvest?.disabled).toBe(false);
    r.controller.close();
  });
  it('keeps Harvest disabled if loot changes during a pending status refresh', () => {
    const reply = pending<CorpseHarvestInfo | null>();
    let reads = 0;
    const r = rig(() => (++reads === 1 ? info() : reply.promise));
    r.controller.openCorpse(10, 100, 100);
    r.advance(500);
    r.controller.updateProximity();
    if (!r.mob.loot) throw new Error('fixture loot missing');
    r.mob.loot.copper += 1;
    r.controller.updateProximity();
    expect(r.harvestButton()?.matches(':disabled, [aria-disabled="true"]')).toBe(true);
    r.controller.close();
    reply.resolve(null);
  });
});
