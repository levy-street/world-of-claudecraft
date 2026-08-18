import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD_SEED as REPORT_WORLD_SEED } from '../scripts/lib/cinematic_trajectory_report_core.mjs';
import { WORLD_SEED } from '../src/world_seed.mjs';

interface SeedSurfacePin {
  readonly name: string;
  readonly path: string;
  readonly importSource: string;
  readonly referenceCount: number;
}

const SURFACE_PINS: readonly SeedSurfacePin[] = [
  {
    name: 'shipping client',
    path: '../src/main.ts',
    importSource: "import { WORLD_SEED } from './sim/world_seed';",
    referenceCount: 2,
  },
  {
    name: 'shot linter',
    path: './cinematic_shots.test.ts',
    importSource: "import { WORLD_SEED } from '../src/world_seed.mjs';",
    // 9 = the six original sites plus the three hullWorldCollision calls the
    // ferry program's generated-plan hull arms added (F1.3, F2.3).
    referenceCount: 9,
  },
  {
    name: 'trajectory report',
    path: '../scripts/lib/cinematic_trajectory_report_core.mjs',
    importSource: "import { WORLD_SEED } from '../../src/world_seed.mjs';",
    referenceCount: 5,
  },
  {
    name: 'cinematic contact sheet',
    path: '../scripts/cinematic_contact_sheet.mjs',
    importSource: "import { WORLD_SEED } from '../src/world_seed.mjs';",
    referenceCount: 2,
  },
  {
    name: 'editor cinematic capture',
    path: '../src/editor/cinematic_capture_core.ts',
    importSource: "import { WORLD_SEED } from '../world_seed.mjs';",
    referenceCount: 4,
  },
];

const NUMERIC_SEED_PATTERNS = [
  /\b(?:const|let|var)\s+\w*seed\w*\s*=\s*\d[\d_]*/iu,
  /\bseed\s*:[^,\n]*\b\d[\d_]*\b/iu,
  /\b(?:groundHeight|terrainHeight|sampleTerrainHeight)\([^,\n]*,[^,\n]*,[^)\n]*\b\d[\d_]*\b/iu,
  /\b(?:20_?061|4_?242)\b/u,
] as const;

describe('shared world seed', () => {
  it('pins the shipping value across the ESM boundary', () => {
    expect(WORLD_SEED).toBe(20061);
    expect(REPORT_WORLD_SEED).toBe(WORLD_SEED);
  });

  it.each(SURFACE_PINS)('$name imports and uses only the shared constant', (pin) => {
    const source = readFileSync(new URL(pin.path, import.meta.url), 'utf8');
    expect(source).toContain(pin.importSource);
    expect(source.match(/\bWORLD_SEED\b/gu)).toHaveLength(pin.referenceCount);
    for (const pattern of NUMERIC_SEED_PATTERNS) expect(source).not.toMatch(pattern);
  });
});
