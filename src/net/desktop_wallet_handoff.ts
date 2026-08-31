export type DesktopWalletBrowserResult =
  | { kind: 'link'; address: string; nonce: string; signature: string }
  | { kind: 'transaction'; address: string; signature: string }
  | { kind: 'stepup'; address: string; signature: string };

export type DesktopWalletStatus =
  | { status: 'missing' | 'pending' }
  | { status: 'complete'; result: DesktopWalletBrowserResult };

const HANDOFF_CODE = /^[A-Za-z0-9_-]{43}$/;

export function walletHandoffCodeFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('code');
  return raw && HANDOFF_CODE.test(raw) ? raw : null;
}

interface WaitOptions {
  code: string;
  status(code: string): Promise<DesktopWalletStatus>;
  wait(): Promise<void>;
  timeoutMs: number;
  now(): number;
}

// The 'stepup' kind carries only the server-issued challenge NONCE, never the
// message: the server resolves the signed text from its own stored challenge
// (the same never-trust-renderer-bytes stance as 'transaction', whose
// reference resolves a server-registered quote).
export type DesktopWalletBrowserAction =
  | { kind: 'link' }
  | { kind: 'transaction'; reference: string; expectedAddress: string }
  | { kind: 'stepup'; nonce: string; expectedAddress: string };

interface DesktopWalletHandoffBridge {
  openWalletBrowser(code: string): Promise<boolean>;
  takeWalletHandoffCode?(): Promise<string | null>;
  onWalletHandoffCode?(callback: (code: string) => void): () => void;
}

export interface DesktopWalletHandoffApi {
  createDesktopWalletHandoff(
    action: DesktopWalletBrowserAction,
  ): Promise<{ code: string; expiresInMs: number }>;
  desktopWalletHandoffResult(code: string): Promise<DesktopWalletStatus>;
}

/** The optional preload-bridge slice the handoff needs (src/runtime.ts
 *  DesktopBridge methods are all optional: older shells may lack them). */
export interface DesktopWalletHostBridge {
  openWalletBrowser?(code: string): Promise<boolean>;
  takeWalletHandoffCode?(): Promise<string | null>;
  onWalletHandoffCode?(callback: (code: string) => void): () => void;
}

/** Whether the external-browser wallet handoff can run in this shell. */
export function desktopWalletHandoffAvailable(
  desktopApp: boolean,
  bridge: DesktopWalletHostBridge | null,
): boolean {
  return desktopApp && !!bridge?.openWalletBrowser;
}

/** Run one browser wallet authorization over the live shell bridge. Extracted
 *  from src/main.ts (the firewall keeps a thin delegator); the throw strings
 *  are classified by src/ui/wallet_bridge_reason_text.ts, keep them stable. */
export async function authorizeDesktopWalletHandoff(
  action: DesktopWalletBrowserAction,
  api: DesktopWalletHandoffApi,
  bridge: DesktopWalletHostBridge | null,
): Promise<DesktopWalletBrowserResult> {
  const openWalletBrowser = bridge?.openWalletBrowser;
  if (!openWalletBrowser) throw new Error('desktop wallet browser is unavailable');
  const takeWalletHandoffCode = bridge.takeWalletHandoffCode;
  const onWalletHandoffCode = bridge.onWalletHandoffCode;
  return performDesktopWalletHandoff(action, api, {
    openWalletBrowser: (code) => openWalletBrowser(code),
    takeWalletHandoffCode: takeWalletHandoffCode ? () => takeWalletHandoffCode() : undefined,
    onWalletHandoffCode: onWalletHandoffCode
      ? (callback) => onWalletHandoffCode(callback)
      : undefined,
  });
}

/** Validate one /api/desktop-wallet/result payload into the status union.
 *  Anything malformed (an unknown kind included) reads as 'missing', which the
 *  poller surfaces as an expired authorization: fail-closed, never a crash. */
export function parseDesktopWalletHandoffStatus(
  data: Record<string, unknown>,
): DesktopWalletStatus {
  if (data.status !== 'complete' || !data.result || typeof data.result !== 'object') {
    return { status: data.status === 'pending' ? 'pending' : 'missing' };
  }
  const result = data.result as Record<string, unknown>;
  if (typeof result.address !== 'string' || typeof result.signature !== 'string') {
    return { status: 'missing' };
  }
  const { address, signature } = result;
  if (result.kind === 'link' && typeof result.nonce === 'string') {
    return {
      status: 'complete',
      result: { kind: 'link', address, nonce: result.nonce, signature },
    };
  }
  if (result.kind === 'transaction') {
    return { status: 'complete', result: { kind: 'transaction', address, signature } };
  }
  if (result.kind === 'stepup') {
    return { status: 'complete', result: { kind: 'stepup', address, signature } };
  }
  return { status: 'missing' };
}

export async function waitForDesktopWalletResult(
  options: WaitOptions,
): Promise<DesktopWalletBrowserResult> {
  const startedAt = options.now();
  while (options.now() - startedAt < options.timeoutMs) {
    const state = await options.status(options.code);
    if (state.status === 'complete') return state.result;
    if (state.status === 'missing') throw new Error('wallet authorization expired');
    await options.wait();
  }
  throw new Error('wallet authorization timed out');
}

export async function performDesktopWalletHandoff(
  action: DesktopWalletBrowserAction,
  api: DesktopWalletHandoffApi,
  bridge: DesktopWalletHandoffBridge,
): Promise<DesktopWalletBrowserResult> {
  const { code, expiresInMs } = await api.createDesktopWalletHandoff(action);
  if (!HANDOFF_CODE.test(code) || expiresInMs <= 0) {
    throw new Error('server returned an invalid wallet authorization');
  }

  let signaled = false;
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const signal = (returnedCode: string | null): void => {
    if (returnedCode !== code) return;
    signaled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    wake?.();
    wake = null;
  };
  const unsubscribe = bridge.onWalletHandoffCode?.(signal) ?? (() => {});
  try {
    const pendingCode = await bridge.takeWalletHandoffCode?.();
    signal(pendingCode ?? null);
    if (!(await bridge.openWalletBrowser(code))) {
      throw new Error('could not open wallet authorization in the browser');
    }
    return await waitForDesktopWalletResult({
      code,
      status: (value) => api.desktopWalletHandoffResult(value),
      timeoutMs: expiresInMs,
      now: Date.now,
      wait: () => {
        if (signaled) {
          signaled = false;
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(() => {
            timer = null;
            wake = null;
            resolve();
          }, 1_000);
        });
      },
    });
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}
