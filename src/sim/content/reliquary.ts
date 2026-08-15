// The Reliquary catalog: data-as-code shelves, pages, and relic slots, plus
// pure read-only projections of the table (isCataloguedRelic*, the source
// resolver). No engine logic lives here; runtime marks and pure completion
// math live in src/sim/reliquary.ts. Player-facing names are English content
// re-localized at the client boundary (the sim never emits Reliquary English
// text).
//
// Page table is append-only once product pages ship: append new pages at the
// END and never reorder or remove an id (ids may be referenced by firstFind
// diagnostics and content pin tests). Phase 2 authors Conquerors; Phase 7
// appends Professions (masterwork marks, rare field notes, key specimens);
// Phase 8 appends Horizons (mounts, weapon skins, titles).
//
// Curation rule (performance + product): every relic is hand-listed. Do not
// auto-scrape every loot row. Prefer rare+ chase uniques, signature dungeon
// brand pieces, HEROIC_BOSS_LOOT gear (not mount reins; those are Horizons),
// and epic set members. Heroic upgraded variants (heroic_<base>) are NOT
// catalogued: markItemDiscovered already credits the base id, so listing both
// would double-count completion.

import { FURY_STOCK, WARFARE_ITEMS } from './pvp_honor';
import {
  RIFT_EPIC_ITEM_IDS,
  RIFT_GEAR_ITEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  RIFT_RARE_ITEM_IDS,
} from './rift/items';

/** Top-level shelf ids (Overview is virtual UI, not a catalog shelf row). */
export type ReliquaryShelfId = 'conquerors' | 'professions' | 'horizons';

/** How a page reads lifetime clear / kill counts from existing player state. */
export type ReliquaryClearSource =
  | { kind: 'dungeon'; dungeonId: string; difficulty?: 'normal' | 'heroic' | 'any' }
  | { kind: 'delve'; delveId: string }
  /** Existing DeedStats.counters key (e.g. thunzharrKills for the world boss). */
  | { kind: 'deed_stat'; stat: string }
  | { kind: 'none' };

/**
 * Which live id space a source hint's `sourceId` is drawn from.
 *
 * 'boss' is the mob-loot arm, and the name is broader than it reads: the
 * catalog credits mid-bosses, elite trash FAMILIES (sanctum_boneguard,
 * sanctum_drakonid), and open-world rares through it, because all three award
 * loot the same way, off a MobTemplate.loot row keyed by a MOBS id.
 */
export type ReliquarySourceKind =
  | 'boss'
  | 'zone'
  | 'profession'
  | 'deed'
  | 'vendor'
  | 'delve'
  | 'rift'
  | 'quest'
  | 'store'
  | 'activity';

/**
 * Authored answer to "where do I get this?" for one relic. Structured ids
 * only, never prose: the client re-localizes from the id, the same way every
 * other Reliquary name crosses the boundary.
 *
 * A relic with several comparable live routes names ALL of them (see
 * ReliquarySourceHints): the honest answer to "where do I hunt this" is every
 * door, not a guess at the best one. A relic carries NO hint only where content
 * names no route at all; those slots are listed in SOURCE_PENDING_RULING in
 * tests/reliquary_content.test.ts, so the gap stays a visible maintainer
 * decision rather than an invented answer.
 */
export interface ReliquarySourceHint {
  readonly sourceKind: ReliquarySourceKind;
  readonly sourceId: string;
}

/** One relic's authored source: a single hint, or an ordered list when content
 *  really awards it through several comparable routes. The list arm is a
 *  NON-EMPTY tuple on purpose: an authored empty array would carry the
 *  `source` key and so suppress a page default while saying nothing, which is
 *  never a meaning anyone intends, so it fails tsc at the authoring site
 *  instead of waiting for the runtime pin. A one-door relic may be authored
 *  as either shape (the resolver normalizes); the catalog convention is the
 *  bare hint, so `Array.isArray(relic.source)` is NOT a valid "is this
 *  multi-door" test anywhere. The tuple also rejects a WIDENED
 *  `readonly ReliquarySourceHint[]` on purpose: a future helper that computes
 *  its door list (a .map over ids) must assert non-emptiness explicitly
 *  rather than hand the catalog a list that could be empty. */
export type ReliquarySourceHints =
  | ReliquarySourceHint
  | readonly [ReliquarySourceHint, ...ReliquarySourceHint[]];

/** The account storefront that grants Armory weapon skins
 *  (grantWeaponSkinsToAccount in server/game.ts, driven by server/claudium.ts).
 *  Its own id space of exactly one entry: there is one storefront. */
export const RELIQUARY_STORE_SOURCE_ID = 'woc_store' as const;

/**
 * Award ACTIVITIES: player actions that write a trophy directly, with no mob,
 * vendor, or quest in between. Each id names its live write site:
 * - corpse_harvest: src/sim/interaction.ts writes gather_event:perfect_specimen
 *   and grants the HARVEST_COMPONENT_SPECIMENS items on a signed jackpot roll.
 * - masterwork_craft: src/sim/professions/crafting.ts writes masterwork:first on
 *   the first lifetime masterwork proc, from ANY of the gear crafts.
 * - rift_first_clear: src/sim/rift/progression.ts addRiftProgressionLoot mints
 *   one class-matched Riftbound band per participant for the party that wins a
 *   ranked rift's first-clear race (src/sim/rift/runs.ts completeRiftClear
 *   gates the call on claim.won AND claim.event, so a dev portal never mints).
 *   The hint is rank-agnostic on purpose: every ranked tier, C included, mints
 *   the rings on its event's first clear.
 */
export const RELIQUARY_ACTIVITY_SOURCE_IDS = [
  'corpse_harvest',
  'masterwork_craft',
  'rift_first_clear',
] as const;
export type ReliquaryActivitySourceId = (typeof RELIQUARY_ACTIVITY_SOURCE_IDS)[number];

/** Rift ranks that award mount reins (RIFT_GREEN / BLUE / EPIC_MOUNT_REINS,
 *  src/sim/rift/progression.ts). C is excluded because its clear rolls no
 *  mount at all: ranks do not inherit each other's tiers. */
export const RELIQUARY_RIFT_RANK_SOURCE_IDS = ['B', 'A', 'S'] as const;
export type ReliquaryRiftRank = (typeof RELIQUARY_RIFT_RANK_SOURCE_IDS)[number];

/** One unique slot on a page. Item relics own via itemsDiscovered; other kinds
 *  use authored marks or existing ownership tables (mounts, skins, titles). */
export type ReliquaryRelicDef =
  | { kind: 'item'; itemId: string; source?: ReliquarySourceHints }
  | { kind: 'mark'; markId: string; source?: ReliquarySourceHints }
  | { kind: 'mount'; mountId: string; source?: ReliquarySourceHints }
  | { kind: 'weapon_skin'; skinId: string; source?: ReliquarySourceHints }
  | { kind: 'title'; deedId: string; source?: ReliquarySourceHints };

export interface ReliquaryPageDef {
  id: string;
  shelf: ReliquaryShelfId;
  /** English content name (client re-localizes). */
  name: string;
  /** Optional English blurb. */
  desc?: string;
  /** Clear-count source; omit or `none` when the page has no clear meter. */
  clearSource?: ReliquaryClearSource;
  /** Display-only SECOND clear meter, rendered by the window after the primary
   *  when present. Never read by completion, rank, or deed math. Must name a
   *  DEED_STAT_KEYS member (the same stat space the deed_stat clearSource arm
   *  draws from); the window validates membership and floors finite positives
   *  before painting, so a drifted stat renders nothing rather than a lie. */
  secondaryClearSource?: { kind: 'deed_stat'; stat: string };
  /** Outside-completion flag, rule 7 (docs/design/reliquary.md), carrying its
   *  REASON so the chrome can name it:
   *  - 'retired': the retired shelf (Vault of Ages). The content stays a
   *    VISIBLE, labeled page rather than a silent delete, but its slots can no
   *    longer be won.
   *  - 'personal': per-character class-personal grants no one can complete.
   *    The Riftbound bands are minted one per character, bound and personal, so
   *    a single character can never hold more than one of the three.
   *  Either way completion math must not count the page: both sides of every
   *  completion pair skip it together (owned AND total, the account-skin
   *  precedent: weapon skins already sit outside the character pair the same
   *  way), and the page-local pair still renders the page's own owned/total.
   *  Absence is the live-content default; every runtime check is truthiness on
   *  the flag, so the reason narrows presentation only. */
  excludeFromCompletion?: 'retired' | 'personal';
  /** Source every un-hinted relic on this page inherits. Authored only where
   *  EVERY relic on the page really shares ONE source, which is why it stays a
   *  single hint rather than a list: a page whose relics need several routes
   *  needs them per relic, not page-wide. */
  sourceDefault?: ReliquarySourceHint;
  /** Ordered relic slots for the page grid. */
  relics: readonly ReliquaryRelicDef[];
}

// ---------------------------------------------------------------------------
// Item-relic helpers (keep page tables readable; no engine behavior)
// ---------------------------------------------------------------------------

/** A page-table entry: a bare id, or an id paired with its own source hint (or
 *  the list of hints, when content really awards it several ways). */
type RelicEntry = string | readonly [string, ReliquarySourceHints];

function entryId(entry: RelicEntry): string {
  return typeof entry === 'string' ? entry : entry[0];
}

/** Omits the key entirely when un-hinted, so an un-authored relic never
 *  carries a `source: undefined` the resolver would have to special-case.
 *
 *  Authored LISTS are frozen here, at the one construction chokepoint: the
 *  resolver answers a multi-door relic with that exact array by reference, so
 *  an unfrozen one would let a caller's in-place sort or push rewrite the
 *  module-level catalog for the whole process, server included. */
function withSource(def: ReliquaryRelicDef, entry: RelicEntry): ReliquaryRelicDef {
  if (typeof entry === 'string') return def;
  const source = entry[1];
  return { ...def, source: 'sourceKind' in source ? source : Object.freeze(source) };
}

/** Every authored hint is frozen at its constructor: the resolver hands
 *  catalog hint objects back by reference (inside frozen lists), so a mutable
 *  hint would let one caller's field write rename a door process-wide, server
 *  included. Freezing here covers every authoring channel at once (bare hints,
 *  list members, page defaults, and the titles() deed hints). */
