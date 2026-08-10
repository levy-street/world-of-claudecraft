// Pure derivation for the unit_frame FAMILY: ONE allocation-light core + ONE write-elided painter
// (unit_frame_painter.ts) that a player, target, or party instance all drive.
// The core maps a UNIT DESCRIPTOR (the values a frame needs, computed at the call
// site) to a UNIT VIEW (the values the painter writes). It has NO hardcoded
// element id and NO single-instance assumption: it is a pure function of the
// descriptor, so the same descriptor always yields the same view (DOM-free,
// translation-free (no t()/tEntity), no Math.random / Date.now / performance.now).
// The player frame is the FIRST instance through this seam; target and party are
// added as further instances of the EXACT seam with no core change, so the
// descriptor deliberately carries the FULL field set target and party need even
// though the player leaves some at their always-present values.
//
// What the core actually computes (the rest is a typed pass-through that pins the
// contract): the present/hidden gate (a unit may be absent), the absorb-shield
// overlay via the shared absorbBarView core (so player/target/party never
// re-derive it), and the resource-type DISCRIMINATOR (which also folds the player
// block's live rage, energy, focus, or mana state and adds the `none` case a target frame
// with no resource bar needs). Health/resource fractions and the hp/resource TEXT
// are preformatted at the call site (allocation-light: no raw entity references,
// no per-element garbage), exactly as the inline player block computed them; the
// ONE exception is the absorb-shield total appended to hpText ("523 / 600 (60)"),
// which the core derives itself from the raw absorb input via absorbBarView and so
// cannot be preformatted upstream. That number is routed through formatNumber
// (useGrouping:false, matching hud_frames.ts) so its digits follow the active
// locale like every other unit-frame number.

import type { ResourceType } from '../sim/types';
import {
  type AbsorbBarInput,
  type AbsorbBarView,
  absorbBarView,
  absorbBarViewInto,
} from './absorb_bar';
import { formatNumber } from './i18n';

// The absorb-total suffix appended to hpText ("523 / 600 (60)") runs through
// formatNumber with useGrouping:false so its digits follow the active locale
// like every other unit-frame number, matching hud_frames.ts. This is the
// core's one narrow, deliberate use of the i18n runtime: it calls no
// t()/tEntity (see tests/unit_frame.test.ts), so it still emits no
// translated STRINGS, only locale-correct digits for a number it derives
// internally (absorbBarView's total) that the call site has no way to
// preformat itself.
const ABSORB_TEXT_OPTS: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

/**
 * The resource-bar discriminator the painter routes to a class on the resource
 * container. The four power types are mutually exclusive; `none` is the
 * no-resource-bar case a target frame needs. The player always uses a live power
 * type and never `none`.
 */
export type UnitResourceClass = 'rage' | 'energy' | 'focus' | 'mana' | 'none';

/**
 * The resource input the descriptor carries. `none` marks a unit with no resource
 * bar (target). `ResourceType | null` is the live power: the player's resourceType
 * is `ResourceType | null` (null is the mana default), and the core maps it to a
 * UnitResourceClass.
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
  /** Append the resolved absorb total to hpText, for player/target frames only. */
  showAbsorbText?: boolean;
  /** The unit's power kind; `none` for a frame with no resource bar (target). */
  resourceKind: UnitResourceKind;
  /** resource / max(1, maxResource); ignored when resourceKind is `none`. */
  resFrac: number;
  /** Preformatted resource text; the painter omits it when there is no bar. */
  resText: string;
  /** Preformatted level text, or null to show no level. */
  levelText: string | null;
  /** The unit's display name. */
  name: string;
  /** The name line's title decoration (the Book of Deeds display title),
   *  PRE-LOCALIZED at the call site (the core stays i18n-free): everything the
   *  locale pattern places before the name (`titlePre`) and after it
   *  (`titlePost`). Optional and absent for instances without a title surface
   *  (player, party); absent means empty decoration. */
  titlePre?: string;
  titlePost?: string;
  /** The Book of Deeds border SLUG (never a deed id), RESOLVED AT THE CALL SITE
   *  via deedBorderSlug, exactly like titlePre's pre-localized decoration: the
   *  core stays a pass-through and never touches the deed catalog. '' or absent
   *  means no border, which is also what a stale or title-reward id resolves to. */
  borderSlug?: string;
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
  /** The pre-localized title decoration around the name ('' when untitled or
   *  the instance has no title surface). */
  titlePre: string;
  titlePost: string;
  /** The call-site-resolved Book of Deeds border slug ('' when borderless or the
   *  instance has no border surface). */
  borderSlug: string;
  portraitKey: string;
  /** The absorb-shield overlay fraction (hp + absorb) / maxHp, clamped by
   *  absorbBarView; equals hpFrac when there is no shield. Kept for the player /
   *  target painter's left-filled overlay. */
  absorbFrac: number;
  /** The left edge of the visible shield segment (party frames' positioned
   *  segment; the player/target painter ignores it). */
  absorbStartFrac: number;
  /** The width of the visible shield segment. */
  absorbSizeFrac: number;
  /** The shield reaches/passes the bar's right edge (fully shielded). */
  absorbOvershield: boolean;
  dead: boolean;
  outOfRange: boolean;
}

