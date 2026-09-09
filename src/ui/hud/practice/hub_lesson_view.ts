// Pure, host-agnostic transition core for the Eastbrook hub's guided practice
// coaching: which ONE step to show next while a player works Drillmaster
// Hale's damage drill (q_hub_know_your_numbers) or, for the four healing
// classes, his optional healing drill afterward.
//
// This is deliberately NOT a wall-of-text tutorial card. Each step names one
// real control (a keybind, a tab, a row, the history arrow) and the thin
// controller (hub_lesson_controller.ts) glows that control and shows a
// one-line prompt beside it, the same "press this next" idiom the Proving
// Shore coach uses (coach_prompt_view.ts / styles/components.css .qd-coach)
// but scoped to the hub's own HUD-anchored controls.
//
// A STATEFUL machine, not a pure function of the instant. The required
// sequence, taught one control at a time:
//   damage:  target -> open window -> Damage tab -> deal damage ->
//            read your row (total/DPS, ack'd) -> open the ability breakdown ->
//            stop and let the fight end -> use the history control to
//            inspect that finished run -> a second, comparable attempt ->
//            review the comparison (ack'd)
//   healing: target -> open window -> Healing tab -> cast a heal ->
//            read your row (effective healing/HPS, ack'd) -> open the
//            breakdown
// Healing asks for no second attempt: there is nothing to compare a solo
// heal-the-dummy rep against.
//
// Progress only ever advances on an ACTUAL observation (a real render, a
// real focus/hover/long-press, a real explicit acknowledgment, a real page
// through history landing on the right segment), never merely because the
// sim's own hit-count objective went ready: a quest turned in early, or even
// a reload, must not erase or fast-forward what has and has not actually
// been observed. `eligible` is intentionally independent of active/ready/done
// for exactly that reason. `progress` is the small persisted record the
// CALLER keeps per character; this module never reads a clock, a DOM, i18n,
// or the sim.
//
// Two observations are deliberately NOT plain booleans, because a naive
// boolean edge flag is exactly what let each of them go wrong once already:
//   - `rowVisibleNow` + `ackNow` together gate `rowSeen`/`compareReviewed`:
//     the row merely EXISTING on screen used to latch "read" the instant it
//     rendered, so the read-row step could never actually be shown for the
//     player to act on. Reading now needs an explicit, caller-supplied
//     acknowledgment (a "Continue"/"Done" press) while the row is visible.
//   - `historyViewedKey` carries the IDENTITY of whatever segment is
//     currently on screen, not just "some history control was clicked": a
//     click that pages to the wrong fight, the all-time roll-up, or back
//     onto the still-live current segment must not count as inspecting the
//     tracked run.
//
// Window/tab/target are re-checked as PREREQUISITES every time this module
// is about to ask the player to either act or observe, not only before the
// very first attempt: closing the Damage Meters mid-lesson, or flipping to
// a different tab, must fall back to "open the window"/"open the tab"
// rather than silently reporting a step (read-row, the breakdown) whose
// control the player can no longer see.
//
// Counting an "attempt" is keyed on encounter IDENTITY (`attemptKey`, the
// meters ledger's Encounter.startedAt), and only counted while the lesson
// is actually WAITING for a fresh one (a stray extra qualifying encounter
// produced while the player is still mid-observation of the current one is
// not miscounted as the comparison run). A caller resets a track with the
// newest qualifying key already on the ledger as `resetHubLessonTrack`'s
// baseline, so unrelated PRIOR practice (before the lesson began, or before
// a replay) can never be mistaken for this lesson's own attempt.

/** Which of the two lessons a step belongs to. */
export type HubLessonTrack = 'damage' | 'healing';

/** One step, always at most one per visible track per frame. */
export type HubLessonStepKind =
  | 'target' // target this track's dummy
  | 'open-window' // no meters surface is open at all
  | 'open-tab' // a surface is open, but not on this track's tab
  | 'act' // tab is open, dummy targeted: land the FIRST qualifying attempt
  | 'read-row' // something landed: read your own row (needs an explicit ack)
  | 'view-breakdown' // row read: hover/focus/hold it for the per-ability split
  | 'end-run' // damage only: breakdown seen; stop and let the fight end
  | 'inspect-history' // damage only: use the history control on the finished run
  | 'compare-again' // damage only: history inspected; land a second, comparable attempt
  | 'review-comparison' // damage only: second attempt landed; review it (needs an ack)
  | 'replay'; // this track is fully observed; targeting it again offers a redo

export interface HubLessonStep {
  readonly track: HubLessonTrack;
  readonly kind: HubLessonStepKind;
  /** Cosmetic only (never gates a transition): whether the run this step is
   *  about is still in progress right now, so the controller can word
   *  "watch it update" differently from "now that the fight's over". */
  readonly live: boolean;
}