const hint = (h: ReliquarySourceHint): ReliquarySourceHint => Object.freeze(h);
const fromBoss = (mobId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'boss', sourceId: mobId });
const fromVendor = (npcId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'vendor', sourceId: npcId });
const fromProfession = (professionId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'profession', sourceId: professionId });
const fromDelve = (delveId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'delve', sourceId: delveId });
/** Rank typed against the live ladder (see RELIQUARY_RIFT_RANK_SOURCE_IDS, which
 *  excludes C), so a rift hint cannot name C without failing tsc.
 *
 *  Three authoring uses today, which is why the rank vocabulary is shared
 *  rather than reins-specific: the Horizons mount reins (one rarity tier per
 *  rank), the Rift page's clear-time epics (B is the MINIMUM rank whose clear
 *  pays from the heroic pool), and its S-only legendaries. */
const fromRift = (rank: ReliquaryRiftRank): ReliquarySourceHint =>
  hint({ sourceKind: 'rift', sourceId: rank });
const fromQuest = (questId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'quest', sourceId: questId });
const fromStore = (): ReliquarySourceHint =>
  hint({ sourceKind: 'store', sourceId: RELIQUARY_STORE_SOURCE_ID });
const fromActivity = (activityId: ReliquaryActivitySourceId): ReliquarySourceHint =>
  hint({ sourceKind: 'activity', sourceId: activityId });
const fromZone = (zoneId: string): ReliquarySourceHint =>
  hint({ sourceKind: 'zone', sourceId: zoneId });

function items(...entries: readonly RelicEntry[]): ReliquaryRelicDef[] {
  return entries.map((e) => withSource({ kind: 'item', itemId: entryId(e) }, e));
}

function marks(...entries: readonly RelicEntry[]): ReliquaryRelicDef[] {
  return entries.map((e) => withSource({ kind: 'mark', markId: entryId(e) }, e));
}

function mounts(...entries: readonly RelicEntry[]): ReliquaryRelicDef[] {
  return entries.map((e) => withSource({ kind: 'mount', mountId: entryId(e) }, e));
}

function weaponSkins(...entries: readonly RelicEntry[]): ReliquaryRelicDef[] {
  return entries.map((e) => withSource({ kind: 'weapon_skin', skinId: entryId(e) }, e));
}

/** A title relic's deed IS its source: the deed that grants the title is the
 *  only way to earn it, so the hint is attached here rather than hand-repeated
 *  on all 33 rows, where it could only ever drift out of agreement. */
function titles(...ids: readonly string[]): ReliquaryRelicDef[] {
  return ids.map((deedId) => ({
    kind: 'title' as const,
    deedId,
    source: hint({ sourceKind: 'deed', sourceId: deedId }),
  }));
}

// Horizons curated lists (Phase 8). Pin tests lock these to live MOUNTS,
// WEAPON_SKINS, and deeds with title rewards. Ownership stays on existing
// seams (ownedMounts, accountCosmetics.weaponSkinIds, deedsEarned).
export const RELIQUARY_HORIZON_MOUNTS = [
  'valorsteed',
  'stormfeather_griffin',
  'shadowjump_toad',
  'grag_bear',
  'stalkglider_snail',
  'aether_hover_cycle',
  'thunderstrut_gobbler',
  'drakemaw_raptor',
  'terrorspark_groundshaker',
] as const;

// Per-mount sources. A mount is owned through its reins ItemDef (kind 'mount',
// `mount` === the mount key), so every hint below is really a claim about where
// those reins drop: HEROIC_BOSS_LOOT rows (src/sim/content/heroic_loot.ts) for
// the boss arms, the rank's own reins table for the rift arms
// (RIFT_GREEN / BLUE / EPIC_MOUNT_REINS, src/sim/rift/progression.ts), and
// NPC vendorItems for Marla.
//
// valorsteed names ONLY the vendor, deliberately: q_riding_lessons awards no
// item at all (its itemRewards is empty; it gates the Riding skill and the
// reins are a separate 10 gold purchase from Marla afterwards, see the quest
// def in content/zone3.ts), so a quest hint there would name a door that hands
// out nothing.
//
// drakemaw_raptor and terrorspark_groundshaker are absent, and that absence IS
// the answer: no live table awards either (drakemaw_raptor has no acquisition
// path, terrorspark_groundshaker is dev-grant only). They are the catalog's
// two SOURCE_PENDING_RULING mounts; masterwork:engineering on the professions
// shelf is the third pending slot (QA ruling 2026-08-07).
//
// Keys are typed against the live mount ladder so a misspelled or renamed key
// fails tsc at the authoring site instead of falling through to the pending
// pin one layer later.
const MOUNT_SOURCES: Readonly<
  Partial<Record<(typeof RELIQUARY_HORIZON_MOUNTS)[number], ReliquarySourceHints>>
> = {
  // One-door mounts are authored as bare hints per the ReliquarySourceHints
  // convention (a one-element list would mean the same thing; the catalog
  // never encodes meaning in the shape).
  valorsteed: fromVendor('stablemaster_marla'),
  stormfeather_griffin: [
    fromBoss('morthen'),
    fromBoss('nythraxis_scourge_of_thornpeak'),
    fromRift('B'),
  ],
  shadowjump_toad: [
    fromBoss('vael_the_mistcaller'),
    fromBoss('nythraxis_scourge_of_thornpeak'),
    fromRift('B'),
  ],
  grag_bear: [
    fromBoss('ysolei'),
    fromBoss('wildheart_high_priest'),
    fromBoss('nythraxis_scourge_of_thornpeak'),
    fromRift('A'),
  ],
  stalkglider_snail: [
    fromBoss('korzul_the_gravewyrm'),
    fromBoss('wildheart_high_priest'),
    fromBoss('nythraxis_scourge_of_thornpeak'),
    fromRift('A'),
  ],
  aether_hover_cycle: fromRift('S'),
  thunderstrut_gobbler: fromRift('S'),
};

/** Mount slots carrying their MOUNT_SOURCES hints, with RELIQUARY_HORIZON_MOUNTS
 *  left the single authority on membership and order. A mount with no row falls
 *  through bare rather than inventing a route. */
function mountEntries(ids: readonly (typeof RELIQUARY_HORIZON_MOUNTS)[number][]): RelicEntry[] {
  return ids.map((id) => {
    // Own-property read, same reasoning as setMembers below.
    const source = Object.hasOwn(MOUNT_SOURCES, id) ? MOUNT_SOURCES[id] : undefined;
    return source ? ([id, source] as const) : id;
  });
}

export const RELIQUARY_HORIZON_WEAPON_SKINS = [
  'guildmark_arming_sword',
  'brasscap_axe',
  'tempered_flanged_mace',
  'guildmark_dirk',
  'brasscrown_staff',
  'lacquered_wand',
  'fletcher_s_guild_bow',
  'cinderbrand_sword',
  'emberbite_axe',
  'smoulderfall_mace',
  'ashspark_dagger',
  'forgeheart_staff',
  'emberwrought_wand',
  'cinderlatch_crossbow',
  'ice_fang_sword',
  'glaciersplit_axe',
  'rimecrusher_mace',
  'frostbite_dagger',
  'hoarfrost_vigil_staff',
  'everwinter_wand',
  'winterbite',
  'solheim_sword',
  'skyrender_axe',
  'starfall_mace',
  'astravyr_dagger',
  'cosmarch_staff',
  'emberwish_wand',
  'encore_bow',
  'meteorlatch_crossbow',
] as const;

// Hidden deeds NEVER enter the Reliquary, not even as a masked or locked slot:
// a hidden deed's existence is itself the secret, so a placeholder row would
// spoil it just as loudly as the name. The Book of Deeds is their only home,
// where they stay invisible until earned. Keep this list to non-hidden title
// rewards; tests/reliquary_content.test.ts pins both directions.
/** Deeds that grant a title reward (real DEEDS ids only; no invented titles). */
export const RELIQUARY_HORIZON_TITLES = [
  'prog_veteran',
  'prog_champion',
  'prog_paragon',
  'prog_mythic',
  'prog_eternal',
  'dgn_korzul_flawless',
  'dgn_nythraxis_deathless',
  'cmb_thunzharr_unbroken',
  'dlv_nhalia_bells',
  'chr_vale_chapter_iii',
  'chr_marsh_chapter_iii',
  'chr_peaks_chapter_iii',
  'col_discovery_150',
  'col_seven_regalia',
  'pvp_arena_1v1_1900',
  'pvp_vcup_wins_25',
  'soc_market_magnate',
  'exp_world_traveler',
  'prog_guildsworn',
  'prog_masterwright',
  'prog_master_angler',
  'prog_grandmaster_engineering',
  'prog_grandmaster_alchemy',
  'prog_grandmaster_cooking',
  'prog_grandmaster_leatherworking',
  'prog_grandmaster_tailoring',
  'prog_grandmaster_enchanting',
  'prog_grandmaster_weaponcrafting',
  'prog_grandmaster_armorcrafting',
  'pvp_bg_wins_25',
  'col_reliquary_rank_2',
  'col_reliquary_rank_3',
  'col_reliquary_rank_4',
  // WARFARE lifetime-honor ladder (release v0.35.0 sync): every non-hidden
  // title deed pages here per the locked titles-page rule.
  'pvp_honor_sergeant',
  'pvp_honor_knight_lieutenant',
  'pvp_honor_field_marshal',
  // The Reliquary completion ladder (Phase 18). col_reliquary_complete is
  // DELIBERATELY absent, the one exception to the locked titles-page rule:
  // its trigger is owned === total over the character catalog, so putting its
  // own title on this page grows total by one the player cannot own before
  // the grant, making completion unreachable (the non-terminating
  // self-reference). Contrast the rank bridges, which are self-terminating
  // because maybeSyncCuratorRankDeeds early-outs once every due bridge is
  // earned. tests/reliquary_content.test.ts pins the exclusion.
  'col_reliquary_conquerors',
  'col_reliquary_illum_nythraxis_heroic',
  'col_reliquary_illum_thunzharr',
  'col_reliquary_illum_gravewyrm_heroic',
] as const;

