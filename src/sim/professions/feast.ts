// The shared feast (Phase 12, D16): the communal payoff, in TWO rungs since
// masterwrought Phase 11k (the tier-4 party feast at cooking 100 and the three
// apex role feasts at 125). A placed feast is a REAL world entity (kind
// 'object', carrying the templateId its own item def names, the
// battleground-flag precedent) riding the normal interest-scoped entity
// snapshot, so no new wire mechanism exists anywhere in this feature. The
// server owns every outcome: charges, the per-player consumed ledger, and
// the tick-domain expiry all live here and are re-validated on every command.
//
// WHAT 11k CHANGED, and it is a widening rather than a framework. This module
// used to name ONE item id and ONE templateId as constants, and every count,
// selection, spend and dish lookup read them. That is what made 11i's
// capstone feast dead content: it was a valid item def with a valid recipe
// that no code could place and no client could label. Now the ACTION takes
// the item id it is placing, the FeastState carries the dish that item names,
// and the placeable family is derived from the catalog. No new command, no new
// wire field, no new interaction surface, no rng draw.
//
// DRAW CONTRACT: placement and consumption draw ZERO rng (no Rng access in
// this module at all). Placement is a bag spend plus an entity spawn;
// consumption is a ledger write plus the SAME eating slot a bagged dish
// sets (built by the one src/sim/consuming.ts builder, so the bite carries
// the dish's wellFed payload exactly as the bagged dish does). The
// completion mint (updateRegen clearing the slot, then src/sim/wellfed.ts
// paying the carried payload) owns no draw either. The expiry sweep decides
// from stored state alone. Nothing here can fork the shared draw stream.
//
// TRANSIENT BY DESIGN: FeastState lives only in SimContext.feasts and dies
// with the Sim instance. No field of it enters PlayerMeta, CharacterState,
// any save blob, or any database write, and the entity itself is pruned from
// client mirrors by snapshot absence. Rationale: a feast is a mobile social
// station, not property. Its expiry is tick-domain (not wall-clock), so it
// is deliberately NOT restart-safe: a server restart clears every live
// feast exactly like it clears every live ground object, and re-anchoring
// tick deadlines across a restart would demand the serialization this
// design forbids.
//
// ANTI-ABUSE RULE (decided this phase): ONE ACTIVE FEAST PER PLACER. A
// placement while the owner's previous feast still stands is refused
// (farmDenied reason 'feast_active'). Chosen over a placement cooldown
// because it needs no per-player timestamp that outlives the feast, bounds
// the live entity count at one per player, and involves no clock at all.
// The charge count and expiry below are maintainer-flagged tuning.
//
// THE LEDGER KEY: eatenBy holds the rename-proof, DOMAIN-TAGGED owner key
// ('character:<id>' online, 'entity:<id>' offline; the durableMemberKey idiom
// in instances/dungeons.ts), never the bare entity id, per the
// interact_object_credit stable-key lesson: entity ids are session artifacts.
// The tag is what keeps the two numeric domains disjoint: the untagged
// characterId ?? entityId form put both in one namespace, so a characterId
// that happened to equal another session's entity id merged two players'
// ledger and one-active identities. The set is bounded by the feast's own
// charge count and dropped wholesale at despawn, so it inherits none of the
// persistence machinery the credited-objects ledger needs.
//
// THE RESERVED 'feast_range' REASON (masterwrought Phase 18 decision, recorded
// here): since the existence-oracle guard in consumeFeastAction folded the
// out-of-range refusal into the not-found frame ('feast_expired'), NOTHING
// EMITS farmDenied 'feast_range' today. The reason stays in the wire union and
// its hudChrome.farming.denied.feast_range key stays in the catalog and the
// overlays as a RESERVED, currently-unemitted reason: the key's footprint is
// six translated rows plus fifteen pending ones (only five overlay files
// carry it), and retiring it is the release fill lane's call, not this
// unit's. The QA twin re-judges it at the release fill.

import { buildConsuming } from '../consuming';
import { CRAFT_RING } from '../content/professions';
import { ITEMS } from '../data';
import { delveRunForPlayer } from '../delves/runs';
import { createGroundObject } from '../entity';
import { instanceAt } from '../instances/dungeons';
import { consumeSelectedInventorySlot, selectedInventorySlot } from '../item_copy_ref';
import { countUnlockedInSlots, isItemLocked, removeUnlockedFromSlots } from '../item_lock';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE, isConsuming, isNonSpellCast } from '../types';

