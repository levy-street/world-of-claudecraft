// The Proving Shore coach overlay: the island tutorial's guidance, carried
// ENTIRELY by things in the world rather than by prose.
//
// There used to be a card pinned to the top of the screen narrating every
// step. It was the thing new players read least and disliked most (CX), so
// it is gone rather than shrunk, and everything it said now has a visual
// home:
//   the golden ground trail            where to walk (render/coach_trail_core)
//   the target's aura and beam         which thing is the objective
//   the floating keycap bubble         which button, on the thing itself
//   the CENTRED keycap bubble          the same, for an interface press with
//                                      no world anchor (bags, sheet, camera)
//   the pulsing bag stack / buttons    which item or menu to click
//   the quest tracker's own counts     how many are left
// There is deliberately no skip button and nothing to dismiss.
//
// The flag tally is the QUEST'S OWN objective count (the sim credits one
// count per flag passed in order, tutorial/gauntlet_run.ts), so the card,
// the quest tracker, and the server can never disagree about a tag, and
// progress survives reloads with the character rather than the device. The
// end-of-course camera lesson is the one client-side tally (accumulated
// view-yaw travel): it teaches a camera the sim never sees. While a card is
// up the body carries the bc-coach-up class, and the quest dialog shifts
// down below the card (styles/hud.css) so an NPC's dialogue never covers
// the lesson. Reads world state, writes none, and runs identically against
// the offline Sim and the online ClientWorld.

