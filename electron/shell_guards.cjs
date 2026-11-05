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
// frame): the Cloudflare Turnstile bot-gate renders in its own cross-origin iframe, the
// WalletConnect modal verifies in its own, and the Claudium store's Stripe Embedded
// Checkout (src/net/stripe_checkout.ts) mounts Stripe's iframes on the page.
const EMBEDDED_SUBFRAME_ORIGINS = new Set([
  'https://challenges.cloudflare.com',
  'https://secure.walletconnect.com',
  'https://secure.walletconnect.org',
  'https://verify.walletconnect.com',
  'https://verify.walletconnect.org',
  'https://js.stripe.com',
  'https://checkout.stripe.com',
  'https://hooks.stripe.com',
  'https://link.com',
]);

// Stripe starts some of its frames on per-session subdomains (Stripe's CSP guidance lists
// https://*.js.stripe.com and https://*.link.com for exactly that), which an exact-origin
// set cannot name. A subframe whose HTTPS host ends with one of these suffixes is allowed;
// the leading dot means the bare parent host is matched by the exact set above, never a
// look-alike such as evil-js.stripe.com or js.stripe.com.evil.com.
const EMBEDDED_SUBFRAME_HOST_SUFFIXES = Object.freeze(['.js.stripe.com', '.link.com']);

function subframeHostSuffixAllowed(urlString, suffixes) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  return suffixes.some((suffix) => host.length > suffix.length && host.endsWith(suffix));
}

// Decide whether a navigation to `url` is permitted. Main-frame navigations may only
// target the app or dev origin (the top-level hijack surface that setWindowOpenHandler
// does not cover); subframes may additionally load the embedded widget origins. A
// parse failure denies.
function navigationAllowed(
  url,
  isMainFrame,
  mainFrameOrigins,
  subframeOrigins = EMBEDDED_SUBFRAME_ORIGINS,
  subframeHostSuffixes = EMBEDDED_SUBFRAME_HOST_SUFFIXES,
) {
  const origin = deriveOrigin(url);
  if (!origin) return false;
  if (toOriginSet(mainFrameOrigins).has(origin)) return true;
  if (isMainFrame) return false;
  if (toOriginSet(subframeOrigins).has(origin)) return true;
  return subframeHostSuffixAllowed(url, subframeHostSuffixes);
}

// Embed roots whose OWN nested frames are not knowable in advance: Stripe Checkout. A
// 3D Secure challenge renders the card issuer's ACS page (any bank's origin) inside
// hooks.stripe.com and then returns inside Stripe's own frames. Only these roots relax
// their subtree; Turnstile, WalletConnect and Link roots keep the strict list throughout.
const NESTED_FRAME_ROOT_ORIGINS = Object.freeze(
  new Set(['https://js.stripe.com', 'https://checkout.stripe.com', 'https://hooks.stripe.com']),
);
const NESTED_FRAME_ROOT_HOST_SUFFIXES = Object.freeze(['.js.stripe.com']);

// Schemes a frame nested below a NESTED_FRAME_ROOT may load. Plaintext http: and local
// schemes (file:, app:) are denied, and so is any URL (or blob: URL) in an app or dev
// origin: a document there would be same-origin with the main frame.
const NESTED_FRAME_SCHEMES = Object.freeze(new Set(['https:', 'about:', 'blob:', 'data:']));

// The parent-frame URLs of a WebFrameMain-like frame, nearest first, ending at the main
// frame. Returns null when the frame is gone or a disposed frame's getter throws, which
// callers treat as "ancestry unknown" (the strict rule).
function frameAncestorUrls(frame) {
  try {
    if (!frame) return null;
    const urls = [];
    for (let parent = frame.parent; parent; parent = parent.parent) urls.push(parent.url);
    return urls;
  } catch {
    return null;
  }
}

function nestedFrameUrlAllowed(url, mainOrigins) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!NESTED_FRAME_SCHEMES.has(parsed.protocol)) return false;
  if (mainOrigins.has(deriveOrigin(url))) return false;
  if (parsed.protocol === 'blob:') {
    // blob:<origin>/<uuid>: the document runs in the inner origin.
    const inner = deriveOrigin(parsed.pathname);
    if (!inner || mainOrigins.has(inner) || !inner.startsWith('https:')) return false;
  }
  return true;
}

