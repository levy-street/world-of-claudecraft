// The Forgefather's Isle walkability gate: the full route from the
// mainland shore over the bridge to the summit court climbs within
// MAX_STEP_HEIGHT at every yard AND inside the movement kernel's terrain
// steepness gate (PLAYER_MAX_CLIMB_SLOPE over 1-yard cells, the arm the
// first bake missed: stamp rims passed the step check but read as cliffs),
// and a flood of the isle's movement graph (up-steps bounded, steep dry
// cells refused, drops free, water traversable) finds no reachable cell
// that cannot return: no player gets stuck anywhere in the fortress.
// Walk support comes from groundHeight (which folds in the stair-ramp
// lift surfaces the way the kernel sees them) maxed with the REAL fortress
// deck colliders; re-tune the ember_coast.ts ramps, banks, or stamps if a
// fortress or terrain change reds this.
import { describe, expect, it } from 'vitest';
import type { ObbCollider } from '../src/sim/colliders';
import { FORGEFATHER_STAIR_RAMPS, forgefatherStairSurface } from '../src/sim/content/ember_coast';
import {
  FORGEFATHER_FORTRESS_PLACEMENTS,
  forgefatherFortressColliders,
} from '../src/sim/forgefather_fortress';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { groundHeight, terrainDownhill, terrainHeight, terrainSteepness } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const STANDABLES = (forgefatherFortressColliders(WORLD_SEED) as ObbCollider[]).filter(
  (collider) => collider.standable === true,
);

function walkHeight(x: number, z: number): number {
  let h = groundHeight(x, z, WORLD_SEED);
  for (const c of STANDABLES) {
    const dx = x - c.x;
    const dz = z - c.z;
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = dx * cos + dz * sin;
    const lz = -dx * sin + dz * cos;
    if (Math.abs(lx) <= c.hw && Math.abs(lz) <= c.hd) {
      const top = c.moveTopY as number;
      if (top > h && top - h < 40) h = Math.max(h, top);
    }
  }
  return h;
}

