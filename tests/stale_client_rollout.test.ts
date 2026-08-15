// Deploy-window guard for the professions tuning release (stale-client work,
// R34). The bundle deployed at the merge base (9d7a1a021) predates the
// unknown-item guards and still THROWS in its corpse/chest loot popup on an
// item id it cannot resolve. The runbook (DEPLOY.md, "Client/server deploy
// order for content releases") requires every item id THIS PACKET adds to
// stay out of every loot-container table until clients have rolled; this
// file is what makes that instruction survive a parallel content PR during
// the deploy window, instead of living only as a runbook sentence.
//
// The v0.32.0 merge narrowed what this file can promise. The expansion
// itself put four mount reins into HEROIC_BOSS_LOOT on FIVE encounters that
// exist at the deployed base (the four heroic finales plus the Nythraxis
// raid), so the loot-popup throw is NOT unreachable for the merged branch
// as a whole: a solo or FFA heroic clear of any of them
// can hand a stale bundle an id it cannot resolve. That residual arm is the
// release's own, recorded in DEPLOY.md beside the surfaced forced-refresh
// question; the reins pin below holds it to EXACTLY those four mount ids.
// The v0.34.0 merge widened the same release-owned arm again: the Heroic
// Wildheart Basin loot pass (Zulgar) put six epic ids into
// HEROIC_BOSS_LOOT, deliberately admitted into the frozen snapshot at the
// merge (the audited union; DEPLOY.md's loot-window paragraph records it),
// so the frozen set is now reins exceptions plus the Wildheart six, and
// any FURTHER id, packet or release, still reds here.
//
// The pin is deliberately RELEASE-SCOPED: once the deploy window closes (the
// maintainer's call, after clients roll), the ids may enter loot tables and
// this file can be deleted whole.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';

// Every item id THIS PACKET adds relative to the deployed release, measured
// by diffing the content table keys against the release base (the fine-grade
// materials, the two new rods, and the two phase 12 charm items, 13 in all;
// the phase 11 first cut listed only its own eleven and the whole-branch
// review caught the charms missing). The v0.32.0 expansion's own ~50 new ids
// are deliberately NOT in this list: they are the release's to manage, and
// its four heroic reins are pinned as the named exception below. A rename in
// content breaks the existence arm loudly rather than letting the sweep go
// vacuous.
const NEW_RELEASE_ITEM_IDS = [
  'artisans_eye',
  'fine_ashwood_log',
  'fine_copper_ore',
  'fine_elderwood_log',
  'fine_goldleaf_herb',
  'fine_iron_ore',
  'fine_ironbark_log',
  'fine_silverleaf_herb',
  'fine_sunpetal_herb',
  'fine_thorium_ore',
  'gatherers_cache',
  'stormreel_fishing_rod',
  'tidewrought_fishing_rod',
] as const;

// Every string sitting under an `itemId` key, anywhere in a content object:
// shape-agnostic, so a new loot list format still feeds the sweep.
function collectItemIds(node: unknown, out: string[]): string[] {
  if (Array.isArray(node)) {
    for (const entry of node) collectItemIds(entry, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'itemId' && typeof value === 'string') out.push(value);
      else collectItemIds(value, out);
    }
  }
  return out;
}

describe('new release item ids stay out of loot containers (deploy window)', () => {
  it('names only real content ids (the sweep cannot go vacuous by rename)', () => {
    for (const id of NEW_RELEASE_ITEM_IDS) {
      expect(ITEMS[id], id).toBeTruthy();
    }
  });

  it('keeps every new id out of every mob, dungeon, and heroic loot table', () => {
    const mobLoot = collectItemIds(Object.values(MOBS), []);
    const dungeonLoot = collectItemIds(Object.values(DUNGEONS), []);
    // HEROIC_BOSS_LOOT is NOT reachable from MOBS/DUNGEONS (loot_roll.ts
    // reads it off the content module directly), which is exactly how the
    // expansion's reins slipped past the first version of this sweep.
    const heroicLoot = collectItemIds(Object.values(HEROIC_BOSS_LOOT), []);
    // Non-vacuity: the walks must actually be reading loot tables.
    expect(mobLoot.length).toBeGreaterThan(50);
    expect(heroicLoot.length).toBeGreaterThan(20);
    const all = new Set([...mobLoot, ...dungeonLoot, ...heroicLoot]);
    for (const id of NEW_RELEASE_ITEM_IDS) {
      expect(all.has(id), `${id} must stay out of mob/dungeon loot until clients roll`).toBe(false);
    }
  });

  it('freezes the heroic loot id set for the deploy window (the reins are the exception)', () => {
    // The recorded residual arm (see the file banner): the expansion shipped
    // exactly four reins into heroic boss loot on deployed-base encounters,
    // and the v0.34.0 merge deliberately admitted the six Wildheart Basin
    // epics beside them (the audited union; the decision is recorded in the
    // banner and DEPLOY.md). The v0.36.0 class-overhauls integration admits
    // ONE more id the same way (owner decision 2026-08-08, recorded in
    // DEPLOY.md): heroic_duskwhisper, the generated heroic variant of the
    // rogue re-band's Duskwhisper on the Fanglord Beastmaster. A stale
    // bundle renders the drop through the unknown-item fallback, the same
    // throw arm the Wildheart six rode. The whole table's id set is frozen for the
    // window, not just the reins_ slice: a fifth mount, a rift id, a packet
    // id, or ANY new id entering HEROIC_BOSS_LOOT while stale bundles live
    // is a new deployed-bundle throw arm and must be a deliberate decision
    // recorded here, the way the Wildheart six were. Release-scoped like
    // the file: delete with it once clients roll. The snapshot is
    // `vitest -u`-updatable, so the literal reins array below is the real
    // teeth: never blanket-update this snapshot while the deploy window is
    // open without recording the decision; a diff here IS the finding.
    const heroicIds = [...new Set(collectItemIds(Object.values(HEROIC_BOSS_LOOT), []))].sort();
    const reins = heroicIds.filter((id) => id.startsWith('reins_'));
    expect(reins).toEqual([
      'reins_grag_bear',
      'reins_shadowjump_toad',
      'reins_stalkglider_snail',
      'reins_stormfeather_griffin',
    ]);
    expect(heroicIds).toMatchSnapshot('heroic-boss-loot-id-set-deploy-window');
  });

  it('keeps every new id out of the delve chest feeders', () => {
    // The two content modules that assemble what the delve-chest loot popup
    // shows (delveChestItemsForTier and the litany chest tables). The shop
    // is deliberately NOT swept: shop rows render through guarded vendor
    // surfaces, and the rods legitimately live there.
    const feeders = [
      '../src/sim/content/delves/lockpick_tiers.ts',
      '../src/sim/content/delves/drowned_litany_loot.ts',
    ].map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'));
    // Non-vacuity: the feeders really are item-bearing tables.
    expect(feeders.some((source) => source.includes("itemId: '"))).toBe(true);
    for (const source of feeders) {
      for (const id of NEW_RELEASE_ITEM_IDS) {
        expect(source.includes(id), `${id} must stay out of the delve chest feeders`).toBe(false);
      }
    }
  });
});
