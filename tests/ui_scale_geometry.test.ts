import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live UI Scale geometry refresh', () => {
  it('reapplies chat and all unit-frame geometries through the live Hud seam', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toMatch(
      /reapplySavedGeometry\(\): void {\s*this\.chatGeometry\.reapply\(\);\s*this\.targetFrameMover\?\.reapplyPosition\(\);\s*this\.playerFrameMover\?\.reapplyPosition\(\);\s*this\.partyFrameMover\?\.reapplyPosition\(\);\s*}/,
    );
  });

  it('refreshes saved geometry immediately after publishing the new CSS scale', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(
      /case 'uiScale':\s*document\.documentElement\.style\.setProperty\('--ui-scale', String\(v\)\);\s*hud\.reapplySavedGeometry\(\);/,
    );
  });
});
