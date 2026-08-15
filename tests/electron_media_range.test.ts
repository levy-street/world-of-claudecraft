import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isUnsatisfiableRange,
  parseByteRange,
  rangeContentType,
  rangedFileResponse,
  rangeResponseHeaders,
} from '../electron/media_range.cjs';

// Byte-range support for the app:// protocol handler. Chromium's media stack
// requests <audio>/<video> sources with "Range: bytes=0-" and rejects a plain
// 200 re-wrap as MEDIA_ELEMENT_ERROR: Format error, which left every streamed
// music cue silent in the desktop shell while fetch+decodeAudioData SFX kept
// working. These tests pin the parser, the header wire shapes, the real 206
// Response, and the main.cjs handler wiring.

describe('parseByteRange', () => {
  it('parses the open-ended form Chromium media always sends first', () => {
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('parses explicit ranges and clamps the end to the file size', () => {
    expect(parseByteRange('bytes=200-399', 1000)).toEqual({ start: 200, end: 399 });
    expect(parseByteRange('bytes=200-99999', 1000)).toEqual({ start: 200, end: 999 });
    expect(parseByteRange('bytes=0-0', 1000)).toEqual({ start: 0, end: 0 });
  });

  it('parses the suffix form as the final N bytes, clamped to the whole file', () => {
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseByteRange('  bytes=0-  ', 10)).toEqual({ start: 0, end: 9 });
  });

  it('rejects absent, malformed, foreign-unit, and multi-range values', () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange('', 1000)).toBeNull();
    expect(parseByteRange('bytes=', 1000)).toBeNull();
    expect(parseByteRange('bytes=-0', 1000)).toBeNull();
    expect(parseByteRange('bytes=abc-', 1000)).toBeNull();
    expect(parseByteRange('items=0-1', 1000)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toBeNull();
  });

  it('rejects unsatisfiable ranges and empty or invalid sizes', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBeNull();
    expect(parseByteRange('bytes=9-2', 1000)).toBeNull();
    expect(parseByteRange('bytes=0-', 0)).toBeNull();
    expect(parseByteRange('bytes=0-', -5)).toBeNull();
    expect(parseByteRange('bytes=0-', Number.NaN)).toBeNull();
    expect(parseByteRange('bytes=0-', 10.5)).toBeNull();
  });
});

describe('rangeContentType', () => {
  it('maps the shipped media containers to their literal MIME types', () => {
    expect(rangeContentType('audio/music/vale.mp3')).toBe('audio/mpeg');
    expect(rangeContentType('AUDIO/LOUD.MP3')).toBe('audio/mpeg');
    expect(rangeContentType('a.m4a')).toBe('audio/mp4');
    expect(rangeContentType('a.mp4')).toBe('video/mp4');
    expect(rangeContentType('a.ogg')).toBe('audio/ogg');
    expect(rangeContentType('a.opus')).toBe('audio/ogg');
    expect(rangeContentType('a.wav')).toBe('audio/wav');
    expect(rangeContentType('a.webm')).toBe('video/webm');
  });

  it('returns null for non-media types so they keep the full-response MIME', () => {
    expect(rangeContentType('models/foliage/pine_2.glb')).toBeNull();
    expect(rangeContentType('index.html')).toBeNull();
    expect(rangeContentType('no_extension')).toBeNull();
  });
});

describe('isUnsatisfiableRange', () => {
  it('detects a well-formed range starting at or past EOF', () => {
    expect(isUnsatisfiableRange('bytes=1000-', 1000)).toBe(true);
    expect(isUnsatisfiableRange('bytes=1500-2000', 1000)).toBe(true);
    // an open end is unbounded, so a start past 2^53 still resolves to a 416
    expect(isUnsatisfiableRange('bytes=99999999999999999999999-', 1000)).toBe(true);
  });

  it('detects the zero-length suffix and any well-formed range on an empty file', () => {
    expect(isUnsatisfiableRange('bytes=-0', 1000)).toBe(true);
    expect(isUnsatisfiableRange('bytes=0-', 0)).toBe(true);
    expect(isUnsatisfiableRange('bytes=1000-', 0)).toBe(true);
    expect(isUnsatisfiableRange('bytes=-5', 0)).toBe(true);
  });

  it('stays false for satisfiable, malformed, or inverted ranges', () => {
    expect(isUnsatisfiableRange('bytes=999-', 1000)).toBe(false);
    expect(isUnsatisfiableRange('bytes=', 1000)).toBe(false);
    expect(isUnsatisfiableRange('bytes=2000-1500', 1000)).toBe(false);
    expect(isUnsatisfiableRange('bytes=-100', 1000)).toBe(false);
    expect(isUnsatisfiableRange(null, 1000)).toBe(false);
  });
});

describe('rangeResponseHeaders', () => {
  it('builds the exact 206 wire headers', () => {
    expect(rangeResponseHeaders({ start: 2, end: 5 }, 10, 'audio/mpeg')).toEqual({
      'Content-Type': 'audio/mpeg',
      'Content-Length': '4',
      'Content-Range': 'bytes 2-5/10',
      'Accept-Ranges': 'bytes',
    });
  });
});

