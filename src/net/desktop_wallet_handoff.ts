export type DesktopWalletBrowserResult =
  | { kind: 'link'; address: string; nonce: string; signature: string }
  | { kind: 'transaction'; address: string; signature: string };

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

export type DesktopWalletBrowserAction =
  | { kind: 'link' }
  | { kind: 'transaction'; reference: string; expectedAddress: string };

interface DesktopWalletHandoffBridge {
  openWalletBrowser(code: string): Promise<boolean>;
  takeWalletHandoffCode?(): Promise<string | null>;
  onWalletHandoffCode?(callback: (code: string) => void): () => void;
}

interface DesktopWalletHandoffApi {
  createDesktopWalletHandoff(
    action: DesktopWalletBrowserAction,
  ): Promise<{ code: string; expiresInMs: number }>;
  desktopWalletHandoffResult(code: string): Promise<DesktopWalletStatus>;
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