/** The PARTY-tier placeable feast (content/profession_items.ts) and the
 *  templateId its placed entity carries. It is the default of the dedicated
 *  `place_feast` command, which carries no item id, so these two constants
 *  stay: a bare place_feast places THIS feast and can never place another
 *  (pinned in tests/professions_feast.test.ts). */
export const FARM_FEAST_ITEM_ID = 'harvest_feast';
export const FARM_FEAST_TEMPLATE_ID = 'farm_feast';

/** THE PLACEABLE FEAST FAMILY, derived from the catalog and never hand-listed
 *  (masterwrought Phase 11k). A feast is any item def carrying `feast`, and its
 *  payload names the templateId its placed entity wears, so authoring one def
 *  joins the DERIVED SET at every site that keys on it. That is the whole point:
 *  before this, ONE item id and ONE templateId were module constants and five
 *  sites compared against them, which is exactly how Phase 11i shipped a second
 *  feast that no code could place and no client could label.
 *
 *  WHAT AUTHORING A DEF DOES NOT DO, stated here rather than as a footnote,
 *  because "joins every site at once" is the over-reading this comment has to
 *  refuse: the two TITLE composers reach the family through
 *  src/ui/hud/professions/feast_title.ts, whose templateId-to-key map is HAND-LISTED (a t() key
 *  built by template literal is invisible to every static consumer, which this
 *  packet has paid for twice). A new def joins the derived set everywhere and
 *  leaves that map short, so the placed entity falls through to the raw placer
 *  name. It is caught rather than trusted: tests/entity_display_name.test.ts
 *  pins the map exhaustively in BOTH directions against feastTemplateIds().
 *
 *  FIVE SITES KEY ON A TEMPLATE ID and none of them names a string literal any
 *  more: src/ui/entity_display_name.ts and src/render/entity_labels.ts (the two
 *  title composers, through the leaf above), src/render/nameplate_view.ts (the
 *  interact hysteresis band), src/render/farm_patches.ts (the applyFeasts
 *  filter; the shadow-cap sweep beside it iterates the ALREADY-filtered map and
 *  compares no template), and src/game/feast_interact.ts. The contract comment
 *  in src/render/quest_objects.ts is a sixth reader but not a keyed site. */
const FEAST_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  Object.values(ITEMS).flatMap((def) =>
    'feast' in def && def.feast ? [def.feast.templateId] : [],
  ),
);

/** Is this entity templateId a placed feast of ANY tier? The one membership
 *  question the render, ui and game sites ask. Null-and-undefined tolerant
 *  because Entity.templateId is optional on the wire. */
export function isFeastTemplateId(templateId: string | null | undefined): boolean {
  return typeof templateId === 'string' && FEAST_TEMPLATE_IDS.has(templateId);
}

/** Every placed-feast templateId, for the display-name lookup that maps each
 *  to its own title key. Sorted so a reader and a test see a stable order. */
export function feastTemplateIds(): string[] {
  return [...FEAST_TEMPLATE_IDS].sort();
}

/** The ONE visited-mark key behind prog_field_to_feast (masterwrought Phase
 *  11k). A fixed literal rather than a per-feast key: the deed asks whether a
 *  player has cooked an apex feast at all, and the three rungs are the same act
 *  with a different plate on it. Its namespace is registered in
 *  src/sim/deeds.ts (an unregistered one is dropped on load). */
export const APEX_FEAST_CRAFT_MARK = 'apex_feast:crafted';

/** Is this recipe an APEX feast bill, the capstone rung rather than the party
 *  one? Derived from the CONTENT on both axes so a fourth feast joins with no
 *  edit: the output must carry a `feast` payload, and the bill must sit at its
 *  craft's own cap. The party feast is cooking 100 against cooking's cap of
 *  125, so it is correctly outside; a hypothetical feast authored above a cap
 *  would be unlearnable anyway (the unlearnable-at-150 finding). */
export function isApexFeastRecipe(recipe: {
  professionId: string;
  resultItemId: string;
  skillReq: number;
}): boolean {
  const def = ITEMS[recipe.resultItemId];
  if (!def || !('feast' in def) || !def.feast) return false;
  // A find over CRAFT_RING rather than craftById/craftMaxSkillFor, which THROW
  // on an unknown id: this runs on the craft-credit arm of every successful
  // craft, and a content typo should refuse the deed mark, never throw inside a
  // live craft. CRAFT_RING is the same authority those accessors resolve
  // through, so there is one source for the cap either way.
  const craft = CRAFT_RING.find((c) => c.id === recipe.professionId);
  return craft !== undefined && recipe.skillReq >= craft.maxSkill;
}

