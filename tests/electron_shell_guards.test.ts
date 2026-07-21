import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PERMISSIONS,
  appNavigationOrigins,
  buildContentSecurityPolicy,
  deriveOrigin,
  extractInlineScriptHashes,
  isDevToolsToggleShortcut,
  isSoftwareRenderer,
  isTrustedSender,
  navigationAllowed,
  originAllowed,
  withCspHeader,
} from '../electron/shell_guards.cjs';

const APP = 'app://worldofclaudecraft';
const DEV = 'http://127.0.0.1:5173';

describe('deriveOrigin (app:// origin-"null" trap)', () => {
  it('derives protocol//host for the app scheme instead of collapsing to "null"', () => {
    expect(deriveOrigin('app://worldofclaudecraft/index.html')).toBe('app://worldofclaudecraft');
    expect(deriveOrigin('app://worldofclaudecraft')).toBe('app://worldofclaudecraft');
    // Every app:// host shares the SAME opaque URL.origin ("null"); protocol//host keeps them apart.
    expect(deriveOrigin('app://otherhost/x')).toBe('app://otherhost');
  });

  it('derives normal origins for http/https', () => {
    expect(deriveOrigin('https://evil.com/a?b=c')).toBe('https://evil.com');
    expect(deriveOrigin('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173');
  });

  it('returns null on a malformed or host-less URL', () => {
    expect(deriveOrigin('not a url')).toBeNull();
    expect(deriveOrigin('http://')).toBeNull();
    expect(deriveOrigin('')).toBeNull();
  });
});

describe('originAllowed', () => {
  const allowed = new Set([APP, DEV]);
  it('allows the app origin regardless of path', () => {
    expect(originAllowed('app://worldofclaudecraft/index.html', allowed)).toBe(true);
    expect(originAllowed('app://worldofclaudecraft/assets/main-abc.js', allowed)).toBe(true);
  });
  it('denies a different app host, foreign https, and malformed URLs', () => {
    expect(originAllowed('app://otherhost/', allowed)).toBe(false);
    expect(originAllowed('https://evil.com', allowed)).toBe(false);
    expect(originAllowed('http://', allowed)).toBe(false);
  });
});

describe('appNavigationOrigins', () => {
  it('always includes the app origin and nothing else without a dev server', () => {
    const origins = appNavigationOrigins(APP, undefined);
    expect(origins.has(APP)).toBe(true);
    expect(origins.size).toBe(1);
  });
  it('adds the dev-server origin when running against Vite', () => {
    const origins = appNavigationOrigins(APP, `${DEV}/`);
    expect(origins.has(APP)).toBe(true);
    expect(origins.has(DEV)).toBe(true);
  });
});

describe('navigationAllowed', () => {
  const main = new Set([APP, DEV]);
  it('allows main-frame navigation within the app and dev origins', () => {
    expect(navigationAllowed('app://worldofclaudecraft/play', true, main)).toBe(true);
    expect(navigationAllowed('http://127.0.0.1:5173/x', true, main)).toBe(true);
  });
  it('blocks main-frame navigation to a foreign origin', () => {
    expect(navigationAllowed('https://evil.com', true, main)).toBe(false);
    expect(navigationAllowed('app://otherhost/', true, main)).toBe(false);
  });
  it('blocks the embedded widget origin in the main frame but allows it in a subframe', () => {
    const turnstile = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    expect(navigationAllowed(turnstile, true, main)).toBe(false);
    expect(navigationAllowed(turnstile, false, main)).toBe(true);
  });
  it('allows WalletConnect verification only as an embedded subframe', () => {
    const verify = 'https://verify.walletconnect.com/session';
    expect(navigationAllowed(verify, true, main)).toBe(false);
    expect(navigationAllowed(verify, false, main)).toBe(true);
  });
  it('denies a malformed navigation URL', () => {
    expect(navigationAllowed('::: not a url', true, main)).toBe(false);
  });
});

describe('extractInlineScriptHashes', () => {
  it('hashes inline scripts and skips external and empty ones', () => {
    const html = [
      '<script src="/assets/main.js"></script>',
      "<script>console.log('boot');</script>",
      '<script></script>',
      '<script type="application/ld+json">{"a":1}</script>',
    ].join('\n');
    const hashes = extractInlineScriptHashes(html);
    // The external-src and empty scripts produce no hash; the two inline bodies do.
    // The boot script's hash is a known-answer sha256 base64.
    expect(hashes).toContain('sha256-4U2nQ7ITQ/rEbjI/yjhM48+cOPZaU2gKejSgBqiZtLY=');
    expect(hashes).toHaveLength(2);
    expect(hashes.every((h) => h.startsWith('sha256-'))).toBe(true);
  });

  it('captures a realistic multi-line bootstrap and skips a src script with attributes', () => {
    // Mirrors the real index.html shape: an async/defer external script, a multi-line
    // IIFE bootstrap, and a JSON-LD data block.
    const html = [
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>',
      '<script>',
      '  (() => {',
      "    if (location.hostname === 'x') window.__woc = 1;",
      '  })();',
      '</script>',
      '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    ].join('\n');
    const hashes = extractInlineScriptHashes(html);
    // The async/defer external script is skipped; the multi-line IIFE and the JSON-LD
    // data block are both hashed.
    expect(hashes).toHaveLength(2);
    expect(hashes.every((h) => /^sha256-[A-Za-z0-9+/]+=*$/.test(h))).toBe(true);
  });
});

describe('ALLOWED_PERMISSIONS (deny-by-default allow-list)', () => {
  it('grants exactly pointerLock and fullscreen', () => {
    expect(ALLOWED_PERMISSIONS.has('pointerLock')).toBe(true);
    expect(ALLOWED_PERMISSIONS.has('fullscreen')).toBe(true);
    expect(ALLOWED_PERMISSIONS.size).toBe(2);
  });
  it('denies sensitive permissions by default', () => {
    const denied = [
      'camera',
      'microphone',
      'geolocation',
      'notifications',
      'media',
      'openExternal',
      'hid',
      'usb',
      'serial',
    ];
    for (const permission of denied) {
      expect(ALLOWED_PERMISSIONS.has(permission)).toBe(false);
    }
  });
});

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy({
    apiOrigin: 'https://worldofclaudecraft.com',
    scriptHashes: ['sha256-abc123'],
  });
  const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

  it('is strict by default and never uses unsafe-eval or inline script', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });

  it('allows wasm and embeds the inline script hashes', () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive('script-src')).toContain("'sha256-abc123'");
  });

  it('lists the HTTPS API origin, wss:, and blob: explicitly in connect-src', () => {
    expect(directive('connect-src')).toContain('https://worldofclaudecraft.com');
    expect(directive('connect-src')).toContain('wss:');
    // blob: is required: GLTFLoader fetch()es a model's embedded textures as blob: URLs.
    expect(directive('connect-src')).toContain('blob:');
  });

  it('allows the matching WebSocket origin for a local HTTP API', () => {
    const localCsp = buildContentSecurityPolicy({ apiOrigin: 'http://127.0.0.1:8787' });
    const localConnectSrc = localCsp.split('; ').find((entry) => entry.startsWith('connect-src '));

    expect(localConnectSrc).toContain('http://127.0.0.1:8787');
    expect(localConnectSrc).toContain('ws://127.0.0.1:8787');
  });

  it('mirrors the web build: Google Fonts, worker blobs, and the Turnstile frame', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('allows only the WalletConnect transport, modal images, fonts, and verification frames', () => {
    expect(directive('connect-src')).toContain('https://*.walletconnect.com');
    expect(directive('connect-src')).toContain('wss://*.walletconnect.com');
    expect(directive('connect-src')).toContain('https://api.web3modal.org');
    expect(directive('img-src')).toContain('https://secure.walletconnect.com');
    expect(directive('font-src')).toContain('https://fonts.reown.com');
    expect(directive('frame-src')).toContain('https://verify.walletconnect.com');
  });
});