import type { CrossHotbarLayout } from '../game/cross_hotbar';
import type { GamepadBindingEntry } from '../game/gamepad_bindings';
import {
  type GamepadControlHintIntent,
  type GamepadControlHintSource,
  gamepadControlHint,
} from '../game/gamepad_control_hint';
import type { GamepadKind } from '../game/gamepad_map';
import { currentInputHintMode } from '../game/input_hint_mode';
import type { Keybinds } from '../game/keybinds';
import { voice } from '../game/voice';
import { coachTrailPlan, distanceToTrail } from '../render/coach_trail_core';
import type { Renderer } from '../render/renderer';
import { BOOTCAMP_COURSE_CHECKPOINTS, isOnProvingShore } from '../sim/content/proving_shore';
import { GAUNTLET_QUEST_ID } from '../sim/tutorial/gauntlet_run';
import { startingAttackFor } from '../sim/tutorial/starting_attack';
import { groundHeight, WATER_LEVEL } from '../sim/world';
import { WORLD_SEED } from '../sim/world_seed';
import type { IWorld } from '../world_api';
import { bagsWindowShown } from './bags_view';
import {
  BELL_STEP_TARGET,
  type BootcampParam,
  type BootcampStep,
  bellCardPlan,
  bootcampBodyPlan,
  bootcampKeycaps,
  bootcampTitleKey,
  CAMERA_LESSON_TRAVEL_RAD,
  type CoachFocus,
  type CoachParam,
  type CoachState,
  coachCardPlan,
  coachFocus,
  coachKeycaps,
  computeBootcampStep,
  DEATH_LESSON_QUEST_ID,
  type DeathLessonPhase,
  RING_LESSON_ITEM_ID,
  RING_LESSON_QUEST_ID,
  type RingLessonPhase,
  ringCardPlan,
  ringLessonPhase,
} from './bootcamp_view';
import {
  CASTER_CLASSES,
  type CoachPromptPlan,
  coachGlowBagItemId,
  coachGlowButtonId,
  coachGlowQuestId,
  coachGlowVendorItemId,
  coachPromptChip,
  coachPromptChips,
  coachPromptInRange,
  coachPromptPlan,
  GUIDE_VOICE_LINES,
  type GuideVoiceLineName,
  type PromptChip,
  parkourPromptPlan,
  pouchLessonActive,
  turnAskOwnsBubble,
  VEER_GRACE_MS,
  VEER_NUDGE_COOLDOWN_MS,
  VEER_NUDGES_PER_STATION,
  VEER_OFF_YD,
} from './coach_prompt_view';
import { tEntity } from './entity_i18n';
import { formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import {
  type ObjectiveGlowPlan,
  objectiveGlowFromScreen,
  uiLessonGlow,
} from './objective_glow_view';
import { svgIcon } from './ui_icons';

/** Peak opacity of the wrong-way bloom at full intensity. Deliberately shy of
 *  opaque: it is a hint at the edge of vision, never a curtain. */
const GLOW_MAX_OPACITY = 0.72;

/** Eye height for the objective's projection: a nameplate's worth above the
 *  ground, so "on screen" means the marker a player would actually see. */
const GLOW_TARGET_LIFT = 2;

/** The Attack toggle's icon id (hud.ts resolves ATTACK_ICON_KEY to it). */
const AUTO_ATTACK_ICON_ID = 'attack';

interface CoachGamepadBindings {
  entries(): GamepadBindingEntry[];
  kind(): GamepadKind;
  crossHotbarEnabled?(): boolean;
  crossHotbarSets?(): CrossHotbarLayout;
  crossHotbarSet?(): number;
}

// The island rectangle: the card never shows off the Proving Shore. Both
// axes matter; the x column alone also covers four mainland zones
// (isOnProvingShore's contract).

export class BootcampOverlay {
  private engaged = false;
  private step: BootcampStep | null = null;
  private lastCounts = 0;
  // The camera lesson's client-side tally: accumulated view-yaw travel.
  private cameraTravel = 0;
  private cameraLastYaw: number | null = null;
  // Latched when the rail's last quest is seen moving this session, so the
  // closing bell card only follows a graduation, never a casual revisit.
  private sawSail = false;
  private bellPhase = false;
  // The ring equip lesson (bootcamp_view.ts ringLessonPhase): armed only
  // when the pearl quest is seen moving THIS session (a reload with the
  // ring already worn must not resurrect the card), ended when the
  // character sheet is opened or the admire nudge times out.
  private sawPearl = false;
  private ringPhase: RingLessonPhase | null = null;
  private ringCharSeen = false;
  private ringAdmireUntil = 0;
  private ringDone = false;
  // Casters learn their slot-2 spell, not the melee Attack (Guy's note).
  private casterClass = false;
  // The attack THIS class was taught (starting_attack.ts), resolved once per
  // update beside casterClass so the card and the bubble read the same
  // answer without either reaching for the world again.
  private taughtAbilityId: string | null = null;
  private deathPhase: DeathLessonPhase = 'alive';

  private root: HTMLElement | null = null;
  private lastFocus: CoachFocus | null = null;
  // The floating interact bubble (coach_prompt_view.ts): shown only while
  // standing in interact reach of the coach's current target, so the one
  // button that matters appears where the player is already looking.
  private prompt: HTMLElement | null = null;
  private promptChipEl: HTMLElement | null = null;
  private promptVerbEl: HTMLElement | null = null;
  private promptContentKey = '';
  private promptPainted = { visible: false, sx: Number.NaN, sy: Number.NaN };
  private promptGroundKey = '';
  private promptGroundY = 0;
  // Which mobile cluster button pulses gold for the visible ask (touch only;
  // coachGlowButtonId). Cleared whenever the bubble hides.
  private promptButtonGlow:
    | 'mobile-interact'
    | 'mobile-jump'
    | 'mobile-action-attack'
    | 'mobile-slot-primary'
    | null = null;
  // The wrong-way edge glow's element and its repaint memo.
  private glowEl: HTMLElement | null = null;
  private glowPainted = '';

  // Called every HUD frame. Cheap no-op while no rail quest is moving.
  update(
    world: IWorld,
    renderer: Renderer,
    keybinds: Keybinds,
    gamepadBindings: CoachGamepadBindings | null = null,
  ): void {
    const p = world.player;
    if (!p) return;
    if (world.playerId < 0 || p.id !== world.playerId) return;

    const onIsland = isOnProvingShore(p.pos?.x ?? 0, p.pos?.z ?? 0);
    const focus = onIsland ? coachFocus((questId) => railQuestState(world, questId)) : null;
    if (focus?.questId === 'q_ps_set_sail') this.sawSail = true;

    if (!focus) {
      // Rail finished or not offered. A graduate still standing on the
      // island gets the closing bell card; leaving the island (the bell
      // ride itself) folds everything and clears the graduation latch.
      this.bellPhase = onIsland && this.sawSail;
      if (!onIsland) this.sawSail = false;
      if (!this.bellPhase) {
        if (this.engaged) this.disengage();
        return;
      }
    } else {
      this.bellPhase = false;
    }

    this.lastFocus = focus;
    this.casterClass = CASTER_CLASSES.has(world.cfg.playerClass);
    this.taughtAbilityId = startingAttackFor(world.cfg.playerClass).abilityId;
    // The death lesson's arc, read straight off the player: alive, dead but
    // not yet released, or walking back as a spirit.
    this.deathPhase = p.ghost ? 'ghost' : p.dead ? 'dead' : 'alive';
    if (focus?.questId === RING_LESSON_QUEST_ID) this.sawPearl = true;
    this.ringPhase = this.computeRingPhase(world, onIsland);
    const isGauntlet = focus?.questId === GAUNTLET_QUEST_ID;
    this.lastCounts = isGauntlet ? questCounts(world) : 0;

    // The camera lesson's yaw tally runs off the live renderer view. It only
    // accumulates once the run's flags are all tagged; a fresh run (abandon
    // and retake) starts the tally over.
    if (isGauntlet && this.lastCounts >= BOOTCAMP_COURSE_CHECKPOINTS.length) {
      const yaw = renderer.camYaw;
      if (this.cameraLastYaw !== null) {
        this.cameraTravel += Math.abs(wrapAngle(yaw - this.cameraLastYaw));
      }
      this.cameraLastYaw = yaw;
    } else {
      this.cameraTravel = 0;
      this.cameraLastYaw = null;
    }
    const cameraTurned = this.cameraTravel >= CAMERA_LESSON_TRAVEL_RAD;

    this.engaged = true;
    // Mint the coach DOM on ENGAGEMENT, not as a caption side effect: the
    // keepsake-ring round deleted the coach card whose renderPanel() used to
    // ensureDom() every engage, leaving showCaption() the only minter. A
    // session that resumes MID-LESSON (station already active/ready, so the
    // one-shot arrival caption never fires) then no-ops every instruction
    // bubble and edge glow for the whole session. Idempotent.
    this.ensureDom();
    const mode = currentInputHintMode();
    let nextRenderKey: string;
    if (this.bellPhase) {
      this.step = null;
      nextRenderKey = `bell:${mode}`;
    } else if (this.ringPhase !== null) {
      this.step = null;
      nextRenderKey = `ring:${this.ringPhase}:${mode}`;
    } else if (isGauntlet) {
      const next = computeBootcampStep({
        questActive: focus!.state !== 'available',
        checkpointsReached: this.lastCounts,
        cameraTurned,
      });
      this.step = next;
      nextRenderKey = `gauntlet:${next}:${mode}`;
    } else {
      this.step = null;
      nextRenderKey = `${focus!.questId}:${focus!.state}:${mode}`;
    }

    this.ensureDom();
    this.updatePrompt(world, renderer, keybinds, gamepadBindings);
    this.paintObjectiveGlow(world, renderer);
    this.applyUiGlow(world);
    this.updateGuideVoice(world, focus);
  }

  // ---- Ferryman Odo's guiding voice --------------------------------------
  // One-shot reactions to the player's FIRST actions (first flag, the run
  // hand-in, each station handed back), a veer-off-the-trail nudge, and the
  // graduation send-off. The clip is optional garnish (voice.play on an
  // unrendered key is a silent no-op); the caption under the coach card is
  // the always-on half. Session-scoped one-shot latches: a reload re-greets,
  // which reads as warmth, not a bug.
  private guidePrevStation: string | null = null;
  private guidePrevCounts = -1;
  private guideSpoken = new Set<GuideVoiceLineName>();
  private guideStationParity = false;
  private guideVeerCheckedAt = 0;
  private guideOffPathSince: number | null = null;
  private guideLastNudgeAt = 0;
  private guideNudges = 0;
  private captionEl: HTMLElement | null = null;
  private captionTimer: ReturnType<typeof setTimeout> | null = null;

  private updateGuideVoice(world: IWorld, focus: CoachFocus | null): void {
    if (!this.engaged) return;
    const stationKey = this.bellPhase ? 'bell' : focus ? `${focus.questId}:${focus.state}` : 'none';
    if (stationKey !== this.guidePrevStation) {
      const prev = this.guidePrevStation;
      if (stationKey === 'bell') {
        this.speak('graduate');
      } else if (prev === null && focus?.state === 'available') {
        this.speak('arrival');
      } else if (prev?.endsWith(':ready') && focus && !prev.startsWith(`${focus.questId}:`)) {
        // A hand-in just landed: alternate the two encouragement lines.
        this.speak(this.guideStationParity ? 'stationDoneB' : 'stationDoneA', true);
        this.guideStationParity = !this.guideStationParity;
      }
      this.guidePrevStation = stationKey;
      this.guideNudges = 0;
      this.guideOffPathSince = null;
    }
    if (focus?.questId === GAUNTLET_QUEST_ID) {
      if (this.guidePrevCounts === 0 && this.lastCounts === 1) this.speak('firstFlag');
      if (this.guidePrevCounts >= 0 && this.guidePrevCounts < BOOTCAMP_COURSE_CHECKPOINTS.length) {
        if (this.lastCounts >= BOOTCAMP_COURSE_CHECKPOINTS.length) this.speak('runDone');
      }
      this.guidePrevCounts = this.lastCounts;
    } else {
      this.guidePrevCounts = -1;
    }
    this.updateVeerNudge(world);
  }

  private updateVeerNudge(world: IWorld): void {
    const now = performance.now();
    if (now - this.guideVeerCheckedAt < 1000) return;
    this.guideVeerCheckedAt = now;
    const p = world.player;
    if (!p) return;
    const ghostBody =
      world.player?.ghost && world.player.corpsePos
        ? { x: world.player.corpsePos.x, z: world.player.corpsePos.z }
        : null;
    const plan = coachTrailPlan(
      {
        questState: (id) => world.questState(id),
        questLog: world.questLog,
        playerPos: world.player ? { x: world.player.pos.x, z: world.player.pos.z } : undefined,
        corpsePos: ghostBody,
      },
      this.lastCounts,
    );
    if (!plan) {
      this.guideOffPathSince = null;
      return;
    }
    const d = distanceToTrail(plan.points, p.pos.x, p.pos.z);
    if (d <= VEER_OFF_YD) {
      this.guideOffPathSince = null;
      return;
    }
    if (this.guideOffPathSince === null) {
      this.guideOffPathSince = now;
      return;
    }
    if (now - this.guideOffPathSince < VEER_GRACE_MS) return;
    if (this.guideNudges >= VEER_NUDGES_PER_STATION) return;
    if (now - this.guideLastNudgeAt < VEER_NUDGE_COOLDOWN_MS) return;
    this.guideLastNudgeAt = now;
    this.guideNudges += 1;
    this.guideOffPathSince = null;
    this.speak('veerOff', true);
  }

  private speak(name: GuideVoiceLineName, repeatable = false): void {
    if (!repeatable) {
      if (this.guideSpoken.has(name)) return;
      this.guideSpoken.add(name);
    }
    const line = GUIDE_VOICE_LINES[name];
    // Never talk over a dialog greeting or another guide line mid-play; the
    // caption still lands, so the guidance is never lost with the audio.
    if (!voice.isPlaying()) voice.play(line.clip);
    this.showCaption(t(line.caption));
  }

  private showCaption(text: string): void {
    this.ensureDom();
    if (!this.root) return;
    if (!this.captionEl) {
      const el = document.createElement('div');
      el.className = 'tut-voice';
      this.root.appendChild(el);
      this.captionEl = el;
    }
    const odo = tEntity({ kind: 'npc', id: 'ferryman_odo', field: 'name' });
    this.captionEl.textContent = `${odo}: "${text}"`;
    this.captionEl.style.display = '';
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => {
      if (this.captionEl) this.captionEl.style.display = 'none';
    }, 8000);
  }

  // Toggle the press-this-next glow (.qd-coach) on whichever window controls
  // match the current station: the tracker title, the quest-log row, the
  // vendor's pouch row, the bagged pouch stack. Windows rebuild their DOM
  // freely, so the class is re-synced on a short cadence rather than hooked
  // into every painter; the toggles are same-state no-ops between changes.
  private glowTick = 0;

  /** How long the "press C" nudge stays up after the ring is worn before
   *  the lesson lets go on its own. */
  private static readonly RING_ADMIRE_MS = 45000;

  /** The ring lesson's live phase: pure decision (bootcamp_view.ts) driven
   *  by the world's bags and fingers, plus this driver's session latches
   *  (armed by seeing the pearl quest move, ended by the character sheet
   *  opening or the admire nudge timing out). */
  private computeRingPhase(world: IWorld, onIsland: boolean): RingLessonPhase | null {
    if (!onIsland || !this.sawPearl || this.ringDone) return null;
    const questDone = world.questState(RING_LESSON_QUEST_ID) === 'done';
    const equipped =
      world.equipment.ring1 === RING_LESSON_ITEM_ID ||
      world.equipment.ring2 === RING_LESSON_ITEM_ID;
    const inBags = world.inventory.some((slot) => slot.itemId === RING_LESSON_ITEM_ID);
    const phase = ringLessonPhase({ questDone, inBags, equipped, charSeen: this.ringCharSeen });
    if (phase !== 'admire') {
      this.ringAdmireUntil = 0;
      return phase;
    }
    const charWindow = document.getElementById('char-window');
    if (charWindow && charWindow.style.display === 'block') {
      this.ringCharSeen = true;
      this.ringDone = true;
      return null;
    }
    const now = performance.now();
    if (this.ringAdmireUntil === 0) this.ringAdmireUntil = now + BootcampOverlay.RING_ADMIRE_MS;
    else if (now > this.ringAdmireUntil) {
      this.ringDone = true;
      return null;
    }
    return phase;
  }

  private applyUiGlow(world: IWorld): void {
    this.glowTick = (this.glowTick + 1) % 10;
    if (this.glowTick !== 0) return;
    const focus = this.lastFocus;
    const questId = coachGlowQuestId(focus);
    const vendorItem = coachGlowVendorItemId(focus);
    const bagItem = coachGlowBagItemId(focus, world.bags);
    syncGlow('#quest-tracker .qt-title', (el) => el.dataset.quest === questId);
    syncGlow('#quest-log .ql-item', (el) => el.dataset.quest === questId);
    syncGlow(
      '#vendor-window .vendor-item',
      (el) => vendorItem !== null && el.dataset.coachItem === vendorItem,
    );
    // The buckle-on step is a sell trap while the stall is open (a bag click
    // SELLS with a vendor up): with the shop open the glow moves to the
    // shop's close button, and only once it is closed does the bagged pouch
    // itself pulse.
    const vendorEl = document.querySelector<HTMLElement>('#vendor-window');
    const vendorOpen = vendorEl !== null && vendorEl.style.display === 'block';
    syncGlow('#vendor-window [data-close]', () => bagItem !== null && vendorOpen);
    const ringEquip = this.ringPhase === 'equip';
    syncGlow(
      '#bags .bag-item',
      (el) =>
        (bagItem !== null && !vendorOpen && el.dataset.coachItem === bagItem) ||
        (ringEquip && el.dataset.coachItem === RING_LESSON_ITEM_ID),
    );
    // The ring lesson's two menu asks: B while the ring waits in a bag, C
    // once it is on the finger.
    syncGlow('#mm-bag', () => ringEquip);
    syncGlow('#mm-char', () => this.ringPhase === 'admire');

    // The visible ask's own mobile cluster button (coachGlowButtonId): the
    // bubble shows the button's picture, the button itself pulses gold, and
    // the two find each other (CX: the picture alone did not read).
    syncGlow('#mobile-interact', () => this.promptButtonGlow === 'mobile-interact');
    syncGlow('#mobile-jump', () => this.promptButtonGlow === 'mobile-jump');
    syncGlow('#mobile-action-attack', () => this.promptButtonGlow === 'mobile-action-attack');
    // The drill and caster kill asks: the primary ring slot (bar slot 1)
    // whose art the bubble's chip repeats.
    syncGlow(
      '.mobile-action-slot[data-mobile-index="0"]',
      () => this.promptButtonGlow === 'mobile-slot-primary',
    );

    // Touch: the bags and the character sheet live behind the Quick Actions
    // strip, so the PATH glows, not just the destination (CX: "it is not
    // clear at all what I need to do"). The anchor pulses while a bag or
    // sheet lesson waits and the strip is closed; the strip's own Bags or
    // Character item pulses once it is open (a closed strip's items are
    // unrendered, so the always-on want is harmless); the item's context
    // menu row pulses once the bags are up and the menu is open.
    const touch = currentInputHintMode() === 'touch';
    const bagsEl = document.getElementById('bags');
    // bagsWindowShown, never a literal display compare: the bags open as
    // 'flex', and a 'block' compare here left the Use/Equip menu row glow
    // permanently unarmed (CX round 3).
    const bagsOpen = bagsEl !== null && bagsWindowShown(bagsEl.style.display);
    const charEl = document.getElementById('char-window');
    const charOpen = charEl !== null && charEl.style.display === 'block';
    const wantsBags = (bagItem !== null || ringEquip) && !vendorOpen && !bagsOpen;
    const wantsChar = this.ringPhase === 'admire' && !charOpen;
    const anchorEl = document.getElementById('mobile-menu-anchor');
    const stripOpen = anchorEl?.getAttribute('aria-expanded') === 'true';
    syncGlow('#mobile-menu-anchor', () => touch && (wantsBags || wantsChar) && !stripOpen);
    syncGlow('#mobile-menu-bags', () => touch && wantsBags);
    syncGlow('#mobile-menu-char', () => touch && wantsChar);
    // The lesson item's own menu row (Use for the lure and the rite stone,
    // Equip for the pouch and the ring): the default row IS that verb.
    syncGlow(
      '#ctx-menu .ctx-item[data-act="default"]',
      () => (bagItem !== null || ringEquip) && bagsOpen,
    );
    // The pouch purchase's first step: Finch's browse-goods gossip row, the
    // one button between the player and the stall (CX: "way more obvious
    // that the user actually needs to browse the shop").
    syncGlow('#quest-dialog .qd-list-item[data-vendor="1"]', () => vendorItem !== null);

    // The death lesson's own screen. While the island is teaching the corpse
    // run, the button that ends it pulses the moment it appears, and the
    // Keeper's paid alternative is dimmed out of the way: a first-timer
    // offered two buttons will take whichever they see first, and the whole
    // lesson is that the walk back is free (CX).
    const teachingCorpseRun =
      this.deathPhase !== 'alive' && this.lastFocus?.questId === DEATH_LESSON_QUEST_ID;
    syncGlow('#resurrect-corpse-btn', () => teachingCorpseRun);
    for (const el of document.querySelectorAll<HTMLElement>('#resurrect-healer-btn')) {
      el.classList.toggle('bc-dimmed', teachingCorpseRun);
    }
  }

  /** Re-localize after an in-game language switch (the Hud's woc:languagechange
   *  fan-out). With the card gone the only localized surface left is the
   *  bubble's verb, whose content memo digests no locale: a switch would
   *  leave it in the old tongue until the target moved, so clearing the memo
   *  makes the next frame repaint it. */
  relocalize(_world: IWorld, _keybinds: Keybinds): void {
    if (!this.engaged) return;
    this.promptContentKey = '';
  }

  // ---- internals --------------------------------------------------------

  private courseProgress(): string {
    return t('hudChrome.bootcamp.courseProgress', {
      current: formatNumber(Math.min(this.lastCounts + 1, BOOTCAMP_COURSE_CHECKPOINTS.length)),
      total: formatNumber(BOOTCAMP_COURSE_CHECKPOINTS.length),
    });
  }

  private ensureDom(): void {
    if (this.prompt) return;
    const ui = document.getElementById('ui');
    if (!ui) return;

    // NO card. The coach's whole instruction is carried in the world now:
    // the golden ground trail, the objective's own aura and beam, the
    // floating keycap bubble on the target (or the centred one for an
    // interface press), the pulsing bag stack and menu buttons, and the
    // quest tracker's own objective counts. A block of prose pinned to the
    // top of the screen was the thing new players read least and disliked
    // most (CX), so it is gone rather than shrunk.
    this.root = ui;

    // The prompt bubble: keycap chip(s) plus a one-word verb. World-anchored
    // over interact targets; screen-anchored low-center for the movement
    // lessons (the W ask). aria-hidden: the coach card body already carries
    // the same instruction for screen readers.
    const prompt = document.createElement('div');
    prompt.className = 'tut-prompt';
    prompt.setAttribute('aria-hidden', 'true');
    const chips = document.createElement('span');
    chips.className = 'tut-prompt-chips';
    const verb = document.createElement('span');
    verb.className = 'tut-prompt-verb';
    prompt.append(chips, verb);
    ui.appendChild(prompt);
    this.prompt = prompt;
    this.promptChipEl = chips;
    this.promptVerbEl = verb;

    // The wrong-way glow (objective_glow_view.ts): a golden bloom down the
    // edge the objective lies past. Pointer-transparent and aria-hidden by
    // construction; it is a direction cue, and the coach card already says
    // where to go in words.
    const glow = document.createElement('div');
    glow.className = 'tut-objective-glow';
    glow.setAttribute('aria-hidden', 'true');
    ui.appendChild(glow);
    this.glowEl = glow;
  }

  /**
   * Paint (or clear) the wrong-way edge glow for this frame.
   *
   * Reads the CAMERA's yaw, not the character's facing: a player can run one
   * way while looking another, and the cue is about what they can see. The
   * objective is the coach's own arrow target, so the glow and the card can
   * never point at different things.
   */
  private paintObjectiveGlow(world: IWorld, renderer: Renderer): void {
    const el = this.glowEl;
    if (!el) return;
    // A bag or character-sheet lesson has no world direction: the answer is
    // at the bottom of the screen, not past an edge (CX).
    const p = world.player;
    const uiLesson = this.uiLesson(world);
    const objective = uiLesson ? null : this.currentObjectivePos();
    let plan: ObjectiveGlowPlan | null = null;
    if (uiLesson) {
      plan = uiLessonGlow();
    } else if (objective && p) {
      // Ask the renderer where the objective actually lands, so the cue
      // appears ONLY when it is genuinely off screen and points the way the
      // pixels went (CX: it used to fire on visible objectives, and on the
      // wrong side).
      const groundY = Math.max(groundHeight(objective.x, objective.z, WORLD_SEED), WATER_LEVEL);
      const v = renderer.worldToScreen(objective.x, groundY + GLOW_TARGET_LIFT, objective.z);
      plan = objectiveGlowFromScreen(v, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    // Memoized: this runs every HUD frame, and writing identical style
    // strings would dirty the compositor for nothing.
    const key = plan ? `${plan.side}:${Math.round(plan.intensity * 20)}` : '';
    if (key === this.glowPainted) return;
    this.glowPainted = key;
    if (!plan) {
      el.style.opacity = '0';
      return;
    }
    el.classList.toggle('tut-glow-right', plan.side === 'right');
    el.classList.toggle('tut-glow-left', plan.side === 'left');
    el.classList.toggle('tut-glow-behind', plan.side === 'behind');
    el.classList.toggle('tut-glow-bottom', plan.side === 'bottom');
    el.style.opacity = String(GLOW_MAX_OPACITY * plan.intensity);
  }

  /** True while the coach is asking for a BAGS or CHARACTER-SHEET press: the
   *  ring's two steps, and the pouch buckle-on. Both already pulse the menu
   *  buttons and the bag stack; the edge glow joins them at the bottom
   *  rather than pointing across the island at a turn-in NPC. */
  private uiLesson(world: IWorld): boolean {
    if (this.ringPhase !== null) return true;
    const focus = this.lastFocus;
    // Only while the pouch is still in the bags: once it is socketed the
    // lesson is over and the answer is the walk to the turn-in, not the row
    // of buttons along the bottom (CX).
    if (pouchLessonActive(focus, world.bags)) return true;
    // The death lesson's first beat is "open your bags and use the stone";
    // once they are dead or a ghost the answer is the death screen's own
    // buttons, which are also centre/bottom, so the bloom stays put.
    return focus?.questId === DEATH_LESSON_QUEST_ID && focus.state === 'active';
  }

  /** Where the coach is currently pointing, or null when it points nowhere
   *  (the crate line, which is deliberately arrow-free). */
  private currentObjectivePos(): { x: number; z: number } | null {
    if (this.bellPhase) return BELL_STEP_TARGET;
    // The ring lesson is an INVENTORY lesson (buckle the ring on, open the
    // sheet): there is nowhere to walk, so there is no wrong way to face.
    if (this.ringPhase !== null) return null;
    const focus = this.lastFocus;
    if (!focus) return null;
    // The coach card's own arrow, deliberately: the glow and the card can
    // then never point at different things. It covers the Gauntlet too (its
    // active leg falls back to the course's finish), which is where a new
    // player is most likely to be facing the wrong way.
    return coachCardPlan(focus, 'keyboard', this.casterClass, this.deathPhase).arrow;
  }

  /**
   * The lessons whose answer is a press on the INTERFACE, not a place: they
   * have no world point to stand a bubble on, so they take the centred
   * variant. These used to live ONLY on the coach card, so this branch is
   * what keeps them from teaching nothing now the card is gone.
   */
  private centeredAsk(
    world: IWorld,
    keybinds: Keybinds,
    mode: ReturnType<typeof currentInputHintMode>,
    gamepadBindings: CoachGamepadBindings | null,
  ): { caps: readonly string[]; verbKey: TranslationKey } | null {
    const key = (id: string): string[] =>
      mode === 'keyboard' ? [keybinds.primaryLabel(id) || ''].filter(Boolean) : [];
    const padSource = mode === 'pad' ? gamepadHintSource(gamepadBindings) : null;
    const control = (id: string): readonly string[] =>
      padSource ? gamepadControlHint(padSource, { type: 'action', action: id }) : key(id);
    if (this.ringPhase === 'equip') {
      return { caps: control('bags'), verbKey: 'hudChrome.bootcamp.promptOpenBags' };
    }
    if (this.ringPhase === 'admire') {
      return { caps: control('char'), verbKey: 'hudChrome.bootcamp.promptCharacterSheet' };
    }
    if (pouchLessonActive(this.lastFocus, world.bags)) {
      return { caps: control('bags'), verbKey: 'hudChrome.bootcamp.promptOpenBags' };
    }
    // The death lesson's first beat: the stone is in the bags.
    if (
      this.deathPhase === 'alive' &&
      this.lastFocus?.questId === DEATH_LESSON_QUEST_ID &&
      this.lastFocus.state === 'active'
    ) {
      return { caps: control('bags'), verbKey: 'hudChrome.bootcamp.promptOpenBags' };
    }
    // The Gauntlet's closing camera lesson teaches the VIEW itself, so it
    // has never had a world anchor and had only the card to carry it.
    if (this.step === 'camera') {
      return { caps: [], verbKey: 'hudChrome.bootcamp.promptLookAround' };
    }
    return null;
  }

  // The interact bubble's per-frame drive: the per-frame painter contracts
  // by hand (memoized ground sample, elided writes; this is a bare-named
  // overlay, not a *_painter on the PainterHost seam). Hidden out of
  // interact reach, so appearing IS the signal to press.
  private updatePrompt(
    world: IWorld,
    renderer: Renderer,
    keybinds: Keybinds,
    gamepadBindings: CoachGamepadBindings | null,
  ): void {
    if (!this.prompt || !this.promptChipEl || !this.promptVerbEl) return;
    // A scoped-popup modal (the spawn greeting, the profession explainer)
    // owns the screen while it is up: the only ask is its own button, and
    // the world bubble used to float over the dialog text (CX, mobile).
    for (const id of ['tutorial-greeting', 'profession-tutorial']) {
      const modal = document.getElementById(id);
      if (modal && modal.style.display !== 'none') {
        this.hidePrompt();
        return;
      }
    }
    const p = world.player;
    const mode = currentInputHintMode();

    // Lane 2's parkour asks own the bubble while one is on screen: a jump
    // plan in range beats the centered movement chips, or the Space ask
    // would never surface on keyboard (the movement variant returns early).
    const jumpPlan = this.step === 'turnwalk' && p ? parkourPromptPlan(p.pos) : null;
    // ...except right AT the corner, where the turn instruction is what the
    // moment is about. Lane 2's hurdle sits inside the jump ask's range of
    // its own checkpoint, so without this the bubble skipped "D then W"
    // entirely and went straight to Jump.
    const atCorner =
      this.step === 'turnwalk' &&
      p !== null &&
      turnAskOwnsBubble(this.lastCounts, p.pos, BOOTCAMP_COURSE_CHECKPOINTS);
    const jumpAskVisible =
      jumpPlan !== null && p !== null && !atCorner && coachPromptInRange(jumpPlan, p.pos);

    // The interface lessons (bags, character sheet, the camera swing) have no
    // world point to stand a bubble on, so they take the centred variant.
    // These used to live ONLY on the coach card, so with the card gone this
    // branch is what keeps them from teaching nothing at all.
    const centered = jumpAskVisible
      ? null
      : this.centeredAsk(world, keybinds, mode, gamepadBindings);
    if (centered) {
      this.promptButtonGlow = null;
      const contentKey = `centered:${centered.verbKey}:${centered.caps.join(',')}`;
      if (this.promptContentKey !== contentKey) {
        this.promptContentKey = contentKey;
        this.paintPromptChips(centered.caps.map((cap) => ({ cap })));
        this.promptVerbEl.textContent = t(centered.verbKey);
      }
      this.prompt.classList.add('tut-prompt-center');
      if (!this.promptPainted.visible) {
        this.prompt.style.display = 'flex';
        this.promptPainted.visible = true;
      }
      if (!Number.isNaN(this.promptPainted.sx)) {
        this.prompt.style.left = '';
        this.prompt.style.top = '';
        this.promptPainted.sx = Number.NaN;
        this.promptPainted.sy = Number.NaN;
      }
      return;
    }

    // The movement lessons carry a screen-anchored bubble (there is no world
    // point to stand it on: the lesson is the player's own hands), so the W
    // ask is as loud as the interact F. Keyboard only, the keycap rule.
    if (
      mode === 'keyboard' &&
      !jumpAskVisible &&
      (this.step === 'forward' || this.step === 'turnwalk' || this.step === 'strafe')
    ) {
      this.promptButtonGlow = null;
      const unbound = t('hud.options.unbound');
      const caps = bootcampKeycaps(this.step, mode, {
        forwardKey: keybinds.primaryLabel('forward') || unbound,
        turnKey: keybinds.primaryLabel('turnRight') || unbound,
        turnLeftKey: keybinds.primaryLabel('turnLeft') || unbound,
        strafeKey: keybinds.primaryLabel('strafeLeft') || unbound,
        interactKey: keybinds.primaryLabel('interact') || unbound,
      });
      const contentKey = `move:${this.step}:${caps.join(',')}`;
      if (this.promptContentKey !== contentKey) {
        this.promptContentKey = contentKey;
        this.paintPromptChips(caps.map((cap) => ({ cap })));
        this.promptVerbEl.textContent = t('hudChrome.bootcamp.promptHold');
      }
      this.prompt.classList.add('tut-prompt-center');
      if (!this.promptPainted.visible) {
        this.prompt.style.display = 'flex';
        this.promptPainted.visible = true;
      }
      // The centered variant is CSS-positioned; clear any stale inline offsets.
      if (!Number.isNaN(this.promptPainted.sx)) {
        this.prompt.style.left = '';
        this.prompt.style.top = '';
        this.promptPainted.sx = Number.NaN;
        this.promptPainted.sy = Number.NaN;
      }
      return;
    }
    this.prompt.classList.remove('tut-prompt-center');

    const plan: CoachPromptPlan | null = p
      ? coachPromptPlan({
          bellPhase: this.bellPhase,
          step: this.step,
          focus: this.lastFocus,
          entities: world.entities.values(),
          playerPos: p.pos,
          questLog: world.questLog,
          targetId: p.targetId,
          deathPhase: this.deathPhase,
        })
      : null;
    if (!plan || !p || !coachPromptInRange(plan, p.pos)) {
      this.hidePrompt();
      return;
    }

    // The kill lessons' first half asks for selection: pointer input needs no
    // chip, while a controller names its live target-cycle control. Its second
    // half names the button that hits: the keycap on a keyboard, and on touch
    // the action-bar ICON itself, because a phone player has no key to be told
    // about and is looking for the picture.
    // The parkour asks chip the live jump bind; everything else chips the
    // live interact/confirm bind. Pad labels already carry the detected
    // controller brand, so the bubble matches both remaps and printed glyphs.
    // The ability drill asks for the class's OWN button, which is never
    // the Attack toggle: chipping slot0 there put a "1" under a bubble
    // reading "Use ability", which is exactly the wrong instruction. The
    // plan says which press it wants; the chip follows it.
    const abilityAsk = plan.verbKey === 'hudChrome.bootcamp.promptUseAbility';
    const padSource = mode === 'pad' ? gamepadHintSource(gamepadBindings) : null;
    const padControlCaps = padSource
      ? gamepadControlHint(
          padSource,
          coachGamepadIntent(plan.kind, abilityAsk, this.casterClass, this.taughtAbilityId),
        )
      : [];
    const chips = coachPromptChips(plan.kind, mode, {
      abilityAsk,
      caster: this.casterClass,
      killIconId: abilityAsk
        ? (this.taughtAbilityId ?? AUTO_ATTACK_ICON_ID)
        : this.promptAttackIconId(),
      slotLabel: keybinds.primaryLabel(abilityAsk || this.casterClass ? 'slot1' : 'slot0') || '',
      jumpLabel: keybinds.primaryLabel('jump') || '',
      bagsLabel: keybinds.primaryLabel('bags') || '',
      interactLabel: keybinds.primaryLabel('interact'),
      padControlCaps,
    });
    this.promptButtonGlow = coachGlowButtonId(plan.kind, mode, {
      abilityAsk,
      caster: this.casterClass,
    });
    const contentKey = `${plan.verbKey}:${chips.map(chipKey).join(',')}:${mode}`;
    if (this.promptContentKey !== contentKey) {
      this.promptContentKey = contentKey;
      this.paintPromptChips(chips);
      this.promptVerbEl.textContent = t(plan.verbKey);
    }

    const groundKey = `${plan.x},${plan.z}`;
    if (this.promptGroundKey !== groundKey) {
      this.promptGroundKey = groundKey;
      this.promptGroundY =
        Math.max(groundHeight(plan.x, plan.z, WORLD_SEED), WATER_LEVEL) + plan.lift;
    }
    const v = renderer.worldToScreen(plan.x, this.promptGroundY, plan.z);
    if (v.behind) {
      this.hidePrompt();
      return;
    }
    const sx = Math.round(v.x * 2) / 2;
    const sy = Math.round(v.y * 2) / 2;
    const last = this.promptPainted;
    if (!last.visible) {
      this.prompt.style.display = 'flex';
      last.visible = true;
    }
    if (last.sx !== sx) {
      this.prompt.style.left = `${sx}px`;
      last.sx = sx;
    }
    if (last.sy !== sy) {
      this.prompt.style.top = `${sy}px`;
      last.sy = sy;
    }
  }

  private paintPromptChips(chips: readonly PromptChip[]): void {
    if (!this.promptChipEl) return;
    this.promptChipEl.replaceChildren();
    paintPromptChipSequence(this.promptChipEl, chips);
    this.promptChipEl.style.display = chips.length > 0 ? '' : 'none';
  }

  /** The localized name of the attack this class was taught, for the ability
   *  drill's card. Falls back to the Attack toggle's own label for a class
   *  the kit leaves with nothing but a swing. */
  private taughtAbilityName(): string {
    const abilityId = this.taughtAbilityId;
    if (!abilityId) return t('hudChrome.bootcamp.promptAttack');
    return tEntity({ kind: 'ability', id: abilityId, field: 'name' });
  }

  /** Which action-bar icon the touch combat bubble shows: the Attack toggle
   *  for a class that swings, and the taught spell for one that casts (a
   *  caster has no melee autoattack worth pointing a new player at). */
  private promptAttackIconId(): string {
    if (!this.casterClass) return AUTO_ATTACK_ICON_ID;
    return this.taughtAbilityId ?? AUTO_ATTACK_ICON_ID;
  }

  private hidePrompt(): void {
    this.promptButtonGlow = null;
    if (!this.prompt || !this.promptPainted.visible) return;
    this.prompt.style.display = 'none';
    this.promptPainted.visible = false;
  }

  /** Fold the card away for now; the quest log decides any re-engage. */
  private disengage(): void {
    this.engaged = false;
    this.step = null;
    this.bellPhase = false;
    // root is the BORROWED shared #ui container (the whole HUD) since the
    // no-card refactor, so teardown removes only the nodes the coach minted
    // into it and drops the reference. Removing root here deleted the entire
    // HUD on the graduation ferry and froze every later frame on a null
    // lookup (the v0.40 crossing freeze).
    this.prompt?.remove();
    this.glowEl?.remove();
    this.captionEl?.remove();
    this.captionEl = null;
    this.root = null;
    this.prompt = null;
    this.glowEl = null;
    this.glowPainted = '';
    this.promptChipEl = null;
    this.promptVerbEl = null;
    this.promptContentKey = '';
    this.promptPainted = { visible: false, sx: Number.NaN, sy: Number.NaN };
    this.promptGroundKey = '';
    this.promptButtonGlow = null;
    // Leaving the island: no control is the next press any more.
    for (const scope of ['#quest-tracker', '#quest-log', '#vendor-window', '#bags']) {
      for (const el of document.querySelectorAll<HTMLElement>(`${scope} .qd-coach`)) {
        el.classList.remove('qd-coach');
      }
    }
    for (const id of [
      'mobile-interact',
      'mobile-jump',
      'mobile-action-attack',
      'mobile-menu-anchor',
      'mobile-menu-bags',
      'mobile-menu-char',
    ]) {
      document.getElementById(id)?.classList.remove('qd-coach');
    }
    for (const sel of [
      '.mobile-action-slot.qd-coach',
      '#ctx-menu .ctx-item.qd-coach',
      '#quest-dialog .qd-list-item.qd-coach',
    ]) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) el.classList.remove('qd-coach');
    }
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = null;
    this.captionEl = null;
    this.guidePrevStation = null;
    this.guidePrevCounts = -1;
    this.guideOffPathSince = null;
  }
}

