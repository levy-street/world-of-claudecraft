import { describe, expect, it } from 'vitest';
import {
  decodeFrames,
  encodeFrame,
  encodeHandshake,
  encodePong,
  encodeSetActivity,
  HEADER_BYTES,
  MAX_FRAME_BYTES,
  OPCODES,
} from '../electron/discord_presence_codec.cjs';

// The Discord IPC frame codec (electron/discord_presence_codec.cjs) is pure, so
// the whole wire contract is exercised here without a socket. Two things make
// that worth doing properly rather than with one happy-path roundtrip:
//
//  1. The layout is a LITERAL agreement with a program we do not ship. A header
//     written big-endian, or a length counted in characters instead of bytes,
//     produces a buffer that looks perfectly reasonable in a roundtrip test
//     (our own decoder would read back what our own encoder wrote) and is
//     rejected by the real Discord client. So the bytes themselves are pinned.
//  2. The decoder reads a STREAM. Chunk boundaries are chosen by the kernel, so
//     every split position is a case the shipped code will eventually meet, and
//     a decoder that mishandles one of them fails on a player's machine and
//     nowhere else. The fuzz arms below walk all of them.

/** A tiny deterministic PRNG, so the garbage arm is reproducible on a failure. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A raw frame built by hand, so a test can write a header the encoder would not. */
function rawFrame(opcode: number, lengthWord: number, body: Buffer): Buffer {
  const frame = Buffer.alloc(HEADER_BYTES + body.length);
  frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(lengthWord, 4);
  body.copy(frame, HEADER_BYTES);
  return frame;
}

