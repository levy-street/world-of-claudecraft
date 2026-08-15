// Character-sheet normalizer: turns a persisted characters row (+ a couple of
// pre-fetched extras) into the public JSON companion apps consume. PURE — no SQL,
// no IO — so it is trivially unit-testable; the route handlers in main.ts fetch
// the row/guild/rank and call this.
//
// Two visibilities share one normalizer:
//   - 'owner'  → full sheet (stats, vitals, gold, exact position)
//   - 'public' → safe subset (OMITS stats, vitals, gold, exact pos, inventory,
//                quest log) so an unauthenticated lookup never leaks a player's
//                build or whereabouts.
//
// Derived numbers reuse the engine, never re-derive: stats/vitals via
// recalcPlayerStats (through characterDerivedStats), zone via zoneAt, spec via
// the talents specLabel, virtualLevel via the types helper.

import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import {
  computeTalentModifiers,
  repairAllocation,
  specLabel,
  type TalentAllocation,
  type TalentModifiers,
} from '../src/sim/content/talents';
import { ITEMS, zoneAt } from '../src/sim/data';
import { completionCounts } from '../src/sim/deeds_completion';
import { characterDerivedStats } from '../src/sim/entity';
import { bagOwnedMounts } from '../src/sim/mounts';
import {
  catalogCharacterCompletion,
  curatorRankFromOwned,
  isCataloguedRelicItem,
  RELIQUARY_MARK_IDS,
  restoreReliquaryMarks,
  restoreReliquaryRecent,
} from '../src/sim/reliquary';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { virtualLevel, xpToReachLevel } from '../src/sim/types';
import type { CharacterRow } from './db';

export type SheetVisibility = 'owner' | 'public';

export interface SheetRank {
  scope: 'realm';
  rank: number;
  total: number;
}

export interface CharacterSheetInput {
  row: CharacterRow;
  visibility: SheetVisibility;
  realm: string;
  origin: string; // e.g. https://worldofclaudecraft.com ('' = relative)
  guild: string | null;
  rank: SheetRank | null;
  // The character's latest earned deeds (newest first, already limited),
  // pre-fetched from character_deeds like guild/rank are pre-fetched. Absent
  // means the caller fetched none; the block still builds from the state blob.
  deedsRecent?: SheetDeedRecent[];
  // ISO timestamp for the sheet; defaults to now(). Pass the row's updated_at
  // when available so the field reflects the character, not the request time.
  updatedAt?: string;
}

export interface MoneySplit {
  gold: number;
  silver: number;
  copper: number;
}
export interface SheetStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  armor: number;
  pvpOffense: number;
  pvpDefense: number;
}
export interface SheetVitals {
  hp: number;
  maxHp: number;
  resource: { type: string; value: number; max: number };
}
export interface SheetArenaBracket {
  rating: number;
  wins: number;
  losses: number;
  // The third figure of the W-L-D record. Legacy saves predate the field and
  // read 0, which is honest: a save with no draws key recorded no draws.
  draws: number;
}
export interface SheetDeedRecent {
  deedId: string;
  // ISO 8601. The owner arm carries the exact character_deeds server-clock
  // stamp; the public arm coarsens it to the UTC day ('YYYY-MM-DD') so an
  // unauthenticated reader cannot infer login/activity timing from it (the
  // owner's own Book shows day granularity too, so public never reveals more
  // than the owner surface does).
  earnedAt: string;
}
/** How many recent deeds the sheet's deeds summary lists. Lives here so every
 *  serving arm (both dispatch paths, both visibilities) shares one bound. */