/** The quest objective's own flag tally (0 when the quest is not active). */
function questCounts(world: IWorld): number {
  return world.questLog.get(GAUNTLET_QUEST_ID)?.counts?.[0] ?? 0;
}

function gamepadHintSource(gamepad: CoachGamepadBindings | null): GamepadControlHintSource | null {
  if (!gamepad) return null;
  return {
    entries: gamepad.entries(),
    kind: gamepad.kind(),
    crossHotbarEnabled: gamepad.crossHotbarEnabled?.() ?? false,
    crossHotbarSets: gamepad.crossHotbarSets?.() ?? [],
    crossHotbarSet: gamepad.crossHotbarSet?.() ?? 0,
  };
}

function coachGamepadIntent(
  kind: CoachPromptPlan['kind'],
  abilityAsk: boolean,
  caster: boolean,
  taughtAbilityId: string | null,
): GamepadControlHintIntent {
  if (kind === 'select') return { type: 'target' };
  if (kind === 'jump') return { type: 'action', action: 'jump' };
  if (kind === 'use') return { type: 'action', action: 'bags' };
  if (kind !== 'kill') return { type: 'interact' };
  const usesAbility = abilityAsk || caster;
  return {
    type: 'crossHotbar',
    action: { type: 'ability', id: usesAbility && taughtAbilityId ? taughtAbilityId : 'attack' },
    fallback: usesAbility ? 'slot1' : 'slot0',
  };
}

