// Pure derivation of the action-bar slot state (the hotbar row at #actionbar).
//
// This is the per-frame HOT core: hud.update() called it every frame, writing each
// slot's icon, cooldown overlay, dimming classes, item count, and the aria-label.
// The aria-label was the Top-risk-4 hazard: a raw setAttribute fired every frame per
// slot, allocating a fresh localized string and touching the DOM unconditionally.
//
// The core stays DOM-free and i18n-MECHANISM-free (no i18n RUNTIME import, only the
// TranslationKey / InterpolationValues types, which erase at build), yet it still
// produces the FINAL localized aria string by calling an INJECTED t() each frame, so
// the painter never concats and the i18n key keeps firing every frame (CLAUDE.md i18n
// + Top risk 4). The painter elides the actual DOM write.
//
// Component contract: the core is INSTANCE-PARAMETERIZED by a bar
// DESCRIPTOR (the slot set, each slot's ability/item source + keybind label, NO DOM
// and NO element refs). createActionBarView(descriptor, deps) preallocates the
// per-slot state array ONCE and returns a tick(world) that mutates it IN PLACE and
// returns the SAME references every call, so a correct frame allocates no new
// array/object garbage (the reused-reference allocation proxy). Two
// descriptors yield independent views, so desktop rows, the mobile ring, and
// consumables reuse the same derivation without a code fork.
//
// Parity: the world input is a structural subset of IWorld that BOTH
// the offline Sim and the online ClientWorld mirror expose (player.cooldowns is a
// Map, inventory is InvSlot[]); the core never reaches for a Sim-only field.

import { afflictionPossessionEmpowers } from '../../../sim/combat/affliction';
import { aetherDartsProcGlowActive } from '../../../sim/combat/chronomancy';
import { destructionProcGlowActive, ruinAmountFromAuras } from '../../../sim/combat/destruction';
import {
  freeCostAuraActive,
  nextCastCheapMultiplierFromAuras,
} from '../../../sim/combat/empower_next';
import { willAutoUnshift } from '../../../sim/combat/form_auto_unshift';
import { frostProcGlowActive } from '../../../sim/combat/frost_mage';
import { packlordActionGlowActive } from '../../../sim/combat/hunter_packlord';
import {
  dominionCompositionMaskForOwner,
  dominionSummonBlockFromMask,
  dominionTemplateForAbility,
  type OwnedDominionServant,
} from '../../../sim/combat/necromancy_dominion';
import { dawnsWrathHammerActive } from '../../../sim/combat/paladin_dawns_wrath';
import { radiantResonanceAbilityGlowActive } from '../../../sim/combat/paladin_radiant_resonance';
import {
  solarReprisalAbilityGlowActive,
  solarReprisalBypassesCooldown,
  solarReprisalMakesAbilityFree,
} from '../../../sim/combat/paladin_solar_reprisal';
import { sunVerdictAbilityGlowActive } from '../../../sim/combat/paladin_sun_verdict';
import { effectivePlayerAttackRange } from '../../../sim/combat/player_attack_reach';
import { priestActionGlowActive } from '../../../sim/combat/priest/presentation';
import { mendingCurrentTargetCapped } from '../../../sim/combat/shaman_spiritmend';
import { flowStateDiscountedCost } from '../../../sim/combat/shaman_talents';
import { thundercallPayoffGlowActive } from '../../../sim/combat/shaman_thundercall';
import { isAscensionEmpoweredAbility } from '../../../sim/paladin_devotion';
import {
  type AbilityDef,
  type AuraKind,
  dist2d,
  GCD,
  type ItemDef,
  POTION_COOLDOWN,
  type ResourceType,
  type Vec3,
} from '../../../sim/types';
import type { InterpolationValues, TranslationKey } from '../../i18n';

// The four slot kinds (a discriminated tag the painter maps to DOM classes).
export type ActionBarSlotKind = 'attack' | 'empty' | 'item' | 'ability';

// Icon-key identities. The core emits a stable key per slot so the painter can elide
// the (expensive) icon resolution + background-image write to slot-rebind frames
// only; the host's icon resolver parses these back to a kind + id. Kept here so the
// producer (core) and the consumer (host resolver) share one source of truth.
export const ATTACK_ICON_KEY = '__attack';
export const EMPTY_ICON_KEY = '';
export const ITEM_ICON_PREFIX = 'item:';
export const ABILITY_ICON_PREFIX = 'ability:';

