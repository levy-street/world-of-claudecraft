'use strict';

// Pure, Node-testable guards for the Electron shell. electron/main.cjs is a CommonJS
// entry that runs outside tsc and vitest, so the origin-comparison and navigation
// logic (and, added alongside their consumers, the CSP builder and trusted-sender
// check) live here where a Vitest can import and exercise them directly
// (tests/electron_shell_guards.test.ts). Only node:crypto is required (for CSP
// hashing); no electron imports.

const { createHash } = require('node:crypto');

// The only permissions the game legitimately uses (pointerLock for mouselook,
// fullscreen for the game view). Everything else is denied by default. Kept here so a
// unit test can pin the contract against an accidental deletion.
const ALLOWED_PERMISSIONS = new Set(['pointerLock', 'fullscreen']);

// Derive a comparable origin from a URL string as `${protocol}//${host}`. This is
// deliberately NOT `new URL(x).origin`: app:// is a non-standard scheme, so Node's
// URL reports its origin as the literal string "null" and every app:// host
// collapses to that same "null", which would defeat an origin allow-list. Returns
// null on a parse failure (or a URL with no host) so callers deny.
function deriveOrigin(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }
  if (!parsed.protocol || !parsed.host) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

function toOriginSet(origins) {
  return origins instanceof Set ? origins : new Set(origins);
}

// True when urlString's derived origin is a member of allowedOrigins (an iterable of
// `${protocol}//${host}` strings). Parse failures and host-less URLs deny.
function originAllowed(urlString, allowedOrigins) {
  const origin = deriveOrigin(urlString);
  if (!origin) return false;
  return toOriginSet(allowedOrigins).has(origin);
}

// The origins the MAIN frame may navigate to: the app origin always, plus the
// dev-server origin when running against Vite (devServerUrl set).
function appNavigationOrigins(appOrigin, devServerUrl) {
  const origins = new Set();
  const app = deriveOrigin(appOrigin);
  if (app) origins.add(app);
  if (devServerUrl) {
    const dev = deriveOrigin(devServerUrl);
    if (dev) origins.add(dev);
  }
  return origins;
}

// Third-party origins the app legitimately embeds in a SUBFRAME only (never the main
// frame): the Cloudflare Turnstile bot-gate renders in its own cross-origin iframe.
const EMBEDDED_SUBFRAME_ORIGINS = new Set([
  'https://challenges.cloudflare.com',
  'https://secure.walletconnect.com',
  'https://secure.walletconnect.org',
  'https://verify.walletconnect.com',
  'https://verify.walletconnect.org',
]);

// Decide whether a navigation to `url` is permitted. Main-frame navigations may only
// target the app or dev origin (the top-level hijack surface that setWindowOpenHandler
// does not cover); subframes may additionally load the embedded widget origins. A
// parse failure denies.
function navigationAllowed(
  url,
  isMainFrame,
  mainFrameOrigins,
  subframeOrigins = EMBEDDED_SUBFRAME_ORIGINS,
) {
  const origin = deriveOrigin(url);
  if (!origin) return false;
  if (toOriginSet(mainFrameOrigins).has(origin)) return true;
  if (!isMainFrame && toOriginSet(subframeOrigins).has(origin)) return true;
  return false;
}

// Third-party origins the shipped index.html actually uses. The desktop shell keeps
// the same behavior as the web build (chosen posture), so the CSP allow-lists exactly
// these and nothing more. Grouped by the directive each feeds.
const CSP_ORIGINS = {
  // <script src> that index.html loads: Google Tag Manager (gtag) and the Meta Pixel
  // loader. Cloudflare Turnstile's api.js is added separately (it also needs frame-src).
  script: ['https://www.googletagmanager.com', 'https://connect.facebook.net'],
  // fetch/beacon endpoints those tags talk to.
  connect: [
    'https://www.google-analytics.com',
    'https://www.googletagmanager.com',
    'https://connect.facebook.net',
    'https://www.facebook.com',
    'https://*.walletconnect.com',
    'wss://*.walletconnect.com',
    'https://*.walletconnect.org',
    'wss://*.walletconnect.org',
    'https://api.web3modal.org',
    'https://pulse.walletconnect.org',
  ],
  // tracking-pixel image beacons.
  img: [
    'https://www.google-analytics.com',
    'https://www.facebook.com',
    'https://secure.walletconnect.com',
    'https://secure.walletconnect.org',
    'https://api.web3modal.org',
  ],
  // Cloudflare Turnstile: api.js (script) plus the challenge iframe (frame).
  turnstile: 'https://challenges.cloudflare.com',
  // Google Fonts: the stylesheet origin (style-src) and the font-file origin (font-src).
  fontsStyle: 'https://fonts.googleapis.com',
  fontsFile: 'https://fonts.gstatic.com',
  reownFonts: 'https://fonts.reown.com',
  walletFrames: [
    'https://secure.walletconnect.com',
    'https://secure.walletconnect.org',
    'https://verify.walletconnect.com',
    'https://verify.walletconnect.org',
  ],
};

// Extract a CSP source-hash (`sha256-<base64>`) for every INLINE <script> in html
// (one with no `src` attribute and a non-empty body), matching what a browser hashes:
// the exact text between the tags. External <script src> tags need no hash. index.html
// ships three executable inline scripts (the i18n stored-locale bootstrap, whose body
// varies per build, plus the analytics snippets), so the hashes are read from the built
// file at runtime rather than hard-coded. Inline scripts never contain a literal
// </script> (the i18n injector escapes '<'), so the non-greedy match is safe here.
function extractInlineScriptHashes(html) {
  const hashes = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match !== null) {
    const attrs = match[1];
    const body = match[2];
    if (!/\bsrc\s*=/i.test(attrs) && body.length > 0) {
      hashes.push(`sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`);
    }
    match = re.exec(html);
  }
  return hashes;
}

