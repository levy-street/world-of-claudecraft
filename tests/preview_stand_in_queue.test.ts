// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { previewTouchQueueOf } from '../src/ui/preview_stand_in';

describe('the preview cold-open gate reaches the world GPU queue', () => {
  it('reads it off the renderer public field, and tolerates a host without one', () => {
    // The renderer exposes its one GPU work queue as a public field so a
    // second context paces its touch pieces on the same budget; the stand-in
    // reads it structurally (no Renderer import in src/ui).
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    expect(renderer).toContain('readonly backgroundGpuWork = createBackgroundGpuQueue({');
    const queue = { run: async () => undefined };
    expect(previewTouchQueueOf({ backgroundGpuWork: queue })).toBe(queue);
    expect(previewTouchQueueOf({})).toBeNull();
    expect(previewTouchQueueOf({ backgroundGpuWork: null })).toBeNull();
  });
});
