// Decides how a "Login with Discord" click starts the OAuth flow, split out of
// wireStartScreens() in main.ts so the entry point is unit-testable and a future
// change cannot silently reintroduce a dead button (issue #1988).
//
// Three surfaces, three outcomes:
//   - Web build: a full-page redirect to Discord (startWebOAuth), handled inside
//     startDiscordOAuth('login') which itself branches for NATIVE_APP.
//   - Desktop shell with the preload bridge: open the OS browser to finish OAuth.
//     openBrowserLogin() can reject (IPC failure, browser refused to open), so we
//     attach a catch and surface a localized error instead of a silent no-op.
//   - Desktop shell WITHOUT the bridge (older/broken preload): an in-app redirect
//     to discord.com is blocked by the Electron navigation guard, which looks like
//     a dead button, so we report the error rather than attempt it.

export type DiscordLoginStartOutcome = 'browser-bridge' | 'web-redirect' | 'no-bridge-error';

export interface DiscordLoginStartBridge {
  openBrowserLogin(): Promise<void>;
}

export interface DiscordLoginStartDeps {
  desktopApp: boolean;
  bridge: DiscordLoginStartBridge | null;
  startWebOAuth(): void;
  openBrowserFailed(error: unknown): void;
  bridgeUnavailable(): void;
}

export function startDiscordLogin(deps: DiscordLoginStartDeps): DiscordLoginStartOutcome {
  if (deps.desktopApp) {
    if (deps.bridge) {
      void deps.bridge.openBrowserLogin().catch((error) => {
        deps.openBrowserFailed(error);
      });
      return 'browser-bridge';
    }
    deps.bridgeUnavailable();
    return 'no-bridge-error';
  }
  deps.startWebOAuth();
  return 'web-redirect';
}