describe('withCspHeader', () => {
  it('adds the CSP header and preserves status, statusText, and content-type', () => {
    const upstream = new Response('body', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/javascript' },
    });
    const csp = "default-src 'self'";
    const wrapped = withCspHeader(upstream, csp);
    expect(wrapped.headers.get('Content-Security-Policy')).toBe(csp);
    expect(wrapped.headers.get('Content-Type')).toBe('application/javascript');
    expect(wrapped.status).toBe(200);
    expect(wrapped.statusText).toBe('OK');
  });
});

describe('isDevToolsToggleShortcut', () => {
  it('matches F12 on any platform via key or code', () => {
    expect(isDevToolsToggleShortcut({ type: 'keyDown', key: 'F12' })).toBe(true);
    expect(isDevToolsToggleShortcut({ type: 'keyDown', code: 'F12' })).toBe(true);
  });

  it('matches the Cmd+Option+I chord (macOS) even when Option composes a dead key', () => {
    // On macOS, Option+I composes input.key into a dead-key accent, so the physical
    // code (KeyI) is the reliable signal.
    expect(
      isDevToolsToggleShortcut({ type: 'keyDown', code: 'KeyI', key: 'ˆ', meta: true, alt: true }),
    ).toBe(true);
  });

  it('matches the Ctrl+Shift+I chord (Windows/Linux)', () => {
    expect(
      isDevToolsToggleShortcut({
        type: 'keyDown',
        code: 'KeyI',
        key: 'I',
        control: true,
        shift: true,
      }),
    ).toBe(true);
  });

  it('rejects a bare I, wrong modifiers, keyUp, and non-toggle keys', () => {
    expect(isDevToolsToggleShortcut({ type: 'keyDown', code: 'KeyI', key: 'i' })).toBe(false);
    // Cmd+I alone (no Option) and Ctrl+I alone (no Shift) are not the chord.
    expect(isDevToolsToggleShortcut({ type: 'keyDown', code: 'KeyI', key: 'i', meta: true })).toBe(
      false,
    );
    expect(
      isDevToolsToggleShortcut({ type: 'keyDown', code: 'KeyI', key: 'i', control: true }),
    ).toBe(false);
    // The chord on keyUp must not fire (would double-toggle).
    expect(
      isDevToolsToggleShortcut({
        type: 'keyUp',
        code: 'KeyI',
        key: 'I',
        control: true,
        shift: true,
      }),
    ).toBe(false);
    expect(
      isDevToolsToggleShortcut({
        type: 'keyDown',
        code: 'KeyA',
        key: 'a',
        control: true,
        shift: true,
      }),
    ).toBe(false);
  });

  it('never throws on a null, empty, or partial input object', () => {
    expect(isDevToolsToggleShortcut(null)).toBe(false);
    expect(isDevToolsToggleShortcut(undefined)).toBe(false);
    expect(isDevToolsToggleShortcut({})).toBe(false);
    expect(isDevToolsToggleShortcut({ type: 'keyDown' })).toBe(false);
  });
});

