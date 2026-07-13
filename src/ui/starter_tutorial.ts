// The starter tutorial's controller: the thing the HUD composes.
//
// It owns the coachmark DOM (the Warden's speech card, the objective checklist,
// the on-screen arrow), samples IWorld into the pure step machine
// (starter_tutorial_core.ts), folds the drained SimEvents into that machine's
// evidence, and decides when a staged SCENE should fire.
//
// It reads IWorld and NOTHING else about the world: like the in-world coachmark it
// never writes sim state, so the tutorial needs no IWorld member and no wire
// command. The one thing it cannot do from here is stage an entity or move the
// camera, so those arrive as an injected hook bag (`TutorialSceneHooks`) that
// main.ts binds against the offline Sim and the renderer. That is the same seam
// the fiesta-practice hook already uses.

import type { Keybinds } from '../game/keybinds';
import type { TutorialSceneId } from '../game/tutorial_scenes';
import type { Renderer } from '../render/renderer';
import { ABILITIES } from '../sim/data';
import { dist2d, type PlayerClass, type SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { tEntity } from './entity_i18n';
import { formatNumber, type TranslationKey, t } from './i18n';
import {
  advanceTutorial,
  currentStep,
  initialTutorialState,
  isTutorialComplete,
  objectiveProgress,
  type TutorialSnapshot,
  type TutorialState,
  type TutorialTick,
} from './starter_tutorial_core';
import {
  starterTutorialScript,
  stepAbilityId,
  TUTORIAL_DUMMY_ID,
  TUTORIAL_LOOT_ITEM_ID,
  TUTORIAL_POINTS,
  TUTORIAL_QUEST_ID,
  TUTORIAL_WARDEN_ID,
  type TutorialStepDef,
} from './starter_tutorial_script';

/** What the controller needs the host to do for it. main.ts binds this over the
 *  offline Sim + renderer (see src/game/tutorial_scenes.ts). */
export interface TutorialSceneHooks {
  play(id: TutorialSceneId, nowSec: number): void;
  /** The scene playing right now, or null. */
  active(): TutorialSceneId | null;
  /** Fire a scene's cues without its camera work (the never-dead-end safety net). */
  forceCue(id: TutorialSceneId): void;
  /** The player left, or finished: tear the tutorial session down. */
  leave(): void;
}

// The ranged auto-attack's ability label, as the sim stamps it on the damage
// event (AUTO_SHOT_LABEL in src/sim/combat/auto_attack.ts). Pinned by the
// controller's test so a rename over there cannot silently break the hunter's step.
export const AUTO_SHOT_ABILITY_LABEL = 'Auto Shot';

// How close the player gets before a reveal fires. Each is comfortably wider than
// the step's own completion radius, so the scene always plays BEFORE the step it
// belongs to can complete.
const WARDEN_SCENE_RANGE = 22;
const YARD_SCENE_RANGE = 18;
const AMBUSH_SCENE_RANGE = 15;

/** How long the closing card lingers before the tutorial hands the player back. */
const DONE_LINGER_MS = 9000;

export class StarterTutorial {
  private cls: PlayerClass | null = null;
  private script: TutorialStepDef[] = [];
  private state: TutorialState = initialTutorialState();
  private hooks: TutorialSceneHooks | null = null;
  private pending: MutableTick = emptyTick();
  private doneSince = 0;
  private lastRenderKey = '';

  // Reverse map from the ability NAME the sim stamps on a damage event back to the
  // ability id the script names. Built once (ABILITIES is a static table).
  private static readonly ABILITY_BY_NAME: ReadonlyMap<string, string> = new Map(
    Object.values(ABILITIES).map((a) => [a.name, a.id]),
  );

  private root: HTMLElement | null = null;
  private titleEl!: HTMLElement;
  private stepEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private skipBtn!: HTMLButtonElement;
  private arrow: HTMLElement | null = null;

  /** Called by main.ts once the tutorial world is up. */
  begin(cls: PlayerClass, hooks: TutorialSceneHooks): void {
    this.cls = cls;
    this.script = starterTutorialScript(cls);
    this.state = initialTutorialState();
    this.hooks = hooks;
    this.pending = emptyTick();
    this.doneSince = 0;
  }

  get running(): boolean {
    return this.cls !== null;
  }

  /** Fold this frame's events into the machine's evidence. Called from
   *  Hud.handleEvents, which sees every event the world drains. */
  onEvents(events: readonly SimEvent[], playerId: number): void {
    if (!this.running) return;
    for (const ev of events) {
      if (ev.type === 'damage') {
        if (ev.sourceId !== playerId || ev.kind !== 'hit') continue;
        if (ev.ability === null) {
          this.pending.autoAttackHits++;
        } else if (ev.ability === AUTO_SHOT_ABILITY_LABEL) {
          this.pending.rangedHits++;
        } else {
          const id = StarterTutorial.ABILITY_BY_NAME.get(ev.ability);
          if (id) this.pending.abilityHits[id] = (this.pending.abilityHits[id] ?? 0) + 1;
        }
      } else if (ev.type === 'heal2' && ev.sourceId === playerId && ev.targetId === playerId) {
        this.pending.selfHeals++;
      }
    }
  }

  /** Called every HUD frame. */
  update(world: IWorld, renderer: Renderer, keybinds: Keybinds): void {
    if (!this.running || !this.hooks) return;
    const p = world.player;
    if (!p) return;

    const snap = this.snapshot(world);
    const before = this.state.stepIndex;
    this.state = advanceTutorial(this.state, this.script, snap, this.pending);
    this.pending = emptyTick();

    this.maybePlayScene(world, snap);

    if (isTutorialComplete(this.state, this.script)) {
      if (this.doneSince === 0) {
        this.doneSince = performance.now();
        this.hooks.play('finale', performance.now() / 1000);
        this.renderDone(keybinds);
      }
      this.hideArrow();
      if (performance.now() - this.doneSince >= DONE_LINGER_MS) this.finish();
      return;
    }

    this.render(world, snap, before !== this.state.stepIndex);
    this.updateArrow(world, renderer);
  }

  /** The player pressed Skip: end the session and hand them back to the roster. */
  private finish(): void {
    const hooks = this.hooks;
    this.teardown();
    hooks?.leave();
  }

  private teardown(): void {
    this.cls = null;
    this.hooks = null;
    this.root?.remove();
    this.arrow?.remove();
    this.root = null;
    this.arrow = null;
  }

  // ---- world reads ------------------------------------------------------

  private snapshot(world: IWorld): TutorialSnapshot {
    const p = world.player;
    const warden = this.findNpc(world, TUTORIAL_WARDEN_ID);
    return {
      distToWarden: warden
        ? dist2d(p.pos, warden.pos)
        : dist2d(p.pos, { x: TUTORIAL_POINTS.warden.x, y: 0, z: TUTORIAL_POINTS.warden.z }),
      targetTemplateId:
        p.targetId === null ? null : (world.entities.get(p.targetId)?.templateId ?? null),
      auraAbilityIds: p.auras.map((a) => a.id),
      hasPet: this.hasPet(world),
      lootItemCount: world.inventory
        .filter((s) => s.itemId === TUTORIAL_LOOT_ITEM_ID)
        .reduce((n, s) => n + s.count, 0),
      questState: world.questState(TUTORIAL_QUEST_ID),
    };
  }

  private hasPet(world: IWorld): boolean {
    for (const e of world.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === world.playerId && !e.dead) return true;
    }
    return false;
  }

  private findNpc(world: IWorld, templateId: string) {
    for (const e of world.entities.values()) {
      if (e.kind === 'npc' && e.templateId === templateId) return e;
    }
    return null;
  }

  private nearestMob(world: IWorld, templateId: string) {
    const p = world.player;
    let best: ReturnType<typeof this.findNpc> = null;
    let bestD = Number.POSITIVE_INFINITY;
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

  // ---- scenes -----------------------------------------------------------

  private maybePlayScene(world: IWorld, snap: TutorialSnapshot): void {
    const hooks = this.hooks;
    if (!hooks || hooks.active() !== null) return;
    const p = world.player;
    const nowSec = performance.now() / 1000;
    const stepId = currentStep(this.state, this.script)?.id ?? null;

    // The Warden is `dynamic` (never surface-placed), so this reveal is what puts
    // her in the world at all. If the player is somehow already past the step that
    // needs her and she still is not there, stage her without the camera work
    // rather than leave them talking to an empty shrine.
    if (snap.distToWarden <= WARDEN_SCENE_RANGE) hooks.play('wardenReveal', nowSec);
    if (stepId !== 'land' && !this.findNpc(world, TUTORIAL_WARDEN_ID)) {
      hooks.forceCue('wardenReveal');
    }

    if (
      stepId !== null &&
      YARD_STEPS.has(stepId) &&
      dist2d(p.pos, { x: TUTORIAL_POINTS.yard.x, y: p.pos.y, z: TUTORIAL_POINTS.yard.z }) <=
        YARD_SCENE_RANGE
    ) {
      hooks.play('yardReveal', nowSec);
    }

    if (
      stepId === 'hunt' &&
      dist2d(p.pos, { x: TUTORIAL_POINTS.ambush.x, y: p.pos.y, z: TUTORIAL_POINTS.ambush.z }) <=
        AMBUSH_SCENE_RANGE
    ) {
      hooks.play('wolfReveal', nowSec);
    }
  }

  // ---- DOM --------------------------------------------------------------

  private ensureDom(): void {
    if (this.root) return;
    const ui = document.getElementById('ui');
    if (!ui) return;

    const root = document.createElement('div');
    root.className = 'tut-card stut-card';
    // A self-updating coachmark, never focused: role="status" (an implicit polite
    // live region) is right, and it must never trap focus like a dialog would.
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-labelledby', 'stut-title');

    const header = document.createElement('div');
    header.className = 'tut-head';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tut-title';
    this.titleEl.id = 'stut-title';
    this.stepEl = document.createElement('div');
    this.stepEl.className = 'tut-step';
    header.append(this.titleEl, this.stepEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'tut-body';

    this.objectiveEl = document.createElement('div');
    this.objectiveEl.className = 'stut-objective';

    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'tut-skip';
    this.skipBtn.type = 'button';
    this.skipBtn.addEventListener('click', () => this.finish());

    root.append(header, this.bodyEl, this.objectiveEl, this.skipBtn);
    ui.appendChild(root);
    this.root = root;

    const arrow = document.createElement('div');
    arrow.className = 'tut-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '➤';
    ui.appendChild(arrow);
    this.arrow = arrow;
  }

  private render(world: IWorld, snap: TutorialSnapshot, stepChanged: boolean): void {
    this.ensureDom();
    if (!this.root || !this.cls) return;

    const step = currentStep(this.state, this.script);
    if (!step) return;
    const scene = this.hooks?.active() ?? null;
    const progress = objectiveProgress(step.objective, this.state, snap);

    // Rebuild only when something the card shows actually changed: the step, the
    // running scene, or the objective count.
    const key = `${step.id}|${scene ?? ''}|${progress.current}/${progress.total}`;
    if (!stepChanged && key === this.lastRenderKey) return;
    this.lastRenderKey = key;

    this.titleEl.textContent = tEntity({ kind: 'npc', id: TUTORIAL_WARDEN_ID, field: 'name' });
    this.stepEl.textContent = t('hudChrome.starterTutorial.stepLabel', {
      current: formatNumber(this.state.stepIndex + 1),
      total: formatNumber(this.script.length),
    });

    // While a reveal is on screen the Warden narrates the reveal, not the chore.
    this.bodyEl.textContent = scene
      ? t(`hudChrome.starterTutorial.scenes.${scene}` as TranslationKey)
      : this.stepBody(step);

    this.objectiveEl.textContent = this.objectiveLabel(step, progress);
    this.skipBtn.textContent = t('hudChrome.starterTutorial.skip');
  }

  /** The Warden's line for this step. The two class steps read from the per-class
   *  block, everything else from the shared one. */
  private stepBody(step: TutorialStepDef): string {
    if (step.id === 'signature' || step.id === 'mastery') {
      return t(`hudChrome.starterTutorial.class.${this.cls}.${step.id}` as TranslationKey, {
        ability: this.abilityName(step),
      });
    }
    return t(`hudChrome.starterTutorial.steps.${step.id}` as TranslationKey);
  }

  private abilityName(step: TutorialStepDef): string {
    const id = stepAbilityId(step.objective);
    return id ? tEntity({ kind: 'ability', id, field: 'name' }) : '';
  }

  private objectiveLabel(step: TutorialStepDef, p: { current: number; total: number }): string {
    const done = p.current >= p.total;
    // The seven shared steps each have their own objective line (the three that
    // watch the quest all read "questState", so keying those by objective KIND
    // would collapse "accept the task", "slay the wolves" and "report back" into
    // one string). The two class steps DO key by kind, because which kind they use
    // is what differs between classes.
    const suffix = CLASS_STEPS.has(step.id) ? step.objective.kind : step.id;
    const label = t(`hudChrome.starterTutorial.objective.${suffix}` as TranslationKey, {
      ability: this.abilityName(step),
      mob: tEntity({ kind: 'mob', id: TUTORIAL_DUMMY_ID, field: 'name' }),
      item: tEntity({ kind: 'item', id: TUTORIAL_LOOT_ITEM_ID, field: 'name' }),
    });
    if (p.total <= 1) {
      return done ? t('hudChrome.starterTutorial.objectiveDone', { label }) : label;
    }
    return t('hudChrome.starterTutorial.objectiveCount', {
      label,
      current: formatNumber(p.current),
      total: formatNumber(p.total),
    });
  }

  private renderDone(_keybinds: Keybinds): void {
    this.ensureDom();
    if (!this.root) return;
    this.lastRenderKey = 'done';
    this.titleEl.textContent = t('hudChrome.starterTutorial.doneTitle');
    this.stepEl.textContent = '';
    this.bodyEl.textContent = t('hudChrome.starterTutorial.doneBody');
    this.objectiveEl.textContent = '';
    this.skipBtn.textContent = t('hudChrome.starterTutorial.leave');
    this.root.classList.add('tut-done');
  }

  // ---- arrow ------------------------------------------------------------

  private updateArrow(world: IWorld, renderer: Renderer): void {
    if (!this.arrow) return;
    const step = currentStep(this.state, this.script);
    // A reveal owns the screen: no arrow competing with the cinematic.
    if (!step || step.pointAt === null || this.hooks?.active() !== null) {
      this.hideArrow();
      return;
    }

    let target: { x: number; y: number; z: number } | null = null;
    if (step.pointAt === 'warden') {
      target = this.findNpc(world, TUTORIAL_WARDEN_ID)?.pos ?? null;
    } else if (step.pointAt === 'yard') {
      target = this.nearestMob(world, TUTORIAL_DUMMY_ID)?.pos ?? null;
    } else {
      const p = TUTORIAL_POINTS.hollow;
      target = { x: p.x, y: world.player.pos.y, z: p.z };
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
}

/** The steps whose objective lives in the practice yard, so the yard reveal fires
 *  as the player walks over to it. */
const YARD_STEPS: ReadonlySet<string> = new Set(['target', 'strike', 'signature', 'mastery']);

/** The two steps whose content depends on the class (see objectiveLabel). */
const CLASS_STEPS: ReadonlySet<string> = new Set(['signature', 'mastery']);

/** The accumulator the controller fills in `onEvents`; structurally a TutorialTick
 *  (whose `abilityHits` the pure core only ever reads). */
interface MutableTick extends TutorialTick {
  abilityHits: Record<string, number>;
}

function emptyTick(): MutableTick {
  return { autoAttackHits: 0, rangedHits: 0, selfHeals: 0, abilityHits: {} };
}