/** Mirrors world_api's QuestState so this file needs no sim import. */
export type HubLessonQuestState = 'unavailable' | 'available' | 'active' | 'ready' | 'done';

/** What has actually been observed so far for one track. Plain, serializable
 *  data: the controller persists it per character (localStorage), so a
 *  reload or an early quest turn-in never resets it. */
export interface HubLessonTrackProgress {
  /** distinct qualifying attempts (encounters) counted toward this track */
  readonly attempts: number;
  /** identity (Encounter.startedAt) of the last attempt actually counted,
   *  or the reset-time baseline: never counted again, and nothing older is
   *  eligible either (see resetHubLessonTrack). */
  readonly lastCountedKey: number | null;
  /** round 1: the row was read (rowVisibleNow + an explicit ack together) */
  readonly rowSeen: boolean;
  readonly breakdownViewed: boolean;
  /** damage only: the round-1 attempt has been observed to end */
  readonly runEnded: boolean;
  /** damage only: the history/finished-segment control was used on it,
   *  landing on THIS track's tracked segment (identity-checked) */
  readonly historyViewed: boolean;
  /** damage only: the round-2 (comparison) attempt was read once finished */
  readonly compareReviewed: boolean;
}

export interface HubLessonProgress {
  readonly damage: HubLessonTrackProgress;
  readonly healing: HubLessonTrackProgress;
}

/** One frame's facts about one track, derived by the controller from the
 *  SAME meters ledger (src/ui/meters.ts MeterData) plus real DOM events:
 *  no second combat ledger, no invented signal. */
export interface HubLessonTrackObservation {
  /** The quest is known to this player at all (not 'unavailable'): a healer
   *  class with no usable heal yet, or a class that can never see the
   *  healing drill, never sets this. Independent of 'active'/'ready'/'done'
   *  on purpose (see module header). */
  eligible: boolean;
  targeting: boolean;
  anyWindowOpen: boolean;
  tabOpen: boolean;
  /** Identity of the current round's qualifying attempt (live or just
   *  finished), or null while none exists yet. MUST stay the same value
   *  across frames for the same physical attempt (Encounter.startedAt is
   *  exactly this). */
  attemptKey: number | null;
  /** Is the attempt named by `attemptKey` still live right now? */
  liveNow: boolean;
  /** The player's own row is currently rendered and visible on whichever
   *  surface shows this track's tab. */
  rowVisibleNow: boolean;
  /** An explicit "Continue"/"Done" acknowledgment happened just now (the
   *  controller only renders that control while the matching row is
   *  actually on screen, so this is never available dishonestly). Shared
   *  between the round-1 read-row ack and the round-2 review-comparison
   *  ack: the two can never be simultaneously "live" asks, so one edge flag
   *  is unambiguous. */
  ackNow: boolean;
  /** The row's breakdown-revealing interaction (focus/hover/long-press)
   *  happened just now. */
  breakdownInteractionNow: boolean;
  /** damage only: identity (Encounter.startedAt) of the segment CURRENTLY
   *  displayed by the history control, or null while the currently
   *  displayed segment is the live "current" one (viewing the live segment
   *  is never "inspecting a finished run", whatever its identity). */
  historyViewedKey: number | null;
}

/** Has round 1's full observation (everything short of a second attempt)
 *  been satisfied? Healing has no end-run/history steps, so its round-1
 *  observation is just the row and the breakdown. */
function roundOneObserved(track: HubLessonTrack, p: HubLessonTrackProgress): boolean {
  if (!p.rowSeen || !p.breakdownViewed) return false;
  return track === 'damage' ? p.runEnded && p.historyViewed : true;
}

function isComplete(track: HubLessonTrack, p: HubLessonTrackProgress): boolean {
  if (!roundOneObserved(track, p)) return false;
  if (track === 'healing') return true;
  return p.attempts >= 2 && p.compareReviewed;
}

/** True while the lesson is waiting on a FRESH attempt rather than on
 *  observing one already landed: before attempt 1, and again (damage only)
 *  once round 1 is fully observed but the comparison attempt is still owed. */
function awaitingAttempt(track: HubLessonTrack, p: HubLessonTrackProgress): boolean {
  if (p.attempts === 0) return true;
  return track === 'damage' && p.attempts === 1 && roundOneObserved(track, p);
}

/** Advance one track by one frame, returning its (possibly unchanged)
 *  progress and the step to show, or null when there is nothing to say
 *  (ineligible, or complete and not currently being re-targeted). */
