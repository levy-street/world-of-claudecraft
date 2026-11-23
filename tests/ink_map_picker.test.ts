// @vitest-environment happy-dom
// The Cartographer's Ink map picker: the pure core (which held maps one ink use
// could redraw) and the #prompt-stack controller that asks which one, then
// sends the choice through IWorld.useItem.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_UPGRADE_INKS,
  TREASURE_SITES,
} from '../src/sim/content/treasure_maps';
import type { InvSlot } from '../src/sim/types';
import { dismissBagPrompts } from '../src/ui/bags_window';
import { pickInkMap } from '../src/ui/hud/treasure/ink_map_picker_controller';
import { inkMapPickerModel } from '../src/ui/hud/treasure/ink_map_picker_view';
import { t } from '../src/ui/i18n';

const slot = (itemId: string, count: number): InvSlot => ({ itemId, count }) as InvSlot;

function world(
  inventory: InvSlot[],
  treasureMap: { rarity: 'common' | 'rare' | 'epic' | 'legendary'; siteId: string } | null = null,
) {
  return { inventory, treasureMap, useItem: vi.fn() };
}

const SITE = TREASURE_SITES[0].id;

describe('ink map picker model', () => {
  it('offers the read map first, then unread copies, never the top rarity', () => {
    const model = inkMapPickerModel(
      world(
        [
          slot(CARTOGRAPHERS_INK_ITEM_ID, 3),
          slot(TREASURE_MAP_ITEM_IDS.common, 2),
          slot(TREASURE_MAP_ITEM_IDS.epic, 1),
          slot(TREASURE_MAP_ITEM_IDS.legendary, 1),
          slot(TREASURE_MAP_ITEM_IDS.rare, 1),
        ],
        { rarity: 'rare', siteId: SITE },
      ),
    );
    expect(model.held).toBe(3);
    expect(model.choices).toEqual([
      { rarity: 'rare', read: true, count: 1, next: 'epic', inks: 3, affordable: true },
      { rarity: 'common', read: false, count: 2, next: 'rare', inks: 1, affordable: true },
      { rarity: 'epic', read: false, count: 1, next: 'legendary', inks: 8, affordable: false },
    ]);
  });

  it('splits a read rarity into the read copy and its unread spares', () => {
    const model = inkMapPickerModel(
      world([slot(TREASURE_MAP_ITEM_IDS.common, 2), slot(TREASURE_MAP_ITEM_IDS.common, 1)], {
        rarity: 'common',
        siteId: SITE,
      }),
    );
    expect(model.choices.map((c) => [c.rarity, c.read, c.count])).toEqual([
      ['common', true, 1],
      ['common', false, 2],
    ]);
    expect(model.choices.every((c) => !c.affordable)).toBe(true);
  });

  it('offers nothing without a map, or with only a top-rarity one', () => {
    expect(inkMapPickerModel(world([slot(CARTOGRAPHERS_INK_ITEM_ID, 20)])).choices).toEqual([]);
    expect(inkMapPickerModel(world([slot(TREASURE_MAP_ITEM_IDS.legendary, 1)])).choices).toEqual(
      [],
    );
  });

  it('a read map no longer in the bags is not offered as read', () => {
    const model = inkMapPickerModel(world([], { rarity: 'rare', siteId: SITE }));
    expect(model.choices).toEqual([]);
  });
});