// Cooldown overlay height is a percent 0..100; the sweep is clamped to 100 and the
// denominator is floored so a zero cooldown never divides by zero (byte-identical to
// the former inline `Math.min(100, (shown / Math.max(0.01, denom)) * 100)`).
const MAX_COOLDOWN_PERCENT = 100;
const COOLDOWN_DENOM_FLOOR = 0.01;
// The numeric countdown ("3", "2", "1") shows only while more than one second
// remains, matching the former `cd > 1 ? Math.ceil(cd) : ''`.
const COOLDOWN_TEXT_THRESHOLD = 1;
// The container gets the 'many-spells' class once more than this many slots are
// bound (the former `hotbarActions.filter(a => a !== null).length > 10`).
const MANY_SPELLS_THRESHOLD = 10;
const NEXT_CAST_FREE: AuraKind = 'next_cast_free';
const NEXT_EXECUTE_FREE: AuraKind = 'next_execute_free';
const NEXT_CAST_INSTANT: AuraKind = 'next_cast_instant';
const NEXT_CAST_CHEAP: AuraKind = 'next_cast_cheap';

// The i18n keys the core renders. They already exist in i18n.catalog/abilities.ts.
const SLOT_ARIA_KEY: TranslationKey = 'abilityUi.actionBar.slotAria';
const EMPTY_SLOT_ARIA_KEY: TranslationKey = 'abilityUi.actionBar.emptySlotAria';
const ATTACK_NAME_KEY: TranslationKey = 'abilityUi.actionBar.attackName';
const ASCENSION_SPENDER_ARIA_KEY: TranslationKey = 'hudChrome.paladin.ascensionSpenderAria';
const PROC_ARIA_KEY: TranslationKey = 'guide.glossary.procTerm';
const FATE_CONSUME_READY_ARIA_KEY: TranslationKey = 'hudChrome.warlock.fateThreadsConsumeReady';
const FATE_SENTENCE_READY_ARIA_KEY: TranslationKey = 'hudChrome.warlock.fateThreadsSentenceReady';

/** The ability fields the core reads. A structural subset of ResolvedAbility that
 *  both worlds expose (def + the talent-resolved cost). */
export interface ActionBarAbility {
  def: AbilityDef;
  cost: number;
  /** Talent-resolved stored uses (Double Charge); undefined = 1. */
  charges?: number;
  /** Extra stored uses on the abilityCharges recharge model (e.g. Frost's second
   *  Ice Block); total max = 1 + bonusCharges. undefined = 0. */
  bonusCharges?: number;
  /** Cooldown map key when a cooldown-carrying transform shares the base
   *  button's clock (Swiftmend/Overbloom); the sweep must read the same key
   *  the sim gate checks, or a running shared clock is invisible while the
   *  button is transformed. */
  cooldownId?: string;
  /** Talent-resolved drop of the def's stealth requirement (Cheap Trick on Gut
   *  Punch). Baked by applyTalentMods, so BOTH worlds carry it on `known`, and
   *  read by the sim's cast gate; the bar must read it too or the talent's one
   *  button paints unusable while the cast it refuses to advertise succeeds. */
  ignoreStealthRequirement?: boolean;
}

/** The aura fields the bar reads to derive proc glows and next-cast empowerment. */
export interface ActionBarAuraInput {
  id?: string;
  sourceId?: number;
  kind: AuraKind;
  value?: number;
  empowerAbilities?: readonly string[];
  /** Stacks, for a stack-gated ability (Glacial Spike needs 5 Icicles). */
  stacks?: number;
}

/** One slot of the bar descriptor: slot identity plus host-resolved accessors to the
 *  slot's current binding and keybind label. NO element refs (those live on the
 *  painter descriptor); NO per-frame allocation (the accessors return existing refs
 *  or null, never a fresh wrapper object). */
export interface ActionBarSlotDescriptor {
  /** 0-based slot index; slot 0 is the Attack toggle by default. */
  slotIndex: number;
  /** Whether the slot currently renders the fixed Attack toggle. An accessor (like
   *  ability()/item()) because the desktop bar's slot 0 can be switched to a normal
   *  assignable slot live via the "Show Attack Button" Interface option. */
  isAttack(): boolean;
  /** Whether the slot has ANY raw binding assigned (even one whose ability is
   *  unlearned or item id is unknown). The many-spells count source: kept distinct
   *  from ability()/item() so the count stays byte-identical to the former
   *  hotbarActions.filter(a => a !== null), which counted raw assignments. */
  hasAction(): boolean;
  /** The slot's current ability binding, or null. Host resolves from the layout. */
  ability(): ActionBarAbility | null;
  /** The slot's current item binding, or null. Host resolves from the layout. */
  item(): ItemDef | null;
  /** The slot's keybind label. Host resolves from the keybind map. */
  keybindLabel(): string;
  /** Whether this rendered slot owns the source slot of an active ground aim.
   *  Omitted for bar families that do not cast ground-targeted abilities. */
  ownsAimSlot?(activeAimSlot: number): boolean;
}