export const SHEET_RECENT_DEEDS = 5;
// The Book of Deeds summary. Deeds are publicly visible by design (titles and
// Renown are the flex surface), so the block rides both visibilities: renown,
// earned count, and the displayed title come straight from the state blob the
// sheet already loads; recent is the pre-fetched character_deeds strip. The
// two sources are DELIBERATELY allowed to diverge transiently (a returning
// veteran's blob back-credits before the fire-and-forget index rows land);
// do not collapse them into one source.
// earnedCount follows the shared completion predicate
// (src/sim/deeds_completion.ts): non-feat live-catalog deeds, hidden ones
// counting once earned, so this number equals the character's own Book of
// Deeds header and never includes feats or removed-content ids.
export interface SheetDeeds {
  renown: number;
  earnedCount: number;
  activeTitle: string | null;
  recent: SheetDeedRecent[];
}

/** English display text for a selected title (sheet.deeds.activeTitle, a deed
 *  id from the state blob), or null when unset, stale/content-drifted, or not
 *  a title reward. English by design: the only consumer is the
 *  English-by-design /c/ SSR page; client surfaces localize the id through
 *  deed_i18n instead, and the JSON sheet keeps carrying the raw id. */
export function sheetTitleText(activeTitle: string | null): string | null {
  if (!activeTitle) return null;
  const reward = DEEDS[activeTitle]?.reward;
  return reward?.kind === 'title' ? reward.text : null;
}

/** How many recent Reliquary finds the sheet's reliquary block lists. Lives
 *  here beside SHEET_RECENT_DEEDS so every serving arm (both dispatch paths,
 *  both visibilities) shares one bound. */
export const SHEET_RECENT_RELICS = 5;

/**
 * One entry on the recent-finds strip: a catalogued relic id plus the kind of
 * slot it fills, and nothing else. No first-find provenance, no obtain tally,
 * and no timestamp (the recent ring stores none, so there is nothing to
 * coarsen the way SheetDeedRecent.earnedAt is). Only the two kinds the ring
 * can hold: pushRecent is called from the item first-find path and from the
 * authored-mark path, never for mounts, weapon skins, or titles.
 * Clients localize the id; the English-by-design /c/ SSR page resolves display
 * text through sheetRelicRecentText. No in-game client consumes this JSON
 * field yet (the in-game strip reads the snapshot facet, exactly as with
 * deeds.recent): it exists for the page and for external readers.
 */
export interface SheetRelicRecent {
  id: string;
  kind: 'item' | 'mark';
}

/**
 * Labeled Reliquary completion pair + Curator rank for sheet/public JSON, plus
 * the capped recent-finds strip. Character-scoped only: account weapon skins
 * never invent either side of the pair or the rank. Still no firstFind, no
 * obtain tally, and no full marks-set dump (privacy-safe).
 *
 * The strip rides BOTH visibilities unfiltered, where deeds.recent has to strip
 * hidden ids on the public arm. That is not an oversight: the Reliquary has no
 * hidden concept to strip. Hidden deeds never enter the catalog at all, not
 * even as a masked slot (see the comment above RELIQUARY_HORIZON_TITLES in
 * src/sim/content/reliquary.ts; tests/reliquary_content.test.ts pins both
 * directions), and no relic or mark carries a hidden flag of its own. Every id
 * the strip can carry is therefore already public catalog content, and the
 * wiki lists it by name for everyone.
 */
export interface SheetReliquary {
  owned: number;
  total: number;
  curatorRank: number;
  recent: SheetRelicRecent[];
}

/** English Curator rank names for the English-by-design /c/ SSR page. Mirror
 *  hudChrome.reliquary.curatorRankName1..5; the JSON sheet carries the numeric
 *  rank only so clients can localize. */
const CURATOR_RANK_ENGLISH: readonly string[] = [
  'Apprentice Curator',
  'Spoilskeeper',
  'Master Curator',
  'Grand Curator',
  'Eternal Curator',
];

/** English Curator rank label for public HTML, or null when unranked. */
export function sheetCuratorRankText(curatorRank: number): string | null {
  if (!(curatorRank > 0)) return null;
  return CURATOR_RANK_ENGLISH[curatorRank - 1] ?? null;
}

