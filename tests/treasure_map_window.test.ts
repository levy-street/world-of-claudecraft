// @vitest-environment happy-dom

// The treasure map parchment's live refresh: the Hud slow-band poll repaints the
// held Cartographer's Ink count when ink is bought or looted, closes the window
// once the read map leaves the bags, and does no DOM work on an unchanged poll.

import { afterEach, describe, expect, it } from 'vitest';
import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_SITES,
  type TreasureMapRarity,
} from '../src/sim/content/treasure_maps';
import { TreasureMapWindow } from '../src/ui/hud/treasure/treasure_map_window';

afterEach(() => {
  document.body.replaceChildren();
});

type Slot = { itemId: string; count: number } | null;

function fixture() {
  const world = {
    treasureMap: { rarity: 'common' as TreasureMapRarity, siteId: TREASURE_SITES[0].id } as {
      rarity: TreasureMapRarity;
      siteId: string;
    } | null,
    inventory: [
      { itemId: TREASURE_MAP_ITEM_IDS.common, count: 1 },
      { itemId: CARTOGRAPHERS_INK_ITEM_ID, count: 1 },
      null,
    ] as Slot[],
  };
  const win = new TreasureMapWindow({ world: () => world as never });
  win.open();
  const root = document.getElementById('treasure-map-window');
  if (!root) throw new Error('the window did not mount');
  return { world, win, root };
}

function mutationsDuring(root: HTMLElement, run: () => void): number {
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  run();
  const count = observer.takeRecords().length;
  observer.disconnect();
  return count;
}

describe('treasure_map_window: live refresh (the Hud slow-band poll)', () => {
  it('repaints the held ink count when ink is bought or looted with the map open', () => {
    const { world, win, root } = fixture();
    expect(win.isOpen).toBe(true);
    const note = () => root.querySelector('.tmap-upgrade')?.textContent ?? '';
    const before = note();
    world.inventory[2] = { itemId: CARTOGRAPHERS_INK_ITEM_ID, count: 4 };
    win.refreshIfChanged();
    expect(note()).not.toBe(before);
    expect(note()).toContain('5');
  });

  it('closes once the read map leaves the bags', () => {
    const { world, win } = fixture();
    world.inventory[0] = null;
    win.refreshIfChanged();
    expect(win.isOpen).toBe(false);
  });

  it('closes once the map is spent (no read map left)', () => {
    const { world, win } = fixture();
    world.treasureMap = null;
    win.refreshIfChanged();
    expect(win.isOpen).toBe(false);
  });

  it('repaints a rarity change (an ink redraw) on the poll', () => {
    const { world, win, root } = fixture();
    world.treasureMap = { rarity: 'rare', siteId: TREASURE_SITES[0].id };
    world.inventory[0] = { itemId: TREASURE_MAP_ITEM_IDS.rare, count: 1 };
    win.refreshIfChanged();
    expect(root.dataset.rarity).toBe('rare');
  });

  it('stays open through an upgrade whose rarity and bag swap land in different frames', () => {
    const { world, win, root } = fixture();
    // Online frame 1: the quest snapshot's new rarity, the old map still bagged.
    world.treasureMap = { rarity: 'rare', siteId: TREASURE_SITES[0].id };
    win.refreshIfChanged();
    expect(win.isOpen).toBe(true);
    // Frame 2: the inventory delta swaps the map item.
    world.inventory[0] = { itemId: TREASURE_MAP_ITEM_IDS.rare, count: 1 };
    win.refreshIfChanged();
    expect(win.isOpen).toBe(true);
    expect(root.dataset.rarity).toBe('rare');
  });

  it('repaints a site change on the poll', () => {
    const { world, win, root } = fixture();
    const other = TREASURE_SITES.find((site) => site.id !== TREASURE_SITES[0].id);
    if (!other) throw new Error('need a second treasure site');
    const before = root.innerHTML;
    world.treasureMap = { rarity: 'common', siteId: other.id };
    win.refreshIfChanged();
    expect(root.innerHTML).not.toBe(before);
  });

  it('does no DOM work on a repeated identical poll, and latches on refresh and relocalize', () => {
    const { world, win, root } = fixture();
    expect(mutationsDuring(root, () => win.refreshIfChanged())).toBe(0);
    world.inventory[2] = { itemId: CARTOGRAPHERS_INK_ITEM_ID, count: 2 };
    win.refresh();
    expect(mutationsDuring(root, () => win.refreshIfChanged())).toBe(0);
    expect(mutationsDuring(root, () => win.relocalize())).toBeGreaterThan(0);
    expect(mutationsDuring(root, () => win.refreshIfChanged())).toBe(0);
  });

  it('keeps focus on the close button across a poll rebuild', () => {
    const { world, win, root } = fixture();
    root.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    world.inventory[2] = { itemId: CARTOGRAPHERS_INK_ITEM_ID, count: 3 };
    win.refreshIfChanged();
    expect(document.activeElement).toBe(root.querySelector('[data-close]'));
  });

  it('never repaints or reopens while closed', () => {
    const { world, win, root } = fixture();
    win.close();
    world.inventory[2] = { itemId: CARTOGRAPHERS_INK_ITEM_ID, count: 3 };
    expect(mutationsDuring(root, () => win.refreshIfChanged())).toBe(0);
    expect(mutationsDuring(root, () => win.relocalize())).toBe(0);
    expect(win.isOpen).toBe(false);
  });
});
