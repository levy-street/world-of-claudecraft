import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAKED_LASTKEEP_MAP } from '../src/ui/lastkeep_map_manifest.generated';
import {
  LASTKEEP_STORY_IDS,
  lastKeepPlanFingerprint,
  lastKeepPlanSvg,
  lastKeepPlateSize,
} from '../src/ui/lastkeep_map_view';

// Freshness guard for the baked Last Keep floor-plan plates
// (scripts/build_lastkeep_map.mjs). The plates are pure functions of the
// authored LASTKEEP layout plus the plan palette (lastKeepPlanSvg), so ANY
// layout or palette change must re-bake them: this test recomputes the
// manifest's fingerprint from the live layout and reds until
// `npm run assets:lastkeepmap` is rerun.
describe('baked Last Keep floor-plan plates', () => {
  it('covers every story and every plate file exists', () => {
    expect([...BAKED_LASTKEEP_MAP.stories]).toEqual([...LASTKEEP_STORY_IDS]);
    for (const storyId of LASTKEEP_STORY_IDS) {
      expect(
        fs.existsSync(path.join(__dirname, '..', 'public', 'map_bg', `lastkeep_${storyId}.webp`)),
        `public/map_bg/lastkeep_${storyId}.webp`,
      ).toBe(true);
    }
  });

  it('matches the current layout (re-bake with npm run assets:lastkeepmap)', () => {
    const { w, h } = lastKeepPlateSize();
    expect(BAKED_LASTKEEP_MAP.plateWidth, 'plate width').toBe(w);
    expect(BAKED_LASTKEEP_MAP.plateHeight, 'plate height').toBe(h);
    expect(
      lastKeepPlanFingerprint(),
      'plan fingerprint (layout or palette changed? re-bake the plates)',
    ).toBe(BAKED_LASTKEEP_MAP.fingerprint);
  });

  it('the plan SVG is deterministic and self-contained', () => {
    for (const storyId of LASTKEEP_STORY_IDS) {
      const svg = lastKeepPlanSvg(storyId);
      expect(svg).toBe(lastKeepPlanSvg(storyId));
      // Self-contained vector source: no external references of any kind (the
      // runtime fallback rasterizes this exact string via a data: URL).
      expect(svg).not.toMatch(/href|url\(|<image|<text/);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    }
  });
});
