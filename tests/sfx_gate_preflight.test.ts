import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SFX gate toolchain preflight', () => {
  it('fails fast with a clear message when the resolved ffmpeg and ffprobe are broken', () => {
    // WOC_FFMPEG_PATH/WOC_FFPROBE_PATH force the resolution (scripts/sfx/
    // ffmpeg_paths.mjs) onto nonexistent binaries and the empty PATH removes the
    // fallback, simulating a scripts-skipped install on a machine without system
    // FFmpeg; the execution probe must fail before any gate step runs.
    const result = spawnSync(process.execPath, ['scripts/gate.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '',
        WOC_FFMPEG_PATH: '/nonexistent/woc-preflight/ffmpeg',
        WOC_FFPROBE_PATH: '/nonexistent/woc-preflight/ffprobe',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required SFX audio tooling: ffmpeg, ffprobe');
    expect(result.stderr).toContain('reinstall with npm ci');
    expect(result.stderr).toContain('install FFmpeg (including ffprobe) on PATH');
    expect(result.stdout).not.toContain('[gate] i18n artifacts');
  });

  it('names only the broken tool when the other one resolves and runs', () => {
    // Per-dimension red path: only ffmpeg is forced onto a nonexistent override
    // while ffprobe resolves normally (the static package binary, PATH-independent),
    // so the failure message's per-tool selection is exercised, not just the
    // both-tools arm above.
    const result = spawnSync(process.execPath, ['scripts/gate.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '',
        WOC_FFMPEG_PATH: '/nonexistent/woc-preflight/ffmpeg',
        WOC_FFPROBE_PATH: undefined,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required SFX audio tooling: ffmpeg');
    expect(result.stderr).not.toMatch(/missing required SFX audio tooling: [^\n]*ffprobe/);
    expect(result.stdout).not.toContain('[gate] i18n artifacts');
  });

  it('probes by execution, not existence: a present but broken binary still fails', () => {
    // A file that exists but cannot run (no exec bit) must fail the preflight;
    // this pins the spawn probe so it can never silently degrade to existsSync.
    const dir = mkdtempSync(join(tmpdir(), 'woc-preflight-'));
    const brokenTool = join(dir, 'broken-ffmpeg');
    writeFileSync(brokenTool, 'not a binary\n', { mode: 0o644 });
    try {
      const result = spawnSync(process.execPath, ['scripts/gate.mjs'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: '',
          WOC_FFMPEG_PATH: brokenTool,
          WOC_FFPROBE_PATH: brokenTool,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing required SFX audio tooling: ffmpeg, ffprobe');
      expect(result.stdout).not.toContain('[gate] i18n artifacts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