/** English names for the authored Reliquary marks, for the English-by-design
 *  /c/ SSR page. Mirrors hudChrome.reliquary.markFind.*; the JSON sheet carries
 *  the mark id only so clients localize. Same shape of decision as
 *  CURATOR_RANK_ENGLISH: content authors marks as bare ids with no name field
 *  (unlike items, which carry an English content name), so the only server-safe
 *  source is a hand table here, cross-pinned against the client catalog and
 *  against RELIQUARY_MARK_IDS in tests/character_sheet.test.ts. A Map rather
 *  than an object literal so no id can ever resolve through Object.prototype.
 *
 *  Exported for the KEY direction of that cross-pin only. sheetRelicRecentText
 *  covers the forward half (every live mark id resolves to a name) by lookup,
 *  but a lookup can never see a row whose id has been RETIRED from the catalog,
 *  so the reverse half has to enumerate the table's own keys. Read-only by type;
 *  the resolver below stays the way anything else reads a name. */
export const RELIQUARY_MARK_ENGLISH: ReadonlyMap<string, string> = new Map([
  ['masterwork:first', 'First Masterwork'],
  ['masterwork:weaponcrafting', 'Weaponcrafting Masterwork'],
  ['masterwork:armorcrafting', 'Armorcrafting Masterwork'],
  ['masterwork:tailoring', 'Tailoring Masterwork'],
  ['masterwork:leatherworking', 'Leatherworking Masterwork'],
  ['masterwork:engineering', 'Engineering Masterwork'],
  ['gather_event:pristine_vein', 'Pristine Vein'],
  ['gather_event:ancient_heartwood', 'Ancient Heartwood'],
  ['gather_event:moonlit_bloom', 'Moonlit Bloom'],
  ['gather_event:perfect_specimen', 'Perfect Specimen'],
  // Rares of the Realm kill proofs (Phase 21): 'Slain: <mob display name>',
  // names verbatim from MOBS (tests/character_sheet.test.ts derives the pin).
  ['slain:old_greyjaw', 'Slain: Old Greyjaw'],
  ['slain:mogger', 'Slain: Mogger'],
  ['slain:grix_the_tunnelking', 'Slain: Grix the Tunnelking'],
  ['slain:captain_verlan', 'Slain: Captain Verlan'],
  ['slain:wraithbinder_maldrec', 'Slain: Wraithbinder Maldrec'],
  ['slain:mirejaw_the_ravenous', 'Slain: Mirejaw the Ravenous'],
  ['slain:sloomtooth_the_drowned', 'Slain: Sloomtooth the Drowned'],
  ['slain:sister_nhalia', 'Slain: Sister Nhalia'],
  ['slain:grubjaw', 'Slain: Grubjaw the Glutton'],
  ['slain:ironvein_foreman', 'Slain: Ironvein Foreman'],
  ['slain:brutok_skullsmasher', 'Slain: Brutok Skullsmasher'],
  ['slain:voskar_emberwing', 'Slain: Voskar the Emberwing'],
  ['slain:marrowlord_varkas', 'Slain: Marrowlord Varkas'],
  ['slain:old_cragmaw', 'Slain: Old Cragmaw'],
  ['slain:shardlord_kazzix', 'Slain: Shardlord Kazzix'],
  ['slain:gleamstag', 'Slain: The Gleamstag'],
  ['slain:old_marrowshell', 'Slain: Old Marrowshell'],
  ['slain:aurelhorn', 'Slain: Aurelhorn, First of the Herd'],
  ['slain:drakemaw_broodlord', 'Slain: Drakemaw Broodlord'],
]);

/**
 * English display name for one recent-strip entry, or null when the id has no
 * live name (content drift, or a newer id arriving through a mixed-version
 * fleet). Null means the /c/ page drops the entry: a raw relic id must never
 * reach the HTML, the same rule sheetTitleText follows for a stale title.
 */
