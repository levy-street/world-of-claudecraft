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

/** Health changes drive short, event-like frame feedback in the painter. */
export type UnitHealthTrend = 'stable' | 'damage' | 'heal';

/** A large hit gets one stronger, capped reaction without changing bar timing. */
export type UnitHealthImpact = 'stable' | 'damage' | 'damage-heavy' | 'heal';

/** Main-frame numeric readout: hidden, percent, current, or current/max. */
export type UnitFrameHealthTextMode = 0 | 1 | 2 | 3;

/** Structural target threat cue, ordered from quiet to immediate aggro. */
export type UnitThreatState = 'none' | 'building' | 'high' | 'aggro';

/** Context carried by a portrait plate, independent of its actual image key. */
export type UnitPortraitState =
  | 'normal'
  | 'dead'
  | 'ghost'
  | 'form'
  | 'polymorph'
  | 'mech'
  | 'transformed';

/** Mutually exclusive visual health bands used by every full-size unit frame. */
export type UnitHealthState = 'empty' | 'healthy' | 'wounded' | 'critical' | 'dead';

/** How a selected entity should be represented by the two-frame HUD. */
export type UnitTargetPresentation = 'none' | 'self' | 'unit';

/** The critical-health treatment begins below one quarter health. */
export const UNIT_FRAME_DANGER_FRAC = 0.25;
/** Wounded health shifts from the calm green treatment to the amber treatment. */
export const UNIT_FRAME_WOUNDED_FRAC = 0.5;
/** A single loss of 18% max HP reads as a heavy hit. */
export const UNIT_FRAME_HEAVY_HIT_FRAC = 0.18;
const UNIT_FRAME_HEAVY_HIT_EPSILON = 1e-9;
/** At 85% of the current top threat, the target frame warns before aggro flips. */
export const UNIT_FRAME_HIGH_THREAT_RATIO = 0.85;

/** Compare two sampled health fractions without pulling state into the pure view. */
export function unitHealthTrend(previous: number | null, next: number): UnitHealthTrend {
  if (previous === null || previous === next) return 'stable';
  return next < previous ? 'damage' : 'heal';
}

/** Classify health feedback by direction and a single bounded heavy-hit tier. */
export function unitHealthImpact(previous: number | null, next: number): UnitHealthImpact {
  const trend = unitHealthTrend(previous, next);
  if (trend !== 'damage') return trend;
  return previous !== null &&
    previous - next >= UNIT_FRAME_HEAVY_HIT_FRAC - UNIT_FRAME_HEAVY_HIT_EPSILON
    ? 'damage-heavy'
    : 'damage';
}

export interface UnitFrameHealthText {
  primary: string;
  secondaryPercent: string;
}

/**
 * Select the two existing health-text surfaces without doing localization in
 * the core. Dead remains a state label even when numeric values are hidden.
 */
export function unitFrameHealthText(
  current: string,
  maximum: string,
  percent: string,
  deadText: string | null,
  mode: UnitFrameHealthTextMode,
): UnitFrameHealthText {
  if (deadText !== null) return { primary: deadText, secondaryPercent: '' };
  if (mode === 1) return { primary: percent, secondaryPercent: '' };
  if (mode === 2) return { primary: current, secondaryPercent: '' };
  if (mode === 3) return { primary: `${current} / ${maximum}`, secondaryPercent: percent };
  return { primary: '', secondaryPercent: '' };
}

export interface UnitThreatInput {
  kind: string;
  hostile: boolean;
  dead: boolean;
  aggroTargetId: number | null;
  threat: ReadonlyMap<number, number>;
}

/** Derive a non-color target-frame warning from the authoritative hate table. */
export function unitThreatState(target: UnitThreatInput, playerId: number): UnitThreatState {
  if (target.kind !== 'mob' || !target.hostile || target.dead) return 'none';
  if (target.aggroTargetId === playerId) return 'aggro';
  const playerThreat = target.threat.get(playerId) ?? 0;
  if (playerThreat <= 0) return 'none';
  let topThreat = 0;
  for (const value of target.threat.values()) topThreat = Math.max(topThreat, value);
  if (topThreat > 0 && playerThreat / topThreat >= UNIT_FRAME_HIGH_THREAT_RATIO) return 'high';
  return 'building';
}

