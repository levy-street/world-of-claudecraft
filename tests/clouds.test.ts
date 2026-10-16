// The map-authored cloud deck (render/clouds.ts): a puff is a DISTANT thing.
// Authored low (coverage 0.16 at 7 yards) the deck reads as rolling
// harbour fog, which is the point - but a 100-yard billboard drifting through
// the camera is a flat white wall across the deck. SPACEY: "make the fog clouds
// only render when they are far from the player so it doesn't look weird with
// the close up fog, and make the fog clouds 50% more transparent."

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PUFF_FAR,
  PUFF_HAZE_IN,
  PUFF_HAZE_OUT,
  PUFF_NEAR,
  puffFade,
  puffOpacity,
} from '../src/render/clouds';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

describe('cloud deck', () => {
  it('shows a puff at half the opacity it used to', () => {
    // the first cut was 0.34 + 0.2 * coverage
    for (const c of [0, 0.16, 0.5, 1]) {
      expect(puffOpacity(c)).toBeCloseTo((0.34 + 0.2 * c) / 2, 6);
    }
    expect(puffOpacity(-1)).toBe(puffOpacity(0));
    expect(puffOpacity(4)).toBe(puffOpacity(1));
  });

  it('draws only in the mid distance: gone near, and gone again far off', () => {
    expect(PUFF_NEAR).toBeLessThan(PUFF_FAR);
    expect(PUFF_FAR).toBeLessThan(PUFF_HAZE_IN);
    expect(PUFF_HAZE_IN).toBeLessThan(PUFF_HAZE_OUT);
    expect(puffFade(0)).toBe(0);
    expect(puffFade(PUFF_NEAR)).toBe(0);
    expect(puffFade(PUFF_FAR)).toBe(1);
    // ...and back out again, so the far field is scene fog alone and the
    // horizon bleeds cleanly instead of carrying pasted-on blobs.
    expect(puffFade(PUFF_HAZE_IN)).toBe(1);
    expect(puffFade(PUFF_HAZE_OUT)).toBe(0);
    expect(puffFade(1000)).toBe(0);
    // never steps, in either direction
    let last = 0;
    for (let d = PUFF_NEAR; d <= PUFF_FAR; d += 4) {
      const f = puffFade(d);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    last = 1;
    for (let d = PUFF_HAZE_IN; d <= PUFF_HAZE_OUT; d += 4) {
      const f = puffFade(d);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
    expect(puffFade((PUFF_NEAR + PUFF_FAR) / 2)).toBeCloseTo(0.5, 6);
    expect(puffFade((PUFF_HAZE_IN + PUFF_HAZE_OUT) / 2)).toBeCloseTo(0.5, 6);
  });
  it('applies the fade to every live puff, every frame, from the camera', () => {
    const src = codeWithoutLineComments(
      readFileSync(new URL('../src/render/clouds.ts', import.meta.url), 'utf8'),
    );
    const update = src.slice(
      src.indexOf('  update(cam: THREE.Vector3'),
      src.indexOf('  dispose()'),
    );
    expect(update).toContain('puffFade(sp.position.distanceTo(cam))');
    expect(update).toContain('this.baseOpacity *');
    // coverage sets the ceiling the fade scales, not the opacity itself
    expect(src).toContain('this.baseOpacity = puffOpacity(cover)');
  });
});
