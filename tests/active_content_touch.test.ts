// In-place mutations of the active content (the editor sculpting into the
// shared terrainEdits array) must move the content generation, because the
// zone-build workers mesh from a structured clone that is refreshed only on a
// generation change: without the bump a camera-LOD re-mesh after a sculpt
// stroke rebuilt the chunk from the stale clone and the old terrain came back.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORLD,
  getContentGeneration,
  setActiveWorldContent,
  touchActiveWorldContent,
} from '../src/sim/data';
import type { HeightStamp } from '../src/sim/types';

describe('touchActiveWorldContent', () => {
  it('moves the content generation without swapping the active content', () => {
    const edits: HeightStamp[] = [];
    const world = { ...BUILTIN_WORLD, terrainEdits: edits };
    setActiveWorldContent(world);
    try {
      const g0 = getContentGeneration();
      edits.push({ x: 0, z: 0, radius: 5, delta: 3, falloff: 'smooth' });
      expect(getContentGeneration()).toBe(g0); // an in-place push alone moves nothing
      touchActiveWorldContent();
      expect(getContentGeneration()).toBe(g0 + 1);
    } finally {
      setActiveWorldContent(null);
    }
  });
});
