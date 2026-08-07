import { describe, expect, it } from 'vitest';
import {
  type GameplayInputSurfaces,
  isGameplayInputBlocked,
} from '../src/game/gameplay_input_gate';

// The gate main.ts hands to Input.canUseGameKeys and the gamepad dispatcher. Cases
// here are whole-surface combinations rather than single flags, because the
// predicate's job is exactly to collapse several independent surfaces into one
// answer, and a per-flag test would stay green while any two of them disagreed.

const NOTHING_OPEN: GameplayInputSurfaces = {
  graphicsRebuildPaused: false,
  modalOpen: false,
  promptModalOpen: false,
  cameraPromptOpen: false,
  chatComposerVisible: false,
  chatComposerFocused: false,
};

describe('gameplay input gate', () => {
  it('lets keys through when no surface is up', () => {
    expect(isGameplayInputBlocked(NOTHING_OPEN)).toBe(false);
  });

  it('blocks on each modal surface independently', () => {
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, modalOpen: true })).toBe(true);
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, promptModalOpen: true })).toBe(true);
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, cameraPromptOpen: true })).toBe(true);
  });

  it('blocks while the renderer is being rebuilt', () => {
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, graphicsRebuildPaused: true })).toBe(true);
  });

  it('blocks while the composer holds keyboard focus', () => {
    expect(
      isGameplayInputBlocked({
        ...NOTHING_OPEN,
        chatComposerVisible: true,
        chatComposerFocused: true,
      }),
    ).toBe(true);
  });

  // The load-bearing case: an on-screen composer without focus receives no keystrokes,
  // so it must not block either. Gating on presence instead of focus leaves a keypress
  // reaching neither the game nor the composer, and movement stays dead until focus
  // returns. This is the only case that fails if the gate starts reading
  // chatComposerVisible, which is why the field is passed in and left unread.
  it('does not block while the composer is visible but unfocused', () => {
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, chatComposerVisible: true })).toBe(false);
  });

  // Focus is what counts, in both directions: a composer can legitimately hold focus
  // while the caller reports it hidden (a close path that blurs after hiding), and that
  // still blocks, so the two fields are never collapsed back into one.
  it('blocks on focus even when the caller reports the composer hidden', () => {
    expect(isGameplayInputBlocked({ ...NOTHING_OPEN, chatComposerFocused: true })).toBe(true);
  });

  it('a modal still blocks while the composer is visible and unfocused', () => {
    expect(
      isGameplayInputBlocked({ ...NOTHING_OPEN, modalOpen: true, chatComposerVisible: true }),
    ).toBe(true);
  });

  it('blocks when every surface is up at once', () => {
    expect(
      isGameplayInputBlocked({
        graphicsRebuildPaused: true,
        modalOpen: true,
        promptModalOpen: true,
        cameraPromptOpen: true,
        chatComposerVisible: true,
        chatComposerFocused: true,
      }),
    ).toBe(true);
  });
});
