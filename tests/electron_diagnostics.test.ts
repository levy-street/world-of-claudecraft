import { describe, expect, it } from 'vitest';
import {
  clampText,
  classifyRendererExit,
  escapeNotificationMarkup,
  MAX_ERROR_TEXT,
  normalizeConsoleMessage,
  redactSecrets,
  rendererCrashAction,
  rendererErrorLogEntry,
  shouldLogConsoleLevel,
} from '../electron/diagnostics.cjs';

describe('clampText', () => {
  it('flattens control characters and truncates over-long text', () => {
    expect(clampText('a\nb\tc\rd', 100)).toBe('a b c d');
    const long = 'x'.repeat(50);
    expect(clampText(long, 10)).toBe(`${'x'.repeat(10)}...`);
  });

  it('returns empty string for non-strings', () => {
    expect(clampText(42, 10)).toBe('');
    expect(clampText(null, 10)).toBe('');
    expect(clampText(undefined, 10)).toBe('');
  });

  it('strips C1 control characters, not just C0 (the documented contract)', () => {
    // U+009B is the one-byte control-sequence introducer; U+0085 is NEL. Both
    // are C1 controls that must not reach a native dialog or a log line.
    const csi = String.fromCharCode(0x9b);
    const nel = String.fromCharCode(0x85);
    expect(clampText(`a${csi}b${nel}c`, 100)).toBe('a b c');
  });

  it('flattens the U+2028/U+2029 line separators (the Unicode newline forgery vector)', () => {
    // LS and PS pass a C0-only filter yet render as real line breaks on
    // surfaces honoring Unicode line breaking, letting a crafted string push
    // a template tail off screen and present a forged second line.
    const ls = String.fromCodePoint(0x2028);
    const ps = String.fromCodePoint(0x2029);
    expect(clampText(`one${ls}two${ps}three`, 100)).toBe('one two three');
  });

  it('strips the invisible margin classes: ALM, word joiner, tag characters and friends', () => {
    // U+061C is the Arabic analog of the stripped RLM; U+2060 WORD JOINER is
    // the modern U+FEFF; U+E0001/U+E007F tag characters are fully invisible
    // and can smuggle hidden content; soft hyphen U+00AD, the Mongolian
    // vowel separator U+180E, and interlinear annotation U+FFF9-U+FFFB all
    // hide or restructure what the surface displays.
    const cp = String.fromCodePoint;
    expect(clampText(`a${cp(0x061c)}b${cp(0x2060)}c`, 100)).toBe('a b c');
    expect(clampText(`a${cp(0xad)}b${cp(0x180e)}c${cp(0xfff9)}d${cp(0xfffb)}e`, 100)).toBe(
      'a b c d e',
    );
    expect(clampText(`tag${cp(0xe0001)}${cp(0xe007f)}ged`, 100)).toBe('tag ged');
  });

  it('never splits a surrogate pair at the cap boundary', () => {
    // A cap landing mid-astral-character would leave a lone high surrogate
    // that native UTF-8 conversion renders as U+FFFD; the clamp drops it. A
    // boundary landing between whole characters keeps the full cap.
    const emoji = String.fromCodePoint(0x1f600);
    expect(clampText(`${'x'.repeat(9)}${emoji}y`, 10)).toBe(`${'x'.repeat(9)}...`);
    expect(clampText(`${'x'.repeat(8)}${emoji}y`, 10)).toBe(`${'x'.repeat(8)}${emoji}...`);
  });

  it('drops a trailing lone high surrogate on the unclamped path too', () => {
    // The preload pre-cap can split an astral pair, and the flattener can
    // collapse a run so the cut string lands UNDER this cap with the lone
    // surrogate tail intact (security-review probe); both exits strip it.
    const loneHigh = String.fromCharCode(0xd83d);
    expect(clampText(`short${loneHigh}`, 100)).toBe('short');
    // A complete pair at the end of a short string survives untouched.
    const emoji = String.fromCodePoint(0x1f600);
    expect(clampText(`short${emoji}`, 100)).toBe(`short${emoji}`);
  });

  it('strips invisible direction and width formatters bound for OS surfaces', () => {
    // U+202E (right-to-left override) can visually reorder a notification or
    // dialog line into reading as something else; U+200B and U+FEFF hide seams
    // between words. Format characters flatten to one space like the controls.
    expect(clampText('a\u202eb\u2066c', 100)).toBe('a b c');
    expect(clampText('pay\u200bload\ufeff!', 100)).toBe('pay load !');
  });
});

