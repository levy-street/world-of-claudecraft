import type {
  CommissionOrderScope,
  CommissionOrderStatus,
} from '../sim/professions/commission_order';
import type { MaterialRarity } from '../sim/professions/gathering';
import type { PlayerProfessionSkill, ProfessionRecipeRecord } from '../sim/professions/types';
import type { EquipSlot, StationDef } from '../sim/types';
import type { WorldInteractionOutcome } from './interaction';

export type { CommissionOrderScope, CommissionOrderStatus };

// Render-safe projection of a player's professions standing. Stub as of
// #1164, now real for the gathering professions (#1119): `skills` carries one
// entry per gathering profession (Mining/Logging/Herbalism), independent
// additive counters. Crafting/secondary professions still contribute nothing
// until #1120/#1125/#1126/#1140 land.
export interface PlayerProfessionsView {
  skills: readonly PlayerProfessionSkill[];
}

/** Atomic crafting progression and identity mirror. `synced` is false only on
 * an online client that has not received its first cprof value yet. */
export interface CraftingIdentityView {
  version: 1;
  synced: boolean;
  craftSkills: Readonly<Record<string, number>>;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
  attunedPairs: readonly string[];
  switchCount: number;
  amendsProgress: number;
  amendsRequired: number;
  // Recipe training (Professions 2.0): the recipe ids this character
  // has LEARNED via an acquisition source (trainer/drop/quest), SORTED for
  // stable signatures (the server's cprof delta diffs the JSON form).
  // Grandfathered recipes (no acquisition list) are known to everyone WITHOUT
  // appearing here; full knownness is this set plus the empty-acquisition arm
  // of src/sim/professions/crafting.ts isRecipeKnown over static content.
  knownRecipes: readonly string[];
  // Repeatable work orders currently inside their cooldown window (Professions
  // 2.0), SORTED so the JSON form is a stable cprof signature. The
  // SERVER computes this against ITS tickCount (the activeMobileStationCraft
  // precedent: tick-domain state is resolved server-side, never predicted by the
  // client) and it rides the existing cprof delta; the online client feeds it
  // into computeQuestState so a work order on cooldown shows unavailable there
  // too. Offline the Sim ignores this field and re-derives the set from live
  // PlayerMeta.questCadence. Absent on an older server payload.
  cadenceBlockedQuests?: readonly string[];
  // Hobbies explicitly chosen through the hobby-switch quest, keyed by
  // canonical pair id (src/sim/professions/hobby_memory.ts). The
  // pair-transition restore reads the same record, so the attunement
  // dialog's pre-commit preview can promise the SAME hobby a make-amends
  // return will actually set instead of the skill default. KEY-SORTED so
  // the JSON form is a stable cprof signature; ABSENT (zero-default
  // omission) for characters that never quested a hobby and on an older
  // server's payload.
  questedHobbies?: Readonly<Record<string, string>>;
}

// Static content read: the common-tier recipe list (issue #1127). A plain
// data read (no per-player state), so it needs no wire round-trip: both
// worlds serve the same content table directly (Sim from src/sim/data.ts,
// ClientWorld from the same import, since recipe content ships with the
// client bundle like every other content table).
export type RecipeDef = ProfessionRecipeRecord;

// Craft-result surface (#1127): the outcome of one craftItem command, mirrored
// from the server's `craftResult` event so the client can render a toast/log
// line without deciding the outcome itself. `null` until the first craft
// attempt of the session.
export interface CraftResultView {
  ok: boolean;
  recipeId: string;
  itemId?: string;
  count?: number;
  quality?: MaterialRarity;
  reason?:
    | 'unknown_recipe'
    | 'insufficient_materials'
    | 'combo_requirement_unmet'
    | 'recipe_not_learned'
    | 'throttled'
    // Supersedes #1297's not_at_hub: denied because the recipe is
    // station-bound and the player is neither at a station of its type nor
    // holding an ACTIVE mobile station for that craft (the mobile arm checks
    // activity and type, never distance). The ui resolves
    // WHICH station from recipeById(recipeId)?.stationType (static content,
    // identical in both worlds): no station field rides the event.
    | 'station_required'
    // #2350: denied because the output (modeled after reagent consumption)
    // cannot fit the pooled bag budget.
    | 'no_bag_space';
  // Professions 2.0: true only when the masterwork effect applied to
  // this craft's output. `quality` now reports the output def's static
  // quality (outputs are deterministic; the quality roll is retired).
  masterwork?: boolean;
}