// Build the Content-Security-Policy string served on every app:// response. Strict
// same-origin by default; script-src stays hash-based ('unsafe-inline' is never used)
// with 'wasm-unsafe-eval' for Three.js WASM (never 'unsafe-eval'); connect-src lists
// the API and matching WebSocket origins explicitly; a blob worker-src covers decoder workers.
// The third-party origins index.html uses are allow-listed per directive.
function deriveWebSocketOrigin(apiOrigin) {
  try {
    const url = new URL(apiOrigin);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    else return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function buildContentSecurityPolicy({ apiOrigin, scriptHashes = [] } = {}) {
  const hashPart = scriptHashes.map((h) => `'${h}'`).join(' ');
  const scriptSrc = [
    "script-src 'self' 'wasm-unsafe-eval'",
    hashPart,
    CSP_ORIGINS.turnstile,
    ...CSP_ORIGINS.script,
  ]
    .filter(Boolean)
    .join(' ');
  // connect-src needs blob: because Three.js GLTFLoader loads a model's embedded textures
  // by turning them into blob: object URLs and then fetch()ing those URLs (a connect-src
  // request, not img-src). Without blob: here every model renders untextured. img-src and
  // worker-src already list blob: for the same reason (texture <img> decode, decoder workers).
  const connectSrc = [
    "connect-src 'self' blob:",
    apiOrigin,
    deriveWebSocketOrigin(apiOrigin),
    'wss:',
    ...CSP_ORIGINS.connect,
  ]
    .filter(Boolean)
    .join(' ');
  const imgSrc = ["img-src 'self' data: blob:", apiOrigin, ...CSP_ORIGINS.img]
    .filter(Boolean)
    .join(' ');
  return [
    "default-src 'self'",
    scriptSrc,
    connectSrc,
    imgSrc,
    `style-src 'self' 'unsafe-inline' ${CSP_ORIGINS.fontsStyle}`,
    `font-src 'self' ${CSP_ORIGINS.fontsFile} ${CSP_ORIGINS.reownFonts}`,
    "worker-src 'self' blob:",
    `frame-src ${CSP_ORIGINS.turnstile} ${CSP_ORIGINS.walletFrames.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Return a NEW Response that copies an upstream net.fetch Response (body, status,
// statusText, headers, so the Content-Type / MIME survives, which JS/CSS/WASM need)
// and adds the CSP header. net.fetch's own Response has immutable headers, so a fresh
// one is required rather than headers.set on the original.
function withCspHeader(response, csp) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', csp);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Validate an IPC sender frame against the trusted origins. event.senderFrame is
// WebFrameMain | null, so a null/falsy frame is untrusted. Prefer frame.origin
// (Chromium computes it and knows app:// is a registered standard scheme), falling
// back to deriving protocol//host from frame.url for any origin-"null" edge. Never
// throws (unlike the docs' validateSender sample, which host-parses frame.url with no
// null guard). allowedOrigins are the same main-frame origins used by the nav guard.
function isTrustedSender(frame, allowedOrigins) {
  if (!frame) return false;
  const set = toOriginSet(allowedOrigins);
  if (typeof frame.origin === 'string' && frame.origin && set.has(frame.origin)) return true;
  if (typeof frame.url === 'string') {
    const origin = deriveOrigin(frame.url);
    if (origin && set.has(origin)) return true;
  }
  return false;
}

// Decide whether a renderer key event (Electron's before-input-event `input` object)
// is the DevTools toggle chord. The packaged build runs with setMenu(null) and no
// DevTools, so there is otherwise no way to open the inspector to check CSP violations,
// GPU state, or runtime errors in a shipped app; main.cjs binds this to before-input-event
// to restore a safe, read-only debug affordance. Only a keyDown counts. The accepted
// chords are F12 (all platforms), Cmd+Option+I (macOS), and Ctrl+Shift+I (Windows/Linux),
// each matched loosely so either chord works on any platform. The letter is matched on the
// PHYSICAL key (input.code === 'KeyI') because on macOS holding Option composes input.key
// into a dead-key accent, which would make an input.key check miss. Never throws on a
// partial/foreign input object (returns false).
function isDevToolsToggleShortcut(input) {
  if (input?.type !== 'keyDown') return false;
  const code = typeof input.code === 'string' ? input.code : '';
  const key = typeof input.key === 'string' ? input.key : '';
  if (code === 'F12' || key === 'F12') return true;
  const isLetterI = code === 'KeyI' || key.toLowerCase() === 'i';
  if (!isLetterI) return false;
  if (input.meta && input.alt) return true;
  if (input.control && input.shift) return true;
  return false;
}

// Classify an app.getGPUFeatureStatus() result: true when WebGL is anything other than
// hardware-accelerated. A 'software only' or 'disabled' webgl/webgl2 status means Chromium
// fell back to SwiftShader, which a WebGL game must not silently run on; main.cjs warns on
// this in its startup GPU diagnostic. An absent/empty status returns false (do not cry wolf
// before the GPU process has reported). Pure so a unit test can pin the classification.
function isSoftwareRenderer(status) {
  const gl = `${status?.webgl ?? ''} ${status?.webgl2 ?? ''}`;
  return /software|disabled/i.test(gl);
}

module.exports = {
  deriveOrigin,
  originAllowed,
  appNavigationOrigins,
  navigationAllowed,
  isTrustedSender,
  isDevToolsToggleShortcut,
  isSoftwareRenderer,
  ALLOWED_PERMISSIONS,
  EMBEDDED_SUBFRAME_ORIGINS,
  CSP_ORIGINS,
  extractInlineScriptHashes,
  buildContentSecurityPolicy,
  withCspHeader,
};
