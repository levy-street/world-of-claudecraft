// Gathering profession content (data-as-code, exempt from module-first size
// rules per root CLAUDE.md: this is a declarative table, not logic). Starter
// set is Mining, Logging, Herbalism; the state and gain logic live in
// ../professions/gathering.ts behind the SimContext seam. `icon` is a plain
// identifier (no emoji glyph, per the repo copy rule); a future UI surface
// resolves it to a procedural icon the same way ability/item icons do.
//
// Each def extends the settled `ProfessionRecord` shape (src/sim/professions/
// types.ts, from #1164) with the display metadata (name/icon/description)
// the `/dev gather` chat cheat and a future UI need; category/maxSkill are
// the fields later profession issues (#1120/#1125/#1126/#1140) read against.
// maxSkill follows the classic 1-300 profession skill scale.
import type { StationDef, StationType } from '../professions/stations';
import type { ProfessionRecord } from '../professions/types';
import { ZONE1_ZONE } from './zone1';
import { ZONE2_ZONE } from './zone2';
import { ZONE3_ZONE } from './zone3';

export type GatheringProfessionId = 'mining' | 'logging' | 'herbalism';

export interface GatheringProfessionDef extends ProfessionRecord {
  id: GatheringProfessionId;
  name: string;
  icon: string;
  description: string;
}

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: {
    id: 'mining',
    category: 'gathering',
    maxSkill: 300,
    name: 'Mining',
    icon: 'mining',
    description: 'Extracting ore and stone from nodes found in the wild.',
  },
  logging: {
    id: 'logging',
    category: 'gathering',
    maxSkill: 300,
    name: 'Logging',
    icon: 'logging',
    description: 'Felling timber from trees found across the zones.',
  },
  herbalism: {
    id: 'herbalism',
    category: 'gathering',
    maxSkill: 300,
    name: 'Herbalism',
    icon: 'herbalism',
    description: 'Collecting herbs and plants growing in the wild.',
  },
};

// Stable iteration order, used for defaulting/normalizing a per-player
// proficiency record. Keep in sync with GATHERING_PROFESSIONS above.
export const GATHERING_PROFESSION_IDS: GatheringProfessionId[] = ['mining', 'logging', 'herbalism'];

// Tool effect slotting (#1136): a slottable bonus layered on top of a base
// gathering tool's tier (see ../professions/tools.ts). Each effect carries its
// own starting durability, separate from the base tool's tier gating. Whether
// a given use spends a charge is NOT a fixed per-effect chance: it is rolled
// from the rarity-scaled consumption curve (#1139,
// `../professions/tools.ts` `effectConsumptionChance`), comparing the tool's
// own rarity against the rarity of what it is being used on, so the same
// effect sips charges against a low-rarity target and spends them every use
// against an equal-or-higher-rarity one. `kind` selects which harvest/craft
// outcome field the bonus adjusts.
// Corpse-harvest yield map (#1141): component tag -> the item id a profession
// harvest of a tagged corpse yields (claim logic: src/sim/professions/gathering.ts,
// command body: src/sim/interaction.ts harvestCorpse). Only tags with a concrete
// item wired up so far are listed here; a mob whose componentTags don't map to any
// of these still becomes single-use claimed, it just yields no item yet (future
// profession-harvest issues wire up the rest).
// Phase 10 closed the v0.21.0 collision gap: hide/silk/venomSac now yield the
// dedicated profession materials (content/profession_items.ts), so a harvest
// never grants quest-collect credit. The old quest items (boar_hide via
// q_boars kill loot, webwood_silk via q_spiders, widow_venom_sac via q_widows)
// keep their quest roles only.
export const HARVEST_COMPONENT_ITEMS: Readonly<Record<string, string>> = {
  hide: 'rough_hide',
  fang: 'wolf_fang',
  silk: 'spider_silk',
  venomSac: 'venom_gland',
  meat: 'game_meat',
  cloth: 'homespun_cloth',
};

// Perfect specimens (Phase 10): the signed jackpot family. When a corpse
// harvest's rarity roll clears the signable floor (rare-or-better,
// isSignableMaterialRarity), the harvester is granted the component family's
// specimen as a SIGNED instance in addition to the plain component grant
// (src/sim/interaction.ts harvestCorpse). Families without a specimen keep
// the pre-Phase-10 behavior (the regular component itself grants signed).
export const HARVEST_COMPONENT_SPECIMENS: Readonly<Record<string, string>> = {
  hide: 'pristine_hide',
  silk: 'pristine_silk',
  venomSac: 'pristine_venom_gland',
  meat: 'prime_cut',
};