// Profession lifetime mark ids (Phase 7). Prefer existing visited namespaces
// for rare field notes (`gather_event:*`). Masterwork marks pair with
// `masterwork:*` visited entries written at proc time. The visit is NOT crash
// insurance (both ledgers persist in one character blob on one save cadence,
// so a crash before autosave loses both together): it is the durable copy for
// a blob whose reliquary marks were filtered away, because the restore paths
// differ (restoreDeedStats keeps any registered namespace while
// restoreReliquaryState keeps only currently catalogued ids), so a mark
// dropped from the catalog and later re-added refills from the surviving
// visit at join. A pre-Reliquary binary is NOT covered: it predates the
// namespace registration and drops the visits too (state.md rollback note).
// History is never invented (the visit exists only if the proc really
// happened).
export const RELIQUARY_PROFESSION_MARKS = {
  /** First lifetime masterwork proc (any craft). */
  masterworkFirst: 'masterwork:first',
  /** First masterwork per craft on the ring that the gallery catalogs. Only
   *  the first four are gear-capable today: every engineering recipe produces
   *  a slotless, statless tool, so masterworkBonusStats returns null and the
   *  engineering mark can never be written (QA ruling 2026-08-07: the slot
   *  stays catalogued but un-hinted in SOURCE_PENDING_RULING beside the two
   *  gap mounts, an owner call; a stats-bearing engineering craftable would
   *  un-pend it). */
  masterworkByCraft: [
    'masterwork:weaponcrafting',
    'masterwork:armorcrafting',
    'masterwork:tailoring',
    'masterwork:leatherworking',
    'masterwork:engineering',
  ],
  /** Rare gather / corpse specimen visit marks already written by professions. */
  fieldNotes: [
    'gather_event:pristine_vein',
    'gather_event:ancient_heartwood',
    'gather_event:moonlit_bloom',
    'gather_event:perfect_specimen',
  ],
} as const;

/**
 * Apex fine-grade materials (key signed-field trophies via itemsDiscovered).
 * The corpse block mirrors HARVEST_COMPONENT_SPECIMENS values (pinned
 * bidirectionally in tests/reliquary_content.test.ts so a new harvest family
 * cannot land without its Reliquary slot); the fine_* trio are the gathering
 * jackpots, and glimmerfin_koi is fishing's (FISHING_RARE_ID, the one rare
 * catch every band table pays; fishing has no world nodes, so no fine_* grade
 * exists for it and the koi is the ladder's jackpot instead).
 */
export const RELIQUARY_PROFESSION_SPECIMEN_ITEMS = [
  'pristine_hide',
  'pristine_silk',
  'pristine_venom_gland',
  'prime_cut',
  'pristine_claw',
  'fine_thorium_ore',
  'fine_elderwood_log',
  'fine_sunpetal_herb',
  'glimmerfin_koi',
] as const;

/** Field-note flavor to the gathering profession that works its node type
 *  (gatherRareEventFlavor plus NODE_HARVEST_TABLE, src/sim/professions/).
 *  gather_event:perfect_specimen is absent on purpose: it fires on corpse
 *  harvest, which belongs to no gathering profession and takes the
 *  corpse_harvest ACTIVITY hint instead.
 *
 *  Exported because the client's cell-art resolver paints each field note
 *  with its gathering profession's art and must read that pairing from here
 *  rather than re-listing it. */
export const FIELD_NOTE_PROFESSIONS: Readonly<Record<string, string>> = Object.freeze({
  'gather_event:pristine_vein': 'mining',
  'gather_event:ancient_heartwood': 'logging',
  'gather_event:moonlit_bloom': 'herbalism',
});

/** Specimen jackpot to its gathering profession. The five corpse-harvest
 *  pristine specimens are absent for the same reason as perfect_specimen, and
 *  take the same corpse_harvest activity hint. Stays private, unlike its
 *  exported sibling above: specimen relics are `kind: 'item'` and resolve
 *  their art through ITEMS, so the cell-art resolver never reads this map. */
const SPECIMEN_PROFESSIONS: Readonly<Record<string, string>> = Object.freeze({
  fine_thorium_ore: 'mining',
  fine_elderwood_log: 'logging',
  fine_sunpetal_herb: 'herbalism',
  // The rare catch (FISHING_RARE_ID): every FISHING_TABLES_BY_BAND cell pays
  // it, and only the fishing profession can reel it in, so it takes the
  // profession hint like the fine_* trio rather than the corpse fallback.
  glimmerfin_koi: 'fishing',
});

/** Ids carrying a profession hint where the map has one, and the `fallback`
 *  hint (the activity that really awards them) everywhere it deliberately does
 *  not. Keeps the curated id lists above the single authority on membership
 *  and order. The fallback is required: both live pages have one, and a page
 *  that wants un-hinted fall-through authors bare entries directly. */
function withProfessions(
  ids: readonly string[],
  professionById: Readonly<Record<string, string>>,
  fallback: ReliquarySourceHint,
): RelicEntry[] {
  return ids.map((id) => {
    // Own-property read, same reasoning as setMembers below.
    const professionId = Object.hasOwn(professionById, id) ? professionById[id] : undefined;
    if (professionId) return [id, fromProfession(professionId)] as const;
    return [id, fallback] as const;
  });
}

// Epic set members, pinned to the same id lists as col_set_* deeds in
// content/deeds.ts so collection pages and Reliquary set pages stay aligned.
// Leveling haste kits (vale / boundstone / greyjaw) stay out of Conquerors;
// they are world-drop kits, not instance spoils.
export const RELIQUARY_SET_MEMBERS = {
  deathlord: [
    'deathlord_warplate',
    'deathlord_legguards',
    'deathlord_sabatons',
    'deathlords_dread_visage',
  ],
  wyrmshadow: [
    'wyrmshadow_harness',
    'wyrmshadow_treads',
    'wyrmshadow_legguards',
    'wyrmshadow_talongrips',
  ],
  necromancers: [
    'necromancers_starshroud',
    'necromancers_soulsteps',
    'necromancers_legwraps',
    'necromancers_soulspire_mantle',
  ],
  crownforged: [
    'crownforged_gauntlets',
    'crownforged_girdle',
    'crownforged_dreadhelm',
    'crownforged_warspaulders',
  ],
  nighttalon: [
    'nighttalon_grips',
    'nighttalon_waistband',
    'nighttalon_crown',
    'nighttalon_shoulderguards',
  ],
  soulflame: ['soulflame_gloves', 'soulflame_cord', 'soulflame_cowl', 'soulflame_mantle'],
  stormcallers: [
    'stormcallers_handguards',
    'stormcallers_waistguard',
    'stormcallers_crown',
    'stormcallers_spaulders',
  ],
} as const;

// Per-member source for the set pages. A set page cannot take a page default:
// its members are gathered from across the world (raid, world boss, Sanctum
// mid-bosses, open-world rares), which is the point of the page.
//
// 26 of the 28 members below ALSO appear on their own dungeon or world-boss
// page, authored there independently, and the cross-page agreement pin in
// tests/reliquary_content.test.ts holds those two authorings equal so this
// table cannot drift away from the source page.
//
// deathlord_sabatons and necromancers_legwraps are the exceptions in one
// sense left: since Phase 21 both ALSO sit on conquerors_spoils_of_the_realm
// with byte-identical hints, so the cross-page agreement pin now constrains
// them like every shared member; keep this table and the Spoils rows moving
// together. They are also no longer the only relics credited to a rare rather
// than a boss (the whole Spoils page is), but they remain the pattern's
// origin: each drops from its named
// rare's dedicated chase roll group at 0.25, versus a 0.001 trickle off common
// zone trash, so the rare is the source a player actually farms, not a coin
// flip between two routes. Each pairs its rare with the ZONE that rare camps
// in, because "which rare" is only half the answer for an open-world drop: the
// other half is where to go looking for it.
//
// Keys typed against the live set-member ladder, same rationale as
// MOUNT_SOURCES above.
const SET_MEMBER_SOURCES: Readonly<
  Partial<
    Record<
      (typeof RELIQUARY_SET_MEMBERS)[keyof typeof RELIQUARY_SET_MEMBERS][number],
      ReliquarySourceHints
    >
  >
> = {
  deathlord_warplate: fromBoss('korzul_the_gravewyrm'),
  deathlord_legguards: fromBoss('grand_necromancer_velkhar'),
  deathlord_sabatons: [fromBoss('ironvein_foreman'), fromZone('thornpeak_heights')],
  deathlords_dread_visage: fromBoss('korzul_the_gravewyrm'),
  wyrmshadow_harness: fromBoss('korzul_the_gravewyrm'),
  wyrmshadow_treads: fromBoss('korgath_the_bound'),
  wyrmshadow_legguards: fromBoss('grand_necromancer_velkhar'),
  wyrmshadow_talongrips: fromBoss('korzul_the_gravewyrm'),
  necromancers_starshroud: fromBoss('korzul_the_gravewyrm'),
  necromancers_soulsteps: fromBoss('grand_necromancer_velkhar'),
  necromancers_legwraps: [fromBoss('marrowlord_varkas'), fromZone('thornpeak_heights')],
  necromancers_soulspire_mantle: fromBoss('korzul_the_gravewyrm'),
  crownforged_gauntlets: fromBoss('thunzharr_waking_peak'),
  crownforged_girdle: fromBoss('thunzharr_waking_peak'),
  crownforged_dreadhelm: fromBoss('nythraxis_scourge_of_thornpeak'),
  crownforged_warspaulders: fromBoss('nythraxis_scourge_of_thornpeak'),
  nighttalon_grips: fromBoss('thunzharr_waking_peak'),
  nighttalon_waistband: fromBoss('thunzharr_waking_peak'),
  nighttalon_crown: fromBoss('nythraxis_scourge_of_thornpeak'),
  nighttalon_shoulderguards: fromBoss('nythraxis_scourge_of_thornpeak'),
  soulflame_gloves: fromBoss('thunzharr_waking_peak'),
  soulflame_cord: fromBoss('thunzharr_waking_peak'),
  soulflame_cowl: fromBoss('nythraxis_scourge_of_thornpeak'),
  soulflame_mantle: fromBoss('nythraxis_scourge_of_thornpeak'),
  stormcallers_handguards: fromBoss('thunzharr_waking_peak'),
  stormcallers_waistguard: fromBoss('thunzharr_waking_peak'),
  stormcallers_crown: fromBoss('nythraxis_scourge_of_thornpeak'),
  stormcallers_spaulders: fromBoss('nythraxis_scourge_of_thornpeak'),
};

