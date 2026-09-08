// Thin, cold consumer of hub_lesson_view.ts: the Eastbrook hub's guided
// practice coaching. Owned and driven by Meters (src/ui/meters.ts), the
// same per-frame call that advances the encounter ledger this reads, so the
// coach can never disagree with what the Damage Meters actually show.
//
// One control at a time, never a wall-of-text card: a single-line prompt in
// the #hub-lesson-coach tracker strip, plus the SAME "press this next" glow
// the Proving Shore coach uses (styles/components.css .qd-coach) applied to
// the real control the current step names. Two steps (read-row,
// review-comparison) additionally show a small explicit acknowledgment
// button, since a row merely rendering is not "reading" it (hub_lesson_view.ts
// owns why). Every guided step but the replay offer ALSO echoes above the
// correct track's dummy, in the island coach's own floating keycap-bubble
// chrome (.tut-prompt, styles/hud.css): `render` paints the exact same html
// both places. On touch, the tracker copy hides itself while the bubble is
// actually on screen (hud.mobile.css), so the two never overlap.
//
// Coaching starts only once Hale's quest is ACCEPTED: `eligible` requires
// 'active'/'ready'/'done', never 'available' or 'unavailable'. A
// re-acceptance after an abandon is treated like a reload boundary
// (`isSafeToKeepAcrossReload`).
//
// Progress is small, plain, and persisted per character (the
// `${playerClass}_${player.name}` key precedent: deeds_window.ts,
// reliquary_window.ts), so a reload or an early quest turn-in never erases
// what has and has not actually been observed. A fresh baseline on first
// eligibility, and again on an explicit replay, seeds `lastCountedKey` to
// whatever already qualifies on the ledger, so prior combat is never
// mistaken for this lesson's own attempt. A track loaded MID-round is reset
// rather than kept: the meters ledger behind it is session-only.
//
// Damage counts off the SAME rule the practice DPS tracker uses (an
// Encounter whose mainMobTemplateId is the hub damage dummy). Healing has
// no such field, so it taps real heal2 SimEvents directly via onEvent().
//
// Gated to the Eastbrook hub practice yard, never Tutorial Island: update()
// bails on a cheap planar-distance check before touching the meters port.

