// Guard for the logger call-site convention (server/http/logger.ts header): never
// log raw req.url, req.headers, a whole req/ctx.req, or a raw request body. The
// string-level redaction rules only cover Bearer + 64-hex shapes, so a raw URL or
// header blob carrying a non-hex secret (a PKCE code_verifier, a base32 TOTP
// secret, an OAuth state) would reach the log unredacted. This scans every logger
// call site under server/ and fails when one passes those raw request surfaces,
// so the convention holds as new log sites land, not just for the initial logging sweep.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = join(__dirname, '../../../server');

/** Every .ts file under server/, recursively. */
function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// A structured-logger call whose argument span we inspect. Covers the shared
// singleton and the injected/child instances the modules conventionally name
// `log` (e.g. access_log.ts).
const LOGGER_CALL_RE = /\b(?:logger|log)\.(?:info|warn|error|child)\s*\(/g;

// Raw request surfaces that must never be passed to a log line wholesale.
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\breq\.url\b/, why: 'raw req.url (query strings carry codes/tokens/state)' },
  { re: /\breq\.headers\b/, why: 'raw req.headers (authorization/cookie blobs)' },
  { re: /\bctx\.req\b/, why: 'the whole ctx.req (url + headers wholesale)' },
  { re: /\brequest\.headers\b/, why: 'raw request.headers' },
  { re: /\bctx\.body\b/, why: 'a raw request body (may carry any secret shape)' },
];

/**
 * The argument span of a call starting at `openParen` (the index of '('),
 * matched by paren depth and capped so a pathological file cannot stall the scan.
 */
function argumentSpan(text: string, openParen: number): string {
  const CAP = 600;
  let depth = 0;
  for (let i = openParen; i < text.length && i - openParen < CAP; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openParen, i + 1);
    }
  }
  return text.slice(openParen, openParen + CAP);
}

describe('logger call hygiene: no raw request surface reaches a log line', () => {
  it('every logger/log call under server/ passes hand-picked fields, never req.url/req.headers/req/body wholesale', () => {
    const violations: string[] = [];
    for (const file of serverFiles(SERVER_ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(LOGGER_CALL_RE)) {
        const start = (match.index ?? 0) + match[0].length - 1;
        const span = argumentSpan(text, start);
        for (const { re, why } of FORBIDDEN) {
          if (re.test(span)) {
            const line = text.slice(0, match.index ?? 0).split('\n').length;
            violations.push(`${relative(SERVER_ROOT, file)}:${line} logs ${why}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
