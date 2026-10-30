import { buildWebSocketUrl } from './world_auth_message';

interface WorldSocketHandlers {
  isCurrent(socket: WebSocket): boolean;
  onMessage(raw: string): void;
  onClose(): void;
}

// Foreground recovery can replace a socket before its close event arrives.
// Every callback belongs to its own transport, not whichever socket is current
// when the browser eventually delivers the event.
export function openWorldSocket(
  base: string,
  auth: string,
  handlers: WorldSocketHandlers,
): WebSocket {
  // A selected realm owns the transport origin; otherwise use the page host.
  const url = base
    ? `${base.replace(/^http/, 'ws')}/ws`
    : buildWebSocketUrl(location.protocol, location.host);
  const socket = new WebSocket(url);
  let closed = false;
  socket.onopen = () => {
    if (!closed && handlers.isCurrent(socket)) socket.send(auth);
  };
  socket.onmessage = (event) => {
    if (!closed && handlers.isCurrent(socket)) handlers.onMessage(String(event.data));
  };
  socket.onclose = () => {
    if (closed) return;
    closed = true;
    // Release this transport's closures even if it has been replaced or the
    // world ended. Ownership controls notification, never its own cleanup.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    if (handlers.isCurrent(socket)) handlers.onClose();
  };
  return socket;
}
