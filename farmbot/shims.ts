// Node runtime shims for ClientWorld (src/net/online.ts), which was written
// for a browser. installNodeShims() must run BEFORE `new ClientWorld(...)`:
// the constructor opens the socket and arms the 20 Hz input timer immediately
// via `window.setInterval`. Import-time is fine; construction-time is what
// matters.
//
// What ClientWorld actually uses (verified at online.ts openSocket/close):
//   new WebSocket(url), ws.onopen / ws.onmessage / ws.onclose property
//   handlers (never addEventListener, never onerror), ws.send(string),
//   ws.close(), ws.onclose = null, and the WebSocket.OPEN static for
//   readyState checks. Message data goes through String(ev.data), so the
//   Buffer that `ws` delivers stringifies to valid JSON without a binaryType
//   dance. The `ws` package (already a repo dependency, used the same way by
//   bot/gateway.ts) matches every one of these, including the
//   CONNECTING/OPEN/CLOSING/CLOSED statics, so it is installed directly with
//   no adapter.
//
// Note: recent Node ships a built-in global WebSocket (undici). It is
// overwritten on purpose so the bot runs on the pinned, repo-tested `ws`
// implementation instead of whichever undici the runtime carries.
//
// One Node-specific hardening: `ws` emits an 'error' event on connection
// failure, and an EventEmitter 'error' with no listener THROWS. ClientWorld
// listens only for close (the browser model, where error precedes close and
// needs no handler), so a refused reconnect crashed the whole process. The
// subclass swallows the event; ws still emits close afterwards, which is the
// signal ClientWorld's backoff actually waits for (verified live when the
// server died mid-session).
//
// fetch is wrapped to send the Electron desktop shell's Origin on every
// request. Production auth enforces two client-class gates (see
// server/web_login_guard.ts and server/turnstile.ts): /api/login rejects
// requests without a recognised Origin ("logins are only allowed from the
// game client"), and Turnstile admits the desktop origins without a widget
// token because the widget cannot pass domain validation at app:// origins
// (a deliberate, documented softening). The bot presents itself as the
// desktop client, which is the only headless-viable client class: the web
// origin would need a real Turnstile token. Node's undici fetch happily
// sends the Origin header browsers treat as forbidden.

import { WebSocket as WsWebSocket } from 'ws';

// Must match the DESKTOP_APP_ORIGINS entry in server/web_login_guard.ts.
const DESKTOP_ORIGIN = 'app://worldofclaudecraft';

class SafeWebSocket extends WsWebSocket {
  constructor(...args: ConstructorParameters<typeof WsWebSocket>) {
    super(...args);
    this.on('error', () => {});
  }
}

export function installNodeShims(): void {
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.WebSocket = SafeWebSocket;
  const baseFetch = globalThis.fetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has('Origin')) headers.set('Origin', DESKTOP_ORIGIN);
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}
