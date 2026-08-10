// Localized display text for Reliquary relic slots: the ONE display-name
// ladder every Reliquary surface reads, plus the sentence that tells a player
// where a missing relic comes from.
//
// This is the mount_labels.ts / armory_labels.ts family: a DOM-free,
// Node-testable localizer sitting between a pure core and its painters.
//
// Why it is its own module rather than part of reliquary_view.ts, since
// src/ui/CLAUDE.md does permit a pure view-core to import i18n for key and
// label selection:
//   1. The resolver has five call sites across TWO modules (hud.ts's chat log
//      and celebration banner, the window's cell name and recent chip, and the
//      search filter). Folding it into the view core would make hud.ts import a
//      view core just to name a relic.
//   2. Keeping the ARM CHOICE in the core and the TEXT here is what lets a
//      Vitest assert which source arm a hint selects with no locale loaded, and
//      lets the filter tests inject display names that share no substring with
//      the ids (proving the filter matches LOCALIZED text, not just something).
// reliquary_view.ts therefore emits ids and a ReliquarySourceLinePlan and takes
// injected search text, the same shape deeds_view.ts uses.
//
// The rule this module exists to enforce: an id NEVER becomes player-visible
// text by string surgery. There is no humanized `id.replace(/_/g, ' ')`
// fallback anywhere; an id no channel can name renders the authored
// "unknownRelic" copy, which is honest in every language.