describe('rangedFileResponse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wocc-media-range-'));
  const filePath = join(dir, 'ten.mp3');
  writeFileSync(filePath, '0123456789');
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a 206 with the exact body slice and range headers', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=2-5');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(206);
    expect(await res?.text()).toBe('2345');
    expect(res?.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(res?.headers.get('Content-Length')).toBe('4');
    expect(res?.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res?.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('serves the whole file for the open-ended first media request', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=0-');
    expect(res?.status).toBe(206);
    expect(await res?.text()).toBe('0123456789');
    expect(res?.headers.get('Content-Range')).toBe('bytes 0-9/10');
  });

  it('clamps a past-EOF end and keeps body, length, and range in agreement', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=5-99999');
    expect(res?.status).toBe(206);
    expect(await res?.text()).toBe('56789');
    expect(res?.headers.get('Content-Length')).toBe('5');
    expect(res?.headers.get('Content-Range')).toBe('bytes 5-9/10');
  });

  it('serves the suffix form as a 206 of the final N bytes', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=-3');
    expect(res?.status).toBe(206);
    expect(await res?.text()).toBe('789');
    expect(res?.headers.get('Content-Range')).toBe('bytes 7-9/10');
  });

  it('carries extra headers so the handler keeps its every-response CSP rule', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=0-', {
      'Content-Security-Policy': "default-src 'self'",
    });
    expect(res?.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('returns null on a malformed range so the caller serves the full 200', async () => {
    expect(await rangedFileResponse(filePath, 'bytes=')).toBeNull();
    expect(await rangedFileResponse(filePath, 'bytes=9-2')).toBeNull();
  });

  it('answers a past-EOF range with 416 and the real bounds, never a bare 200', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=10-', {
      'Content-Security-Policy': "default-src 'self'",
    });
    expect(res?.status).toBe(416);
    expect(res?.headers.get('Content-Range')).toBe('bytes */10');
    expect(res?.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    // the 416 is bounds-only: no body, no stale media headers
    expect(await res?.text()).toBe('');
    expect(res?.headers.get('Content-Type')).toBeNull();
    expect(res?.headers.get('Accept-Ranges')).toBeNull();
  });

  it('answers a start past 2^53 with 416, never the full-200 fallback', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=99999999999999999999999-');
    expect(res?.status).toBe(416);
    expect(res?.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('answers a zero-byte media file with 416 instead of an empty 200', async () => {
    const emptyPath = join(dir, 'empty.mp3');
    writeFileSync(emptyPath, '');
    const res = await rangedFileResponse(emptyPath, 'bytes=0-');
    expect(res?.status).toBe(416);
    expect(res?.headers.get('Content-Range')).toBe('bytes */0');
  });

  it('answers the zero-length suffix with 416 and the real bounds', async () => {
    const res = await rangedFileResponse(filePath, 'bytes=-0');
    expect(res?.status).toBe(416);
    expect(res?.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('returns null for a non-media extension so the full path keeps its MIME type', async () => {
    const htmlPath = join(dir, 'index.html');
    writeFileSync(htmlPath, '<!doctype html>');
    expect(await rangedFileResponse(htmlPath, 'bytes=0-')).toBeNull();
  });

  it('returns null for a missing file or a directory', async () => {
    expect(await rangedFileResponse(join(dir, 'absent.mp3'), 'bytes=0-')).toBeNull();
    const sub = join(dir, 'sub.mp3');
    mkdirSync(sub);
    expect(await rangedFileResponse(sub, 'bytes=0-')).toBeNull();
  });
});

describe('app:// handler wiring (electron/main.cjs)', () => {
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const handlerStart = main.indexOf("protocol.handle('app'");
  // the first close at the registration's own indent ends THE handler body
  const handlerEnd = main.indexOf('\n  });', handlerStart);
  const handler = main.slice(handlerStart, handlerEnd);

  it('imports the range helpers as live code, not a comment', () => {
    expect(main).toMatch(
      /^const \{ rangeContentType, rangedFileResponse \} = require\('\.\/media_range\.cjs'\);$/m,
    );
  });

  it('slices exactly one registered app handler', () => {
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(main.split("protocol.handle('app'").length - 1).toBe(1);
  });

  it('answers ranged requests after the path guards and before the full-response fallback', () => {
    const guardCheck = handler.indexOf('fileInside(distDir, filePath)');
    const rangeRead = handler.indexOf("request.headers.get('range')");
    const rangedCall = handler.indexOf('rangedFileResponse(');
    const fullFallback = handler.indexOf('net.fetch(pathToFileURL(filePath)');
    expect(guardCheck).toBeGreaterThan(-1);
    expect(rangeRead).toBeGreaterThan(guardCheck);
    expect(rangedCall).toBeGreaterThan(rangeRead);
    expect(fullFallback).toBeGreaterThan(rangedCall);
  });

  // Indentation-anchored shape pins: a commented-out line shifts its indent and
  // kills the match, so a revert, a dropped return, a dropped CSP argument, or
  // swapped arguments all fail here even though the unit suite stays green.
  it('keeps the range branch live: awaited, CSP-carrying, and returned', () => {
    expect(handler).toMatch(
      /\n {4}const rangeValue = request\.headers\.get\('range'\);\n {4}if \(rangeValue\) \{\n {6}const ranged = await rangedFileResponse\(filePath, rangeValue, \{\n {8}'Content-Security-Policy': csp,\n {6}\}\);\n {6}if \(ranged\) return ranged;\n {4}\}\n/,
    );
  });

  it('advertises Accept-Ranges for media on the full-response fallback', () => {
    expect(handler).toMatch(
      /\n {4}const full = withCspHeader\(response, csp\);\n {4}if \(rangeContentType\(filePath\)\) full\.headers\.set\('Accept-Ranges', 'bytes'\);\n {4}return full;/,
    );
  });
});
