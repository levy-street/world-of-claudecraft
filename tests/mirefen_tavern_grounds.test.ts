import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { tavernToWorld } from '../src/sim/content/mirefen_tavern';
import {
  TAVERN_DOG,
  TAVERN_FORECOURT,
  TAVERN_GROUNDS_PROPS,
  TAVERN_STABLE,
} from '../src/sim/content/mirefen_tavern_grounds';
import { MIREFEN_TAVERN_SEATS } from '../src/sim/content/mirefen_tavern_seats';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';
import { mirefenTavernColliders } from '../src/sim/mirefen_tavern';
import {
  mirefenTavernGroundsCovers,
  tavernStablePosts,
  tavernStableWalls,
} from '../src/sim/mirefen_tavern_grounds';
import { groundHeight, roadDistance, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The Mirefen tavern's grounds (src/sim/content/mirefen_tavern_grounds.ts,
// src/sim/mirefen_tavern_grounds.ts): the cobbled forecourt, the terrace, the stable, the cart,
// the trough, the woodpile and the dog on the porch. Pins that none of it reaches the road, that
// the forecourt is drawn over the terrain and never walked as a surface of its own, that the
// stable and every solid piece block a body, that the stable's open front and its roof clear a
// walking player, that the terrace's benches seat two each facing their table, and that the
// scatter keeps off the grounds.

const S = WORLD_SEED;
const PLAYER_H = 2.6;
const w = (lx: number, lz: number) => tavernToWorld(lx, lz);

describe('Mirefen tavern grounds: the site', () => {
  it('keeps the forecourt off the road and every piece on the grounds well clear of it', () => {
    for (const [x0, x1, z0, z1] of TAVERN_FORECOURT) {
      for (let x = x0; x <= x1; x += 0.5) {
        for (let z = z0; z <= z1; z += 0.5) {
          const p = w(x, z);
          expect(roadDistance(p.x, p.z), `forecourt (${x}, ${z})`).toBeGreaterThan(3);
        }
      }
    }
    for (const q of TAVERN_GROUNDS_PROPS) {
      const p = w(q.x, q.z);
      expect(roadDistance(p.x, p.z), `${q.kind} (${q.x}, ${q.z})`).toBeGreaterThan(5);
    }
  });

  it('draws the forecourt over the terrain: the ground the feet walk there is the terrain', () => {
    for (const [x0, x1, z0, z1] of TAVERN_FORECOURT) {
      for (const [x, z] of [
        [x0 + 0.5, z1 - 0.5],
        [x1 - 0.5, z1 - 0.5],
        [(x0 + x1) / 2, z1 - 0.3],
      ]) {
        const p = w(x, z);
        if (Math.abs(x) < 4.2) continue; // the porch steps' own run
        expect(groundHeight(p.x, p.z, S)).toBe(terrainHeight(p.x, p.z, S));
      }
    }
  });

  it('keeps the scatter and the grass off the forecourt, the stable and the pieces outside', () => {
    const s = TAVERN_STABLE;
    for (const [x, z] of [
      [-10, 18],
      [9, 17],
      [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2],
      [-27.9, 9.2],
    ]) {
      const p = w(x, z);
      expect(mirefenTavernGroundsCovers(p.x, p.z), `(${x}, ${z})`).toBe(true);
      expect(isExcludedDecoration(p.x, p.z), `(${x}, ${z})`).toBe(true);
    }
    const off = w(-40, 30);
    expect(mirefenTavernGroundsCovers(off.x, off.z)).toBe(false);
  });
});

describe('Mirefen tavern grounds: what stands on them', () => {
  it('seats every piece on the terrain under it', () => {
    for (const q of TAVERN_GROUNDS_PROPS) {
      if (q.kind === 'dog') continue; // on the porch's floor
      const p = w(q.x, q.z);
      expect(q.baseY, q.kind).toBeDefined();
      expect(Math.abs((q.baseY ?? 0) - (terrainHeight(p.x, p.z, S) - 0.5)), q.kind).toBeLessThan(
        0.02,
      );
    }
  });

  it('blocks a body at the stable walls, the posts and every solid piece, and joins the tavern', () => {
    const all = mirefenTavernColliders(S);
    for (const [x0, x1, z0, z1] of tavernStableWalls()) {
      const p = w((x0 + x1) / 2, (z0 + z1) / 2);
      expect(isBlocked(S, p.x, p.z, 0.3), `wall (${x0}, ${z0})`).toBe(true);
      expect(all.some((c) => Math.abs(c.x - p.x) < 1e-6 && Math.abs(c.z - p.z) < 1e-6)).toBe(true);
    }
    for (const post of tavernStablePosts()) {
      const p = w(post.x, post.z);
      expect(isBlocked(S, p.x, p.z, 0.3)).toBe(true);
    }
    for (const q of TAVERN_GROUNDS_PROPS) {
      const p = w(q.x, q.z);
      expect(isBlocked(S, p.x, p.z, 0.3), q.kind).toBe(true);
    }
  });

  it('leaves the stable open at its front and roofs it over a walking player', () => {
    const s = TAVERN_STABLE;
    // the left stall's floor, clear of the hay, and the gap between the posts at the front
    const inside = w((s.x1 + s.partitionX) / 2, s.z0 + 2.4);
    expect(isBlocked(S, inside.x, inside.z, 0.5)).toBe(false);
    const door = w((s.x1 + s.partitionX) / 2, s.z1 - 0.2);
    expect(isBlocked(S, door.x, door.z, 0.5)).toBe(false);
    expect(s.eave).toBeGreaterThan(PLAYER_H + 0.6);
    expect(s.ridge).toBeGreaterThan(s.eave);
  });

  it('lays the dog on the porch, out of the doorway lane', () => {
    expect(Math.abs(TAVERN_DOG.x)).toBeGreaterThan(2.3 + 0.6);
    expect(TAVERN_DOG.z).toBeGreaterThan(14);
    expect(TAVERN_DOG.z).toBeLessThan(16.4);
  });
});

describe('Mirefen tavern grounds: the terrace', () => {
  const terrace = MIREFEN_TAVERN_SEATS.filter((s) => s.id.startsWith('tavern_terrace_'));
  const tables = TAVERN_GROUNDS_PROPS.filter((q) => q.kind === 'terraceTable');
  const benches = TAVERN_GROUNDS_PROPS.filter((q) => q.kind === 'terraceBench');

  it('seats two on every bench, facing its trestle table', () => {
    expect(benches.length).toBe(2 * tables.length);
    expect(terrace.length).toBe(2 * benches.length);
    for (const s of terrace) {
      const table = tables
        .map((t) => ({ t, p: w(t.x, t.z) }))
        .reduce((a, b) =>
          Math.hypot(a.p.x - s.x, a.p.z - s.z) < Math.hypot(b.p.x - s.x, b.p.z - s.z) ? a : b,
        );
      // facing (the sim's atan2(dx, dz)) points at the table's line across the bench
      const fx = Math.sin(s.facing);
      const fz = Math.cos(s.facing);
      const dx = table.p.x - s.x;
      const dz = table.p.z - s.z;
      expect(fx * dx + fz * dz, s.id).toBeGreaterThan(0);
      expect(s.pose).toBe('upright');
      expect(s.seatY - s.floorY).toBeCloseTo(0.9, 5);
    }
  });
});
