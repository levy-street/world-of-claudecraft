import type { EventEmitter } from 'node:events';

// A freshly-upgraded websocket authenticates with its first frame, but the
// permanent message handler is only attached after an async handshake
// (token + moderation + character lookups, then game.join). The `ws` receiver
// emits 'message' events and the underlying EventEmitter simply drops any that
// have no listener, so a client that sends input immediately after its auth
// frame loses every frame until the handshake resolves.
//
// bufferHandshakeMessages captures those in-flight frames and returns a flush
// callback. Call flush once the real handler is attached to replay the frames
// in order. Frames that arrive after flush are delivered live by the real
// handler, so flushing never duplicates them. Keep the buffer bounded because
// these frames arrive before authentication has completed.
const MAX_HANDSHAKE_FRAMES = 64;

export function bufferHandshakeMessages(ws: EventEmitter, maxFrames = MAX_HANDSHAKE_FRAMES): () => void {
  const pending: unknown[] = [];
  const capture = (data: unknown) => {
    if (pending.length >= maxFrames) return;
    pending.push(data);
  };
  ws.on('message', capture);
  let flushed = false;
  return () => {
    if (flushed) return;
    flushed = true;
    ws.off('message', capture);
    for (const data of pending) ws.emit('message', data);
  };
}