export function sheetRelicRecentText(entry: SheetRelicRecent): string | null {
  if (entry.kind === 'mark') return RELIQUARY_MARK_ENGLISH.get(entry.id) ?? null;
  // Object.hasOwn, not a bare index: this is exported, so a hand-built entry
  // naming an Object.prototype key must not resolve to a prototype member's
  // name instead of failing closed.
  if (!Object.hasOwn(ITEMS, entry.id)) return null;
  return ITEMS[entry.id]?.name ?? null;
}

/**
 * The newest SHEET_RECENT_RELICS entries of an already-restored recent ring,
 * NEWEST-first (the stored ring is oldest-first), ids and kinds only.
 *
 * Fails closed per entry: an id that is neither a catalogued relic item nor an
 * authored mark is skipped rather than published with a guessed kind, and
 * skipping does not consume one of the five slots. That skip is defense in
 * depth, not the load-bearing filter: restoreReliquaryRecent applies the exact
 * same predicate to the saved blob first, so nothing arriving through
 * sheetRecentRelicsFromSaved can reach it. The arm is what keeps an
 * uncatalogued id off a public surface if this ever reads a ring some other
 * path assembled.
 *
 * This function takes the RING rather than the blob precisely so that arm has a
 * test: 'drops a RING id that is neither a catalogued item nor an authored mark'
 * in tests/character_sheet.test.ts hands it an id no restore would have let
 * through, and pins the drop directly instead of leaving the branch on the
 * documented mutation-testing gap it used to sit on.
 */
export function sheetRecentRelicsFromRing(ring: readonly string[]): SheetRelicRecent[] {
  const out: SheetRelicRecent[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < SHEET_RECENT_RELICS; i--) {
    const id = ring[i];
    const kind = isCataloguedRelicItem(id)
      ? ('item' as const)
      : RELIQUARY_MARK_IDS.has(id)
        ? ('mark' as const)
        : undefined;
    if (kind === undefined) continue;
    out.push({ id, kind });
  }
  return out;
}

/**
 * The sheet's recent-finds strip for one persisted state blob: restore the ring
 * (which drops corrupt values and ids the live catalog no longer knows), then
 * take the newest SHEET_RECENT_RELICS survivors newest-first.
 *
 * Exported alongside the ring core so the whole composition has a test of its
 * own, not only the two halves.
 */
export function sheetRecentRelicsFromSaved(saved: CharacterState['reliquary']): SheetRelicRecent[] {
  return sheetRecentRelicsFromRing(restoreReliquaryRecent(saved));
}

/**
 * Derive the privacy-safe Reliquary sheet block from a CharacterState blob.
 * Mount ownership scans bags + bank reins (same bags+bank seam as live
 * ownedMounts); skins are account cosmetics and are deliberately omitted.
 */
export function sheetReliquaryFromState(state: CharacterState): SheetReliquary {
  const itemsDiscovered = new Set(state.deedStats?.itemsDiscovered ?? []);
  // Narrow restores: this path wants the marks set and the recent ring, not the
  // whole state, so it no longer rebuilds firstFind and the counts map (and the
  // illuminated set) on every public sheet read.
  const marks = restoreReliquaryMarks(state.reliquary);
  // PRIVACY NOTE (locked handling: documented, behavior unchanged). The union
  // is bags PLUS bank, the same seam live ownedMounts uses, so a mount whose
  // reins sit in the BANK still scores here. A public reader can therefore
  // observe, through the owned aggregate and the Curator rank derived from it,
  // that a character owns reins they have never carried. Accepted: the exposure
  // is aggregate-only (one number and a rank, never a mount id, never a bank
  // slot, never the bank's other contents), and it is the same number the
  // in-game Mounts window already shows to the owner from both containers, so
  // narrowing it here alone would make the public pair disagree with the live
  // collection. Bags-only is a recorded follow-up for a later phase, an owner
  // call, not a defect to fix in passing. See docs/design/reliquary.md, "Public
  // sheet exposure".
  const inv = [...(state.inventory ?? []), ...(state.bank?.inventory ?? [])];
  const ownedMounts = new Set(bagOwnedMounts(inv));
  const deedsEarned = new Set(Object.keys(state.deeds ?? {}));
  const opts = { itemsDiscovered, marks, ownedMounts, deedsEarned };
  const completion = catalogCharacterCompletion(opts);
  return {
    owned: completion.owned,
    total: completion.total,
    // Rank scores the same character-durable owned count (one catalog walk).
    curatorRank: curatorRankFromOwned(completion.owned),
    recent: sheetRecentRelicsFromSaved(state.reliquary),
  };
}

