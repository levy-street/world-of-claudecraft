// Pure, DOM-free core for the touch quest strip: the single-line top-band
// replacement for the right-anchored quest tracker on phones. It owns which
// quest is shown (cycling arithmetic and the swipe orientation), the counter's
// numeric inputs, the objective list the strip renders, and the band arithmetic
// that turns measured boxes into a max width. The painter owns the measuring,
// the t() calls, and the formatting; registered in tests/architecture.test.ts
// UI_PURE_CORES.
//
// The tracker this replaces is unbounded in height, so every extra quest grows
// it downward into the action ring. The strip shows one quest at a time in the
// free top band, which makes its height a constant rather than a function of the
// quest count.
//
// It reads the SAME TrackedQuest model as quest_tracker.ts: the strip is a
// second presentation of the tracked quests, not a second data model.

import { FLICK_DEADZONE_PX } from '../action_bar/radial_action_core';
import type { TrackedQuest } from './quest_tracker';

/** Horizontal travel before a drag counts as a swipe rather than a tap. Shared
 *  with the radial so the whole HUD speaks one gesture language. */
export const QUEST_STRIP_SWIPE_DEADZONE_PX = FLICK_DEADZONE_PX;

/** A guard, not the normal case: authored quests carry one to three objectives,
 *  so this only ever trims a pathological one. Height stays bounded either way. */
export const QUEST_STRIP_MAX_OBJECTIVES = 4;

/** Where the top band starts, and the margin its right end keeps. Both are
 *  mirrored by the #quest-strip rules in hud.mobile.css, which own the seat. */
export const QUEST_STRIP_BAND_TOP_PX = 6;
export const QUEST_STRIP_BAND_MIN_X_PX = 12;

/** Clear space between the target frame's static seat and the strip's anchor.
 *  Mirrored by the --quest-strip-anchor-left derivation in hud.mobile.css. */
export const QUEST_STRIP_TARGET_FRAME_GAP_PX = 11;

/** Clear space between the strip and any other occupant of the band. */
export const QUEST_STRIP_BAND_GAP_PX = 10;

/** The strip must never be squeezed so hard its text disappears. Letting the
 *  band drive the width alone once left a strip showing the incompressible
 *  counter chip and no quest at all. */
export const QUEST_STRIP_MIN_WIDTH_PX = 150;

/** Band height assumed when the strip has not been measured yet (first paint),
 *  so the overlap test still rejects boxes that sit well below the band. */
export const QUEST_STRIP_FALLBACK_HEIGHT_PX = 56;

/** Which way a swipe moves the selection. Swiping LEFT advances, following the
 *  carousel convention: the content slides left to reveal the next quest. */
export type QuestStripStep = 1 | -1;

/**
 * The step a horizontal drag on the strip resolves to. A tap (travel inside the
 * deadzone) advances, so the strip is fully usable without any gesture at all.
 */
export function questStripStep(
  dx: number,
  deadzone: number = QUEST_STRIP_SWIPE_DEADZONE_PX,
): QuestStripStep {
  if (Math.abs(dx) < deadzone) return 1;
  return dx < 0 ? 1 : -1;
}

/** Move the selection by `step`, wrapping in both directions. A total below 2
 *  has nothing to cycle to, so the only valid index is 0. */
export function cycleQuestStrip(index: number, step: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(step) || total < 2) return 0;
  const from = clampQuestIndex(index, total);
  return (((from + Math.trunc(step)) % total) + total) % total;
}

/** Keep a selection valid as the tracked set shrinks under it. */
export function clampQuestIndex(index: number, total: number): number {
  if (!Number.isFinite(index) || total <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), total - 1);
}

export interface QuestStripCounter {
  /** 1-based position of the shown quest. 0 when nothing is tracked. */
  position: number;
  total: number;
  /** False when there is nothing to cycle to, so the chevrons stay hidden. */
  visible: boolean;
}

/** The counter's numeric inputs. The painter formats them (through formatNumber
 *  and its t() key); a core that returned "2/3" would be un-localizable. */