// Masterwork proc surface (Professions 2.0): the local viewer's most
// recent masterwork proc, mirrored from the server's `masterwork` event the
// same way CraftResultView mirrors `craftResult`. Ids only, string-free per
// the IWorld seam rule; `crafter` is the crafting player's entity id. `null`
// until the first masterwork proc of the session.
export interface MasterworkView {
  recipeId: string;
  itemId: string;
  crafter: number;
}

// Salvage-result surface (Professions 2.0): the outcome of one
// salvageItem command, mirrored from the server's `salvageResult` event (and
// the `salv` self-delta) so the client renders a toast/log without deciding the
// outcome itself. Ids + values only, string-free per the seam rule. Shape
// matches src/sim/professions/salvage.ts SalvageResult. `null` until the first
// salvage attempt of the session.
export interface SalvageResultView {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled' | 'no_bag_space';
}

// Disenchant-result surface (Professions 2.0): mirrors
// src/sim/professions/enchanting.ts DisenchantResult, including the typed
// bind-on-trade secondary a rare-or-better disenchant also yields
// (secondaryItemId/secondaryCount, absent on every sub-rare success and on a
// rare+ piece with no typed material). `null` until the first disenchant attempt
// of the session.
export interface DisenchantResultView {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  secondaryItemId?: string;
  secondaryCount?: number;
  reason?: 'unknown_item' | 'not_disenchantable' | 'not_held' | 'throttled' | 'no_bag_space';
}

// Apply-enchant-result surface (Professions 2.0): mirrors
// src/sim/professions/enchanting.ts ApplyEnchantResult. `null` until the first
// apply-enchant attempt of the session.
export interface ApplyEnchantResultView {
  ok: boolean;
  itemId: string;
  enchantId: string;
  reason?:
    | 'unknown_item'
    | 'unknown_enchant'
    | 'wrong_slot'
    | 'not_held'
    | 'insufficient_materials'
    | 'throttled'
    | 'no_bag_space'
    // #2415: the honest denies for an already-enchanted target: no
    // confirmReplace flag on the command, and the identical-enchant-id
    // re-apply whose accept would be pure reagent loss.
    | 'already_enchanted'
    | 'same_enchant';
}

// Commission order board (Professions 2.0, issue #1298): the viewer's own
// projection of one order, mirrored from src/sim/professions/commission_order.ts
// CommissionOrderRow. String-free per the seam rule aside from names (requester/
// crafter display names, exactly like MarketListingView's sellerName above).
export interface CommissionOrderView {
  id: number;
  requesterName: string;
  recipeId: string;
  itemId: string;
  scope: CommissionOrderScope;
  crafterName?: string;
  status: CommissionOrderStatus;
  acceptedByName?: string;
  /** The viewer is the requester who opened this order. */
  mine: boolean;
  /** The viewer is the crafter who accepted this order, or (while it is
   *  still open) the specific crafter a 'crafter'-scope order names. */
  mineToCraft: boolean;
}

// One gathering profession's slotted tool effect, as the HUD reads it.
//
// PER PROFESSION, NOT PER TOOL. The live harvest path resolves a tool TIER and
// never a tool (professions/wield_gate.ts bestWieldableGatherToolTierOrNone
// returns a number), so there is nothing on it holding the particular pick that satisfied
// the gate; and a slot bought for a tier-4 pick would go inert the moment its
// owner crafted the tier-5 one, which inverts the point of chasing a better
// tool. The consequence the UI must honor: a player owning two picks shares ONE
// mining slot, so this is a row per profession and never a list per item.
//
// Ids and numbers only, per the string-free seam rule: the effect's display
// name lives in the i18n catalog, keyed by `effectId`. `craftedBy` is
// deliberately NOT projected here; it exists on the sim-side slot only to
// decide the original-crafter recharge discount, and the HUD has no use for
// another player's identity. What the slot affordance DOES need (R48) is
// whether the crafter is the viewer, which crosses as the `selfCrafted`
// boolean below, carrying no identity at all.
export interface ToolEffectSlotView {
  /** A GatheringProfessionId. An identifier, never localized text. */
  professionId: string;
  /** A ToolEffectId (see src/sim/content/professions.ts TOOL_EFFECTS). */
  effectId: string;
  /** Charges left. 0 means slotted but spent: the bonus stops, the base tool
   *  is untouched, and a recharge can restore it. */
  charges: number;
  /** The slot's high-water ceiling and price-rung floor (R47): raised at
   *  mint, by a bigger recharge fill, and by the use-time ratchet; a
   *  recharge fills to the R30 re-derived maximum, bounded by this. */
  maxCharges: number;
  /** 'prompt' spends a charge only on an explicit per-use confirmation. */
  confirmMode: 'always' | 'prompt';
  /** Whether the slot's recorded crafter is the VIEWER, as a boolean (R48):
   *  the name itself is deliberately never projected (no other player's
   *  identity reaches the client), and the boolean is sufficient for exact
   *  affordance parity because the R48 directional no_gain arm only ever
   *  compares `craftedBy` against the slotter's own name. */
  selfCrafted: boolean;
}