export interface CharacterSheet {
  name: string;
  realm: string;
  class: PlayerClass;
  classLabel: string;
  spec: string | null;
  level: number;
  virtualLevel: number;
  prestigeRank: number;
  skin: number;
  avatarUrl: string;
  zone: string;
  guild: string | null;
  arena: Record<string, SheetArenaBracket>;
  deeds: SheetDeeds;
  /** Character-scoped Reliquary completion + rank + recent finds (both
   *  visibilities). */
  reliquary: SheetReliquary;
  rank: SheetRank | null;
  profileUrl: string;
  visibility: SheetVisibility;
  updatedAt: string;
  // owner-only fields (absent on the public variant)
  stats?: SheetStats;
  vitals?: SheetVitals;
  gold?: MoneySplit;
  pos?: { x: number; z: number };
}

const CLASS_LABELS: Record<PlayerClass, string> = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  shaman: 'Shaman',
  mage: 'Mage',
  warlock: 'Warlock',
  druid: 'Druid',
};

export function splitCopper(copper: number): MoneySplit {
  const c = Math.max(0, Math.floor(copper));
  return { gold: Math.floor(c / 10000), silver: Math.floor(c / 100) % 100, copper: c % 100 };
}

function normalizeAllocation(
  cls: PlayerClass,
  state: CharacterState,
  level: number,
): TalentAllocation {
  return repairAllocation(cls, state.talents, level);
}

function talentMods(
  cls: PlayerClass,
  state: CharacterState,
  level: number,
): TalentModifiers | undefined {
  try {
    // Pass the character's level so mastery level-scaling matches the live sim
    // (a sub-20 character's sheet must not report full-strength mastery stats).
    return computeTalentModifiers(cls, normalizeAllocation(cls, state, level), level);
  } catch {
    return undefined; // never let a malformed allocation break a public read
  }
}

function arenaBrackets(state: CharacterState): Record<string, SheetArenaBracket> {
  const out: Record<string, SheetArenaBracket> = {};
  // Legacy single-rating saves are treated as 1v1 (mirrors serializeCharacter).
  const r1 = state.arena1v1Rating ?? state.arenaRating;
  const w1 = state.arena1v1Wins ?? state.arenaWins;
  const l1 = state.arena1v1Losses ?? state.arenaLosses;
  if (r1 !== undefined || w1 !== undefined || l1 !== undefined) {
    out['1v1'] = {
      rating: Number(r1 ?? 0),
      wins: Number(w1 ?? 0),
      losses: Number(l1 ?? 0),
      // Number() at the boundary, not just `?? 0`: these come out of JSONB, so
      // a legacy row can carry a string where a number is declared, and the
      // profile page interpolates them straight into HTML.
      draws: Number(state.arena1v1Draws ?? 0),
    };
  }
  if (
    state.arena2v2Rating !== undefined ||
    state.arena2v2Wins !== undefined ||
    state.arena2v2Losses !== undefined
  ) {
    out['2v2'] = {
      rating: Number(state.arena2v2Rating ?? 0),
      wins: Number(state.arena2v2Wins ?? 0),
      losses: Number(state.arena2v2Losses ?? 0),
      draws: Number(state.arena2v2Draws ?? 0),
    };
  }
  return out;
}