// Tool effect slotting (#1136): a slottable bonus layered on top of a base
// gathering tool's tier (see ../professions/tools.ts). Each effect carries its
// own starting durability, separate from the base tool's tier gating. Whether
// a given use spends a charge is rolled from the rarity-scaled consumption
// curve (#1139, ../professions/tools.ts effectConsumptionChance), not a fixed
// per-effect chance. `kind` selects which harvest/craft outcome field the
// bonus adjusts.
export type ToolEffectId = 'gatherers_cache' | 'artisans_eye' | 'quickening_charm';

export interface ToolEffectDef {
  id: ToolEffectId;
  name: string;
  description: string;
  icon: string;
  kind: 'quantity' | 'quality' | 'respawnSpeed';
  /** Magnitude applied to the outcome field while durability remains. */
  bonus: number;
  /** Charges the effect starts with when freshly slotted onto a tool. */
  startingDurability: number;
  /**
   * Which craft on the CRAFT_RING produces this effect (#1134). All three
   * starter tool effects are Enchanter work, so they share `'enchanting'`;
   * this is what `../professions/tools.ts` reads to decide whether a
   * recharger's specialization in THAT craft earns the additional
   * specialization recharge discount, composed on top of the
   * original-crafter discount (#1137).
   */
  craftId: string;
}

export const TOOL_EFFECTS: Record<ToolEffectId, ToolEffectDef> = {
  gatherers_cache: {
    id: 'gatherers_cache',
    name: "Gatherer's Cache",
    icon: 'gatherers_cache',
    description: 'Slotted onto a gathering tool: yields extra quantity per harvest.',
    kind: 'quantity',
    bonus: 1,
    startingDurability: 20,
    craftId: 'enchanting',
  },
  artisans_eye: {
    id: 'artisans_eye',
    name: "Artisan's Eye",
    icon: 'artisans_eye',
    description: 'Slotted onto a gathering tool: raises the quality of what it harvests.',
    kind: 'quality',
    bonus: 1,
    startingDurability: 20,
    craftId: 'enchanting',
  },
  quickening_charm: {
    id: 'quickening_charm',
    name: 'Quickening Charm',
    icon: 'quickening_charm',
    description: 'Slotted onto a gathering tool: shortens the node respawn timer it triggers.',
    kind: 'respawnSpeed',
    bonus: 1,
    startingDurability: 20,
    craftId: 'enchanting',
  },
};

// Stable iteration order, used the same way GATHERING_PROFESSION_IDS is.
export const TOOL_EFFECT_IDS: ToolEffectId[] = [
  'gatherers_cache',
  'artisans_eye',
  'quickening_charm',
];
// Ten-craft ring content: pure data plus pure helper functions. No engine logic,
// no mechanic wiring: this file only defines the ring geometry (order, pole tags)
// and the adjacency/opposite lookups derived from it. See issue #1125.
//
// Design-doc note (#1148 tuning pass, reorder adopted in the Professions 2.0
// Phase 1 blueprint): the canonical ring order lives at
// https://woc.nervemart.com/docs/professions-system, and CRAFT_RING below now
// matches the doc's ring text craft for craft ("Engineering, Alchemy, Cooking,
// Leatherworking, Tailoring, Inscription, Enchanting, Jewelcrafting,
// Weaponcrafting, Armorcrafting"). Both adjacencies this codebase commits to in
// real content survive the reorder unchanged: armorcrafting-weaponcrafting
// (adjacent, wrapping the ring) and alchemy-engineering (adjacent) are exactly
// the two pairs content/recipes.ts COMBO_RECIPES requires, pinned by the
// adjacency test in tests/professions.test.ts so a future reorder cannot
// silently orphan a combo recipe. The 4 poles are this codebase's own grouping
// (not named in the doc): Material (crafts that shape raw matter into gear),
// Experimental (crafts driven by trial-and-error formulae), Formal (crafts
// built on exact patterns/measurements), Cross-cutting (crafts that touch
// every other craft's output). Each pole tag travels with its craft record, so
// the reorder never re-grouped any craft.

export type CraftPole = 'Material' | 'Experimental' | 'Formal' | 'Cross-cutting';

export interface CraftDef {
  id: string;
  name: string;
  pole: CraftPole;
}

// Fixed ring order (index is the ring position). Opposite crafts sit 5 positions
// apart; adjacent crafts sit 1 position apart on either side.
export const CRAFT_RING: CraftDef[] = [
  { id: 'engineering', name: 'Engineering', pole: 'Experimental' },
  { id: 'alchemy', name: 'Alchemy', pole: 'Experimental' },
  { id: 'cooking', name: 'Cooking', pole: 'Cross-cutting' },
  { id: 'leatherworking', name: 'Leatherworking', pole: 'Formal' },
  { id: 'tailoring', name: 'Tailoring', pole: 'Formal' },
  { id: 'inscription', name: 'Inscription', pole: 'Cross-cutting' },
  { id: 'enchanting', name: 'Enchanting', pole: 'Cross-cutting' },
  { id: 'jewelcrafting', name: 'Jewelcrafting', pole: 'Material' },
  { id: 'weaponcrafting', name: 'Weaponcrafting', pole: 'Material' },
  { id: 'armorcrafting', name: 'Armorcrafting', pole: 'Material' },
];

