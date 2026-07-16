// New-Adventurer Tutorial — a one-time guided onboarding overlay.
//
// Brand-new characters used to spawn in Eastbrook with only an easily-missed
// combat-log hint. This overlay walks a first-time player through the five
// classic first steps: move → find the starter NPC → take the quest → slay the
// wolves → turn it in. Every step is detected by *observing* existing IWorld
// state (player/NPC positions, quest log, completed quests), so this module is
// pure presentation: it never writes sim state, never touches the wire
// protocol, and runs identically against the offline Sim and the online
// ClientWorld. Completion is remembered in localStorage so it shows only once.
//
// Reads through IWorld only (src/ CLAUDE.md). The starter ids below mirror the
// shipped zone-1 content (the same QUESTS the HUD already imports).

import type { Keybinds } from '../game/keybinds';
import type { Renderer } from '../render/renderer';
import { PLAYER_START, QUESTS, ZONES } from '../sim/data';
import { dist2d, INTERACT_RANGE } from '../sim/types';
import type { IWorld } from '../world_api';
import type { TranslationKey } from './i18n';
import { formatNumber, t } from './i18n';
import {
  TUTORIAL_NEXT_TIPS,
  type TutorialParam,
  tutorialBodyPlan,
  tutorialNeedsRerender,
  tutorialSlayHintPlan,
} from './tutorial_copy';

// Starter content the onboarding guides the player toward — all derived from the
// shipped sim sources so a content rename or a moved spawn can't silently desync
// onboarding (a resolve test pins that the derivation still finds a giver+mob).
const STARTER_QUEST = ZONES[0]?.welcomeQuestId ?? 'q_wolves';
const STARTER_DEF = QUESTS[STARTER_QUEST];
const GIVER_NPC = STARTER_DEF?.giverNpcId ?? 'marshal_redbrook';
const STARTER_MOB =
  STARTER_DEF?.objectives?.find((o) => o.type === 'kill')?.targetMobId ?? 'forest_wolf';
const SPAWN = { x: PLAYER_START.x, y: 0, z: PLAYER_START.z }; // dist2d ignores y
const MOVE_THRESHOLD = 3; // yards from spawn before "find your footing" is satisfied
const GIVER_RANGE = INTERACT_RANGE + 2; // matches the sim's accept-quest reach
const STORAGE_KEY = 'woc.tutorial.v1';
// Auto-dismiss the closing card after this long. Longer than the mid-tutorial
// steps (which advance on player action, not a timer) so there is time to read
// the "where to next" tips below the quest-complete line before it fades.
const DONE_LINGER_MS = 14000;

export type TutorialStep = 'move' | 'seek' | 'talk' | 'slay' | 'return' | 'done';

const STEP_ORDER: TutorialStep[] = ['move', 'seek', 'talk', 'slay', 'return'];

export interface TutorialSnapshot {
  moved: boolean; // player has stepped away from the spawn point
  nearGiver: boolean; // player is within talk range of the starter NPC
  questActive: boolean; // starter quest is in the quest log
  questReady: boolean; // all objectives met, ready to turn in
  questDone: boolean; // starter quest has been turned in
}

// Should the overlay engage for this character? Only a genuinely fresh one:
// level 1 with no quests at all. The id guard rejects the online pre-snapshot
// window — after `hello`, ClientWorld.playerId is a real id while `player`
// is still the blankEntity(-1) placeholder (level 1, empty logs), which would
// otherwise latch the tutorial for a returning veteran (and, if they had
// already finished the starter quest, permanently write the done-flag). Both
// clauses are load-bearing: post-hello the id-match catches the placeholder
// window; pre-hello both ids are -1, so `playerId >= 0` rejects it. Offline the
// player id equals playerId from the first frame, so this is a no-op there.
export function isFreshCharacter(world: IWorld): boolean {
  const p = world.player;
  if (!p) return false;
  if (world.playerId < 0 || p.id !== world.playerId) return false;
  return p.level === 1 && world.questsDone.size === 0 && world.questLog.size === 0;
}

// Pure state machine — unit-tested. Resolves the highest step the player has
// reached; each step's prompt is "do the thing that satisfies the next one".
export function computeTutorialStep(s: TutorialSnapshot): TutorialStep {
  if (s.questDone) return 'done';
  if (s.questReady) return 'return';
  if (s.questActive) return 'slay';
  if (s.nearGiver) return 'talk';
  if (s.moved) return 'seek';
  return 'move';
}

export class TutorialOverlay {
  private completed: boolean;
  private engaged = false; // decided to run for this (fresh) character
  private step: TutorialStep | null = null;
  private doneSince = 0;
  private lastTouch = false; // mobile-touch state at the last renderPanel

  private root: HTMLElement | null = null;
  private titleEl!: HTMLElement;
  private stepEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private tipsWrapEl!: HTMLElement;
  private tipsTitleEl!: HTMLElement;
  private tipsEl!: HTMLElement;
  private skipBtn!: HTMLButtonElement;
  private arrow: HTMLElement | null = null;

