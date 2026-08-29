// Pure, DOM-free core for the TOUCH stance control: which stance the anchor
// wears and which of the radial's four directions each remaining stance sits on.
// No DOM, no timers, no Hud state, so a Vitest drives every decision directly;
// registered in tests/architecture.test.ts UI_PURE_CORES.
//
// The desktop row shows every stance side by side. A phone has no room for that
// on the button row, so the touch control is ONE circle wearing the active
// stance, and the alternatives hang off the same radial the action ring already
// speaks: the directions, the placement and the release rule all come from
// ../action_bar/radial_action_core.ts and ../action_bar/radial_gesture_core.ts,
// so a player who has learned the ring's flick has already learned this.
//
// CAPACITY IS A HARD FOUR. The radial has four directions and no fifth place to
// put a stance, so a class that ever knew more alternatives than that would
// silently lose one: the overflow is reported here (and warned about on the dev
// channel) rather than dropped, and tests/stance_radial_core.test.ts pins it.
// Today no class reaches the limit (a warrior knows three stances, so two
// alternatives; a paladin knows one devotion aura).

import type { StanceBarModel, StanceSlot } from '../../stance_bar_view';
import { RADIAL_DIRECTIONS, type RadialDirection } from '../action_bar/radial_action_core';

/** The four petal directions, in the order alternatives are seated on them.
 *  Index i here is petal i, matching placeRadial's petal order after the
 *  centre, so the painter lines the two up by index without a second table. */
export const STANCE_PETAL_DIRECTIONS: readonly RadialDirection[] = RADIAL_DIRECTIONS.slice(1);

/** How many alternatives the radial can hold. Four directions, four stances. */
export const STANCE_RADIAL_CAPACITY = STANCE_PETAL_DIRECTIONS.length;

export interface StanceRadialPetal {
  /** The direction this stance is reached on. */
  direction: RadialDirection;
  /** Stance ability id: the cast target and the icon key. */
  id: string;
  /** Icon identity the painter resolves + elides by (equals `id`). */
  iconKey: string;
}

export interface StanceRadialModel {
  /** False hides the whole control (non-warrior/paladin, or no stance known). */
  visible: boolean;
  /** The stance the anchor wears, or null while none is worn. */
  activeId: string | null;
  /** What the anchor's face draws. Falls back to the first known stance so the
   *  control is never a blank circle while nothing is worn (a paladin with the
   *  aura down still has to be able to find it). */
  anchorIconKey: string | null;
  /** Whether a stance is actually worn, which is what the anchor's active ring
   *  and aria-pressed state read. */
  anchorActive: boolean;
  /** The alternatives, in petal order. At most STANCE_RADIAL_CAPACITY. */
  petals: StanceRadialPetal[];
  /** Stance ids the radial had no direction left for. Empty in every shipped
   *  class; non-empty means the capacity guard fired. */
  overflow: string[];
  /** Byte-stable rebuild key: the painter skips the DOM rebuild when unchanged. */
  sig: string;
}

const HIDDEN: StanceRadialModel = {
  visible: false,
  activeId: null,
  anchorIconKey: null,
  anchorActive: false,
  petals: [],
  overflow: [],
  sig: 'hidden',
};

/**
 * Project the shared stance model onto the touch radial.
 *
 * The anchor takes the worn stance and every OTHER known stance becomes a petal,
 * so the choice set is identical to the row's: nothing the desktop bar can reach
 * is unreachable here. With nothing worn, every known stance is an alternative,
 * which is what keeps a paladin's single devotion aura castable from the control
 * that shows it.
 */
export function stanceRadialView(model: StanceBarModel): StanceRadialModel {
  if (!model.visible || model.slots.length === 0) return HIDDEN;
  const active: StanceSlot | undefined = model.slots.find((slot) => slot.active);
  const alternatives = model.slots.filter((slot) => slot.id !== active?.id);
  const petals: StanceRadialPetal[] = [];
  const overflow: string[] = [];
  for (const slot of alternatives) {
    const direction = STANCE_PETAL_DIRECTIONS[petals.length];
    if (direction === undefined) {
      overflow.push(slot.id);
      continue;
    }
    petals.push({ direction, id: slot.id, iconKey: slot.iconKey });
  }
  if (overflow.length > 0) warnStanceOverflow(overflow);
  return {
    visible: true,
    activeId: active?.id ?? null,
    anchorIconKey: active?.iconKey ?? model.slots[0].iconKey,
    anchorActive: active !== undefined,
    petals,
    overflow,
    sig: `${active?.id ?? ''}|${petals.map((p) => p.id).join(',')}|${overflow.join(',')}`,
  };
}

/** Dev-channel only, and deliberately loud: a stance the player cannot reach is
 *  a content bug, not a layout detail, and the radial has no fifth direction to
 *  grow into. English by design (root CLAUDE.md: console text is dev channel). */
function warnStanceOverflow(overflow: readonly string[]): void {
  console.warn(
    `stance radial: ${overflow.length} stance(s) past the ${STANCE_RADIAL_CAPACITY}-direction capacity and unreachable on touch: ${overflow.join(', ')}`,
  );
}

/** Which petal a direction is, or -1 when that direction holds no stance. The
 *  gesture layer asks this for both hasSlot and the cast, so the mapping has one
 *  author rather than a lookup open-coded at each call site. */
export function stancePetalIndex(model: StanceRadialModel, direction: RadialDirection): number {
  return model.petals.findIndex((petal) => petal.direction === direction);
}
