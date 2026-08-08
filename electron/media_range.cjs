// Byte-range support for the app:// protocol handler (electron/main.cjs).
//
// Chromium's media stack loads <audio>/<video> resources with a Range request
// (the first one is always "Range: bytes=0-") and requires a well-formed
// 206 Partial Content answer (Content-Range plus the exact body slice). The
// handler used to ignore the header and re-wrap net.fetch's plain 200, which
// the media demuxer rejects outright (MEDIA_ELEMENT_ERROR: Format error, so
// element.play() rejects with NotSupportedError). The result: every streamed
// music cue (the looping media elements in src/game/music.ts, plus the boss,
// Sowfield, landing-theme, and voice elements) was silent in the desktop
// shell while fetch+decodeAudioData SFX kept working. Honoring the range also
// makes seeking work, which el.loop and the currentTime resets depend on.
//
// No Electron imports: plain Node, so tests/electron_media_range.test.ts can
// exercise the parser, the header shapes, and the real Response end to end.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

// Content types for the ranged path: the media containers the client ships or
// could ship. Ranged serving is deliberately limited to these; any other file
// type (including the extension-less SPA fallback to index.html) returns null
// so the handler's full-response path keeps its net.fetch-derived MIME type.
const RANGE_CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

function rangeContentType(filePath) {
  return RANGE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

// Parse a single-range Range header value against a known resource size.
// Returns inclusive byte offsets, or null when the header is absent,
// malformed, multi-range, or unsatisfiable. A null caller falls back to the
// full 200 response, which RFC 9110 permits (a server MAY ignore Range).
function parseByteRange(rangeValue, size) {
  if (typeof rangeValue !== 'string' || !Number.isInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeValue.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return null;
  if (startRaw === '') {
    // suffix form (bytes=-N): the final N bytes
    const suffix = Number(endRaw);
    if (suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  if (start >= size) return null;
  const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (end < start) return null;
  return { start, end };
}

function rangeResponseHeaders(range, size, contentType) {
  return {
    'Content-Type': contentType,
    'Content-Length': String(range.end - range.start + 1),
    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    'Accept-Ranges': 'bytes',
  };
}

// A syntactically valid single range that no byte of the resource satisfies:
// an absolute start at or past EOF (EOF included, so a file truncated to zero
// bytes still counts), a zero-length suffix (bytes=-0), or any well-formed
// range against an empty file. Distinct from a malformed header (which the
// handler may ignore per RFC 9110): these earn a 416 with the real bounds,
// because falling back to a plain 200 would recreate the exact demuxer format
// error this module exists to fix, silently, e.g. against a truncated or
// replaced asset.
function isUnsatisfiableRange(rangeValue, size) {
  if (typeof rangeValue !== 'string' || !Number.isInteger(size) || size < 0) return false;
  const value = rangeValue.trim();
  const suffix = /^bytes=-(\d+)$/.exec(value);
  if (suffix) return Number(suffix[1]) === 0 || size === 0;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  // An open end is unbounded: Infinity keeps end >= start true for any start,
  // so a start past even Number.MAX_SAFE_INTEGER still resolves to the 416.
  const end = match[2] === '' ? Infinity : Number(match[2]);
  return start >= size && end >= start;
}

// Build the 206 Partial Content response for a ranged media request, streaming
// only the requested slice; an unsatisfiable range gets the RFC 9110 416
// answer instead. Returns null when the file is not a rangeable media type, is
// unreadable, or the range header does not parse, so the caller keeps its
// existing full-response path. extraHeaders lets the app:// handler keep its
// every-response CSP invariant.
async function rangedFileResponse(filePath, rangeValue, extraHeaders = {}) {
  const contentType = rangeContentType(filePath);
  if (!contentType) return null;
  let size;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return null;
    size = stat.size;
  } catch {
    return null;
  }
  if (isUnsatisfiableRange(rangeValue, size)) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, ...extraHeaders },
    });
  }
  const range = parseByteRange(rangeValue, size);
  if (!range) return null;
  const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
  const headers = {
    ...rangeResponseHeaders(range, size, contentType),
    ...extraHeaders,
  };
  return new Response(Readable.toWeb(stream), { status: 206, headers });
}

module.exports = {
  isUnsatisfiableRange,
  parseByteRange,
  rangeContentType,
  rangeResponseHeaders,
  rangedFileResponse,
};
