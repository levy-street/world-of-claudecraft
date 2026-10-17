// Pure view model for the enemy cooldown row on a hostile player's nameplate:
// which tracked cooldowns (src/sim/major_cooldowns.ts) the entity is showing,
// whether each is ACTIVE (its buff is up right now) or recharging, in what order,
// and how tall the row the painter inserts above the name is. DOM/Three/i18n-free
// so it unit-tests without a WebGL context (RENDER_PURE_CORES,
// tests/architecture.test.ts), the contract nameplate_dots_core.ts follows.
//
// Two inputs, both already on the entity in either world:
//   - its cooldown map: the offline Sim fills it for its bots, and the online
//     ClientWorld mirrors a peer's tracked deadlines into it
//     (src/net/peer_major_cooldown_wire.ts). A running entry is "spent".
//   - its auras: a tracked buff's aura carries the bare ability id that applied
//     it, whoever cast it. So a buff an ally cast on this entity (a priest's
//     Martyr's Aegis) shows HERE while it lasts, and its cooldown shows on the
//     caster's own plate.
//
// Order: medallion, then defensives, then offensives; inside a group, the key
// ascending. Never re-sorted by time, and an ability keeps its slot when it goes
// from active to recharging, so the row never shuffles under the player's eye.
// No icon cap: every tracked cooldown in play shows, and the row grows wider.
//
// Allocation-light: nameplateCooldownsInto writes into a caller-owned plan whose
// slot records are reused, the nameplateDotsInto idiom.

import {
  MAJOR_COOLDOWN_GROUP_ORDER,
  type MajorCooldownGroup,
  majorCooldownBaseSec,
  majorCooldownGroup,
  majorCooldownKeyForAura,
} from '../sim/major_cooldowns';
import {
  NAMEPLATE_DOT_GAP,
  NAMEPLATE_DOT_SIZE,
  NAMEPLATE_DOT_TIMER_STEP,
} from './nameplate_dots_core';

/** Icon edge, gap and countdown step: the dot row's own metrics, so the two rows
 *  read as one family on the plate. Plate units (the base plate is 80 wide). */
export const NAMEPLATE_COOLDOWN_SIZE = NAMEPLATE_DOT_SIZE;
export const NAMEPLATE_COOLDOWN_GAP = NAMEPLATE_DOT_GAP;
/** The extra breath between two groups (medallion | defensive | offensive). */
export const NAMEPLATE_COOLDOWN_GROUP_GAP = 3;
export const NAMEPLATE_COOLDOWN_TIMER_STEP = NAMEPLATE_DOT_TIMER_STEP;
/** Breath between the row and the name row under it. */
export const NAMEPLATE_COOLDOWN_ROW_PAD = 3;

/** Under this many seconds the countdown gains a decimal (the dot row's rule). */
export const NAMEPLATE_COOLDOWN_DECIMAL_BELOW_SEC = 10;
/** At or above this many seconds the countdown reads in whole minutes. */
export const NAMEPLATE_COOLDOWN_MINUTES_FROM_SEC = 60;

/** The size slider's bounds, the dot row's: clamped here so a corrupt stored
 *  value can never paint a row across the screen. */
export const NAMEPLATE_COOLDOWN_SCALE_MIN = 1;
export const NAMEPLATE_COOLDOWN_SCALE_MAX = 3;

export function clampNameplateCooldownScale(scale: number): number {
  if (!Number.isFinite(scale)) return NAMEPLATE_COOLDOWN_SCALE_MIN;
  return Math.min(NAMEPLATE_COOLDOWN_SCALE_MAX, Math.max(NAMEPLATE_COOLDOWN_SCALE_MIN, scale));
}

/** The aura fields this core reads: a structural subset of the sim `Aura`. */
export interface NameplateCooldownAura {
  id: string;
  remaining: number;
}

/** How the countdown reads: whole minutes, whole seconds, or one decimal. */
export type NameplateCooldownTimeUnit = 'minutes' | 'seconds' | 'tenths';

/** One resolved icon slot.
 *
 *  The first six fields are written by nameplateCooldownsInto; the last three
 *  only by the painter, on its own cadence (the NameplateDotSlot contract). */
export interface NameplateCooldownSlot {
  /** The cooldown key or aura id: an ability id, or the medallion's trinket key. */
  key: string;
  group: MajorCooldownGroup;
  /** The buff is up right now: glow, full colour, the number is the buff time. */
  active: boolean;
  /** Recharging: the part of the cooldown still to run, 0..1, for the dark
   *  swipe. 0 while active (no swipe). */
  fraction: number;
  /** Seconds the number counts: the buff's while active, the cooldown's after. */
  remaining: number;
  unit: NameplateCooldownTimeUnit;
  /** PAINTER-WRITTEN: artwork resolved from `key`, '' while unresolved. */
  iconUrl: string;
  /** PAINTER-WRITTEN: the localized countdown, '' while unresolved. */
  timeText: string;
  /** PAINTER-WRITTEN: the quantized value `timeText` was formatted from (with
   *  the unit folded in), NaN while unresolved. */
  timeValue: number;
}

export interface NameplateCooldownsPlan {
  slots: NameplateCooldownSlot[];
  count: number;
  /** PAINTER-WRITTEN: the clamped size the row draws at. */
  scale: number;
}

export function newNameplateCooldownsPlan(): NameplateCooldownsPlan {
  return { slots: [], count: 0, scale: NAMEPLATE_COOLDOWN_SCALE_MIN };
}

