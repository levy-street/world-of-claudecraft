// The seasonal city dressing's resolver (src/sim/seasonal_decor_layout.ts) run
// against the LIVE shipped world: every piece anchored, nothing inside a
// collider, on a road, on an NPC's spot or in another piece, every garland clear
// along its whole run, and each city actually dressed. This is the pin that turns
// red when a city rework drops a building onto the dressing: re-running the gate
// after other PRs merge catches it.
import { describe, expect, it } from 'vitest';
import { isBlocked, streetlampPlacements } from '../src/sim/colliders';
import { GOURDLIGHT_KEEPER_POSTS } from '../src/sim/content/gourdlight_eve';
import { GOURDLIGHT_DECOR_CITIES } from '../src/sim/content/gourdlight_eve_decor';
import { getActiveWorldContent, NPCS } from '../src/sim/data';
import {
  DECOR_MIN_SPACING,
  DECOR_NPC_CLEARANCE,
  DECOR_ROAD_CLEARANCE,
  decorKindRadius,
  groundSpotProblem,
  narrowsPassage,
  resolveSeasonalDecor,
  seasonalDecorLayout,
} from '../src/sim/seasonal_decor_layout';
import {
  insideStall,
  resolveSeasonalStall,
  STALL_FOOTPRINT,
  STALL_SCALE,
  stallLocalToWorld,
  stallSpotProblem,
} from '../src/sim/seasonal_decor_stall';
import { resolvedKeeperPosts } from '../src/sim/seasonal_keeper_posts';
import { INTERACT_RANGE } from '../src/sim/types';
import { groundHeight, roadDistance } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const layout = resolveSeasonalDecor(WORLD_SEED);

