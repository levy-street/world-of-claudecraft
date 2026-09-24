import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { emitInventoryReceipt } from '../src/sim/inventory_receipt';
import { activeItemInstanceStats } from '../src/sim/item_instance_stats';
import { lootQualityBonuses, lootQualityWeapon } from '../src/sim/loot_quality';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import type { ItemDef, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { t } from '../src/ui/i18n';
import { itemCombatTooltipLines } from '../src/ui/item_combat_tooltip_view';
import { itemStatDeltas, sameItemCopy, shouldCompareCopies } from '../src/ui/item_compare';
import { itemNumber, itemStatName, wornTooltipInstance } from '../src/ui/item_instance_tooltip';
import {
  lootQualityReceiptBody,
  lootQualityReceiptNodes,
  lootQualityReceiptText,
} from '../src/ui/loot_quality_receipt';
import {
  lootQualityBadgeHtml,
  lootQualityName,
  lootQualityTooltipLine,
} from '../src/ui/loot_quality_view';
import { itemLevelReadout } from '../src/ui/rift_band_tooltip';
import { statNameKey } from '../src/ui/stat_tooltip_view';
import { wornItemCellParts } from '../src/ui/worn_item_cell_view';

const copy = (tier: 1 | 2 | 3 | 4): ItemInstancePayload => ({
  lootQuality: { version: 1, tier, weights: [900, 100, 250, 750, 500] },
});

describe('permanent loot quality presentation', () => {
  it('keeps ordinary receipts and non-receipt roll messages on their existing translation path', () => {
    const ordinary = { type: 'loot' as const, pid: 7, text: 'You receive: Plain Ring.' };
    const roll = {
      ...ordinary,
      text: 'Rolling for [[i:ring]].',
      itemId: 'ring',
      instance: copy(3),
    };
    expect(lootQualityReceiptText(ordinary, (value) => `translated:${value}`)).toBe(
      `translated:${ordinary.text}`,
    );
    expect(lootQualityReceiptText(roll, (value) => `translated:${value}`)).toBe(
      `translated:${roll.text}`,
    );
    const malformed = { ...ordinary, itemId: 'ring]]<script>', instance: copy(3), count: 1 };
    expect(lootQualityReceiptText(malformed, (value) => value)).toBe(ordinary.text);
  });
  it('turns a real inventory receipt into a translated exact-copy link with its count', () => {
    const events: SimEvent[] = [];
    const item = ITEMS.seal_of_the_forgewall;
    emitInventoryReceipt(
      {
        emit: (event) => {
          events.push(event);
        },
      },
      7,
      item.id,
      item.name,
      2,
      undefined,
      copy(3),
    );
    const event = events[0];
    if (event.type !== 'loot') throw new Error('Expected inventory loot receipt');
    expect(event.text).not.toContain('[[i:');
    const text = lootQualityReceiptText(event, (value) => value);
    expect(text).toBe(`You receive: [[i:${item.id}]] x2.`);
    const links: ItemInstancePayload[] = [];
    const doc = {
      createElement: () => ({ append: () => {} }),
      createTextNode: () => ({}),
    } as unknown as Document;
    lootQualityReceiptNodes(doc, text, event.itemId!, event.instance!, (_parent, id, instance) => {
      expect(id).toBe(item.id);
      if (instance) links.push(instance);
    });
    expect(links).toHaveLength(1);
    expect(lootQualityName(links[0])).toBe('Magnificent');
  });
  it('hands the hud a plain string for an ordinary line and nodes for a quality-rolled copy', () => {
    // The hud's loot arm is ONE guarded log() call (#2430); this is the whole
    // string-or-nodes decision behind it, so both arms are pinned here.
    const appended: Array<{ id: string; instance?: ItemInstancePayload }> = [];
    const doc = {
      createElement: () => ({ append: () => {} }),
      createTextNode: () => ({}),
    } as unknown as Document;
    const appendLink = (_parent: HTMLElement, id: string, instance?: ItemInstancePayload) => {
      appended.push({ id, instance });
    };
    const ordinary = { type: 'loot' as const, pid: 7, text: 'You receive: Plain Ring.' };
    expect(lootQualityReceiptBody(doc, ordinary, (value) => `t:${value}`, appendLink)).toBe(
      't:You receive: Plain Ring.',
    );
    // An event that names an item but whose copy carries no quality descriptor
    // stays on the string path too: only a rolled copy earns an exact-copy link.
    const plainCopy = { ...ordinary, itemId: 'ring', instance: {}, count: 1 };
    expect(typeof lootQualityReceiptBody(doc, plainCopy, (value) => value, appendLink)).toBe(
      'string',
    );
    expect(appended).toHaveLength(0);
    const rolled = {
      ...ordinary,
      text: 'You receive: [[i:ring]].',
      itemId: 'ring',
      instance: copy(2),
      count: 1,
    };
    const body = lootQualityReceiptBody(doc, rolled, (value) => value, appendLink);
    expect(Array.isArray(body)).toBe(true);
    expect(appended).toEqual([{ id: 'ring', instance: rolled.instance }]);
  });
  it('maps Healing Power from the combat bonus lane into final tooltip and compare values', () => {
    const instance = copy(4);
    const item = Object.values(ITEMS).find(
      (entry) => (lootQualityBonuses(entry, instance).healingPower ?? 0) > 0,
    )!;
    expect(item).toBeDefined();
    const bonus = lootQualityBonuses(item, instance).healingPower;
    expect(itemCombatTooltipLines(item, instance)).toContain(
      t('itemUi.tooltip.stat', {
        value: itemNumber((item.healPower ?? 0) + bonus),
        stat: itemStatName('healingPower'),
      }),
    );
    expect(
      itemStatDeltas(item, item, instance).find((row) => row.stat === 'healPower')?.delta,
    ).toBe(bonus);
  });
  it('binds receipt tooltips only to the authoritative copy and keeps prose as text', () => {
    const textNodes: string[] = [];
    const body = { append: () => {} };
    const doc = {
      createElement: () => body,
      createTextNode: (text: string) => {
        textNodes.push(text);
        return { textContent: text };
      },
    } as unknown as Document;
    const instance = copy(3);
    const links: Array<{ id: string; instance?: ItemInstancePayload }> = [];
    const nodes = lootQualityReceiptNodes(
      doc,
      '<script> [[i:one]] and [[i:two]]',
      'one',
      instance,
      (_parent, id, payload) => links.push({ id, instance: payload }),
    );
    expect(nodes).toEqual([body]);
    expect(textNodes).toEqual(['<script> ', ' and ']);
    expect(links).toEqual([
      { id: 'one', instance },
      { id: 'two', instance: undefined },
    ]);
  });
  it('keeps rarity and item names while giving every enhanced tier a named badge', () => {
    const item = ITEMS.seal_of_the_forgewall;
    for (const [tier, name, mark] of [
      [1, 'Superior', 'I'],
      [2, 'Exceptional', 'II'],
      [3, 'Magnificent', 'III'],
      [4, 'Transcendent', 'IV'],
    ] as const) {
      const instance = copy(tier);
      expect(lootQualityName(instance)).toBe(name);
      // One accessible channel per surface: the labelled badge names the
      // quality itself; the default badge is decorative and the cell's
      // accessible name (ariaName) carries the word instead.
      const labelled = lootQualityBadgeHtml(instance, { labelled: true });
      expect(labelled).toContain(`role="img" aria-label="${name}"`);
      expect(labelled).toContain(`>${mark}</span>`);
      expect(labelled).not.toContain('ui-badge');
      const decorative = lootQualityBadgeHtml(instance);
      expect(decorative).toContain('aria-hidden="true"');
      expect(decorative).not.toContain('aria-label');
      expect(decorative).not.toContain('role=');
      expect(decorative).toContain(`>${mark}</span>`);
      expect(lootQualityTooltipLine(instance)).toContain(`+${tier * 2} item levels`);
      const cell = wornItemCellParts(item, instance);
      expect(cell.name).toBe(itemDisplayName(item));
      expect(cell.quality).toBe(item.quality);
      expect(cell.ariaName).toContain(name);
      expect(cell.qualityBadge).toBe(decorative);
      expect(cell.qualityBadgeLabelled).toBe(labelled);
      expect(wornTooltipInstance(instance)?.lootQuality).toEqual(instance.lootQuality);
    }
  });

  it('clears quality markup for ordinary copies and malformed future descriptors', () => {
    expect(lootQualityBadgeHtml(copy(4))).toContain('IV');
    expect(lootQualityBadgeHtml()).toBe('');
    expect(lootQualityBadgeHtml({})).toBe('');
    expect(lootQualityBadgeHtml({ lootQuality: { tier: 9 } } as never)).toBe('');
  });

  it('compares different rolls of the same item, including ordinary versus enhanced', () => {
    expect(shouldCompareCopies('ring', 'ring', copy(3), undefined)).toBe(true);
    expect(shouldCompareCopies('ring', 'ring', undefined, copy(3))).toBe(true);
    expect(shouldCompareCopies('ring', 'ring', copy(3), copy(3))).toBe(false);
    expect(sameItemCopy(copy(3), copy(4))).toBe(false);
    const other = copy(3);
    other.lootQuality!.weights[0] = 1;
    expect(sameItemCopy(copy(3), other)).toBe(false);
  });

  it('shows the same primary totals and weapon damage that combat resolves', () => {
    const item = Object.values(ITEMS).find(
      (entry) =>
        entry.weapon && entry.stats?.str && Object.keys(lootQualityBonuses(entry, copy(4))).length,
    )!;
    expect(item).toBeDefined();
    for (const tier of [1, 4] as const) {
      const instance = copy(tier);
      const bonuses = lootQualityBonuses(item, instance);
      const html = itemCombatTooltipLines(item, instance);
      for (const key of ['str', 'sta'] as const) {
        const total = (item.stats?.[key] ?? 0) + (bonuses[key] ?? 0);
        if (total)
          expect(html).toContain(
            t('itemUi.tooltip.stat', {
              value: itemNumber(total),
              stat: itemStatName(key),
            }),
          );
      }
      const weapon = lootQualityWeapon(item, instance)!;
      expect(html).toContain(
        t('itemUi.tooltip.damageSpeed', {
          min: itemNumber(weapon.min),
          max: itemNumber(weapon.max),
          speed: itemNumber(weapon.speed, 1),
        }),
      );
      const delta = itemStatDeltas(item, item, instance).find((row) => row.stat === 'dps');
      expect(delta?.delta).toBeCloseTo(
        (weapon.min + weapon.max) / 2 / weapon.speed -
          (item.weapon!.min + item.weapon!.max) / 2 / item.weapon!.speed,
      );
    }
  });

  it('resolves Warfare (the lower PvP rating) per copy in the tooltip and the compare', () => {
    // qualityBonusesAtLevel emits both PvP ratings and recalcPlayerStats applies
    // them; the tooltip's Warfare line and the compare row must read the same
    // resolved pair, or combat and the tooltip disagree on a rated copy. No
    // droppable item carries the pair today, so a droppable def is given one.
    const base = Object.values(ITEMS).find(
      (entry) =>
        entry.kind === 'armor' &&
        (entry.quality === 'rare' || entry.quality === 'epic') &&
        Object.keys(lootQualityBonuses(entry, copy(4))).length > 0,
    )!;
    const item = { ...base, pvpOffenseRating: 24, pvpDefenseRating: 18 } as ItemDef;
    const instance = copy(4);
    const bonuses = lootQualityBonuses(item, instance);
    expect(bonuses.pvpOffenseRating).toBeGreaterThan(0);
    expect(bonuses.pvpDefenseRating).toBeGreaterThan(0);
    const resolvedWarfare = Math.min(24 + bonuses.pvpOffenseRating, 18 + bonuses.pvpDefenseRating);
    expect(resolvedWarfare).toBeGreaterThan(18);
    const warfareLine = (value: number) =>
      t('itemUi.tooltip.stat', {
        value: itemNumber(value),
        stat: t(statNameKey('warfare') as never),
      });
    const html = itemCombatTooltipLines(item, instance);
    expect(html).toContain(warfareLine(resolvedWarfare));
    expect(html).not.toContain(warfareLine(18));
    expect(itemCombatTooltipLines(item)).toContain(warfareLine(18));
    const delta = itemStatDeltas(item, item, instance).find((row) => row.stat === 'warfare');
    expect(delta?.delta).toBe(resolvedWarfare - 18);
    expect(itemStatDeltas(item, item).find((row) => row.stat === 'warfare')).toBeUndefined();
    // Combat reads the same pair through the shared stat projection.
    const active = activeItemInstanceStats(instance, item);
    expect(active?.pvpOffenseRating).toBe(bonuses.pvpOffenseRating);
    expect(active?.pvpDefenseRating).toBe(bonuses.pvpDefenseRating);
  });

  it('keeps Rift quality separate from Essence and gem lines, with final totals', () => {
    const band = createRiftGearInstance('quality-ui', 'S', 'warrior', 1, 5);
    const instance = { ...band.instance, ...copy(4) };
    const item = ITEMS[band.itemId];
    const html = itemCombatTooltipLines(item, instance);
    expect(itemLevelReadout(item, instance)?.level).toBe(42);
    for (const key of ['str', 'sta'] as const) {
      const total = activeItemInstanceStats(instance, item)?.[key] ?? 0;
      expect(html).toContain(
        t('itemUi.tooltip.stat', { value: itemNumber(total), stat: itemStatName(key) }),
      );
    }
    expect(html).toContain('Rift upgrade 5/5');
    expect(html).toContain('Rift gems 0/2');
  });
});
