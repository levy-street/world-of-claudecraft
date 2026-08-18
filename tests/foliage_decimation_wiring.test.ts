import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the lean-foliage triangle-count
// trim (src/render/foliage_decimation_core.ts). The pure core is Node-tested
// directly (tests/foliage_decimation_core.test.ts), but foliage.ts is not
// Node-testable end to end (Three-heavy scene building), so nothing else
// would catch a regression that re-inlines the old hash-vs-keep-rate filter:
// every core test stays green while a solid rock silently goes back to being
// culled on GFX.leanFoliage tiers (the invisible-collision bug this trim once
// caused). Mirrors the pattern in tests/shadow_render_wiring.test.ts and
// tests/professions_graphics_fairness.test.ts.
const foliageSource = readFileSync(
  path.join(__dirname, '..', 'src', 'render', 'foliage.ts'),
  'utf8',
);

describe('foliage lean-decimation renderer wiring', () => {
  it('routes the leanFoliage decoration filter through survivesLeanDecimation', () => {
    expect(foliageSource).toContain(
      'decos.filter((d) => survivesLeanDecimation(d, hashAt(d.x, d.z, 83), GFX.standardMaterials))',
    );
  });

  it('imports survivesLeanDecimation from the registered pure core', () => {
    expect(foliageSource).toMatch(
      /import\s*\{\s*survivesLeanDecimation\s*\}\s*from\s*'\.\/foliage_decimation_core';/,
    );
  });

  it('never re-inlines the decimation hash draw (salt 83) as a bare comparison', () => {
    // The pre-fix shape this guards against: `hashAt(d.x, d.z, 83) < keep`
    // sitting directly in foliage.ts instead of behind survivesLeanDecimation,
    // which is exactly what let a collider-bearing rock get dropped with no
    // awareness of decorationHasCollider. Anchored to the decimation salt (83)
    // specifically: other hashAt/salt pairs in this file legitimately compare
    // against a literal for unrelated draws (e.g. the marsh twisted/dead split).
    expect(foliageSource).not.toMatch(/hashAt\([^)]*,\s*83\s*\)\s*<\s*\w/);
  });
});
