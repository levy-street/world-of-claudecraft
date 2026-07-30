import { describe, expect, it } from 'vitest';
import {
  cameraChoiceEnablesMouseCamera,
  DEFAULT_CAMERA_CHOICE,
  shouldShowCameraPrompt,
} from '../src/ui/camera_prompt_core';

describe('first-run camera prompt decision', () => {
  describe('shouldShowCameraPrompt', () => {
    it('shows on a fresh desktop browser (no touch, not yet shown)', () => {
      expect(shouldShowCameraPrompt({ touchControlsActive: false, alreadyShown: false })).toBe(
        true,
      );
    });

    it('is suppressed once already answered or dismissed in this browser', () => {
      expect(shouldShowCameraPrompt({ touchControlsActive: false, alreadyShown: true })).toBe(
        false,
      );
    });

    it('is suppressed on a touch-controls device even on first run', () => {
      expect(shouldShowCameraPrompt({ touchControlsActive: true, alreadyShown: false })).toBe(
        false,
      );
    });

    it('is suppressed when both touch and already-shown hold', () => {
      expect(shouldShowCameraPrompt({ touchControlsActive: true, alreadyShown: true })).toBe(false);
    });
  });

  describe('cameraChoiceEnablesMouseCamera', () => {
    it('Mouse Camera enables mouseCamera', () => {
      expect(cameraChoiceEnablesMouseCamera('mouse')).toBe(true);
    });

    it('Classic Camera disables mouseCamera', () => {
      expect(cameraChoiceEnablesMouseCamera('classic')).toBe(false);
    });
  });

  it('defaults to Classic Camera without presenting either choice as recommended', () => {
    expect(DEFAULT_CAMERA_CHOICE).toBe('classic');
    expect(cameraChoiceEnablesMouseCamera(DEFAULT_CAMERA_CHOICE)).toBe(false);
  });
});
