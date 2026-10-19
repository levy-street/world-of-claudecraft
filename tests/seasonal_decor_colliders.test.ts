// Collision for Gourdlight Eve's solid city dressing (src/sim/seasonal_decor_colliders.ts):
// the stalls, hay bales, big lit pumpkins and corn shocks block a body exactly while the
// event runs, never stand on a road, and never cut anyone off from anywhere: every dressed
// town is walked both ways (dressing gone, dressing standing) and the only ground lost is
// the ground under the pieces themselves; every NPC is still in reach.
import { afterEach, describe, expect, it } from 'vitest';
import { pushOut } from '../src/sim/collider_pushout';
import type { Collider } from '../src/sim/collider_shapes';
import { isBlocked, queryOpenWorldColliders } from '../src/sim/colliders';
import { GOURDLIGHT_EVE_ID } from '../src/sim/content/gourdlight_eve';
import { GOURDLIGHT_DECOR_CITIES } from '../src/sim/content/gourdlight_eve_decor';
import { getActiveWorldContent, NPCS } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import {
  decorPieceIsSolid,
  GOURDLIGHT_DECOR_GATE,
  seasonalDecorColliders,
  syncSeasonalDecorColliders,
} from '../src/sim/seasonal_decor_colliders';
import { seasonalDecorLayout } from '../src/sim/seasonal_decor_layout';
import { resolvedKeeperPosts } from '../src/sim/seasonal_keeper_posts';
import { Sim } from '../src/sim/sim';
import { INTERACT_RANGE } from '../src/sim/types';
import { roadDistance } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const seed = WORLD_SEED;

// The collider grid is shared per seed in one process: never leave the gate open for the
// next suite in this worker.
afterEach(() => syncSeasonalDecorColliders(seed, null));

function boundary(c: Collider): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [{ x: c.x, z: c.z }];
  if (c.type === 'circle') {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      out.push({ x: c.x + Math.sin(a) * c.r, z: c.z + Math.cos(a) * c.r });
    }
  } else if (c.type === 'obb') {
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    for (const [lx, lz] of [
      [-c.hw, -c.hd],
      [c.hw, -c.hd],
      [-c.hw, c.hd],
      [c.hw, c.hd],
      [0, c.hd],
      [0, -c.hd],
      [c.hw, 0],
      [-c.hw, 0],
    ]) {
      out.push({ x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs });
    }
  }
  return out;
}

/** The dressing's own colliders currently in the grid round (x, z). */
function liveDecorAt(x: number, z: number, r = 0.2): Collider[] {
  const out: Collider[] = [];
  queryOpenWorldColliders(seed, x - r, z - r, x + r, z + r, out);
  return out.filter((c) => c.gate === GOURDLIGHT_DECOR_GATE && pushOut(c, x, z, r) !== null);
}