/** Set-page members carrying their SET_MEMBER_SOURCES hint. A member with no
 *  row falls through un-hinted rather than inventing one; the coverage test
 *  reds on it. */
function setMembers(
  ids: readonly (typeof RELIQUARY_SET_MEMBERS)[keyof typeof RELIQUARY_SET_MEMBERS][number][],
): RelicEntry[] {
  return ids.map((id) => {
    // Own-property read: an id like 'constructor' or 'toString' would otherwise
    // walk the prototype and hand back a function as if it were a hint.
    const source = Object.hasOwn(SET_MEMBER_SOURCES, id) ? SET_MEMBER_SOURCES[id] : undefined;
    return source ? ([id, source] as const) : id;
  });
}

// HEROIC_BOSS_LOOT gear only (mount reins excluded; Horizons owns mounts).
// Tests pin these lists against the live table so a new heroic gear row fails
// until it is deliberately added here.
export const RELIQUARY_HEROIC_GEAR = {
  morthen: [
    'morthens_cryptforged_hauberk',
    'shadowpulse_handwraps',
    'bonechill_striders',
    'lunarward_cinch',
    'cryptplate_helm',
    'shadowpulse_slippers',
    'bonechill_cord',
  ],
  vael_the_mistcaller: [
    'mistcallers_fang',
    'tidebound_spaulders',
    'sash_of_the_sunken_court',
    'mistforged_pauldrons',
    'tideguard_faceguard',
    'sunken_court_mantle',
    'dreamroot_boots',
  ],
  ysolei: [
    'lunar_tide_greatstaff',
    'tidewoven_trousers',
    'choirmothers_casque',
    'stormbark_mantle',
    'lunar_choir_leggings',
    'choir_blessed_spaulders',
    'tideworn_warboots',
  ],
  korzul_the_gravewyrm: [
    'gravewyrm_cleaver',
    'shroud_of_the_gravewyrm',
    'sanctum_prowlers_grips',
    'gravewyrm_claws',
    'gravescale_girdle',
    'wyrmchoir_handwraps',
    'wildsoul_maul',
  ],
  wildheart_high_priest: [
    'basin_stalkers_tunic',
    'verdant_heart_vestment',
    'sunbone_ritual_hauberk',
    'greatfang_of_the_basin',
    'sunbone_oracles_crown',
    'bloodmane_war_legguards',
  ],
  nythraxis_scourge_of_thornpeak: [
    'deathless_greatblade',
    'scepter_of_the_deathless_court',
    'stormcallers_focus',
  ],
} as const;

// ---------------------------------------------------------------------------
// Conquerors shelf (Phase 2)
// ---------------------------------------------------------------------------
// Order: append-only. Phase 1 stub id `conquerors_hollow_crypt` is kept and
// expanded with real Hollow Crypt uniques (boundstone_helm moved to Sanctum).

// ---------------------------------------------------------------------------
// The Rift page (Phase 21)
// ---------------------------------------------------------------------------
// Per-rare hint table keyed by the LIVE RIFT_RARE_ITEM_IDS array (`satisfies`
// asserts exhaustiveness both ways), so a new themed rare fails tsc here until
// its doors are authored. Each row follows the 13a every-door standard: it
// names EVERY mob whose static loot really carries the item (theme wiring
// src/sim/content/rift/themes.ts, loot rows src/sim/content/rift/mobs.ts):
// the theme boss's fat roll first, then its trash's slim ones in mobs.ts
// table order. graskbreaker_girdle has one trash carrier (the Warcamp theme
// shares rift_marrow_troll with Boneyard, whose loot stays bonelord_mantle),
// pactbound_vestments spans both citadel bosses plus both citadel trash, and
// pitlords_cleaver is the pit lord's alone.
const RIFT_RARE_SOURCES = {
  hoarfrost_edge: [
    fromBoss('rift_boss_frost'),
    fromBoss('rift_frost_revenant'),
    fromBoss('rift_rime_elemental'),
  ],
  emberforge_gauntlets: [
    fromBoss('rift_boss_ember'),
    fromBoss('rift_ember_fiend'),
    fromBoss('rift_magma_brute'),
  ],
  broodmother_carapace: [
    fromBoss('rift_boss_venom'),
    fromBoss('rift_venom_weaver'),
    fromBoss('rift_thornback'),
  ],
  bonelord_mantle: [
    fromBoss('rift_boss_necro'),
    fromBoss('rift_boneclad'),
    fromBoss('rift_marrow_troll'),
  ],
  graskbreaker_girdle: [fromBoss('rift_boss_brute'), fromBoss('rift_stone_ogre')],
  voidscar_handwraps: [
    fromBoss('rift_boss_arcane'),
    fromBoss('rift_void_acolyte'),
    fromBoss('rift_dread_stalker'),
  ],
  stormscale_treads: [
    fromBoss('rift_boss_storm'),
    fromBoss('rift_storm_caller'),
    fromBoss('rift_stormscale'),
  ],
  abyssal_loop: [
    fromBoss('rift_boss_tide'),
    fromBoss('rift_tide_thrall'),
    fromBoss('rift_deep_lurker'),
  ],
  pactbound_vestments: [
    fromBoss('rift_boss_ritualist'),
    fromBoss('rift_boss_pitlord'),
    fromBoss('rift_hellguard'),
    fromBoss('rift_pact_acolyte'),
  ],
  pitlords_cleaver: fromBoss('rift_boss_pitlord'),
} as const satisfies Record<(typeof RIFT_RARE_ITEM_IDS)[number], ReliquarySourceHints>;

// ---------------------------------------------------------------------------
// Rares of the Realm + Spoils of the Realm (Phase 21)
// ---------------------------------------------------------------------------
// The 19 named overworld rares whose kill credit writes a `slain:<templateId>`
// visited mark (RARE_SLAIN_TEMPLATES in src/sim/deeds.ts; hand-listed here
// rather than imported because content stays engine-free and deeds.ts sits
// above this module in the import graph), paired with the zone each one camps
// in. Order is the RARE_SLAIN_TEMPLATES order, zone1 to drakelands, and the
// derivation pins in tests/reliquary_content.test.ts hold both the pairing and
// the order equal to the live set, so a new rare or a moved camp reds there.
const REALM_RARE_ZONES = [
  ['old_greyjaw', 'eastbrook_vale'],
  ['mogger', 'eastbrook_vale'],
  ['grix_the_tunnelking', 'eastbrook_vale'],
  ['captain_verlan', 'eastbrook_vale'],
  ['wraithbinder_maldrec', 'eastbrook_vale'],
  ['mirejaw_the_ravenous', 'mirefen_marsh'],
  ['sloomtooth_the_drowned', 'mirefen_marsh'],
  ['sister_nhalia', 'mirefen_marsh'],
  ['grubjaw', 'mirefen_marsh'],
  ['ironvein_foreman', 'thornpeak_heights'],
  ['brutok_skullsmasher', 'thornpeak_heights'],
  ['voskar_emberwing', 'thornpeak_heights'],
  ['marrowlord_varkas', 'thornpeak_heights'],
  ['old_cragmaw', 'thornpeak_heights'],
  ['shardlord_kazzix', 'thornpeak_heights'],
  ['gleamstag', 'veiled_hollow'],
  ['old_marrowshell', 'veiled_hollow'],
  ['aurelhorn', 'veiled_hollow'],
  ['drakemaw_broodlord', 'drakelands'],
] as const;

// ---------------------------------------------------------------------------
// Warfare pages (Phase 21)
// ---------------------------------------------------------------------------
// Both quartermasters front the SAME canonical honor stock: FURY at the
// Eastbrook arena (FURY_NPC in content/pvp_honor.ts) and Warmarshal Draven
// Kole at the Highwatch hub (content/zone3.ts, spawned under a reserved id by
// src/sim/pvp/warfare_quartermaster.ts), each with vendorItems = FURY_STOCK.
// Every slot therefore names both counters through one shared tuple. Honor
// purchases flow through the ordinary buyItem discovery path
// (markItemDiscovered + noteRelicObtain), so ownership needs no new state.
const WARFARE_VENDOR_HINTS = [fromVendor('fury'), fromVendor('warmarshal_draven_kole')] as const;
// The two pages PARTITION the live stock by the defs' own set field: the five
// battle kits (set-tagged armor, seven pieces each) fill the gallery in
// FURY_STOCK order (the authored-defs kit order: furyforged, stormbound,
// ashstalker, cinderweave, thornhide, each helmet to feet; the shop window's
// WARFARE_SHOP_SET_ORDER re-sorts by armor class instead and stays a display
// concern), and the set-less jewelry and weapons fill the armory. Deriving
// from FURY_STOCK keeps membership and order from ever trailing the content;
// the partition and both floors are pinned in tests/reliquary_content.test.ts.
const WARFARE_GALLERY_ITEM_IDS = FURY_STOCK.filter((id) => WARFARE_ITEMS[id].set !== undefined);
const WARFARE_ARMORY_ITEM_IDS = FURY_STOCK.filter((id) => WARFARE_ITEMS[id].set === undefined);

/**
 * Freeze the whole page table at its one construction site: the top-level
 * array, every page object, and every page's relics list. `readonly` is a
 * compile-time claim only, and this table is handed out by reference to every
 * host (the client bundle, the authoritative server, the RL env) and read by
 * the catalog-index memo in src/sim/reliquary.ts, which keys on this array's
 * IDENTITY and caches the id lists it walks out of it. A runtime write to a
 * page or a relics array would leave that memo answering with a stale index
 * for the whole process, and the index gates a persisted deed grant
 * (col_reliquary_complete). Nothing mutates these today; freezing turns the
 * memo's immutability assumption into an enforced contract, the same reason
 * the relic source hints and lists are frozen at their constructors above.
 *
 * The relic OBJECTS are frozen here too: hint / withSource freeze only the
 * source-hint VALUES on a relic, never the relic record itself, so without the
 * inner loop a runtime write to relic.itemId (or any id member) would still
 * invalidate the cached index while every container stayed frozen.
 */