/** One rail quest's coach state, or null when it is not moving (locked
 *  behind its prerequisite, or already handed in). */
function railQuestState(world: IWorld, questId: string): CoachState | null {
  if (world.questLog.get(questId)?.state === 'active') return 'active';
  const state = world.questState(questId);
  if (state === 'available') return 'available';
  if (state === 'ready') return 'ready';
  return null;
}

/** Keycap chips with a localized "then" between them: every multi-key row
 *  on the island is a press SEQUENCE (D then W, B then F), and the playtest
 *  showed the order must be explicit. */
function paintChipSequence(host: HTMLElement, caps: readonly string[]): void {
  paintPromptChipSequence(
    host,
    caps.map((cap) => ({ cap })),
  );
}

/** Repaint identity for a chip row (the memo key). */
function chipKey(chip: PromptChip): string {
  if ('cap' in chip) return chip.cap;
  if ('abilityIcon' in chip) return `icon:${chip.abilityIcon}`;
  return `button:${chip.buttonIcon}`;
}

function paintPromptChipSequence(host: HTMLElement, chips: readonly PromptChip[]): void {
  chips.forEach((chip, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'tut-keycap-then';
      sep.textContent = t('hudChrome.bootcamp.keycapThen');
      host.appendChild(sep);
    }
    if ('cap' in chip) {
      const el = document.createElement('span');
      el.className = 'tut-keycap';
      el.textContent = chip.cap;
      host.appendChild(el);
      return;
    }
    if ('abilityIcon' in chip) {
      const el = document.createElement('span');
      el.className = 'tut-keycap tut-keycap-icon';
      el.style.backgroundImage = `url(${iconDataUrl('ability', chip.abilityIcon)})`;
      // Decorative: the verb beside it already says what the press does, and
      // the icon repeats the action bar the player is looking at.
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
      return;
    }
    // A mobile cluster button's own glyph (svgIcon is what the button itself
    // hydrates with), so the picture in the bubble IS the button to press.
    const el = document.createElement('span');
    el.className = 'tut-keycap tut-keycap-button';
    el.innerHTML = svgIcon(chip.buttonIcon);
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
  });
}

/** Class-toggle sweep for the press-this-next glow (same-state no-ops). */
/** The qd-coach-pulse duration (styles/components.css); the phase seed below
 *  wraps on it, so the two must agree. Pinned by tests/bootcamp_glow.test.ts. */
const GLOW_PULSE_MS = 900;

/** Class-toggle sweep for the press-this-next glow, plus the phase seed that
 *  keeps a recreated row's pulse continuous. */
function syncGlow(selector: string, want: (el: HTMLElement) => boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const on = want(el);
    el.classList.toggle('qd-coach', on);
    // Windows that repaint per frame (the quest tracker) recreate their rows,
    // and a recreated node restarts the pulse animation from zero: a strobe,
    // not a pulse. A negative delay seeded from the shared wall clock resumes
    // every node mid-cycle, so the glow breathes continuously no matter how
    // often its element is rebuilt.
    if (on) {
      el.style.animationDelay = `-${(performance.now() % GLOW_PULSE_MS).toFixed(0)}ms`;
    } else if (el.style.animationDelay) {
      el.style.animationDelay = '';
    }
  }
}

/** Shortest signed angular distance, for the camera lesson's travel tally. */
function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}