describe('isSoftwareRenderer', () => {
  it('reports hardware acceleration (false) when webgl and webgl2 are enabled', () => {
    expect(isSoftwareRenderer({ webgl: 'enabled', webgl2: 'enabled' })).toBe(false);
  });
  it('flags a SwiftShader/software or disabled WebGL status', () => {
    expect(isSoftwareRenderer({ webgl: 'enabled', webgl2: 'software only' })).toBe(true);
    expect(isSoftwareRenderer({ webgl: 'disabled_software', webgl2: 'enabled' })).toBe(true);
    // The pre-initialization 'disabled_off' the diagnostic must not read too early also
    // classifies as not-hardware if it ever survives to did-finish-load.
    expect(isSoftwareRenderer({ webgl: 'disabled_off' })).toBe(true);
  });
  it('does not cry wolf on an absent, empty, or partial status', () => {
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer({})).toBe(false);
  });
});

describe('isTrustedSender', () => {
  const allowed = new Set([APP, DEV]);
  it('rejects a null or undefined frame (untrusted by default)', () => {
    expect(isTrustedSender(null, allowed)).toBe(false);
    expect(isTrustedSender(undefined, allowed)).toBe(false);
  });
  it('accepts the app frame and the dev-server frame', () => {
    const appFrame = { origin: APP, url: 'app://worldofclaudecraft/index.html' };
    expect(isTrustedSender(appFrame, allowed)).toBe(true);
    expect(isTrustedSender({ origin: DEV, url: `${DEV}/` }, allowed)).toBe(true);
  });
  it('falls back to frame.url when frame.origin is the opaque "null" string', () => {
    expect(isTrustedSender({ origin: 'null', url: 'app://worldofclaudecraft/x' }, allowed)).toBe(
      true,
    );
  });
  it('rejects a foreign sender and a frame with neither a matching origin nor url', () => {
    expect(
      isTrustedSender({ origin: 'https://evil.com', url: 'https://evil.com/x' }, allowed),
    ).toBe(false);
    expect(isTrustedSender({ origin: 'app://otherhost', url: 'app://otherhost/x' }, allowed)).toBe(
      false,
    );
    expect(isTrustedSender({}, allowed)).toBe(false);
  });
});