export function questStripCounter(index: number, total: number): QuestStripCounter {
  if (total <= 0) return { position: 0, total: 0, visible: false };
  return { position: clampQuestIndex(index, total) + 1, total, visible: total > 1 };
}

export interface QuestStripObjectiveRow {
  /** Already-localized objective label, as the tracked model carries it. */
  label: string;
  current: number;
  total: number;
  done: boolean;
}

export interface QuestStripView {
  /** Whether to render anything at all (false when no quests are tracked). */
  visible: boolean;
  id: string;
  title: string;
  complete: boolean;
  /** The index actually shown, after clamping the requested one. */
  index: number;
  counter: QuestStripCounter;
  /** Every objective of the shown quest, capped at QUEST_STRIP_MAX_OBJECTIVES. */
  objectives: QuestStripObjectiveRow[];
  /** Objectives the cap trimmed, so the painter can add its "+N more" line. */
  hiddenObjectives: number;
}

// Built per call, never shared: the caller owns the arrays it is handed.
function emptyQuestStripView(): QuestStripView {
  return {
    visible: false,
    id: '',
    title: '',
    complete: false,
    index: 0,
    counter: { position: 0, total: 0, visible: false },
    objectives: [],
    hiddenObjectives: 0,
  };
}

/**
 * The strip's render model for one selection. EVERY objective of the shown quest
 * is included, not just the next one: the unbounded growth this replaces came
 * from the quest COUNT, and one quest's objectives is a small, self-limiting
 * list the player needs in full.
 */
export function questStripView(quests: readonly TrackedQuest[], index: number): QuestStripView {
  const total = quests.length;
  if (total === 0) return emptyQuestStripView();
  const shownIndex = clampQuestIndex(index, total);
  const quest = quests[shownIndex];
  const objectives = quest.objectives.slice(0, QUEST_STRIP_MAX_OBJECTIVES).map((o) => ({
    label: o.label,
    current: o.current,
    total: o.total,
    done: o.current >= o.total,
  }));
  return {
    visible: true,
    id: quest.id,
    title: quest.title,
    complete: quest.complete,
    index: shownIndex,
    counter: questStripCounter(shownIndex, total),
    objectives,
    hiddenObjectives: quest.objectives.length - objectives.length,
  };
}

/** One measured box, in visual viewport px: the subset of DOMRect the band
 *  arithmetic reads. The painter measures; this module only does the maths. */
export interface QuestStripBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface QuestStripBandInputs {
  viewportWidth: number;
  /** The strip's CONSTANT anchor, in the same coordinates as the occupants.
   *  hud.mobile.css owns it (--quest-strip-anchor-left, derived from the target
   *  frame's static seat), so nothing measured here can move it. */
  anchorLeft: number;
  /** Everything that can legitimately share the top band (the party frames, the
   *  buff and debuff bars, the minimap, the right tracker stack). Each only
   *  counts while it overlaps the band vertically AND starts right of the
   *  anchor. */
  occupants: readonly QuestStripBox[];
  /** Measured strip height; 0 before the first measure. */
  stripHeight: number;
}

export interface QuestStripBand {
  /** A max-width, not a width: the strip hugs its text rather than filling the
   *  band, which would leave a mostly empty slab. */
  maxWidth: number;
}

/**
 * How wide the strip may grow from its constant anchor before it reaches the
 * band's next occupant. Only the WIDTH is answered here: the anchor itself is
 * static CSS, because anything that moves it moves the point the player's thumb
 * already learned. An occupant left of the anchor is therefore skipped rather
 * than pushing the start right (the target frame, the party stack under it and
 * the combat row all live there): the strip is seated as though the target
 * frame were always present, so targeting and untargeting change nothing.
 */
