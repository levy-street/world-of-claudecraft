// The Adventure Journal's Loot filter (src/ui/hud/journal/journal_loot_filter_view.ts):
// the Dungeon Finder's loot preview rule (lootPreviewFits) applied to a page's
// real drops, a class-restricted drop kept to its class, All classes showing
// every drop, the whole instance boss by boss, and a clean nothing for an
// instance that drops nothing. Also the shared pickers' All classes option
// (dungeon_catalogue_chrome.ts), with the Adventure Guide's markup unchanged.
import { describe, expect, it } from 'vitest';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { ITEMS } from '../src/sim/data';
import { lootPreviewControlsHtml } from '../src/ui/dungeon_catalogue_chrome';
import { lootPreviewFits } from '../src/ui/dungeon_loot_preview_view';
import { journalInstance, journalPageBodies } from '../src/ui/hud/journal/journal_catalog';
import {
  journalLootFilterFor,
  journalLootFits,
  journalLootView,
} from '../src/ui/hud/journal/journal_loot_filter_view';
import { type JournalLootRow, journalLoot } from '../src/ui/hud/journal/journal_loot_view';

const sanctum = journalInstance('gravewyrm_sanctum');
if (!sanctum) throw new Error('the Gravewyrm Sanctum journal is missing');
const finalBoss = sanctum.source.bossKeys.at(-1) ?? '';
const finalRows = journalLoot(journalPageBodies(sanctum.source, finalBoss), 'heroic');

describe('journal loot filter', () => {
  it('opens on the character class and a real specialization only', () => {
    expect(journalLootFilterFor('paladin', 'holy')).toEqual({ cls: 'paladin', spec: 'holy' });
    expect(journalLootFilterFor('warrior', 'holy')).toEqual({ cls: 'warrior', spec: null });
    expect(journalLootFilterFor('mage', null)).toEqual({ cls: 'mage', spec: null });
  });

  it('applies the Adventure Guide rule to every real drop of a dungeon boss', () => {
    expect(finalRows.length).toBeGreaterThan(3);
    for (const filter of [
      { cls: 'mage', spec: 'fire' },
      { cls: 'warrior', spec: 'prot' },
      { cls: 'paladin', spec: 'holy' },
    ] as const) {
      for (const row of finalRows) {
        const item = ITEMS[row.itemId];
        const own = !row.restrictedToClass || row.restrictedToClass === filter.cls;
        expect(journalLootFits(row, filter), `${row.itemId} for ${filter.cls}`).toBe(
          own && lootPreviewFits(item, filter),
        );
      }
    }
    // The rule really narrows: a mage and a warrior tank do not see the same drops.
    const mage = finalRows.filter((row) => journalLootFits(row, { cls: 'mage', spec: 'fire' }));
    const tank = finalRows.filter((row) => journalLootFits(row, { cls: 'warrior', spec: 'prot' }));
    expect(mage.length).toBeLessThan(finalRows.length);
    expect(mage.map((r) => r.itemId)).not.toEqual(tank.map((r) => r.itemId));
  });

  it('shows every drop for All classes', () => {
    expect(finalRows.every((row) => journalLootFits(row, null))).toBe(true);
    const all = journalLootView(sanctum, finalBoss, 'boss', 'heroic', null);
    expect(all.shown).toBe(all.total);
    expect(all.sections[0].rows.map((r) => r.itemId)).toEqual(finalRows.map((r) => r.itemId));
  });

  it('keeps a class-restricted drop to its class', () => {
    const row: JournalLootRow = {
      itemId: 'baked_bread',
      quality: 'common',
      restrictedToClass: 'priest',
      dropsFrom: 'fixture',
    };
    expect(journalLootFits(row, { cls: 'priest', spec: null })).toBe(true);
    expect(journalLootFits(row, { cls: 'mage', spec: null })).toBe(false);
    expect(journalLootFits(row, null)).toBe(true);
  });

  it('reads the whole instance boss by boss, in route order, with the counts', () => {
    const filter = { cls: 'mage', spec: 'fire' } as const;
    const view = journalLootView(sanctum, finalBoss, 'instance', 'heroic', filter);
    expect(view.sections.map((s) => s.bossKey)).toEqual([...sanctum.source.bossKeys]);
    let total = 0;
    let shown = 0;
    for (const section of view.sections) {
      const rows = journalLoot(journalPageBodies(sanctum.source, section.bossKey), 'heroic');
      expect(section.total).toBe(rows.length);
      expect(section.rows.map((r) => r.itemId)).toEqual(
        rows.filter((r) => journalLootFits(r, filter)).map((r) => r.itemId),
      );
      expect(section.portraitUrl.length).toBeGreaterThan(0);
      total += section.total;
      shown += section.rows.length;
    }
    expect([view.total, view.shown]).toEqual([total, shown]);
    expect(view.shown).toBeLessThan(view.total);
    // One boss's scope is just that page.
    const one = journalLootView(sanctum, finalBoss, 'boss', 'heroic', filter);
    expect(one.sections.map((s) => s.bossKey)).toEqual([finalBoss]);
  });

  it('reads an instance with no drops as nothing at all', () => {
    const heart = journalInstance(SMITH_HEART_DUNGEON);
    if (!heart) throw new Error('the Smith Heart journal is missing');
    const empty = heart.source.bossKeys.find(
      (key) => journalLoot(journalPageBodies(heart.source, key), 'normal').length === 0,
    );
    expect(empty).toBeDefined();
    const view = journalLootView(heart, empty ?? '', 'boss', 'normal', null);
    expect([view.total, view.shown]).toEqual([0, 0]);
  });

  it('works on a raid that has drops (Nythraxis)', () => {
    const nythraxis = journalInstance('nythraxis_boss_arena');
    if (!nythraxis) throw new Error('the Nythraxis journal is missing');
    const key = nythraxis.source.bossKeys[0];
    const all = journalLootView(nythraxis, key, 'boss', 'normal', null);
    expect(all.total).toBeGreaterThan(0);
    const priest = journalLootView(nythraxis, key, 'boss', 'normal', {
      cls: 'priest',
      spec: 'holy',
    });
    expect(priest.shown).toBeLessThanOrEqual(all.total);
    expect(priest.total).toBe(all.total);
  });
});

describe('the shared loot pickers', () => {
  it('keeps the Adventure Guide markup and adds All classes for the journal', () => {
    const guide = lootPreviewControlsHtml({ cls: 'mage', spec: 'fire' });
    expect(guide).toContain('df-loot-hint');
    expect(guide).not.toContain('value=""' + ' selected>All classes');
    expect(guide).not.toContain('All classes');
    const journal = lootPreviewControlsHtml(null, { allClasses: true, bare: true });
    expect(journal).not.toContain('df-loot-hint');
    expect(journal).toMatch(/<option value="" selected>All classes<\/option>/);
    // With every class shown, the specialization list is off.
    expect(journal).toMatch(/data-loot-spec [^>]*disabled/);
    const own = lootPreviewControlsHtml({ cls: 'paladin', spec: 'holy' }, { allClasses: true });
    expect(own).toMatch(/<option value="paladin" selected>/);
    expect(own).toMatch(/<option value="holy" selected>/);
  });
});
