// Pure, host-agnostic core for the Apply Enchant picker (Professions 2.0).
// Two steps, both DOM-free: (1) the enchants that consume a chosen
// reagent, each with its EFFECT facts, its per-reagent affordability read from
// the viewer's inventory, and its target slot, grouped into the three reagent-
// derived tier sections (enchantSectionsForReagent) and sorted by paperdoll
// slot inside each, and (2) the items eligible as the enchant target (def slot
// matches the enchant), in two families: the BAGGED copies (enchantTargets)
// and the WORN ones (wornEnchantTargets), since worn gear is enchanted in
// place and needs no unequip / re-equip round trip. Not-yet-enchanted copies
// are plain targets; already-enchanted copies surface as FLAGGED replace rows
// (#2415) whose activation is confirm-gated by the thin consumer, each
// carrying what the confirm dialog must name: the doomed enchant id (or a
// legacy victim's raw stats), plus what the swap does NOT destroy
// (preservedReplaceTraits, #2421) and whether the row shares its item name with
// a plain twin (mixedHolding, #2421). Every row also carries the two
// discriminators that keep NO TWO ROWS OF ONE LIST sharing an accessible name
// (#2466): `heroic`, because itemDisplayName resolves a heroic variant to its
// base item's name, and `slotIndex`, because ring1 and ring2 share one slot
// label. The enchant content is static
// (content/enchants.ts, identical in both worlds), so both steps are a plain
// read of world.inventory; no wire round trip. enchant_apply_view never
// decides an outcome: world.applyEnchant does, server-authoritative.
//
// Enchant display names have no i18n pipeline before this picker (EnchantDef.name
// has never rendered), so enchantNameKey names the FIRST render sink key for the
// thin consumer to resolve; never raw def.name.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../sim/content/enchants';
import { ITEMS } from '../sim/data';
import { isEnchantedInstance, replaceVictimIndex } from '../sim/professions/enchanting';
import {
  ALL_EQUIP_SLOTS,
  type EquipSlot,
  type InvSlot,
  type ItemInstancePayload,
} from '../sim/types';
import type { TranslationKey } from './i18n.catalog';
import { sharedSlotLabelIndex } from './item_slot_labels';

/** The localized-name key for one enchant id (hudChrome.enchantName.<id>): its
 *  first render sink. */
export function enchantNameKey(enchantId: string): TranslationKey {
  return `hudChrome.enchantName.${enchantId}` as TranslationKey;
}

/** The localized key for the heroic mark, the ONE discriminator between a heroic
 *  upgraded variant and the base item it borrows its name from. Already the
 *  item tooltip's own instrument (hud.ts paints it on the quality/kind line);
 *  naming it here is what lets the picker rows say the same thing. */
export const HEROIC_TAG_KEY: TranslationKey = 'hudChrome.itemHeroicTag';

/** Whether `itemId` is a heroic item, on the SAME condition the item tooltip's
 *  own [HEROIC] tag uses (hud.ts: `heroicOf || heroic`), so the one tag never
 *  means two different things on two surfaces. Both arms matter for a different
 *  reason: a generated `heroicOf` variant shares its base item's display NAME by
 *  design (classic: a heroic drop reads the same as its normal counterpart,
 *  entity_i18n itemDisplayName), which is the collision #2466 is about, while a
 *  bespoke `heroic` piece keeps its own name key and needs no discriminator, but
 *  would look unmarked here beside the tooltip that marks it.
 *
 *  Every row family carries this so the picker can paint the mark and keep the
 *  two rows' accessible names apart. Unconditional, not collision-gated: it is a
 *  true fact about the copy either way, and a tag that blinks in and out
 *  depending on what else the player happens to hold would be the harder thing
 *  to trust. */
function isHeroicItem(itemId: string): boolean {
  const def = ITEMS[itemId];
  return def?.heroicOf !== undefined || def?.heroic === true;
}

/** Total held count of an item id across every stack (fungible + instanced).
 *  Enchant reagents are plain materials, so this mirrors the sim's ctx.countItem
 *  the apply command checks each reagent against. */
