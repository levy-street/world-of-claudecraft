// Item-first enchanting: right-click a piece of gear, choose Enchant, and the
// picker lists ONLY the enchants for that item's slot, grouped by tier with
// every gate answered on the row (the reagent-first picker's own row facts).
// Also pins the menu row (offered on enchantable gear only) and the compact
// height cap (about five rows, then it scrolls) against its placement mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { bagItemNewActions } from '../src/ui/bag_item_context_menu';
import {
  ENCHANT_TIER_ORDER,
  enchantSectionsForItemSlot,
  enchantSectionsForReagent,
  enchantsForItemSlot,
  enchantsForReagent,
  hasEnchantsForItemSlot,
} from '../src/ui/hud/professions/enchant_apply_view';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SYNCED = { synced: true, enchantingSkill: 300, knownRecipes: [] as string[] };

function idsForSlot(slot: string): string[] {
  return Object.values(ENCHANTS)
    .filter((enchant) => enchant.itemSlot === slot)
    .map((enchant) => enchant.id);
}

describe('enchantsForItemSlot', () => {
  it('lists exactly the enchants whose itemSlot matches, for every slot', () => {
    const slots = new Set(Object.values(ENCHANTS).map((enchant) => enchant.itemSlot));
    for (const slot of slots) {
      const rows = enchantsForItemSlot([], slot, SYNCED);
      expect(rows.map((row) => row.enchantId)).toEqual(idsForSlot(slot));
      expect(rows.every((row) => row.itemSlot === slot)).toBe(true);
    }
  });

  it('never leaks another slot: gloves show no chest or weapon enchant', () => {
    const rows = enchantsForItemSlot([], 'gloves', SYNCED);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.enchantId === 'enchant_chest_stamina')).toBe(false);
    expect(rows.some((row) => row.enchantId === 'enchant_weapon_might')).toBe(false);
    expect(rows.some((row) => row.enchantId === 'enchant_gloves_agility')).toBe(true);
  });

  it('returns nothing for a slot no enchant targets', () => {
    expect(enchantsForItemSlot([], 'trinket', SYNCED)).toEqual([]);
  });

  it('carries the same row facts the reagent-first picker builds', () => {
    const inventory: InvSlot[] = [{ itemId: 'arcane_dust', count: 4 }];
    const bySlot = enchantsForItemSlot(inventory, 'gloves', SYNCED).find(
      (row) => row.enchantId === 'enchant_gloves_agility',
    );
    const byReagent = enchantsForReagent(inventory, 'arcane_dust', SYNCED).find(
      (row) => row.enchantId === 'enchant_gloves_agility',
    );
    expect(bySlot).toEqual(byReagent);
    // 4 of 5 dust held: listed, but not affordable.
    expect(bySlot?.affordable).toBe(false);
    expect(bySlot?.reagents).toEqual([{ itemId: 'arcane_dust', required: 5, have: 4 }]);
  });

  it('lists a skill-gated enchant as a gated row, never drops it', () => {
    const low = { synced: true, enchantingSkill: 0, knownRecipes: [] as string[] };
    const lucent = enchantsForItemSlot([], 'chest', low).find(
      (row) => row.enchantId === 'enchant_chest_lucent_stamina',
    );
    expect(lucent).toBeDefined();
    expect(lucent?.skillMet).toBe(false);
  });
});

describe('enchantSectionsForItemSlot', () => {
  it('groups the slot rows by tier in ladder order, covering every row once', () => {
    const sections = enchantSectionsForItemSlot([], 'mainhand', SYNCED);
    const tiers = sections.map((section) => section.tier);
    expect(tiers).toEqual(ENCHANT_TIER_ORDER.filter((tier) => tiers.includes(tier)));
    const ids = sections.flatMap((section) => section.rows.map((row) => row.enchantId)).sort();
    expect(ids).toEqual(idsForSlot('mainhand').sort());
  });

  it('matches the reagent-first grouping for the same rows', () => {
    // Every gloves enchant uses dust or shard; the gloves sections are the
    // gloves-only subset of what a union of reagent pickers would show.
    const sections = enchantSectionsForItemSlot([], 'gloves', SYNCED);
    const dust = enchantSectionsForReagent([], 'arcane_dust', SYNCED);
    const dustGloves = dust
      .flatMap((section) => section.rows.filter((row) => row.itemSlot === 'gloves'))
      .map((row) => row.enchantId);
    const sectionIds = sections.flatMap((section) => section.rows.map((row) => row.enchantId));
    for (const id of dustGloves) expect(sectionIds).toContain(id);
  });
});

