import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('SFX gate toolchain preflight', () => {
  it('fails fast with a clear message when ffmpeg and ffprobe are unavailable', () => {
    const result = spawnSync(process.execPath, ['scripts/gate.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required SFX audio tooling on PATH: ffmpeg, ffprobe');
    expect(result.stderr).toContain('install FFmpeg (including ffprobe)');
    expect(result.stdout).not.toContain('[gate] i18n artifacts');
  });
});