function freezePageTable(pages: ReliquaryPageDef[]): readonly ReliquaryPageDef[] {
  for (const page of pages) {
    for (const relic of page.relics) Object.freeze(relic);
    Object.freeze(page.relics);
    if (page.clearSource !== undefined) Object.freeze(page.clearSource);
    if (page.secondaryClearSource !== undefined) Object.freeze(page.secondaryClearSource);
    Object.freeze(page);
  }
  return Object.freeze(pages);
}

export const RELIQUARY_PAGES: readonly ReliquaryPageDef[] = freezePageTable([
  // ---- Five-man dungeons: normal chase uniques ----
  {
    id: 'conquerors_hollow_crypt',
    shelf: 'conquerors',
    name: 'The Hollow Crypt',
    desc: 'Signature spoils claimed from Morthen and the Hollow Crypt.',
    clearSource: { kind: 'dungeon', dungeonId: 'hollow_crypt', difficulty: 'normal' },
    // Morthen is the only Crypt mob that drops any of these five.
    sourceDefault: fromBoss('morthen'),
    relics: items(
      'cryptbone_greaves',
      'cryptbone_helm',
      'cryptbone_pauldrons',
      'greyjaw_hide_boots',
      'gravewoven_bag',
    ),
  },
  {
    id: 'conquerors_hollow_crypt_heroic',
    shelf: 'conquerors',
    name: 'Heroic Hollow Crypt',
    desc: 'Heroic-only epics from Morthen the Gravecaller.',
    clearSource: { kind: 'dungeon', dungeonId: 'hollow_crypt', difficulty: 'heroic' },
    sourceDefault: fromBoss('morthen'),
    relics: items(...RELIQUARY_HEROIC_GEAR.morthen),
  },
  {
    id: 'conquerors_sunken_bastion',
    shelf: 'conquerors',
    name: 'The Sunken Bastion',
    desc: 'Rare and epic spoils from Olen and Vael the Fogbinder.',
    clearSource: { kind: 'dungeon', dungeonId: 'sunken_bastion', difficulty: 'normal' },
    // Two bosses, and every relic drops from exactly one of them, so the page
    // takes no default: each row names its own.
    relics: items(
      ['tideguard_greaves', fromBoss('knight_commander_olen')],
      ['tideguard_sabatons', fromBoss('knight_commander_olen')],
      ['eelscale_leggings', fromBoss('knight_commander_olen')],
      ['tidescale_vest', fromBoss('vael_the_mistcaller')],
      ['drowned_prayer_leggings', fromBoss('vael_the_mistcaller')],
      ['drowned_prayer_sandals', fromBoss('vael_the_mistcaller')],
      ['eelscale_treads', fromBoss('vael_the_mistcaller')],
      ['mistcallers_duffel', fromBoss('vael_the_mistcaller')],
    ),
  },
  {
    id: 'conquerors_sunken_bastion_heroic',
    shelf: 'conquerors',
    name: 'Heroic Sunken Bastion',
    desc: 'Heroic-only epics from Vael the Fogbinder.',
    clearSource: { kind: 'dungeon', dungeonId: 'sunken_bastion', difficulty: 'heroic' },
    // Every heroic page defaults to the boss its RELIQUARY_HEROIC_GEAR list is
    // keyed by: that key IS the HEROIC_BOSS_LOOT mob id awarding the gear.
    sourceDefault: fromBoss('vael_the_mistcaller'),
    relics: items(...RELIQUARY_HEROIC_GEAR.vael_the_mistcaller),
  },
  {
    id: 'conquerors_drowned_temple',
    shelf: 'conquerors',
    name: 'The Drowned Temple',
    desc: 'Rare spoils from Choirmother Selthe and Ysolei, Avatar of the Drowned Moon.',
    clearSource: { kind: 'dungeon', dungeonId: 'drowned_temple', difficulty: 'normal' },
    relics: items(
      ['ysols_pearl_greaves', fromBoss('ysolei')],
      ['moonshroud_breastplate', fromBoss('ysolei')],
      ['moonshroud_robe', fromBoss('ysolei')],
      ['moonshroud_tunic', fromBoss('ysolei')],
      ['selthes_seastriders', fromBoss('choirmother_selthe')],
    ),
  },
  {
    id: 'conquerors_drowned_temple_heroic',
    shelf: 'conquerors',
    name: 'Heroic Drowned Temple',
    desc: 'Heroic-only epics from Ysolei.',
    clearSource: { kind: 'dungeon', dungeonId: 'drowned_temple', difficulty: 'heroic' },
    sourceDefault: fromBoss('ysolei'),
    relics: items(...RELIQUARY_HEROIC_GEAR.ysolei),
  },
  {
    id: 'conquerors_gravewyrm_sanctum',
    shelf: 'conquerors',
    name: 'Gravewyrm Sanctum',
    desc: 'Rare and epic spoils from the Sanctum bosses and Korzul the Gravewyrm.',
    clearSource: { kind: 'dungeon', dungeonId: 'gravewyrm_sanctum', difficulty: 'normal' },
    // FIVE live LOOT TABLES drop this page's relics (sanctum_boneguard and
    // sanctum_drakonid elite trash plus the three bosses), and all five are
    // authored here; recipes and quests add further non-loot routes.
    //
    // The seven rows that used to sit un-hinted were never a single-source
    // question: each really is awarded through two or three comparable doors,
    // so each names all of them rather than picking a winner.
    // - boundstone_helm: boneguard_bonus 0.04, korgath_bonus 0.08, and the
    //   armorcrafting recipe recipe_ironbound_warplate_helm.
    // - boundstone_girdle: boneguard_bonus 0.04 and korzul_bonus 0.05.
    // - gravewyrm_mantle: drakonid_bonus 0.05 and korgath_bonus 0.08.
    // - gravewyrm_gauntlets: drakonid_bonus 0.05, korzul_bonus 0.05, and the
    //   WEAPONcrafting recipe recipe_forgeguard_bulwark_gauntlets (the combo
    //   pair authored it on the weapon side; see content/recipes.ts).
    // - staff_of_velkhar and shadowmeld_tunic: korgath_bonus 0.1 and
    //   velkhar_bonus 0.1. q_velkhar's guaranteed mage / rogue reward needs no
    //   hint of its own: its kill objective IS grand_necromancer_velkhar, so
    //   the quest is the same door the velkhar hint already names. That
    //   same-door elision is the RULE for every Sanctum quest reward whose
    //   kill objective is the hinted boss: it also covers q_velkhar's warrior
    //   arm (boneguard_breastplate) and q_korgath's korgaths_chainwraps for
    //   all three classes. Only q_gravewyrm points at a DIFFERENT boss, so it
    //   alone is named directly (next bullet).
    // - wyrmcult_grand_robe: korgath_bonus 0.1 plus the guaranteed mage reward
    //   of q_gravewyrm, whose kill objective is korzul instead. Those are two
    //   DIFFERENT doors, so the quest is named directly rather than folded into
    //   a mob hint that would send half its finders to the wrong boss.
    relics: items(
      // Mid-boss and trash chase (rare+)
      [
        'boundstone_helm',
        [
          fromBoss('sanctum_boneguard'),
          fromBoss('korgath_the_bound'),
          fromProfession('armorcrafting'),
        ],
      ],
      ['boundstone_girdle', [fromBoss('sanctum_boneguard'), fromBoss('korzul_the_gravewyrm')]],
      ['gravewyrm_mantle', [fromBoss('sanctum_drakonid'), fromBoss('korgath_the_bound')]],
      [
        'gravewyrm_gauntlets',
        [
          fromBoss('sanctum_drakonid'),
          fromBoss('korzul_the_gravewyrm'),
          fromProfession('weaponcrafting'),
        ],
      ],
      ['gravewyrm_thornmaul', fromBoss('sanctum_drakonid')],
      ['korgaths_chainwraps', fromBoss('korgath_the_bound')],
      ['staff_of_velkhar', [fromBoss('korgath_the_bound'), fromBoss('grand_necromancer_velkhar')]],
      ['shadowmeld_tunic', [fromBoss('korgath_the_bound'), fromBoss('grand_necromancer_velkhar')]],
      ['wyrmcult_grand_robe', [fromBoss('korgath_the_bound'), fromQuest('q_gravewyrm')]],
      ['gravewyrm_sabatons', fromBoss('korgath_the_bound')],
      ['wyrmcult_soulsteps', fromBoss('korgath_the_bound')],
      ['wyrmshadow_treads', fromBoss('korgath_the_bound')],
      ['boneguard_breastplate', fromBoss('grand_necromancer_velkhar')],
      ['gravewyrm_stalkers_treads', fromBoss('grand_necromancer_velkhar')],
      ['deathlord_legguards', fromBoss('grand_necromancer_velkhar')],
      ['necromancers_soulsteps', fromBoss('grand_necromancer_velkhar')],
      ['wyrmshadow_legguards', fromBoss('grand_necromancer_velkhar')],
      // Korzul final
      ['wyrmfang_greatblade', fromBoss('korzul_the_gravewyrm')],
      ['staff_of_the_gravewyrm', fromBoss('korzul_the_gravewyrm')],
      ['fang_of_korzul', fromBoss('korzul_the_gravewyrm')],
      ['deathlord_warplate', fromBoss('korzul_the_gravewyrm')],
      ['necromancers_starshroud', fromBoss('korzul_the_gravewyrm')],
      ['wyrmshadow_harness', fromBoss('korzul_the_gravewyrm')],
      ['deathlords_dread_visage', fromBoss('korzul_the_gravewyrm')],
      ['necromancers_soulspire_mantle', fromBoss('korzul_the_gravewyrm')],
      ['wyrmshadow_talongrips', fromBoss('korzul_the_gravewyrm')],
      ['nightfangs_greatstaff', fromBoss('korzul_the_gravewyrm')],
      ['wildgrowth_leggings', fromBoss('korzul_the_gravewyrm')],
      ['grovewardens_grips', fromBoss('korzul_the_gravewyrm')],
      ['verdant_walkers', fromBoss('korzul_the_gravewyrm')],
      ['gravewyrm_bone_quiver', fromBoss('korzul_the_gravewyrm')],
    ),
  },
  {
    id: 'conquerors_gravewyrm_sanctum_heroic',
    shelf: 'conquerors',
    name: 'Heroic Gravewyrm Sanctum',
    desc: 'Heroic-only epics from Korzul the Gravewyrm.',
    clearSource: { kind: 'dungeon', dungeonId: 'gravewyrm_sanctum', difficulty: 'heroic' },
    sourceDefault: fromBoss('korzul_the_gravewyrm'),
    relics: items(...RELIQUARY_HEROIC_GEAR.korzul_the_gravewyrm),
  },
  {
    id: 'conquerors_wildheart_basin',
    shelf: 'conquerors',
    name: 'The Wildheart Basin',
    desc: 'Signature weapons from Zulgar and the Fanglord.',
    clearSource: { kind: 'dungeon', dungeonId: 'wildheart_basin', difficulty: 'normal' },
    relics: items(
      ['fanglords_beastspear', fromBoss('wildheart_beastmaster')],
      ['duskwhisper', fromBoss('wildheart_beastmaster')],
      ['wildheart_tuskblade', fromBoss('wildheart_high_priest')],
      ['wildheart_hexwood_staff', fromBoss('wildheart_high_priest')],
      ['wildheart_fangknife', fromBoss('wildheart_high_priest')],
    ),
  },
  {
    id: 'conquerors_wildheart_basin_heroic',
    shelf: 'conquerors',
    name: 'Heroic Wildheart Basin',
    desc: 'Heroic-only epics from Zulgar, Voice of the Basin.',
    clearSource: { kind: 'dungeon', dungeonId: 'wildheart_basin', difficulty: 'heroic' },
    sourceDefault: fromBoss('wildheart_high_priest'),
    relics: items(...RELIQUARY_HEROIC_GEAR.wildheart_high_priest),
  },
  // ---- Raid ----
  {
    id: 'conquerors_nythraxis',
    shelf: 'conquerors',
    name: 'Nythraxis Raid',
    desc: 'Epic and legendary spoils from Nythraxis, Scourge of Thornpeak.',
    clearSource: { kind: 'dungeon', dungeonId: 'nythraxis_boss_arena', difficulty: 'normal' },
    // The raid's one boss drops every relic on the page.
    sourceDefault: fromBoss('nythraxis_scourge_of_thornpeak'),
    relics: items(
      'deathless_heartwood',
      'kingsbane_last_oath',
      'bonewrought_greatsword',
      'bonewrought_bulwark',
      'direfang_greatblade',
      'wraithfire_orb',
      'maul_of_the_scourged_wilds',
      'crownforged_dreadhelm',
      'crownforged_warspaulders',
      'nighttalon_crown',
      'nighttalon_shoulderguards',
      'soulflame_cowl',
      'soulflame_mantle',
      'stormcallers_crown',
      'stormcallers_spaulders',
      'direfang_quiver',
    ),
  },
  {
    id: 'conquerors_nythraxis_heroic',
    shelf: 'conquerors',
    name: 'Heroic Nythraxis Raid',
    desc: 'Heroic-only raid weapons from Nythraxis.',
    clearSource: { kind: 'dungeon', dungeonId: 'nythraxis_boss_arena', difficulty: 'heroic' },
    sourceDefault: fromBoss('nythraxis_scourge_of_thornpeak'),
    relics: items(...RELIQUARY_HEROIC_GEAR.nythraxis_scourge_of_thornpeak),
  },
  // ---- World boss ----
  {
    id: 'conquerors_thunzharr',
    shelf: 'conquerors',
    name: 'Thunzharr, the Waking Peak',
    desc: 'Personal epic spoils from the Waking Peak world boss.',
    clearSource: { kind: 'deed_stat', stat: 'thunzharrKills' },
    // The world boss drops every relic on the page.
    sourceDefault: fromBoss('thunzharr_waking_peak'),
    relics: items(
      'crownforged_gauntlets',
      'nighttalon_grips',
      'soulflame_gloves',
      'stormcallers_handguards',
      'crownforged_girdle',
      'nighttalon_waistband',
      'soulflame_cord',
      'stormcallers_waistguard',
      'vestments_of_the_waking_grove',
    ),
  },
  // ---- Delves (rare+ uniques; mark-shop signature pieces included) ----
  {
    id: 'conquerors_collapsed_reliquary',
    shelf: 'conquerors',
    name: 'The Collapsed Reliquary',
    desc: 'Signature rares from the Collapsed Reliquary lockpick chest.',
    clearSource: { kind: 'delve', delveId: 'collapsed_reliquary' },
    // Both rares have TWO live routes at once, and both are named: the lockpick
    // chest (delveChestItemsForTier, content/delves/lockpick_tiers.ts) and
    // Brother Halven's heroicClear Marks stock (content/delves/shop.ts). The
    // 'delve' kind is what makes the chest sayable: the chest is not a boss, so
    // the honest answer is the delve it lives in, which is also this delve's
    // boardNpcId home for the vendor half.
    relics: items(
      ['deacon_reliquary_helm', [fromDelve('collapsed_reliquary'), fromVendor('brother_halven')]],
      ['varric_shadow_cowl', [fromDelve('collapsed_reliquary'), fromVendor('brother_halven')]],
    ),
  },
  {
    id: 'conquerors_drowned_litany',
    shelf: 'conquerors',
    name: 'The Drowned Litany',
    desc: 'Rare and epic spoils from the Drowned Litany.',
    clearSource: { kind: 'delve', delveId: 'drowned_litany' },
    // The first six come only from the Drowned Reliquary Rite chest
    // (drownedLitanyChestItemsForTier, content/delves/drowned_litany_loot.ts,
    // RARE and EPIC pools). No boss kill opens it, the Rite puzzle does
    // (src/sim/delves/drowned_litany_rite.ts), so the delve itself is the
    // honest answer: the chest lives inside the Drowned Litany and nowhere
    // else. The last two are Marks-stock only, with no chest route at all, so
    // their vendor is certain.
    relics: items(
      ['nhalias_bell_maul', fromDelve('drowned_litany')],
      ['widow_silk_hood', fromDelve('drowned_litany')],
      ['nhalias_litany_rod', fromDelve('drowned_litany')],
      ['blackwater_vanguard_chest', fromDelve('drowned_litany')],
      ['siltstep_leggings', fromDelve('drowned_litany')],
      ['sunken_reliquary_hood', fromDelve('drowned_litany')],
      ['sister_nhalia_choir_plate', fromVendor('brother_halven_marsh')],
      ['drowned_choir_fang', fromVendor('brother_halven_marsh')],
    ),
  },
  // ---- Epic set pages (members shared with dungeon/world-boss pages) ----
  {
    id: 'conquerors_set_deathlord',
    shelf: 'conquerors',
    name: 'Barrowlord Battlegear',
    desc: 'The full Deathlord plate family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.deathlord)),
  },
  {
    id: 'conquerors_set_wyrmshadow',
    shelf: 'conquerors',
    name: 'Nightfang Vestments',
    desc: 'The full Wyrmshadow leather family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.wyrmshadow)),
  },
  {
    id: 'conquerors_set_necromancers',
    shelf: 'conquerors',
    name: 'Mournweave Raiment',
    desc: 'The full Necromancers cloth family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.necromancers)),
  },
  {
    id: 'conquerors_set_crownforged',
    shelf: 'conquerors',
    name: 'Bonewrought Regalia',
    desc: 'The full Crownforged plate family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.crownforged)),
  },
  {
    id: 'conquerors_set_nighttalon',
    shelf: 'conquerors',
    name: 'Direfang Pelt',
    desc: 'The full Nighttalon leather family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.nighttalon)),
  },
  {
    id: 'conquerors_set_soulflame',
    shelf: 'conquerors',
    name: 'Wraithfire Regalia',
    desc: 'The full Soulflame cloth family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.soulflame)),
  },
  {
    id: 'conquerors_set_stormcallers',
    shelf: 'conquerors',
    name: 'Galecall Vestments',
    desc: 'The full Stormcallers cloth family.',
    clearSource: { kind: 'none' },
    relics: items(...setMembers(RELIQUARY_SET_MEMBERS.stormcallers)),
  },

  // ---- Professions shelf (Phase 7): lifetime prestige, not every craft ----
  {
    id: 'professions_masterwork',
    shelf: 'professions',
    name: 'Masterwork Gallery',
    desc: 'Lifetime trophies for first masterworks. Empty until the next proc if a veteran predates the gallery (no invented craft history).',
    clearSource: { kind: 'none' },
    // Each per-craft mark names its craft. masterworkFirst names the ACTIVITY
    // instead: it fires on the first masterwork from ANY of the five gear
    // crafts (src/sim/professions/crafting.ts), so no single profession id is
    // its source, but "land a masterwork proc" is exactly the thing a player
    // does to earn it.
    relics: marks(
      [RELIQUARY_PROFESSION_MARKS.masterworkFirst, fromActivity('masterwork_craft')],
      // masterwork:engineering stays a BARE entry (no hint): no engineering
      // recipe can proc a masterwork (see the masterworkByCraft comment), so
      // a profession hint here would name a door that awards nothing. The
      // slot rides SOURCE_PENDING_RULING with the two gap mounts; the
      // gear-capability pin in tests/reliquary_content.test.ts derives the
      // eligible set from masterworkBonusStats and reds if either side moves.
      ...RELIQUARY_PROFESSION_MARKS.masterworkByCraft.map((markId) =>
        markId === 'masterwork:engineering'
          ? markId
          : ([markId, fromProfession(markId.slice('masterwork:'.length))] as const),
      ),
    ),
  },
  {
    id: 'professions_field_notes',
    shelf: 'professions',
    name: 'Rare Field Notes',
    desc: 'Signature rare finds from the wild: veins, heartwood, moonlit blooms, and perfect specimens.',
    clearSource: { kind: 'none' },
    // gatherRareEventFlavor (src/sim/professions/gather_events.ts) maps the
    // node type to the flavor, and NODE_HARVEST_TABLE maps that node type to
    // the profession that works it: ore to mining, wood to logging, herb to
    // herbalism. perfect_specimen is the corpse-harvest flavor instead, and
    // corpse harvest belongs to no gathering profession, so it names the
    // corpse_harvest activity (the src/sim/interaction.ts write site) rather
    // than a profession it does not have.
    relics: marks(
      ...withProfessions(
        RELIQUARY_PROFESSION_MARKS.fieldNotes,
        FIELD_NOTE_PROFESSIONS,
        fromActivity('corpse_harvest'),
      ),
    ),
  },
  {
    id: 'professions_specimens',
    shelf: 'professions',
    name: 'Key Specimens',
    desc: "Pristine corpse specimens, apex fine-grade field materials, and the angler's chase: a crafter museum in miniature.",
    clearSource: { kind: 'none' },
    // The fine_* trio are gathering-node jackpots, so each names the profession
    // that works its node family (MATERIAL_GRADES in
    // src/sim/professions/material_grades.ts pairs the base material with its
    // fine id), and glimmerfin_koi is fishing's counterpart (see
    // SPECIMEN_PROFESSIONS). The five pristine specimens come from corpse
    // harvest, which no gathering profession owns, so they name the
    // corpse_harvest activity, the same answer gather_event:perfect_specimen
    // gives (one write site, src/sim/interaction.ts, awards the mark and these
    // five items together). The two top fishing rods close the angler's chase:
    // engineering crafts both at the toolworks (ROD_RECIPES in
    // content/recipes.ts, trainer-taught), and the Drowned Litany Marks
    // counter sells both (content/delves/shop.ts, the non-crafter route), so
    // each names the craft plus the board keeper, the Marks-stock-only vendor
    // idiom the Litany page set (sister_nhalia_choir_plate). They are shop
    // rows on the Litany board ONLY; the Collapsed Reliquary counter carries
    // no tool rows, so no second delve door exists to name.
    relics: items(
      ...withProfessions(
        RELIQUARY_PROFESSION_SPECIMEN_ITEMS,
        SPECIMEN_PROFESSIONS,
        fromActivity('corpse_harvest'),
      ),
      [
        'stormreel_fishing_rod',
        [fromProfession('engineering'), fromVendor('brother_halven_marsh')],
      ],
      [
        'tidewrought_fishing_rod',
        [fromProfession('engineering'), fromVendor('brother_halven_marsh')],
      ],
    ),
  },

  // ---- Horizons shelf (Phase 8): mounts, account weapon skins, deed titles ----
  {
    id: 'horizons_mounts',
    shelf: 'horizons',
    name: 'Mounts',
    desc: 'Rideable mounts from the stable, heroic reins, Rift epics, and rarer saddles. Ownership follows the live reins seam (bags and bank).',
    clearSource: { kind: 'none' },
    // Seven of the nine mounts name every door that awards their reins (see
    // MOUNT_SOURCES above): the four heroic reins each drop from two or three
    // HEROIC_BOSS_LOOT bosses AND from their Rift rank's ladder, the two epic
    // reins are Rift-only, and valorsteed is Marla's counter. The page-wide
    // pending ruling that used to cover all nine is executed; the two that
    // remain (drakemaw_raptor, terrorspark_groundshaker) are content gaps, not
    // vocabulary gaps, and stay hand-listed in SOURCE_PENDING_RULING.
    relics: mounts(...mountEntries(RELIQUARY_HORIZON_MOUNTS)),
  },
  {
    id: 'horizons_weapon_skins',
    shelf: 'horizons',
    name: 'Weapon Skins',
    desc: 'Account-wide Armory weapon skins. Empty offline or without account cosmetics; never character loot.',
    clearSource: { kind: 'none' },
    // Armory skins are granted only by Claudium store purchases
    // (grantWeaponSkinsToAccount, server/game.ts, driven by server/claudium.ts).
    // That is an account-level storefront rather than a boss, zone, profession,
    // deed, or in-world vendor NPC, and the 'store' kind now names it. One
    // storefront awards every skin on the page, which is exactly the condition
    // a page default is for, so the default carries all 29 rows.
    sourceDefault: fromStore(),
    relics: weaponSkins(...RELIQUARY_HORIZON_WEAPON_SKINS),
  },
  {
    id: 'horizons_titles',
    shelf: 'horizons',
    name: 'Titles',
    desc: 'Titles earned from the Book of Deeds. Cosmetic only: never power, drop rate, or pity.',
    clearSource: { kind: 'none' },
    relics: titles(...RELIQUARY_HORIZON_TITLES),
  },

  // ---- The Rift (Phase 21): the procedural dungeon's whole chase ladder ----
  {
    id: 'conquerors_the_rift',
    shelf: 'conquerors',
    name: 'The Rift',
    desc: 'Signature spoils of the shifting Rift, from its roaming horrors to the twin treasures of the S-rank chase.',
    clearSource: { kind: 'deed_stat', stat: 'riftClears' },
    secondaryClearSource: { kind: 'deed_stat', stat: 'riftSRankClears' },
    // Ascending chase order, each group SPREAD from its live rift/items.ts
    // array so membership and order can never trail the content: the ten
    // themed world-drop rares (RIFT_RARE_SOURCES above), the four clear-time
    // epics (riftHeroicClearPool seeds them; B is the minimum rank whose clear
    // pays from that pool), and the two S-only legendary rolls
    // (addRiftClearGearLoot rolls each independently on an S clear alone).
    //
    // The three first-clear Riftbound bands are deliberately NOT here: they
    // live on horizons_riftbound instead. shellForClass maps each class to
    // exactly ONE band, the mint stamps boundTo + personalFor, and trade, mail,
    // and market all refuse bound instances, so no character can ever hold more
    // than one of the three. Three slots on this page would make its completion
    // unreachable and dead-end the Conquerors shelf deed behind it.
    relics: items(
      ...RIFT_RARE_ITEM_IDS.map((id) => [id, RIFT_RARE_SOURCES[id]] as const),
      ...RIFT_EPIC_ITEM_IDS.map((id) => [id, fromRift('B')] as const),
      ...RIFT_LEGENDARY_ITEM_IDS.map((id) => [id, fromRift('S')] as const),
    ),
  },

  // ---- Rares of the Realm (Phase 21): every named overworld rare, as marks ----
  // The PRD sketched ONE page holding both the kill proofs and the loot; the
  // single-kind-per-page pin (the emit path depends on it) forces the split
  // into this marks page and the Spoils items page below.
  {
    id: 'conquerors_rares_of_the_realm',
    shelf: 'conquerors',
    name: 'Rares of the Realm',
    desc: 'Proof of every named rare brought low across the realm.',
    clearSource: { kind: 'none' },
    // One mark per rare, written by the kill-credit site in src/sim/deeds.ts
    // (onMobKillCreditForDeeds dual-writes the visited mark and the Reliquary
    // mark for every eligible party member). Each slot pairs the rare with the
    // zone it camps in, the open-world answer the set-page precedent set.
    relics: marks(
      ...REALM_RARE_ZONES.map(
        ([templateId, zoneId]) =>
          [`slain:${templateId}`, [fromBoss(templateId), fromZone(zoneId)]] as const,
      ),
    ),
  },

  // ---- Spoils of the Realm (Phase 21): the rares' signature loot ----
  // Exactly the rare+ loot of the 19 REALM_RARE_ZONES templates, in template
  // order then per-template loot-row order, deduped on later templates
  // (cryptstalker_jerkin and hollowbone_hauberk keep their first slot; their
  // fromBoss lists still name every rare that drops them). FIVE templates
  // contribute no rare+ item at all (old_greyjaw, grubjaw, old_marrowshell,
  // aurelhorn, drakemaw_broodlord): their signature drops are uncommon or
  // below, so they stay off this page by quality, the thunzharr
  // inert_storm_shard precedent, and the marks page above is their whole
  // representation. deathlord_sabatons and necromancers_legwraps also sit on
  // their set pages with byte-identical hints (multi-page fill is intentional,
  // rule 5; the cross-page agreement pin now covers both).
  {
    id: 'conquerors_spoils_of_the_realm',
    shelf: 'conquerors',
    name: 'Spoils of the Realm',
    desc: 'Signature treasures carried by the named rares of the realm.',
    clearSource: { kind: 'none' },
    relics: items(
      // Mogger + Wraithbinder Maldrec (Eastbrook Vale)
      ['moggers_shiv', [fromBoss('mogger'), fromZone('eastbrook_vale')]],
      [
        'cryptstalker_jerkin',
        [fromBoss('mogger'), fromBoss('wraithbinder_maldrec'), fromZone('eastbrook_vale')],
      ],
      // Grix the Tunnelking (Eastbrook Vale)
      ['moggers_copper_cudgel', [fromBoss('grix_the_tunnelking'), fromZone('eastbrook_vale')]],
      [
        'hollowbone_hauberk',
        [
          fromBoss('grix_the_tunnelking'),
          fromBoss('wraithbinder_maldrec'),
          fromZone('eastbrook_vale'),
        ],
      ],
      // Captain Verlan (Eastbrook Vale)
      ['verlans_oathblade', [fromBoss('captain_verlan'), fromZone('eastbrook_vale')]],
      ['hollow_vigil_staff', [fromBoss('captain_verlan'), fromZone('eastbrook_vale')]],
      ['gravewardens_shiv', [fromBoss('captain_verlan'), fromZone('eastbrook_vale')]],
      // Wraithbinder Maldrec (Eastbrook Vale)
      ['maldrecs_soulbinder', [fromBoss('wraithbinder_maldrec'), fromZone('eastbrook_vale')]],
      ['gravewoven_raiment', [fromBoss('wraithbinder_maldrec'), fromZone('eastbrook_vale')]],
      // Mirejaw the Ravenous (Mirefen Marsh)
      ['fen_reaver_glaive', [fromBoss('mirejaw_the_ravenous'), fromZone('mirefen_marsh')]],
      ['mirejaw_oracle_staff', [fromBoss('mirejaw_the_ravenous'), fromZone('mirefen_marsh')]],
      // Sloomtooth the Drowned (Mirefen Marsh)
      ['tidereaver_gaff', [fromBoss('sloomtooth_the_drowned'), fromZone('mirefen_marsh')]],
      ['sloomtooth_tidefang', [fromBoss('sloomtooth_the_drowned'), fromZone('mirefen_marsh')]],
      ['drowned_tide_scepter', [fromBoss('sloomtooth_the_drowned'), fromZone('mirefen_marsh')]],
      // Sister Nhalia (Mirefen Marsh)
      ['nhalias_dirgeblade', [fromBoss('sister_nhalia'), fromZone('mirefen_marsh')]],
      // Ironvein Foreman (Thornpeak Heights). gutripper_shiv has a SECOND live
      // door the 13a standard must name: q_drogmar hands it to rogues as a
      // guaranteed reward, and that quest's kill objective is warlord_drogmar,
      // a DIFFERENT mob, so the quest is named directly (the wyrmcult_grand_robe
      // rule) rather than folded into the rare hint.
      [
        'gutripper_shiv',
        [fromBoss('ironvein_foreman'), fromQuest('q_drogmar'), fromZone('thornpeak_heights')],
      ],
      ['deathlord_sabatons', [fromBoss('ironvein_foreman'), fromZone('thornpeak_heights')]],
      // Brutok Skullsmasher (Thornpeak Heights)
      ['brutoks_maul', [fromBoss('brutok_skullsmasher'), fromZone('thornpeak_heights')]],
      ['crag_warden_cudgel', [fromBoss('brutok_skullsmasher'), fromZone('thornpeak_heights')]],
      ['skullsplitter_dirk', [fromBoss('brutok_skullsmasher'), fromZone('thornpeak_heights')]],
      ['stormroot_cowl', [fromBoss('brutok_skullsmasher'), fromZone('thornpeak_heights')]],
      // Voskar the Emberwing (Thornpeak Heights)
      ['emberwing_legguards', [fromBoss('voskar_emberwing'), fromZone('thornpeak_heights')]],
      ['emberfang_warblade', [fromBoss('voskar_emberwing'), fromZone('thornpeak_heights')]],
      ['stormvotive_hauberk', [fromBoss('voskar_emberwing'), fromZone('thornpeak_heights')]],
      // Marrowlord Varkas (Thornpeak Heights)
      ['necromancers_legwraps', [fromBoss('marrowlord_varkas'), fromZone('thornpeak_heights')]],
      // Old Cragmaw (Thornpeak Heights)
      ['cragmaw_huntcord', [fromBoss('old_cragmaw'), fromZone('thornpeak_heights')]],
      ['cragmaw_prowlboots', [fromBoss('old_cragmaw'), fromZone('thornpeak_heights')]],
      ['cragthorn_greatstaff', [fromBoss('old_cragmaw'), fromZone('thornpeak_heights')]],
      ['boneglass_shiv', [fromBoss('old_cragmaw'), fromZone('thornpeak_heights')]],
      ['cragmaw_huntquiver', [fromBoss('old_cragmaw'), fromZone('thornpeak_heights')]],
      // Shardlord Kazzix (Thornpeak Heights)
      ['shardfang_grips', [fromBoss('shardlord_kazzix'), fromZone('thornpeak_heights')]],
      // The Gleamstag (Veiled Hollow)
      ['gleamstag_charm', [fromBoss('gleamstag'), fromZone('veiled_hollow')]],
    ),
  },

  // ---- Warfare pages (Phase 21): the whole honor stock, kits then armory ----
  {
    id: 'conquerors_warfare_gallery',
    shelf: 'conquerors',
    name: 'Warfare Gallery',
    desc: 'The five Warfare battle kits, earned piece by piece with honor.',
    clearSource: { kind: 'none' },
    relics: items(...WARFARE_GALLERY_ITEM_IDS.map((id) => [id, WARFARE_VENDOR_HINTS] as const)),
  },
  {
    id: 'conquerors_warfare_armory',
    shelf: 'conquerors',
    name: 'Warfare Armory',
    desc: 'Warfare jewelry and weapons purchased with hard-won honor.',
    clearSource: { kind: 'none' },
    relics: items(...WARFARE_ARMORY_ITEM_IDS.map((id) => [id, WARFARE_VENDOR_HINTS] as const)),
  },

  // ---- Vault of Ages (Phase 21): the retired shelf, outside completion ----
  // Rule 7 (docs/design/reliquary.md): retired content becomes a visible,
  // labeled page, never a silent delete. The four ids are the v0.24.x heroic
  // Nythraxis drops v0.25.0 retired (RETIRED_HEROIC_ITEMS in heroic_loot.ts,
  // save-compat defs). They can never be won again, so the page is
  // excludeFromCompletion (see the field's doc comment) and deliberately
  // SOURCELESS: a hint would name a door that no longer exists, and
  // tests/retired_heroic_items.test.ts holds this page to zero hints so it
  // can never quietly become an acquisition-route surface. Hand-listed in
  // sorted key order on purpose: the derivation pin in
  // tests/reliquary_content.test.ts compares against the live table, so a
  // fifth retirement reds there until it is paged here.
  {
    id: 'horizons_vault_of_ages',
    shelf: 'horizons',
    name: 'Vault of Ages',
    desc: 'Retired treasures of a bygone age. These relics can no longer be won; the vault honors the veterans who keep them.',
    clearSource: { kind: 'none' },
    excludeFromCompletion: 'retired',
    relics: items(
      'deathless_warguard_legmail',
      'scourgehide_carapace',
      'soulforged_warplate',
      'soulrend_diadem',
    ),
  },

  // ---- Riftbound (Phase 21): the class-personal bands, outside completion ----
  // The showcase page for the three first-clear bands. A character is minted
  // exactly ONE of them (shellForClass in src/sim/rift/progression.ts picks by
  // class) and the instance is bound and personal, so no one can ever fill all
  // three slots: the page is excludeFromCompletion 'personal' and its slots
  // sit outside both completion pairs while the page still shows a player the
  // whole family and their own band inside it. Spread from the live array in
  // array order, exactly as the Rift page carried them.
  {
    id: 'horizons_riftbound',
    shelf: 'horizons',
    name: 'Riftbound',
    desc: "The personal Riftbound bands, minted for every champion in the party that wins a ranked Rift's first clear. A character can only ever hold their own.",
    clearSource: { kind: 'none' },
    excludeFromCompletion: 'personal',
    relics: items(
      ...RIFT_GEAR_ITEM_IDS.map((id) => [id, fromActivity('rift_first_clear')] as const),
    ),
  },
]);