// The guard for will-frame-navigate / will-redirect. Electron emits these for EVERY frame
// in the tree, so frames Stripe Checkout nests inside its own iframe were gated against
// the app's embed list too, which blanked a 3D Secure challenge and left the desktop
// checkout greyed out on its processing state. The main frame and every frame not below
// a NESTED_FRAME_ROOT keep the strict navigationAllowed rule. A frame at depth two or more
// whose ancestry provably ends at the main frame and whose embed root (the main frame's
// direct child) is a NESTED_FRAME_ROOT may load any nestedFrameUrlAllowed URL.
// `ancestorUrls` is nearest first, ending at the main frame (frameAncestorUrls); null or
// a short list means the strict rule.
function frameNavigationAllowed(
  url,
  isMainFrame,
  ancestorUrls,
  mainFrameOrigins,
  subframeOrigins = EMBEDDED_SUBFRAME_ORIGINS,
  subframeHostSuffixes = EMBEDDED_SUBFRAME_HOST_SUFFIXES,
) {
  const strict = () =>
    navigationAllowed(url, isMainFrame, mainFrameOrigins, subframeOrigins, subframeHostSuffixes);
  if (isMainFrame || !Array.isArray(ancestorUrls) || ancestorUrls.length < 2) return strict();
  const mainOrigins = toOriginSet(mainFrameOrigins);
  if (!mainOrigins.has(deriveOrigin(ancestorUrls[ancestorUrls.length - 1]))) return strict();
  const embedRoot = ancestorUrls[ancestorUrls.length - 2];
  const rootIsNestedFrameRoot =
    NESTED_FRAME_ROOT_ORIGINS.has(deriveOrigin(embedRoot)) ||
    subframeHostSuffixAllowed(embedRoot, NESTED_FRAME_ROOT_HOST_SUFFIXES);
  if (!rootIsNestedFrameRoot) return strict();
  return nestedFrameUrlAllowed(url, mainOrigins);
}

// The full guardNavigation decision for an Electron navigation `details` object, pure so a
// Vitest can drive it. A missing isMainFrame is the main frame (the safe default), and any
// throw while reading the frame tree blocks rather than escaping the listener (an uncaught
// exception in the main process exits the app via the crash guard).
function navigationDecision(details, mainFrameOrigins) {
  try {
    const isMainFrame = details.isMainFrame !== false;
    const ancestors = isMainFrame ? [] : frameAncestorUrls(details.frame);
    return {
      allowed: frameNavigationAllowed(details.url, isMainFrame, ancestors, mainFrameOrigins),
      isMainFrame,
    };
  } catch {
    return { allowed: false, isMainFrame: details?.isMainFrame !== false };
  }
}

// External document paths that belong in the system browser rather than navigating
// the desktop game shell.
const EXTERNAL_DOCUMENT_PATHS = new Set([
  '/terms',
  '/terms.html',
  '/privacy',
  '/privacy.html',
  '/support',
  '/support.html',
  '/data-deletion',
  '/data-deletion.html',
  '/wiki',
  '/wiki/',
]);

// Determine whether a URL represents an external document (PDF or standalone legal/help page)
// that should be opened in the system browser rather than navigating the desktop game shell.
function isExternalDocumentUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.pathname.toLowerCase().endsWith('.pdf')) return true;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return EXTERNAL_DOCUMENT_PATHS.has(path) || EXTERNAL_DOCUMENT_PATHS.has(parsed.pathname);
}

