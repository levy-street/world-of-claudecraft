import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the lean-tier near-edge slab
// cull (issue #3525: rocks and bushes vanishing on Low as the camera orbits).
// The pure decisions are Node-tested directly (tests/foliage_lod.test.ts,
// tests/foliage_frame_windows_core.test.ts), but foliage.ts is not
// Node-testable end to end (Three-heavy scene building), so nothing else would
// catch a regression that re-registers the lean rock or dressing rows against
// the bucket CENTER, or hands them a collapse window wider than their cap.
// Mirrors tests/foliage_decimation_wiring.test.ts.
const foliageSource = readFileSync(
  path.join(__dirname, '..', 'src', 'render', 'foliage.ts'),
  'utf8',
);

describe('foliage lean near-edge cull renderer wiring', () => {
  it('registers the lean rock row with the near-edge cap', () => {
    expect(foliageSource).toContain(
      "register(rockMesh, 'rock', undefined, lodDists().rockFar, { nearEdge: true });",
    );
    // and never the old bare numeric-cap form
    expect(foliageSource).not.toContain(
      "register(rockMesh, 'rock', undefined, lodDists().rockFar);",
    );
  });

  it('gives the rock material the rock collapse window on BOTH arms', () => {
    expect(foliageSource).toContain("applyInstanceCollapse(rockMat, 'rock');");
    expect(foliageSource).not.toContain("impostorsActive() ? 'rock' : 'plain'");
  });

  it('registers every lean dressing row near-edge, sprite-backed rows untouched', () => {
    expect(foliageSource).toContain(
      'maxNearEdge: !spriteBacked && !impostorsActive() ? true : undefined,',
    );
  });

  it('routes every non-tree kind to the dress window on the near-edge arm, by construction', () => {
    expect(foliageSource).toContain('DRESS_SPRITE_URLS.has(url) || !impostorsActive()');
  });

  it('hands the resolver the built far-field policy, not just the live sprite flag', () => {
    expect(foliageSource).toContain('frameInput.impostorsActive = impostorsActive();');
  });

  it('threads maxNearEdge from the registry into the per-frame cull input', () => {
    expect(foliageSource).toContain('maxNearEdge: atDetail?.nearEdge,');
    expect(foliageSource).toContain('bucketWindow.maxNearEdge = b.maxNearEdge;');
  });

  it('resolves the frame windows through the shared pure core', () => {
    expect(foliageSource).toMatch(
      /import \{[^}]*resolveFoliageFrameWindows[^}]*\} from '\.\/foliage_frame_windows_core';/,
    );
    expect(foliageSource).toContain('resolveFoliageFrameWindows(');
    // the old lean-arm fog-wall binding must not come back inline
    expect(foliageSource).not.toMatch(/collapseWindows\.(rockMax|dressMax)\s*=/);
  });
});