function heldCount(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot.itemId === itemId) n += slot.count;
  return n;
}

export interface EnchantReagentRow {
  itemId: string;
  required: number;
  have: number;
}

/** One stat axis an enchant grants, as the picker renders it inline. */
export interface EnchantEffectRow {
  /** The EnchantDef.statBonus key (str/agi/sta/int/spi/armor). */
  stat: string;
  value: number;
}

export interface EnchantPickRow {
  enchantId: string;
  /** The equip slot this enchant targets (ItemDef['slot']). */
  itemSlot: string;
  /** What the enchant actually DOES, straight off ENCHANTS[id].statBonus in
   *  declaration order. Rendered inline on the row (never hover-only: the
   *  picker also lives on touch, where there is no hover). */
  effects: EnchantEffectRow[];
  reagents: EnchantReagentRow[];
  /** True only when every reagent is held in sufficient count. */
  affordable: boolean;
}

/** The enchants that consume `reagentItemId`, in ENCHANTS declaration order,
 *  each with its effect facts, per-reagent affordability from the viewer's
 *  inventory, and its target slot. */
export function enchantsForReagent(
  inventory: readonly InvSlot[],
  reagentItemId: string,
): EnchantPickRow[] {
  const rows: EnchantPickRow[] = [];
  for (const enchant of Object.values(ENCHANTS)) {
    if (!enchant.reagents.some((reagent) => reagent.itemId === reagentItemId)) continue;
    const reagents = enchant.reagents.map((reagent) => ({
      itemId: reagent.itemId,
      required: reagent.count,
      have: heldCount(inventory, reagent.itemId),
    }));
    const effects: EnchantEffectRow[] = [];
    for (const [stat, value] of Object.entries(enchant.statBonus)) {
      if (value === undefined || value === 0) continue;
      effects.push({ stat, value });
    }
    rows.push({
      enchantId: enchant.id,
      itemSlot: enchant.itemSlot,
      effects,
      reagents,
      affordable: reagents.every((reagent) => reagent.have >= reagent.required),
    });
  }
  return rows;
}

/** The three enchant tiers the picker groups by, in ladder order. Derived from
 *  the reagents alone (EnchantDef carries no tier field and this change adds
 *  none): arcane_shard is the Greater tier's exclusive reagent, a typed
 *  `resonant_*` secondary is the Runed tier's, and everything else is Base.
 *  Shard WINS over resonant so a hypothetical enchant consuming both still
 *  reads as the top tier (content/enchants.ts describes shard as the premium
 *  that has to stay a visible step). */
export type EnchantTier = 'base' | 'runed' | 'greater';

export const ENCHANT_TIER_ORDER: readonly EnchantTier[] = ['base', 'runed', 'greater'];

/** The item id whose presence in an enchant's reagents marks the Greater tier. */
const GREATER_TIER_REAGENT = 'arcane_shard';

/** The id prefix of the typed disenchant secondaries
 *  (src/sim/professions/disenchant_reagents.ts), the Runed tier's reagents. */
const RUNED_TIER_REAGENT_PREFIX = 'resonant_';

/** Which tier one enchant sits in, from its reagents. Unknown ids read as Base
 *  (the picker never drops a row it cannot classify). */
export function enchantTier(enchantId: string): EnchantTier {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return 'base';
  let runed = false;
  for (const reagent of enchant.reagents) {
    if (reagent.itemId === GREATER_TIER_REAGENT) return 'greater';
    if (reagent.itemId.startsWith(RUNED_TIER_REAGENT_PREFIX)) runed = true;
  }
  return runed ? 'runed' : 'base';
}

/** Paperdoll order for the picker's within-section sort: the weapon first, then
 *  the armor slots top to bottom, jewelry last. Mirrors how a player reads
 *  their own character sheet, so a slot's enchants sit where the eye expects
 *  them. An unlisted slot sorts after every listed one. */
