// The System Report's desktop-shell glue (src/game/desktop_host_diag.ts): the
// feature check that keeps an older installed shell out of the panel, the call
// that can never reject, and the pure payload builder.
//
// The bridge is a plain global (`globalThis.wocDesktop`), so this drives the real
// desktopBridge() detection rather than mocking src/runtime: the login-trio
// requirement is part of what is being asserted.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assembleHostDiagGameInfo,
  hostDiagAvailable,
  runDesktopHostDiag,
} from '../src/game/desktop_host_diag';
import type { DesktopHostDiagGameInfo, DesktopHostDiagResult } from '../src/runtime';

const LOGIN_TRIO = {
  openBrowserLogin: () => Promise.resolve(),
  takeLoginCode: () => Promise.resolve(null),
  onLoginCode: () => () => {},
};

type BridgeHost = { wocDesktop?: unknown };

function installBridge(extra: Record<string, unknown>): void {
  (globalThis as BridgeHost).wocDesktop = { ...LOGIN_TRIO, ...extra };
}

afterEach(() => {
  delete (globalThis as BridgeHost).wocDesktop;
});

describe('hostDiagAvailable', () => {
  it('is false with no bridge at all', () => {
    expect(hostDiagAvailable()).toBe(false);
  });

  it('is FALSE on a bridge that has no runHostDiag (an older installed shell)', () => {
    // The whole reason the row is feature-checked rather than DESKTOP_APP-gated:
    // runHostDiag shipped after the login trio, so a shell predating it exposes
    // the bridge without the method and would hand the player a dead button.
    installBridge({});
    expect(hostDiagAvailable()).toBe(false);
    // A non-function value is not a method either.
    installBridge({ runHostDiag: true });
    expect(hostDiagAvailable()).toBe(false);
  });

  it('is true once the shell exposes the method', () => {
    installBridge({ runHostDiag: () => Promise.resolve({ status: 'saved', nativeStatus: 'ok' }) });
    expect(hostDiagAvailable()).toBe(true);
  });
});

describe('runDesktopHostDiag', () => {
  const FAILURE: DesktopHostDiagResult = { status: 'error', nativeStatus: null };

  it('passes the payload through and returns the shell verdict verbatim', async () => {
    const saved: DesktopHostDiagResult = {
      status: 'saved',
      nativeStatus: 'partial',
      fileName: 'report.json',
    };
    const seen: DesktopHostDiagGameInfo[] = [];
    const runHostDiag = vi.fn((game: DesktopHostDiagGameInfo) => {
      seen.push(game);
      return Promise.resolve(saved);
    });
    installBridge({ runHostDiag });
    const payload: DesktopHostDiagGameInfo = { sessionId: 'abc' };
    await expect(runDesktopHostDiag(payload)).resolves.toEqual(saved);
    expect(runHostDiag).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual(payload);
  });

  it('resolves to the error verdict with no bridge and with no method', async () => {
    await expect(runDesktopHostDiag({})).resolves.toEqual(FAILURE);
    installBridge({});
    await expect(runDesktopHostDiag({})).resolves.toEqual(FAILURE);
  });

  it('never rejects: a thrown bridge and a rejected promise both map to the error verdict', async () => {
    installBridge({ runHostDiag: () => Promise.reject(new Error('ipc gone')) });
    await expect(runDesktopHostDiag({})).resolves.toEqual(FAILURE);
    installBridge({
      runHostDiag: () => {
        throw new Error('synchronous throw');
      },
    });
    await expect(runDesktopHostDiag({})).resolves.toEqual(FAILURE);
    // And a shell answering nothing at all.
    installBridge({ runHostDiag: () => Promise.resolve(null) });
    await expect(runDesktopHostDiag({})).resolves.toEqual(FAILURE);
  });
});

describe('assembleHostDiagGameInfo', () => {
  it('passes the perf-report sessionId through, which is the join key', () => {
    // The one field with a job beyond description: it is what lets a support
    // engineer line this saved file up with the automatic performance reports the
    // same session already sent (src/game/perf_reporter.ts).
    const info = assembleHostDiagGameInfo({ sessionId: 'f0e1d2c3' });
    expect(info.sessionId).toBe('f0e1d2c3');
    expect(Object.keys(info), 'and nothing it was not given').toEqual(['sessionId']);
  });

  it('carries every field it is given, in the shell payload shape', () => {
    expect(
      assembleHostDiagGameInfo({
        sessionId: 's',
        releaseVersion: '0.43',
        buildId: 'abc123',
        graphicsPreset: 'ultra',
        gfxTier: 'high',
        glRenderer: 'NVIDIA GeForce RTX 4070',
        glVendor: 'NVIDIA Corporation',
        renderScale: 0.85,
        targetFps: 60,
        zone: 'proving_shore',
        locale: 'fr_FR',
      }),
    ).toEqual({
      sessionId: 's',
      releaseVersion: '0.43',
      buildId: 'abc123',
      graphicsPreset: 'ultra',
      gfxTier: 'high',
      glRenderer: 'NVIDIA GeForce RTX 4070',
      glVendor: 'NVIDIA Corporation',
      renderScale: 0.85,
      targetFps: 60,
      zone: 'proving_shore',
      locale: 'fr_FR',
    });
  });

  it('drops absent, null, blank and non-finite readings rather than sending them', () => {
    // A present key must mean "this was known": the file is read by a human, so a
    // blank string or a NaN would be worse than a missing key.
    expect(assembleHostDiagGameInfo({})).toEqual({});
    expect(
      assembleHostDiagGameInfo({
        sessionId: null,
        releaseVersion: undefined,
        buildId: '',
        graphicsPreset: null,
        gfxTier: null,
        glRenderer: '',
        glVendor: null,
        renderScale: Number.NaN,
        targetFps: Number.POSITIVE_INFINITY,
        zone: null,
        locale: '',
      }),
    ).toEqual({});
    // Per-field, so one bad reading never takes a good one with it.
    expect(assembleHostDiagGameInfo({ sessionId: '', locale: 'ja_JP' })).toEqual({
      locale: 'ja_JP',
    });
    expect(assembleHostDiagGameInfo({ renderScale: Number.NaN, targetFps: 30 })).toEqual({
      targetFps: 30,
    });
  });

  it('accepts gfxTier as either a name or a number, and zero as a real reading', () => {
    expect(assembleHostDiagGameInfo({ gfxTier: 'low' }).gfxTier).toBe('low');
    expect(assembleHostDiagGameInfo({ gfxTier: 2 }).gfxTier).toBe(2);
    expect(assembleHostDiagGameInfo({ gfxTier: '' }).gfxTier).toBeUndefined();
    // 0 is falsy but finite: a zero target fps or render scale is a reading, not
    // an absence, so the drop rule must be typeof/finite, never truthiness.
    expect(assembleHostDiagGameInfo({ gfxTier: 0, targetFps: 0, renderScale: 0 })).toEqual({
      gfxTier: 0,
      targetFps: 0,
      renderScale: 0,
    });
  });

  it('builds a fresh object per call and ignores keys the shell does not accept', () => {
    const sources = { sessionId: 's' };
    expect(assembleHostDiagGameInfo(sources)).not.toBe(assembleHostDiagGameInfo(sources));
    const info = assembleHostDiagGameInfo({
      sessionId: 's',
      accountEmail: 'nope@example.com',
    } as never);
    expect(Object.keys(info)).toEqual(['sessionId']);
  });
});
