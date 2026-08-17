import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAKED_DAWNHOLD_MAP } from '../src/ui/dawnhold_map_manifest.generated';
import {
  DAWNHOLD_STORY_IDS,
  dawnholdPlanFingerprint,
  dawnholdPlanSvg,
  dawnholdPlateSize,
} from '../src/ui/lastkeep_map_view';

// Freshness guard for the baked Dawnhold Castle floor-plan plates
// (scripts/build_dawnhold_map.mjs). The plates are pure functions of the
// authored DAWNHOLD layout plus the plan palette (dawnholdPlanSvg), so ANY
// layout or palette change must re-bake them: this test recomputes the
// manifest's fingerprint from the live layout and reds until
// `npm run assets:dawnholdmap` is rerun.
describe('baked Dawnhold Castle floor-plan plates', () => {
  it('covers every story and every plate file exists', () => {
    expect([...BAKED_DAWNHOLD_MAP.stories]).toEqual([...DAWNHOLD_STORY_IDS]);
    for (const storyId of DAWNHOLD_STORY_IDS) {
      expect(
        fs.existsSync(path.join(__dirname, '..', 'public', 'map_bg', `dawnhold_${storyId}.webp`)),
        `public/map_bg/dawnhold_${storyId}.webp`,
      ).toBe(true);
    }
  });

  it('matches the current layout (re-bake with npm run assets:dawnholdmap)', () => {
    const { w, h } = dawnholdPlateSize();
    expect(BAKED_DAWNHOLD_MAP.plateWidth, 'plate width').toBe(w);
    expect(BAKED_DAWNHOLD_MAP.plateHeight, 'plate height').toBe(h);
    expect(
      dawnholdPlanFingerprint(),
      'plan fingerprint (layout or palette changed? re-bake the plates)',
    ).toBe(BAKED_DAWNHOLD_MAP.fingerprint);
  });

  it('the plan SVG is deterministic and self-contained', () => {
    for (const storyId of DAWNHOLD_STORY_IDS) {
      const svg = dawnholdPlanSvg(storyId);
      expect(svg).toBe(dawnholdPlanSvg(storyId));
      // Self-contained vector source: no external references of any kind (the
      // runtime fallback rasterizes this exact string via a data: URL).
      expect(svg).not.toMatch(/href|url\(|<image|<text/);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    }
  });
});