describe('the dressing collides only while the event runs', () => {
  it('stands up with the event and goes with it, for a Sim driving its own tick', () => {
    const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
    sim.tick();
    const layout = seasonalDecorLayout(seed);
    const stall = layout.stalls[0];
    const shock = layout.ground.find((p) => p.kind === 'corn_shock');
    const bale = layout.ground.find((p) => p.kind === 'hay_bale');
    const lit = layout.ground.find((p) => p.kind === 'pumpkin_lit');
    const gourd = layout.ground.find((p) => p.kind === 'gourd');
    if (!stall || !shock || !bale || !lit || !gourd) throw new Error('layout lacks a kind');
    const spots = [stall, shock, bale, lit];
    // closed: nothing of the dressing is in the grid
    for (const p of spots) expect(liveDecorAt(p.x, p.z)).toEqual([]);
    sim.chat('/dev season on');
    sim.tick();
    for (const p of spots) {
      expect(liveDecorAt(p.x, p.z).length, `${'anchor' in p ? p.anchor : 'stall'}`).toBeGreaterThan(
        0,
      );
      expect(isBlocked(seed, p.x, p.z, PLAYER_BODY_RADIUS)).toBe(true);
    }
    // a gourd is dressing a body walks through
    expect(liveDecorAt(gourd.x, gourd.z)).toEqual([]);
    sim.chat('/dev season off');
    sim.tick();
    for (const p of spots) expect(liveDecorAt(p.x, p.z)).toEqual([]);
  });

  it('syncs at the top of the tick, before movement, and at construction', () => {
    const shock = seasonalDecorLayout(seed).ground.find(
      (p) => p.kind === 'corn_shock' && !p.anchor.startsWith('field:'),
    );
    if (!shock) throw new Error('no corn shock');
    // another world in this process left the gate open...
    syncSeasonalDecorColliders(seed, GOURDLIGHT_EVE_ID);
    expect(liveDecorAt(shock.x, shock.z).length).toBeGreaterThan(0);
    // ...a fresh world with the event closed closes it before any query of its own
    new Sim({ seed, playerClass: 'warrior' });
    expect(liveDecorAt(shock.x, shock.z)).toEqual([]);
    // and a world whose event is open opens it on its first tick, before movement
    const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev season on');
    sim.tick();
    expect(liveDecorAt(shock.x, shock.z).length).toBeGreaterThan(0);
  });

  it('opens and closes the same gate for the online mirror (the season key)', () => {
    const shock = seasonalDecorLayout(seed).ground.find((p) => p.kind === 'corn_shock');
    if (!shock) throw new Error('no corn shock');
    syncSeasonalDecorColliders(seed, GOURDLIGHT_EVE_ID);
    expect(liveDecorAt(shock.x, shock.z).length).toBeGreaterThan(0);
    syncSeasonalDecorColliders(seed, 'some_other_event');
    expect(liveDecorAt(shock.x, shock.z)).toEqual([]);
    syncSeasonalDecorColliders(seed, null);
    expect(liveDecorAt(shock.x, shock.z)).toEqual([]);
  });

  it('gives a body to every solid piece and every stall, and none to the light ones', () => {
    const layout = seasonalDecorLayout(seed);
    const solid = layout.ground.filter(
      (p) => decorPieceIsSolid(p.kind) && !p.anchor.startsWith('field:'),
    );
    const colliders = seasonalDecorColliders(seed);
    expect(colliders.length).toBe(solid.length + layout.stalls.length * 6);
    expect(decorPieceIsSolid('gourd')).toBe(false);
    expect(decorPieceIsSolid('pumpkin_small')).toBe(false);
    expect(decorPieceIsSolid('garland_pole')).toBe(false);
    // the low pieces can be jumped, the tall ones cannot; none blocks a caster's eye line
    // unless it stands taller than one
    for (const c of colliders) {
      expect(c.cameraTopY).toBeDefined();
      expect(c.underY).toBeDefined();
    }
  });
});

describe('his field ring', () => {
  it('stays open round the boss arena (dressing, not a fence)', () => {
    syncSeasonalDecorColliders(seed, GOURDLIGHT_EVE_ID);
    const ring = seasonalDecorLayout(seed).ground.filter((p) => p.anchor.startsWith('field:'));
    expect(ring.length).toBeGreaterThan(0);
    for (const p of ring) expect(liveDecorAt(p.x, p.z, 0.3), p.anchor).toEqual([]);
  });
});

