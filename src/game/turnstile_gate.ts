// --- Cloudflare Turnstile (bot gate on the login/register form) ---------------
// The site key is injected at build time; when it is empty (local/offline dev or
// a build without the env var) the widget never renders and the token is '', so
// the server, which also skips verification without its secret, lets requests
// through unchanged. Cloudflare's api.js loads the first time the form asks for the
// widget (ensureTurnstile), not with the page, so the landing's first paint never waits
// on a third-party script.
// Moved whole out of src/main.ts (the firewall rule: bootstrap helpers live in
// src/game/ siblings) under the monolith ratchet.
import { DESKTOP_APP } from '../net/online';

export const TURNSTILE_SITEKEY = String(import.meta.env.VITE_TURNSTILE_SITEKEY ?? '');

interface TurnstileApi {
  render: (el: string | HTMLElement, opts: { sitekey: string }) => string;
  getResponse: (widgetId?: string) => string | undefined;
  reset: (widgetId?: string) => void;
}
let turnstileWidgetId: string | undefined;

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** Add Cloudflare's api.js once; later calls find the tag and wait for it. */
function loadTurnstileScript(): void {
  if (document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)) return;
  const script = document.createElement('script');
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  document.head.appendChild(script);
}

// Render the widget once, retrying until the async api.js script is ready. Safe to
// call repeatedly (idempotent) and a no-op when no site key is configured. The
// Electron desktop shell never renders it: Cloudflare rejects the app:// origin
// (widget error 110200), and the server bypasses Turnstile for desktop origins
// (passesTurnstile in server/turnstile.ts), so a widget here could only wedge
// the form.
export function ensureTurnstile(): void {
  if (DESKTOP_APP || !TURNSTILE_SITEKEY || turnstileWidgetId !== undefined) return;
  const ts = turnstileApi();
  const el = document.getElementById('cf-turnstile-container');
  if (!ts || !el) {
    if (!ts) loadTurnstileScript();
    window.setTimeout(ensureTurnstile, 200);
    return;
  }
  turnstileWidgetId = ts.render(el, { sitekey: TURNSTILE_SITEKEY });
}

// The current single-use token, or '' when verification is not configured / not
// yet solved. Tokens are consumed server-side, so reset after each attempt.
export function turnstileToken(): string {
  const ts = turnstileApi();
  if (!TURNSTILE_SITEKEY || !ts || turnstileWidgetId === undefined) return '';
  return ts.getResponse(turnstileWidgetId) ?? '';
}

export function resetTurnstile(): void {
  const ts = turnstileApi();
  if (ts && turnstileWidgetId !== undefined) ts.reset(turnstileWidgetId);
}