describe('ink map picker prompt', () => {
  let bags: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="prompt-stack"></div><div id="bags"></div>';
    bags = document.getElementById('bags')!;
  });
  afterEach(() => {
    for (const el of document.querySelectorAll('.tmap-ink-prompt')) {
      (el.querySelector('.tmap-ink-cancel') as HTMLElement | null)?.click();
    }
  });

  const prompt = () => document.querySelector<HTMLElement>('#prompt-stack .tmap-ink-prompt');
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.tmap-ink-choice')];

  it('leaves every other item to the plain use path', () => {
    const w = world([slot(TREASURE_MAP_ITEM_IDS.common, 1), slot(CARTOGRAPHERS_INK_ITEM_ID, 1)]);
    expect(pickInkMap(w, TREASURE_MAP_ITEM_IDS.common)).toBe(false);
    expect(prompt()).toBeNull();
  });

  it('falls through to the plain use (the sim explains) when no map can take the ink', () => {
    const w = world([slot(CARTOGRAPHERS_INK_ITEM_ID, 1)]);
    expect(pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID)).toBe(false);
    expect(prompt()).toBeNull();
  });

  it('asks which map, then sends the chosen one with the clicked bag copy', () => {
    const w = world(
      [
        slot(CARTOGRAPHERS_INK_ITEM_ID, TREASURE_MAP_UPGRADE_INKS.common),
        slot(TREASURE_MAP_ITEM_IDS.common, 1),
        slot(TREASURE_MAP_ITEM_IDS.rare, 1),
      ],
      { rarity: 'rare', siteId: SITE },
    );
    expect(pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { slotIndex: 0, inertRoot: bags })).toBe(true);
    const el = prompt()!;
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.querySelector('.prompt-text')?.textContent).toBe(
      t('hudChrome.treasureMap.inkPickerTitle'),
    );
    expect(bags.inert).toBe(true);
    const [readRow, unreadRow] = rows();
    expect(readRow.dataset.rarity).toBe('rare');
    // The read rare needs 3 inks and only 1 is held; the unread common is
    // affordable. The short row stays focusable (aria-disabled) so its cost is
    // reachable, but focus lands on the first row that can be chosen.
    expect(readRow.getAttribute('aria-disabled')).toBe('true');
    expect(readRow.disabled).toBe(false);
    expect(unreadRow.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(unreadRow);

    readRow.click();
    expect(w.useItem).not.toHaveBeenCalled();
    unreadRow.click();
    expect(w.useItem).toHaveBeenCalledExactlyOnceWith(CARTOGRAPHERS_INK_ITEM_ID, {
      slotIndex: 0,
      inkMap: { rarity: 'common', read: false },
    });
    expect(prompt()).toBeNull();
    expect(bags.inert).toBe(false);
  });

  it("closing the bags tears the picker down with the bags' other prompts", () => {
    const w = world([slot(CARTOGRAPHERS_INK_ITEM_ID, 1), slot(TREASURE_MAP_ITEM_IDS.common, 1)]);
    pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags });
    expect(bags.inert).toBe(true);
    dismissBagPrompts(bags);
    expect(prompt()).toBeNull();
    expect(bags.inert).toBe(false);
    // The singleton was released too: the next ink press opens a fresh prompt.
    expect(pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags })).toBe(true);
    expect(prompt()).not.toBeNull();
  });

  it('cancel and Escape close it without using anything', () => {
    const w = world([slot(CARTOGRAPHERS_INK_ITEM_ID, 1), slot(TREASURE_MAP_ITEM_IDS.common, 1)]);
    pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags });
    (prompt()!.querySelector('.tmap-ink-cancel') as HTMLElement).click();
    expect(prompt()).toBeNull();
    pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags });
    prompt()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(prompt()).toBeNull();
    expect(w.useItem).not.toHaveBeenCalled();
    expect(bags.inert).toBe(false);
  });

  it('a second ink press while it is open keeps the one prompt', () => {
    const w = world([slot(CARTOGRAPHERS_INK_ITEM_ID, 1), slot(TREASURE_MAP_ITEM_IDS.common, 1)]);
    expect(pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags })).toBe(true);
    expect(pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags })).toBe(true);
    expect(document.querySelectorAll('.tmap-ink-prompt')).toHaveLength(1);
  });

  it('names where the read map leads and how many unread copies a row stands for', () => {
    const w = world([slot(CARTOGRAPHERS_INK_ITEM_ID, 5), slot(TREASURE_MAP_ITEM_IDS.common, 3)], {
      rarity: 'common',
      siteId: SITE,
    });
    pickInkMap(w, CARTOGRAPHERS_INK_ITEM_ID, { inertRoot: bags });
    const notes = rows().map((r) => r.querySelector('.tmap-ink-note')?.textContent ?? '');
    expect(notes[0]).not.toBe('');
    expect(notes[0]).not.toContain('{zone}');
    expect(notes[1]).toBe(t('hudChrome.treasureMap.inkPickerUnread', { count: '2' }));
  });
});
