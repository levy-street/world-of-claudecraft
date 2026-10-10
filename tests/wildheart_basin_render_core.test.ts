// The Wildheart Basin renderer's pure cores (src/render/wildheart_basin/
// basin_plan_core.ts and basin_fx_core.ts): the waterfalls stand where the
// layout puts them and the Waterfall Walk's veil falls in front of its ledge
// without touching it, the rainbows face the sun and read from the Idol Maw,
// the water sits where the sim's floor says it should, the gates' motion
// curves run the right way, the lights stay inside the per-zone budget, and
// every telegraph draws the edge the sim tests (the three bosses' too:
// basin_boss_fx_core.ts, with their objects, auras, cord and eyes).
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  BASIN_AURA_LOOKS,
  BASIN_BOSS_TEMPLATES,
  BASIN_HEAD_MARKS,
  basinBossCastSpecs,
  bondCordStrength,
  bossBodyHeight,
  bossCastYaw,
  bossLaneLength,
  chargeLook,
  GORGE_MARK_RADIUS,
  glyphLook,
  headMarkLook,
  PLAYER_BODY_HEIGHT,
  podSwell,
  seedArcInto,
  shockRingLook,
} from '../src/render/wildheart_basin/basin_boss_fx_core';
import { BRAZIER_FIRE, fireInstanceCount } from '../src/render/wildheart_basin/basin_fire_core';
import {
  BASIN_OBJECT_SPECS,
  basinTelegraphSpecs,
  cloudPresence,
  entangleGrowth,
  jaguarEyesBurn,
  objectFill,
  STOMP_SHOCK_SECONDS,
  stompShock,
  TOTEM_PULSE_RADIUS,
  TOTEM_PULSE_SECONDS,
  totemPulse,
  VINE_ROOT_AURAS,
} from '../src/render/wildheart_basin/basin_fx_core';
import {
  BASIN_SUN_DIRECTION,
  BASIN_WATER,
  basinFloorAt,
  FORD_SHEET,
  fallPoint,
  fallWidth,
  JAGUAR_EYES,
  lightZoneOf,
  PLUNGE_POOL,
  planBasinFalls,
  planBasinLights,
  planBasinRainbows,
  planMoteSpots,
  planVineSegments,
  planWalkMask,
  riverStations,
  sunHorizontal,
  thornRise,
  VINE_BRIDGE_PATHS,
  vineWeaveGrowth,
  WALK_VEIL,
  wardCharge,
} from '../src/render/wildheart_basin/basin_plan_core';
import {
  IDOL_LANDING,
  RIM_FALLS,
  RIVER_FORD,
  WILDHEART_BASIN_ANCHORS,
  WILDHEART_HEIGHTS,
} from '../src/sim/content/wildheart_basin_layout';
import { MOBS } from '../src/sim/data';
import {
  BEAST_CALL_OF_THE_HUNT,
  BEAST_HEEL,
  BEAST_PIT_QUAKE,
  BEAST_STALKED,
  BEAST_TUNING,
  BEASTMASTER_ID,
  BLOOM_GORGE,
  BLOOM_POLLINATED,
  BLOOM_SEED_RAIN,
  BLOOM_TUNING,
  BLOOM_VINE_LASH,
  BLOOM_VINE_LASHED,
  bondReachFor,
  bondStrength,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  SAURIAN_TUNING,
  THORN_SPROUT_ID,
  WILDHEART_AMBUSH_MARK,
  WILDHEART_SEEDPOD,
  WILDHEART_SEEDPOD_RIPE,
  WILDHEART_SPORE_CLOUD,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_SUNSTRUCK,
  ZULGAR_TUNING,
} from '../src/sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_ENTANGLED,
  WILDHEART_ENTANGLING_LASH,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';

const falls = planBasinFalls();
const byId = (id: string) => {
  const f = falls.find((x) => x.id === id);
  if (!f) throw new Error(`no fall ${id}`);
  return f;
};