/** The bar descriptor: the slot set. The FAMILY parameter. */
export interface ActionBarDescriptor {
  slots: readonly ActionBarSlotDescriptor[];
  /** Optional inclusive max slot index for the container-level many-spells count. */
  manySpellsSlotMax?: number;
}

/** Injected localization helpers. The core builds the final aria string via t() so
 *  it produces localized text without importing the i18n module (testable with a t
 *  spy); names + the slot label are wrapped by the host. */
export interface ActionBarDeps {
  t(key: TranslationKey, values?: InterpolationValues): string;
  abilityName(def: AbilityDef): string;
  itemName(item: ItemDef): string;
  slotLabel(slotIndex: number): string;
  /** Localized integer formatter (the item stack count and cooldown digits go
   *  through this, per the "numbers go through formatNumber" invariant). */
  formatCount(n: number): string;
}

/** The player fields the bar reads; a structural subset both worlds mirror. */
export interface ActionBarPlayerInput {
  id: number;
  autoAttack: boolean;
  dead: boolean;
  resource: number;
  /** Which pool the live bar shows. A druid form swaps it to rage or energy and
   *  parks the real mana pool in savedMana, so it is what tells an in-form bar
   *  apart from an ordinary caster's. */
  resourceType: ResourceType | null;
  /** Mana set aside while shapeshifted (0 when unshifted). The pool an
   *  auto-unshifting cast is billed against; mirrored online as the self
   *  snapshot's sparse `sm` key. */
  savedMana: number;
  cooldowns: { get(id: string): number | undefined };
  gcdRemaining: number;
  /** Shared combat-potion cooldown, remaining seconds (0 when ready). Painted as a
   *  swipe on every potion item-slot, since all potions share this one timer. */
  potionCdRemaining: number;
  queuedOnSwing: string | null;
  pos: Vec3;
  /** The player's worn auras: the free-cost proc read (Battle Trance /
   *  next_cast_free) that drives the slot glow and usable state, the kill-window
   *  gate, and the next-cast empowerment read. Both worlds expose the live aura
   *  list. */
  /** Live charge state on the abilityCharges recharge model (Twinstrike, Double
   *  Charge, Frost's second Ice Block): the current count per ability id, plus
   *  the running recharge timer (the SOONEST per-charge timer, seconds left) and
   *  its full length, which drive the thin recharge sweep while the pool still
   *  holds a use. Optional: absent when no charge-limited ability has been cast
   *  yet; recharge/rechargeLength are 0 when the pool is full (and on an online
   *  mirror that has not yet received the `achr` timer wire). */
  abilityCharges?: {
    [id: string]: { charges: number; recharge?: number; rechargeLength?: number } | undefined;
  };
  /** The player's worn auras: the free-cost proc read (Battle Trance /
   *  next_cast_free) that drives the slot glow and usable state, the
   *  kill-window gate, and the next-cast empowerment read. Both worlds expose
   *  the live aura list. */
  auras: readonly ActionBarAuraInput[];
  paladinDevotion?: {
    value: number;
    ascensionCharges: number;
    ascensionRemaining: number;
  };
  paladinSpec?: string | null;
}

/** The target fields the bar reads; null when there is no current target. */
export interface ActionBarTargetInput {
  dead: boolean;
  kind: string;
  templateId: string;
  pos: Vec3;
  maxHp?: number;
  auras: readonly ActionBarAuraInput[];
}

/** The world subset one tick reads: the player, the current target, and inventory
 *  (the item-slot stack count source). */
export interface ActionBarWorldInput {
  player: ActionBarPlayerInput;
  target: ActionBarTargetInput | null;
  inventory: readonly { itemId: string; count: number }[];
  /** Aura-derived because the online player entity's local cache is not wired. */
  stealthed: boolean;
  /** Committed Paladin spec: the redesigned bar swaps a slot per spec. */
  paladinSpec?: string | null;
  /** Fate Threads attached to this Warlock's primary Evil Eye, 0 to 3. */
  fateThreads?: number;
  entities: Iterable<OwnedDominionServant>;
  /** Source action-bar slot that owns the active ground aim, or null. */
  activeAimSlot: number | null;
}

