// Last Bell scene overlay view core (src/ui/hud/scene/scene_overlay_view.ts):
// letterbox/subtitle/fade/skip-hint state from SceneWireOps, injected time.

import { describe, expect, it } from 'vitest';
import {
  createSceneOverlayState,
  overlayApplyOp,
  overlayApplySync,
  overlayShowReply,
  SCENE_REPLY_SUBTITLE_SEC,
  sceneOverlayView,
} from '../src/ui/hud/scene/scene_overlay_view';

describe('scene overlay state', () => {
  it('hard-converges letterbox state and clears stale transient presentation', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'start', duration: 10 }, 0);
    overlayApplyOp(s, { kind: 'line', speaker: 'a', speakerEntityId: null, key: 'k', dur: 8 }, 0);
    overlayApplyOp(s, { kind: 'fade', to: 'black', dur: 1 }, 0);
    overlayApplySync(s, {
      sceneId: 'active',
      remainingSeconds: 4,
      inputLocked: true,
      letterbox: true,
      musicSilenced: true,
    });
    expect(sceneOverlayView(s, 1)).toMatchObject({
      cinematic: true,
      letterbox: true,
      lineKey: null,
      fadeOpacity: 0,
    });
    overlayApplySync(s, null);
    expect(sceneOverlayView(s, 1)).toMatchObject({
      cinematic: false,
      letterbox: false,
      lineKey: null,
      fadeOpacity: 0,
    });
  });

  it('shows the skip hint for the whole scene and hides it after end', () => {
    const s = createSceneOverlayState();
    expect(sceneOverlayView(s, 0).skipHintVisible).toBe(false);
    overlayApplyOp(s, { kind: 'start', duration: 10 }, 0);
    expect(sceneOverlayView(s, 1).skipHintVisible).toBe(true);
    overlayApplyOp(s, { kind: 'end' }, 5);
    expect(sceneOverlayView(s, 5).skipHintVisible).toBe(false);
  });

  it('keeps an unlocked active scene playable while the skip hint remains visible', () => {
    const s = createSceneOverlayState();
    expect(sceneOverlayView(s, 0).cinematic).toBe(false);
    overlayApplyOp(s, { kind: 'start', duration: 10 }, 0);
    expect(sceneOverlayView(s, 1)).toMatchObject({
      cinematic: false,
      skipHintVisible: true,
    });
    overlayApplyOp(s, { kind: 'inputLock', on: true }, 1);
    expect(sceneOverlayView(s, 1).cinematic).toBe(true);
    overlayApplyOp(s, { kind: 'inputLock', on: false }, 2);
    expect(sceneOverlayView(s, 2).cinematic).toBe(false);
    overlayApplyOp(s, { kind: 'end' }, 5);
    expect(sceneOverlayView(s, 5).cinematic).toBe(false);
  });

  it('clears cinematic on a skip teardown (end arriving with presentation ops still live)', () => {
    // A skipped scene drops its remaining ops and delivers only end; cinematic
    // must fall to false so the HUD is restored in one step, watched or skipped.
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'start', duration: 10 }, 0);
    overlayApplyOp(s, { kind: 'inputLock', on: true }, 0);
    overlayApplyOp(s, { kind: 'letterbox', on: true }, 0);
    overlayApplyOp(s, { kind: 'fade', to: 'black', dur: 5 }, 0);
    expect(sceneOverlayView(s, 1).cinematic).toBe(true);
    overlayApplyOp(s, { kind: 'end' }, 2);
    expect(sceneOverlayView(s, 2).cinematic).toBe(false);
  });

  it('toggles the letterbox from the op', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'letterbox', on: true }, 0);
    expect(sceneOverlayView(s, 0).letterbox).toBe(true);
    overlayApplyOp(s, { kind: 'letterbox', on: false }, 1);
    expect(sceneOverlayView(s, 1).letterbox).toBe(false);
  });

  it('shows a subtitle line (keys, never prose) and expires it after dur', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(
      s,
      { kind: 'line', speaker: 'lb.speaker.bell', speakerEntityId: 3, key: 'lb.q0.line1', dur: 4 },
      10,
    );
    const m = sceneOverlayView(s, 11);
    expect(m.speakerKey).toBe('lb.speaker.bell');
    expect(m.lineKey).toBe('lb.q0.line1');
    const expired = sceneOverlayView(s, 14.01);
    expect(expired.lineKey).toBeNull();
    expect(expired.speakerKey).toBeNull();
  });

  it('an empty speaker key renders as an unattributed line', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'line', speaker: '', speakerEntityId: null, key: 'lb.x', dur: 4 }, 0);
    const m = sceneOverlayView(s, 1);
    expect(m.speakerKey).toBeNull();
    expect(m.lineKey).toBe('lb.x');
  });

  it('a newer line replaces the current one', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'line', speaker: 'a', speakerEntityId: null, key: 'k1', dur: 8 }, 0);
    overlayApplyOp(s, { kind: 'line', speaker: 'b', speakerEntityId: null, key: 'k2', dur: 8 }, 1);
    expect(sceneOverlayView(s, 2).lineKey).toBe('k2');
  });

  it('fades to black over dur, holds, then fades clear from the current level', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'fade', to: 'black', dur: 2 }, 0);
    expect(sceneOverlayView(s, 0).fadeOpacity).toBeCloseTo(0, 6);
    expect(sceneOverlayView(s, 1).fadeOpacity).toBeCloseTo(0.5, 6);
    expect(sceneOverlayView(s, 2).fadeOpacity).toBeCloseTo(1, 6);
    expect(sceneOverlayView(s, 5).fadeOpacity).toBeCloseTo(1, 6); // holds
    overlayApplyOp(s, { kind: 'fade', to: 'clear', dur: 1 }, 6);
    expect(sceneOverlayView(s, 6.5).fadeOpacity).toBeCloseTo(0.5, 6);
    expect(sceneOverlayView(s, 7).fadeOpacity).toBeCloseTo(0, 6);
  });

  it('a zero-dur fade cuts instantly', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'fade', to: 'black', dur: 0 }, 0);
    expect(sceneOverlayView(s, 0).fadeOpacity).toBeCloseTo(1, 6);
  });

  it('end tears everything down even when the clear ops never arrived (skip path)', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'start', duration: 10 }, 0);
    overlayApplyOp(s, { kind: 'letterbox', on: true }, 0);
    overlayApplyOp(s, { kind: 'fade', to: 'black', dur: 1 }, 0);
    overlayApplyOp(s, { kind: 'line', speaker: 'a', speakerEntityId: null, key: 'k', dur: 30 }, 0);
    overlayApplyOp(s, { kind: 'end' }, 2);
    const m = sceneOverlayView(s, 2);
    expect(m.letterbox).toBe(false);
    expect(m.fadeOpacity).toBe(0);
    expect(m.lineKey).toBeNull();
    expect(m.skipHintVisible).toBe(false);
  });

  it('presentation ops the overlay does not own (camera/music/anim) are ignored', () => {
    const s = createSceneOverlayState();
    overlayApplyOp(s, { kind: 'music', directive: 'silence' }, 0);
    overlayApplyOp(s, { kind: 'camera', shot: { kind: 'release' } }, 0);
    overlayApplyOp(s, { kind: 'anim', entityId: 4, anim: 'wave' }, 0);
    const m = sceneOverlayView(s, 0);
    expect(m.letterbox).toBe(false);
    expect(m.lineKey).toBeNull();
    expect(m.fadeOpacity).toBe(0);
  });

  it('shows a choice reply as a subtitle for SCENE_REPLY_SUBTITLE_SEC', () => {
    const s = createSceneOverlayState();
    overlayShowReply(s, 'lb.q0.reply', 'lb.speaker.marsh', 100);
    const m = sceneOverlayView(s, 100 + SCENE_REPLY_SUBTITLE_SEC - 0.01);
    expect(m.lineKey).toBe('lb.q0.reply');
    expect(m.speakerKey).toBe('lb.speaker.marsh');
    expect(sceneOverlayView(s, 100 + SCENE_REPLY_SUBTITLE_SEC).lineKey).toBeNull();
  });

  it('assigns distinct announcement ids to identical consecutive line and reply occurrences', () => {
    const s = createSceneOverlayState();
    const line = {
      kind: 'line' as const,
      speaker: 'lb.speaker.bell',
      speakerEntityId: 3,
      key: 'lb.q0.line1',
      dur: 4,
    };
    overlayApplyOp(s, line, 0);
    const firstLineId = sceneOverlayView(s, 0).announcementId;
    overlayApplyOp(s, line, 1);
    const secondLineId = sceneOverlayView(s, 1).announcementId;
    expect(secondLineId).toBe(firstLineId + 1);

    overlayShowReply(s, 'lb.q0.reply', 'lb.speaker.marsh', 2);
    const firstReplyId = sceneOverlayView(s, 2).announcementId;
    overlayShowReply(s, 'lb.q0.reply', 'lb.speaker.marsh', 3);
    const secondReplyId = sceneOverlayView(s, 3).announcementId;
    expect(secondReplyId).toBe(firstReplyId + 1);
  });

  it('returns the same reused model container across frames', () => {
    const s = createSceneOverlayState();
    expect(sceneOverlayView(s, 0)).toBe(sceneOverlayView(s, 1));
  });
});
