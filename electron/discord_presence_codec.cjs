'use strict';

// The Discord IPC frame format, and nothing else.
//
// Discord's local RPC socket speaks a fixed 8-byte header (32-bit little-endian
// opcode, 32-bit little-endian payload length) followed by a UTF-8 JSON payload.
// That is the whole wire contract, so it lives here as pure functions over
// Buffers: no socket, no timers, no electron. The connection manager
// (electron/discord_presence.cjs) owns every decision; this module owns only the
// bytes, which is what lets tests/electron_discord_codec.test.ts fuzz the
// decoder at every split position without a Discord client anywhere.
//
// The decoder is written for a STREAM: a socket hands over arbitrary chunks, so
// a frame can arrive in pieces and several frames can arrive in one read. The
// caller keeps one accumulator, passes it in whole, and keeps the returned rest.

/** The five opcodes Discord's local RPC uses. */
const OPCODES = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
};

const HEADER_BYTES = 8;

/**
 * The largest inbound payload the decoder will wait for. Discord's control
 * frames are a few hundred bytes; the cap exists because the length word is
 * attacker-shaped input in the worst case (a corrupt or hostile stream on a
 * local socket), and an unbounded one would have the shell buffering an
 * arbitrary allocation while it waits for bytes that never come.
 */
const MAX_FRAME_BYTES = 64 * 1024;

const EMPTY = Buffer.alloc(0);

/** Encode one frame. The payload is always JSON, even when it is empty. */
function encodeFrame(opcode, payload) {
  const json = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
  const frame = Buffer.alloc(HEADER_BYTES + json.length);
  frame.writeUInt32LE(opcode, 0);
  // The BYTE length, not the string length: a payload with any non-ASCII
  // character (a zone name, a player note) would otherwise be truncated by the
  // reader at a byte count smaller than what was written.
  frame.writeUInt32LE(json.length, 4);
  json.copy(frame, HEADER_BYTES);
  return frame;
}

/** The opening frame every connection sends; Discord answers it with READY. */
function encodeHandshake(clientId) {
  return encodeFrame(OPCODES.HANDSHAKE, { v: 1, client_id: clientId });
}

/**
 * A presence update, or a CLEAR when the activity is null or absent. The clear
 * is not an empty activity object: Discord reads the ABSENCE of the activity
 * key as "this process shows nothing", and an empty object is a malformed
 * activity instead.
 */
function encodeSetActivity(nonce, pid, activity) {
  const args = activity === null || activity === undefined ? { pid } : { pid, activity };
  return encodeFrame(OPCODES.FRAME, { cmd: 'SET_ACTIVITY', args, nonce });
}

/** The answer to a PING, which echoes the ping's own payload back. */
function encodePong(payload) {
  return encodeFrame(OPCODES.PONG, payload);
}

/**
 * Parse one payload. A frame whose body is not JSON yields a null payload
 * rather than a throw: the decoder's job is to keep the stream moving, and the
 * caller (which only ever reads known fields) treats an unreadable frame as one
 * it has nothing to do about.
 */
function parsePayload(text) {
  try {
    const value = JSON.parse(text);
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/**
 * Drain every complete frame from an accumulated buffer.
 *
 * Returns the frames in arrival order, the unconsumed tail (a partial header or
 * a header whose payload has not fully arrived), and an error when the stream
 * itself is no longer trustworthy. Both error kinds mean the same thing to the
 * caller, which is that resynchronizing is impossible: the header is fixed
 * width with no framing marker, so once a length or an opcode is wrong there is
 * no later byte that can be identified as the start of a frame. The caller
 * destroys the socket. Frames drained BEFORE the bad header are still returned,
 * because they were complete and valid when they arrived.
 */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_BYTES) {
    const opcode = buffer.readUInt32LE(offset);
    const length = buffer.readUInt32LE(offset + 4);
    if (length > MAX_FRAME_BYTES) {
      return { frames, rest: buffer.subarray(offset), error: 'oversize' };
    }
    if (opcode > OPCODES.PONG) {
      return { frames, rest: buffer.subarray(offset), error: 'bad-opcode' };
    }
    if (buffer.length - offset - HEADER_BYTES < length) break;
    const start = offset + HEADER_BYTES;
    frames.push({ opcode, payload: parsePayload(buffer.toString('utf8', start, start + length)) });
    offset = start + length;
  }
  return { frames, rest: offset === 0 ? buffer : buffer.subarray(offset), error: null };
}

module.exports = {
  EMPTY_FRAME_BUFFER: EMPTY,
  HEADER_BYTES,
  MAX_FRAME_BYTES,
  OPCODES,
  decodeFrames,
  encodeFrame,
  encodeHandshake,
  encodePong,
  encodeSetActivity,
};