describe('escapeNotificationMarkup', () => {
  it('entity-escapes the three markup-significant characters, ampersand first', () => {
    // Ampersand first, or the escapes of < and > would themselves be
    // double-escaped on the way through.
    expect(escapeNotificationMarkup('<b>bold</b> & <a href="x">y</a>')).toBe(
      '&lt;b&gt;bold&lt;/b&gt; &amp; &lt;a href="x"&gt;y&lt;/a&gt;',
    );
    expect(escapeNotificationMarkup('no markup here')).toBe('no markup here');
  });

  it('neutralizes pre-encoded and numeric entity smuggling', () => {
    // A daemon that decodes entities must see only literal text: an attacker
    // shipping already-encoded markup has its ampersands re-escaped, so
    // neither form survives to be re-interpreted.
    expect(escapeNotificationMarkup('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
    expect(escapeNotificationMarkup('&#60;b&#62;')).toBe('&amp;#60;b&amp;#62;');
  });
});

describe('redactSecrets', () => {
  it('redacts bearer tokens and key/value credentials', () => {
    expect(redactSecrets('failed with Bearer abcdef123456 attached')).toBe(
      'failed with Bearer [redacted] attached',
    );
    expect(redactSecrets('body was {"password":"hunter22"}')).not.toContain('hunter22');
    expect(redactSecrets('token=deadbeefcafe more text')).not.toContain('deadbeefcafe');
  });

  it('leaves ordinary text alone', () => {
    const text = 'WebGL context lost at frame 1234';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('rendererErrorLogEntry (untrusted IPC payload validation)', () => {
  it('normalizes a well-formed error payload', () => {
    const entry = rendererErrorLogEntry({
      kind: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at fn (app://x/main.js:1:2)',
      source: 'app://x/main.js',
      line: 1,
      col: 2,
    });
    expect(entry).toMatchObject({ kind: 'error', message: 'boom', line: 1, col: 2 });
    expect(entry?.stack).toContain('Error: boom');
  });

  it('accepts unhandledrejection and rejects unknown kinds and junk', () => {
    expect(rendererErrorLogEntry({ kind: 'unhandledrejection' })?.kind).toBe('unhandledrejection');
    expect(rendererErrorLogEntry({ kind: 'exploit' })).toBeNull();
    expect(rendererErrorLogEntry(null)).toBeNull();
    expect(rendererErrorLogEntry('text')).toBeNull();
    expect(rendererErrorLogEntry({})).toBeNull();
  });

  it('clamps hostile payload lengths and drops non-finite positions', () => {
    const entry = rendererErrorLogEntry({
      kind: 'error',
      message: 'm'.repeat(MAX_ERROR_TEXT * 2),
      line: Number.POSITIVE_INFINITY,
      col: 'NaN',
    });
    expect(entry?.message.length).toBeLessThanOrEqual(MAX_ERROR_TEXT + 3);
    expect(entry?.line).toBeUndefined();
    expect(entry?.col).toBeUndefined();
  });

  it('redacts a credential smuggled in the source URL query string', () => {
    const entry = rendererErrorLogEntry({
      kind: 'error',
      message: 'boom',
      source: 'https://example.com/page?token=deadbeefcafe',
    });
    expect(entry?.source).not.toContain('deadbeefcafe');
    expect(entry?.source).toContain('[redacted]');
  });
});

describe('normalizeConsoleMessage (Electron 43 details form + legacy positional form)', () => {
  it('reads the modern details object', () => {
    const entry = normalizeConsoleMessage({
      level: 'warning',
      message: 'deprecated API',
      lineNumber: 12,
      sourceId: 'app://worldofclaudecraft/assets/main.js',
    });
    expect(entry).toEqual({
      level: 'warning',
      message: 'deprecated API',
      source: 'app://worldofclaudecraft/assets/main.js:12',
    });
  });

  it('reads the legacy positional form', () => {
    const entry = normalizeConsoleMessage({}, 3, 'kaboom', 7, 'file.js');
    expect(entry).toEqual({ level: 'error', message: 'kaboom', source: 'file.js:7' });
  });

  it('returns null when neither form is recognizable', () => {
    expect(normalizeConsoleMessage({}, undefined, undefined)).toBeNull();
    expect(normalizeConsoleMessage(undefined)).toBeNull();
  });

  it('redacts a credential smuggled in the sourceId, both forms', () => {
    const modern = normalizeConsoleMessage({
      level: 'error',
      message: 'fetch failed',
      sourceId: 'https://example.com/api?token=deadbeefcafe',
    });
    expect(modern?.source).not.toContain('deadbeefcafe');
    const legacy = normalizeConsoleMessage({}, 3, 'fetch failed', 7, 'page?secret=deadbeefcafe');
    expect(legacy?.source).not.toContain('deadbeefcafe');
  });
});

describe('shouldLogConsoleLevel', () => {
  it('keeps only warnings and errors', () => {
    expect(shouldLogConsoleLevel('warning')).toBe(true);
    expect(shouldLogConsoleLevel('error')).toBe(true);
    expect(shouldLogConsoleLevel('info')).toBe(false);
    expect(shouldLogConsoleLevel('debug')).toBe(false);
  });
});

describe('classifyRendererExit', () => {
  it('treats clean-exit and killed as benign', () => {
    expect(classifyRendererExit('clean-exit')).toBe('benign');
    expect(classifyRendererExit('killed')).toBe('benign');
  });

  it('treats every crash-shaped and unknown reason as a crash', () => {
    for (const reason of [
      'crashed',
      'oom',
      'abnormal-exit',
      'launch-failed',
      'integrity-failure',
      'memory-eviction',
      'some-future-reason',
      undefined,
    ]) {
      expect(classifyRendererExit(reason)).toBe('crash');
    }
  });
});

describe('rendererCrashAction (bounded auto-reload)', () => {
  it('reloads for the first crashes inside the window, then asks the player', () => {
    let state: number[] = [];
    const first = rendererCrashAction(state, 1_000);
    expect(first.action).toBe('reload');
    state = first.times;
    const second = rendererCrashAction(state, 2_000);
    expect(second.action).toBe('reload');
    state = second.times;
    const third = rendererCrashAction(state, 3_000);
    expect(third.action).toBe('dialog');
  });

  it('forgets crashes older than the window', () => {
    const { times } = rendererCrashAction([1_000, 2_000], 3_000);
    expect(rendererCrashAction(times, 3_000 + 61_000).action).toBe('reload');
  });
});