// The professions read-surface facet (#1164, extended by #1121/#1127/#1129). `Sim`
// (src/sim/sim.ts `professionsState`/`professionsStateFor`) and `ClientWorld`
// (src/net/online.ts, mirrored from the `prof` wire delta) both implement
// this; see src/sim/professions/CLAUDE.md for the settled wire/persistence
// key names. `nodeHarvestableByMe` (#1121) is per-VIEWER, never global:
// whether the given gather node (see src/sim/content/gather_nodes.ts, #1120)
// is harvestable right now BY THE LOCAL VIEWER specifically. Two players
// asking about the same node id can get different answers, because each
// player's respawn timer for a node is independent (see
// src/sim/professions/gathering.ts). `recipeList`/`craftItem`/`lastCraftResult`
// (#1127) are the first crafting-action members: recipes exist as content, and
// a player can craft a common-tier recipe if they have required materials.
//
// `craftingIdentity` is the atomic craft-skill and attunement read surface used
// by both offline Sim and online ClientWorld; the scalar identity reads that
// once mirrored it member-by-member are retired in its favor. The two derived
// scalars below (`archetypeTitle`, `hobbyCraft`) remain: the character-window
// title rows consume them. Live transitions are authoritative quest completion
// effects rather than client commands.
export interface IWorldProfessions {
  professionsState: PlayerProfessionsView;
  /** Static station anchors for the active world, shared by map and renderer consumers. */
  readonly stationPlacements: readonly StationDef[];
  nodeHarvestableByMe(nodeId: string): boolean;
  /** Remaining seconds until `nodeId` respawns FOR THE LOCAL VIEWER, or null
   *  when it is harvestable now (or the id is unknown). The countdown read of
   *  the same per-viewer timer nodeHarvestableByMe gates on: for a KNOWN id,
   *  null exactly when that read answers true, so the tooltip's state line
   *  and its countdown can never disagree. The unknown-id arm is the one
   *  place the pair diverges offline (harvestableByMe answers false there
   *  while this read answers null), so readiness must never be inferred
   *  from a null countdown alone. Offline the Sim reads the live per-player
   *  timer (professions/gathering.ts nodeRespawnRemainingSec); online it
   *  reads the `ncd` mirror, whose entries are already remaining seconds. */
  nodeRespawnSeconds(nodeId: string): number | null;
  // `confirmEffectUse` (R40): the per-use consent for a 'prompt'-mode tool
  // effect slot on this harvest. A boolean flag ONLY (the craftItem
  // `commission` precedent): omitted or false sends a wire message
  // byte-identical to the pre-flow form and the effect simply does not fire
  // (no bonus, no charge; the harvest itself proceeds). The sim re-validates
  // everything server-side; an 'always' slot ignores the flag entirely.
  harvestNode(nodeId: string, confirmEffectUse?: boolean): WorldInteractionOutcome;
  recipeList: readonly RecipeDef[];
  lastCraftResult: CraftResultView | null;
  lastMasterwork: MasterworkView | null;
  // `commission` (Professions 2.0): the per-craft Maker's Bond
  // opt-in. A boolean flag ONLY (the standing wire invariant: no command
  // ingests a client-supplied ItemInstancePayload; the bindOnTrade arm and
  // the boundTo stamp are minted server-side). Honored solely for the
  // ruled-in equipment output kinds (src/sim/professions/commission.ts
  // isCommissionEligible); silently ignored otherwise. Omitted/false sends
  // a wire message byte-identical to the pre-phase form.
  craftItem(recipeId: string, commission?: boolean): void;
  craftingIdentity: CraftingIdentityView;
  // The title granted by the CURRENTLY-ACTIVE pair attunement (#1130, pair-named
  // under Professions 2.0): the CANONICAL PAIR ID (see
  // src/sim/professions/archetype.ts archetypePairId / ARCHETYPE_PAIR_TARGETS)
  // whose named archetype title the player has earned, or null before the
  // acceptance quest has ever been completed (no "Jack of All Trades" fallback
  // under the #1129 active-archetype model, since a character has at most one
  // active pair at a time). An identifier, not localized text, per the
  // string-free IWorld seam: the ten title names live in
  // src/ui/i18n.catalog/hud_chrome.ts (`archetypePair.<pairId>`).
  archetypeTitle: string | null;
  // The explicit hobby craft (#1294), empowered up to rare rather than common.
  // For an active pair it is one of the two crafts opposite its majors, and a
  // repeatable quest can switch that choice. `null` before attunement. An
  // identifier, with the same string-free-seam rule as `archetypeTitle`: the
  // craft display name lives in src/ui/i18n.catalog/hud_chrome.ts
  // (`craftName.<craftId>`, the per-craft display-name table).
  hobbyCraft: string | null;
  // Mobile crafting station (Professions 2.0, wiring the inert #1134
  // mechanic): place the viewer's own temporary station for `craftId`.
  // Specialization-gated server-side (mobile_station.ts
  // placeMobileCraftingStation); Sim validates and stores on PlayerMeta,
  // ClientWorld sends the place_mobile_station command.
  placeMobileStation(craftId: string): void;
  // Recipe training (Professions 2.0): learn `recipeId` from the
  // resident master at its craft's STATIC station (a mobile station never
  // satisfies training). Server-authoritative: Sim validates via
  // src/sim/professions/training.ts resolveTrain (already known, trainer
  // taught, station range, teach tier, fee), charges the tiered fee exactly
  // once on success, and emits the personal text-free `trainResult` event;
  // ClientWorld sends the train_recipe command and never decides the outcome.
  trainRecipe(recipeId: string): void;
  // The craft id of the viewer's own currently ACTIVE (placed, unexpired)
  // mobile station, or null. An identifier, string-free per the seam rule.
  // Offline this reads the live PlayerMeta slot (expiry checked against the
  // sim tick); online it mirrors the server's `mst` self-delta
  // (server/game.ts computes active-vs-expired against ITS tickCount, so the
  // client never predicts placement or reasons about tick domains). The slot
  // is transient either way: never serialized into the character save.
  activeMobileStationCraft: string | null;
  // Enchanting profession commands (Professions 2.0): disenchant a held
  // eligible weapon/armor piece into arcane materials, apply an enchant to a held
  // copy, or salvage a held piece into generic materials. `slotIndex`, when
  // present, requests the exact carried inventory slot the player clicked; the
  // sim re-validates that it still holds `itemId` before consuming it, so stale
  // UI can never destroy a different stack. Omitted, the legacy item-id
  // resolver remains in force. Server-authoritative: Sim re-validates
  // ownership/eligibility/throttle inside the resolvers
  // (src/sim/professions/enchanting.ts and salvage.ts) and nothing is trusted from
  // the client; ClientWorld sends the disenchant_item/apply_enchant/salvage_item
  // wire command and never decides the outcome.
  disenchantItem(itemId: string, target?: { slotIndex: number }): void;
  // `slot` targets the copy WORN in that equipment slot, enchanting it in place
  // (no unequip / enchant / re-equip round trip). Omitted, the enchant applies to
  // a bagged copy exactly as before. It is a SLOT and not an item id because
  // ring1/ring2 and mainhand/offhand can each wear an identical copy of one item
  // id, and only the slot says which the player aimed at. A REQUEST, never a
  // bypass: the server re-validates it against ALL_EQUIP_SLOTS and the sim then
  // re-validates what is actually worn there.
  // `confirmReplace` (#2415): the explicit consent that lets the apply REPLACE
  // an existing enchant (old one destroyed, no material refund) instead of
  // denying already_enchanted. A boolean flag ONLY, the craftItem `commission`
  // precedent: omitted/false sends a wire message byte-identical to the
  // pre-feature form, and the sim re-validates the target either way (the flag
  // can never overwrite anything the dedicated replace arm would not).
  applyEnchant(itemId: string, enchantId: string, slot?: EquipSlot, confirmReplace?: boolean): void;
  salvageItem(itemId: string): void;
  // Maker's Bond unbind service (Professions 2.0): clear the
  // boundTo lock on ONE held bound copy of `itemId`, for the tier-scaled
  // gold fee, while standing at any static crafting station (every station
  // master offers the service). Server-authoritative: Sim validates via
  // src/sim/professions/commission.ts resolveUnbind (eligible equipment
  // kind, a bound copy held, station range, fee) and charges exactly once
  // on success; ClientWorld sends the unbind_item command and never decides
  // the outcome. The result surfaces through the personal text-free
  // `unbindResult` event; the cleared payload converges via the self
  // inventory mirror.
  unbindItem(itemId: string): void;
  // Commission order board (Professions 2.0, issue #1298): a lightweight
  // job board layered on the Maker's Bond bind-on-trade primitive above.
  // Opening/cancelling carries NO escrow (see src/sim/professions/
  // commission_order.ts); accepting commits a crafter; delivering hands the
  // freshly commissioned, still-unbound copy straight to the requester face
  // to face (mail and the World Market already refuse an instanced payload,
  // so delivery is the one direct channel a commissioned piece can travel
  // through to its second owner). All four commands answer through the
  // personal, text-free `commissionOrderResult` event (the unbindResult
  // precedent): the client renders localized copy off action/reason, never
  // display text off the wire. `commissionOrders` is the viewer's own
  // projection (their own requests at any status, any order they accepted,
  // and the open board plus any order a 'crafter' scope names them for),
  // newest first, diffed every tick like `professionsState`.
  commissionOrders: readonly CommissionOrderView[];
  /** `scope: 'crafter'` requires `crafterName`, resolved the same way a
   *  whisper resolves a player name; `scope: 'open'` ignores it. */
  openCommissionOrder(recipeId: string, scope: CommissionOrderScope, crafterName?: string): void;
  cancelCommissionOrder(orderId: number): void;
  acceptCommissionOrder(orderId: number): void;
  deliverCommissionOrder(orderId: number): void;
  // The local viewer's most recent enchanting-action outcomes, mirrored from the
  // pid-scoped disenchantResult/enchantResult/salvageResult event and the
  // denc/ench/salv self-delta (both feed the same field: the event is the
  // immediacy arm, the delta the convergence arm). `null` before the first such
  // attempt this session.
  lastDisenchantResult: DisenchantResultView | null;
  lastEnchantResult: ApplyEnchantResultView | null;
  lastSalvageResult: SalvageResultView | null;
  // The viewer's slotted tool effects, one row per gathering profession that
  // has one, SORTED by professionId so the JSON form is a stable delta
  // signature (the knownRecipes precedent). EMPTY for a player who has never
  // slotted an effect: the backing PlayerMeta field is left ABSENT rather
  // than initialized, because an empty object still serializes and
  // initializing it moved every parity golden. Offline this reads the live
  // PlayerMeta slot; online it mirrors the server's `tslot` self-delta.
  toolEffectSlots: readonly ToolEffectSlotView[];
  // Slot `effectId` onto the viewer's `professionId` tool, at the charges that
  // profession's BEST OWNED tool's rarity mints (professions/tools.ts
  // startingDurabilityFor), CONSUMING one crafted charm copy of the effect
  // from the viewer's bags (the acquisition craft: the consumed copy's signer
  // becomes the slot's server-side craftedBy). Re-slotting consumes another
  // charm and resets to full, same as a fresh install. Server-authoritative:
  // the Sim re-validates the profession id, the effect id, that a real tool
  // for that profession is actually carried, and that a charm copy is held,
  // and nothing is trusted from the client; ClientWorld sends the
  // slot_tool_effect command and never decides the outcome (the pid-scoped
  // text-free toolEffectResult event reports it).
  //
  // `confirmMode` defaults to 'always' (#1136's behaviour) when omitted, so the
  // wire message for a caller that never touches it stays minimal. The union
  // re-widened to 'always' | 'prompt' with the R40 confirm flow: a 'prompt'
  // slot spends a charge only on an explicit per-use confirmation, carried by
  // `harvestNode`'s confirmEffectUse flag and honored end to end
  // (resolveSlotToolEffect accepts the mode, completeGatherCast threads the
  // consent, applyToolEffectUse gates the fire), so the seam now advertises
  // exactly what both worlds honor.
  slotToolEffect(professionId: string, effectId: string, confirmMode?: 'always' | 'prompt'): void;
  // Recharge the viewer's slotted effect on `professionId`, for the arcane
  // material of the recharge-time best tool's rarity rung at a count scaled
  // to the charges restored (R39), refilling to the maximum re-derived from
  // that same tool (R30). Owner-performed. Server-authoritative: the Sim
  // resolves price, fill, and every refusal off ITS OWN copy of the viewer's
  // bags and slot; ClientWorld sends the recharge_tool_effect command and
  // never decides the outcome (the same toolEffectResult event carries the
  // price paid, or the price required on an insufficient-materials refusal).
  // The professions window ALSO previews the price before the click (the UX
  // pass): the view runs this same resolver client-side over the mirrored
  // bags, so the previewed count and the charged count share one authority
  // in CODE; under snapshot lag the mirrored state can trail for a moment,
  // and the server still prices authoritatively (the toolEffectResult event
  // carries the price actually paid).
  rechargeToolEffect(professionId: string): void;
}
