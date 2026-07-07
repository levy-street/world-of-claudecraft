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
// Design-doc note: the canonical ring order lives at
// https://woc.nervemart.com/docs/professions-system, which returned 403 Forbidden
// when this file was authored. The ring below is a reasonable placeholder pending
// maintainer confirmation against the design doc: a 10-craft circle, opposite =
// 5 positions away, adjacent = 1 position away either side, with the 4 poles grouped
// as evenly as sensible (Material: crafts that shape raw matter into gear;
// Experimental: crafts driven by trial-and-error formulae; Formal: crafts built on
// exact patterns/measurements; Cross-cutting: crafts that touch every other craft's
// output). Flag any correction needed once the doc is reachable.

export type CraftPole = 'Material' | 'Experimental' | 'Formal' | 'Cross-cutting';

export interface CraftDef {
  id: string;
  name: string;
  pole: CraftPole;
}

// Fixed ring order (index is the ring position). Opposite crafts sit 5 positions
// apart; adjacent crafts sit 1 position apart on either side.
export const CRAFT_RING: CraftDef[] = [
  { id: 'armorcrafting', name: 'Armorcrafting', pole: 'Material' },
  { id: 'weaponcrafting', name: 'Weaponcrafting', pole: 'Material' },
  { id: 'jewelcrafting', name: 'Jewelcrafting', pole: 'Material' },
  { id: 'alchemy', name: 'Alchemy', pole: 'Experimental' },
  { id: 'engineering', name: 'Engineering', pole: 'Experimental' },
  { id: 'cooking', name: 'Cooking', pole: 'Cross-cutting' },
  { id: 'inscription', name: 'Inscription', pole: 'Cross-cutting' },
  { id: 'enchanting', name: 'Enchanting', pole: 'Cross-cutting' },
  { id: 'tailoring', name: 'Tailoring', pole: 'Formal' },
  { id: 'leatherworking', name: 'Leatherworking', pole: 'Formal' },
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
// logic): thresholds and percents are placeholders pending maintainer
// confirmation against the design doc (same 403-Forbidden caveat noted above
// CRAFT_RING), kept deliberately uniform across crafts and poles so no single
// craft is silently favored until real balance numbers land.
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
