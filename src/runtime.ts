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
// whitelists the payloads; 'progress' carries percent, the others version).
export interface DesktopUpdateEvent {
  type: 'available' | 'progress' | 'downloaded';
  version?: string;
  percent?: number;
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
  // Signals that the link POST settled (success or failure) so the shell can
  // cancel the outstanding Steam auth ticket promptly (Valve's CancelAuthTicket
  // contract). Absent on older shells: feature-check before use.
  steamLinkSettled?(): Promise<unknown>;
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
