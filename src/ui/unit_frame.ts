// Pure derivation for the unit_frame FAMILY: ONE allocation-light core + ONE write-elided painter
// (unit_frame_painter.ts) that a player, target, or party instance all drive.
// The core maps a UNIT DESCRIPTOR (the values a frame needs, computed at the call
// site) to a UNIT VIEW (the values the painter writes). It has NO hardcoded
// element id and NO single-instance assumption: it is a pure function of the
// descriptor, so the same descriptor always yields the same view (DOM-free,
// i18n-free, no Math.random / Date.now / performance.now). The player frame is the
// FIRST instance through this seam; target and party are added as further
// instances of the EXACT seam with no core change, so the descriptor deliberately
// carries the FULL field set target and party need even though the player leaves
// some at their always-present values.
//
// What the core actually computes (the rest is a typed pass-through that pins the
// contract): the present/hidden gate (a unit may be absent), the absorb-shield
// overlay via the shared absorbBarView core (so player/target/party never
// re-derive it), and the resource-type DISCRIMINATOR (which also folds the player
// block's `rage : energy : mana` ternary and adds the `none` case a target frame
// with no resource bar needs). Health/resource fractions and the hp/resource TEXT
// are preformatted at the call site (allocation-light: no raw entity references,
// no per-element garbage), exactly as the inline player block computed them.

import type { ResourceType } from '../sim/types';
import { type AbsorbBarInput, absorbBarView } from './absorb_bar';

/**
 * The resource-bar discriminator the painter routes to a class on the resource
 * container. The three power types are mutually exclusive; `none` is the
 * no-resource-bar case a target frame needs (it has no rage/energy/mana bar). The
 * player is always one of the three power types, never `none`.
 */
export type UnitResourceClass = 'rage' | 'energy' | 'mana' | 'none';

/**
 * The resource input the descriptor carries. `none` marks a unit with no resource
 * bar (target). `ResourceType | null` is the live power: the player's resourceType
 * is `ResourceType | null` (null is the mana default), and the core maps it to a
 * UnitResourceClass exactly as the old inline `rage : energy : mana` ternary did.
 */
export type UnitResourceKind = ResourceType | 'none' | null;

/**
 * The values a unit frame needs, computed at the call site. Allocation-light: a
 * single object per frame carrying preformatted fracs + text and an entity-shaped
 * absorb input, never a raw entity reference (other than the structural absorb
 * subset). Fields the player always has at fixed values (present, dead,
 * outOfRange) exist so target/party fill them with no core change.
 */
export interface UnitFrameDescriptor {
  /** false => no unit is shown (target absent, party slot empty); the painter
   *  hides the frame and skips every other write. The player is always present. */
  present: boolean;
  /** hp / max(1, maxHp), computed at the call site (raw, not clamped here, to stay
   *  byte-identical to the inline `scaleX(hp / max(1, maxHp))`). */
  hpFrac: number;
  /** Preformatted, localized health text ("523 / 600", or a localized "Dead"). */
  hpText: string;
  /** The unit's power kind; `none` for a frame with no resource bar (target). */
  resourceKind: UnitResourceKind;
  /** resource / max(1, maxResource); ignored when resourceKind is `none`. */
  resFrac: number;
  /** Preformatted resource text; the painter omits it when there is no bar. */
  resText: string;
  /** Preformatted level text, or null to show no level (party may hide it; a boss
   *  target passes a skull glyph). The player passes its numeric level as a string. */
  levelText: string | null;
  /** The unit's display name. */
  name: string;
  /** The portrait identity. The PAINTER owns the repaint gate (repaint only when
   *  this key changes); the core just exposes it so target's lastPortraitTarget
   *  gating is the same code path. */
  portraitKey: string;
  /** The entity-shaped absorb input ({ hp, maxHp, auras }) the core resolves via
   *  absorbBarView, or null for no shield (e.g. a dead target). The player passes
   *  its own entity (a structural AbsorbBarInput). */
  absorb: AbsorbBarInput | null;
  /** The unit is dead (party styles the frame; a dead target also reads "Dead" via
   *  hpText). The player frame is never dead-styled. */
  dead: boolean;
  /** The unit is beyond party range (a party member past PARTY_FRAME_RANGE_YD);
   *  the painter dims the frame. The player and a target are always in range. */
  outOfRange: boolean;
}

/** The values the painter writes, derived from a descriptor by unitFrameView. */
export interface UnitFrameView {
  present: boolean;
  hpFrac: number;
  hpText: string;
  /** The resolved resource-type discriminator (incl `none`). */
  resClass: UnitResourceClass;
  resFrac: number;
  resText: string;
  levelText: string | null;
  name: string;
  portraitKey: string;
  /** The absorb-shield overlay fraction (hp + absorb) / maxHp, clamped by
   *  absorbBarView; equals hpFrac when there is no shield. */
  absorbFrac: number;
  /** The shield reaches/passes the bar's right edge (fully shielded). */
  absorbOvershield: boolean;
  dead: boolean;
  outOfRange: boolean;
}

// The not-present view: every field at a no-op default. A shared constant (no
// allocation) because the painter ignores everything but `present` when hidden.
const HIDDEN: UnitFrameView = {
  present: false,
  hpFrac: 0,
  hpText: '',
  resClass: 'none',
  resFrac: 0,
  resText: '',
  levelText: null,
  name: '',
  portraitKey: '',
  absorbFrac: 0,
  absorbOvershield: false,
  dead: false,
  outOfRange: false,
};

// The no-shield absorb result, matching the inline updateAbsorb fallback for a
// null entity (`{ fillFrac: 0, overshield: false }`).
const NO_ABSORB = { fillFrac: 0, overshield: false } as const;

/**
 * Map the descriptor's resource kind to the painter's class discriminator. This
 * IS the old inline player ternary (`rage : energy : mana`, where null falls
 * through to mana) plus the `none` case a target frame needs. Pure and exhaustive.
 */
export function unitResourceClass(kind: UnitResourceKind): UnitResourceClass {
  if (kind === 'none') return 'none';
  if (kind === 'rage') return 'rage';
  if (kind === 'energy') return 'energy';
  // 'mana' or null: the player's default branch, byte-identical to the old ternary.
  return 'mana';
}

/**
 * Derive a unit frame's paint values from its descriptor. Pure, allocation-light
 * (one returned object, or the shared HIDDEN constant when absent), deterministic.
 */
export function unitFrameView(d: UnitFrameDescriptor): UnitFrameView {
  if (!d.present) return HIDDEN;
  const absorb = d.absorb ? absorbBarView(d.absorb) : NO_ABSORB;
  return {
    present: true,
    hpFrac: d.hpFrac,
    hpText: d.hpText,
    resClass: unitResourceClass(d.resourceKind),
    resFrac: d.resFrac,
    resText: d.resText,
    levelText: d.levelText,
    name: d.name,
    portraitKey: d.portraitKey,
    absorbFrac: absorb.fillFrac,
    absorbOvershield: absorb.overshield,
    dead: d.dead,
    outOfRange: d.outOfRange,
  };
}
