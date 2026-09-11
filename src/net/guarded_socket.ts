// One socket, one owner: the handlers bound here fire only while the socket is
// still its owner's CURRENT transport, so a socket the owner has replaced can
// never speak to it again.
//
// Why: ClientWorld replaces its socket on every reconnect, and a mobile
// foreground can find a "zombie" socket (the OS killed the transport while the
// page was frozen, but the browser has not delivered its close event yet).
// The zombie branch reports that drop by hand and schedules a fast retry. With
// plain handlers the abandoned socket stayed wired to the same callbacks, so
// when its real close event finally landed AFTER the replacement had already
// connected, it was counted as a brand-new drop against a live transport: the
// client opened a duplicate socket for the same character, the server refused
// it with 'character already in world' because the replacement was alive, that
// refusal's close scheduled another duplicate, and after the bounded run of
// refusals the client ended a perfectly healthy session with the fatal
// "Return to Login" overlay. The identity guard makes every late event from a
// superseded socket a no-op.
//
// Client-only (src/net): touches the WebSocket API directly, never sim state.

export interface GuardedSocketHandlers {
  // The first frame to send once the socket opens (the world auth message).
  auth: () => string;
  message: (data: string) => void;
  close: () => void;
}

// Open a socket whose handlers are gated on `current() === ws`: the owner must
// assign the returned socket as its current one synchronously (no event can
// fire before the caller's next turn), after which any event from a socket the
// owner has since replaced is ignored.
export function openGuardedSocket(
  url: string,
  current: () => WebSocket | undefined,
  handlers: GuardedSocketHandlers,
): WebSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => {
    if (current() === ws) ws.send(handlers.auth());
  };
  ws.onmessage = (ev) => {
    if (current() === ws) handlers.message(String(ev.data));
  };
  ws.onclose = () => {
    if (current() === ws) handlers.close();
  };
  return ws;
}