import { DEEDS } from '../sim/content/deeds';
import {
  RELIQUARY_ACTIVITY_SOURCE_IDS,
  RELIQUARY_RIFT_RANK_SOURCE_IDS,
  RELIQUARY_STORE_SOURCE_ID,
} from '../sim/content/reliquary';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { DELVES, DUNGEONS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../sim/data';
import { localizeWeaponSkin } from './armory_labels';
import { craftNameKey } from './craft_name_view';
import { deedName, deedTitleText } from './deed_i18n';
import { dungeonDisplayName, itemDisplayName, tEntity, zoneDisplayName } from './entity_i18n';
import { gatheringProfessionNameKey } from './gathering_profession_name';
import { formatList, hasTranslation, type TranslationKey, t } from './i18n';
import { ownEntry } from './known_item';
import { MOUNT_NAME_KEYS } from './mount_labels';
import {
  type ReliquaryRelicNameKind,
  type ReliquarySourceLinePlan,
  reliquaryMarkFindKey,
} from './reliquary_view';

// The kind union is declared in the pure core (labels imports the core, never
// the reverse); re-exported here so both import paths keep resolving.
export type { ReliquaryRelicNameKind };

/**
 * Localized display name for one relic slot. Every Reliquary surface routes
 * here: grid cells, cell tooltips and aria labels, the Overview recent strip,
 * the search filter, and both hud.ts unlock ladders (chat log and celebration
 * banner), so a colon-namespaced id cannot render one way in chat and another
 * on the banner the way the two hand-rolled ladders used to.
 *
 * Every Record read goes through ownEntry: recent-find ids arrive off the wire,
 * and a bare index of a prototype key ('constructor') resolves a Function whose
 * missing fields render as "Object"/undefined (the R34 contract in
 * entity_i18n.ts).
 */
export function reliquaryRelicDisplayName(kind: ReliquaryRelicNameKind, id: string): string {
  if (kind === 'item' || kind === 'unknown') {
    const def = ownEntry(ITEMS, id);
    if (def) return itemDisplayName(def);
  }
  if (kind === 'mark') {
    // Mark ids arrive from a server-mirrored set, so a client older than the
    // server sees marks its catalog has no leaf for. t() on an untracked key
    // THROWS off a release build and renders the raw key string on one, and the
    // search filter now resolves every relic per keystroke, so one such id
    // would take down the whole window render rather than one chip.
    const markKey = reliquaryMarkFindKey(id);
    if (hasTranslation(markKey)) return t(markKey as TranslationKey);
  }
  if (kind === 'mount') {
    // Not mountDisplayName: that shared helper falls back to raw catalog
    // English and then to the raw id, which this module's contract forbids.
    // Membership first, then the authored copy.
    if (Object.hasOwn(MOUNT_NAME_KEYS, id)) return t(MOUNT_NAME_KEYS[id]);
  }
  if (kind === 'weapon_skin') {
    const def = ownEntry(WEAPON_SKINS, id);
    if (def) return localizeWeaponSkin(def).name;
  }
  if (kind === 'title') {
    const title = deedTitleText(id);
    if (title) return title;
  }
  return t('hudChrome.reliquary.unknownRelic');
}

/**
 * Casefolded display name, the shape the pure core's search filter matches
 * against (localized, so a player searches the names they can read).
 *
 * toLocaleLowerCase with the caller's tag, not toLowerCase: tr_TR ships, and
 * Turkish casefolds dotted/dotless I differently, so the invariant casing would
 * make a Turkish player's own keystrokes fail to match their own names. The
 * needle must be folded with the SAME tag (the deeds_window contract).
 */
export function reliquaryRelicSearchText(
  kind: ReliquaryRelicNameKind,
  id: string,
  tag: string,
): string {
  return reliquaryRelicDisplayName(kind, id).toLocaleLowerCase(tag);
}

// ---------------------------------------------------------------------------
// Source-line entity resolution. EVERY arm is membership-guarded before it
// localizes, because tEntity / dungeonDisplayName / zoneDisplayName / deedName
// all answer the RAW ID for an id they cannot place (the deliberate R34
// contract for wire-shaped ids). That fallback is right for a quest log, which
// still has to show the player something; it is wrong here, where the id would
// be spliced into a sentence and read as content: "Drops from
// gorne_the_dread in blackrock_hollow" must be impossible. A miss returns null
// and the whole line is dropped instead.
// ---------------------------------------------------------------------------

/** ZONES is an array, not a Record, so membership is a set built once. */
const ZONE_IDS: ReadonlySet<string> = new Set(ZONES.map((zone) => zone.id));

function bossName(mobId: string): string | null {
  return ownEntry(MOBS, mobId) ? tEntity({ kind: 'mob', id: mobId, field: 'name' }) : null;
}

function vendorName(npcId: string): string | null {
  return ownEntry(NPCS, npcId) ? tEntity({ kind: 'npc', id: npcId, field: 'name' }) : null;
}

function dungeonName(dungeonId: string): string | null {
  return ownEntry(DUNGEONS, dungeonId) ? dungeonDisplayName(dungeonId) : null;
}

function zoneName(zoneId: string): string | null {
  return ZONE_IDS.has(zoneId) ? zoneDisplayName(zoneId) : null;
}

function sourceDeedName(deedId: string): string | null {
  return ownEntry(DEEDS, deedId) ? deedName(deedId) : null;
}

/** The delve board's own name channel (tEntity kind 'delve'), membership-guarded
 *  first for the same reason every arm here is. */
function delveSourceName(delveId: string): string | null {
  return ownEntry(DELVES, delveId) ? tEntity({ kind: 'delve', id: delveId, field: 'name' }) : null;
}

/** The quest log's own name channel (tEntity kind 'quest', field 'title'). */
function questSourceName(questId: string): string | null {
  return ownEntry(QUESTS, questId) ? tEntity({ kind: 'quest', id: questId, field: 'title' }) : null;
}

/** Rift ranks are a closed authored ladder, not a live content table: an id off
 *  it names a rank that awards nothing, so the line is dropped rather than
 *  promising reins from a rank that never rolls them.
 *
 *  The rank letter renders as-is by design, not by string surgery: rank
 *  letters are the game's own untranslated designators, the same channel as
 *  hudChrome.itemTooltip.riftTier ('{tier}-rank Rift item'), which hud.ts
 *  feeds the raw instance tier. */
function riftRankLabel(rank: string): string | null {
  return (RELIQUARY_RIFT_RANK_SOURCE_IDS as readonly string[]).includes(rank) ? rank : null;
}

/** One key per authored award ACTIVITY. A new activity id with no key here
 *  renders no line at all rather than a generic sentence that would be wrong
 *  for whatever the new activity actually is. */
const ACTIVITY_SOURCE_KEYS: Readonly<Record<string, TranslationKey>> = {
  corpse_harvest: 'hudChrome.reliquary.sourceActivityCorpseHarvest',
  masterwork_craft: 'hudChrome.reliquary.sourceActivityMasterworkCraft',
  rift_first_clear: 'hudChrome.reliquary.sourceActivityRiftFirstClear',
};

/** Label key for a page's display-only SECONDARY clear meter, by the
 *  secondaryClearSource stat it names. Membership-guarded like every ladder in
 *  this module: an unknown stat answers null and the window paints no second
 *  meter (fail closed), never a wrong sentence around a real number. */
const SECONDARY_CLEARS_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  riftSRankClears: 'hudChrome.reliquary.srankClearsLabel',
};

export function reliquarySecondaryClearsLabelKey(stat: string): TranslationKey | null {
  return Object.hasOwn(SECONDARY_CLEARS_LABEL_KEYS, stat)
    ? SECONDARY_CLEARS_LABEL_KEYS[stat]
    : null;
}

/** Localized profession name for a source hint, or '' for an id on neither the
 *  craft ring nor the gathering table (no honest name means no source line
 *  rather than an invented one).
 *
 *  The typeof guard is not belt-and-braces: craftNameKey indexes its table bare
 *  (unlike its gathering sibling, which is Object.hasOwn-guarded), so a
 *  prototype key resolves Object.prototype.constructor, a truthy Function that
 *  would reach t() as a key. Guarding here keeps the fix inside this module
 *  rather than reshaping a helper five other windows share. */
function professionSourceName(professionId: string): string {
  const key = craftNameKey(professionId) ?? gatheringProfessionNameKey(professionId);
  return typeof key === 'string' ? t(key) : '';
}