/** Append-only page order (table order). */
export const RELIQUARY_PAGE_ORDER: readonly string[] = RELIQUARY_PAGES.map((p) => p.id);

/** Stable id -> page def. */
export const RELIQUARY_PAGES_BY_ID: Readonly<Record<string, ReliquaryPageDef>> = Object.fromEntries(
  RELIQUARY_PAGES.map((p) => [p.id, p]),
);

/** Item id -> page ids that list it (multi-page fill is intentional). */
export const RELIQUARY_ITEM_TO_PAGES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const page of RELIQUARY_PAGES) {
    for (const relic of page.relics) {
      if (relic.kind !== 'item') continue;
      const list = map.get(relic.itemId);
      if (list) list.push(page.id);
      else map.set(relic.itemId, [page.id]);
    }
  }
  return map;
})();

/** Authored mark ids that are Reliquary trophies (profession marks, etc.). */
export const RELIQUARY_MARK_IDS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  for (const page of RELIQUARY_PAGES) {
    for (const relic of page.relics) {
      if (relic.kind === 'mark') set.add(relic.markId);
    }
  }
  return set;
})();

/** Mark id -> page ids that list it (multi-page fill is intentional). */
export const RELIQUARY_MARK_TO_PAGES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const page of RELIQUARY_PAGES) {
    for (const relic of page.relics) {
      if (relic.kind !== 'mark') continue;
      const list = map.get(relic.markId);
      if (list) list.push(page.id);
      else map.set(relic.markId, [page.id]);
    }
  }
  return map;
})();