const RING_SIZE = CRAFT_RING.length;

const CRAFT_INDEX: ReadonlyMap<string, number> = new Map(
  CRAFT_RING.map((craft, index) => [craft.id, index]),
);

function indexOf(craftId: string): number {
  const index = CRAFT_INDEX.get(craftId);
  if (index === undefined) {
    throw new Error(`unknown craft id: ${craftId}`);
  }
  return index;
}

/** The two crafts one ring position away from the given craft, on either side. */
export function adjacentCrafts(craftId: string): [CraftDef, CraftDef] {
  const index = indexOf(craftId);
  const prev = CRAFT_RING[(index - 1 + RING_SIZE) % RING_SIZE];
  const next = CRAFT_RING[(index + 1) % RING_SIZE];
  return [prev, next];
}

/** The craft directly opposite the given craft (halfway around the ring). */
export function oppositeCraft(craftId: string): CraftDef {
  const index = indexOf(craftId);
  return CRAFT_RING[(index + RING_SIZE / 2) % RING_SIZE];
}

/** Lookup a craft definition by id. */
export function craftById(craftId: string): CraftDef {
  return CRAFT_RING[indexOf(craftId)];
}

// The tier-4/5 tool recipes formerly stubbed here (#1135's inert
// `TOOL_RECIPE_STUBS`) are live in content/recipes.ts as TOOL_RECIPES,
// de-stubbed once #1127's crafting action landed to consume them. They are
// deliberately kept OUT of COMMON_RECIPES (that table's module doc and tests
// fix skillReq at 0 for every entry, and FIELD_RECIPES derives bare-hands
// field-craftability from COMMON membership).

// Specialization perk thresholds (#1134): a pure additive bonus layer on top
// of the crafting path (P3, #1127) and the ten-craft wheel (P5, #1125/#1128).
// Per craft on CRAFT_RING, a player whose skill IN THAT CRAFT reaches
// `specializedSkillThreshold` unlocks two perks: a material-cost discount on
// recipes performed in that craft (read by ../professions/wheel.ts and
// applied in ../professions/crafting.ts), and, when that same specialized
// player is also the ORIGINAL CRAFTER of a tool effect (#1137), an
// additional discount on top of the existing original-crafter recharge
// discount (composed, never replacing it, in ../professions/tools.ts).
//
// Every craft on the ring gets an entry (data-driven, not hardcoded in
// logic): thresholds and percents were placeholders pending maintainer
// confirmation against the design doc. #1148 tuning pass: the doc's own Open
// Questions section ("Specialization perks: the exact perk set and the
// thresholds that unlock them") still lists this as genuinely open, i.e. no
// real numbers to replace these with yet. Per that issue's own acceptance
// criteria ("tuned... or explicitly deferred with a reason"), these are kept
// as-is and CONFIRMED (not re-guessed) as the working values: 75 skill sits at
// the tier-3 boundary (see wheel.ts TIER_SKILL_STEP, tierForSkill), a round,
// legible mid-tier gate; 20%/25% are modest, non-punitive discounts consistent
// with the #1301 gold-sink/throttle pass's own "tuned modest, not a large
// invented swing" rule. Uniform across crafts/poles so no single craft is
// silently favored until the doc's open question resolves with real numbers.
export interface PerkThresholdDef {
  /** Skill level (0 to 100) in this craft required to count as "specialized". */
  specializedSkillThreshold: number;
  /** Percent (0 to 1) shaved off recipe material quantities once specialized. */
  materialDiscountPct: number;
  /**
   * Additional percent (0 to 1) shaved off a recharge, on top of the
   * original-crafter discount, when the original crafter is also specialized
   * in this craft.
   */
  rechargeDiscountPct: number;
}

export const PERK_THRESHOLDS: Record<string, PerkThresholdDef> = Object.fromEntries(
  CRAFT_RING.map((craft) => [
    craft.id,
    { specializedSkillThreshold: 75, materialDiscountPct: 0.2, rechargeDiscountPct: 0.25 },
  ]),
);