/** One slot's derived state. All fields are mutated IN PLACE each tick; the object
 *  reference is stable across ticks (no per-frame garbage). */
export interface ActionBarSlotState {
  kind: ActionBarSlotKind;
  abilityId: string | null;
  itemId: string | null;
  iconKey: string;
  cooldownRemaining: number;
  cooldownTotal: number;
  cooldownPercent: number;
  cdText: string;
  count: string;
  /** The count is a CHARGE count (stored uses left on a charge-pool ability),
   *  not an item stack count: the painter styles it distinctly so "2" reads as
   *  charges at a glance. */
  isCharges: boolean;
  /** The thin recharge sweep, 0..100: nonzero while a charge-pool ability has a
   *  spent charge regenerating, INCLUDING while the pool still holds a use (the
   *  full-strength cooldownPercent sweep only runs on an empty pool). Drains
   *  toward 0 as the soonest charge completes, like cooldownPercent. */
  rechargePercent: number;
  usable: boolean;
  outOfRange: boolean;
  queued: boolean;
  aiming: boolean;
  /** A free-cost proc (Battle Trance) covers this ability right now: the
   *  painter renders the classic gold proc glow. Actionable info, so it is
   *  NEVER shed by a graphics tier. */
  procGlow: boolean;
  empowered: boolean;
  /** This ability will consume one Ascension charge if used now. Kept
   *  separate from generic empowerment so the painter can show an explicit
   *  cost marker instead of relying on glow alone. */
  ascensionSpender: boolean;
  /** Localized visual cost used by the CSS badge through a data attribute. */
  ascensionCostLabel: string;
  fateConsumeReady: boolean;
  fateSentenceReady: boolean;
  ariaLabel: string;
  ariaDescription: string;
  keybindLabel: string;
}

/** The whole bar's derived state: the reused slot array plus the container-level
 *  many-spells flag. Both the object and the array are reused across ticks. */
export interface ActionBarState {
  slots: ActionBarSlotState[];
  manySpells: boolean;
}

export interface ActionBarView {
  /** Derive this frame's state, mutating the reused array in place. */
  tick(world: ActionBarWorldInput): ActionBarState;
}

/** A blank slot state. Exported so another bar family can hold a fallback cell
 *  for a position its layout does not fill. */
export function makeSlotState(): ActionBarSlotState {
  return {
    kind: 'empty',
    abilityId: null,
    itemId: null,
    iconKey: EMPTY_ICON_KEY,
    cooldownRemaining: 0,
    cooldownTotal: 0,
    cooldownPercent: 0,
    cdText: '',
    count: '',
    isCharges: false,
    rechargePercent: 0,
    usable: true,
    outOfRange: false,
    queued: false,
    aiming: false,
    procGlow: false,
    empowered: false,
    ascensionSpender: false,
    ascensionCostLabel: '',
    fateConsumeReady: false,
    fateSentenceReady: false,
    ariaLabel: '',
    ariaDescription: '',
    keybindLabel: '',
  };
}

export function isNextCastEmpowerKind(kind: AuraKind): boolean {
  return (
    kind === NEXT_CAST_FREE ||
    kind === NEXT_EXECUTE_FREE ||
    kind === NEXT_CAST_INSTANT ||
    kind === NEXT_CAST_CHEAP
  );
}

function empowermentScopeMatches(aura: ActionBarAuraInput, abilityId: string): boolean {
  if (!aura.empowerAbilities) return true;
  return aura.empowerAbilities.includes(abilityId);
}

function auraCanEmpowerAbility(aura: ActionBarAuraInput, ability: ActionBarAbility): boolean {
  if (!isNextCastEmpowerKind(aura.kind)) return false;
  if (!empowermentScopeMatches(aura, ability.def.id)) return false;
  if (aura.kind === NEXT_CAST_INSTANT) {
    return ability.def.castTime > 0 && ability.def.school !== 'physical' && !ability.def.channel;
  }
  return ability.cost > 0;
}

function hasEmpoweringAura(
  auras: readonly ActionBarAuraInput[] | undefined,
  ability: ActionBarAbility,
): boolean {
  if (!auras) return false;
  for (const aura of auras) {
    if (auraCanEmpowerAbility(aura, ability)) return true;
  }
  return false;
}

