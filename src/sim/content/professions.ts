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
import type { ProfessionRecord } from '../professions/types';
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
// KNOWN CONTENT GAP (v0.21.0 release-merge audit, needs a maintainer content call):
// hide/silk/venomSac map to kind:'quest' items (q_boars/q_spiders/q_widows), so a
// harvest currently grants quest-collect credit from ANY tagged mob (a wolf hide
// advances the boar quest). The intended fix is dedicated profession-material
// items, which is content design, not wiring; do not paper over it here.
export const HARVEST_COMPONENT_ITEMS: Readonly<Record<string, string>> = {
  hide: 'boar_hide',
  fang: 'wolf_fang',
  silk: 'webwood_silk',
  venomSac: 'widow_venom_sac',
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

// The tier-4/5 tool recipes formerly stubbed here (#1135's `TOOL_RECIPE_STUBS`)
// moved into COMMON_RECIPES in content/recipes.ts once #1127's crafting action
// landed to consume them (see recipes.ts for the six 'engineering' recipes
// producing thorium_mining_pick, arcanite_mining_pick, ashwood_axe,
// elderwood_axe, goldleaf_sickle, and sunpetal_sickle).
// P3 reconciliation stub (#1135): the crafted tier-4/5 base tools added for
// this issue (see src/sim/content/items.ts: thorium_mining_pick,
// arcanite_mining_pick, ashwood_axe, elderwood_axe, goldleaf_sickle,
// sunpetal_sickle) are meant to be produced via a P3 recipe/crafting action
// (#1127), NOT bought from a vendor. #1127 (the crafting action itself) has
// not been implemented in any branch yet, so there is nowhere to register a
// real, consumed recipe: adding one to a live recipe table would be dead data
// nobody reads. Instead this is an INERT, documentation-only shape of what
// each recipe SHOULD look like once #1127 lands. Nothing in the engine reads
// `TOOL_RECIPE_STUBS` today: it is not merged into any content table by
// data.ts, and no SimContext callback or effect references it.
//
// TODO(#1127): once the crafting action exists, move (not copy) this shape
// into whatever the real recipe table turns out to be (ingredients + a craft
// verb the player performs), wire `outputItemId` to the actual item grant,
// and delete this stub in the same change.
export interface ToolRecipeStub {
  /** Item id this recipe would produce once #1127 can consume recipes. */
  outputItemId: string;
  /** Which craft on the CRAFT_RING would perform this (see #1125's ring). */
  craftId: string;
  /** Placeholder ingredient list: itemId plus quantity consumed per craft. */
  ingredients: { itemId: string; qty: number }[];
}

// NOTE: several `ingredients[].itemId` values below (thorium_ore,
// arcanite_bar, ashwood_log, elderwood_log, goldleaf_herb, sunpetal_herb) are
// PLACEHOLDER ids: no matching ItemDef exists yet, because the monster
// material / node-drop items they'd come from are their own future content
// slice. That is fine ONLY because this table is inert and unread by the
// engine; do not merge TOOL_RECIPE_STUBS into ITEMS or any live table until
// those ingredient items are real and #1127 exists to consume the recipe.
export const TOOL_RECIPE_STUBS: ToolRecipeStub[] = [
  {
    outputItemId: 'thorium_mining_pick',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'thorium_ore', qty: 4 },
      { itemId: 'mithril_mining_pick', qty: 1 },
    ],
  },
  {
    outputItemId: 'arcanite_mining_pick',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'arcanite_bar', qty: 2 },
      { itemId: 'thorium_mining_pick', qty: 1 },
    ],
  },
  {
    outputItemId: 'ashwood_axe',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'ashwood_log', qty: 4 },
      { itemId: 'ironbark_axe', qty: 1 },
    ],
  },
  {
    outputItemId: 'elderwood_axe',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'elderwood_log', qty: 2 },
      { itemId: 'ashwood_axe', qty: 1 },
    ],
  },
  {
    outputItemId: 'goldleaf_sickle',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'goldleaf_herb', qty: 4 },
      { itemId: 'silverleaf_sickle', qty: 1 },
    ],
  },
  {
    outputItemId: 'sunpetal_sickle',
    craftId: 'engineering',
    ingredients: [
      { itemId: 'sunpetal_herb', qty: 2 },
      { itemId: 'goldleaf_sickle', qty: 1 },
    ],
  },
];

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
// mechanic itself and why it is currently inert (no town/crafting-station
// proximity gate exists anywhere in the engine yet for it to bypass).
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

// Level-20 crafting hub (issue #1297): a designated in-world location hosting
// a station for every craft on CRAFT_RING, gated to characters at or above
// zone3's top level. The gate/read logic lives in
// ../professions/crafting_hub.ts behind the SimContext seam; this is the
// content half: WHERE the hub sits and WHICH stations it hosts.
//
// Location: rather than build a fourth, brand-new town (out of scope per the
// issue's own notes: "Scope (which zone, what the hub includes) needs
// maintainer confirmation... Independent of the wheel mechanics"), this reuses
// Thornpeak Heights' existing Highwatch hub (content/zone3.ts ZONE3_ZONE.hub):
// zone3's levelRange tops out at exactly 20 (`[13, 20]`), so "the level-20
// zone" already exists and Highwatch is its town center. Importing the hub
// circle directly (rather than re-typing its coordinates) keeps this content
// from silently drifting if Highwatch's hub ever moves.
export const CRAFTING_HUB_ZONE_ID = ZONE3_ZONE.id;
export const CRAFTING_HUB_POS: { readonly x: number; readonly z: number } = {
  x: ZONE3_ZONE.hub.x,
  z: ZONE3_ZONE.hub.z,
};
export const CRAFTING_HUB_RADIUS = ZONE3_ZONE.hub.radius;

// The level a character must have reached to use a hub station (issue
// #1297's own title: "Professions: level-20 zone and crafting hub"). Matches
// zone3's top level exactly, rather than inventing an unrelated number: by
// the time a character can comfortably work the zone whose town hosts the
// hub, they have reached the level the hub gates on.
export const CRAFTING_HUB_MIN_LEVEL = 20;

export interface CraftingHubStationDef {
  /** Which craft on CRAFT_RING this station serves. */
  craftId: string;
  /** Offset from CRAFTING_HUB_POS, kept well within CRAFTING_HUB_RADIUS so
   *  every station sits inside the hub's gate circle. */
  offset: { x: number; z: number };
}

// One station per craft on the ring (ten total), laid out on a small circle
// around the hub center so no two stations overlap. A future render pass
// reads `craftId` + `offset` to place a minimal prop per station; this table
// carries no display "name" field of its own (avoiding a new player-visible
// string surface in this pass) since a station is identified by its craft id,
// which already has a localized display name (src/ui/i18n.catalog/hud_chrome.ts
// `craftName.<craftId>` / `gathering.*`).
//
// Has zero consumers today: forward content for that future render pass, kept
// data-as-code (module-init cost is negligible, ten cheap trig calls). Its
// `offset` is render-only positioning; never feed it back into sim state if a
// consumer lands.
export const CRAFTING_HUB_STATIONS: readonly CraftingHubStationDef[] = CRAFT_RING.map(
  (craft, index) => {
    const angle = (index / CRAFT_RING.length) * Math.PI * 2;
    const stationRadius = CRAFTING_HUB_RADIUS * 0.6;
    return {
      craftId: craft.id,
      offset: {
        x: Math.round(Math.cos(angle) * stationRadius),
        z: Math.round(Math.sin(angle) * stationRadius),
      },
    };
  },
);
