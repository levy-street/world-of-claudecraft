// Pure view model for the player's own dot icons on an enemy nameplate: which of
// an entity's auras qualify, in what order, and how tall the row the painter
// inserts is. DOM/Three/i18n-free so it unit-tests without a WebGL context
// (RENDER_PURE_CORES, tests/architecture.test.ts), the same contract
// nameplate_view.ts and cast_bar.ts already follow.
//
// CLASS-AGNOSTIC BY CONSTRUCTION. An aura qualifies on ownership plus harm: the
// host's isOwn predicate (the local player cast it) AND isDebuffAura
// (src/sim/aura_classify.ts, the classifier every aura surface shares). No
// ability list, no class branch, so every class's dots, bleeds, poisons and
// curses land here on one path.
//
// Allocation-light: nameplateDotsInto writes into a caller-owned plan whose slot
// records are reused, so the painter keeps ONE plan for the whole frame and the
// hot path mints nothing (the nameplatePlanInto / speedStreaksInto idiom).

import { isDebuffAura } from '../sim/aura_classify';
import type { AuraKind } from '../sim/types';

/** Icons the row will draw at most. At 100% four 13px icons plus their gaps are
 *  58 units wide against an 80-unit base plate, so the row still reads as part
 *  of the plate; a fifth overflows it. The SIZE SLIDER deliberately breaks that
 *  containment (58 units becomes 174 at 300%), which is the player's choice to
 *  make: past 100% the row is wider than the plate and is meant to be. The
 *  target frame strip remains the complete list either way. */
export const NAMEPLATE_DOT_CAP = 4;

/** Icon edge and inter-icon gap, in plate units (the canvas surface's own
 *  coordinate space, where the base plate is 80 wide and its health bar 4 tall). */
export const NAMEPLATE_DOT_SIZE = 13;
export const NAMEPLATE_DOT_GAP = 2;
/** Space under the icons for the countdown text, and the breath between the row
 *  and the name row above it. */
export const NAMEPLATE_DOT_TIMER_STEP = 7;
export const NAMEPLATE_DOT_ROW_PAD = 3;

/** Under this many seconds the countdown gains a decimal, the precision a
 *  refresh actually needs; above it, whole seconds. */
export const NAMEPLATE_DOT_DECIMAL_BELOW_SEC = 10;

/** The nameplateDotScale slider's bounds. 100% is the plate-native size the row
 *  shipped at; 300% is as large as the row can grow before four icons are wider
 *  than a boss plate and the row stops reading as part of it. Clamped HERE, not
 *  at the setting, so a hand-edited or corrupt stored value can never paint a
 *  row across the screen. */
export const NAMEPLATE_DOT_SCALE_MIN = 1;
export const NAMEPLATE_DOT_SCALE_MAX = 3;

/** The stored slider value, clamped and made finite. A non-number reads as the
 *  minimum rather than as "off": the row's visibility is the setting's job. */
export function clampNameplateDotScale(scale: number): number {
  if (!Number.isFinite(scale)) return NAMEPLATE_DOT_SCALE_MIN;
  return Math.min(NAMEPLATE_DOT_SCALE_MAX, Math.max(NAMEPLATE_DOT_SCALE_MIN, scale));
}

/** The aura fields this core reads: a structural subset of the sim `Aura` that
 *  both worlds mirror. */
export interface NameplateDotAura {
  id: string;
  kind: AuraKind;
  value: number;
  remaining: number;
  duration?: number;
  permanent?: boolean;
  school?: string;
  /** The caster, for the host's isOwn predicate. Optional because an older
   *  server's mirror omits it; a missing caster is never "own". */
  sourceId?: number;
}

/** One resolved icon slot.
 *
 *  The first five fields are written by nameplateDotsInto. The last two are
 *  written ONLY by the painter, on the same cadence it resolves the rest of the
 *  plate's artwork and text (the `guildLabel` precedent in nameplate_canvas.ts):
 *  keeping them on the slot is what lets the draw path stay allocation-free,
 *  and this core never reads them, so it stays icon-runtime- and i18n-free. */
export interface NameplateDotSlot {
  iconKey: string;
  school: string;
  /** Fraction of the full duration still to run, 0..1, for the cooldown swipe. */
  fraction: number;
  remaining: number;
  /** The aura's full duration, so the row can share isAuraExpiring with the aura
   *  strips instead of inventing a flat threshold. 0 for a permanent aura, which
   *  that rule reads as never expiring. */
  duration: number;
  decimals: 0 | 1;
  /** PAINTER-WRITTEN: artwork resolved from `iconKey`, '' while unresolved. */
  iconUrl: string;
  /** PAINTER-WRITTEN: the localized countdown, '' while unresolved. */
  timeText: string;
  /** PAINTER-WRITTEN: the quantized remaining value `timeText` was formatted
   *  from, so the painter can skip re-formatting a number that has not moved at
   *  the precision it draws. NaN while unresolved. */
  timeValue: number;
}