// Convert an app:// or relative document URL into a canonical public web URL
// suitable for passing to the OS shell (shell.openExternal).
function toCanonicalExternalUrl(
  urlString,
  _appOrigin = 'app://worldofclaudecraft',
  apiOrigin = 'https://worldofclaudecraft.com',
) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return urlString;
  }
  const base = apiOrigin || 'https://worldofclaudecraft.com';
  if (parsed.protocol === 'app:' || parsed.protocol === 'file:') {
    return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, base).toString();
  }
  return urlString;
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
  // Image origins the web client loads: tracking-pixel beacons, WalletConnect
  // modal art, and Discord linked profile pictures (nameplates, HUD widget,
  // target frame, inspect). Discord PFPs use DISCORD_CDN_BASE in
  // server/discord_oauth.ts (`cdn.discordapp.com`); without that origin here the
  // desktop CSP blocks every avatar while the browser build (no CSP) still
  // paints them, which is exactly the desktop-only regression we hit on
  // release/v0.34.0.
  img: [
    'https://www.google-analytics.com',
    'https://www.facebook.com',
    'https://secure.walletconnect.com',
    'https://secure.walletconnect.org',
    'https://api.web3modal.org',
    'https://cdn.discordapp.com',
  ],
  // Cloudflare Turnstile: api.js (script) plus the challenge iframe (frame).
  turnstile: 'https://challenges.cloudflare.com',
  // Stripe Embedded Checkout for the Claudium store (src/net/stripe_checkout.ts loads
  // https://js.stripe.com/v3/ and mounts the checkout iframe). Without these the desktop
  // shell alone fails every card purchase with "Checkout could not be loaded" while the
  // browser build (no CSP) works: the v0.42.0 desktop-only report. The lists follow
  // Stripe's CSP guidance for Stripe.js, Checkout, and Link (the wallet inside Checkout):
  // script and frame for js.stripe.com and its per-session subdomains, hooks.stripe.com
  // for 3D Secure redirects, checkout.stripe.com for Checkout, api.stripe.com for
  // Stripe.js calls, and the link.com family for Link's authentication frames.
  stripe: {
    script: ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://checkout.stripe.com'],
    connect: [
      'https://api.stripe.com',
      'https://checkout.stripe.com',
      'https://link.com',
      'https://*.link.com',
    ],
    frame: [
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
      'https://checkout.stripe.com',
      'https://link.com',
      'https://*.link.com',
    ],
    img: ['https://*.stripe.com', 'https://*.link.com'],
  },
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
// ships several executable inline scripts (the i18n stored-locale bootstrap, whose body
// varies per build, the analytics snippets and the boot splash fail-safe), so the
// hashes are read from the built file at runtime rather than hard-coded. Inline
// scripts never contain a literal </script> (the i18n injector escapes '<'), so the
// non-greedy match is safe here.
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
    ...CSP_ORIGINS.stripe.script,
  ]
    .filter(Boolean)
    .join(' ');
  // connect-src needs blob: because Three.js GLTFLoader loads a model's embedded textures
  // by turning them into blob: object URLs and then fetch()ing those URLs (a connect-src
  // request, not img-src). Without blob: here every model renders untextured. img-src and
  // worker-src already list blob: for the same reason (texture <img> decode, decoder workers).
  // data: is here for the same class of reason: three's ZSTDDecoder (KTX2Loader's Zstandard
  // path, taken by every UASTC normal/occlusion map) instantiates its WASM with
  // fetch("data:application/wasm;base64,...").then(r => r.arrayBuffer()), a connect-src request
  // to a data: URI. Without data: here every Zstandard-supercompressed KTX2 GLB throws
  // "Refused to connect" and world entry dies on the desktop shell (the only host that ships a
  // CSP). data: is a self-contained inline scheme, not a network origin, so unlike a remote
  // host it opens no exfiltration path; img-src already lists it for the same texture reason.
  const connectSrc = [
    "connect-src 'self' blob: data:",
    apiOrigin,
    deriveWebSocketOrigin(apiOrigin),
    'wss:',
    ...CSP_ORIGINS.connect,
    ...CSP_ORIGINS.stripe.connect,
  ]
    .filter(Boolean)
    .join(' ');
  const imgSrc = [
    "img-src 'self' data: blob:",
    apiOrigin,
    ...CSP_ORIGINS.img,
    ...CSP_ORIGINS.stripe.img,
  ]
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
    `frame-src ${CSP_ORIGINS.turnstile} ${CSP_ORIGINS.walletFrames.join(' ')} ${CSP_ORIGINS.stripe.frame.join(' ')}`,
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
// is the DevTools toggle chord. The packaged build nulls the application menu on
// win32/linux (main.cjs, before app ready) and never auto-opens
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
  frameAncestorUrls,
  frameNavigationAllowed,
  navigationDecision,
  NESTED_FRAME_ROOT_ORIGINS,
  isTrustedSender,
  isDevToolsToggleShortcut,
  isSoftwareRenderer,
  ALLOWED_PERMISSIONS,
  EMBEDDED_SUBFRAME_ORIGINS,
  EMBEDDED_SUBFRAME_HOST_SUFFIXES,
  CSP_ORIGINS,
  extractInlineScriptHashes,
  buildContentSecurityPolicy,
  withCspHeader,
  EXTERNAL_DOCUMENT_PATHS,
  isExternalDocumentUrl,
  toCanonicalExternalUrl,
};
