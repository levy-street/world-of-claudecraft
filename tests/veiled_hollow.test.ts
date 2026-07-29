// The Veiled Hollow: the live-sim movement wall, the coastline's fixed
// features, swim fatigue, and the Pale Causeway. See
// tests/veiled_hollow_shared.ts; the zone registration and the terrain
// gradient scans of the sealed ridge live in veiled_hollow_a/_b (split so no
// single file carries both heavy terrain sweeps).

import { describe, expect, it } from 'vitest';
import {
  REALM_CAMPS,
  REALM_NPCS,
  REALM_PORTALS,
  REALM_PROPS,
  REALM_ROADS,
  REALM_ZONE,
} from '../src/sim/content/realm';
import { zoneAt } from '../src/sim/data';
import { FATIGUE_FIRST_BITE_TICKS } from '../src/sim/fatigue';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { hollowLandness, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { SEED, VEILED_HOLLOW_TEST_WORLD } from './veiled_hollow_shared';

describe('the sealed border is a hard movement wall', () => {
  // The climb gate projects rise along the movement direction, so a smooth
  // gaussian wall alone is beatable by shallow diagonals (and airborne drift
  // skips the gate entirely). crossesSealedBorder in resolveMovement is the
  // real guarantee: drive the ACTUAL sim movement at exploit angles and with
  // jump spam, and assert the crest is never crossed.
  const CREST = 915; // ZONES[2].zMax + 15 (the sealed ridge shift)

  function walker(seed: number, startX: number, yawOffNorth: number, jump: boolean): number {
    const sim = new Sim({ seed, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.pos.x = startX;
    p.pos.z = 890;
    p.pos.y = terrainHeight(startX, 890, seed);
    p.prevPos = { ...p.pos };
    p.maxHp = 999999;
    p.hp = 999999;
    sim.moveInput.forward = true;
    let maxZ = p.pos.z;
    // 60 seconds of held movement, re-aiming across the wall each second and
    // flipping the diagonal so the walker tacks along the face
    for (let s = 0; s < 60; s++) {
      const sign = s % 2 === 0 ? 1 : -1;
      p.facing = sign * yawOffNorth; // 0 = +z north (into the realm)
      for (let t = 0; t < 20; t++) {
        if (jump) sim.moveInput.jump = true;
        sim.tick();
        if (p.pos.z > maxZ) maxZ = p.pos.z;
      }
      // clamp x back into the band so the tack never leaves the world
      if (p.pos.x > 170) p.pos.x = 170;
      if (p.pos.x < -170) p.pos.x = -170;
    }
    return maxZ;
  }

  // the easiest faces found by a greedy climber: mid-band and the Starfall
  // carve near x=126 (full sims are slow; keep the matrix tight)
  it('holds against shallow-diagonal walking at the exploit-prone faces', () => {
    for (const x of [-40, 126]) {
      for (const yaw of [1.1, 1.35]) {
        expect(walker(SEED, x, yaw, false), `x=${x} yaw=${yaw}`).toBeLessThan(CREST);
      }
    }
  }, 60000);

  it('holds against jump spam into the face', () => {
    for (const x of [-40, 126]) {
      expect(walker(SEED, x, 1.2, true), `x=${x}`).toBeLessThan(CREST);
    }
  }, 60000);

  it('still lets the portal deliver players across', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    // stand inside the crystal cave gate (REALM_PORTALS side a, the Thornpeak
    // bench): the start point must track the authored gate position
    const gate = REALM_PORTALS[0].a;
    p.pos.x = gate.x;
    p.pos.z = gate.z + 0.5;
    p.prevPos = { ...p.pos };
    sim.tick();
    expect(p.pos.z).toBeGreaterThan(CREST);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('veiled_hollow');
  });
});

describe('the Hollow coastline keeps every fixed feature on dry land', () => {
  function assertOnLand(label: string, x: number, z: number) {
    // the coast only exists north of the sealed range (z >= 960); south of it
    // (and outside the band) only the dry-ground check applies
    if (z >= 960 && z <= 1262) {
      expect(hollowLandness(x, z), `${label} at ${x},${z} landness`).toBeGreaterThan(0.14);
    }
    expect(terrainHeight(x, z, SEED), `${label} at ${x},${z} height`).toBeGreaterThan(WATER_LEVEL);
  }

  it('camps, town, roads, ruins, portals, and POIs stay above the sea', () => {
    for (const c of REALM_CAMPS) assertOnLand(`camp ${c.mobId}`, c.center.x, c.center.z);
    for (const n of Object.values(REALM_NPCS)) assertOnLand(`npc ${n.id}`, n.pos.x, n.pos.z);
    for (const poi of REALM_ZONE.pois) {
      // POIs may label water features (the lakes); they just must not drift
      // out past the coast into the open sea
      expect(hollowLandness(poi.x, poi.z), `poi ${poi.label} landness`).toBeGreaterThan(0.14);
    }
    for (const b of REALM_PROPS.buildings) assertOnLand('building', b.x, b.z);
    for (const ring of REALM_PROPS.ruinRings) assertOnLand('ruin ring', ring.x, ring.z);
    for (const t of REALM_PROPS.tents) assertOnLand('tent', t.x, t.z);
    for (const m of REALM_PROPS.mines) assertOnLand('cave mouth', m.x, m.z);
    for (const portal of REALM_PORTALS) {
      assertOnLand('portal b', portal.b.x, portal.b.z);
      assertOnLand('portal b landing', portal.b.landing.x, portal.b.landing.z);
    }
    const g = REALM_ZONE.graveyard;
    assertOnLand('graveyard', g.x, g.z);
    for (const road of REALM_ROADS) {
      for (let i = 0; i < road.length - 1; i++) {
        for (let t = 0; t <= 1; t += 0.1) {
          const x = road[i].x + (road[i + 1].x - road[i].x) * t;
          const z = road[i].z + (road[i + 1].z - road[i].z) * t;
          assertOnLand('road', x, z);
        }
      }
    }
  });
});

describe('open-sea swim fatigue', () => {
  it('warns, then deals rising damage far offshore, and relents ashore', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.maxHp = 1000;
    p.hp = 1000;
    // hugging the eastern map edge in open water: the fatigue band
    p.pos.x = 160;
    p.pos.z = 1380;
    p.pos.y = -4.6; // treading at the surface
    p.prevPos = { ...p.pos };
    let warned = false;
    // The pacing itself, pinned to a LITERAL. The loop bound below is derived
    // from FATIGUE_FIRST_BITE_TICKS, and so is every other fatigue assertion in
    // the suite, so they all move WITH the constant and none of them can catch
    // a re-pace on its own: raise SLOWDOWN and they stay green while the sea
    // quietly stops biting. 900 ticks is 45s at the 20 Hz tick.
    expect(FATIGUE_FIRST_BITE_TICKS).toBe(900);
    // Swim until the sea has bitten once (staying past that is lethal by
    // design). The bound follows the fatigue module's own pacing plus a margin,
    // so a slow clock cannot silently truncate the run.
    const limit = Math.round(FATIGUE_FIRST_BITE_TICKS * 1.25);
    for (let t = 0; t < limit && p.hp === 1000; t++) {
      const events = sim.tick();
      if (events.some((e) => e.type === 'log' && e.text.includes('open sea'))) warned = true;
      p.pos.x = 160;
      p.pos.z = 1380; // keep swimming in place against any drift
    }
    expect(warned).toBe(true);
    expect(p.hp).toBeLessThan(1000);
    const hpAfterSea = p.hp;
    // back ashore: fatigue resets and the bleeding stops
    p.pos.x = -40;
    p.pos.z = 1030;
    p.pos.y = 3;
    p.prevPos = { ...p.pos };
    for (let t = 0; t < 20 * 3; t++) sim.tick();
    expect(p.fatigueTicks).toBe(0);
    expect(p.hp).toBeGreaterThanOrEqual(hpAfterSea);
  });
});

describe('the Pale Causeway', () => {
  it('is one continuous walkable landmass from the coast to the band edge', () => {
    // the spine, coast root to northern head: dry land the whole way, and no
    // step along it steeper than the climb gate
    const spine = [
      { x: 0, z: 1250 },
      { x: 18, z: 1280 },
      { x: 30, z: 1300 },
      { x: 40, z: 1330 },
      { x: 48, z: 1355 },
      { x: 46, z: 1390 },
      { x: 44, z: 1415 },
    ];
    for (let i = 0; i < spine.length - 1; i++) {
      for (let t = 0; t <= 1; t += 0.1) {
        const x = spine[i].x + (spine[i + 1].x - spine[i].x) * t;
        const z = spine[i].z + (spine[i + 1].z - spine[i].z) * t;
        expect(terrainHeight(x, z, SEED), `spine ${x},${z}`).toBeGreaterThan(WATER_LEVEL);
      }
      // sample the along-path gradient at footstep scale
      const dx = spine[i + 1].x - spine[i].x;
      const dz = spine[i + 1].z - spine[i].z;
      const len = Math.hypot(dx, dz);
      for (let d = 0; d < len - 0.5; d += 0.5) {
        const x0 = spine[i].x + (dx * d) / len;
        const z0 = spine[i].z + (dz * d) / len;
        const x1 = spine[i].x + (dx * (d + 0.5)) / len;
        const z1 = spine[i].z + (dz * (d + 0.5)) / len;
        const rise = terrainHeight(x1, z1, SEED) - terrainHeight(x0, z0, SEED);
        expect(
          Math.abs(rise) / 0.5,
          `spine slope at ${x0.toFixed(0)},${z0.toFixed(0)}`,
        ).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      }
    }
  });

  it('leaves the interior sound fatigue-free (only the map edges drown)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.maxHp = 1000;
    p.hp = 1000;
    p.pos.x = -60;
    p.pos.z = 1320; // mid-sound, far from every edge
    p.pos.y = -5.2;
    p.prevPos = { ...p.pos };
    for (let t = 0; t < 20 * 6; t++) {
      sim.tick();
      p.pos.x = -60;
      p.pos.z = 1320;
    }
    expect(p.fatigueTicks).toBe(0);
    expect(p.hp).toBe(1000);
  });
});

