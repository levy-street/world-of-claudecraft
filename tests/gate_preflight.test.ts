import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// checkAudioTooling reads FFMPEG_PATH/FFPROBE_PATH from scripts/sfx/ffmpeg_paths.mjs
// at MODULE EVALUATION time (resolved once from process.env.WOC_FFMPEG_PATH /
// WOC_FFPROBE_PATH), so every scenario below stubs those env vars and calls
// vi.resetModules() BEFORE a fresh dynamic import, the same pattern
// tests/client_challenge.test.ts uses for other module-scoped constants.

async function withFixtureDir(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'woc-audio-preflight-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('checkAudioTooling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reports missing tools when either probe fails', async () => {
    await withFixtureDir(async (dir) => {
      vi.stubEnv('WOC_FFMPEG_PATH', '/nonexistent/woc-preflight/ffmpeg');
      vi.stubEnv('WOC_FFPROBE_PATH', '/nonexistent/woc-preflight/ffprobe');
      vi.resetModules();
      const { checkAudioTooling } = await import('../scripts/lib/gate_preflight.mjs');

      const result = await checkAudioTooling({ label: 'gate', shell: false, env: { PATH: dir } });

      expect(result).toContain('missing required SFX audio tooling: ffmpeg, ffprobe');
    });
  });

  it('reports null when both tools run', async () => {
    await withFixtureDir(async (dir) => {
      const okTool = join(dir, 'ok-tool');
      writeFileSync(okTool, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      vi.stubEnv('WOC_FFMPEG_PATH', okTool);
      vi.stubEnv('WOC_FFPROBE_PATH', okTool);
      vi.resetModules();
      const { checkAudioTooling } = await import('../scripts/lib/gate_preflight.mjs');

      const result = await checkAudioTooling({ label: 'gate', shell: false, env: { PATH: dir } });

      expect(result).toBeNull();
    });
  });

  it('runs both probes even when the first tool call errors, rather than short-circuiting', async () => {
    await withFixtureDir(async (dir) => {
      // ffmpeg missing, ffprobe present: both must still be reported/checked
      // independently (Promise.all over both promises, not a bail on the first).
      const okTool = join(dir, 'ok-tool');
      writeFileSync(okTool, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      vi.stubEnv('WOC_FFMPEG_PATH', '/nonexistent/woc-preflight/ffmpeg');
      vi.stubEnv('WOC_FFPROBE_PATH', okTool);
      vi.resetModules();
      const { checkAudioTooling } = await import('../scripts/lib/gate_preflight.mjs');

      const result = await checkAudioTooling({ label: 'gate', shell: false, env: { PATH: dir } });

      // Only ffmpeg failed, so it alone is named in the missing-tools list
      // (the reinstall guidance text mentions ffprobe regardless, so assert
      // on the list line, not the whole message).
      const [missingLine] = (result ?? '').split('\n');
      expect(missingLine).toContain('missing required SFX audio tooling: ffmpeg');
      expect(missingLine).not.toContain('ffprobe');
    });
  });
});

// This suite proves the two probes actually run CONCURRENTLY, not merely that
// both "eventually run": the pre-change serial implementation also passes
// every scenario above (both tools were still exercised, just one after the
// other), which is exactly what a swap-in of the old serial gate_preflight.mjs
// showed. Mocking node:child_process lets us hold both children open and
// assert spawn was called twice BEFORE either child's exit event fires,
// which a serial await-then-await implementation cannot do (its second spawn
// call only happens once the first child has already settled).
describe('checkAudioTooling concurrency', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('issues both spawn calls before either child settles', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({ spawn: vi.fn() }));
    const { spawn } = await import('node:child_process');
    const emitters: EventEmitter[] = [];
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const emitter = new EventEmitter();
      emitters.push(emitter);
      return emitter;
    });
    const { checkAudioTooling } = await import('../scripts/lib/gate_preflight.mjs');

    const resultPromise = checkAudioTooling({ label: 'gate', shell: false });

    // Flush the microtask queue so both spawn() calls (issued synchronously
    // inside the Promise.all map callback) have run, but do this BEFORE
    // firing either child's exit event, so a serial implementation would
    // still be stuck waiting on the first child at this point.
    await Promise.resolve();
    await Promise.resolve();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(emitters).toHaveLength(2);

    // Settle the SECOND child first: a serial implementation awaiting the
    // first child before even spawning the second would have no second
    // emitter to settle yet, so this ordering only makes sense concurrently.
    emitters[1].emit('exit', 0);
    emitters[0].emit('exit', 0);

    const result = await resultPromise;
    expect(result).toBeNull();
  });
});
