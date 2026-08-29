const DEFAULT_DESKTOP_API_ORIGIN = 'https://worldofclaudecraft.com';

export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported origin protocol: ${url.protocol}`);
  }
  return url.origin;
}

export function isElectronRuntime(userAgent = globalThis.navigator?.userAgent ?? ''): boolean {
  return /\bElectron\//.test(userAgent);
}

export function isDesktopAppRuntime(userAgent = globalThis.navigator?.userAgent ?? ''): boolean {
  return String(import.meta.env.VITE_DESKTOP_APP ?? '') === '1' || isElectronRuntime(userAgent);
}

export function desktopApiOrigin(): string {
  const configured = String(import.meta.env.VITE_DESKTOP_API_ORIGIN ?? '').trim();
  return normalizeOrigin(configured || DEFAULT_DESKTOP_API_ORIGIN);
}

export function runtimeApiOrigin(userAgent = globalThis.navigator?.userAgent ?? ''): string {
  if (String(import.meta.env.VITE_DESKTOP_RELATIVE_API ?? '') === '1') return '';
  return isDesktopAppRuntime(userAgent) ? desktopApiOrigin() : '';
}

export function runtimeWebSocketUrl(
  protocol: string,
  host: string,
  origin = runtimeApiOrigin(),
): string {
  if (origin) {
    const url = new URL(normalizeOrigin(origin));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = '';
    url.hash = '';
    return url.toString();
  }
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

// One auto-update event forwarded by the shell (electron/update_events.cjs
// whitelists the payloads; 'progress' carries percent, 'available' and
// 'downloaded' carry version, and 'checking'/'not-available'/'error' are bare
// notifications: 'error' never carries a message by design).
export interface DesktopUpdateEvent {
  type: 'checking' | 'available' | 'progress' | 'downloaded' | 'not-available' | 'error';
  version?: string;
  percent?: number;
}

// One OS-level notification the page asks the shell to post. `kind` is the
// call site, not a payload variant: the shell keys its own per-kind policy
// (coalescing, click routing) off it, and the two strings arrive already
// localized because the main process has no i18n runtime.
export interface DesktopNotificationRequest {
  kind: 'update-ready' | 'party-invite';
  title: string;
  body: string;
}

// One main-world uncaught error relayed to the shell's log file
// (src/game/desktop_error_relay.ts builds it; the shell clamps + validates).
export interface DesktopRendererErrorReport {
  kind: 'error' | 'unhandledrejection';
  message?: string;
  stack?: string;
  source?: string;
  line?: number;
  col?: number;
}

// The shell's GPU verdict for this machine (electron pushes it once the GPU
// info is known): whether Chromium fell back to a software rasterizer, and
// whether a machine with a dedicated GPU is running the session on the
// power-saving one. `adapter` is the shell's GL adapter description (capped at
// 64 chars on both sides of the bridge) and is deliberately UNREAD today: it is
// a device-fingerprint string, so do not log, render, or transmit it. It rides
// along so a future opt-in diagnostics surface can show it without a bridge
// change.
export interface DesktopGpuStatus {
  softwareRendering: boolean;
  discreteInactive: boolean;
  adapter: string;
}

// Whether the shell's window is minimized or hidden. The page cannot observe
// this for itself: the desktop window is created with backgroundThrottling:false
// so the render loop keeps running when backgrounded, which also means the Page
// Visibility API reports 'visible' the entire time the window is minimized.
export interface DesktopPresentationState {
  hidden: boolean;
}

// The OS scaling of the display the shell's window currently sits on, pushed
// when it changes. One field on purpose: the display's identity is what decides
// main-side whether a move between two same-scale monitors is worth forwarding,
// so that stable OS-derived id never crosses the bridge, and neither do bounds
// or the display label. The scale factor is no new capability, the page already
// reads window.devicePixelRatio; what it cannot do is notice a pure scale change.
export interface DesktopDisplayChange {
  scaleFactor: number;
}

// The desktop window's presentation mode. Electron has no exclusive
// fullscreen: 'borderless' is setFullScreen(true) on the window's current
// display, 'windowed' is a normal frame restored to the remembered bounds.
export type DesktopDisplayMode = 'borderless' | 'windowed';

// One Discord Rich Presence activity, as the shell's RPC client wants it.
// Deliberately tiny: `details` is the zone line under the "Playing World of
// ClaudeCraft" the app registration supplies, and `start` (unix epoch SECONDS,
// not milliseconds) drives Discord's own elapsed-time clock. Nothing that
// identifies the player may be added here: the presence is public to everyone
// who can see their Discord profile (src/game/discord_presence.ts).
export interface DesktopDiscordActivity {
  details: string;
  timestamps?: { start: number };
}

export interface DesktopBridge {
  openBrowserLogin(): Promise<void>;
  takeLoginCode(): Promise<string | null>;
  onLoginCode(callback: (code: string) => void): () => void;
  openWalletBrowser?(code: string): Promise<boolean>;
  takeWalletHandoffCode?(): Promise<string | null>;
  onWalletHandoffCode?(callback: (code: string) => void): () => void;
  // Optional: these shipped after the three login methods, so an older
  // installed shell may not expose them; feature-check before use. The bridge
  // detection below deliberately requires only the login trio, or a shell
  // predating an update feature would lose LOGIN too.
  setShellStrings?(strings: Record<string, string>): Promise<null>;
  reportRendererError?(report: DesktopRendererErrorReport): void;
  onUpdateEvent?(callback: (event: DesktopUpdateEvent) => void): () => void;
  installUpdate?(): Promise<null>;
  // A Steam link ticket (hex) for POST /api/steam/link, or null when Steam is
  // unavailable (website build, Steam not running, ticket failure). Feature-
  // check before use like the other post-trio methods.
  steamLinkTicket?(): Promise<string | null>;
  // Whether the shell can mint link tickets at all (false on packaged website
  // builds, where every steamLinkTicket call answers null). Absent on older
  // shells that predate the capability probe: fall back to steamLinkTicket
  // presence there. Feature-check before use like the other post-trio methods.
  steamLinkSupported?(): Promise<boolean>;
  // Website-distributed desktop builds may connect external wallets. Steam
  // builds return false so wallet code and controls remain absent there.
  walletConnectionSupported?(): Promise<boolean>;
  // Whether the $WOC Exchange may attach in this shell: true only when the
  // main process proves the website distribution from its packaged stamp;
  // Steam, Epic, and unstamped builds answer false. Absent on older shells:
  // the Exchange gate treats absence as false (fail-closed), never as
  // browser web. Feature-check before use like the other post-trio methods.
  wocExchangeSupported?(): Promise<boolean>;
  // Signals that the link POST settled (success or failure) so the shell can
  // cancel the outstanding Steam auth ticket promptly (Valve's CancelAuthTicket
  // contract). Absent on older shells: feature-check before use.
  steamLinkSettled?(): Promise<unknown>;
  // An Epic link proof (string) for POST /api/epic/link, or null when Epic is
  // unavailable (website/steam build, no launcher session, adapter missing).
  // Feature-check before use like the other post-trio methods.
  epicLinkProof?(): Promise<string | null>;
  // Whether the shell can mint Epic link proofs at all (false on packaged
  // website/steam builds). Capability may be true even when epicLinkProof
  // returns null without native EOS. Absent on older shells: fall back to
  // epicLinkProof presence. Feature-check before use.
  epicLinkSupported?(): Promise<boolean>;
  // Signals that the Epic link POST settled so any cancelable adapter handle
  // can be released. Absent on older shells: feature-check before use.
  epicLinkSettled?(): Promise<unknown>;
  // The shell's GPU verdict, pushed once it is known (it can land before or
  // after the notice that consumes it). Absent on older shells that predate the
  // verdict: feature-check before use, like the other post-trio methods.
  onGpuStatus?(callback: (status: DesktopGpuStatus) => void): () => void;
  // Window hidden-ness and display changes, both push-only and both absent on
  // older shells: feature-check before use, like the other post-trio methods.
  onPresentationChanged?(callback: (state: DesktopPresentationState) => void): () => void;
  onDisplayChanged?(callback: (change: DesktopDisplayChange) => void): () => void;
  // The persisted GPU-force opt-out (the MUXless-panel escape hatch). The shell
  // prefs store is the source of truth; the getter returns the STORED value
  // (what the next launch will do), and the setter persists for the next
  // launch, never the running one. Absent on older shells: feature-check
  // before use, like the other post-trio methods.
  getGpuForceOptOut?(): Promise<boolean>;
  setGpuForceOptOut?(optOut: boolean): Promise<boolean>;
  // The persisted display mode. The shell prefs store is the source of truth;
  // the setter persists AND applies it to the live window (unlike the GPU
  // pref, which only takes effect next launch), the getter returns the stored
  // value. Absent on older shells: feature-check before use, like the other
  // post-trio methods.
  getDisplayMode?(): Promise<DesktopDisplayMode>;
  setDisplayMode?(mode: DesktopDisplayMode): Promise<boolean>;
  // Gracefully exits the desktop application through the shell's normal quit
  // lifecycle. Absent on older shells: feature-check before use.
  quitApp?(): Promise<boolean>;
  // Posts an OS notification. Absent on older shells: feature-check before use,
  // like the other post-trio methods.
  showNotification?(request: DesktopNotificationRequest): void;
  // Fire-and-forget gamepad-activity ping feeding the shell's display-sleep
  // blocker (the shell rate-limits and debounces; the renderer throttles its
  // own sends). Absent on older shells: feature-check before use.
  notifyGamepadActivity?(): void;
  // Discord Rich Presence, both fire-and-forget: setDiscordActivity publishes
  // one activity (null clears it), and setDiscordPresenceEnabled carries the
  // player's options-row choice so the shell can drop its RPC connection
  // entirely rather than merely stop publishing. Absent on older shells:
  // feature-check before use.
  setDiscordActivity?(activity: DesktopDiscordActivity | null): void;
  setDiscordPresenceEnabled?(enabled: boolean): void;
}

export function desktopBridge(): DesktopBridge | null {
  const candidate = (globalThis as unknown as { wocDesktop?: unknown }).wocDesktop;
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<DesktopBridge>;
  if (
    typeof bridge.openBrowserLogin !== 'function' ||
    typeof bridge.takeLoginCode !== 'function' ||
    typeof bridge.onLoginCode !== 'function'
  )
    return null;
  return bridge as DesktopBridge;
}