// Mobile crafting station (#1134): how long a placed station stays usable
// before it expires. See ../professions/mobile_station.ts for the placement
// mechanic; since Phase 8 an active mobile station satisfies the station
// gate (../professions/crafting.ts) for recipes whose stationType matches
// the placing craft (STATION_TYPE_BY_CRAFT below).
export const MOBILE_CRAFTING_STATION_DURATION_TICKS = 20 * 60 * 10; // 10 minutes

// Gold sink + output throttle tuning (#1301): professions is a large new
// material/item faucet, and the doc names both a proportional gold sink and a
// throttle on a maxed specialist's output rate as TBD. Content-driven per the
// issue's scope note ("read from content, not hardcoded"), tuned modest and
// non-punitive rather than inventing a large balance swing: see
// ../professions/crafting.ts resolveCraftForRecipe for where these are read.
// - `CRAFT_GOLD_SINK_COPPER_PER_BUDGET`: copper fee per point of a recipe's
//   `itemLevelBudget`, charged on every successful craft (proportional to the
//   value of what is being produced, same axis P4/P8 already scale off).
// - `CRAFT_THROTTLE_WINDOW_SECONDS` / `CRAFT_THROTTLE_MAX_PER_WINDOW`: a flat
//   cap on successful crafts (any recipe) per rolling sim-time window, so a
//   maxed specialist cannot flood the market faster than this rate regardless
//   of skill or material supply.
export const CRAFT_GOLD_SINK_COPPER_PER_BUDGET = 2;
export const CRAFT_THROTTLE_WINDOW_SECONDS = 60;
export const CRAFT_THROTTLE_MAX_PER_WINDOW = 10;

// Crafting stations and masters (Professions 2.0 Phase 8): the content half
// of ../professions/stations.ts. The old single level-20 crafting hub
// (#1297's CRAFTING_HUB_* constants and its Highwatch circle) is retired
// with its level gate (2026-07-17 maintainer ruling: the level arm goes
// away entirely); in its place, six typed stations spread across the three
// town hubs, each run by a resident master NPC.
//
// Gate range around each station's pos (world units, the same order of
// magnitude the old hub circle used).
export const STATION_RADIUS = 20;

// Which station type serves each craft. Crafts absent from this table
// (jewelcrafting, inscription, enchanting) have no physical station and no
// station-bound recipes today.
export const STATION_TYPE_BY_CRAFT: Readonly<Record<string, StationType>> = {
  weaponcrafting: 'forge',
  armorcrafting: 'forge',
  cooking: 'kitchens',
  alchemy: 'apothecary',
  leatherworking: 'tannery',
  tailoring: 'loom',
  engineering: 'toolworks',
};

// The six stations. `pos` values are final guard-safe town placements: each
// sits inside its hosting hub circle, its master NPC stands 1 to 3 units
// beside it, and every spot clears the strictest camp-safety margin any
// pre-existing town NPC satisfies (about 11.2 units beyond camp radius plus
// aggro radius; see the Phase 8 placement math in the phase notes). The
// zone-1 forge shares smith_haldren's forge. `masterNpcId` values name the
// resident master each station belongs to (NpcDefs in the zone modules).
export const STATIONS: readonly StationDef[] = [
  {
    id: 'station_eastbrook_forge',
    type: 'forge',
    zoneId: ZONE1_ZONE.id,
    // Smith Haldren's forge, northeast of the square.
    pos: { x: 7, z: 16.5 },
    masterNpcId: 'forgemistress_darva',
  },
  {
    id: 'station_eastbrook_kitchens',
    type: 'kitchens',
    zoneId: ZONE1_ZONE.id,
    // West side of the square, by the provisioner's stall.
    pos: { x: -11, z: 4.5 },
    masterNpcId: 'cook_marlow',
  },
  {
    id: 'station_eastbrook_loom',
    type: 'loom',
    zoneId: ZONE1_ZONE.id,
    // South of the well, on the quiet side of the square.
    pos: { x: -2, z: -8 },
    masterNpcId: 'weaver_ottilie',
  },
  {
    id: 'station_eastbrook_toolworks',
    type: 'toolworks',
    zoneId: ZONE1_ZONE.id,
    // Southeast corner, between the inn and the chronicler.
    pos: { x: 11, z: -12 },
    masterNpcId: 'tinker_gizzel',
  },
  {
    id: 'station_fenbridge_tannery',
    type: 'tannery',
    zoneId: ZONE2_ZONE.id,
    // Northwest edge of Fenbridge, downwind of the square.
    pos: { x: -13, z: 314 },
    masterNpcId: 'tanner_hesk',
  },
  {
    id: 'station_highwatch_apothecary',
    type: 'apothecary',
    zoneId: ZONE3_ZONE.id,
    // East of the Highwatch well, between it and the loremaster.
    pos: { x: 7, z: 660 },
    masterNpcId: 'alchemist_verane',
  },
];
