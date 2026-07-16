import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FFMPEG_PATH, FFPROBE_PATH, resolveSfxTool } from '../scripts/sfx/ffmpeg_paths.mjs';

describe('sfx ffmpeg/ffprobe resolution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'woc-ffmpeg-paths-'));
  const present = join(dir, 'present-binary');
  writeFileSync(present, '');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prefers an explicit override, even over an existing static binary', () => {
    expect(
      resolveSfxTool({ overridePath: '/operator/ffmpeg', staticPath: present, fallback: 'ffmpeg' }),
    ).toBe('/operator/ffmpeg');
  });

  it('uses the static package binary when it exists', () => {
    expect(resolveSfxTool({ staticPath: present, fallback: 'ffmpeg' })).toBe(present);
  });

  it('falls back to the bare PATH name when the static binary is absent', () => {
    expect(resolveSfxTool({ staticPath: join(dir, 'missing'), fallback: 'ffmpeg' })).toBe('ffmpeg');
    expect(resolveSfxTool({ staticPath: null, fallback: 'ffprobe' })).toBe('ffprobe');
    expect(resolveSfxTool({ overridePath: '', staticPath: null, fallback: 'ffmpeg' })).toBe(
      'ffmpeg',
    );
  });

  it('resolves working binaries on a correctly installed checkout', () => {
    // Execution probe, not an existence check: this is exactly what the gate
    // preflight and every SFX Studio spawn rely on.
    for (const toolPath of [FFMPEG_PATH, FFPROBE_PATH]) {
      const probe = spawnSync(toolPath, ['-version'], { stdio: 'ignore' });
      expect(probe.error).toBeUndefined();
      expect(probe.status).toBe(0);
    }
  });
});
