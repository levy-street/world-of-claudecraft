// The Breath vein's storm granite (src/render/smith_heart/breath_stone_core.ts):
// the cliffs and the mountain round the Breath's mouth and link painted as
// wind-scoured slate (audit points 3 and 4), never on the Ring's approved walls.
import { expect, it } from 'vitest';
import {
  BREATH_STONE,
  breathCliffPaint,
  breathStoneWeight,
  inBreathStone,
} from '../src/render/smith_heart/breath_stone_core';
import { HEART_ROOM, RING } from '../src/sim/content/smith_heart_layout';

it('holds on the Breath link and fades out before the Ring, the Quench and the Heart', () => {
  expect(breathStoneWeight(0, 130)).toBe(1);
  expect(inBreathStone(-20, 150)).toBe(true);
  // The Ring's own walls keep their approved paint.
  expect(breathStoneWeight(0, RING.outerR + BREATH_STONE.ring0 - 1)).toBe(0);
  expect(breathStoneWeight(0, 40)).toBe(0);
  // The Quench's side and the Heart's room are not the Breath's.
  expect(breathStoneWeight(BREATH_STONE.x1 + 5, 130)).toBe(0);
  expect(breathStoneWeight(HEART_ROOM.x, HEART_ROOM.z)).toBe(0);
});

it('paints a cool slate that never falls to black or a warm brown', () => {
  for (const [x, y, z, top] of [
    [0, 10, 120, 12],
    [-30, -40, 140, 12],
    [20, -90, 110, 20],
    [5, 11.5, 130, 12],
  ] as const) {
    const [r, g, b] = breathCliffPaint(x, y, z, top);
    expect(Math.min(r, g, b), `${x} ${y} ${z}`).toBeGreaterThan(0.18);
    expect(b, 'cool, never brown').toBeGreaterThanOrEqual(r);
  }
  // The lip under the gale is scoured paler than the face deep below it.
  const lip = breathCliffPaint(0, 11.8, 120, 12);
  const deep = breathCliffPaint(0, -50, 120, 12);
  expect(lip[0] + lip[1] + lip[2]).toBeGreaterThan(deep[0] + deep[1] + deep[2]);
});