describe('seasonal decor placement against the live world', () => {
  it('seats no ground piece inside a collider, on a road, on an NPC or on another piece', () => {
    const problems: string[] = [];
    for (const [i, p] of layout.ground.entries()) {
      if (isBlocked(WORLD_SEED, p.x, p.z, decorKindRadius(p.kind)))
        problems.push(`${p.anchor} collider`);
      for (const stall of layout.stalls) {
        if (!p.anchor.startsWith('keeper:') && insideStall(stall, p.x, p.z, 0.5))
          problems.push(`${p.anchor} inside ${stall.anchor}`);
      }
      // the free-standing pieces (street shoulders, townsfolk sides) never squeeze a walkway
      if (/^(street|folk):/.test(p.anchor) && narrowsPassage(WORLD_SEED, p.x, p.z))
        problems.push(`${p.anchor} narrows a passage`);
      if (roadDistance(p.x, p.z) < DECOR_ROAD_CLEARANCE) problems.push(`${p.anchor} road`);
      for (const n of Object.values(NPCS)) {
        if (Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < DECOR_NPC_CLEARANCE)
          problems.push(`${p.anchor} on NPC ${n.id}`);
      }
      for (const q of layout.ground.slice(i + 1)) {
        if (Math.hypot(q.x - p.x, q.z - p.z) < DECOR_MIN_SPACING)
          problems.push(`${p.anchor} overlaps ${q.anchor}`);
      }
      expect(p.y).toBeCloseTo(groundHeight(p.x, p.z, WORLD_SEED), 5);
    }
    expect(problems).toEqual([]);
  });

  it('strings no garland through a building', () => {
    for (const g of layout.garlands) {
      const span = Math.hypot(g.bx - g.ax, g.bz - g.az);
      // Past each end's own post (the widest lamp base plus its margin).
      for (let d = 1.6; d <= span - 1.6; d += 0.5) {
        const t = d / span;
        const x = g.ax + (g.bx - g.ax) * t;
        const z = g.az + (g.bz - g.az) * t;
        expect(isBlocked(WORLD_SEED, x, z, 0.15), `${g.anchor} at ${d.toFixed(1)}`).toBe(false);
        for (const stall of layout.stalls) {
          expect(insideStall(stall, x, z), `${g.anchor} over ${stall.anchor}`).toBe(false);
        }
      }
    }
  });

  it('dresses every configured city, hung off its own lamps and townsfolk', () => {
    const zones = getActiveWorldContent().zones;
    const lamps = streetlampPlacements(WORLD_SEED);
    for (const rule of GOURDLIGHT_DECOR_CITIES) {
      const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
      expect(hub, rule.zoneId).toBeDefined();
      if (!hub) continue;
      const near = (x: number, z: number) => Math.hypot(x - hub.x, z - hub.z) <= rule.radius + 3;
      const ground = layout.ground.filter((p) => near(p.x, p.z));
      const lanterns = layout.lanterns.filter((p) => near(p.x, p.z));
      expect(ground.length, `${rule.zoneId} ground pieces`).toBeGreaterThanOrEqual(8);
      const garlands = layout.garlands.filter((g) => near(g.ax, g.az));
      expect(garlands.length, `${rule.zoneId} garlands`).toBeGreaterThanOrEqual(2);
      expect(lanterns.length, `${rule.zoneId} lanterns`).toBeGreaterThanOrEqual(3);
      expect(ground.filter((p) => p.anchor.startsWith('npc:')).length).toBeGreaterThanOrEqual(3);
      // the rest of the townsfolk and the lamp clusters dress the street beyond the doors
      expect(ground.filter((p) => p.anchor.startsWith('folk:')).length).toBeGreaterThanOrEqual(3);
      expect(ground.filter((p) => /^lamp:\d+:c$/.test(p.anchor)).length).toBeGreaterThanOrEqual(3);
      // the road shoulders between the lamps carry their own harvest pieces
      expect(
        ground.filter((p) => p.anchor.startsWith(`street:${rule.zoneId}:`)).length,
        `${rule.zoneId} street pieces`,
      ).toBeGreaterThanOrEqual(5);
      // and the harvest kinds all show up in every city
      for (const kind of ['corn_shock', 'hay_bale', 'pumpkin_lit'] as const) {
        expect(
          ground.some((p) => p.kind === kind),
          `${rule.zoneId} ${kind}`,
        ).toBe(true);
      }
      // Every lantern hangs on a real post of the lamp plan.
      for (const l of lanterns) {
        const index = Number(l.anchor.split(':')[1]);
        const post = lamps[index];
        expect(post, l.anchor).toBeDefined();
        expect(Math.hypot(post.x - l.x, post.z - l.z)).toBeLessThan(0.6);
      }
    }
    expect(layout.garlands.length).toBeGreaterThan(0);
    // Every garland ends on a real post: a lamp of the plan or a seated festival pole.
    const poles = layout.ground.filter((p) => p.kind === 'garland_pole');
    for (const g of layout.garlands) {
      const onLamp = (x: number, z: number) =>
        lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 0.01);
      const onPole = (x: number, z: number) =>
        poles.some((p) => Math.hypot(p.x - x, p.z - z) < 0.01);
      expect(onLamp(g.ax, g.az), g.anchor).toBe(true);
      expect(onLamp(g.bx, g.bz) || onPole(g.bx, g.bz), g.anchor).toBe(true);
    }
  });

  it('refuses a spot inside a collider, on the road and on an NPC (the resolver rule itself)', () => {
    const lamp = streetlampPlacements(WORLD_SEED)[0];
    expect(groundSpotProblem(WORLD_SEED, lamp.x, lamp.z, [], [])).toBe('collider');
    const wilkes = NPCS.trader_wilkes.pos;
    expect(groundSpotProblem(WORLD_SEED, wilkes.x, wilkes.z, [wilkes], [])).toBe('npc');
    // The keeper's own stand is never under a piece.
    const keeper = NPCS.gourdlight_keeper.pos;
    for (const p of layout.ground) {
      expect(Math.hypot(p.x - keeper.x, p.z - keeper.z)).toBeGreaterThanOrEqual(
        DECOR_NPC_CLEARANCE,
      );
    }
  });

  it('stands the keeper behind the counter of her stall in every city, its whole footprint clear', () => {
    const posts = resolvedKeeperPosts(WORLD_SEED);
    expect(layout.stalls).toHaveLength(GOURDLIGHT_KEEPER_POSTS.length);
    for (const post of posts) {
      const keeper = post.pos;
      const stall = post.stall;
      expect(stall, `${post.post.id}: the shipped city takes her stall`).not.toBeNull();
      if (!stall) continue;
      expect(layout.stalls).toContain(stall);
      expect(stall.anchor).toBe(`stall:${post.post.id}`);
      expect(stall.scale).toBe(STALL_SCALE);
      // she stands inside it, between the back wall and the counter
      expect(insideStall(stall, keeper.x, keeper.z)).toBe(true);
      const others = Object.values(NPCS)
        .filter((n) => n.id !== 'gourdlight_keeper')
        .map((n) => n.pos);
      expect(stallSpotProblem(WORLD_SEED, stall.x, stall.z, stall.yaw, others)).toBeNull();
      for (const n of others) expect(insideStall(stall, n.x, n.z)).toBe(false);
      // it sits on the lowest ground under it: never a floating corner
      const f = STALL_FOOTPRINT;
      for (const [lx, lz] of [
        [f.minX, f.minZ],
        [f.maxX, f.minZ],
        [f.minX, f.maxZ],
        [f.maxX, f.maxZ],
      ]) {
        const c = stallLocalToWorld(
          stall.x,
          stall.z,
          stall.yaw,
          lx * STALL_SCALE,
          lz * STALL_SCALE,
        );
        expect(groundHeight(c.x, c.z, WORLD_SEED)).toBeGreaterThanOrEqual(stall.y - 1e-9);
      }
      // a customer can reach her: a clear walkable spot in front of the counter, outside
      // the stall, within talking range
      const front = stallLocalToWorld(
        stall.x,
        stall.z,
        stall.yaw,
        0,
        (STALL_FOOTPRINT.maxZ + 0.6) * STALL_SCALE,
      );
      expect(insideStall(stall, front.x, front.z)).toBe(false);
      expect(isBlocked(WORLD_SEED, front.x, front.z, 0.4), post.post.id).toBe(false);
      expect(Math.hypot(front.x - keeper.x, front.z - keeper.z)).toBeLessThan(INTERACT_RANGE);
      // two lit pumpkins out front, where her customers stand
      const lit = layout.ground.filter((p) => p.anchor.startsWith(`keeper:${post.post.id}:`));
      expect(lit, post.post.id).toHaveLength(2);
    }
    // no two cities' stalls overlap anything of each other's
    for (const s of layout.stalls) {
      for (const t of layout.stalls) if (s !== t) expect(insideStall(s, t.x, t.z, 2)).toBe(false);
    }
  });

  it('turns the stall down where her spot cannot take it (the resolver rule itself)', () => {
    const lamp = streetlampPlacements(WORLD_SEED)[0];
    // a keeper standing on a lamp post: every slide and turn hits the post
    const blocked = resolveSeasonalStall(
      WORLD_SEED,
      { id: 'probe', pos: { x: lamp.x, z: lamp.z }, facing: lamp.roadYaw },
      [],
    );
    expect(blocked).toBeNull();
    // the footprint check reads the stall's own frame: local +z is its facing
    const p = stallLocalToWorld(10, 20, Math.PI / 2, 0, 2);
    expect(p.x).toBeCloseTo(12, 9);
    expect(p.z).toBeCloseTo(20, 9);
  });

  it('is deterministic and memoized per seed', () => {
    expect(resolveSeasonalDecor(WORLD_SEED)).toEqual(layout);
    expect(seasonalDecorLayout(WORLD_SEED)).toBe(seasonalDecorLayout(WORLD_SEED));
  });
});