describe('forgefather fortress walkability', () => {
  it('the shore-to-summit route climbs within the step and steepness limits at every yard', () => {
    const route: Array<[string, number, number]> = [];
    const seg = (name: string, x0: number, z0: number, x1: number, z1: number) => {
      // Half-yard sampling: a real movement tick advances ~0.35 yd, so a
      // coarser walk straddles two stair treads and reads a double rise.
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
      for (let i = 0; i <= steps; i++)
        route.push([name, x0 + ((x1 - x0) * i) / steps, z0 + ((z1 - z0) * i) / steps]);
    };
    seg('mainland approach', 443.7, 2178, 443.7, 2186);
    seg('bridge west leg', 440, 2189, 448, 2192);
    seg('bridge main span', 448, 2193, 490, 2193);
    seg('deck to quay', 490, 2196, 492, 2202);
    seg('quay', 492, 2202, 493, 2206);
    seg('quay stair east', 493, 2202, 501, 2200.5);
    seg('gate passage', 501, 2200.5, 504, 2200.5);
    seg('forecourt', 504, 2200.5, 506, 2205);
    seg('bailey stair', 507.8, 2202, 507.8, 2212);
    seg('middle court', 507.8, 2212, 506, 2218);
    seg('court stair', 504.1, 2216, 504.1, 2226);
    seg('tier three', 504.1, 2226, 504.05, 2229);
    seg('upper stair', 503.35, 2229, 503.35, 2238);
    seg('upper landing', 503.35, 2238, 504.3, 2241);
    seg('keep stair', 503.05, 2238, 503.05, 2245);
    seg('summit court', 503.05, 2245, 503, 2249);
    const bad: string[] = [];
    let prev: number | null = null;
    for (const [name, x, z] of route) {
      const h = walkHeight(x, z);
      if (prev !== null && h - prev > MAX_STEP_HEIGHT + 0.01)
        bad.push(`${name} (${x.toFixed(1)}, ${z.toFixed(1)}): rise ${(h - prev).toFixed(2)}`);
      // The steepness memo (which never sees the lifts) gates any body the
      // ground carries, ramp surfaces included; only a collider-carried
      // walker is exempt.
      if (h <= groundHeight(x, z, WORLD_SEED) + 0.01) {
        const steep = terrainSteepness(Math.round(x), Math.round(z), WORLD_SEED);
        if (steep > PLAYER_MAX_CLIMB_SLOPE)
          bad.push(`${name} (${x.toFixed(1)}, ${z.toFixed(1)}): steepness ${steep.toFixed(2)}`);
      }
      prev = h;
    }
    expect(bad, bad.slice(0, 12).join('; ')).toEqual([]);
  });

  it('no reachable cell on the isle is a stuck pocket', () => {
    const X0 = 430;
    const X1 = 535;
    const Z0 = 2178;
    const Z1 = 2266;
    const W = X1 - X0 + 1;
    const H = Z1 - Z0 + 1;
    const blockers = forgefatherFortressColliders(WORLD_SEED).filter(
      (collider) => !collider.standable,
    );
    // A blocker walls a cell only when its movement top stands above the
    // cell's walk surface (the pass-over lane): a bridge support capped
    // under the deck never walls the walkers crossing above it.
    const blocked = (x: number, z: number, walk: number): boolean => {
      for (const b of blockers) {
        const dx = x - b.x;
        const dz = z - b.z;
        const covers =
          b.type === 'circle'
            ? Math.hypot(dx, dz) <= b.r + 0.4
            : (() => {
                const cos = Math.cos(-b.rot);
                const sin = Math.sin(-b.rot);
                const lx = dx * cos + dz * sin;
                const lz = -dx * sin + dz * cos;
                return Math.abs(lx) <= b.hw + 0.4 && Math.abs(lz) <= b.hd + 0.4;
              })();
        if (!covers) continue;
        if (b.moveTopY === undefined || b.moveTopY > walk + 0.3) return true;
      }
      return false;
    };
    const hts = new Float64Array(W * H);
    const wet = new Uint8Array(W * H);
    const solid = new Uint8Array(W * H);
    const cliff = new Uint8Array(W * H); // dry terrain too steep to walk onto
    for (let ix = 0; ix < W; ix++)
      for (let iz = 0; iz < H; iz++) {
        const x = X0 + ix;
        const z = Z0 + iz;
        const i = ix + iz * W;
        hts[i] = walkHeight(x, z);
        wet[i] = hts[i] < -4.25 ? 1 : 0;
        solid[i] = blocked(x, z, hts[i]) ? 1 : 0;
        cliff[i] =
          !wet[i] &&
          hts[i] <= groundHeight(x, z, WORLD_SEED) + 0.01 &&
          terrainSteepness(x, z, WORLD_SEED) > PLAYER_MAX_CLIMB_SLOPE
            ? 1
            : 0;
      }
    const onTerrain = new Uint8Array(W * H);
    for (let ix = 0; ix < W; ix++)
      for (let iz = 0; iz < H; iz++) {
        const i = ix + iz * W;
        onTerrain[i] = hts[i] <= groundHeight(X0 + ix, Z0 + iz, WORLD_SEED) + 0.01 ? 1 : 0;
      }
    const canStep = (a: number, b: number): boolean => {
      if (solid[b] || cliff[b]) return false;
      if (wet[b]) return true;
      if (wet[a]) return true;
      // Terrain-to-terrain hops follow the slope gate (a smooth grade is
      // walkable up to PLAYER_MAX_CLIMB_SLOPE per yard); any hop involving
      // a deck or tread platform is a collider step under MAX_STEP_HEIGHT.
      const limit =
        onTerrain[a] && onTerrain[b] ? PLAYER_MAX_CLIMB_SLOPE + 0.01 : MAX_STEP_HEIGHT + 0.01;
      return hts[b] - Math.max(hts[a], -4.25) <= limit;
    };
    const flood = (seed: number, reverse: boolean): Uint8Array => {
      const seen = new Uint8Array(W * H);
      const queue = [seed];
      seen[seed] = 1;
      while (queue.length) {
        const i = queue.pop() as number;
        const ix = i % W;
        const iz = (i / W) | 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jx >= W || jz < 0 || jz >= H) continue;
          const j = jx + jz * W;
          if (seen[j]) continue;
          const ok = reverse ? canStep(j, i) : canStep(i, j);
          if (ok) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      return seen;
    };
    const seedIdx = 443 - X0 + (2181 - Z0) * W; // the mainland shore
    const reach = flood(seedIdx, false);
    const back = flood(seedIdx, true);
    const traps: string[] = [];
    for (let ix = 0; ix < W; ix++)
      for (let iz = 0; iz < H; iz++) {
        const i = ix + iz * W;
        if (reach[i] && !back[i] && !wet[i] && !solid[i])
          traps.push(`(${X0 + ix}, ${Z0 + iz}) h${hts[i].toFixed(1)}`);
      }
    expect(traps, traps.slice(0, 12).join('; ')).toEqual([]);
  });

  it('no walk cell can strip control with no slide to escape by (the freeze-spot rule)', () => {
    // The movement kernel's steepness strip reads the RAW heightfield. A
    // platform-CARRIED body (feet > ground + 0.5) is exempt by the kernel's
    // platform-carry clearance; what must never exist is a walkable cell
    // whose support sits close enough to steep sliding ground to strip
    // input while a collider still pins the body in place (the tier-three
    // trench bug). Mirror the kernel's exact arms here.
    const frozen: string[] = [];
    for (let x = 430; x <= 535; x++)
      for (let z = 2178; z <= 2266; z++) {
        const walk = walkHeight(x, z);
        const ground = groundHeight(x, z, WORLD_SEED);
        if (walk <= ground + 0.01) continue; // ground-supported: slides free
        if (walk > ground + 0.5) continue; // platform-carried: kernel exempts
        if (walk < -4.25) continue;
        // Submerged ground under a deck reads through the waterline-clamped
        // ride arm in the engine, never the raw seabed gradient.
        if (terrainHeight(x, z, WORLD_SEED) < -4.3) continue;
        const steep = terrainSteepness(x, z, WORLD_SEED);
        if (steep <= PLAYER_MAX_CLIMB_SLOPE) continue;
        // The kernel's second arm: the strip fires only where an ACTUAL
        // downhill exists at the exact position.
        if (terrainDownhill(x, z, WORLD_SEED) === null) continue;
        frozen.push(`(${x}, ${z}) walk ${walk.toFixed(1)} steep ${steep.toFixed(2)}`);
      }
    expect(frozen, frozen.slice(0, 12).join('; ')).toEqual([]);
  });

  it('every stair ramp is gentle, flush at both ends, and roofs a calm bank', () => {
    // The castle-ramp lift surfaces are the walking truth for the six
    // staircases: each band's grade stays inside the climb gate, each ramp
    // meets the courts it joins flush (the surface at a segment joint is
    // continuous), and the RAW terrain beneath every band stays below the
    // surface (the bank never pokes up through a flight) and calm enough
    // for the steepness memo the kernel still reads there.
    const stairs = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key === 'staircase');
    expect(stairs.length).toBe(5);
    expect(FORGEFATHER_STAIR_RAMPS.length).toBe(19);
    const bad: string[] = [];
    for (const ramp of FORGEFATHER_STAIR_RAMPS) {
      if (ramp.link) continue; // under-plate connective segments
      const run = Math.abs(ramp.a1 - ramp.a0);
      const grade = Math.abs(ramp.h1 - ramp.h0) / run;
      if (grade > PLAYER_MAX_CLIMB_SLOPE - 0.4)
        bad.push(`band at a0=${ramp.a0}: grade ${grade.toFixed(2)}`);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const along = ramp.a0 + (ramp.a1 - ramp.a0) * t;
        const across = (ramp.b0 + ramp.b1) / 2;
        const x = ramp.axis === 'z' ? across : along;
        const z = ramp.axis === 'z' ? along : across;
        const surface = forgefatherStairSurface(x, z);
        const expected = ramp.h0 + (ramp.h1 - ramp.h0) * t;
        if (surface < expected - 0.01)
          bad.push(`surface hole at (${x.toFixed(1)}, ${z.toFixed(1)})`);
        const raw = terrainHeight(x, z, WORLD_SEED);
        if (raw > expected + 0.05)
          bad.push(
            `bank above the flight at (${x.toFixed(1)}, ${z.toFixed(1)}): raw ${raw.toFixed(2)} vs ${expected.toFixed(2)}`,
          );
        const steep = terrainSteepness(Math.round(x), Math.round(z), WORLD_SEED);
        if (steep > PLAYER_MAX_CLIMB_SLOPE)
          bad.push(`steep bank cell under (${x.toFixed(1)}, ${z.toFixed(1)}): ${steep.toFixed(2)}`);
      }
    }
    expect(bad, bad.slice(0, 10).join('; ')).toEqual([]);
  });
});