import { currentInputHintMode } from '../../../game/input_hint_mode';
import type { Keybinds } from '../../../game/keybinds';
import {
  HUB_DUMMY_DRILL_QUEST_ID,
  HUB_HEALING_DRILL_QUEST_ID,
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../../../sim/content/practice_dummies';
import { isOnProvingShore } from '../../../sim/content/proving_shore';
import { hubHealingAbilityId } from '../../../sim/tutorial/hub_healing_lesson';
import { startingAttackFor } from '../../../sim/tutorial/starting_attack';
import type { IWorld } from '../../../world_api';
import { nearestMob } from '../../coach_prompt_view';
import { esc } from '../../esc';
import { type TranslationKey, t } from '../../i18n';
import {
  advanceHubLesson,
  HUB_LESSON_START,
  type HubLessonProgress,
  type HubLessonStep,
  type HubLessonTrack,
  type HubLessonTrackObservation,
  isSafeToKeepAcrossReload,
  parseHubLessonProgress,
  resetHubLessonTrack,
} from './hub_lesson_view';

/** The three meters tabs, restated here (not imported from meters.ts) so
 *  this module and meters.ts never form an import cycle: Meters owns and
 *  constructs this controller. */
export type HubMeterTab = 'dmg' | 'heal' | 'threat';

/** The slice of a meters Encounter this controller reads: the SAME object
 *  MeterData.current/history hold, read structurally so no import cycle
 *  with meters.ts is needed. */
export interface HubLessonEncounterLike {
  startedAt: number;
  mainMobTemplateId: string | null;
  tallies: ReadonlyMap<number, { dmg: number; heal: number }>;
}

/** The narrow slice of Meters this controller needs, handed in as plain
 *  callbacks so meters.ts stays the only file that imports both modules. */
export interface HubLessonMetersPort {
  anyWindowOpen(): boolean;
  tabOpen(tab: HubMeterTab): boolean;
  tabButtonElement(tab: HubMeterTab): HTMLElement | null;
  historyArrowElement(tab: HubMeterTab): HTMLElement | null;
  rowElementForPid(tab: HubMeterTab, pid: number): HTMLElement | null;
  /** Identity of whichever segment is CURRENTLY displayed on the panel
   *  showing `tab`, and whether it is the live "current" one, or null while
   *  no such panel is open. Lets the controller reject a history click that
   *  lands on the wrong fight, the all-time roll-up, or the still-live
   *  segment (see hub_lesson_view.ts's `historyViewedKey`). */
  viewedEncounter(tab: HubMeterTab): { startedAt: number; isCurrent: boolean } | null;
  current(): HubLessonEncounterLike | null;
  history(): readonly HubLessonEncounterLike[];
}

/** One ability/item bound to an action-bar slot, index 0 = assignable slot 1 (fixed Attack is slot 0)
 *  (mirrors src/ui/hud/action_bar/hotbar.ts HotbarAction; restated to avoid
 *  pulling the whole action-bar module graph into this one). */
export type HubActionBarSlot = { type: 'ability' | 'item'; id: string } | null;

export interface HubLessonControllerDeps {
  /** #hub-lesson-coach: the tracker-stack strip this paints into. */
  element: HTMLElement;
  world: IWorld;
  keybinds: Keybinds;
  meters: HubLessonMetersPort;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** The active bar's live slots (Hud.actions), for resolving where the
   *  healing lesson's spell actually sits right now. Optional so a caller
   *  with no live bar (a bare test rig) still gets a correct, chip-less
   *  prompt rather than a crash. */
  actionBarSlots?(): readonly HubActionBarSlot[];
  tooltipVisibleFor?(el: HTMLElement): boolean;
  actionButtonForSlot?(slot: number): HTMLElement | null;
  /** The renderer's world-to-screen projection, for the target step's
   *  world-anchored bubble. Absent (a headless/test host) degrades to the
   *  bubble simply never showing, never a guessed screen position. */
  worldToScreen?(x: number, y: number, z: number): { x: number; y: number; behind: boolean };
  /** A connected gamepad's resolved label for a real keybind/action id, when
   *  the player has one bound. Absent (no threaded gamepad state yet, or no
   *  pad connected) degrades to no pad chip, never a fabricated one: see
   *  the module header on why pad/touch never get a guessed control. */
  padLabel?(bindId: string): string | null;
}

const CHECK_INTERVAL_MS = 250;
const HISTORY_KEY_PREFIX = 'woc_hub_lesson_progress';
/** Cosmetic lift above the dummy's own feet for the world-anchored bubble
 *  (matches coach_prompt_view.ts's NPC_LIFT): the dummy's `pos.y` is ALREADY
 *  the sim's resolved ground height for that entity, so there is no reason
 *  to re-derive it from `groundHeight`/`WORLD_SEED` here. */
const HUB_PROMPT_LIFT = 2.5;
/** Minimum screen-space clearance above the bubble's anchor point (it draws
 *  UPWARD from the anchor via translate(-50%,-100%)): below this the text
 *  would clip at the top of the viewport, so the tracker card takes over. */
const PROMPT_TOP_CLEARANCE_PX = 80;
/** Marks the tracker card while the world bubble is actually shown on
 *  screen, so touch CSS can hide the duplicate (hud.mobile.css). */
const BUBBLE_VISIBLE_CLASS = 'hlc-bubble-visible';
/** How far from the yard the coach stays live: wide enough to cover talking
 *  to Hale and standing at either dummy, tight enough that ordinary town
 *  play elsewhere (or Tutorial Island, excluded separately) never sees it. */
const HUB_LESSON_RANGE = 45;
const HUB_LESSON_CENTER = {
  x: (HUB_TRAINING_DUMMY_POS.x + HUB_HEALING_DUMMY_POS.x) / 2,
  z: (HUB_TRAINING_DUMMY_POS.z + HUB_HEALING_DUMMY_POS.z) / 2,
};

function progressKey(world: IWorld): string {
  return `${HISTORY_KEY_PREFIX}_${world.cfg.playerClass}_${world.player.name}`;
}

function planar(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

const STEP_TEXT_KEY: Readonly<Record<HubLessonStep['kind'], TranslationKey>> = {
  target: 'hudChrome.hubLesson.target',
  'open-window': 'hudChrome.hubLesson.openWindow',
  'open-tab': 'hudChrome.hubLesson.openTab',
  act: 'hudChrome.hubLesson.act',
  'read-row': 'hudChrome.hubLesson.readRow',
  'view-breakdown': 'hudChrome.hubLesson.viewBreakdown',
  'end-run': 'hudChrome.hubLesson.endRun',
  'inspect-history': 'hudChrome.hubLesson.inspectHistory',
  'compare-again': 'hudChrome.hubLesson.compareAgain',
  'review-comparison': 'hudChrome.hubLesson.reviewComparison',
  replay: 'hudChrome.hubLesson.replay',
};

/** The steps whose text/tab differ enough between the two tracks to need a
 *  track-specific override (damage attacks a dummy and reads DPS; healing
 *  casts a heal on it and reads HPS). Anything not listed here shares one
 *  neutral key across both tracks. */
const TRACK_STEP_TEXT_KEY: Partial<
  Record<HubLessonStep['kind'], Record<HubLessonTrack, TranslationKey>>
> = {
  'open-tab': {
    damage: 'hudChrome.hubLesson.openTabDamage',
    healing: 'hudChrome.hubLesson.openTabHealing',
  },
  act: { damage: 'hudChrome.hubLesson.actDamage', healing: 'hudChrome.hubLesson.actHealing' },
  'read-row': {
    damage: 'hudChrome.hubLesson.readRowDamage',
    healing: 'hudChrome.hubLesson.readRowHealing',
  },
};

/** Which tab a track's steps refer to. */
function tabFor(track: HubLessonTrack): HubMeterTab {
  return track === 'damage' ? 'dmg' : 'heal';
}

export class HubLessonController {
  private progress: HubLessonProgress;
  private nextCheckAt = 0;
  private lastHtml: string | null = null;
  /** Elements currently wearing the coach glow, cleared and reapplied every
   *  check so a target/quest/tab/language change never strands one. */
  private glowing: HTMLElement[] = [];
  /** The history arrow listener is damage-only (healing never reads it):
   *  ONE binding, never re-derived from the healing track's observation
   *  (that double-bind used to unbind it on every other poll). */
  private boundHistoryArrow: HTMLElement | null = null;
  /** Edge flags set by a real DOM interaction, consumed (and cleared) by
   *  the very next check. */
  private ackSeen: Partial<Record<HubLessonTrack, boolean>> = {};
  /** Identity of the segment a damage-track history click just landed on
   *  (its startedAt), or null when the click landed on the live "current"
   *  segment (never a valid inspection target). Cleared every check. */
  private historyViewedKeyNow: number | null = null;
  /** The healing track's own event-tapped attempt identity (see module
   *  header): the startedAt of the encounter the last qualifying heal2
   *  landed in, or null. */
  private healAttemptKey: number | null = null;
  /** Per-track edge state: was this track ELIGIBLE last frame? The false ->
   *  true transition is what lets a re-acceptance (quest abandoned, then
   *  taken again) be told apart from an ordinary frame, which is when a
   *  baseline reseed may safely run (see `eligible`). */
  private trackWasEligible: Partial<Record<HubLessonTrack, boolean>> = {};
  private disposed = false;

  /** The floating world-anchored bubble (island coach chrome, .tut-prompt),
   *  minted once and reused; null once torn down. Mirrors the SAME html the
   *  tracker card paints (see `render`), so the two can never disagree. */
  private prompt: HTMLElement | null = null;
  private lastPromptHtml: string | null = null;
  private promptVisible = false;

  constructor(private readonly deps: HubLessonControllerDeps) {
    this.progress = this.loadProgress();
  }

  private loadProgress(): HubLessonProgress {
    let loaded = HUB_LESSON_START;
    try {
      const raw = this.deps.storage?.getItem(progressKey(this.deps.world));
      if (raw) loaded = parseHubLessonProgress(JSON.parse(raw));
    } catch {
      loaded = HUB_LESSON_START;
    }
    // A track loaded mid-round is stale: the meters ledger that made its
    // progress real is session-only and gone on this fresh load. Reset it
    // rather than silently mark it done or leave it stuck forever waiting
    // on an attempt identity nothing can ever produce again.
    const damage = isSafeToKeepAcrossReload('damage', loaded.damage)
      ? loaded.damage
      : resetHubLessonTrack(null);
    const healing = isSafeToKeepAcrossReload('healing', loaded.healing)
      ? loaded.healing
      : resetHubLessonTrack(null);
    return damage === loaded.damage && healing === loaded.healing ? loaded : { damage, healing };
  }

  private saveProgress(): void {
    try {
      this.deps.storage?.setItem(progressKey(this.deps.world), JSON.stringify(this.progress));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  /** Tapped by Meters.onEvent for every SimEvent, right after MeterData has
   *  already applied it: the healing track's only route to "an effective
   *  direct heal landed on the hub healing dummy", since MeterData never
   *  sets mainMobTemplateId off a heal. Cheap: bails before touching the
   *  world unless the event is even a candidate. */
  onEvent(ev: {
    type: string;
    sourceId?: number;
    targetId?: number;
    amount?: number;
    hot?: boolean;
  }): void {
    if (this.disposed) return;
    if (ev.type !== 'heal2' || ev.hot === true) return;
    if ((ev.amount ?? 0) <= 0) return;
    if (ev.sourceId !== this.deps.world.player.id) return;
    const target =
      ev.targetId !== undefined ? this.deps.world.entities.get(ev.targetId) : undefined;
    if (!target || target.templateId !== HUB_HEALING_DUMMY_ID) return;
    const enc = this.deps.meters.current();
    if (enc) this.healAttemptKey = enc.startedAt;
  }

  /** `now` is the caller's clock (performance.now from Meters.update). */
  update(now: number): void {
    if (this.disposed || now < this.nextCheckAt) return;
    this.nextCheckAt = now + CHECK_INTERVAL_MS;

    // Cheap gate, checked BEFORE anything that touches the meters port or
    // scans the world: away from the yard (or on Tutorial Island, which
    // runs its own separate coach), there is nothing to say and nothing
    // more expensive than one Math.hypot to find that out.
    const p = this.deps.world.player.pos;
    const inRange = planar(p.x, p.z, HUB_LESSON_CENTER.x, HUB_LESSON_CENTER.z) <= HUB_LESSON_RANGE;
    if (!inRange || isOnProvingShore(p.x, p.z)) {
      this.bindHistoryListener(null);
      this.historyViewedKeyNow = null;
      this.ackSeen = {};
      this.render(null);
      return;
    }

    const damageObs = this.observe('damage');
    const healingObs = this.observe('healing');
    const healingState = this.deps.world.questState(HUB_HEALING_DRILL_QUEST_ID);
    if (
      this.targetTemplateId() === HUB_HEALING_DUMMY_ID ||
      (!damageObs.targeting && (healingState === 'active' || healingState === 'ready'))
    ) {
      damageObs.eligible = false;
    }
    const { progress, step } = advanceHubLesson(this.progress, damageObs, healingObs);
    if (progress !== this.progress) {
      this.progress = progress;
      this.saveProgress();
    }
    // Consume the edge flags now that this frame's transition has read them.
    this.ackSeen.damage = false;
    this.ackSeen.healing = false;
    this.historyViewedKeyNow = null;

    this.render(step);
  }

  private eligible(track: HubLessonTrack): boolean {
    const questId = track === 'damage' ? HUB_DUMMY_DRILL_QUEST_ID : HUB_HEALING_DRILL_QUEST_ID;
    const state = this.deps.world.questState(questId);
    // Coaching starts only once the quest is actually TAKEN: 'available'
    // (Hale has offered it, not yet accepted) must read exactly like
    // 'unavailable' here, or the coach spoke up before the player agreed to
    // the lesson (playtest). 'ready'/'done' stay eligible so a turn-in, or a
    // full replay, never cuts off guidance still owed.
    const eligible = state === 'active' || state === 'ready' || state === 'done';
    const wasEligible = this.trackWasEligible[track] === true;
    this.trackWasEligible[track] = eligible;
    if (!eligible || wasEligible) return eligible;
    // The moment this track turns eligible: either its very first
    // acceptance, or a RE-acceptance after an abandon dropped it back to
    // 'available'. A mid-round track is exactly as stale here as it is
    // across a reload (the meters ledger that made its progress real belongs
    // to the acceptance that just ended), so it takes the identical reset
    // rather than resuming toward an attempt identity the current ledger can
    // never match again.
    if (!isSafeToKeepAcrossReload(track, this.progress[track])) {
      this.progress = {
        ...this.progress,
        [track]: resetHubLessonTrack(this.latestQualifyingKey(track)),
      };
      return eligible;
    }
    // A track with no attempt of its OWN yet: (re)seed the baseline off
    // whatever qualifies on the ledger RIGHT NOW, unconditionally, even when
    // that is null (nothing qualifies right now) or unchanged from before.
    // A stale non-null baseline from a PRIOR acceptance is exactly as wrong
    // to keep as no baseline at all: combat landed between the abandon and
    // this re-acceptance must never count as this round's first attempt, so
    // the baseline has to track "qualifies now", not "qualified once,
    // whenever that was". A completed track (attempts > 0) is untouched.
    if (this.progress[track].attempts === 0) {
      this.progress = {
        ...this.progress,
        [track]: resetHubLessonTrack(this.latestQualifyingKey(track)),
      };
    }
    return eligible;
  }

  private dummyIdFor(track: HubLessonTrack): string {
    return track === 'damage' ? HUB_TRAINING_DUMMY_ID : HUB_HEALING_DUMMY_ID;
  }

  private targetTemplateId(): string | null {
    const targetId = this.deps.world.player.targetId;
    if (targetId === null) return null;
    return this.deps.world.entities.get(targetId)?.templateId ?? null;
  }

  /** The newest qualifying attempt already on the ledger for `track`, used
   *  only for the eligibility-baseline seed above. Damage reads the shared
   *  Encounter ledger; healing has only its own event-tapped key. */
  private latestQualifyingKey(track: HubLessonTrack): number | null {
    if (track === 'healing') return this.healAttemptKey;
    const dummyId = this.dummyIdFor(track);
    const pid = this.deps.world.player.id;
    const qualifies = (enc: HubLessonEncounterLike) =>
      enc.mainMobTemplateId === dummyId && (enc.tallies.get(pid)?.dmg ?? 0) > 0;
    const current = this.deps.meters.current();
    if (current && qualifies(current)) return current.startedAt;
    for (const enc of this.deps.meters.history()) if (qualifies(enc)) return enc.startedAt;
    return null;
  }

  private observe(track: HubLessonTrack): HubLessonTrackObservation {
    const eligible = this.eligible(track);
    if (!eligible) {
      if (track === 'damage') this.bindHistoryListener(null);
      return {
        eligible: false,
        targeting: false,
        anyWindowOpen: false,
        tabOpen: false,
        attemptKey: null,
        liveNow: false,
        rowVisibleNow: false,
        ackNow: false,
        breakdownInteractionNow: false,
        historyViewedKey: null,
      };
    }
    const tab = tabFor(track);
    const targeting = this.targetTemplateId() === this.dummyIdFor(track);
    const anyWindowOpen = this.deps.meters.anyWindowOpen();
    const tabOpen = this.deps.meters.tabOpen(tab);
    const pid = this.deps.world.player.id;

    let attemptKey: number | null;
    let liveNow = false;
    if (track === 'damage') {
      const dummyId = this.dummyIdFor(track);
      const qualifies = (enc: HubLessonEncounterLike) =>
        enc.mainMobTemplateId === dummyId && (enc.tallies.get(pid)?.dmg ?? 0) > 0;
      const current = this.deps.meters.current();
      if (current && qualifies(current)) {
        attemptKey = current.startedAt;
        liveNow = true;
      } else {
        attemptKey = null;
        for (const enc of this.deps.meters.history()) {
          if (qualifies(enc)) {
            attemptKey = enc.startedAt;
            break;
          }
        }
      }
    } else {
      attemptKey = this.healAttemptKey;
      const current = this.deps.meters.current();
      liveNow = current !== null && attemptKey !== null && current.startedAt === attemptKey;
    }

    const rowEl = anyWindowOpen && tabOpen ? this.deps.meters.rowElementForPid(tab, pid) : null;
    const progress = this.progress[track];
    const waitingForSecond =
      track === 'damage' && progress.attempts === 1 && progress.historyViewed;
    const trackedKey =
      progress.attempts === 0 || waitingForSecond ? attemptKey : progress.lastCountedKey;
    const viewed = this.deps.meters.viewedEncounter(tab);
    const correctRow = rowEl !== null && trackedKey !== null && viewed?.startedAt === trackedKey;
    liveNow = trackedKey !== null && this.deps.meters.current()?.startedAt === trackedKey;
    if (track === 'damage') {
      const historyArrow =
        anyWindowOpen && tabOpen ? this.deps.meters.historyArrowElement(tab) : null;
      this.bindHistoryListener(historyArrow);
    }

    return {
      eligible: true,
      targeting,
      anyWindowOpen,
      tabOpen,
      attemptKey,
      liveNow,
      rowVisibleNow: correctRow,
      ackNow: this.ackSeen[track] === true,
      breakdownInteractionNow: correctRow && !!this.deps.tooltipVisibleFor?.(rowEl!),
      historyViewedKey: track === 'damage' ? this.historyViewedKeyNow : null,
    };
  }

  /** Reads the CURRENTLY viewed segment at click time (the meters panel's
   *  own click listener on this SAME element already ran and updated its
   *  view index by the time this fires, since it was bound first): only a
   *  genuinely non-current segment counts as an inspection target. */
  private readonly onHistoryInteraction = (): void => {
    const info = this.deps.meters.viewedEncounter('dmg');
    this.historyViewedKeyNow = info && !info.isCurrent ? info.startedAt : null;
  };

  private bindHistoryListener(el: HTMLElement | null): void {
    if (this.boundHistoryArrow === el) return;
    if (this.boundHistoryArrow)
      this.boundHistoryArrow.removeEventListener('click', this.onHistoryInteraction);
    this.boundHistoryArrow = el;
    if (el) el.addEventListener('click', this.onHistoryInteraction);
  }

  private readonly onAckClick = (track: HubLessonTrack): void => {
    this.ackSeen[track] = true;
  };

  /** Explicit "practice again" affordance: resets exactly one track,
   *  seeding the new baseline off whatever already qualifies right now so
   *  the OLD, already-reviewed run cannot be mistaken for the fresh one's
   *  first attempt. Never called automatically. */
  private replay(track: HubLessonTrack): void {
    const baseline = this.latestQualifyingKey(track);
    this.progress = { ...this.progress, [track]: resetHubLessonTrack(baseline) };
    this.saveProgress();
  }

  /** Tears down every listener, the coach glow, and the world prompt: an
   *  unmount for a host whose lifecycle actually discards Meters (a bare
   *  test rig; production reconstructs Meters only across a full page
   *  load, which already discards everything by itself). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bindHistoryListener(null);
    this.clearGlow();
    this.hidePrompt();
    if (this.prompt) this.prompt.remove();
    this.prompt = null;
    this.lastPromptHtml = null;
    if (this.lastHtml !== null) {
      this.lastHtml = null;
      this.deps.element.innerHTML = '';
      this.deps.element.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------
  // Paint: the HUD card, the control glow, and the world-anchored prompt.
  // ---------------------------------------------------------------------

  private clearGlow(): void {
    for (const el of this.glowing) el.classList.remove('qd-coach');
    this.glowing = [];
  }

  private glow(...els: (HTMLElement | null)[]): void {
    const next = els.filter((el): el is HTMLElement => el !== null);
    for (const el of this.glowing) if (!next.includes(el)) el.classList.remove('qd-coach');
    for (const el of next) el.classList.add('qd-coach');
    this.glowing = next;
  }

  private render(step: HubLessonStep | null): void {
    if (!step) {
      this.clearGlow();
      this.hidePrompt();
      this.syncBubbleFlag();
      if (this.lastHtml !== null) {
        this.lastHtml = null;
        this.deps.element.innerHTML = '';
        this.deps.element.style.display = 'none';
      }
      return;
    }

    if (step.kind === 'target') {
      this.clearGlow();
    } else {
      this.paintControlGlow(step);
    }

    const html = this.markup(step);
    if (html !== this.lastHtml) {
      if (this.lastHtml === null) this.deps.element.style.display = 'block';
      this.lastHtml = html;
      this.deps.element.innerHTML = html;
      const replayBtn = this.deps.element.querySelector<HTMLButtonElement>('.hlc-replay');
      replayBtn?.addEventListener('click', () => this.replay(step.track));
      const ackBtn = this.deps.element.querySelector<HTMLButtonElement>('.hlc-ack');
      ackBtn?.addEventListener('click', () => this.onAckClick(step.track));
    }

    // Every step but the replay offer also echoes above the dummy (see
    // `updateWorldPrompt`); replay is a tracker-only affordance.
    if (step.kind === 'replay') {
      this.hidePrompt();
    } else {
      this.updateWorldPrompt(step, html);
    }
    this.syncBubbleFlag();
  }

  /** Reflects `promptVisible` onto the tracker card so touch CSS can hide
   *  the duplicate copy while the bubble is on screen (hud.mobile.css). */
  private syncBubbleFlag(): void {
    this.deps.element.classList.toggle(BUBBLE_VISIBLE_CLASS, this.promptVisible);
  }

  private paintControlGlow(step: HubLessonStep): void {
    const tab = tabFor(step.track);
    const pid = this.deps.world.player.id;
    if (this.needsTrackedRun(step)) {
      this.glow(this.deps.meters.historyArrowElement(tab));
    } else if (step.kind === 'open-window') {
      this.glow(this.visibleMobileControl('mobile-meters'));
    } else if (step.kind === 'open-tab') {
      this.glow(this.deps.meters.tabButtonElement(tab));
    } else if (
      step.kind === 'read-row' ||
      step.kind === 'view-breakdown' ||
      step.kind === 'review-comparison'
    ) {
      this.glow(this.deps.meters.rowElementForPid(tab, pid));
    } else if (step.kind === 'inspect-history') {
      this.glow(
        this.deps.meters.historyArrowElement(tab),
        this.deps.meters.rowElementForPid(tab, pid),
      );
    } else if (
      (step.kind === 'act' || step.kind === 'compare-again') &&
      this.abilitySlot(step.track) === 'missing'
    ) {
      // The resolved heal isn't on the bar at all: point at the Spellbook,
      // never an unrelated slot (see the module header and healChip()).
      this.glow(this.visibleMobileControl('mobile-menu-spellbook'));
    } else if (step.kind === 'act' || step.kind === 'compare-again') {
      const slot = this.abilitySlot(step.track);
      this.glow(typeof slot === 'number' ? (this.deps.actionButtonForSlot?.(slot) ?? null) : null);
    } else {
      this.clearGlow();
    }
  }

  private markup(step: HubLessonStep): string {
    const wrongRun = this.needsTrackedRun(step);
    const text = esc(
      t(wrongRun ? 'hudChrome.hubLesson.findRun' : this.textKeyFor(step), {
        menu: t('hudChrome.mobile.quickActionsLabel'),
        more: t('hud.core.mobileMore'),
        meters: t('hud.keybinds.actions.meters'),
      }),
    );
    const chip = this.chipFor(step);
    const chipHtml = chip ? `<span class="hlc-chip">${esc(chip)}</span>` : '';
    const ackHtml =
      !wrongRun && (step.kind === 'read-row' || step.kind === 'review-comparison')
        ? `<button type="button" class="hlc-ack btn">${esc(
            t(
              step.kind === 'read-row'
                ? 'hudChrome.hubLesson.ackContinue'
                : 'hudChrome.hubLesson.ackDone',
            ),
          )}</button>`
        : '';
    const replayHtml =
      step.kind === 'replay'
        ? `<button type="button" class="hlc-replay btn">${esc(t('hudChrome.hubLesson.replayAction'))}</button>`
        : '';
    return `<div class="hlc-line">${text}${chipHtml}</div>${ackHtml}${replayHtml}`;
  }

  private textKeyFor(step: HubLessonStep): TranslationKey {
    if (step.kind === 'open-window' && currentInputHintMode() === 'touch')
      return 'hudChrome.hubLesson.openWindowTouch';
    if (step.kind === 'end-run' && step.track === 'healing')
      return 'hudChrome.hubLesson.endHealingRun';
    if (
      (step.kind === 'act' || step.kind === 'compare-again') &&
      this.abilitySlot(step.track) === 'missing'
    ) {
      return step.track === 'healing'
        ? 'hudChrome.hubLesson.addToBar'
        : 'hudChrome.hubLesson.addAttackToBar';
    }
    return TRACK_STEP_TEXT_KEY[step.kind]?.[step.track] ?? STEP_TEXT_KEY[step.kind];
  }

  /** The resolved keybind/pad chip, or null when none can be shown honestly
   *  right now (mode has no fixed key/binding for this ask, or touch, which
   *  never gets a text chip: its affordance is the glow above, exactly like
   *  the Proving Shore coach's own touch bubbles). Never a guessed or
   *  wrong-slot chip: see module header. */
  private chipFor(step: HubLessonStep): string | null {
    if (step.kind === 'open-window') return this.bindLabel('meters');
    if (step.kind === 'act' || step.kind === 'compare-again') {
      const slot = this.abilitySlot(step.track);
      return this.bindLabel(typeof slot === 'number' ? `slot${slot}` : 'spellbook');
    }
    return null;
  }

  /** Keyboard resolves the live keybind; a connected pad resolves through
   *  the injected `padLabel` seam when the player has one bound; touch
   *  never gets a text chip. */
  private bindLabel(bindId: string): string | null {
    const mode = currentInputHintMode();
    if (mode === 'keyboard') return this.deps.keybinds.primaryLabel(bindId) || null;
    if (mode === 'pad') return this.deps.padLabel?.(bindId) ?? null;
    return null;
  }

  private abilitySlot(track: HubLessonTrack): number | 'missing' {
    const cls = this.deps.world.cfg.playerClass;
    const attack = startingAttackFor(cls);
    if (track === 'damage' && (attack.isAutoAttack || attack.needsResourceFirst)) return 0;
    const abilityId =
      track === 'healing'
        ? hubHealingAbilityId(cls, this.deps.world.player.level)
        : attack.abilityId;
    const slot = (this.deps.actionBarSlots?.() ?? []).findIndex(
      (a) => a?.type === 'ability' && a.id === abilityId,
    );
    return slot >= 0 ? slot + 1 : 'missing';
  }

  private needsTrackedRun(step: HubLessonStep): boolean {
    if (!['read-row', 'view-breakdown', 'review-comparison'].includes(step.kind)) return false;
    const key = this.progress[step.track].lastCountedKey;
    return this.deps.meters.viewedEncounter(tabFor(step.track))?.startedAt !== key;
  }

  private visibleMobileControl(id: string): HTMLElement | null {
    // Open the quick menu, then More when needed, before pointing at a hidden entry.
    for (const candidate of [id, 'mobile-more', 'mobile-menu-anchor']) {
      const el = document.getElementById(candidate);
      if (el && el.getClientRects().length > 0) return el;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // The world-anchored bubble: island coach chrome (.tut-prompt,
  // .tut-prompt-hub-lesson), painted with the SAME html as the tracker.
  // Hidden when the dummy is missing, off-viewport, too close to the top
  // edge to fit, or (via `render`'s own gates) out of yard/ineligible/torn
  // down.
  // ---------------------------------------------------------------------

  private updateWorldPrompt(step: HubLessonStep, html: string): void {
    const dummyId = this.dummyIdFor(step.track);
    const playerPos = this.deps.world.player.pos;
    const mob = nearestMob(this.deps.world.entities.values(), dummyId, playerPos);
    if (!mob) {
      this.hidePrompt();
      return;
    }
    if (!this.prompt) this.mountPrompt();
    if (!this.prompt) return;

    if (html !== this.lastPromptHtml) {
      this.lastPromptHtml = html;
      this.prompt.innerHTML = html;
      // A real, accessible button: this bubble is a visible actionable
      // surface, not decorative chrome.
      const ackBtn = this.prompt.querySelector<HTMLButtonElement>('.hlc-ack');
      ackBtn?.addEventListener('click', () => this.onAckClick(step.track));
    }

    // The dummy's own pos.y is already the sim's resolved ground height for
    // that entity: no reason to re-derive it via groundHeight/WORLD_SEED.
    const full = this.deps.world.entities.get(mob.id);
    const groundY = (full?.pos.y ?? 0) + HUB_PROMPT_LIFT;
    // No renderer to project through in a headless/test host: the DOM
    // element simply never shows, which is the correct degrade.
    const projected = this.deps.worldToScreen?.(mob.pos.x, groundY, mob.pos.z);
    // worldToScreen's own `behind` only checks camera-space depth, not
    // viewport bounds, so an off-screen x/y (or one too close to the top
    // for the upward-drawing bubble to fit) needs its own check here.
    if (
      !projected ||
      projected.behind ||
      projected.x < 0 ||
      projected.x > window.innerWidth ||
      projected.y < PROMPT_TOP_CLEARANCE_PX ||
      projected.y > window.innerHeight
    ) {
      this.hidePrompt();
      return;
    }
    this.prompt.style.display = 'flex';
    this.prompt.style.left = `${Math.round(projected.x * 2) / 2}px`;
    this.prompt.style.top = `${Math.round(projected.y * 2) / 2}px`;
    this.promptVisible = true;
  }

  private mountPrompt(): void {
    const ui = document.getElementById('ui');
    if (!ui) return;
    const el = document.createElement('div');
    // Deliberately NOT aria-hidden: it can carry a real ack button.
    el.className = 'tut-prompt tut-prompt-hub-lesson';
    ui.appendChild(el);
    this.prompt = el;
  }

  private hidePrompt(): void {
    if (this.prompt) this.prompt.style.display = 'none';
    this.promptVisible = false;
  }
}