function hasForbiddenReflection(
  auras: readonly ActionBarAuraInput[] | undefined,
  abilityId: string,
): boolean {
  if (!auras) return false;
  for (const aura of auras) {
    if (aura.kind === 'internal_cd' && aura.empowerAbilities?.includes(abilityId)) {
      return true;
    }
  }
  return false;
}

export function actionBarCooldownRemaining(
  player: Pick<ActionBarPlayerInput, 'auras' | 'cooldowns'>,
  ability: ActionBarAbility,
  bypassesCooldown = dawnsWrathHammerActive(player, ability.def.id) ||
    hasForbiddenReflection(player.auras, ability.def.id) ||
    solarReprisalBypassesCooldown(player, ability.def.id),
): number {
  const abilityId = ability.def.id;
  if (bypassesCooldown) return 0;
  return player.cooldowns.get(ability.cooldownId ?? abilityId) ?? 0;
}

/** How many of `itemId` the player is carrying, summed across stacks. Exported
 *  because the consumables seat needs the same number for its tooltip's in-bags
 *  line, off the same snapshot the bar state is built from. */
export function inventoryCount(
  inventory: readonly { itemId: string; count: number }[],
  itemId: string,
): number {
  // A for-loop, not reduce: no per-frame closure allocation on the hot path.
  let total = 0;
  for (const slot of inventory) {
    if (slot.itemId === itemId) total += slot.count;
  }
  return total;
}

/**
 * Build an action-bar view bound to one descriptor. The per-slot state array is
 * preallocated once here; tick() mutates it in place and returns the SAME references
 * every call. Each createActionBarView yields an INDEPENDENT view: a
 * second descriptor never shares this instance's array.
 */
