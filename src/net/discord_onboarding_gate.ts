// A just-completed Discord login normally drops the player straight into online
// play (capturing a recovery email first if the Discord grant did not supply
// one). But the desktop-login handoff page (`/desktop-login`) is a special boot
// target: it exists only to mint a one-time deep-link code for the waiting
// desktop shell and must never race into loading the game itself, exactly like
// the resume-marker guard a few lines above it in main.ts. Both arms fired at
// once (the recovery-email prompt driving `enterOnlinePlayFlow` and
// `completeDesktopBrowserLogin` both starting) is the bug this predicate closes:
// share the same pure decision at both call sites so they cannot drift apart.
export function shouldEnterDiscordOnboarding(
  discordOnboarding: boolean,
  isDesktopLoginPage: boolean,
): boolean {
  return discordOnboarding && !isDesktopLoginPage;
}