  constructor() {
    this.completed = readDone();
  }

  // Called every HUD frame. Cheap no-op once completed or never engaged.
  update(world: IWorld, renderer: Renderer, keybinds: Keybinds): void {
    if (this.completed) return;
    const p = world.player;
    if (!p) return;

    // Engage only for a genuinely fresh character (id-guarded against the online
    // pre-snapshot placeholder — see isFreshCharacter).
    if (!this.engaged) {
      if (!isFreshCharacter(world)) return;
      this.engaged = true;
    }

    const giver = this.findEntity(world, 'npc', GIVER_NPC);
    const qstate = world.questState(STARTER_QUEST);
    const snapshot: TutorialSnapshot = {
      moved: dist2d(p.pos, SPAWN) > MOVE_THRESHOLD,
      nearGiver: !!giver && dist2d(p.pos, giver.pos) <= GIVER_RANGE,
      questActive: world.questLog.has(STARTER_QUEST),
      questReady: qstate === 'ready',
      questDone: world.questsDone.has(STARTER_QUEST),
    };

    const next = computeTutorialStep(snapshot);
    // Re-render on a step change, or when Interface Mode is toggled mid-step (the
    // control copy differs between touch and keyboard), so an open card never keeps
    // stale phrasing after the mode flips.
    const touch = document.body.classList.contains('mobile-touch');
    if (tutorialNeedsRerender(this.step, next, this.lastTouch, touch)) {
      this.step = next;
      if (next === 'done' && this.doneSince === 0) this.doneSince = performance.now();
      this.renderPanel(world, keybinds);
    } else if (this.step === 'slay') {
      // live-refresh the kill counter without rebuilding the whole panel
      this.progressEl.textContent = this.slayProgress(world);
    }

    if (this.step === 'done') {
      if (performance.now() - this.doneSince >= DONE_LINGER_MS) this.finish();
      this.hideArrow();
      return;
    }

    this.updateArrow(world, renderer);
  }

  // ---- internals --------------------------------------------------------

  private findEntity(world: IWorld, kind: string, templateId: string) {
    for (const e of world.entities.values()) {
      if (e.kind === kind && e.templateId === templateId) return e;
    }
    return null;
  }

  private nearestMob(world: IWorld, templateId: string) {
    const p = world.player;
    let best: typeof p | null = null;
    let bestD = Infinity;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== templateId || e.dead) continue;
      const d = dist2d(p.pos, e.pos);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private slayProgress(world: IWorld): string {
    const def = QUESTS[STARTER_QUEST];
    const needed = def?.objectives?.[0]?.count ?? 0;
    const current = world.questLog.get(STARTER_QUEST)?.counts?.[0] ?? 0;
    return t('hud.tutorial.slayProgress', {
      current: formatNumber(Math.min(current, needed)),
      needed: formatNumber(needed),
    });
  }

  // Rebuilds the "where to next" tip list under the closing 'done' card. Rebuilt
  // (not cached) because the shown key labels depend on the player's live
  // keybinds, which can change mid-session via the rebinding UI.
  private renderNextTips(keybinds: Keybinds): void {
    this.tipsEl.replaceChildren();
    for (const tip of TUTORIAL_NEXT_TIPS) {
      const key = keybinds.primaryLabel(tip.keybindId) || t('hud.options.unbound');
      const li = document.createElement('li');
      li.textContent = t(tip.bodyKey, { key });
      this.tipsEl.appendChild(li);
    }
  }