/**
 * Keep self-targeting available to spells and actions without painting the
 * player a second time in the target slot. World objects likewise have no unit
 * frame; every other selected entity uses the normal target presentation.
 */
export function unitTargetPresentation(
  target: { id: number; kind: string } | null | undefined,
  playerId: number,
): UnitTargetPresentation {
  if (!target || target.kind === 'object') return 'none';
  return target.id === playerId ? 'self' : 'unit';
}

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
  /** Preformatted, localized whole-percent text ("72%"), optional for compact rows. */
  hpPercentText?: string;
  /** Expected incoming healing divided by max HP. The view clamps it to missing HP. */
  incomingHealFrac?: number;
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
  /** The portrait identity. The PAINTER owns the repaint gate (repaint only when
   *  this key changes); the core just exposes it so target's lastPortraitTarget
   *  gating is the same code path. */
  portraitKey: string;
  /** Contextual visual state for the portrait rim and material treatment. */
  portraitState?: UnitPortraitState;
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
  /** Clamped whole percent for progressbar semantics. */
  hpPercent: number;
  /** Preformatted localized percent text for the secondary readout. */
  hpPercentText: string;
  /** Critical but alive, so dead/empty frames never pulse. */
  hpDanger: boolean;
  /** Exactly full and alive, for the calm full-health edge glint. */
  hpFull: boolean;
  /** Mutually exclusive health band for non-color state styling. */
  hpState: UnitHealthState;
  /** Left edge and width of the expected incoming-heal segment. */
  healPredictionStartFrac: number;
  healPredictionSizeFrac: number;
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
  portraitKey: string;
  portraitState: UnitPortraitState;
  /** The absorb-shield right edge (hp + absorb) / maxHp, clamped by
   *  absorbBarView. Retained for the shared view contract; painters use the
   *  positioned start/size fields below. */
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

// The not-present view: every field at a no-op default. A shared constant (no
// allocation) because the painter ignores everything but `present` when hidden.
const HIDDEN: UnitFrameView = {
  present: false,
  hpFrac: 0,
  hpPercent: 0,
  hpPercentText: '',
  hpDanger: false,
  hpFull: false,
  hpState: 'empty',
  healPredictionStartFrac: 0,
  healPredictionSizeFrac: 0,
  hpText: '',
  resClass: 'none',
  resFrac: 0,
  resText: '',
  levelText: null,
  name: '',
  titlePre: '',
  titlePost: '',
  portraitKey: '',
  portraitState: 'normal',
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
  const hpText = d.showAbsorbText && absorb.total > 0 ? `${d.hpText} (${absorb.total})` : d.hpText;
  const hpClamped = Math.max(0, Math.min(1, Number.isFinite(d.hpFrac) ? d.hpFrac : 0));
  const incomingHealFrac = Math.max(
    0,
    Number.isFinite(d.incomingHealFrac) ? (d.incomingHealFrac ?? 0) : 0,
  );
  const hpState: UnitHealthState =
    d.dead || hpClamped <= 0
      ? 'dead'
      : hpClamped <= UNIT_FRAME_DANGER_FRAC
        ? 'critical'
        : hpClamped <= UNIT_FRAME_WOUNDED_FRAC
          ? 'wounded'
          : 'healthy';
  return {
    present: true,
    hpFrac: d.hpFrac,
    hpPercent: Math.round(hpClamped * 100),
    hpPercentText: d.hpPercentText ?? '',
    hpDanger: hpState === 'critical',
    hpFull: hpState === 'healthy' && hpClamped >= 1,
    hpState,
    healPredictionStartFrac: hpClamped,
    healPredictionSizeFrac: hpState === 'dead' ? 0 : Math.min(1 - hpClamped, incomingHealFrac),
    hpText,
    resClass: unitResourceClass(d.resourceKind),
    resFrac: d.resFrac,
    resText: d.resText,
    levelText: d.levelText,
    name: d.name,
    titlePre: d.titlePre ?? '',
    titlePost: d.titlePost ?? '',
    portraitKey: d.portraitKey,
    portraitState: d.portraitState ?? 'normal',
    absorbFrac: absorb.fillFrac,
    absorbStartFrac: absorb.startFrac,
    absorbSizeFrac: absorb.sizeFrac,
    absorbOvershield: absorb.overshield,
    dead: d.dead,
    outOfRange: d.outOfRange,
  };
}
