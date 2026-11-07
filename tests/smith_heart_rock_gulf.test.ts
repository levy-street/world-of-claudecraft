// The Wind Bridge gulf's far walls (the weak-spots pass of 2026-11-04,
// src/render/smith_heart/heart_rock_gulf_core.ts): the mountain's flat
// heightfield across the gulf skinned with the rock kit's great faces, the gulf
// kept open, every face backed by the mountain, none over a walk.
import { describe, expect, it } from 'vitest';
import {
  HEART_GULF_WALL,
  planHeartGulfWalls,
} from '../src/render/smith_heart/heart_rock_gulf_core';
import {
  HEART_ROCK_PIECES,
  HEART_ROCK_RISE,
  HEART_ROCK_STRATA,
  heartRockBackOverFloor,
  heartRockFrontPoints,
  heartRockPieceOf,
} from '../src/render/smith_heart/heart_rock_plan_core';
import { heartRockSolids } from '../src/render/smith_heart/heart_sightline_core';
import { heartOpenAir, heartSummitCap } from '../src/render/smith_heart/heart_walls_core';
import { SMITH_HEART_FIELD, WIND_BRIDGE } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

const walls = planHeartGulfWalls();

/** Distance from (x, z) to the Wind Bridge's line. */
function toBridge(x: number, z: number): number {
  const B = WIND_BRIDGE;
  const dx = B.toX - B.fromX;
  const dz = B.toZ - B.fromZ;
  const L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - B.fromX) * dx + (z - B.fromZ) * dz) / L2));
  return Math.hypot(x - (B.fromX + dx * t), z - (B.fromZ + dz * t));
}

describe('Smith Heart: the Wind Bridge gulf walls', () => {
  it('skins the far wall along the bridge, a face every stride, with storeys', () => {
    expect(walls.length).toBeGreaterThanOrEqual(6);
    const faces = walls.filter((p) => p.piece !== 'Kit_RockMassB');
    expect(faces.length).toBeGreaterThanOrEqual(4);
    for (const p of walls) expect(HEART_ROCK_PIECES[p.piece], p.piece).toBeDefined();
  });

  it('keeps the gulf open: every front point past its open air, facing the bridge', () => {
    for (const p of walls) {
      const m = heartRockPieceOf(p.piece);
      for (const f of heartRockFrontPoints(p, m))
        expect(heartOpenAir(f.x, f.z, 0.5), `${p.piece} (${p.x}, ${p.z})`).toBe(false);
      expect(toBridge(p.x, p.z)).toBeGreaterThanOrEqual(HEART_GULF_WALL.off - 1e-6);
      // Its front (+Z) turned toward the bridge.
      const step = 4;
      const ahead = toBridge(p.x + Math.sin(p.rot) * step, p.z + Math.cos(p.rot) * step);
      expect(ahead).toBeLessThan(toBridge(p.x, p.z));
    }
  });

  it('rises out of the mist under the deck, on the beds, under the summit, over no walk', () => {
    const S = HEART_ROCK_STRATA;
    for (const p of walls) {
      const m = heartRockPieceOf(p.piece);
      const tall = m.height * S.scale;
      const rise = p.rise ?? 1;
      expect(rise).toBeGreaterThanOrEqual(HEART_ROCK_RISE[0]);
      expect(rise).toBeLessThanOrEqual(HEART_ROCK_RISE[1]);
      expect(p.y + tall).toBeLessThanOrEqual(heartSummitCap(p.x, p.z) + 1e-6);
      expect(heartRockBackOverFloor(p, m, p.y, tall), `${p.piece} (${p.x}, ${p.z})`).toBe(false);
      expect(p.cosmetic).toBe(true);
    }
    // A face's foot well under the deck (the bridge climbs from the Ring's mouth
    // to the Breath's landing: under its highest end at least).
    const B = WIND_BRIDGE;
    let deck = Number.NEGATIVE_INFINITY;
    for (let t = 0; t <= 1; t += 0.1)
      deck = Math.max(
        deck,
        authoredFieldHeight(
          SMITH_HEART_FIELD,
          B.fromX + (B.toX - B.fromX) * t,
          B.fromZ + (B.toZ - B.fromZ) * t,
        ),
      );
    for (const p of walls.filter((q) => q.piece !== 'Kit_RockMassB'))
      expect(p.y, `${p.piece} (${p.x}, ${p.z})`).toBeLessThan(deck - 30);
  });

  it('joins the sightline plan', () => {
    const solids = heartRockSolids();
    for (const p of walls)
      expect(
        solids.some((s) => s.what === `rock ${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`),
        p.piece,
      ).toBe(true);
  });
});