const SLOT_SORT_ORDER: readonly string[] = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
];

function slotSortIndex(itemSlot: string): number {
  const index = SLOT_SORT_ORDER.indexOf(itemSlot);
  return index < 0 ? SLOT_SORT_ORDER.length : index;
}

/** The localized section-header key for one tier. */
export function enchantTierTitleKey(tier: EnchantTier): TranslationKey {
  return `hudChrome.enchanting.tier.${tier}` as TranslationKey;
}

export interface EnchantPickSection {
  tier: EnchantTier;
  titleKey: TranslationKey;
  rows: EnchantPickRow[];
}

/** enchantsForReagent, grouped into the three tier sections in ladder order and
 *  sorted inside each section by paperdoll slot then name key. Empty sections
 *  are omitted, so a dust-only reagent still paints exactly one header. Pure:
 *  the input rows are re-bucketed, never mutated. */
export function enchantSectionsForReagent(
  inventory: readonly InvSlot[],
  reagentItemId: string,
): EnchantPickSection[] {
  const byTier = new Map<EnchantTier, EnchantPickRow[]>();
  for (const row of enchantsForReagent(inventory, reagentItemId)) {
    const tier = enchantTier(row.enchantId);
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(row);
    else byTier.set(tier, [row]);
  }
  const sections: EnchantPickSection[] = [];
  for (const tier of ENCHANT_TIER_ORDER) {
    const rows = byTier.get(tier);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => {
      const slotDelta = slotSortIndex(a.itemSlot) - slotSortIndex(b.itemSlot);
      if (slotDelta !== 0) return slotDelta;
      const aKey = enchantNameKey(a.enchantId);
      const bKey = enchantNameKey(b.enchantId);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    sections.push({ tier, titleKey: enchantTierTitleKey(tier), rows });
  }
  return sections;
}

/** One per-copy fact that SURVIVES a replace untouched (#2421). The sim's
 *  replace payload (professions/enchanting.ts replacedEnchantPayloadFor) clones
 *  the victim and rewrites only `rolled.stats` and the `enchant` marker, so
 *  every other ItemInstancePayload field rides through byte-identical. The
 *  confirm dialog states these because the likeliest user of that dialog is
 *  holding a signed masterwork piece and cannot otherwise tell whether their
 *  signature and masterwork bonus survive the swap. */
export type EnchantPreservedTrait = 'signer' | 'masterwork' | 'bond';

/** The localized label key for one preserved trait: its first render sink, the
 *  enchantNameKey contract. `bond` deliberately covers BOTH bind states with
 *  one label: an armed lock and an applied one are the same Maker's Bond, and
 *  this dialog states what the swap leaves alone, not which state the bond is
 *  currently in (the item tooltip's commissionBound / commissionUnbound lines
 *  own that). One label also keeps the confirm speaking the commission
 *  vocabulary the tooltip and the unbind window already use, instead of
 *  surfacing the raw ItemInstancePayload field names as player copy. */
const PRESERVED_TRAIT_KEYS: Record<EnchantPreservedTrait, TranslationKey> = {
  signer: 'hudChrome.enchanting.replaceConfirmKeepsSigner',
  masterwork: 'hudChrome.enchanting.replaceConfirmKeepsMasterwork',
  bond: 'hudChrome.enchanting.replaceConfirmKeepsBond',
};

/** Every trait, in the order preservedReplaceTraits emits them. DERIVED from
 *  PRESERVED_TRAIT_KEYS rather than written out again: that table is a
 *  `Record<EnchantPreservedTrait, ...>`, so tsc forces it complete, and a fourth
 *  trait lands here the moment it lands there. A hand-written twin only LOOKED
 *  exhaustive: dropping a member from it typechecked cleanly and quietly
 *  narrowed every test that sweeps this. Insertion order IS the emit order,
 *  pinned against preservedReplaceTraits in tests/enchant_apply_view.test.ts. */
export const ENCHANT_PRESERVED_TRAITS: readonly EnchantPreservedTrait[] = Object.keys(
  PRESERVED_TRAIT_KEYS,
) as EnchantPreservedTrait[];

export function preservedTraitKey(trait: EnchantPreservedTrait): TranslationKey {
  return PRESERVED_TRAIT_KEYS[trait];
}

/** Which of the surviving facts `victim` ACTUALLY carries, in one fixed order
 *  (signature, masterwork, bond), so a plain victim is never told its signature
 *  is safe. Either bind field reports the one `bond` trait: `bindOnTrade` arms
 *  the lock and `boundTo` is the lock applied, and the swap leaves both alone,
 *  so the dialog has one thing to say either way.
 *
 *  Each field is tested the way ITS OWN render sink tests it, which is not one
 *  rule: `signer` on truthiness, matching instanceMakersMarkLine's `!signer`
 *  gate, so an empty name is never promised a mark the tooltip would not draw;
 *  `boundTo` on PRESENCE, because entity id 0 is a real player and truthiness
 *  would lose the very first character in a world its line.
 *
 *  `wireTrimmed` marks a victim read off the WORN mirror. The public `eqi` wire
 *  carries signer/enchant/rolled ONLY (server/game.ts data minimization, the
 *  same trim wornTooltipInstance applies), so an online client cannot see a worn
 *  copy's boundTo/bindOnTrade while the offline Sim holds the full payload.
 *  Dropping the bond on that arm is what keeps the two hosts saying the same
 *  thing; the bond is a bag-surface fact by construction, and the item tooltip
 *  already goes silent about it on worn gear for exactly this reason.
 *
 *  ACCEPTED CONSEQUENCE: the bond DOES survive a worn replace (the sim clones
 *  the payload whole), so this arm under-states rather than lying. Saying more
 *  would need boundTo/bindOnTrade on the eqi wire, which is a server data-
 *  minimization change well outside a picker fix; the trim is pinned by
 *  tests/enchant_apply_view.test.ts so widening the wire re-opens this. */
export function preservedReplaceTraits(
  victim: ItemInstancePayload,
  wireTrimmed = false,
): EnchantPreservedTrait[] {
  const traits: EnchantPreservedTrait[] = [];
  if (victim.signer) traits.push('signer');
  if (victim.rolled?.masterwork === true) traits.push('masterwork');
  if (wireTrimmed) return traits;
  if (victim.boundTo !== undefined || victim.bindOnTrade === true) traits.push('bond');
  return traits;
}

/** The replace facts one flagged target row carries (#2415), everything the
 *  confirm dialog needs to name what is being destroyed BEFORE the command is
 *  sent. Marker victims carry the doomed enchant's id; LEGACY pre-marker
 *  victims (bare rolled.stats, no marker) have no id to name, so they carry
 *  the raw baked stats being replaced instead. */
export interface EnchantReplaceTargetInfo {
  /** Enchant id on the pinned victim copy; undefined for a legacy victim. */
  enchantId?: string;
  /** The raw stats being destroyed on a LEGACY victim (its whole rolled.stats
   *  map, which on a pre-marker copy IS the old enchant). */
  stats?: Record<string, number>;
  /** The picked enchant is already on the victim: the row paints DISABLED (a
   *  confirm whose accept the sim denies same_enchant is never offered). */
  sameEnchant: boolean;
  /** What the swap does NOT destroy (#2421), in preservedReplaceTraits order.
   *  ABSENT, never an empty array, when the victim carries none of them: the
   *  thin consumer paints the kept line only when there is something true to
   *  say.
   *
   *  Describes the copy replaceVictimIndex pins RIGHT NOW, and inherits #2415's
   *  accepted pin window whole: a copy arriving at a higher index between dialog
   *  and accept moves the pin, so this can go stale exactly as the "Replaces X"
   *  warning already can. Worth stating, because the direction flips: that
   *  warning went stale toward naming the wrong casualty, this goes stale toward
   *  promising a trait the newcomer lacks. Same one-confirm-click window, same
   *  actor's-own loss, no new exposure. */
  preserved?: EnchantPreservedTrait[];
}

/** The replace facts for one already-enchanted victim payload, or undefined
 *  when the copy is not replaceable: a marker id that no longer resolves
 *  cannot be subtracted exactly, so the sim refuses it (the defensive
 *  already_enchanted arm) and the picker must not offer it. Mirrors the sim's
 *  replace-arm validity gates one for one.
 *
 *  `wireTrimmed` is REQUIRED here, with no default, deliberately: the permissive
 *  answer is the one that over-claims, and this is a truthfulness guard, so a
 *  third arm added later has to state which mirror it read rather than inherit
 *  silence. The exported preservedReplaceTraits keeps its default, since there
 *  the untrimmed full payload is the ordinary case. */
function replaceInfoFor(
  victim: ItemInstancePayload,
  enchantId: string,
  wireTrimmed: boolean,
): EnchantReplaceTargetInfo | undefined {
  const preserved = preservedReplaceTraits(victim, wireTrimmed);
  if (victim.enchant !== undefined) {
    if (!ENCHANTS[victim.enchant]) return undefined;
    const info: EnchantReplaceTargetInfo = {
      enchantId: victim.enchant,
      sameEnchant: victim.enchant === enchantId,
    };
    if (preserved.length > 0) info.preserved = preserved;
    return info;
  }
  const info: EnchantReplaceTargetInfo = {
    stats: { ...victim.rolled?.stats },
    sameEnchant: false,
  };
  if (preserved.length > 0) info.preserved = preserved;
  return info;
}

export interface EnchantTargetRow {
  itemId: string;
  /** How many eligible copies are held: enchantable copies for a plain row,
   *  already-enchanted copies for a replace row. */
  count: number;
  /** Set iff the item is a HEROIC upgraded variant (#2466). ABSENT, never false,
   *  on an ordinary item. The thin consumer paints the heroic mark from this,
   *  which is what keeps a base row and its heroic twin's row from rendering one
   *  identical accessible name: itemDisplayName resolves both to the base item's
   *  name by design, and the picker had no other mark. See isHeroicItem. */
  heroic?: true;
  /** Present iff this is a flagged REPLACE row (#2415): the target copies are
   *  already enchanted, activation runs the confirm dialog, and the apply is
   *  sent with confirmReplace. Describes the PINNED victim (the sim's
   *  replaceVictimIndex choice), so what the dialog names is exactly what a
   *  confirmed apply destroys. */
  replace?: EnchantReplaceTargetInfo;
  /** Set on the rows of a MIXED HOLDING (#2421): one item id held plain AND
   *  already enchanted. ABSENT, never false, everywhere else. The thin consumer
   *  tags the plain twin from this, so the pair is told apart by what each row
   *  SAYS rather than by one of them having a sub-line and the other not, which
   *  is the whole of the distinction a screen reader gets otherwise.
   *
   *  The enchanted twin counts whether it sits in the BAGS or on the BODY: both
   *  families paint into the one list a player reads, so an enchanted WORN copy
   *  leaves its bagged plain twin in exactly the bare-row state this flag exists
   *  to remove. Pass the worn rows to enchantTargets to have that arm counted
   *  (the consumer does); with none passed the flag describes the bagged pair
   *  alone.
   *
   *  Still keyed on the item ID, and correctly so: it reports a difference of
   *  STATE between two copies of ONE item, which is a different question from
   *  whether two rows render the same name. The name collisions are handled at
   *  their own root by their own discriminators (`heroic` here, `slotIndex` on
   *  the worn row, #2466), so this flag never had to grow into a duplicate-name
   *  flag; widening it would have tagged "Not enchanted" onto rows that differ
   *  by something else entirely.
   *
   *  Nor is it a LOCATION flag. A plain bagged copy beside a plain WORN copy of
   *  the same id is left bare on purpose: both are unenchanted, so "Not
   *  enchanted" would say nothing that told them apart, and the worn row already
   *  states where it is, so the two accessible names already differ. Saying
   *  where the bagged copy is wants a bag-side counterpart to the Worn tag, not
   *  this flag; it stays an accepted limit, pinned in
   *  tests/enchant_apply_view.test.ts so it cannot be mistaken for coverage. */
  mixedHolding?: true;
}

/** The distinct held items eligible as the enchant target: def slot matches the
 *  enchant's itemSlot and at least one ENCHANTABLE copy is held. Mirrors the
 *  sim's ctx.countEnchantableItem: a plain fungible copy or a non-already-
 *  enchanted instanced copy qualifies, so a masterwork or signed copy stays
 *  eligible while an already-enchanted copy never applies silently.
 *  Already-enchanted copies surface as FLAGGED replace rows (#2415) appended
 *  after the plain rows, each describing the pinned victim the sim would
 *  consume (replaceVictimIndex, the same function the sim's replace arm
 *  walks). Grouped by item id (the apply command is itemId-keyed), each family
 *  in first-seen inventory order.
 *
 *  `worn` is the WORN family the same picker paints above these rows
 *  (wornEnchantTargets), passed in for ONE reason: so the mixedHolding flag can
 *  see an enchanted copy that happens to be on the body rather than in the bags.
 *  The two families are one list to the reader, so an enchanted worn copy leaves
 *  its bagged plain twin just as bare as an enchanted bagged one would. Nothing
 *  else reads it, and the default (none) is the bagged-pair-only behavior. */
export function enchantTargets(
  inventory: readonly InvSlot[],
  enchantId: string,
  worn: readonly WornEnchantTargetRow[] = [],
): EnchantTargetRow[] {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return [];
  const byItem = new Map<string, number>();
  const enchantedByItem = new Map<string, number>();
  for (const slot of inventory) {
    const def = ITEMS[slot.itemId];
    if (!def || def.slot !== enchant.itemSlot) continue;
    if (slot.instance && isEnchantedInstance(slot.instance)) {
      enchantedByItem.set(slot.itemId, (enchantedByItem.get(slot.itemId) ?? 0) + slot.count);
      continue;
    }
    byItem.set(slot.itemId, (byItem.get(slot.itemId) ?? 0) + slot.count);
  }
  const rows: EnchantTargetRow[] = [...byItem].map(([itemId, count]) => ({ itemId, count }));
  for (const [itemId, count] of enchantedByItem) {
    const victimIdx = replaceVictimIndex(inventory, itemId);
    const victim = victimIdx >= 0 ? inventory[victimIdx].instance : undefined;
    if (!victim) continue;
    // false: the bagged arm reads the self `inv` mirror, which carries the FULL
    // payload in both hosts (the server ships meta.inventory whole), so the
    // confirm can honestly speak for the bind state here.
    const replace = replaceInfoFor(victim, enchantId, false);
    if (!replace) continue;
    rows.push({ itemId, count, replace });
  }
  // Mark the mixed holdings (#2421) once every family is in, so the flag
  // reflects the rows actually EMITTED: an enchanted copy the picker dropped
  // (an unresolvable marker id) leaves its plain twin unambiguous and unmarked.
  // The enchanted twin may be a WORN row rather than a bagged one; both paint
  // into the one list a player reads, so both leave a bare plain row ambiguous.
  const enchantedIds = new Set<string>();
  for (const row of rows) if (row.replace !== undefined) enchantedIds.add(row.itemId);
  for (const row of worn) if (row.replace !== undefined) enchantedIds.add(row.itemId);
  const mixed = new Set([...enchantedIds].filter((itemId) => byItem.has(itemId)));
  for (const row of rows) if (mixed.has(row.itemId)) row.mixedHolding = true;
  // The heroic mark, on every family and unconditionally (#2466): a heroic
  // variant renders its BASE item's name, so without it a base row and a heroic
  // row are one string told apart by nothing a player or a screen reader can
  // reach. One sweep over the finished rows, the mixedHolding idiom above, so
  // the two families cannot pick it up differently.
  for (const row of rows) if (isHeroicItem(row.itemId)) row.heroic = true;
  return rows;
}

export interface WornEnchantTargetRow {
  itemId: string;
  /** The exact equipment key this copy is worn in, and the discriminator the
   *  apply command carries: ring1/ring2 and mainhand/offhand can be wearing
   *  identical copies of one item id, so the id alone cannot name the target. */
  slot: EquipSlot;
  /** Present iff the worn copy is already enchanted (#2415): a flagged REPLACE
   *  row, confirm-gated exactly like the bagged family. No victim pin is
   *  needed here: the slot IS the discriminator. */
  replace?: EnchantReplaceTargetInfo;
  /** Set iff the item is a HEROIC upgraded variant (#2466), exactly as on the
   *  bagged row: the worn family shares the one list and the one name resolver,
   *  so a heroic ring on one finger and its base twin on the other collide the
   *  same way a bagged pair does. */
  heroic?: true;
  /** 1-based position of `slot` inside the group of equipment keys that share
   *  ONE label (sharedSlotLabelIndex), present only for such a key (#2466).
   *  ring1 and ring2 both read "Finger", so the slot that discriminates the
   *  DISPATCH did not discriminate the label: two fingers wearing identical
   *  copies rendered two byte-identical rows that both stayed activatable, and
   *  the player could not tell which finger they were about to change. The thin
   *  consumer paints the indexed worn tag from this and the plain one otherwise,
   *  so nothing is numbered where a label already names its slot alone. */
  slotIndex?: number;
}

/** The WORN copies eligible as the enchant target, one row per equipment slot,
 *  in ALL_EQUIP_SLOTS order. Mirrors the sim's worn arm
 *  (src/sim/professions/enchanting.ts resolveApplyEnchantWorn) gate for gate: the
 *  worn item's def slot must match the enchant's itemSlot. An ABSENT payload is
 *  a plain worn copy and stays eligible; a signed or masterwork payload is not
 *  "enchanted" and stays eligible too, exactly as in the bags. An
 *  already-enchanted worn copy surfaces as a FLAGGED replace row (#2415)
 *  rather than being hidden, in the same slot-order pass. Both rings and both
 *  hands list separately when each holds an eligible copy, since each is its
 *  own target, and each carries what its LABEL needs to stand apart from the
 *  other: `slotIndex` where two equipment keys share one slot label, `heroic`
 *  where the item borrows its name from a base item (#2466).
 *
 *  `equipment` and `equippedInstances` are read straight off the two worlds'
 *  shared surfaces (IWorld.equipment and the self entity mirror
 *  Entity.equippedInstances), so this decides identically offline and online. */
export function wornEnchantTargets(
  equipment: Partial<Record<EquipSlot, string>>,
  equippedInstances: Partial<Record<EquipSlot, ItemInstancePayload>>,
  enchantId: string,
): WornEnchantTargetRow[] {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return [];
  const rows: WornEnchantTargetRow[] = [];
  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const def = ITEMS[itemId];
    if (!def || def.slot !== enchant.itemSlot) continue;
    const instance = equippedInstances[slot];
    if (instance && isEnchantedInstance(instance)) {
      // wireTrimmed: this arm reads the WORN mirror, whose online form is the
      // stripped eqi allowlist (signer/enchant/rolled). See
      // preservedReplaceTraits: claiming a bind state here would make the
      // confirm dialog say different things offline and online.
      const replace = replaceInfoFor(instance, enchantId, true);
      if (replace) rows.push({ itemId, slot, replace });
      continue;
    }
    rows.push({ itemId, slot });
  }
  // The two name discriminators (#2466), one sweep over the finished rows so the
  // replace arm and the plain arm cannot pick them up differently.
  for (const row of rows) {
    if (isHeroicItem(row.itemId)) row.heroic = true;
    const slotIndex = sharedSlotLabelIndex(row.slot);
    if (slotIndex !== undefined) row.slotIndex = slotIndex;
  }
  return rows;
}
