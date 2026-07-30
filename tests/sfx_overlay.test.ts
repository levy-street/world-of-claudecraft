import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSfxOverlayFile } from '../server/sfx_overlay';

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'woc-sfx-overlay-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('production SFX static overlay', () => {
  it('serves only the stable manifest and content-addressed audio blobs', () => {
    const root = temporaryRoot();
    const hash = 'a'.repeat(64);
    mkdirSync(join(root, 'blobs'));
    writeFileSync(join(root, 'runtime-pack.json'), '{}');
    writeFileSync(join(root, 'blobs', `${hash}.mp3`), 'audio');
    writeFileSync(join(root, 'foot_grass.mp3'), 'not overlaid');

    expect(resolveSfxOverlayFile(root, '/audio/sfx/runtime-pack.json')).toBe(
      realpathSync(join(root, 'runtime-pack.json')),
    );
    expect(resolveSfxOverlayFile(root, `/audio/sfx/blobs/${hash}.mp3`)).toBe(
      realpathSync(join(root, 'blobs', `${hash}.mp3`)),
    );
    expect(resolveSfxOverlayFile(root, '/audio/sfx/foot_grass.mp3')).toBeNull();
    expect(resolveSfxOverlayFile(root, '/audio/sfx/blobs/not-a-hash.mp3')).toBeNull();
    expect(resolveSfxOverlayFile(root, '/audio/sfx/../package.json')).toBeNull();
  });

  it('rejects symlinks that escape the configured overlay', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const hash = 'b'.repeat(64);
    mkdirSync(join(root, 'blobs'));
    writeFileSync(join(outside, `${hash}.mp3`), 'outside');
    symlinkSync(join(outside, `${hash}.mp3`), join(root, 'blobs', `${hash}.mp3`));

    expect(resolveSfxOverlayFile(root, `/audio/sfx/blobs/${hash}.mp3`)).toBeNull();
  });
});
