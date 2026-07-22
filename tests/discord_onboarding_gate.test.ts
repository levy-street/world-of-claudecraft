import { describe, expect, it } from 'vitest';

import { shouldEnterDiscordOnboarding } from '../src/net/discord_onboarding_gate';

describe('shouldEnterDiscordOnboarding', () => {
  it('enters online play onboarding for a normal (non-desktop-handoff) Discord login', () => {
    expect(shouldEnterDiscordOnboarding(true, false)).toBe(true);
  });

  it('does not fire when there is no pending Discord onboarding at all', () => {
    expect(shouldEnterDiscordOnboarding(false, false)).toBe(false);
    expect(shouldEnterDiscordOnboarding(false, true)).toBe(false);
  });

  it('is gated off on the desktop-login handoff page even with onboarding pending', () => {
    // Regression: the handoff page must only mint its deep-link code via
    // completeDesktopBrowserLogin, never race it by also entering online play
    // (which could show the recovery-email prompt on the browser tab while the
    // desktop shell is waiting for the OS-level prompt).
    expect(shouldEnterDiscordOnboarding(true, true)).toBe(false);
  });
});