/** One live placed feast. Keyed in SimContext.feasts by its entity id. */
export interface FeastState {
  entityId: number;
  /** The placer's rename-proof, domain-tagged owner key (feastOwnerKey). */
  ownerKey: string;
  /** Servings left. Decremented at bite START (the dish precedent: the
   *  spend lands at use; an interrupted meal forfeits the buff, never
   *  refunds the serving). Despawn on 0 rides the 1 Hz sweep below. */
  charges: number;
  /** Tick-domain deadline (ctx.tickCount base). Sub-second staleness
   *  between expiry and the 1 Hz sweep answers 'feast_expired'. */
  expiresAtTick: number;
  /** The dish each bite IS, copied from the PLACED item's own feast payload
   *  at placement (masterwrought Phase 11k). Carried on the state rather than
   *  re-read from a module constant at the bite, because the bite has no
   *  memory of which feast item was spent: without it every feast serves the
   *  party feast's dish and an apex feast mints the wrong aura. This field is
   *  transient like the rest of FeastState (no save blob, no PlayerMeta, no
   *  wire field), so it is sim-local and adds no cross-platform surface. */
  dishItemId: string;
  /** The per-player consumed ledger: one bite per player per feast. */
  eatenBy: Set<string>;
}

/** The rename-proof player key the ledger and the anti-abuse rule share.
 *  Domain-tagged (see THE LEDGER KEY in the header): the server's stable
 *  character id when present, the session entity id for offline and
 *  sim-only hosts, each under its own prefix so the two numeric domains
 *  can never collide at the same number. `== null` on purpose, the null
 *  tolerance the untagged `??` form had: a typed host never writes null,
 *  but an untyped one must not key 'character:null'. */
export function feastOwnerKey(meta: PlayerMeta): string {
  return meta.characterId == null ? `entity:${meta.entityId}` : `character:${meta.characterId}`;
}

/** Set out a feast at the caller's feet, spending one feast item from bags.
 *  Gate order mirrors plantCrop: the family's shared ctx.error
 *  sentences for dead/busy (deviation (bq): no new wire enum arm for a
 *  state every command family refuses the same way), then text-free
 *  id-carrying farmDenied reasons for everything feast-specific.
 *
 *  `slotIndex` is the per-copy selection (item_copy_ref.ts): a use_item
 *  press NAMES the bag slot it came from and that copy is honored exactly,
 *  the consumeOneUnit thread every sibling use arm runs. Absent (the
 *  dedicated place_feast command carries no slot), the id-only lock-aware
 *  walk below stays byte-for-byte what it was.
 *
 *  `itemId` is the feast being placed (masterwrought Phase 11k). It DEFAULTS
 *  to the party feast, which is what keeps the dedicated `place_feast`
 *  command's meaning exactly what it was: that command carries no item id, so
 *  a bare place_feast still places a harvest_feast and can never place an apex
 *  feast. The apex feasts reach the ground through use_item, which already
 *  carries the clicked slot, so the clicked copy is the one spent. This is a
 *  WIDENING of one authored action from one id to the catalog's feast family:
 *  no new wire arm, no new command, no new interaction surface, and no rng
 *  draw (this module still draws zero). */