export function isCataloguedRelicItem(itemId: string): boolean {
  return RELIQUARY_ITEM_TO_PAGES.has(itemId);
}

/** True when markId is an authored Reliquary trophy mark. */
export function isCataloguedRelicMark(markId: string): boolean {
  return RELIQUARY_MARK_IDS.has(markId);
}

/** Shared frozen empty answer, so the no-source arm never allocates and never
 *  gets mutated by a caller that mistook it for its own array. The
 *  hint-bearing arms DO allocate a fresh frozen wrapper per call, which is
 *  immaterial on this cold rebuild path. */
const NO_SOURCE_HINTS: readonly ReliquarySourceHint[] = Object.freeze([]);

/**
 * The source hints a relic answers with on a given page: its OWN hints, else
 * the page default as a one-element list, else the empty list. The empty list
 * is a real answer ("content names no source"), not a missing value the caller
 * should paper over with prose.
 *
 * A relic's own hints win WHOLESALE over the page default: they are never
 * merged. A page default says "unless a relic knows better", and a relic that
 * lists its doors knows better about all of them, so folding the default back
 * in could only append a route the authoring deliberately left out.
 *
 * THE one implementation of that precedence: every production caller, the
 * client view included, goes through here rather than re-spelling
 * `?? sourceDefault` (tests may re-spell it deliberately as an independent
 * oracle).
 *
 * Takes the page DEF, not a page id. The same relic sits on two pages (a set
 * member on both its boss page and its set page), so the page has to come from
 * the caller either way, and a def closes the hole an id lookup would open: a
 * synthetic page reusing a live id would otherwise silently inherit the live
 * catalog row's default instead of its own.
 */
export function reliquaryRelicSource(
  page: ReliquaryPageDef | undefined,
  relic: ReliquaryRelicDef,
): readonly ReliquarySourceHint[] {
  const own = relic.source;
  // `in` rather than Array.isArray: it narrows the readonly-array arm without
  // the any[] widening Array.isArray brings to a readonly union.
  //
  // For CATALOG-BUILT relics every arm answers a FROZEN list of FROZEN hints:
  // the list arm is the catalog's own array (frozen at construction in
  // withSource), the two wrapper arms freeze their fresh one-element list so a
  // caller cannot learn to mutate the answer on the cheap arms and then
  // corrupt the shared one, and the hint objects themselves are frozen by the
  // hint() constructor. A synthetic def handed an inline array answers that
  // exact array as-is; callers own the mutability of their own synthetics.
  if (own !== undefined) return 'sourceKind' in own ? Object.freeze([own]) : own;
  const fallback = page?.sourceDefault;
  return fallback ? Object.freeze([fallback]) : NO_SOURCE_HINTS;
}