export function characterSheet(input: CharacterSheetInput): CharacterSheet {
  const { row, visibility, realm, origin, guild, rank } = input;
  const cls = row.class as PlayerClass;
  const state: CharacterState = row.state ?? ({} as CharacterState);
  const level = row.level ?? state.level ?? 1;
  const skin = Math.max(0, Math.min(7, Math.floor(state.skin ?? 0)));
  const lifetimeXp = state.lifetimeXp ?? xpToReachLevel(level);
  const copper = state.copper ?? 0;
  const zPos = state.pos?.z ?? 0;

  const base = origin.replace(/\/+$/, '');
  const avatarUrl = `${base}/avatar/${cls}/${skin}.png`;
  const profileUrl = `${base}/c/${encodeURIComponent(row.name)}`;

  const sheet: CharacterSheet = {
    name: row.name,
    realm,
    class: cls,
    classLabel: CLASS_LABELS[cls] ?? cls,
    spec: specLabel(cls, normalizeAllocation(cls, state, level)),
    level,
    virtualLevel: virtualLevel(lifetimeXp),
    prestigeRank: state.prestigeRank ?? 0,
    skin,
    avatarUrl,
    zone: zoneAt(state.pos?.x ?? 0, zPos).name,
    guild: guild ?? null,
    arena: arenaBrackets(state),
    deeds: {
      renown: state.renown ?? 0,
      // The shared completion predicate (src/sim/deeds_completion.ts): non-feat
      // live-catalog deeds, hidden ones once earned; equals the Book of Deeds
      // header for this character. The COUNT including earned hidden deeds
      // reveals no hidden id (the Book shows the owner the same number), and
      // feats plus removed-content ids deliberately no longer inflate it.
      earnedCount: completionCounts(new Set(Object.keys(state.deeds ?? {})), DEEDS, DEED_ORDER)
        .earned,
      activeTitle: state.activeTitle ?? null,
      // Hidden deeds are invisible until earned, existence included, so the
      // PUBLIC arm strips them (a third-party viewer who has not earned one
      // must not learn its id here); the owner HAS earned theirs, so the owner
      // arm keeps them, matching the Book's own shelf. The public arm fails
      // CLOSED: it also drops any id with no live DeedDef, because a
      // mixed-version fleet (or a binary rollback) can surface a NEWER hidden
      // deed's descriptive slug through an older process, which a current
      // client would resolve to full name and description. Kept INLINE rather
      // than shared with deeds_records so this db-free module never pulls the
      // deeds-db graph into its import graph (a known partial-mock breakage
      // class), and the rule of three is not yet met. The strip can shorten
      // the fetched window below its limit; hidden earns are rare by design.
      // The public arm also coarsens earnedAt to the UTC day: exact stamps on
      // an unauthenticated surface leak activity timing (see SheetDeedRecent).
      recent:
        visibility === 'public'
          ? (input.deedsRecent ?? [])
              .filter((r) => {
                const def = DEEDS[r.deedId];
                return def !== undefined && def.hidden !== true;
              })
              .map((r) => ({ deedId: r.deedId, earnedAt: r.earnedAt.slice(0, 10) }))
          : (input.deedsRecent ?? []),
    },
    // Character-scoped completion pair, rank, and the capped recent-finds
    // strip (ids + kinds). Never firstFind, never the obtain tally, never the
    // full marks set.
    reliquary: sheetReliquaryFromState(state),
    rank: rank ?? null,
    profileUrl,
    visibility,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  if (visibility === 'owner') {
    const derived = characterDerivedStats(
      cls,
      level,
      state.equipment ?? {},
      talentMods(cls, state, level),
      state.equipmentInstance ?? state.equipmentInstances ?? {},
    );
    sheet.stats = { ...derived.stats };
    sheet.vitals = {
      hp: state.hp ?? derived.maxHp,
      maxHp: derived.maxHp,
      resource: {
        type: derived.resourceType ?? 'mana',
        value: state.resource ?? 0,
        max: derived.maxResource,
      },
    };
    sheet.gold = splitCopper(copper);
    sheet.pos = { x: state.pos?.x ?? 0, z: zPos };
  }

  return sheet;
}
