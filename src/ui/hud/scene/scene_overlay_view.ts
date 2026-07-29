// Pure view core for the Last Bell scene overlay: letterbox bars, the
// subtitle line, the fade-to-black layer, and the skip hint. Consumes the
// sim's SceneWireOps and answers, per frame, which overlay elements are
// visible and what they show. DOM-free and i18n-free: dialogue is carried as
// stable KEYS (the painter renders t(key)), and time is fed in as seconds so
// tests drive any moment directly. The returned model is a state-owned reused
// container (per-frame path: no allocation).

import type { SceneReconnectState, SceneWireOp } from '../../../sim/types';

/** How long a choice's spoken reply line stays up as a subtitle. */
export const SCENE_REPLY_SUBTITLE_SEC = 4;

interface SceneSubtitle {
  speakerKey: string | null;
  lineKey: string;
  until: number;
  announcementId: number;
}

interface SceneFade {
  target: number;
  dur: number;
  startedAt: number;
  from: number;
}

export interface SceneOverlayModel {
  letterbox: boolean;
  /** The skip affordance shows for the whole scene. */
  skipHintVisible: boolean;
  speakerKey: string | null;
  lineKey: string | null;
  /** Monotonic occurrence id so identical consecutive lines re-announce. */
  announcementId: number;
  /** 0..1 opacity of the full-screen black layer. */
  fadeOpacity: number;
  /** True while the scene authority locks player input. Drives cinematic mode:
   *  unlocked scenes keep the normal controls available, while end (watched
   *  or skipped) restores the HUD in one step. */
  cinematic: boolean;
}

export interface SceneOverlayState {
  sceneActive: boolean;
  inputLocked: boolean;
  letterbox: boolean;
  subtitle: SceneSubtitle | null;
  fade: SceneFade | null;
  fadeOpacity: number;
  nextAnnouncementId: number;
  readonly model: SceneOverlayModel;
}

export function createSceneOverlayState(): SceneOverlayState {
  return {
    sceneActive: false,
    inputLocked: false,
    letterbox: false,
    subtitle: null,
    fade: null,
    fadeOpacity: 0,
    nextAnnouncementId: 0,
    model: {
      letterbox: false,
      skipHintVisible: false,
      speakerKey: null,
      lineKey: null,
      announcementId: 0,
      fadeOpacity: 0,
      cinematic: false,
    },
  };
}

/** Apply one scene op. Ops the overlay does not own (camera/music/anim) are
 *  the director's and are ignored here. The end op is the
 *  unconditional teardown: a skipped scene drops its remaining presentation
 *  ops, so end must clear letterbox, fade, and subtitle whatever arrived. */
export function overlayApplyOp(s: SceneOverlayState, op: SceneWireOp, nowSec: number): void {
  switch (op.kind) {
    case 'start':
      s.sceneActive = true;
      break;
    case 'end':
      s.sceneActive = false;
      s.inputLocked = false;
      s.letterbox = false;
      s.subtitle = null;
      s.fade = null;
      s.fadeOpacity = 0;
      break;
    case 'line':
      s.subtitle = {
        speakerKey: op.speaker !== '' ? op.speaker : null,
        lineKey: op.key,
        until: nowSec + op.dur,
        announcementId: ++s.nextAnnouncementId,
      };
      break;
    case 'inputLock':
      s.inputLocked = op.on;
      break;
    case 'letterbox':
      s.letterbox = op.on;
      break;
    case 'fade':
      s.fade = {
        target: op.to === 'black' ? 1 : 0,
        dur: op.dur,
        startedAt: nowSec,
        from: s.fadeOpacity,
      };
      break;
    default:
      break;
  }
}

/** Hard convergence after reconnect: clear transient history and restore only
 * the persistent overlay state the authority reports. */
export function overlayApplySync(s: SceneOverlayState, state: SceneReconnectState | null): void {
  s.sceneActive = state !== null;
  s.inputLocked = state?.inputLocked ?? false;
  s.letterbox = state?.letterbox ?? false;
  s.subtitle = null;
  s.fade = null;
  s.fadeOpacity = 0;
}

/** Show a dialogue choice's spoken reply as a subtitle (sceneChoiceResult). */
export function overlayShowReply(
  s: SceneOverlayState,
  replyKey: string,
  replySpeaker: string | undefined,
  nowSec: number,
): void {
  s.subtitle = {
    speakerKey: replySpeaker ?? null,
    lineKey: replyKey,
    until: nowSec + SCENE_REPLY_SUBTITLE_SEC,
    announcementId: ++s.nextAnnouncementId,
  };
}

/** Resolve the per-frame render model (mutates and returns the reused container). */
export function sceneOverlayView(s: SceneOverlayState, nowSec: number): SceneOverlayModel {
  const m = s.model;
  m.letterbox = s.letterbox;
  m.skipHintVisible = s.sceneActive;
  m.cinematic = s.inputLocked;
  if (s.subtitle !== null && nowSec >= s.subtitle.until) s.subtitle = null;
  m.speakerKey = s.subtitle?.speakerKey ?? null;
  m.lineKey = s.subtitle?.lineKey ?? null;
  m.announcementId = s.subtitle?.announcementId ?? 0;
  const fade = s.fade;
  if (fade !== null) {
    const t = fade.dur > 0 ? Math.min(1, Math.max(0, (nowSec - fade.startedAt) / fade.dur)) : 1;
    s.fadeOpacity = fade.from + (fade.target - fade.from) * t;
    if (t >= 1) s.fade = null;
  }
  m.fadeOpacity = s.fadeOpacity;
  return m;
}