function newSlot(): NameplateCooldownSlot {
  return {
    key: '',
    group: 'defensive',
    active: false,
    fraction: 0,
    remaining: 0,
    unit: 'seconds',
    iconUrl: '',
    timeText: '',
    timeValue: Number.NaN,
  };
}

export function nameplateCooldownTimeUnit(remaining: number): NameplateCooldownTimeUnit {
  if (remaining >= NAMEPLATE_COOLDOWN_MINUTES_FROM_SEC) return 'minutes';
  return remaining < NAMEPLATE_COOLDOWN_DECIMAL_BELOW_SEC ? 'tenths' : 'seconds';
}

/** The number the countdown shows at its unit: minutes and seconds round UP (a
 *  cooldown with 61 sec left is not back in one minute), tenths to nearest. */
export function nameplateCooldownQuantized(
  remaining: number,
  unit: NameplateCooldownTimeUnit,
): number {
  if (unit === 'minutes') return Math.ceil(remaining / 60);
  if (unit === 'seconds') return Math.ceil(remaining);
  return Math.round(remaining * 10) / 10;
}

function slotAt(out: NameplateCooldownsPlan, index: number, key: string): NameplateCooldownSlot {
  let slot = out.slots[index];
  if (!slot) {
    slot = newSlot();
    out.slots[index] = slot;
  }
  // A recycled slot that now shows a different key must re-resolve its art.
  if (slot.key !== key) {
    slot.key = key;
    slot.iconUrl = '';
    slot.timeText = '';
    slot.timeValue = Number.NaN;
  }
  return slot;
}

function findSlot(out: NameplateCooldownsPlan, key: string): NameplateCooldownSlot | null {
  for (let i = 0; i < out.count; i++) if (out.slots[i].key === key) return out.slots[i];
  return null;
}

function slotOrder(a: NameplateCooldownSlot, b: NameplateCooldownSlot): number {
  const byGroup = MAJOR_COOLDOWN_GROUP_ORDER[a.group] - MAJOR_COOLDOWN_GROUP_ORDER[b.group];
  if (byGroup !== 0) return byGroup;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Fill `out` with one entity's tracked cooldowns and return it. Active buffs are
 * read from `auras` (any caster); recharging cooldowns from `cooldowns`. When
 * both name the same key, the active state wins: the buff is what a player must
 * react to, and its cooldown takes the slot over once it falls off.
 */
export function nameplateCooldownsInto(
  out: NameplateCooldownsPlan,
  cooldowns: ReadonlyMap<string, number>,
  auras: readonly NameplateCooldownAura[],
): NameplateCooldownsPlan {
  out.count = 0;
  for (const aura of auras) {
    if (!(aura.remaining > 0)) continue;
    // The aura's id names its ability directly or through a companion form
    // (majorCooldownKeyForAura), so the slot is keyed by the cooldown it belongs to.
    const key = majorCooldownKeyForAura(aura.id);
    const group = key === null ? null : majorCooldownGroup(key);
    if (key === null || group === null) continue;
    const existing = findSlot(out, key);
    if (existing) {
      // Two casters' copies of one buff: count the longer.
      if (aura.remaining > existing.remaining) {
        existing.remaining = aura.remaining;
        existing.unit = nameplateCooldownTimeUnit(aura.remaining);
      }
      continue;
    }
    const slot = slotAt(out, out.count++, key);
    slot.group = group;
    slot.active = true;
    slot.fraction = 0;
    slot.remaining = aura.remaining;
    slot.unit = nameplateCooldownTimeUnit(aura.remaining);
  }
  for (const [key, remaining] of cooldowns) {
    if (!(remaining > 0)) continue;
    const group = majorCooldownGroup(key);
    if (group === null || findSlot(out, key)) continue;
    const slot = slotAt(out, out.count++, key);
    slot.group = group;
    slot.active = false;
    const base = majorCooldownBaseSec(key);
    slot.fraction = base > 0 ? Math.min(1, remaining / base) : 1;
    slot.remaining = remaining;
    slot.unit = nameplateCooldownTimeUnit(remaining);
  }
  // Insertion sort over the filled prefix: a handful of slots, no allocation.
  const slots = out.slots;
  for (let i = 1; i < out.count; i++) {
    const slot = slots[i];
    let j = i - 1;
    while (j >= 0 && slotOrder(slots[j], slot) > 0) {
      slots[j + 1] = slots[j];
      j--;
    }
    slots[j + 1] = slot;
  }
  return out;
}

/** The row's width at `scale`, group gaps included, in plate units. */
export function nameplateCooldownRowWidth(plan: NameplateCooldownsPlan, scale: number): number {
  if (plan.count <= 0) return 0;
  const s = clampNameplateCooldownScale(scale);
  let width = plan.count * NAMEPLATE_COOLDOWN_SIZE + (plan.count - 1) * NAMEPLATE_COOLDOWN_GAP;
  for (let i = 1; i < plan.count; i++) {
    if (plan.slots[i].group !== plan.slots[i - 1].group) width += NAMEPLATE_COOLDOWN_GROUP_GAP;
  }
  return width * s;
}

/** Vertical space the row takes above the name row; 0 when there is no row. */
export function nameplateCooldownRowHeight(plan: NameplateCooldownsPlan): number {
  if (plan.count <= 0) return 0;
  const s = clampNameplateCooldownScale(plan.scale);
  return (NAMEPLATE_COOLDOWN_SIZE + NAMEPLATE_COOLDOWN_TIMER_STEP + NAMEPLATE_COOLDOWN_ROW_PAD) * s;
}