describe('the waterfalls', () => {
  it('draws every rim fall of the layout, the Walk veil and the ford spill', () => {
    expect(falls.map((f) => f.id).sort()).toEqual(
      [...RIM_FALLS.map((f) => f.id), 'walk_veil', 'ford_spill'].sort(),
    );
    for (const r of RIM_FALLS) {
      const f = byId(r.id);
      expect(fallWidth(f)).toBeCloseTo(r.width, 6);
      expect(f.top).toBe(r.topY);
      expect(f.bottom).toBe(r.bottomY);
      expect(Math.hypot(f.nx, f.nz)).toBeCloseTo(1, 9);
      // The lip is centred on the layout's point and the curtain faces its yaw.
      expect((f.ax + f.bx) / 2).toBeCloseTo(r.x, 6);
      expect((f.az + f.bz) / 2).toBeCloseTo(r.z, 6);
      expect(f.nx).toBeCloseTo(Math.sin(r.facing), 9);
      expect(f.nz).toBeCloseTo(Math.cos(r.facing), 9);
    }
  });

  it('lands every fall off the walkable floor (into the gorge or the plunge pool)', () => {
    for (const f of falls) {
      for (const u of [0.1, 0.5, 0.9]) {
        const [x, , z] = fallPoint(f, u, 1);
        expect(basinFloorAt(x, z), `${f.id} lands on a walkway at u=${u}`).toBeNull();
      }
    }
  });

  it('lets the party walk behind the veil: it falls in front of the ledge, never on it', () => {
    const veil = byId('walk_veil');
    // The ledge behind the falls runs z -24..0 at height 15; the veil spans it.
    expect(veil.az).toBeLessThanOrEqual(-24);
    expect(veil.bz).toBeGreaterThanOrEqual(0);
    expect(veil.top).toBeGreaterThan(WILDHEART_HEIGHTS.behindFalls + 20);
    expect(veil.bottom).toBeLessThan(WILDHEART_HEIGHTS.behindFalls);
    // Down its whole length the sheet stays west of the walkable ledge, with
    // a gap a body can stand in at the ledge's own height.
    for (let t = 0; t <= 1; t += 0.05) {
      for (const u of [0, 0.5, 1]) {
        const [x, y, z] = fallPoint(veil, u, t);
        expect(basinFloorAt(x, z), `veil over a walkway at t=${t}`).toBeNull();
        if (Math.abs(y - WILDHEART_HEIGHTS.behindFalls) < 3) expect(x).toBeLessThan(WALK_VEIL.x);
      }
    }
    // The ledge itself is walkable, just east of the lip.
    expect(basinFloorAt(WILDHEART_BASIN_ANCHORS.behindFalls.x, -12)).toBe(
      WILDHEART_HEIGHTS.behindFalls,
    );
  });
});

describe('the rainbows', () => {
  const bows = planBasinRainbows(falls);
  const [sx, sz] = sunHorizontal(BASIN_SUN_DIRECTION);

  it('stands one in the spray of every fall but the ford spill, facing the sun', () => {
    expect(bows.map((b) => b.fallId).sort()).toEqual(
      falls
        .filter((f) => f.kind !== 'spill')
        .map((f) => f.id)
        .sort(),
    );
    for (const b of bows) {
      expect(Math.sin(b.yaw)).toBeCloseTo(sx, 9);
      expect(Math.cos(b.yaw)).toBeCloseTo(sz, 9);
      expect(b.radius).toBeGreaterThan(4);
      expect(b.strength).toBeGreaterThan(0);
      expect(b.strength).toBeLessThanOrEqual(0.6);
      // On the sun's side of its fall's foot.
      const f = byId(b.fallId);
      expect((b.x - f.footX) * sx + (b.z - f.footZ) * sz).toBeGreaterThan(0);
    }
  });

  it('reads from the Idol Maw: the vista sees the face of every far fall bow', () => {
    for (const id of ['north_west', 'north_east', 'weeping']) {
      const b = bows.find((x) => x.fallId === id);
      expect(b).toBeDefined();
      if (!b) continue;
      const vx = IDOL_LANDING.x - b.x;
      const vz = IDOL_LANDING.z - b.z;
      expect(vx * Math.sin(b.yaw) + vz * Math.cos(b.yaw), id).toBeGreaterThan(0);
    }
  });

  it('keeps the sun low behind the maw (a gold afternoon, the bows toward the vista)', () => {
    const [x, y, z] = BASIN_SUN_DIRECTION;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(y).toBeGreaterThan(0.3);
    expect(y).toBeLessThan(0.7);
    expect(z).toBeLessThan(0);
  });
});