export function advanceHubLessonTrack(
  track: HubLessonTrack,
  progress: HubLessonTrackProgress,
  obs: HubLessonTrackObservation,
): { progress: HubLessonTrackProgress; step: HubLessonStep | null } {
  if (!obs.eligible) return { progress, step: null };

  let next = progress;
  // Only counts a fresh attemptKey while the lesson is actually waiting for
  // one: a stray extra qualifying encounter produced mid-observation (the
  // player kept swinging with the window still closed, say) is not
  // silently promoted into "the comparison run".
  if (
    awaitingAttempt(track, next) &&
    obs.attemptKey !== null &&
    obs.attemptKey !== next.lastCountedKey
  ) {
    next = { ...next, attempts: next.attempts + 1, lastCountedKey: obs.attemptKey };
  }

  if (next.attempts > 0) {
    // Round 1: the row is "read" only on an explicit ack while it is
    // actually visible, never merely because it rendered.
    if (!next.rowSeen && obs.rowVisibleNow && obs.ackNow) next = { ...next, rowSeen: true };
    if (next.rowSeen && obs.rowVisibleNow && obs.breakdownInteractionNow && !next.breakdownViewed) {
      next = { ...next, breakdownViewed: true };
    }
    if (track === 'damage' && next.breakdownViewed && !obs.liveNow && !next.runEnded) {
      next = { ...next, runEnded: true };
    }
    // Only a click landing on the TRACKED first attempt's own now-finished
    // segment counts: a click that pages to the wrong fight, the all-time
    // roll-up, or the still-live current segment is not "inspecting that
    // finished run".
    if (
      track === 'damage' &&
      next.runEnded &&
      !next.historyViewed &&
      obs.historyViewedKey !== null &&
      obs.historyViewedKey === next.lastCountedKey
    ) {
      next = { ...next, historyViewed: true };
    }
    // Round 2 (damage only): landing the second hit was never enough on its
    // own; the comparison attempt also needs its own acknowledged, finished
    // read before the track completes.
    if (
      track === 'damage' &&
      next.attempts >= 2 &&
      roundOneObserved(track, next) &&
      !next.compareReviewed &&
      obs.rowVisibleNow &&
      !obs.liveNow &&
      obs.ackNow
    ) {
      next = { ...next, compareReviewed: true };
    }
  }

  if (isComplete(track, next)) {
    if (track === 'healing' && obs.liveNow) {
      return { progress: next, step: { track, kind: 'end-run', live: true } };
    }
    return { progress: next, step: obs.targeting ? { track, kind: 'replay', live: false } : null };
  }

  if (awaitingAttempt(track, next)) {
    if (!obs.targeting) return { progress: next, step: { track, kind: 'target', live: false } };
    if (!obs.anyWindowOpen)
      return { progress: next, step: { track, kind: 'open-window', live: false } };
    if (!obs.tabOpen) return { progress: next, step: { track, kind: 'open-tab', live: false } };
    const kind = next.attempts === 0 ? 'act' : 'compare-again';
    return { progress: next, step: { track, kind, live: false } };
  }

  // There is an unobserved attempt: window/tab are prerequisites to observe
  // it, re-checked here exactly like above, not only before the first act.
  if (!obs.anyWindowOpen)
    return { progress: next, step: { track, kind: 'open-window', live: false } };
  if (!obs.tabOpen) return { progress: next, step: { track, kind: 'open-tab', live: false } };
  if (!next.rowSeen)
    return { progress: next, step: { track, kind: 'read-row', live: obs.liveNow } };
  if (!next.breakdownViewed) {
    return { progress: next, step: { track, kind: 'view-breakdown', live: obs.liveNow } };
  }
  if (track === 'damage') {
    if (!next.runEnded)
      return { progress: next, step: { track, kind: 'end-run', live: obs.liveNow } };
    if (!next.historyViewed)
      return { progress: next, step: { track, kind: 'inspect-history', live: false } };
    if (next.attempts >= 2 && !next.compareReviewed) {
      return {
        progress: next,
        step: { track, kind: obs.liveNow ? 'end-run' : 'review-comparison', live: obs.liveNow },
      };
    }
  }
  // Unreachable: roundOneObserved (and so isComplete) would already have
  // matched above. Kept as an honest fallback, never asserted.
  return { progress: next, step: null };
}

/** Advance both tracks by one frame. Selecting the healing dummy selects
 *  its lesson even when damage coaching is unfinished.
 *  Returns the SAME `progress` object (by reference) when neither track
 *  actually changed this frame, so a caller can persist on identity change
 *  rather than every call. */
export function advanceHubLesson(
  progress: HubLessonProgress,
  damage: HubLessonTrackObservation,
  healing: HubLessonTrackObservation,
): { progress: HubLessonProgress; step: HubLessonStep | null } {
  const d = advanceHubLessonTrack('damage', progress.damage, damage);
  const h = advanceHubLessonTrack('healing', progress.healing, healing);
  const changed = d.progress !== progress.damage || h.progress !== progress.healing;
  const next = changed ? { damage: d.progress, healing: h.progress } : progress;
  return {
    progress: next,
    step: healing.targeting && !damage.targeting ? (h.step ?? d.step) : (d.step ?? h.step),
  };
}