export function placeFeastAction(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  slotIndex?: number,
  itemId: string = FARM_FEAST_ITEM_ID,
): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  // Water refuses PLACEMENT too (the QA gate's find): without this, the
  // spend destroys the item and spawns a feast nobody can ever eat (the
  // bite's own swimming gate), holding the one-active slot for the full
  // 180s. Combat placement stays deliberately LEGAL, asymmetric with the
  // bite: combat ends and the feast remains fully usable after it (the
  // raid-table flavor), where a water placement never becomes usable.
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  const ownerKey = feastOwnerKey(meta);
  for (const feast of ctx.feasts.values()) {
    if (feast.ownerKey === ownerKey) {
      ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_active' });
      return;
    }
  }
  const def = ITEMS[itemId];
  const info = def && 'feast' in def ? def.feast : undefined;
  // NOT a feast item at all: the refusal, never a fall-through to the party
  // feast. A caller naming a non-feast id is a bug in the caller, and placing
  // something else would spend the wrong item (the exact 11i failure mode).
  if (!info) return; // content invariant; pinned in the suite
  // The named-copy resolve (tri-state, item_copy_ref.ts): a slot holds the
  // selection, `null` is an invalid selection (refuse: the family's not-held
  // answer), `undefined` means no selection was given (the id-only path).
  // useItem already validated the selection before routing here; the
  // re-resolve is this arm's OWN refusal so a direct caller can never fall
  // through to a silent guess.
  const selected = selectedInventorySlot(meta.inventory, itemId, slotIndex);
  if (selected === null) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'no_feast' });
    return;
  }
  if (selected) {
    // A NAMED locked copy denies as locked even when an unlocked spare
    // exists: spending a different copy than the one the player clicked is
    // exactly the id-only guess per-copy addressing exists to remove.
    if (isItemLocked(selected.instance)) {
      ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'locked' });
      return;
    }
  } else if (countUnlockedInSlots(meta.inventory, itemId) < 1) {
    // Lock-aware spend split (deviation (ao), the crafting.ts idiom): a raw
    // count the owner locked is invisible to the sufficiency gate, and when
    // only a lock caused the shortfall the toast says so.
    const reason = ctx.countItem(itemId, meta.entityId) >= 1 ? 'locked' : 'no_feast';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason });
    return;
  }
  // The SPEND. Named copy: exactly the validated slot (its unlocked state
  // was just proven above). Id-only: the lock-aware walk, NOT ctx.removeItem
  // (the inventory hub's lock-blind walk takes the highest bag index first,
  // any slot a victim, so a locked end-slot copy would be spent while the
  // gate had counted only the unlocked one; same walk the seed spend uses in
  // plantCrop, locked slots are never victims). Both mutate the slot array
  // only, so the quest hook fires once here (place_feast stays a
  // HEAVY_SELF_CMDS member for the self snapshot).
  if (selected) {
    // Branch on the tri-state as item_copy_ref.ts demands. Nothing mutates
    // the inventory between the resolve above and this consume today, so a
    // failed take is defensive only: refuse rather than spawn a FREE feast
    // (item duplication) if a future gate insertion breaks that invariant.
    if (!consumeSelectedInventorySlot(meta.inventory, itemId, slotIndex)) {
      ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'no_feast' });
      return;
    }
  } else {
    removeUnlockedFromSlots(meta.inventory, itemId, 1);
  }
  ctx.onInventoryChangedForQuests?.(meta);
  // The entity, the battleground-flag shape: a ground object with a custom
  // templateId, no pickup item, not lootable. `name` carries the PLACER'S
  // raw name as a VALUE; the client composes the localized
  // "{name}'s Harvest Feast" title off the templateId (i18n: the text is
  // the key, the name is a param, never sim-side English).
  const e = createGroundObject(ctx.nextId++, '', meta.name, { ...p.pos });
  e.templateId = info.templateId;
  e.objectItemId = null;
  e.lootable = false;
  // The object-respawn sweep in sim.ts's entity loop treats EVERY
  // lootable-false object as a cooling pickup (respawnTimer -= DT, re-arm
  // at zero), which re-armed the feast one second after placement and
  // handed the interact press to the generic object arm (found by the
  // player-path probe). Infinity is the precedented never-re-arm sentinel
  // (handleDeath's run-scoped mobs, dismissed pets): Infinity - DT stays
  // Infinity, so the sweep can never flip lootable back on, and no timer
  // arithmetic stays silently coupled to the 1 Hz sweep period (the prior
  // finite dodge, durationTicks + 20 ticks, had a worst-case margin of
  // exactly ONE tick over the despawn below, measured by the QA round).
  // respawnTimer never rides the wire; `loot` is the only lootability
  // wire field, and it stays false for the feast's whole life (pinned).
  e.respawnTimer = Infinity;
  ctx.addEntity(e);
  // Inside a claimed dungeon instance the feast joins the run's teardown
  // roster: freeInstance drops every registered objectId when the reaper
  // frees the empty claim, and the 1 Hz sweep's entities.has leg below then
  // reclaims the state and the placer's one-active slot (the inverse
  // cleanup's designed job). Without this the entity outlived the run and
  // stood at the slot origin, still edible, for the next claiming party.
  const inst = instanceAt(ctx, e.pos);
  if (inst && inst.partyKey !== null) inst.objectIds.push(e.id);
  // The SAME rule for a delve run (its own spatial system with its own
  // roster): freeDelveRun AND the module advance both drop run.objectIds,
  // so the table dies with the room it was set out in, and the abandoned
  // -module drop is deliberate (that room despawns wholesale). Located by
  // the PLACER (delveRunForPlayer), never the entity: the run lookup binds
  // players and mobs only, and the placer stands in the run when placing.
  const run = delveRunForPlayer(ctx, meta.entityId);
  if (run) run.objectIds.push(e.id);
  ctx.feasts.set(e.id, {
    entityId: e.id,
    ownerKey,
    charges: info.charges,
    expiresAtTick: ctx.tickCount + info.durationTicks,
    dishItemId: info.dishItemId,
    eatenBy: new Set(),
  });
  ctx.emit({ type: 'farmFeastPlaced', pid: meta.entityId, feastId: e.id });
}

