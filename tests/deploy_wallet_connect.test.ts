import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

function runWalletReturn(options: { closeSucceeds: boolean; includePending?: boolean }) {
  const callbackScript = readFileSync('public/wallet-return.js', 'utf8');
  const replace = vi.fn();
  const returnUrl = 'https://dev.worldofclaudecraft.com/play';
  const storage = new Map<string, string>();
  if (options.includePending !== false) {
    storage.set(
      'woc.wallet.mobile.v1.pending.request-1',
      JSON.stringify({ returnUrl, createdAt: Date.now() }),
    );
  }
  const fakeWindow: {
    location: { origin: string; search: string; replace: typeof replace };
    localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    close(): void;
    closed: boolean;
  } = {
    location: {
      origin: 'https://dev.worldofclaudecraft.com',
      search: '?woc_wallet_request=request-1&data=encrypted',
      replace,
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    close: () => {
      if (options.closeSucceeds) fakeWindow.closed = true;
    },
    closed: false,
  };
  const close = vi.spyOn(fakeWindow, 'close');
  runInNewContext(callbackScript, {
    window: fakeWindow,
    URL,
    URLSearchParams,
    JSON,
  });
  return { close, replace, returnUrl, storage };
}

describe('Reown AppKit Solana deploy container contract', () => {
  it('uses Reown AppKit with its dedicated Solana adapter', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const source = readFileSync('src/net/wallet_connect.ts', 'utf8');

    expect(pkg.dependencies?.['@reown/appkit-adapter-solana']).toBe('1.8.22');
    expect(pkg.dependencies?.['@reown/appkit-universal-connector']).toBeUndefined();
    expect(source).toContain('new SolanaAdapter');
    expect(source).toContain('createAppKit');
    expect(source).not.toContain('UniversalConnector');
  });

  it('ships the mobile wallet browser return target', () => {
    const callback = readFileSync('public/wallet-return.html', 'utf8');
    const callbackScript = readFileSync('public/wallet-return.js', 'utf8');

    expect(callback).toContain('/wallet-return.js');
    expect(callbackScript).toContain('woc_wallet_request');
    expect(callbackScript).toContain('woc.wallet.mobile.v1');
    const launcher = readFileSync('src/ui/mobile_wallet_launcher.ts', 'utf8');
    expect(launcher).toContain("'_blank', 'noopener,noreferrer'");
    expect(launcher).not.toContain('.opener');
  });

  it('wires installed-web-app resume events back into the active wallet client', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const resume = readFileSync('src/net/wallet_resume.ts', 'utf8');

    expect(main).toContain('installWalletResumeHandlers(() => {');
    expect(main).toContain('void walletMod.resumeWalletConnection().catch(() => {});');
    expect(resume).toContain("document.addEventListener('visibilitychange', onVisible)");
    expect(resume).toContain("window.addEventListener('focus', onFocus)");
    expect(resume).toContain("window.addEventListener('pageshow', onPageShow)");
  });

  it('closes the isolated wallet callback tab when the browser permits it', () => {
    const result = runWalletReturn({ closeSucceeds: true });

    expect(result.close).toHaveBeenCalledOnce();
    expect(result.replace).not.toHaveBeenCalled();
  });

  it('returns directly to the game instead of leaving a blank tab when close is blocked', () => {
    const result = runWalletReturn({ closeSucceeds: false });

    expect(result.close).toHaveBeenCalledOnce();
    expect(result.replace).toHaveBeenCalledWith(result.returnUrl);
  });

  it('rejects callback writes that do not match a pending wallet request', () => {
    const result = runWalletReturn({ closeSucceeds: false, includePending: false });

    expect(result.storage.has('woc.wallet.mobile.v1.response.request-1')).toBe(false);
    expect(result.replace).toHaveBeenCalledWith('/');
    expect(result.close).not.toHaveBeenCalled();
  });

  it('passes the public Reown project id into the game client build', () => {
    expect(compose).toContain(`VITE_REOWN_PROJECT_ID: ${composeEnv('VITE_REOWN_PROJECT_ID')}`);
    expect(dockerfile).toContain('ARG VITE_REOWN_PROJECT_ID=""');
    expect(dockerfile).toContain('VITE_REOWN_PROJECT_ID="$VITE_REOWN_PROJECT_ID"');
  });
});
