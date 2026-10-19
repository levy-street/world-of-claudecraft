// The seasonal city dressing's resolver (src/sim/seasonal_decor_layout.ts) run
// against the LIVE shipped world: every piece anchored, nothing inside a
// collider, on a road, on an NPC's spot or in another piece, every garland clear
// along its whole run, and each city actually dressed. This is the pin that turns
// red when a city rework drops a building onto the dressing: re-running the gate
// after other PRs merge catches it.
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORED_TOWN_BUILDINGS } from '../src/sim/authored_town_registry';
import { isBlocked, streetlampPlacements } from '../src/sim/colliders';
import { GOURDLIGHT_KEEPER_POSTS } from '../src/sim/content/gourdlight_eve';
import { GOURDLIGHT_DECOR_CITIES } from '../src/sim/content/gourdlight_eve_decor';
import { GOURDLIGHT_PUMPKINS } from '../src/sim/content/gourdlight_pumpkins';
import { getActiveWorldContent, NPCS } from '../src/sim/data';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import {
  CHAPEL_DECOR_CLEARANCE,
  chapelAt,
  SEASONAL_CHAPEL_IDS,
} from '../src/sim/seasonal_decor_exclusions';
import {
  DECOR_FAMILY_SPACING,
  DECOR_GARLAND_MAX_SPAN,
  DECOR_GARLAND_ROAD_CLEARANCE,
  DECOR_MIN_SPACING,
  DECOR_NPC_CLEARANCE,
  DECOR_ROAD_CLEARANCE,
  decorFamily,
  decorKindRadius,
  decorSpacing,
  garlandOffRoad,
  groundSpotProblem,
  narrowsPassage,
  resolveSeasonalDecor,
  SCARECROW_FIELD_RING,
  seasonalDecorLayout,
} from '../src/sim/seasonal_decor_layout';
import {
  insideStall,
  resolveSeasonalStall,
  STALL_FOOTPRINT,
  STALL_SCALE,
  stallLocalToWorld,
  stallRoomProblem,
  stallSpotProblem,
} from '../src/sim/seasonal_decor_stall';
import { resolvedKeeperPosts } from '../src/sim/seasonal_keeper_posts';
import { INTERACT_RANGE } from '../src/sim/types';
import { groundHeight, roadDistance } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The collider grid is shared per seed in one process: close the event's decor gate
// after each test so no other suite in this worker walks into a stall.
afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

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
        if (Math.hypot(q.x - p.x, q.z - p.z) < decorSpacing(p.kind, q.kind))
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

  // Owner note 2026-10-18: Fenbridge's booth stood wedged in the market lane between two
  // houses, so nobody had room to stand at it and the chase camera sat inside the walls.
  // The room rule (an open apron for her customers, a camera lane clear of buildings, no
  // wall against either side) now turns such a spot down, and every shipped stall has room.
  it('gives every shipped stall room to stand and a clear camera lane', () => {
    for (const post of resolvedKeeperPosts(WORLD_SEED)) {
      const stall = post.stall;
      if (!stall) continue;
      expect(stallRoomProblem(WORLD_SEED, stall.x, stall.z, stall.yaw), post.post.id).toBeNull();
    }
    // the old Fenbridge spot in the market lane: the footprint itself fitted, the room did not
    expect(stallRoomProblem(WORLD_SEED, -3.6, 286.5, 0)).toBe('cramped');
    expect(
      stallSpotProblem(
        WORLD_SEED,
        -3.6,
        286.5,
        0,
        Object.values(NPCS)
          .filter((n) => n.id !== 'gourdlight_keeper')
          .map((n) => n.pos),
      ),
    ).toBe('cramped');
    // Fenbridge's booth now stands out on the green where the Eastbrook road comes in
    const fen = resolvedKeeperPosts(WORLD_SEED).find((p) => p.post.id === 'fenbridge');
    expect(fen?.moved).toBe(false);
    expect(fen?.stall).not.toBeNull();
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

  // The Haunted Pumpkin hunt (content/gourdlight_pumpkins.ts) shares the world with the
  // keeper's stalls, the city dressing and Old Thatchgrin's field: a hunt pumpkin buried
  // in a stall, hidden among the decor or standing in the boss arena would steal or
  // block the click that lights it, so every anchor keeps clear of all three.
  it('keeps every Haunted Pumpkin clear of the stalls, the decor and the scarecrow field', () => {
    const field = resolveScarecrowField(WORLD_SEED);
    expect(field).not.toBeNull();
    const problems: string[] = [];
    for (const p of GOURDLIGHT_PUMPKINS) {
      for (const stall of layout.stalls) {
        if (insideStall(stall, p.x, p.z, 2)) problems.push(`${p.id} inside ${stall.anchor}`);
      }
      for (const post of resolvedKeeperPosts(WORLD_SEED)) {
        if (Math.hypot(post.pos.x - p.x, post.pos.z - p.z) < 4)
          problems.push(`${p.id} on keeper post ${post.post.id}`);
      }
      for (const g of layout.ground) {
        if (Math.hypot(g.x - p.x, g.z - p.z) < DECOR_MIN_SPACING + decorKindRadius(g.kind))
          problems.push(`${p.id} among decor ${g.anchor}`);
      }
      if (field && Math.hypot(field.x - p.x, field.z - p.z) < SCARECROW_FIELD_RING.outer + 3)
        problems.push(`${p.id} in the scarecrow field`);
    }
    expect(problems).toEqual([]);
  });

  // Owner note 2026-10-18: the straw read as litter. A broken anchor hash pinned every
  // share to 0, so every lamp, knocking door and townsfolk took a bale or a shock.
  // The straw is now an accent: a ceiling per city, a minority of every city's pieces,
  // and the lamp clusters genuinely varied (some posts with straw, most without).
  it('keeps the straw an accent in every city, not litter', () => {
    const zones = getActiveWorldContent().zones;
    const straw = (k: string) => k === 'corn_shock' || k === 'hay_bale';
    for (const rule of GOURDLIGHT_DECOR_CITIES) {
      const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
      if (!hub) continue;
      const ground = layout.ground.filter(
        (p) => Math.hypot(p.x - hub.x, p.z - hub.z) <= rule.radius + 3,
      );
      const strawCount = ground.filter((p) => straw(p.kind)).length;
      expect(strawCount, `${rule.zoneId} straw pieces`).toBeLessThanOrEqual(16);
      expect(strawCount / ground.length, `${rule.zoneId} straw share`).toBeLessThan(0.3);
      const lampClusters = new Set(
        ground.filter((p) => /^lamp:\d+:a$/.test(p.anchor)).map((p) => p.anchor.split(':')[1]),
      );
      const strawLamps = new Set(
        ground
          .filter((p) => /^lamp:\d+:[cd]$/.test(p.anchor) && straw(p.kind))
          .map((p) => p.anchor.split(':')[1]),
      );
      expect(strawLamps.size, `${rule.zoneId} lamps with straw`).toBeLessThan(
        lampClusters.size / 2,
      );
    }
  });

  it('is deterministic and memoized per seed', () => {
    expect(resolveSeasonalDecor(WORLD_SEED)).toEqual(layout);
    expect(seasonalDecorLayout(WORLD_SEED)).toBe(seasonalDecorLayout(WORLD_SEED));
  });

  // Owner note 2026-10-18 (Eastbrook): a string of lights hung between two lamps on
  // OPPOSITE sides of the road ran diagonally over the middle of the walkway. A garland
  // now only joins posts on one side of their road, never hangs over the painted track,
  // and stays short.
  it('strings no garland across a road in any event city', () => {
    const lamps = streetlampPlacements(WORLD_SEED);
    const onLamp = (x: number, z: number) => lamps.find((l) => Math.hypot(l.x - x, l.z - z) < 0.01);
    const problems: string[] = [];
    for (const g of layout.garlands) {
      const span = Math.hypot(g.bx - g.ax, g.bz - g.az);
      expect(span, g.anchor).toBeLessThanOrEqual(DECOR_GARLAND_MAX_SPAN);
      for (let d = 0; d <= span; d += 0.25) {
        const t = d / span;
        const r = roadDistance(g.ax + (g.bx - g.ax) * t, g.az + (g.bz - g.az) * t);
        if (r < DECOR_GARLAND_ROAD_CLEARANCE) {
          problems.push(`${g.anchor} over the road at ${d.toFixed(2)} (${r.toFixed(2)})`);
          break;
        }
      }
      // two lamps strung together face their road the same way: one side of it
      const a = onLamp(g.ax, g.az);
      const b = onLamp(g.bx, g.bz);
      if (a && b && Math.cos(a.roadYaw - b.roadYaw) < 0.5)
        problems.push(`${g.anchor} joins posts on opposite sides`);
    }
    expect(problems).toEqual([]);
    // every event city still has strung garlands
    const zones = getActiveWorldContent().zones;
    for (const rule of GOURDLIGHT_DECOR_CITIES) {
      const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
      if (!hub) continue;
      const mine = layout.garlands.filter(
        (g) => Math.hypot(g.ax - hub.x, g.az - hub.z) <= rule.radius + 3,
      );
      expect(mine.length, rule.zoneId).toBeGreaterThanOrEqual(2);
    }
  });

  it('refuses a garland strung across the road (the resolver rule itself)', () => {
    const lamps = streetlampPlacements(WORLD_SEED);
    const hub = getActiveWorldContent().zones.find((z) => z.id === 'eastbrook_vale')?.hub;
    expect(hub).toBeDefined();
    if (!hub) return;
    const lamp = lamps.find(
      (l) => Math.hypot(l.x - hub.x, l.z - hub.z) < 62 && chapelAt(l.x, l.z) === null,
    );
    expect(lamp).toBeDefined();
    if (!lamp) return;
    // the mirror of the post across its road: the run passes over the centre line
    const reach = roadDistance(lamp.x, lamp.z) * 2;
    const across = {
      ax: lamp.x,
      ay: lamp.y + 3.7,
      az: lamp.z,
      bx: lamp.x + Math.sin(lamp.roadYaw) * reach,
      by: lamp.y + 3.7,
      bz: lamp.z + Math.cos(lamp.roadYaw) * reach,
      sag: 1,
      anchor: 'probe',
    };
    expect(garlandOffRoad(across)).toBe(false);
    // the same run turned back from the road stays off it
    const away = {
      ...across,
      bx: lamp.x - Math.sin(lamp.roadYaw) * 6,
      bz: lamp.z - Math.cos(lamp.roadYaw) * 6,
    };
    expect(garlandOffRoad(away)).toBe(true);
  });

  // Owner note 2026-10-18: no pumpkins at the church. Every event city's chapel is a
  // quiet place: no ground piece, lantern or garland at it, round it or inside it.
  it('keeps every piece of dressing away from the chapels', () => {
    const chapels = AUTHORED_TOWN_BUILDINGS.filter((b) => b.kind === 'chapel');
    expect(chapels.map((c) => c.id).sort()).toEqual([...SEASONAL_CHAPEL_IDS].sort());
    expect(chapels.length).toBe(3);
    for (const c of chapels) {
      // the chapel itself and a point just inside the margin are in the zone; a point
      // past the margin is not
      expect(chapelAt(c.position.x, c.position.z), c.id).toBe(c.id);
      const r = c.reach;
      const cos = Math.cos(r.rotation);
      const sin = Math.sin(r.rotation);
      // local +x back to world (the inverse of the zone's own frame)
      const at = (lx: number) => chapelAt(r.center.x + lx * cos, r.center.z - lx * sin);
      expect(at(r.halfWidth + CHAPEL_DECOR_CLEARANCE - 0.5), `${c.id} margin`).toBe(c.id);
      expect(at(r.halfWidth + CHAPEL_DECOR_CLEARANCE + 0.5), `${c.id} past it`).toBeNull();
      expect(
        groundSpotProblem(WORLD_SEED, r.center.x, r.center.z, [], []),
        `${c.id} refused`,
      ).not.toBeNull();
    }
    const problems: string[] = [];
    for (const p of layout.ground) {
      const at = chapelAt(p.x, p.z);
      if (at) problems.push(`${p.anchor} (${p.kind}) at ${at}`);
    }
    for (const l of layout.lanterns) {
      const at = chapelAt(l.x, l.z);
      if (at) problems.push(`${l.anchor} lantern at ${at}`);
    }
    for (const g of layout.garlands) {
      for (let t = 0; t <= 1; t += 0.02) {
        const at = chapelAt(g.ax + (g.bx - g.ax) * t, g.az + (g.bz - g.az) * t);
        if (at) {
          problems.push(`${g.anchor} garland at ${at}`);
          break;
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // Owner note 2026-10-18: the pumpkins and the straw stood bunched in piles. Two pieces
  // of one family keep a wide berth, any two pieces a smaller one, and every city keeps
  // about the round-5 amount of dressing (spread out, not cut).
  it('spreads the dressing out in every city: a berth per family, about the same count', () => {
    expect(DECOR_FAMILY_SPACING.pumpkin).toBeGreaterThanOrEqual(3.5);
    expect(DECOR_FAMILY_SPACING.straw).toBeGreaterThanOrEqual(7);
    expect(DECOR_MIN_SPACING).toBeGreaterThanOrEqual(2.4);
    expect(decorSpacing('pumpkin_lit', 'gourd')).toBe(DECOR_FAMILY_SPACING.pumpkin);
    expect(decorSpacing('corn_shock', 'hay_bale')).toBe(DECOR_FAMILY_SPACING.straw);
    expect(decorSpacing('corn_shock', 'pumpkin_small')).toBe(DECOR_MIN_SPACING);
    // the resolver rule itself: a gourd 3 yd from a lit pumpkin is crowded out, a shock
    // at the same 3 yd is not (a different family)
    const lamp = streetlampPlacements(WORLD_SEED)[0];
    const placed = [{ x: lamp.x + 20, z: lamp.z + 20, kind: 'pumpkin_lit' as const }];
    const px = placed[0].x + 3;
    const pz = placed[0].z;
    expect(
      groundSpotProblem(WORLD_SEED, px, pz, [], placed, [], decorKindRadius('gourd'), 'gourd'),
    ).toBe('crowded');
    expect(groundSpotProblem(WORLD_SEED, px, pz, [], placed, [], 0.2, 'corn_shock')).not.toBe(
      'crowded',
    );
    const zones = getActiveWorldContent().zones;
    for (const rule of GOURDLIGHT_DECOR_CITIES) {
      const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
      if (!hub) continue;
      const ground = layout.ground.filter(
        (p) => Math.hypot(p.x - hub.x, p.z - hub.z) <= rule.radius + 3,
      );
      // round 5 dressed each city with 52 to 63 pieces: keep roughly that
      expect(ground.length, `${rule.zoneId} count`).toBeGreaterThanOrEqual(42);
      expect(ground.length, `${rule.zoneId} count`).toBeLessThanOrEqual(66);
      for (const [i, p] of ground.entries()) {
        for (const q of ground.slice(i + 1)) {
          const fp = decorFamily(p.kind);
          const need = fp === decorFamily(q.kind) ? DECOR_FAMILY_SPACING[fp] : DECOR_MIN_SPACING;
          expect(
            Math.hypot(q.x - p.x, q.z - p.z),
            `${rule.zoneId}: ${p.anchor} and ${q.anchor}`,
          ).toBeGreaterThanOrEqual(need);
        }
      }
    }
  });
});
