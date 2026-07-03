import { describe, expect, it } from 'vitest';
import { rendererErrorReportFromEvent } from '../src/game/desktop_error_relay';

describe('rendererErrorReportFromEvent', () => {
  it('maps an ErrorEvent shape with a full stack', () => {
    const report = rendererErrorReportFromEvent('error', {
      message: 'boom',
      error: { stack: 'Error: boom\n  at fn (app://x/main.js:1:2)' },
      filename: 'app://x/main.js',
      lineno: 1,
      colno: 2,
    });
    expect(report).toEqual({
      kind: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at fn (app://x/main.js:1:2)',
      source: 'app://x/main.js',
      line: 1,
      col: 2,
    });
  });

  it('maps a rejection with an Error reason, a string reason, and no reason', () => {
    const withError = rendererErrorReportFromEvent('unhandledrejection', {
      reason: { message: 'rej', stack: 'Error: rej' },
    });
    expect(withError).toMatchObject({
      kind: 'unhandledrejection',
      message: 'rej',
      stack: 'Error: rej',
    });
    const withString = rendererErrorReportFromEvent('unhandledrejection', { reason: 'plain text' });
    expect(withString).toMatchObject({ kind: 'unhandledrejection', message: 'plain text' });
    expect(withString.stack).toBeUndefined();
    const bare = rendererErrorReportFromEvent('unhandledrejection', {});
    expect(bare.kind).toBe('unhandledrejection');
    expect(bare.message).toBeUndefined();
  });

  it('never throws on hostile or empty event shapes', () => {
    expect(rendererErrorReportFromEvent('error', null)).toMatchObject({ kind: 'error' });
    expect(rendererErrorReportFromEvent('error', { lineno: 'NaN', error: 42 })).toMatchObject({
      kind: 'error',
      line: undefined,
    });
    expect(rendererErrorReportFromEvent('unhandledrejection', null).kind).toBe(
      'unhandledrejection',
    );
  });
});
