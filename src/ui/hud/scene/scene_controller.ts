// HUD-side controller for the Last Bell scene presentation: routes the
// personal scene SimEvents to the overlay and choice view cores, owns the
// choice window's focus-trap lifetime, and drives both painters from
// Hud.update(). Camera, input lock, and music live game-side in
// src/game/scene_director.ts; this controller owns everything drawn.

import type { SimEvent } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import type { FocusTrapHandle } from '../../focus_manager';
import type { PainterHostWriters } from '../../painter_host';
import {
  choicePromptOpen,
  choiceResolve,
  createSceneChoiceState,
  sceneChoiceView,
} from './scene_choice_view';
import { SceneChoiceWindow } from './scene_choice_window';
import {
  createSceneOverlayState,
  overlayApplyOp,
  overlayShowReply,
  sceneOverlayView,
} from './scene_overlay_view';
import { SceneOverlayWindow } from './scene_overlay_window';

export interface SceneHudControllerDeps {
  document: Document;
  /** The HUD layer the overlay + choice window append to (#ui). */
  container: HTMLElement;
  world: () => IWorld;
  /** Milliseconds clock (performance.now). */
  now: () => number;
  writers: PainterHostWriters;
  openFocusTrap(root: HTMLElement): FocusTrapHandle;
  /** Skip request (routes to IWorld.sceneSkip). */
  skip(): void;
}

export class SceneHudController {
  private readonly overlay = createSceneOverlayState();
  private readonly choice = createSceneChoiceState();
  private readonly overlayWindow: SceneOverlayWindow;
  private readonly choiceWindow: SceneChoiceWindow;
  private trap: FocusTrapHandle | null = null;

  constructor(private readonly deps: SceneHudControllerDeps) {
    this.overlayWindow = new SceneOverlayWindow({
      document: deps.document,
      container: deps.container,
      writers: deps.writers,
      onSkip: () => this.deps.skip(),
    });
    this.choiceWindow = new SceneChoiceWindow({
      document: deps.document,
      container: deps.container,
      writers: deps.writers,
      onAnswer: (choiceId, optionId) => this.deps.world().answerSceneChoice(choiceId, optionId),
    });
    markDialogRoot(this.choiceWindow.root, { labelledBy: 'scene-choice-prompt' });
  }

  /** Route one drained SimEvent (Hud.handleEvents already pid-gated it). */
  onEvent(ev: SimEvent): void {
    const nowSec = this.deps.now() / 1000;
    if (ev.type === 'scene') {
      overlayApplyOp(this.overlay, ev.op, nowSec);
      return;
    }
    if (ev.type === 'sceneChoice') {
      choicePromptOpen(
        this.choice,
        {
          choiceId: ev.choiceId,
          promptKey: ev.promptKey,
          options: ev.options,
          windowSeconds: ev.windowSeconds,
          defaultOptionId: ev.defaultOptionId,
          leaderPid: ev.leaderPid,
        },
        nowSec,
      );
      // Paint immediately so the trap has real buttons to focus.
      this.update();
      if (ev.leaderPid === this.deps.world().playerId) {
        this.trap ??= this.deps.openFocusTrap(this.choiceWindow.root);
        this.trap.focusFirst('.scene-choice-option');
      }
      return;
    }
    if (ev.type === 'sceneChoiceResult') {
      if (choiceResolve(this.choice, ev.choiceId)) this.releaseTrap();
      // The picked option's spoken reply plays as a subtitle for a few seconds.
      if (ev.replyKey !== undefined) {
        overlayShowReply(this.overlay, ev.replyKey, ev.replySpeaker, nowSec);
      }
    }
  }

  /** Per-frame paint, called from Hud.update(). */
  update(): void {
    const nowSec = this.deps.now() / 1000;
    this.overlayWindow.paint(sceneOverlayView(this.overlay, nowSec));
    this.choiceWindow.update(
      sceneChoiceView(this.choice, nowSec, this.deps.world().playerId),
      this.leaderName(),
    );
  }

  private leaderName(): string {
    const leaderPid = this.choice.prompt?.leaderPid;
    if (leaderPid === undefined) return '';
    return this.deps.world().entities.get(leaderPid)?.name ?? '';
  }

  private releaseTrap(): void {
    this.trap?.release();
    this.trap = null;
  }
}