/** Slots plus the count actually filled. Owned and reused by the painter. */
export interface NameplateDotsPlan {
  slots: NameplateDotSlot[];
  count: number;
  /** PAINTER-WRITTEN: the clamped nameplateDotScale, the one multiplier both
   *  draw walks and the row's own drawing read, so the plate's height and its
   *  icons can never disagree about how big the row is. */
  scale: number;
}

export function newNameplateDotsPlan(): NameplateDotsPlan {
  return { slots: [], count: 0, scale: NAMEPLATE_DOT_SCALE_MIN };
}

function newSlot(): NameplateDotSlot {
  return {
    iconKey: '',
    school: '',
    fraction: 1,
    remaining: 0,
    duration: 0,
    decimals: 0,
    iconUrl: '',
    timeText: '',
    timeValue: Number.NaN,
  };
}

/** A permanent or duration-less aura reads as a full bar: it is not running out. */
function remainingFraction(aura: NameplateDotAura): number {
  if (aura.permanent === true) return 1;
  const duration = aura.duration;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, Math.max(0, aura.remaining / duration));
}

/**
 * Fill `out` with the local player's own debuffs on one entity and return it.
 * `isOwn` is injected so the plate shares the host's single ownership predicate
 * with the aura strips rather than re-deriving it.
 *
 * Order is the aura id, ascending: stable across frames, independent of the
 * order the sim applied them, and never re-sorted by remaining time (a row that
 * moves while the player is reading it is worse than no row).
 */
export function nameplateDotsInto(
  out: NameplateDotsPlan,
  auras: readonly NameplateDotAura[],
  isOwn: (aura: NameplateDotAura) => boolean,
  cap: number = NAMEPLATE_DOT_CAP,
): NameplateDotsPlan {
  out.count = 0;
  if (cap <= 0) return out;
  // Two passes rather than a filtered array: the first counts and the second
  // writes in id order, so the per-plate path allocates nothing but the slots it
  // reuses. Selection sort over at most a handful of auras is cheaper than a
  // scratch array plus a comparator here.
  let written = 0;
  let previousId = '';
  while (written < cap) {
    let best: NameplateDotAura | null = null;
    for (const aura of auras) {
      if (!isOwn(aura)) continue;
      if (!isDebuffAura(aura.kind, aura.value)) continue;
      if (aura.remaining <= 0) continue;
      if (written > 0 && aura.id <= previousId) continue;
      if (best === null || aura.id < best.id) best = aura;
    }
    if (best === null) break;
    const slot = out.slots[written] ?? newSlot();
    out.slots[written] = slot;
    // Recycling a slot onto a different aura invalidates BOTH painter-resolved
    // fields, so the painter re-resolves instead of drawing the previous aura's
    // icon or its countdown (the pooled-record staleness trap auras_painter
    // documents).
    if (slot.iconKey !== best.id) {
      slot.iconUrl = '';
      slot.timeText = '';
      slot.timeValue = Number.NaN;
    }
    slot.iconKey = best.id;
    slot.school = best.school ?? '';
    slot.fraction = remainingFraction(best);
    slot.remaining = Math.max(0, best.remaining);
    slot.duration = best.permanent === true ? 0 : (best.duration ?? 0);
    slot.decimals = slot.remaining < NAMEPLATE_DOT_DECIMAL_BELOW_SEC ? 1 : 0;
    previousId = best.id;
    written++;
  }
  out.count = written;
  return out;
}

/** Height in plate units the dot row adds to the plate at `scale`, 0 when it is
 *  empty. The painter's draw walk and drawEmote's anchor walk BOTH consume this,
 *  so the emote bubble can never drift away from the plate it belongs to. */
export function nameplateDotRowHeight(count: number, scale = NAMEPLATE_DOT_SCALE_MIN): number {
  if (count <= 0) return 0;
  return (
    (NAMEPLATE_DOT_SIZE + NAMEPLATE_DOT_TIMER_STEP + NAMEPLATE_DOT_ROW_PAD) *
    clampNameplateDotScale(scale)
  );
}

/** Total width of `count` icons plus their gaps at `scale`, in plate units. */
export function nameplateDotRowWidth(count: number, scale = NAMEPLATE_DOT_SCALE_MIN): number {
  if (count <= 0) return 0;
  return (
    (count * NAMEPLATE_DOT_SIZE + (count - 1) * NAMEPLATE_DOT_GAP) * clampNameplateDotScale(scale)
  );
}