export interface UnitFrameBuffer {
  view: UnitFrameView;
  absorb: AbsorbBarView;
  absorbTextBase: string;
  absorbTextTotal: number;
  absorbText: string;
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
  titlePre: '',
  titlePost: '',
  borderSlug: '',
  portraitKey: '',
  absorbFrac: 0,
  absorbStartFrac: 0,
  absorbSizeFrac: 0,
  absorbOvershield: false,
  dead: false,
  outOfRange: false,
};

// The no-shield absorb result, matching absorbBarView's shape for a null entity.
const NO_ABSORB = {
  total: 0,
  fillFrac: 0,
  startFrac: 0,
  sizeFrac: 0,
  overshield: false,
} as const;

/**
 * Map the descriptor's resource kind to the painter's class discriminator. This
 * Maps every live power type, with null falling through to mana, plus the `none`
 * case a target frame needs. Pure and exhaustive.
 */
export function unitResourceClass(kind: UnitResourceKind): UnitResourceClass {
  if (kind === 'none') return 'none';
  if (kind === 'rage') return 'rage';
  if (kind === 'energy') return 'energy';
  if (kind === 'focus') return 'focus';
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
  const hpText =
    d.showAbsorbText && absorb.total > 0
      ? `${d.hpText} (${formatNumber(absorb.total, ABSORB_TEXT_OPTS)})`
      : d.hpText;
  return {
    present: true,
    hpFrac: d.hpFrac,
    hpText,
    resClass: unitResourceClass(d.resourceKind),
    resFrac: d.resFrac,
    resText: d.resText,
    levelText: d.levelText,
    name: d.name,
    titlePre: d.titlePre ?? '',
    titlePost: d.titlePost ?? '',
    borderSlug: d.borderSlug ?? '',
    portraitKey: d.portraitKey,
    absorbFrac: absorb.fillFrac,
    absorbStartFrac: absorb.startFrac,
    absorbSizeFrac: absorb.sizeFrac,
    absorbOvershield: absorb.overshield,
    dead: d.dead,
    outOfRange: d.outOfRange,
  };
}

/** Allocate the long-lived buffers used by one HUD unit-frame instance. */
export function newUnitFrameBuffer(): UnitFrameBuffer {
  return {
    view: {
      present: false,
      hpFrac: 0,
      hpText: '',
      resClass: 'none',
      resFrac: 0,
      resText: '',
      levelText: null,
      name: '',
      titlePre: '',
      titlePost: '',
      borderSlug: '',
      portraitKey: '',
      absorbFrac: 0,
      absorbStartFrac: 0,
      absorbSizeFrac: 0,
      absorbOvershield: false,
      dead: false,
      outOfRange: false,
    },
    absorb: {
      total: 0,
      fillFrac: 0,
      startFrac: 0,
      sizeFrac: 0,
      overshield: false,
    },
    absorbTextBase: '',
    absorbTextTotal: 0,
    absorbText: '',
  };
}

/**
 * Fill one caller-owned unit-frame view. This is the per-frame HUD path; the
 * allocating unitFrameView wrapper remains available to pure callers/tests.
 */
export function unitFrameViewInto(buffer: UnitFrameBuffer, d: UnitFrameDescriptor): UnitFrameView {
  const out = buffer.view;
  if (!d.present) {
    out.present = false;
    out.hpFrac = 0;
    out.hpText = '';
    out.resClass = 'none';
    out.resFrac = 0;
    out.resText = '';
    out.levelText = null;
    out.name = '';
    out.titlePre = '';
    out.titlePost = '';
    out.borderSlug = '';
    out.portraitKey = '';
    out.absorbFrac = 0;
    out.absorbStartFrac = 0;
    out.absorbSizeFrac = 0;
    out.absorbOvershield = false;
    out.dead = false;
    out.outOfRange = false;
    return out;
  }

  const absorb = d.absorb ? absorbBarViewInto(buffer.absorb, d.absorb) : NO_ABSORB;
  out.present = true;
  out.hpFrac = d.hpFrac;
  if (d.showAbsorbText && absorb.total > 0) {
    if (d.hpText !== buffer.absorbTextBase || absorb.total !== buffer.absorbTextTotal) {
      buffer.absorbTextBase = d.hpText;
      buffer.absorbTextTotal = absorb.total;
      buffer.absorbText = `${d.hpText} (${formatNumber(absorb.total, ABSORB_TEXT_OPTS)})`;
    }
    out.hpText = buffer.absorbText;
  } else {
    out.hpText = d.hpText;
  }
  out.resClass = unitResourceClass(d.resourceKind);
  out.resFrac = d.resFrac;
  out.resText = d.resText;
  out.levelText = d.levelText;
  out.name = d.name;
  out.titlePre = d.titlePre ?? '';
  out.titlePost = d.titlePost ?? '';
  out.borderSlug = d.borderSlug ?? '';
  out.portraitKey = d.portraitKey;
  out.absorbFrac = absorb.fillFrac;
  out.absorbStartFrac = absorb.startFrac;
  out.absorbSizeFrac = absorb.sizeFrac;
  out.absorbOvershield = absorb.overshield;
  out.dead = d.dead;
  out.outOfRange = d.outOfRange;
  return out;
}