  private ensureDom(): void {
    if (this.root) return;
    const ui = document.getElementById('ui');
    if (!ui) return;

    const root = document.createElement('div');
    root.className = 'tut-card';
    // A self-updating, never-focused coachmark — role="status" (implicit polite
    // live region) fits better than a dialog it never traps focus in.
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-labelledby', 'tut-title');

    const header = document.createElement('div');
    header.className = 'tut-head';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tut-title';
    this.titleEl.id = 'tut-title';
    this.stepEl = document.createElement('div');
    this.stepEl.className = 'tut-step';
    header.append(this.titleEl, this.stepEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'tut-body';

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'tut-progress';

    this.tipsWrapEl = document.createElement('div');
    this.tipsWrapEl.style.display = 'none';
    this.tipsTitleEl = document.createElement('div');
    this.tipsTitleEl.className = 'tut-next-tips-title';
    this.tipsTitleEl.textContent = t('hudChrome.tutorial.nextTipsTitle');
    this.tipsEl = document.createElement('ul');
    this.tipsEl.className = 'tut-next-tips';
    this.tipsWrapEl.append(this.tipsTitleEl, this.tipsEl);

    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'tut-skip';
    this.skipBtn.type = 'button';
    this.skipBtn.addEventListener('click', () => this.finish());

    root.append(header, this.bodyEl, this.progressEl, this.tipsWrapEl, this.skipBtn);
    ui.appendChild(root);
    this.root = root;

    const arrow = document.createElement('div');
    arrow.className = 'tut-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '➤'; // ➤
    ui.appendChild(arrow);
    this.arrow = arrow;
  }

  private renderPanel(world: IWorld, keybinds: Keybinds): void {
    this.ensureDom();
    if (!this.root) return;

    const moveKeys = ['forward', 'turnLeft', 'back', 'turnRight']
      .map((id) => keybinds.primaryLabel(id))
      .filter(Boolean)
      .join('/');
    // Fall back to the translated "Unbound" label so a cleared bind never leaves
    // a literal blank gap in "press  to speak" (mirrors the HUD keybind list).
    const interactKey = keybinds.primaryLabel('interact') || t('hud.options.unbound');
    const questKey = keybinds.primaryLabel('questlog') || t('hud.options.unbound');
    const targetKey = keybinds.primaryLabel('target') || t('hud.options.unbound');
    const name = world.player.name || t('hud.core.you');

    // On the touch interface the controls are on-screen sticks + Use/More
    // buttons, so the keyboard/mouse phrasings ("W/A/S/D", "press {interactKey}")
    // are wrong; tutorialBodyPlan swaps in the touch copy for those steps. Read
    // the same body class the HUD uses so it tracks the Interface Mode override.
    const touch = document.body.classList.contains('mobile-touch');
    this.lastTouch = touch;
    const allParams: Record<TutorialParam, string> = {
      moveKeys,
      interactKey,
      questKey,
      targetKey,
      name,
    };
    const plan = tutorialBodyPlan(this.step!, touch);
    const params: Partial<Record<TutorialParam, string>> = {};
    for (const key of plan.params) params[key] = allParams[key];

    const titleKey: Record<TutorialStep, TranslationKey> = {
      move: 'hud.tutorial.moveTitle',
      seek: 'hud.tutorial.seekTitle',
      talk: 'hud.tutorial.talkTitle',
      slay: 'hud.tutorial.slayTitle',
      return: 'hud.tutorial.returnTitle',
      done: 'hud.tutorial.doneTitle',
    };

    this.titleEl.textContent = t(titleKey[this.step!]);
    let body = t(plan.bodyKey, params);
    if (this.step === 'slay') {
      // First-time targeting/attack hint (see tutorialSlayHintPlan): the objective
      // body above never explains how to engage a wolf.
      const hintPlan = tutorialSlayHintPlan(touch);
      const hintParams: Partial<Record<TutorialParam, string>> = {};
      for (const key of hintPlan.params) hintParams[key] = allParams[key];
      body = `${body} ${t(hintPlan.bodyKey, hintParams)}`;
    }
    this.bodyEl.textContent = body;

    const idx = STEP_ORDER.indexOf(this.step!);
    this.stepEl.textContent =
      idx >= 0
        ? t('hud.tutorial.stepLabel', {
            current: formatNumber(idx + 1),
            total: formatNumber(STEP_ORDER.length),
          })
        : '';

    if (this.step === 'slay') {
      this.progressEl.textContent = this.slayProgress(world);
      this.progressEl.style.display = '';
    } else {
      this.progressEl.style.display = 'none';
    }

    if (this.step === 'done') {
      this.renderNextTips(keybinds);
      this.tipsWrapEl.style.display = '';
    } else {
      this.tipsWrapEl.style.display = 'none';
    }

    this.skipBtn.textContent =
      this.step === 'done' ? t('hud.tutorial.dismiss') : t('hud.tutorial.skip');
    this.root.classList.toggle('tut-done', this.step === 'done');
  }

  // Points an on-screen marker at the current objective (NPC or nearest wolf).
  private updateArrow(world: IWorld, renderer: Renderer): void {
    if (!this.arrow) return;
    let target: { x: number; y: number; z: number; scale?: number } | null = null;
    if (this.step === 'seek' || this.step === 'talk' || this.step === 'return') {
      target = this.findEntity(world, 'npc', GIVER_NPC)?.pos ?? null;
    } else if (this.step === 'slay') {
      target = this.nearestMob(world, STARTER_MOB)?.pos ?? null;
    }
    if (!target) {
      this.hideArrow();
      return;
    }

    const v = renderer.worldToScreen(target.x, target.y + 2.2, target.z);
    const margin = 56;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let sx = v.x;
    let sy = v.y;
    // Behind the camera projects inverted; mirror through screen centre so the
    // marker still points the right way.
    if (v.behind) {
      sx = w - v.x;
      sy = h - v.y;
    }
    const cx = w / 2;
    const cy = h / 2;
    const angle = Math.atan2(sy - cy, sx - cx);
    sx = Math.max(margin, Math.min(w - margin, sx));
    sy = Math.max(margin, Math.min(h - margin, sy));

    this.arrow.style.display = 'block';
    this.arrow.style.left = `${sx}px`;
    this.arrow.style.top = `${sy}px`;
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }

  private hideArrow(): void {
    if (this.arrow) this.arrow.style.display = 'none';
  }

  private finish(): void {
    this.completed = true;
    this.engaged = false;
    writeDone();
    this.root?.remove();
    this.arrow?.remove();
    this.root = null;
    this.arrow = null;
  }
}

function readDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
}
function writeDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    /* private mode */
  }
}