describe('the water', () => {
  it('lays the ford sheet over the ford box, a hand over its floor and under its banks', () => {
    expect([FORD_SHEET.x0, FORD_SHEET.x1, FORD_SHEET.z0, FORD_SHEET.z1]).toEqual([
      RIVER_FORD.x0,
      RIVER_FORD.x1,
      RIVER_FORD.z0,
      RIVER_FORD.z1,
    ]);
    expect(FORD_SHEET.y).toBeGreaterThan(RIVER_FORD.h);
    expect(FORD_SHEET.y - RIVER_FORD.h).toBeLessThan(0.5);
    expect(FORD_SHEET.y).toBeLessThan(WILDHEART_HEIGHTS.bank);
    expect(basinFloorAt(0, -110)).toBe(RIVER_FORD.h);
  });

  it('runs the river down the gorge, below every walkway', () => {
    const stations = riverStations(4);
    expect(stations.length).toBeGreaterThan(50);
    for (const s of stations) {
      expect(s.y).toBeLessThan(-20);
      expect(s.halfWidth).toBeGreaterThan(3);
      expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 6);
    }
    for (let i = 1; i < stations.length; i++)
      expect(stations[i].s).toBeGreaterThan(stations[i - 1].s);
  });

  it('sits the plunge pool under the Weeping Falls, below the terrace it borders', () => {
    const weeping = byId('weeping');
    expect(Math.hypot(PLUNGE_POOL.x - weeping.footX, PLUNGE_POOL.z - weeping.footZ)).toBeLessThan(
      PLUNGE_POOL.r,
    );
    expect(PLUNGE_POOL.y).toBe(BASIN_WATER.pool);
    expect(PLUNGE_POOL.y).toBeLessThan(WILDHEART_HEIGHTS.fallsTerrace);
  });

  it('masks the gorge haze off every walkway', () => {
    const size = 64;
    const mask = planWalkMask(size, 0);
    const at = (x: number, z: number): number => {
      const i = Math.floor(((x + 114) / 228) * size);
      const j = Math.floor(((z + 240) / 480) * size);
      return mask[j * size + i];
    };
    expect(at(0, -110)).toBe(1); // the ford
    expect(at(0, 16)).toBe(1); // the central island
    expect(at(60, -20)).toBe(0); // the gorge east of the island
  });

  it('scatters the motes on the walkable floor only', () => {
    for (const [x, y, z] of planMoteSpots(80, 17)) expect(basinFloorAt(x, z)).toBe(y);
  });
});