/**
 * A fresh track, or an explicit reset for the "practice again" affordance
 * (never triggered automatically). `baselineKey` is the newest qualifying
 * attempt ALREADY on the ledger at the moment this is called, or null when
 * there is none: seeding `lastCountedKey` with it is what keeps unrelated
 * prior practice (before the lesson began, or before a replay) from being
 * mistaken for this lesson's own first attempt the instant eligibility (or
 * a fresh round) begins.
 */
export function resetHubLessonTrack(baselineKey: number | null = null): HubLessonTrackProgress {
  return {
    attempts: 0,
    lastCountedKey: baselineKey,
    rowSeen: false,
    breakdownViewed: false,
    runEnded: false,
    historyViewed: false,
    compareReviewed: false,
  };
}

export const HUB_LESSON_TRACK_START: HubLessonTrackProgress = resetHubLessonTrack();

export const HUB_LESSON_START: HubLessonProgress = {
  damage: HUB_LESSON_TRACK_START,
  healing: HUB_LESSON_TRACK_START,
};

/** Whether a track is fully complete (round 1 observed, plus for damage the
 *  reviewed comparison attempt). Exported so a caller can decide whether a
 *  loaded, mid-round track is safe to keep across a reload (see
 *  `isSafeToKeepAcrossReload`) without duplicating the completion rule. */
export function isHubLessonTrackComplete(
  track: HubLessonTrack,
  p: HubLessonTrackProgress,
): boolean {
  return isComplete(track, p);
}

/**
 * Is a LOADED track's progress safe to keep as-is across a fresh page load?
 * Safe when it never started (attempts === 0) or is already complete
 * (nothing left to silently misattribute); unsafe for anything mid-round,
 * because the meters ledger that made that progress real is session-only
 * (client-side, gone on reload): keeping a mid-round `attempts`/`lastCountedKey`
 * around would let a LATER, unrelated fight in the new session silently
 * satisfy the stale round's remaining steps (rowVisibleNow/liveNow read the
 * CURRENT ledger, not the old attempt's identity). The caller resets an
 * unsafe track with `resetHubLessonTrack`, never marking it done.
 */
export function isSafeToKeepAcrossReload(
  track: HubLessonTrack,
  p: HubLessonTrackProgress,
): boolean {
  return p.attempts === 0 || isComplete(track, p);
}

function isValidTrackProgress(v: unknown): v is HubLessonTrackProgress {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.attempts === 'number' &&
    Number.isFinite(p.attempts) &&
    (p.lastCountedKey === null || typeof p.lastCountedKey === 'number') &&
    typeof p.rowSeen === 'boolean' &&
    typeof p.breakdownViewed === 'boolean' &&
    typeof p.runEnded === 'boolean' &&
    typeof p.historyViewed === 'boolean' &&
    typeof p.compareReviewed === 'boolean'
  );
}

/** Safely parse a `JSON.parse`d persisted blob into a HubLessonProgress:
 *  a track whose shape does not match (missing fields, wrong types, `{}`,
 *  a stray `null`, an old pre-migration shape) falls back to a fresh start
 *  for THAT track only, rather than throwing or handing the caller a
 *  half-formed object that crashes the first time a field is read. */
export function parseHubLessonProgress(raw: unknown): HubLessonProgress {
  if (!raw || typeof raw !== 'object') return HUB_LESSON_START;
  const r = raw as Record<string, unknown>;
  return {
    damage: isValidTrackProgress(r.damage) ? r.damage : HUB_LESSON_TRACK_START,
    healing: isValidTrackProgress(r.healing) ? r.healing : HUB_LESSON_TRACK_START,
  };
}

/** The shape of one meters Encounter this module's damage-track helper
 *  reads (src/ui/meters.ts Encounter satisfies this structurally: no second
 *  ledger). Healing has no equivalent helper: MeterData never sets
 *  mainMobTemplateId for a heal-only encounter, so the controller instead
 *  taps real heal2 SimEvents directly (see hub_lesson_controller.ts). */
export interface HubLessonDamageEncounter {
  startedAt: number;
  mainMobTemplateId: string | null;
  tallies: ReadonlyMap<number, { dmg: number }>;
}

/** Whether this encounter is a qualifying damage-track attempt: fought the
 *  right dummy, and the local player landed some of it. */
export function damageEncounterQualifies(
  enc: HubLessonDamageEncounter,
  dummyId: string,
  playerId: number,
): boolean {
  if (enc.mainMobTemplateId !== dummyId) return false;
  return (enc.tallies.get(playerId)?.dmg ?? 0) > 0;
}
