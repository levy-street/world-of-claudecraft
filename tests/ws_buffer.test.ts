import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { bufferHandshakeMessages } from '../server/ws_buffer';

describe('bufferHandshakeMessages', () => {
  it('replays frames received during the handshake into the real handler, in order', () => {
    const ws = new EventEmitter();
    const flush = bufferHandshakeMessages(ws);

    // frames arrive while authentication is still awaiting the database
    ws.emit('message', 'a');
    ws.emit('message', 'b');

    const handled: unknown[] = [];
    ws.on('message', (d) => handled.push(d));
    expect(handled).toEqual([]); // nothing delivered until the handshake resolves

    flush();
    expect(handled).toEqual(['a', 'b']);
  });

  it('delivers post-handshake frames live without duplicating buffered ones', () => {
    const ws = new EventEmitter();
    const flush = bufferHandshakeMessages(ws);
    ws.emit('message', 'early');

    const handled: unknown[] = [];
    ws.on('message', (d) => handled.push(d));
    flush();
    ws.emit('message', 'late');

    expect(handled).toEqual(['early', 'late']);
  });

  it('is a no-op when no frames arrive during the handshake', () => {
    const ws = new EventEmitter();
    const flush = bufferHandshakeMessages(ws);

    const handled: unknown[] = [];
    ws.on('message', (d) => handled.push(d));
    flush();
    ws.emit('message', 'x');

    expect(handled).toEqual(['x']);
  });

  it('ignores repeated flush calls so frames are never replayed twice', () => {
    const ws = new EventEmitter();
    const flush = bufferHandshakeMessages(ws);
    ws.emit('message', 'once');

    const handled: unknown[] = [];
    ws.on('message', (d) => handled.push(d));
    flush();
    flush();

    expect(handled).toEqual(['once']);
  });

  it('bounds pre-auth buffering and drops excess frames', () => {
    const ws = new EventEmitter();
    const flush = bufferHandshakeMessages(ws, 2);
    ws.emit('message', 'a');
    ws.emit('message', 'b');
    ws.emit('message', 'c');

    const handled: unknown[] = [];
    ws.on('message', (d) => handled.push(d));
    flush();

    expect(handled).toEqual(['a', 'b']);
  });

  it('documents the underlying drop the buffer prevents', () => {
    // Without buffering, a frame emitted before any listener is attached is
    // silently discarded by EventEmitter — exactly the lost-input failure mode.
    const ws = new EventEmitter();
    const handled: unknown[] = [];
    ws.emit('message', 'lost');
    ws.on('message', (d) => handled.push(d));
    expect(handled).toEqual([]);
  });
});