describe('it never blocks a road, an NPC or a way through', () => {
  const colliders = seasonalDecorColliders(seed);

  it('keeps every body off the painted roads', () => {
    const problems: string[] = [];
    for (const c of colliders) {
      for (const p of boundary(c)) {
        if (roadDistance(p.x, p.z) < 2) problems.push(`${c.x.toFixed(1)},${c.z.toFixed(1)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps every NPC standing clear and the keeper in talking reach', () => {
    syncSeasonalDecorColliders(seed, GOURDLIGHT_EVE_ID);
    try {
      for (const n of Object.values(NPCS)) {
        if (n.id === 'gourdlight_keeper') continue;
        expect(liveDecorAt(n.pos.x, n.pos.z, 0.6), n.id).toEqual([]);
      }
      for (const post of resolvedKeeperPosts(seed)) {
        // a free standing spot in front of her counter, within talking range
        const ahead = { x: Math.sin(post.facing), z: Math.cos(post.facing) };
        let reach = false;
        for (let d = 1; d < INTERACT_RANGE - 0.2 && !reach; d += 0.25) {
          reach = !isBlocked(
            seed,
            post.pos.x + ahead.x * d,
            post.pos.z + ahead.z * d,
            PLAYER_BODY_RADIUS,
          );
        }
        expect(reach, post.post.id).toBe(true);
      }
    } finally {
      syncSeasonalDecorColliders(seed, null);
    }
  });

  // A flood fill of each dressed town at a body's radius, once with the dressing gone and
  // once with it standing. Ground reachable without it but not with it must lie under (or
  // hard against) a piece: a cell cut off anywhere else would be a trapped corner, a
  // blocked door or a sealed lane.
  it('cuts nobody off from anywhere in any dressed town', () => {
    const STEP = 0.6;
    const zones = getActiveWorldContent().zones;
    for (const rule of GOURDLIGHT_DECOR_CITIES) {
      const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
      if (!hub) throw new Error(rule.zoneId);
      const R = rule.radius;
      const n = Math.ceil((2 * R) / STEP);
      const x0 = hub.x - R;
      const z0 = hub.z - R;
      const flood = (): Uint8Array => {
        const seen = new Uint8Array(n * n);
        const open = (i: number, j: number) =>
          !isBlocked(seed, x0 + i * STEP, z0 + j * STEP, PLAYER_BODY_RADIUS);
        // start on the nearest open cell to the hub
        let start = -1;
        for (let r = 0; r < n / 2 && start < 0; r++) {
          for (let di = -r; di <= r && start < 0; di++) {
            for (const dj of [-r, r]) {
              const i = (n >> 1) + di;
              const j = (n >> 1) + dj;
              if (open(i, j)) start = i * n + j;
            }
          }
        }
        if (start < 0) throw new Error(`no open ground near ${rule.zoneId}`);
        const queue = [start];
        seen[start] = 1;
        while (queue.length > 0) {
          const k = queue.pop() as number;
          const i = Math.floor(k / n);
          const j = k % n;
          for (const [a, b] of [
            [i + 1, j],
            [i - 1, j],
            [i, j + 1],
            [i, j - 1],
          ]) {
            if (a < 0 || b < 0 || a >= n || b >= n) continue;
            const q = a * n + b;
            if (seen[q] || !open(a, b)) continue;
            seen[q] = 1;
            queue.push(q);
          }
        }
        return seen;
      };
      syncSeasonalDecorColliders(seed, null);
      const bare = flood();
      syncSeasonalDecorColliders(seed, GOURDLIGHT_EVE_ID);
      let dressed: Uint8Array;
      try {
        dressed = flood();
      } finally {
        syncSeasonalDecorColliders(seed, null);
      }
      const nearPiece = (x: number, z: number): boolean => {
        for (const c of colliders) {
          const reach =
            (c.type === 'circle' ? c.r : c.type === 'obb' ? Math.hypot(c.hw, c.hd) : 0) +
            PLAYER_BODY_RADIUS +
            STEP * 1.5;
          if (Math.hypot(c.x - x, c.z - z) <= reach) return true;
        }
        return false;
      };
      const cutOff: string[] = [];
      let lost = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const k = i * n + j;
          if (!bare[k] || dressed[k]) continue;
          lost++;
          const x = x0 + i * STEP;
          const z = z0 + j * STEP;
          if (!nearPiece(x, z)) cutOff.push(`${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
      expect(cutOff, rule.zoneId).toEqual([]);
      // and the fill is not vacuous: the dressing really does take up ground in this town
      expect(lost, rule.zoneId).toBeGreaterThan(20);
    }
  }, 120_000);
});