export function createActionBarView(
  descriptor: ActionBarDescriptor,
  deps: ActionBarDeps,
): ActionBarView {
  const slots: ActionBarSlotState[] = descriptor.slots.map(() => makeSlotState());
  const state: ActionBarState = { slots, manySpells: false };

  return {
    tick(world: ActionBarWorldInput): ActionBarState {
      const { player, target } = world;
      const tgtDist = target !== null && !target.dead ? dist2d(player.pos, target.pos) : null;
      const ruin = ruinAmountFromAuras(player.auras);
      let dominionComposition: number | null = null;
      let soulFragments = 0;
      for (const aura of player.auras) {
        if (aura.kind === 'soul_fragments') {
          soulFragments = aura.stacks ?? 1;
          break;
        }
      }
      let boundCount = 0;
      let aimingSlotIndex = -1;
      if (world.activeAimSlot !== null) {
        for (let i = 0; i < descriptor.slots.length; i++) {
          const sd = descriptor.slots[i];
          if (sd.ownsAimSlot?.(world.activeAimSlot) === true) {
            aimingSlotIndex = i;
            break;
          }
        }
      }

      for (let i = 0; i < descriptor.slots.length; i++) {
        const sd = descriptor.slots[i];
        const slot = slots[i];
        const slotLabel = deps.slotLabel(sd.slotIndex);
        slot.aiming = i === aimingSlotIndex;

        // many-spells counts RAW assigned slots (the attack slot reports no action),
        // byte-identical to the former hotbarActions.filter(a => a !== null).length.
        if (
          sd.hasAction() &&
          (descriptor.manySpellsSlotMax === undefined ||
            sd.slotIndex <= descriptor.manySpellsSlotMax)
        ) {
          boundCount++;
        }

        if (sd.isAttack()) {
          slot.kind = 'attack';
          slot.abilityId = null;
          slot.itemId = null;
          slot.iconKey = ATTACK_ICON_KEY;
          slot.cooldownRemaining = 0;
          slot.cooldownTotal = 0;
          slot.cooldownPercent = 0;
          slot.cdText = '';
          slot.count = '';
          slot.isCharges = false;
          slot.rechargePercent = 0;
          slot.usable = true;
          slot.outOfRange =
            tgtDist !== null && target !== null && tgtDist > effectivePlayerAttackRange(target, 0);
          slot.queued = player.autoAttack;
          slot.procGlow = false;
          slot.empowered = false;
          slot.ascensionSpender = false;
          slot.ascensionCostLabel = '';
          slot.fateConsumeReady = false;
          slot.fateSentenceReady = false;
          slot.ariaLabel = deps.t(SLOT_ARIA_KEY, {
            slot: slotLabel,
            ability: deps.t(ATTACK_NAME_KEY),
          });
          slot.ariaDescription = '';
          slot.keybindLabel = sd.keybindLabel();
          continue;
        }

        const item = sd.item();
        const ability = sd.ability();

        if (ability === null && item === null) {
          slot.kind = 'empty';
          slot.abilityId = null;
          slot.itemId = null;
          slot.iconKey = EMPTY_ICON_KEY;
          slot.cooldownRemaining = 0;
          slot.cooldownTotal = 0;
          slot.cooldownPercent = 0;
          slot.cdText = '';
          slot.count = '';
          slot.isCharges = false;
          slot.rechargePercent = 0;
          slot.usable = true;
          slot.outOfRange = false;
          slot.queued = false;
          slot.procGlow = false;
          slot.empowered = false;
          slot.ascensionSpender = false;
          slot.ascensionCostLabel = '';
          slot.fateConsumeReady = false;
          slot.fateSentenceReady = false;
          slot.ariaLabel = deps.t(EMPTY_SLOT_ARIA_KEY, { slot: slotLabel });
          slot.ariaDescription = '';
          slot.keybindLabel = sd.keybindLabel();
          continue;
        }

        if (item !== null) {
          const count = inventoryCount(world.inventory, item.id);
          // Potions share one global cooldown, so any potion slot paints the same
          // swipe; other items have no cooldown.
          const potionCd = item.kind === 'potion' ? player.potionCdRemaining : 0;
          slot.kind = 'item';
          slot.abilityId = null;
          slot.itemId = item.id;
          slot.iconKey = `${ITEM_ICON_PREFIX}${item.id}`;
          slot.cooldownRemaining = potionCd;
          slot.cooldownTotal = potionCd > 0 ? POTION_COOLDOWN : 0;
          slot.cooldownPercent =
            potionCd > 0
              ? Math.min(
                  MAX_COOLDOWN_PERCENT,
                  (potionCd / Math.max(COOLDOWN_DENOM_FLOOR, POTION_COOLDOWN)) *
                    MAX_COOLDOWN_PERCENT,
                )
              : 0;
          slot.cdText =
            potionCd > COOLDOWN_TEXT_THRESHOLD ? deps.formatCount(Math.ceil(potionCd)) : '';
          slot.count = deps.formatCount(count);
          slot.isCharges = false;
          slot.rechargePercent = 0;
          slot.usable = !(count <= 0 || player.dead);
          slot.outOfRange = false;
          slot.queued = false;
          slot.procGlow = false;
          slot.empowered = false;
          slot.ascensionSpender = false;
          slot.ascensionCostLabel = '';
          slot.fateConsumeReady = false;
          slot.fateSentenceReady = false;
          slot.ariaLabel = deps.t(SLOT_ARIA_KEY, {
            slot: slotLabel,
            ability: deps.itemName(item),
          });
          slot.ariaDescription = '';
          slot.keybindLabel = sd.keybindLabel();
          continue;
        }

        // ability (the only remaining kind: item was null, so ability is non-null;
        // this guard mirrors the former `if (!known) continue` and narrows the type).
        if (ability === null) continue;
        const def = ability.def;
        const dawnsWrathActive = dawnsWrathHammerActive(player, def.id);
        const solarReprisalActive = solarReprisalAbilityGlowActive(player, def.id);
        const reflectionReady = hasForbiddenReflection(player.auras, def.id);
        const cd = actionBarCooldownRemaining(
          player,
          ability,
          dawnsWrathActive || reflectionReady || solarReprisalBypassesCooldown(player, def.id),
        );
        const gcdActive = !def.offGcd && player.gcdRemaining > 0;
        const shown = Math.max(cd, gcdActive ? player.gcdRemaining : 0);
        const denom = cd > 0 ? def.cooldown : GCD;
        slot.kind = 'ability';
        slot.abilityId = def.id;
        slot.itemId = null;
        slot.iconKey = `${ABILITY_ICON_PREFIX}${def.id}`;
        slot.cooldownRemaining = cd;
        slot.cooldownTotal = denom;
        slot.cooldownPercent =
          shown > 0
            ? Math.min(
                MAX_COOLDOWN_PERCENT,
                (shown / Math.max(COOLDOWN_DENOM_FLOOR, denom)) * MAX_COOLDOWN_PERCENT,
              )
            : 0;
        slot.cdText = cd > COOLDOWN_TEXT_THRESHOLD ? deps.formatCount(Math.ceil(cd)) : '';
        // Charge-limited (the abilityCharges recharge model: Twinstrike, Double
        // Charge, Frost's second Ice Block): the running cooldown is only the
        // empty-pool RECHARGE timer; the badge shows the stored uses left and
        // the slot stays usable while any remain. The resolved max is
        // 1 + bonusCharges (ability.charges mirrors it for authored maxCharges);
        // the live count comes from player.abilityCharges, full until the first
        // spend creates the pool.
        const maxCharges = Math.max(1 + (ability.bonusCharges ?? 0), ability.charges ?? 1);
        const chargeState = maxCharges > 1 ? player.abilityCharges?.[def.id] : undefined;
        const chargesLeft = maxCharges > 1 ? (chargeState?.charges ?? maxCharges) : cd > 0 ? 0 : 1;
        slot.count = maxCharges > 1 ? deps.formatCount(chargesLeft) : '';
        slot.isCharges = maxCharges > 1;
        // The thin recharge sweep: whenever a spent charge is regenerating, even
        // while a use is still stored (the empty-pool case ALSO runs the normal
        // full sweep via the cooldowns mirror; the strip stays for continuity).
        // recharge is the soonest per-charge timer; 0 = pool full. An online
        // mirror without the achr timer wire zero-fills these and shows no strip.
        const recharge = chargeState?.recharge ?? 0;
        const rechargeLength = chargeState?.rechargeLength ?? 0;
        slot.rechargePercent =
          chargesLeft < maxCharges && recharge > 0 && rechargeLength > 0
            ? Math.min(
                MAX_COOLDOWN_PERCENT,
                (recharge / Math.max(COOLDOWN_DENOM_FLOOR, rechargeLength)) * MAX_COOLDOWN_PERCENT,
              )
            : 0;
        // A free-cost proc (Battle Trance / next_cast_free) covers the cost:
        // the slot is usable at any resource and glows (the sim predicate is
        // imported so bar and combat can never disagree on the proc's scope).
        const freeByProc = ability.cost > 0 && freeCostAuraActive(player.auras, def.id);
        const displayedCost = flowStateDiscountedCost(player.auras, ability.cost);
        const flowStateReady = displayedCost < ability.cost;
        const tidecallTargetCapped =
          def.id === 'tidecall' && mendingCurrentTargetCapped(player.id, target);
        const freeBySolarReprisal = solarReprisalMakesAbilityFree(player, def.id);
        const cheapCostMultiplier = nextCastCheapMultiplierFromAuras(player.auras, def.id);
        // Same fold order as the sim's cost resolution (casting_lifecycle): the
        // empower-cheap multiplier applies to the authored cost first, then the
        // shaman Flow State discount shapes the result. Composing them here (not
        // picking one) is what keeps the bar and combat from disagreeing about
        // whether a slot is affordable.
        const payableCost = flowStateDiscountedCost(
          player.auras,
          cheapCostMultiplier === null ? ability.cost : ability.cost * cheapCostMultiplier,
        );
        // A kill-window ability (Victory Rush): usable only while its enabling
        // aura is worn, and it glows while the window is open.
        let windowOpen = true;
        let windowGlow = false;
        if (def.requiresAuraKind) {
          windowOpen = false;
          for (const a of player.auras) {
            if (
              a.kind === def.requiresAuraKind &&
              (a.stacks ?? 1) >= (def.requiresAuraStacks ?? 1)
            ) {
              windowOpen = true;
              break;
            }
          }
          windowGlow = windowOpen;
        }
        const ascensionReady =
          def.id !== 'divine_ascension' ||
          ((player.paladinDevotion?.value ?? 0) >= 20 &&
            (player.paladinDevotion?.ascensionCharges ?? 0) <= 0);
        const devotionReady =
          def.devotionCost === undefined ||
          (player.paladinDevotion?.value ?? 0) >= def.devotionCost;
        const requiresPrimaryEye =
          def.id === 'sentence' ||
          def.id === 'coven' ||
          def.id === 'possess_evil_eye' ||
          def.id === 'hour_of_judgment';
        const primaryEyeReady =
          !requiresPrimaryEye ||
          target?.auras.some(
            (aura) => aura.sourceId === player.id && aura.kind === 'affliction_eye',
          ) === true;
        const dominionTemplateId = dominionTemplateForAbility(def.id);
        let dominionReady = true;
        if (dominionTemplateId !== null) {
          if (dominionComposition === null) {
            dominionComposition = dominionCompositionMaskForOwner(world.entities, player.id);
          }
          dominionReady =
            dominionSummonBlockFromMask(dominionComposition, dominionTemplateId) === null;
        }
        // A druid pressing a heal or a nuke from Bruin/Wolf Form leaves the form
        // and casts it, and the cast is billed against the PARKED mana pool, not
        // the rage or energy bar the button is pressed from (the same predicate
        // the sim's cast gate asks, so the bar cannot paint a slot unusable while
        // the cast it refuses to advertise succeeds). Fleet Form never swapped the
        // bar, so its pool is already the live one.
        const castingPool =
          player.resourceType !== 'mana' && willAutoUnshift(player.auras, def)
            ? player.savedMana
            : player.resource;
        slot.usable =
          (!(castingPool < payableCost) || freeByProc || freeBySolarReprisal) &&
          (def.ruinCost ?? 0) <= ruin &&
          soulFragments >= (def.soulFragmentCost ?? 0) &&
          ascensionReady &&
          devotionReady &&
          windowOpen &&
          primaryEyeReady &&
          dominionReady &&
          !(maxCharges > 1 && chargesLeft <= 0) &&
          (!def.requiresStealth || world.stealthed || ability.ignoreStealthRequirement === true);
        slot.outOfRange =
          def.requiresTarget &&
          tgtDist !== null &&
          target !== null &&
          (tgtDist > effectivePlayerAttackRange(target, def.range) ||
            (def.minRange !== undefined && tgtDist < def.minRange));
        slot.queued = player.queuedOnSwing === def.id;
        // Spec resources/procs share pure sim predicates so the bar and combat
        // agree: Frost lights Ice Lance on a banked Fingers of Frost and Flurry
        // on an armed Brain Freeze (combat/frost_mage.ts), while a full
        // Chronomancy charge bank lights Aether Darts as the actionable spender
        // (combat/chronomancy.ts).
        const divineAscensionActive =
          (player.paladinDevotion?.ascensionCharges ?? 0) > 0 &&
          (player.paladinDevotion?.ascensionRemaining ?? 0) > 0;
        const ascensionEmpowered =
          divineAscensionActive && isAscensionEmpoweredAbility(player.paladinSpec ?? null, def.id);
        // Radiant Chorus's proc: Mending Light turns instant and Dawn's Embrace
        // halves its cost, so both light up while Radiant Resonance is worn.
        const radiantResonanceActive = radiantResonanceAbilityGlowActive(player, def.id);
        slot.procGlow =
          reflectionReady ||
          freeByProc ||
          dawnsWrathActive ||
          solarReprisalActive ||
          radiantResonanceActive ||
          windowGlow ||
          frostProcGlowActive(player.auras ?? [], def.id) ||
          aetherDartsProcGlowActive(player.auras ?? [], def.id) ||
          destructionProcGlowActive(player.auras ?? [], def.id) ||
          packlordActionGlowActive(player.auras ?? [], def.id) ||
          thundercallPayoffGlowActive(player.auras ?? [], def.id) ||
          flowStateReady ||
          priestActionGlowActive(player.auras ?? [], def.id) ||
          sunVerdictAbilityGlowActive(target?.auras, player.id, def.id) ||
          (def.id === 'divine_ascension' && ascensionReady);
        slot.empowered =
          reflectionReady ||
          hasEmpoweringAura(player.auras, ability) ||
          afflictionPossessionEmpowers(player.auras, def.id) ||
          tidecallTargetCapped ||
          dawnsWrathActive ||
          solarReprisalActive ||
          radiantResonanceActive ||
          ascensionEmpowered;
        slot.ascensionSpender = ascensionEmpowered;
        slot.ascensionCostLabel = ascensionEmpowered ? deps.formatCount(-1) : '';
        const fateThreadsReady = (world.fateThreads ?? 0) >= 3;
        slot.fateConsumeReady = fateThreadsReady && def.id === 'drain_life';
        slot.fateSentenceReady = fateThreadsReady && def.id === 'sentence';
        // The Ascension spender label replaces the plain slot aria-label, so the
        // key is chosen here rather than assigned twice.
        const ariaKey = ascensionEmpowered ? ASCENSION_SPENDER_ARIA_KEY : SLOT_ARIA_KEY;
        slot.ariaLabel = deps.t(ariaKey, { slot: slotLabel, ability: deps.abilityName(def) });
        slot.ariaDescription = slot.fateConsumeReady
          ? deps.t(FATE_CONSUME_READY_ARIA_KEY)
          : slot.fateSentenceReady
            ? deps.t(FATE_SENTENCE_READY_ARIA_KEY)
            : slot.procGlow
              ? deps.t(PROC_ARIA_KEY)
              : '';
        slot.keybindLabel = sd.keybindLabel();
      }

      state.manySpells = boundCount > MANY_SPELLS_THRESHOLD;
      return state;
    },
  };
}
