import { describe, expect, it } from 'vitest';
import {
  clampText,
  classifyRendererExit,
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