describe('the storybook decor set (decorProps)', () => {
  const decor = REALM_PROPS.decorProps ?? [];

  it('has entries (the set is placed) and every one sits on dry land', () => {
    expect(decor.length).toBeGreaterThan(0);
    for (const d of decor) {
      if (d.z >= 960 && d.z <= 1262) {
        expect(hollowLandness(d.x, d.z), `${d.key} at ${d.x},${d.z} landness`).toBeGreaterThan(
          0.14,
        );
      }
      expect(terrainHeight(d.x, d.z, SEED), `${d.key} at ${d.x},${d.z} height`).toBeGreaterThan(
        WATER_LEVEL,
      );
    }
  });

  it('keeps every colliding prop clear of the road network', () => {
    // A collider straddling a road would wall the path players are funneled
    // down. Point-to-segment distance against every road polyline.
    function roadDistance(x: number, z: number): number {
      let best = Number.POSITIVE_INFINITY;
      for (const road of REALM_ROADS) {
        for (let i = 0; i < road.length - 1; i++) {
          const ax = road[i].x;
          const az = road[i].z;
          const dx = road[i + 1].x - ax;
          const dz = road[i + 1].z - az;
          const len2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
          const px = ax + dx * t - x;
          const pz = az + dz * t - z;
          best = Math.min(best, Math.hypot(px, pz));
        }
      }
      return best;
    }
    for (const d of decor) {
      if (!d.r) continue;
      expect(roadDistance(d.x, d.z), `${d.key} at ${d.x},${d.z} road clearance`).toBeGreaterThan(
        d.r + 1.2,
      );
    }
  });

  it('collider entries block live-sim movement; dressing does not', () => {
    // Walk straight at a pixie mushroom house: the circle collider must hold
    // the player outside its radius.
    const cottage = decor.find((d) => d.key === 'pixieMushroomHouse');
    if (!cottage?.r) throw new Error('expected a colliding pixieMushroomHouse entry');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.pos.x = cottage.x;
    p.pos.z = cottage.z + cottage.r + 4;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = Math.PI; // 0 faces +z; walk south into the cottage
    sim.moveInput.forward = true;
    let minDist = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 20 * 4; t++) {
      sim.tick();
      minDist = Math.min(minDist, Math.hypot(p.pos.x - cottage.x, p.pos.z - cottage.z));
    }
    expect(minDist).toBeGreaterThan(cottage.r - 0.1);

    // Walk clean across a glow-flower patch: r 0 dressing never blocks.
    const bed = decor.find((d) => d.key === 'flowerGlow' && !d.r);
    if (!bed) throw new Error('expected a walk-through flowerGlow entry');
    const sim2 = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p2 = sim2.player;
    p2.pos.x = bed.x;
    p2.pos.z = bed.z - 4;
    p2.pos.y = terrainHeight(p2.pos.x, p2.pos.z, SEED);
    p2.prevPos = { ...p2.pos };
    p2.facing = 0; // walk north across the bed
    sim2.moveInput.forward = true;
    for (let t = 0; t < 20 * 4; t++) sim2.tick();
    expect(p2.pos.z).toBeGreaterThan(bed.z + 2);
  });

  it('the great tree trunk blocks movement at its visual radius', () => {
    // The collider radius mirrors the rendered trunk's root flare, so a
    // player walking at the tree stops at the bark instead of wading in.
    const tree = REALM_PROPS.greatTrees?.[0];
    if (!tree) throw new Error('expected the Eldergleam great tree');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.pos.x = tree.x + tree.r + 4; // approach from the east, a clear lane
    p.pos.z = tree.z;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = -Math.PI / 2; // 0 faces +z; walk west into the trunk
    sim.moveInput.forward = true;
    let minDist = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 20 * 4; t++) {
      sim.tick();
      minDist = Math.min(minDist, Math.hypot(p.pos.x - tree.x, p.pos.z - tree.z));
    }
    expect(minDist).toBeGreaterThan(tree.r - 0.1);
  });
});

describe('the crystal cove ramp', () => {
  it('is walkable from the glade down to the cave shelf', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: VEILED_HOLLOW_TEST_WORLD });
    const p = sim.player;
    p.pos.x = 82;
    p.pos.z = 1174;
    p.pos.y = terrainHeight(82, 1174, SEED);
    p.prevPos = { ...p.pos };
    p.maxHp = 99999;
    p.hp = 99999;
    sim.moveInput.forward = true;
    const goal = { x: 100, z: 1163 };
    for (let s = 0; s < 14; s++) {
      p.facing = Math.atan2(goal.x - p.pos.x, goal.z - p.pos.z);
      for (let t = 0; t < 20; t++) sim.tick();
      if (Math.hypot(p.pos.x - goal.x, p.pos.z - goal.z) < 6) break;
    }
    expect(
      Math.hypot(p.pos.x - goal.x, p.pos.z - goal.z),
      `stuck at ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}`,
    ).toBeLessThan(6);
  });
});