describe('the gates move the right way', () => {
  it('weaves a vine bridge from the ford end, every segment woven when open', () => {
    const n = 9;
    for (let i = 0; i < n; i++) {
      expect(vineWeaveGrowth(0, i, n)).toBe(0);
      expect(vineWeaveGrowth(1, i, n)).toBe(1);
    }
    // Mid-weave the ford end is further along than the far end.
    expect(vineWeaveGrowth(0.4, 0, n)).toBeGreaterThan(vineWeaveGrowth(0.4, n - 1, n));
    let last = -1;
    for (let o = 0; o <= 1; o += 0.05) {
      const g = vineWeaveGrowth(o, 4, n);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it('lays the woven segments on the bridge path, end to end', () => {
    for (const path of [VINE_BRIDGE_PATHS.west, VINE_BRIDGE_PATHS.east]) {
      const segs = planVineSegments(path, 4);
      let total = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const [ax, az, ah] = path[i];
        const [bx, bz, bh] = path[i + 1];
        total += Math.hypot(bx - ax, bz - az, bh - ah);
      }
      expect(segs.reduce((s, x) => s + x.length, 0)).toBeCloseTo(total, 6);
      expect(segs.map((s) => s.index)).toEqual(segs.map((_, i) => i));
      for (const s of segs) {
        expect(Math.hypot(s.dx, s.dy, s.dz)).toBeCloseTo(1, 9);
        expect(s.length).toBeGreaterThan(2);
        expect(s.length).toBeLessThan(6);
      }
      // The deck starts at the ford's height and ends at the far ledge's.
      expect(segs[0].y).toBeCloseTo(path[0][2], 6);
      expect(segs[segs.length - 1].y).toBeCloseTo(path[path.length - 1][2], 6);
    }
  });

  it('sinks the thorn hedge as it opens and stands it when shut or sealed', () => {
    expect(thornRise(0)).toBe(1);
    expect(thornRise(1)).toBeCloseTo(0, 9);
    let last = 2;
    for (let o = 0; o <= 1.0001; o += 0.05) {
      const r = thornRise(o);
      expect(r).toBeLessThanOrEqual(last);
      last = r;
    }
  });

  it('burns a ward full while shut and puts it out when open', () => {
    expect(wardCharge(0, 3)).toBe(1);
    expect(wardCharge(1, 3)).toBe(0);
    for (const t of [0.1, 0.7, 2.3]) expect(wardCharge(0.5, t)).toBeLessThanOrEqual(0.5);
  });
});

describe('the lights', () => {
  it('lights every brazier and keeps each light zone within eight live lights', () => {
    const spots = planBasinLights();
    expect(spots.length).toBeGreaterThanOrEqual(8);
    const perZone = new Map<string, number>();
    const add = (x: number, z: number) => {
      const zone = lightZoneOf(x, z) ?? 'none';
      perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
    };
    for (const s of spots) add(s.x, s.z);
    // One eye light between the jaguar's eyes, in the shrine zone.
    const eyeX = JAGUAR_EYES.reduce((a, e) => a + e.x, 0) / JAGUAR_EYES.length;
    const eyeZ = JAGUAR_EYES.reduce((a, e) => a + e.z, 0) / JAGUAR_EYES.length - 5;
    add(eyeX, eyeZ);
    for (const [zone, n] of perZone) expect(n, zone).toBeLessThanOrEqual(8);
    expect(perZone.get('shrine')).toBeGreaterThanOrEqual(5);
  });
});

describe('the telegraphs draw the sim edge', () => {
  const specs = basinTelegraphSpecs();
  const palette = new Set(Object.values(TELEGRAPH_THREAT_COLORS));

  it('turns the Tail Swipe behind the Saurian, 120 degrees and 12 yd', () => {
    const tail = specs[SAURIAN_TAIL_SWIPE];
    expect(tail.shape).toBe('cone');
    expect(tail.range).toBe(SAURIAN_TUNING.tailRange);
    expect(tail.arcDeg).toBe(SAURIAN_TUNING.tailArcDeg);
    expect(tail.yawOffset).toBeCloseTo(Math.PI, 9);
  });

  it('rings the Stomp at its full reach and the lash lane at the template', () => {
    const stomp = specs[SAURIAN_STOMP];
    expect(stomp.shape).toBe('ring');
    expect(stomp.range).toBe(SAURIAN_TUNING.stompRadius);
    const lash = specs[WILDHEART_ENTANGLING_LASH];
    const line = MOBS.vine_lasher?.trashKit?.line;
    expect(line).toBeDefined();
    expect(lash.shape).toBe('lane');
    expect(lash.range).toBe(line?.length);
    expect(lash.halfWidth).toBe(line?.halfWidth);
    expect(lash.yawOffset).toBe(0);
  });

  it('paints every shape in the threat palette (the colour is the threat)', () => {
    for (const [id, s] of Object.entries(specs)) expect(palette.has(s.color), id).toBe(true);
    for (const [id, s] of Object.entries(BASIN_OBJECT_SPECS))
      expect(palette.has(s.color), id).toBe(true);
    expect(specs[SAURIAN_STOMP].color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(specs[SAURIAN_TAIL_SWIPE].color).toBe(TELEGRAPH_THREAT_COLORS.danger);
  });

  it('shows the spore cloud from its first tick to its last', () => {
    const seconds = BASIN_OBJECT_SPECS[WILDHEART_SPORE_CLOUD].seconds;
    expect(seconds).toBe(MOBS.spore_toad?.trashKit?.deathCloud?.seconds);
    expect(cloudPresence(0.3, seconds)).toBe(1);
    expect(cloudPresence(seconds - 0.1, seconds)).toBeGreaterThan(0.35);
    expect(cloudPresence(seconds + 1, seconds)).toBeGreaterThan(0);
  });

  it('races the shock and the pulse out to their reach and fades them', () => {
    const shock = stompShock(STOMP_SHOCK_SECONDS);
    expect(shock.radius).toBeGreaterThanOrEqual(SAURIAN_TUNING.stompRadius);
    expect(shock.alpha).toBe(0);
    expect(stompShock(0).radius).toBeLessThan(SAURIAN_TUNING.stompRadius * 0.3);
    const pulse = totemPulse(TOTEM_PULSE_SECONDS);
    expect(pulse.radius).toBeCloseTo(TOTEM_PULSE_RADIUS, 6);
    expect(pulse.alpha).toBe(0);
    expect(TOTEM_PULSE_RADIUS).toBe(MOBS.sunbone_totem?.trashKit?.pulse?.radius);
    expect(entangleGrowth(0)).toBe(0);
    expect(entangleGrowth(1)).toBe(1);
  });
});

describe('the boss telegraphs draw the sim edge', () => {
  const specs = basinBossCastSpecs();
  const palette = new Set(Object.values(TELEGRAPH_THREAT_COLORS));

  it('gives every boss cast a spec sized from the sim tuning', () => {
    expect(Object.keys(specs).sort()).toEqual(
      [
        BEAST_PIT_QUAKE,
        BEAST_HEEL,
        BLOOM_SEED_RAIN,
        BLOOM_VINE_LASH,
        BLOOM_GORGE,
        ZULGAR_PULSE,
        ZULGAR_SPIRIT_HUNT,
      ].sort(),
    );
    const quake = specs[BEAST_PIT_QUAKE];
    expect(quake.shape).toBe('ring');
    expect(quake.range).toBe(BEAST_TUNING.quakeRadius);
    expect(quake.anchor).toBe('caster');
    const lash = specs[BLOOM_VINE_LASH];
    expect(lash.shape).toBe('lane');
    expect(lash.range).toBe(BLOOM_TUNING.lashLength);
    expect(lash.halfWidth).toBe(BLOOM_TUNING.lashHalfWidth);
    expect(lash.lockYaw).toBe(true);
    const pulse = specs[ZULGAR_PULSE];
    expect(pulse.shape).toBe('ring');
    expect(pulse.range).toBe(ZULGAR_TUNING.pulseRadius);
    // Gorge marks the tank, never the bloom.
    const gorge = specs[BLOOM_GORGE];
    expect(gorge.anchor).toBe('target');
    expect(gorge.range).toBe(GORGE_MARK_RADIUS);
    expect(gorge.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    // The charge-ups are cosmetic sigils, not floor hazards.
    expect(specs[BLOOM_SEED_RAIN].shape).toBe('charge');
    expect(specs[ZULGAR_SPIRIT_HUNT].shape).toBe('charge');
  });

  it('paints every boss hazard in the threat palette', () => {
    for (const [id, s] of Object.entries(specs)) {
      if (s.shape === 'charge') continue;
      expect(palette.has(s.color), id).toBe(true);
    }
    expect(specs[BEAST_PIT_QUAKE].color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(specs[ZULGAR_PULSE].color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(specs[BLOOM_VINE_LASH].color).toBe(TELEGRAPH_THREAT_COLORS.control);
    // A stun on the crouching jaguar stops the leap: the interrupt colour.
    expect(specs[BEAST_HEEL].color).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
  });

  it('runs the Heel! lane from the jaguar to its master, as long as they stand apart', () => {
    const heel = specs[BEAST_HEEL];
    expect(heel.shape).toBe('lane');
    expect(heel.reachToTarget).toBe(true);
    const jaguar = { x: 0, z: 0, facing: Math.PI };
    const master = { x: 6, z: 8 };
    const yaw = bossCastYaw(heel, jaguar, master, null);
    expect(Math.sin(yaw) * 10).toBeCloseTo(6, 6);
    expect(Math.cos(yaw) * 10).toBeCloseTo(8, 6);
    expect(bossLaneLength(heel, 10)).toBe(10);
    expect(bossLaneLength(heel, 23.5)).toBe(23.5);
    expect(bossLaneLength(heel, 0)).toBeGreaterThan(0);
  });

  it('locks the Vine Lash along the facing it had when the bar opened', () => {
    const lash = specs[BLOOM_VINE_LASH];
    const bloom = { x: 0, z: 0, facing: 2 };
    expect(bossCastYaw(lash, bloom, { x: 5, z: 0 }, 0.5)).toBe(0.5);
    expect(bossCastYaw(lash, bloom, null, null)).toBe(2);
    expect(bossLaneLength(lash, 3)).toBe(BLOOM_TUNING.lashLength);
  });

  it('brightens the charge sigil as its bar fills', () => {
    expect(chargeLook(1, 0).glow).toBeGreaterThan(chargeLook(0, 0).glow);
    expect(chargeLook(1, 0).alpha).toBe(1);
  });

  it('races a boss shock ring out to its reach and fades it', () => {
    const end = shockRingLook(0.8, ZULGAR_TUNING.pulseRadius, 0.8);
    expect(end.radius).toBeGreaterThanOrEqual(ZULGAR_TUNING.pulseRadius);
    expect(end.alpha).toBe(0);
    expect(shockRingLook(0, BEAST_TUNING.quakeRadius, 0.8).radius).toBeLessThan(
      BEAST_TUNING.quakeRadius * 0.3,
    );
  });
});

describe('the boss encounter objects', () => {
  const palette = new Set(Object.values(TELEGRAPH_THREAT_COLORS));

  it('lays a floor look for every encounter object, in the threat palette', () => {
    for (const id of [
      WILDHEART_SEEDPOD,
      WILDHEART_SEEDPOD_RIPE,
      WILDHEART_SUN_GLYPH_LIT,
      WILDHEART_SUN_GLYPH_DARK,
      WILDHEART_AMBUSH_MARK,
    ]) {
      const spec = BASIN_OBJECT_SPECS[id];
      expect(spec, id).toBeDefined();
      expect(palette.has(spec.color), id).toBe(true);
    }
  });

  it('fogs only the spore cloud', () => {
    for (const [id, s] of Object.entries(BASIN_OBJECT_SPECS))
      expect(s.fog, id).toBe(id === WILDHEART_SPORE_CLOUD);
  });

  it('keeps the glyphs, pods and the Ambush circle for as long as the sim does', () => {
    for (const id of [
      WILDHEART_SEEDPOD,
      WILDHEART_SEEDPOD_RIPE,
      WILDHEART_SUN_GLYPH_LIT,
      WILDHEART_SUN_GLYPH_DARK,
      WILDHEART_AMBUSH_MARK,
    ]) {
      const seconds = BASIN_OBJECT_SPECS[id].seconds;
      expect(seconds, id).toBe(Number.POSITIVE_INFINITY);
      expect(cloudPresence(600, seconds), id).toBe(1);
    }
  });

  it('sweeps a ripe pod over its last seconds and the Ambush over its warning', () => {
    const ripe = BASIN_OBJECT_SPECS[WILDHEART_SEEDPOD_RIPE];
    expect(ripe.fillSeconds).toBe(BLOOM_TUNING.podRipeFor);
    expect(objectFill(ripe, 0)).toBe(0);
    expect(objectFill(ripe, BLOOM_TUNING.podRipeFor / 2)).toBeCloseTo(0.5, 9);
    expect(objectFill(ripe, BLOOM_TUNING.podRipeFor)).toBe(1);
    const ambush = BASIN_OBJECT_SPECS[WILDHEART_AMBUSH_MARK];
    expect(ambush.fillSeconds).toBe(ZULGAR_TUNING.ambushWarning);
    expect(objectFill(ambush, ZULGAR_TUNING.ambushWarning)).toBe(1);
    // A fresh pod and a glyph are a rim to use, never a filling hazard.
    expect(objectFill(BASIN_OBJECT_SPECS[WILDHEART_SEEDPOD], 30)).toBe(0);
    expect(objectFill(BASIN_OBJECT_SPECS[WILDHEART_SUN_GLYPH_LIT], 30)).toBe(0);
    expect(objectFill(BASIN_OBJECT_SPECS[WILDHEART_SPORE_CLOUD], 0)).toBe(1);
    // A dark glyph burns low.
    expect(BASIN_OBJECT_SPECS[WILDHEART_SUN_GLYPH_DARK].fade).toBeLessThan(
      BASIN_OBJECT_SPECS[WILDHEART_SUN_GLYPH_LIT].fade,
    );
  });

  it('swells a pod as it nears sprouting and throbs it hard once ripe', () => {
    const fresh = podSwell(false, 0, 0);
    const old = podSwell(false, BLOOM_TUNING.podSprout - BLOOM_TUNING.podRipeFor, 0);
    expect(old.scale).toBeGreaterThan(fresh.scale);
    expect(old.glow).toBeGreaterThan(fresh.glow);
    let ripeMax = 0;
    let ripeMin = 9;
    for (let t = 0; t < 2; t += 0.01) {
      const r = podSwell(true, 1, t);
      ripeMax = Math.max(ripeMax, r.glow);
      ripeMin = Math.min(ripeMin, r.glow);
    }
    expect(ripeMin).toBeGreaterThanOrEqual(old.glow);
    expect(ripeMax - ripeMin).toBeGreaterThan(0.4);
  });

  it('lobs a seed from the bloom onto its pod', () => {
    const out = { x: 0, y: 0, z: 0 };
    const from = { x: 0, y: 8, z: 0 };
    const to = { x: 10, y: 0, z: 4 };
    expect(seedArcInto(out, from, to, 0, 6)).toEqual(from);
    expect(seedArcInto(out, from, to, 1, 6)).toEqual(to);
    expect(seedArcInto(out, from, to, 0.5, 6).y).toBeCloseTo(4 + 6, 9);
  });

  it('burns a lit glyph gold and lets a dark one smoulder', () => {
    expect(glyphLook(true, 0).lit).toBe(1);
    expect(glyphLook(false, 0).lit).toBe(0);
    expect(glyphLook(true, 0).halo).toBeGreaterThan(glyphLook(false, 0).halo);
  });
});

describe('the boss auras and bodies', () => {
  it('climbs the vines on a Vine Lash root exactly as on the trash lash', () => {
    expect(VINE_ROOT_AURAS).toContain(WILDHEART_ENTANGLED);
    expect(VINE_ROOT_AURAS).toContain(BLOOM_VINE_LASHED);
  });

  it('marks the Stalked and the Prey over the head, brighter on the chased prey', () => {
    expect(BASIN_HEAD_MARKS[BEAST_STALKED]).toBeDefined();
    expect(BASIN_HEAD_MARKS[ZULGAR_PREY]).toBeDefined();
    for (const t of [0, 0.3, 1.1]) {
      const chased = headMarkLook(ZULGAR_PREY, true, t);
      const waiting = headMarkLook(ZULGAR_PREY, false, t);
      expect(chased.alpha).toBeGreaterThan(waiting.alpha);
      expect(chased.size).toBeGreaterThan(waiting.size);
      expect(chased.color).not.toBe(waiting.color);
    }
    expect(headMarkLook('nothing', true, 0).alpha).toBe(0);
  });

  it('dresses the pollen, the hunt, the avatar and the sunstrike', () => {
    expect(BASIN_AURA_LOOKS[BLOOM_POLLINATED]?.motes).toBeDefined();
    expect(BASIN_AURA_LOOKS[BEAST_CALL_OF_THE_HUNT]?.glow).toBeDefined();
    expect(BASIN_AURA_LOOKS[ZULGAR_AVATAR]?.motes?.trail).toBe(true);
    expect(BASIN_AURA_LOOKS[ZULGAR_SUNSTRUCK]?.glow).toBeDefined();
  });

  it('burns the spirit cord brighter as master and jaguar close, faint at the edge', () => {
    expect(bondCordStrength(0)).toBe(1);
    expect(bondCordStrength(4)).toBeGreaterThan(bondCordStrength(12));
    expect(bondCordStrength(4)).toBe(bondStrength(4, bondReachFor(false)));
    // Past the normal reach the aura can only be heroic's Frenzied Bond: faint, never dark.
    expect(bondCordStrength(BEAST_TUNING.heroicBondReach - 1)).toBeGreaterThan(0);
    expect(bondCordStrength(Number.NaN)).toBe(0);
  });

  it('draws bodies at their drawn heights and names every basin boss', () => {
    for (const id of [
      BEASTMASTER_ID,
      FANGLORD_JAGUAR_ID,
      GORGEBLOOM_ID,
      ZULGAR_ID,
      THORN_SPROUT_ID,
    ]) {
      expect(BASIN_BOSS_TEMPLATES.has(id), id).toBe(true);
      expect(MOBS[id], id).toBeDefined();
    }
    // The Gorgebloom's art-guide body stands 6.1 yd at its 2.8 (the raised back petal).
    expect(bossBodyHeight(GORGEBLOOM_ID, MOBS[GORGEBLOOM_ID]?.scale ?? 1)).toBeCloseTo(6.1, 1);
    expect(bossBodyHeight('someone', 1)).toBe(PLAYER_BODY_HEIGHT);
  });

  it('lights the stone jaguar eyes: a gleam, a smoulder in the fight, full fire in the hunt', () => {
    for (const t of [0, 0.4, 1.7, 3.3]) {
      const idle = jaguarEyesBurn('idle', t);
      const fight = jaguarEyesBurn('fight', t);
      const hunt = jaguarEyesBurn('hunt', t);
      expect(fight).toBeGreaterThan(idle);
      expect(hunt).toBeGreaterThan(fight);
      expect(hunt).toBeLessThanOrEqual(1);
      expect(hunt).toBeGreaterThanOrEqual(0.88);
    }
  });
});

describe('the brazier fires', () => {
  it('burn tongues, a core and embers, thinner on the low tier but never out', () => {
    const full = fireInstanceCount(false);
    const low = fireInstanceCount(true);
    expect(full.total).toBe(full.tongues + full.cores + full.embers);
    expect(low.tongues).toBeGreaterThan(0);
    expect(low.cores).toBeGreaterThan(0);
    expect(low.total).toBeLessThan(full.total);
    expect(BRAZIER_FIRE.tongue).toBeGreaterThan(0.8);
  });
});