export function questStripBand(inputs: QuestStripBandInputs): QuestStripBand {
  const top = QUEST_STRIP_BAND_TOP_PX;
  const height = inputs.stripHeight > 0 ? inputs.stripHeight : QUEST_STRIP_FALLBACK_HEIGHT_PX;
  const bandBottom = top + height;
  const left = inputs.anchorLeft;
  let rightLimit = inputs.viewportWidth - QUEST_STRIP_BAND_MIN_X_PX;
  for (const box of inputs.occupants) {
    if (box.right - box.left <= 0) continue;
    if (box.bottom <= top || box.top >= bandBottom) continue;
    if (box.left <= left) continue;
    rightLimit = Math.min(rightLimit, box.left - QUEST_STRIP_BAND_GAP_PX);
  }
  return { maxWidth: Math.max(QUEST_STRIP_MIN_WIDTH_PX, Math.round(rightLimit - left)) };
}

/** How long a hand cycle owns the strip before objective progress may move the
 *  selection again. The player who just swiped to a quest is reading it, and a
 *  kill credit landing a beat later must not yank it away under them. */
export const QUEST_STRIP_CYCLE_GRACE_MS = 5000;

/**
 * Which tracked quest just made progress, by index into `next`, or null when
 * none did. Matched by quest id rather than by position, so an accept or an
 * abandon reshuffling the list cannot read as progress on the quest that
 * inherited a slot.
 *
 * Progress is any of: an objective count rising, an objective crossing into
 * done, or the quest itself turning complete. A quest that is NEW to the list is
 * deliberately not progress: accepting one is not a reason to take the strip off
 * the quest the player is working. Multiple quests progressing in the same tick
 * resolve to the FIRST in tracked order, which is the log's own acceptance
 * order, so the choice is stable rather than dependent on iteration accidents.
 */
export function detectQuestProgress(
  previous: readonly TrackedQuest[],
  next: readonly TrackedQuest[],
): number | null {
  if (previous.length === 0 || next.length === 0) return null;
  for (let i = 0; i < next.length; i++) {
    const quest = next[i];
    const before = previous.find((candidate) => candidate.id === quest.id);
    if (!before) continue;
    if (quest.complete && !before.complete) return i;
    if (questObjectivesProgressed(before, quest)) return i;
  }
  return null;
}

function questObjectivesProgressed(before: TrackedQuest, after: TrackedQuest): boolean {
  for (let i = 0; i < after.objectives.length; i++) {
    const was = before.objectives[i];
    if (!was) continue;
    const now = after.objectives[i];
    if (now.current > was.current) return true;
    // A completion the count alone does not show: the requirement itself can
    // fall (a shared or scaled objective), which still finishes the line.
    if (now.current >= now.total && was.current < was.total) return true;
  }
  return false;
}

/**
 * Whether a hand cycle still owns the selection. `lastCycleAt` is null until the
 * player has cycled at all, and both times come from the HUD's monotonic frame
 * clock: this module never reads one of its own.
 */
export function questStripCycleGraceHolds(
  lastCycleAt: number | null,
  now: number,
  graceMs: number = QUEST_STRIP_CYCLE_GRACE_MS,
): boolean {
  if (lastCycleAt === null) return false;
  if (!Number.isFinite(lastCycleAt) || !Number.isFinite(now)) return false;
  return now - lastCycleAt >= 0 && now - lastCycleAt < graceMs;
}

export interface QuestStripProgressJumpInput {
  previous: readonly TrackedQuest[];
  next: readonly TrackedQuest[];
  /** Monotonic ms from the HUD frame clock, threaded in by the controller. */
  now: number;
  /** When the player last cycled by hand, or null if they never have. */
  lastCycleAt: number | null;
  graceMs?: number;
}

/** The index the strip should switch to because that quest just progressed, or
 *  null to leave the player's selection exactly where it is. */
export function questStripProgressJump(input: QuestStripProgressJumpInput): number | null {
  const index = detectQuestProgress(input.previous, input.next);
  if (index === null) return null;
  if (questStripCycleGraceHolds(input.lastCycleAt, input.now, input.graceMs)) return null;
  return index;
}
