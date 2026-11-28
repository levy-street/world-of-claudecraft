// The raid atlas's small details (task "map details"): the minimap boss card's
// placement beside the round minimap (raidAtlasMinimapCardPlacement, the touch
// tap's card) and the cartouche counter's
// plural on the boss total (tPlural over hudChrome.raidAtlas.subtitle.*).

import { describe, expect, it } from 'vitest';
import { raidAtlasMinimapCardPlacement } from '../src/ui/hud/raid_atlas/raid_atlas_boss_core';
import { tPlural } from '../src/ui/i18n';

describe('the minimap boss card placement', () => {
  const card = { w: 272, h: 180 };
  const viewport = { w: 1366, h: 768 };
  // The minimap disc at the top right of a desktop screen.
  const disc = { left: 1190, top: 40, right: 1352, bottom: 202 };

  it('sits left of a minimap at the right edge, centred on the medallion', () => {
    const at = raidAtlasMinimapCardPlacement({ x: 1250, y: 150 }, disc, card, viewport);
    expect(at.left).toBe(1190 - 10 - 272);
    expect(at.top).toBe(150 - 90);
  });

  it('stays inside the viewport near its top', () => {
    const at = raidAtlasMinimapCardPlacement({ x: 1250, y: 50 }, disc, card, viewport);
    expect(at.top).toBe(10);
  });

  it('takes the right side for a minimap on the left', () => {
    const left = { left: 10, top: 40, right: 172, bottom: 202 };
    const at = raidAtlasMinimapCardPlacement({ x: 90, y: 120 }, left, card, viewport);
    expect(at.left).toBe(182);
  });

  it('drops below the disc on a narrow portrait phone', () => {
    const phone = { w: 390, h: 844 };
    const small = { left: 260, top: 40, right: 380, bottom: 160 };
    const at = raidAtlasMinimapCardPlacement({ x: 320, y: 100 }, small, { w: 340, h: 120 }, phone);
    expect(at.top).toBe(170);
    expect(at.left).toBeGreaterThanOrEqual(10);
    expect(at.left + 340).toBeLessThanOrEqual(380);
  });
});

describe('the cartouche counter', () => {
  it('reads the boss total with the right plural', () => {
    const one = tPlural('hudChrome.raidAtlas.subtitle', 1, {
      floor: 'The Heart',
      defeated: '1',
      total: '1',
    });
    const five = tPlural('hudChrome.raidAtlas.subtitle', 5, {
      floor: 'The Veins',
      defeated: '2',
      total: '5',
    });
    expect(one).toBe('The Heart: 1 of 1 boss defeated');
    expect(five).toBe('The Veins: 2 of 5 bosses defeated');
  });
});