/**
 * The player-visible "where does this come from" line for a missing relic,
 * localized from the pure plan. '' when the catalog authors no hint (or names
 * a profession this client cannot resolve): the surfaces hide the line rather
 * than print a blank sentence.
 */
export function reliquarySourceLineText(plan: ReliquarySourceLinePlan | undefined): string {
  if (plan === undefined) return '';
  switch (plan.kind) {
    case 'bossDungeon': {
      const boss = bossName(plan.bossId);
      const dungeon = dungeonName(plan.dungeonId);
      // A stale half degrades to the surviving AUTHORED half instead of
      // deleting the line (never a spliced raw id): the boss is the relic's
      // own hint, so it falls back to the plain boss sentence when the page's
      // dungeon id goes stale. The reverse does not hold: the dungeon comes
      // from the page clear meter, not from this relic's hints, so a stale
      // boss drops the line rather than inventing a dungeon-only door.
      if (boss === null) return '';
      if (dungeon === null) return t('hudChrome.reliquary.sourceBoss', { boss });
      return t('hudChrome.reliquary.sourceBossDungeon', { boss, dungeon });
    }
    case 'boss': {
      const boss = bossName(plan.bossId);
      return boss === null ? '' : t('hudChrome.reliquary.sourceBoss', { boss });
    }
    case 'zone': {
      const zone = zoneName(plan.zoneId);
      return zone === null ? '' : t('hudChrome.reliquary.sourceZone', { zone });
    }
    case 'profession': {
      const profession = professionSourceName(plan.professionId);
      return profession === '' ? '' : t('hudChrome.reliquary.sourceProfession', { profession });
    }
    case 'deed': {
      const deed = sourceDeedName(plan.deedId);
      return deed === null ? '' : t('hudChrome.reliquary.sourceDeed', { deed });
    }
    case 'vendor': {
      const vendor = vendorName(plan.npcId);
      return vendor === null ? '' : t('hudChrome.reliquary.sourceVendor', { vendor });
    }
    case 'bossZone': {
      const boss = bossName(plan.bossId);
      const zone = zoneName(plan.zoneId);
      // This composition consumed TWO authored hints, so a stale half
      // degrades to the other half's own sentence rather than deleting a
      // live, renderable door with it: the zone hint would have rendered
      // "Found in {zone}" on its own, the boss hint "Drops from {boss}".
      // Only both-stale drops the line, and no arm splices a raw id.
      if (boss !== null && zone !== null) {
        return t('hudChrome.reliquary.sourceBossZone', { boss, zone });
      }
      if (boss !== null) return t('hudChrome.reliquary.sourceBoss', { boss });
      if (zone !== null) return t('hudChrome.reliquary.sourceZone', { zone });
      return '';
    }
    case 'delve': {
      const delve = delveSourceName(plan.delveId);
      return delve === null ? '' : t('hudChrome.reliquary.sourceDelve', { delve });
    }
    case 'rift': {
      const rank = riftRankLabel(plan.rank);
      return rank === null ? '' : t('hudChrome.reliquary.sourceRift', { rank });
    }
    case 'quest': {
      const quest = questSourceName(plan.questId);
      return quest === null ? '' : t('hudChrome.reliquary.sourceQuest', { quest });
    }
    case 'store': {
      // One storefront, so the sentence needs no placeholder; the id is still
      // checked so a future second store cannot silently render as this one.
      return plan.storeId === RELIQUARY_STORE_SOURCE_ID ? t('hudChrome.reliquary.sourceStore') : '';
    }
    case 'activity': {
      const key = (RELIQUARY_ACTIVITY_SOURCE_IDS as readonly string[]).includes(plan.activityId)
        ? ACTIVITY_SOURCE_KEYS[plan.activityId]
        : undefined;
      return key === undefined ? '' : t(key);
    }
  }
}

/**
 * Every source line one relic can honestly show, in plan order, with the arms
 * that resolve to nothing dropped. The empty array is the un-hinted answer AND
 * the "every id went stale" answer: both leave the surfaces with no line to
 * paint, which is the same correct outcome.
 */
export function reliquarySourceLines(
  plans: readonly ReliquarySourceLinePlan[] | undefined,
): string[] {
  if (plans === undefined) return [];
  const lines: string[] = [];
  for (const plan of plans) {
    const line = reliquarySourceLineText(plan);
    if (line !== '') lines.push(line);
  }
  return lines;
}

/**
 * Fold resolved source lines into ONE string for an aria label, which cannot
 * carry the separate elements the tooltip paints.
 *
 * The join is formatList (Intl.ListFormat, the material_profession_hint_view
 * Used-by precedent), never a hardcoded ', ': ja joins with the ideographic
 * comma, both Chinese locales with the fullwidth one, and locales whose FINAL
 * separator differs from the medial one (ru "A, B и C") get that from
 * CLDR, which a pairwise key could never express. Conjunction is the honest
 * type: the routes coexist (the relic drops from A AND from B AND is
 * craftable), so the reader hears a list of facts, not a choice.
 */
export function reliquarySourceAriaText(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return formatList(lines);
}
