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
// descriptors yield two independent views, so a second/third bar is another
// descriptor, not a code fork (the second/third bar itself is a follow-on feature).
//
// Parity: the world input is a structural subset of IWorld that BOTH
// the offline Sim and the online ClientWorld mirror expose (player.cooldowns is a
// Map, inventory is InvSlot[]); the core never reaches for a Sim-only field.

import { type AbilityDef, dist2d, GCD, type ItemDef, MELEE_RANGE, type Vec3 } from '../sim/types';
import type { InterpolationValues, TranslationKey } from './i18n';

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

// The i18n keys the core renders. They already exist in i18n.catalog/abilities.ts.
const SLOT_ARIA_KEY: TranslationKey = 'abilityUi.actionBar.slotAria';
const EMPTY_SLOT_ARIA_KEY: TranslationKey = 'abilityUi.actionBar.emptySlotAria';
const ATTACK_NAME_KEY: TranslationKey = 'abilityUi.actionBar.attackName';

/** The ability fields the core reads. A structural subset of ResolvedAbility that
 *  both worlds expose (def + the talent-resolved cost). */
export interface ActionBarAbility {
  def: AbilityDef;
  cost: number;
}

/** One slot of the bar descriptor: slot identity plus host-resolved accessors to the
 *  slot's current binding and keybind label. NO element refs (those live on the
 *  painter descriptor); NO per-frame allocation (the accessors return existing refs
 *  or null, never a fresh wrapper object). */
export interface ActionBarSlotDescriptor {
  /** 0-based slot index; slot 0 is the fixed Attack toggle. */
  slotIndex: number;
  /** Whether this is the fixed attack slot (slot 0). */
  isAttack: boolean;
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
  autoAttack: boolean;
  dead: boolean;
  resource: number;
  cooldowns: { get(id: string): number | undefined };
  gcdRemaining: number;
  queuedOnSwing: string | null;
  pos: Vec3;
}

/** The target fields the bar reads; null when there is no current target. */
export interface ActionBarTargetInput {
  dead: boolean;
  pos: Vec3;
}

/** The world subset one tick reads: the player, the current target, and inventory
 *  (the item-slot stack count source). */
export interface ActionBarWorldInput {
  player: ActionBarPlayerInput;
  target: ActionBarTargetInput | null;
  inventory: readonly { itemId: string; count: number }[];
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
  usable: boolean;
  outOfRange: boolean;
  queued: boolean;
  ariaLabel: string;
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

function makeSlotState(): ActionBarSlotState {
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
    usable: true,
    outOfRange: false,
    queued: false,
    ariaLabel: '',
    keybindLabel: '',
  };
}

function inventoryCount(
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
      let boundCount = 0;

      for (let i = 0; i < descriptor.slots.length; i++) {
        const sd = descriptor.slots[i];
        const slot = slots[i];
        const slotLabel = deps.slotLabel(sd.slotIndex);

        // many-spells counts RAW assigned slots (the attack slot reports no action),
        // byte-identical to the former hotbarActions.filter(a => a !== null).length.
        if (
          sd.hasAction() &&
          (descriptor.manySpellsSlotMax === undefined ||
            sd.slotIndex <= descriptor.manySpellsSlotMax)
        ) {
          boundCount++;
        }

        if (sd.isAttack) {
          slot.kind = 'attack';
          slot.abilityId = null;
          slot.itemId = null;
          slot.iconKey = ATTACK_ICON_KEY;
          slot.cooldownRemaining = 0;
          slot.cooldownTotal = 0;
          slot.cooldownPercent = 0;
          slot.cdText = '';
          slot.count = '';
          slot.usable = true;
          slot.outOfRange = tgtDist !== null && tgtDist > MELEE_RANGE;
          slot.queued = player.autoAttack;
          slot.ariaLabel = deps.t(SLOT_ARIA_KEY, {
            slot: slotLabel,
            ability: deps.t(ATTACK_NAME_KEY),
          });
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
          slot.usable = true;
          slot.outOfRange = false;
          slot.queued = false;
          slot.ariaLabel = deps.t(EMPTY_SLOT_ARIA_KEY, { slot: slotLabel });
          slot.keybindLabel = sd.keybindLabel();
          continue;
        }

        if (item !== null) {
          const count = inventoryCount(world.inventory, item.id);
          slot.kind = 'item';
          slot.abilityId = null;
          slot.itemId = item.id;
          slot.iconKey = `${ITEM_ICON_PREFIX}${item.id}`;
          slot.cooldownRemaining = 0;
          slot.cooldownTotal = 0;
          slot.cooldownPercent = 0;
          slot.cdText = '';
          slot.count = deps.formatCount(count);
          slot.usable = !(count <= 0 || player.dead);
          slot.outOfRange = false;
          slot.queued = false;
          slot.ariaLabel = deps.t(SLOT_ARIA_KEY, {
            slot: slotLabel,
            ability: deps.itemName(item),
          });
          slot.keybindLabel = sd.keybindLabel();
          continue;
        }

        // ability (the only remaining kind: item was null, so ability is non-null;
        // this guard mirrors the former `if (!known) continue` and narrows the type).
        if (ability === null) continue;
        const def = ability.def;
        const cd = player.cooldowns.get(def.id) ?? 0;
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
        slot.count = '';
        slot.usable = !(player.resource < ability.cost);
        slot.outOfRange =
          def.requiresTarget &&
          tgtDist !== null &&
          tgtDist > (def.range > 0 ? def.range : MELEE_RANGE);
        slot.queued = player.queuedOnSwing === def.id;
        slot.ariaLabel = deps.t(SLOT_ARIA_KEY, {
          slot: slotLabel,
          ability: deps.abilityName(def),
        });
        slot.keybindLabel = sd.keybindLabel();
      }

      state.manySpells = boundCount > MANY_SPELLS_THRESHOLD;
      return state;
    },
  };
}