/** Eat from the placed feast `feastId` (an entity id): once per player per
 *  feast. The bite spends a serving at START and sets the SAME eating slot
 *  a bagged tier-4 dish sets (Consuming pointed at the dish item), so the
 *  18s sit-restore, the interruption-forfeit rules, and the Well Fed mint
 *  at completion are the Phase 11 machinery (the gate SET mirrors the
 *  items.ts food arm; the ORDER follows plantCrop's family order, so a
 *  dead mid-cast player hears the dead line first here), zero draws
 *  (consume-slot chosen over instant-mint: it keeps one mint site and the
 *  classic eat ritual; the decision record lives in state.md). */
export function consumeFeastAction(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  feastId: number,
): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  // THE EXISTENCE-ORACLE GUARD: a feast id the player cannot legitimately
  // see (nonexistent, orphaned, OR simply beyond INTERACT_RANGE) answers ONE
  // merged refusal, the not-found reason, from ONE emit site, so a prober
  // sweeping ids learns nothing about which far-away feasts exist, are
  // drained, or were already eaten from. Every feast-specific reason below
  // (the tick-domain expiry, feast_finished, feast_eaten) therefore answers
  // only INSIDE reach, where the feast is visible anyway. Nothing emits the
  // 'feast_range' reason any more (it stays RESERVED in the union and the
  // catalog; the header's decision record says why); the client's own
  // proximity gate (src/game/feast_interact.ts) is what real players see. All
  // three arms are draw-free and emit the identical frame shape (the extra
  // dist2d on the existing-feast arm is arithmetic, not an observable).
  const feast = ctx.feasts.get(feastId);
  const entity = ctx.entities.get(feastId);
  if (!feast || !entity || dist2d(p.pos, entity.pos) > INTERACT_RANGE) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_expired' });
    return;
  }
  if (ctx.tickCount >= feast.expiresAtTick) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_expired' });
    return;
  }
  if (feast.charges < 1) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_finished' });
    return;
  }
  if (feast.eatenBy.has(feastOwnerKey(meta))) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_eaten' });
    return;
  }
  // The eating family's own gates, mirrored from the items.ts food arm so a
  // feast bite refuses exactly where a bagged dish does: a running non-spell
  // cast (fishing/gather/farming) blocks the bite with the family's one busy
  // sentence, while a SPELL cast deliberately does not (the items.ts rule:
  // the Demon Heal channel keeps items usable, and item use carries no GCD
  // gate to mirror), then combat, water, and the occupied eating slot.
  if (isNonSpellCast(p.castingAbility)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  if (p.eating !== null) {
    ctx.error(meta.entityId, 'You are already eating.');
    return;
  }
  // The dish comes off the FEAST STATE, which copied it from the item that
  // was actually placed. Reading a module constant here is what made the
  // capstone feast serve the party feast's plate (masterwrought Phase 11k).
  const dish = ITEMS[feast.dishItemId];
  if (!dish) return; // content invariant; pinned in the suite
  feast.eatenBy.add(feastOwnerKey(meta));
  feast.charges -= 1;
  // The bite: one serving of the capstone dish, built by the SAME
  // src/sim/consuming.ts builder the items.ts food arm uses (sit, slot, the
  // sfx-only first bite, the log line), so the meal carries the dish's
  // wellFed payload and a feast serving mints the identical aura a bagged
  // dish does when the 18s drain completes. The bite has always served the
  // dish as FOOD by contract, so the kind is passed literally.
  p.sitting = true;
  p.eating = buildConsuming('food', dish);
  ctx.emit({ type: 'heal', targetId: p.id, amount: 0, source: 'food', sfxTick: true });
  ctx.emit({ type: 'log', text: 'You sit down to eat.', color: '#999', pid: meta.entityId });
}

/** The despawn check: zero charges or expiry. Rides INSIDE updateFarming's
 *  existing 1 Hz sweep (never a second appended sim.ts sweep), decides from
 *  stored state alone, draws zero rng, and allocates nothing while no feast
 *  stands (the overwhelmingly common tick). The entities.has leg is the
 *  inverse cleanup: no other despawn path exists today, but if anything ever
 *  drops the entity out from under the state, the sweep reclaims the state
 *  (and the placer's one-active slot) instead of stranding both for 180s. */
export function updateFarmFeasts(ctx: SimContext): void {
  if (ctx.feasts.size === 0) return;
  for (const [id, feast] of ctx.feasts) {
    if (feast.charges > 0 && ctx.tickCount < feast.expiresAtTick && ctx.entities.has(id)) continue;
    ctx.feasts.delete(id);
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
}