describe('the Enchant bag menu row', () => {
  const gear = (slot: string): ItemDef =>
    ({ kind: 'armor', quality: 'uncommon', slot }) as unknown as ItemDef;

  it('is offered on gear whose slot some enchant targets', () => {
    expect(bagItemNewActions(gear('gloves'), 'x')).toContain('enchantItem');
    expect(bagItemNewActions(gear('chest'), 'x')).toContain('enchantItem');
    expect(hasEnchantsForItemSlot('mainhand')).toBe(true);
  });

  it('is not offered on non-gear or a slot no enchant targets', () => {
    expect(bagItemNewActions({ kind: 'consumable' } as unknown as ItemDef, 'x')).not.toContain(
      'enchantItem',
    );
    expect(bagItemNewActions(gear('trinket'), 'x')).not.toContain('enchantItem');
    expect(hasEnchantsForItemSlot(undefined)).toBe(false);
  });

  it('sits after the destroy-family rows and before the lock toggle', () => {
    const actions = bagItemNewActions(gear('gloves'), 'x');
    expect(actions.indexOf('enchantItem')).toBeGreaterThan(actions.indexOf('salvage'));
    expect(actions.indexOf('enchantItem')).toBeLessThan(actions.indexOf('lock'));
  });
});

describe('the compact picker cap', () => {
  it('the CSS cap and the painter placement mirror agree', () => {
    const css = read('../src/styles/hud.css');
    const cap = css
      .match(/#ctx-menu\.ctx-menu-picker\.ctx-menu-picker-compact\s*\{[^}]*\}/)?.[0]
      .match(/max-height:\s*min\(\s*(\d+)vh\s*,\s*(\d+)px\s*\)/);
    expect(cap).toBeTruthy();
    const painter = read('../src/ui/bag_item_action_menu.ts');
    const px = painter.match(/PICKER_COMPACT_MAX_HEIGHT_DESKTOP_PX = (\d+)/);
    expect(Number(cap?.[2])).toBe(Number(px?.[1]));
    // Smaller than the full picker cap, never a second full-size box.
    expect(Number(px?.[1])).toBeLessThan(560);
    expect(painter).toMatch(
      /classList\.toggle\(CTX_MENU_PICKER_COMPACT_CLASS,\s*picker && compact\)/,
    );
  });
});

describe('the reagent icons', () => {
  it('each reagent paints its own item icon before the name and amount', () => {
    const painter = read('../src/ui/bag_item_action_menu.ts');
    expect(painter).toMatch(/CTX_REAGENT_ICON_CLASS = 'ctx-reagent-icon'/);
    // The icon is the reagent's own item art, decorative, ahead of the text.
    expect(painter).toMatch(
      /<img class="\$\{CTX_REAGENT_ICON_CLASS\}" src="\$\{esc\(\s*iconDataUrl\('item', reagent\.itemId\),?\s*\)\}" alt="" draggable="false">\$\{esc\(\s*t\('hudChrome\.crafting\.reagentLine'/,
    );
  });

  it('the icon is sized to the text it sits in', () => {
    const rule = read('../src/styles/hud.css').match(
      /#ctx-menu \.ctx-item-meta \.ctx-reagent-icon\s*\{[^}]*\}/,
    )?.[0];
    expect(rule).toMatch(/width:\s*1em/);
    expect(rule).toMatch(/height:\s*1em/);
  });
});

describe('Shift + right-click on the character sheet', () => {
  const sheet = read('../src/ui/char_window.ts');

  it('opens the worn Enchant list on Shift, and a plain right-click still unequips', () => {
    const handler = sheet.match(
      /row\.addEventListener\('contextmenu', \(ev\) => \{[\s\S]*?this\.doUnequip\(slot, false\);\s*\}\);/,
    )?.[0];
    expect(handler).toBeDefined();
    expect(handler).toMatch(/if \(ev\.shiftKey && hasEnchantsForItemSlot\(item\.slot\)\)/);
    expect(handler).toMatch(
      /this\.deps\.openWornEnchant\(slot, ev\.clientX, ev\.clientY\);\s*return;/,
    );
    // The plain arm is unchanged: one-click unequip after the Shift branch.
    expect(handler?.indexOf('openWornEnchant')).toBeLessThan(
      handler?.indexOf('this.doUnequip(slot, false)') ?? -1,
    );
  });

  it('the worn tooltip names the shortcut only on enchantable gear', () => {
    expect(sheet).toMatch(
      /hasEnchantsForItemSlot\(item\.slot\)\s*\?\s*`<div class="tt-sub">\$\{esc\(t\('hudChrome\.paperdoll\.enchantHint'\)\)\}<\/div>`/,
    );
  });

  it('the painter enchants the worn copy in place, keyed by its equipment slot', () => {
    const painter = read('../src/ui/bag_item_action_menu.ts');
    expect(painter).toMatch(/openWornEnchant\(slot: EquipSlot, x: number, y: number\): void/);
    expect(painter).toMatch(/world\.applyEnchant\(itemId, enchantId, wornSlot\)/);
    expect(painter).toMatch(/this\.confirmReplace\(itemId, enchantId, worn\.replace, wornSlot\)/);
  });
});