describe('discord IPC frame codec (electron/discord_presence_codec.cjs)', () => {
  it('pins the opcode table and the inbound cap to their literals', () => {
    // These are Discord's numbers, not ours: renumbering one would send a
    // handshake the daemon reads as a CLOSE.
    expect(OPCODES).toEqual({ HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 });
    expect(HEADER_BYTES).toBe(8);
    expect(MAX_FRAME_BYTES).toBe(65536);
  });

  it('pins the exact bytes of a handshake frame', () => {
    // The whole layout in one literal: opcode word 00000000, length word
    // 19000000 (25, little-endian), then the JSON. A big-endian header would
    // read 0x19000000 here, which is both a wrong opcode and a length past the
    // cap, and no roundtrip assertion would notice.
    const frame = encodeHandshake('123');
    expect(frame.toString('hex')).toBe(
      '00000000190000007b2276223a312c22636c69656e745f6964223a22313233227d',
    );
    expect(frame.length).toBe(33);
    expect([...frame.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...frame.subarray(4, 8)]).toEqual([25, 0, 0, 0]);
    expect(frame.subarray(HEADER_BYTES).toString('utf8')).toBe('{"v":1,"client_id":"123"}');
  });

  it('counts the length word in BYTES, not characters', () => {
    // A non-ASCII zone or character name is the realistic case: a length in
    // characters would have the reader stop short and treat the tail of one
    // frame as the head of the next.
    // Built from a code point rather than typed inline, so the assertion cannot
    // be weakened by an editor rewriting the source file's encoding.
    const details = `Vale of Kings ${String.fromCodePoint(0x00e9)}`;
    const frame = encodeFrame(OPCODES.FRAME, { details });
    const json = JSON.stringify({ details });
    expect(frame.readUInt32LE(4)).toBe(Buffer.byteLength(json, 'utf8'));
    expect(frame.readUInt32LE(4)).toBeGreaterThan(json.length);
    expect(frame.length).toBe(HEADER_BYTES + frame.readUInt32LE(4));
    // And it round-trips: the decoder reads the same character back.
    const decoded = decodeFrames(frame);
    expect(decoded.frames).toEqual([{ opcode: 1, payload: { details } }]);
  });

  it('omits the activity key entirely when clearing', () => {
    // The confirmed clear shape. An empty activity object is a MALFORMED
    // activity to Discord, not an absent one, so the difference between these
    // two payloads is the difference between "presence gone" and "rejected".
    const clear = encodeSetActivity('woc-7', 4321, null).subarray(HEADER_BYTES).toString('utf8');
    expect(clear).toBe('{"cmd":"SET_ACTIVITY","args":{"pid":4321},"nonce":"woc-7"}');
    expect(clear).not.toContain('activity');
    // undefined is the same clear (a caller that simply omitted the argument).
    expect(
      encodeSetActivity('woc-7', 4321, undefined).subarray(HEADER_BYTES).toString('utf8'),
    ).toBe(clear);
    const set = encodeSetActivity('woc-8', 4321, { details: 'Eastbrook' })
      .subarray(HEADER_BYTES)
      .toString('utf8');
    expect(set).toBe(
      '{"cmd":"SET_ACTIVITY","args":{"pid":4321,"activity":{"details":"Eastbrook"}},"nonce":"woc-8"}',
    );
    expect(set).toContain('activity');
  });

  it('encodes a pong that echoes the ping payload on opcode 4', () => {
    const frame = encodePong({ nonce: 'abc' });
    expect(frame.readUInt32LE(0)).toBe(OPCODES.PONG);
    expect(frame.subarray(HEADER_BYTES).toString('utf8')).toBe('{"nonce":"abc"}');
    // An absent payload still encodes as JSON, never as a zero-length body the
    // daemon would read as a malformed frame.
    expect(encodePong(undefined).subarray(HEADER_BYTES).toString('utf8')).toBe('{}');
  });

  it('reassembles a multi-frame stream at EVERY split position', () => {
    const stream = Buffer.concat([
      encodeHandshake('123456789012345678'),
      encodeFrame(OPCODES.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }),
      encodeFrame(OPCODES.PING, {}),
      encodeSetActivity('woc-1', 99, { details: 'Vale of Kings', timestamps: { start: 17 } }),
    ]);
    const whole = decodeFrames(stream);
    expect(whole.frames).toHaveLength(4);
    expect(whole.rest).toHaveLength(0);
    expect(whole.error).toBeNull();

    // Two-way split: every boundary the kernel could hand us, including inside
    // a header word and inside a payload.
    for (let split = 0; split <= stream.length; split += 1) {
      const first = decodeFrames(stream.subarray(0, split));
      expect(first.error, `split ${split} must not error`).toBeNull();
      const second = decodeFrames(Buffer.concat([first.rest, stream.subarray(split)]));
      expect(second.error, `split ${split} must not error`).toBeNull();
      expect(
        [...first.frames, ...second.frames],
        `split ${split} loses or reorders a frame`,
      ).toEqual(whole.frames);
      expect(second.rest).toHaveLength(0);
    }

    // And the worst case a real socket can produce: one byte per read.
    let accumulator: Buffer = Buffer.alloc(0);
    const drained: unknown[] = [];
    for (const byte of stream) {
      accumulator = Buffer.concat([accumulator, Buffer.from([byte])]);
      const result = decodeFrames(accumulator);
      expect(result.error).toBeNull();
      accumulator = result.rest;
      drained.push(...result.frames);
    }
    expect(drained).toEqual(whole.frames);
    expect(accumulator).toHaveLength(0);
  });

  it('never throws on random garbage, whatever the length', () => {
    // The decoder is the first thing to touch bytes from a socket the shell
    // does not own. A throw here would land in a 'data' handler, i.e. as an
    // uncaught exception in the main process.
    const random = createRandom(0x5eed);
    for (let run = 0; run < 200; run += 1) {
      const length = Math.floor(random() * 40);
      const bytes = Buffer.alloc(length);
      for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(random() * 256);
      const result = decodeFrames(bytes);
      expect(Array.isArray(result.frames)).toBe(true);
      expect(Buffer.isBuffer(result.rest)).toBe(true);
      // Nothing is ever invented: what was not consumed is still there to be
      // consumed, and a decoder that dropped bytes silently would desync.
      expect(result.rest.length).toBeLessThanOrEqual(bytes.length);
    }
  });

  it('stops on a length word past the cap, keeping the frames it already drained', () => {
    const good = encodeFrame(OPCODES.FRAME, { evt: 'READY' });
    const stream = Buffer.concat([
      good,
      rawFrame(OPCODES.FRAME, MAX_FRAME_BYTES + 1, Buffer.alloc(0)),
    ]);
    const result = decodeFrames(stream);
    expect(result.error).toBe('oversize');
    expect(result.frames).toEqual([{ opcode: 1, payload: { evt: 'READY' } }]);
    // The rest starts AT the bad header, not after it: the caller destroys the
    // socket, and leaving the bad bytes in place keeps that decision the
    // caller's rather than half-made here.
    expect(result.rest.readUInt32LE(4)).toBe(MAX_FRAME_BYTES + 1);
    // Exactly at the cap is accepted (the bound is strictly greater), so the
    // error cannot be satisfied by refusing everything large.
    const atCap = rawFrame(OPCODES.FRAME, MAX_FRAME_BYTES, Buffer.alloc(0));
    expect(decodeFrames(atCap).error).toBeNull();
    expect(decodeFrames(atCap).frames).toEqual([]);
    // High-bit length words pin the UNSIGNED read: under a readInt32LE
    // regression these go negative, skip both the oversize compare and the
    // completeness break, and the decode loop walks BACKWARD forever, so the
    // only symptom would be a vitest HANG in the fuzz arm rather than a red.
    expect(decodeFrames(rawFrame(OPCODES.FRAME, 0x80000000, Buffer.alloc(0))).error).toBe(
      'oversize',
    );
    expect(decodeFrames(rawFrame(OPCODES.FRAME, 0xffffffff, Buffer.alloc(0))).error).toBe(
      'oversize',
    );
  });

  it('stops on an opcode above the known five', () => {
    const stream = Buffer.concat([
      encodeFrame(OPCODES.PING, {}),
      rawFrame(5, 2, Buffer.from('{}', 'utf8')),
    ]);
    const result = decodeFrames(stream);
    expect(result.error).toBe('bad-opcode');
    expect(result.frames).toEqual([{ opcode: 3, payload: {} }]);
    expect(result.rest.readUInt32LE(0)).toBe(5);
    // Opcode 4 is the last VALID one, so the boundary is pinned from both
    // sides rather than by a check that could be off by one.
    expect(decodeFrames(rawFrame(4, 2, Buffer.from('{}', 'utf8'))).error).toBeNull();
  });

  it('yields a null payload for a body that is not JSON, and keeps reading', () => {
    // A frame we cannot read is not a stream we cannot read: the header was
    // well formed, so the next frame's position is known exactly.
    const stream = Buffer.concat([
      rawFrame(OPCODES.FRAME, 7, Buffer.from('not+json', 'utf8').subarray(0, 7)),
      encodeFrame(OPCODES.FRAME, { evt: 'READY' }),
    ]);
    const result = decodeFrames(stream);
    expect(result.error).toBeNull();
    expect(result.frames).toEqual([
      { opcode: 1, payload: null },
      { opcode: 1, payload: { evt: 'READY' } },
    ]);
    expect(result.rest).toHaveLength(0);
  });

  it('treats a zero-length payload as a readable frame with a null payload', () => {
    const stream = Buffer.concat([
      rawFrame(OPCODES.CLOSE, 0, Buffer.alloc(0)),
      encodeFrame(OPCODES.PONG, { ok: true }),
    ]);
    const result = decodeFrames(stream);
    expect(result.frames).toEqual([
      { opcode: 2, payload: null },
      { opcode: 4, payload: { ok: true } },
    ]);
    expect(result.error).toBeNull();
    expect(result.rest).toHaveLength(0);
  });

  it('waits for a header it does not have yet', () => {
    const empty = decodeFrames(Buffer.alloc(0));
    expect(empty.frames).toEqual([]);
    expect(empty.rest).toHaveLength(0);
    expect(empty.error).toBeNull();

    // One byte short of a header: nothing may be consumed, and the bytes must
    // come back intact rather than being dropped as unusable.
    const partial = encodeFrame(OPCODES.FRAME, { evt: 'READY' }).subarray(0, 7);
    const result = decodeFrames(partial);
    expect(result.frames).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.rest.equals(partial)).toBe(true);
  });

  it('waits for a payload the header promised but the socket has not delivered', () => {
    const frame = encodeFrame(OPCODES.FRAME, { evt: 'READY' });
    const short = frame.subarray(0, frame.length - 1);
    const result = decodeFrames(short);
    expect(result.frames).toEqual([]);
    expect(result.rest.equals(short)).toBe(true);
    // The header is NOT consumed while waiting: consuming it would leave the
    // caller unable to tell how many payload bytes are still outstanding.
    expect(result.rest.readUInt32LE(4)).toBe(frame.length - HEADER_BYTES);
  });
});
