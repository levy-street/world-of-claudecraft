// The Drowned Gate Tower's cosmetic layer: the pure plan
// (sunken_bastion_entrance_core.ts: the Fogbeacon's turn, the flooded
// passage's trace, the marsh fog, the gate sprites) and the painter's contract
// (sunken_bastion_entrance.ts: one point light whose base follows the pulse,
// one cull group, the passage window as one opaque draw, one instanced fog
// draw and one instanced additive sprite draw on the shared clock, the floor
// ladder, the stand-in when no GLB loaded). Three.js runs headless in Node.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveUiEffectsProfile } from '../src/game/ui_effects_profile';
import { setDayNightPhaseOverride } from '../src/render/day_night_clock';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { GFX, sharedUniforms } from '../src/render/gfx';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  clearSetPieceOccluders,
  setPieceOccludersInternalsForTest,
  updateSetPieceOccluders,
} from '../src/render/set_piece_occluders';
import {
  BASTION_FOG_PROGRAM_CACHE_KEY,
  BASTION_PASSAGE_PROGRAM_CACHE_KEY,
  BASTION_SPRITE_PROGRAM_CACHE_KEY,
  buildSunkenBastionEntrance,
  sunkenBastionEntranceInternalsForTest,
} from '../src/render/sunken_bastion_entrance';
import {
  BASTION_BEACON,
  BASTION_DRIP_SOURCES,
  BASTION_FOG_FIELDS,
  BASTION_FOG_NEAR,
  BASTION_GATE_SHAFTS,
  BASTION_MARSH_FIELDS,
  BASTION_PASSAGE,
  BASTION_PUDDLES,
  BASTION_PULSE_LIGHT,
  BASTION_ROSETTE,
  BASTION_SPRITE_KIND,
  type BastionEffectsTier,
  type BastionFogPose,
  type BastionPassageHit,
  type BastionSpritePose,
  bastionBeaconBearing,
  bastionBeaconDirection,
  bastionDripFallTime,
  bastionFogNearFade,
  bastionFogPose,
  bastionFogPuff,
  bastionFogPuffCount,
  bastionFogStrength,
  bastionGatePulse,
  bastionGrilleSolid,
  bastionNightAmount,
  bastionOccluderSet,
  bastionPassageEye,
  bastionPassageGhostFade,
  bastionPassageGlow,
  bastionPassageLight,
  bastionPassageTrace,
  bastionPulseLightIntensity,
  bastionSpritePose,
  bastionSprites,
} from '../src/render/sunken_bastion_entrance_core';
import { DUNGEONS } from '../src/sim/data';
import {
  SUNKEN_BASTION_ENTRANCE_COLLIDERS,
  SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH,
  SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH,
  sunkenBastionEntranceColliders,
} from '../src/sim/sunken_bastion_entrance';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;
const TIERS: readonly BastionEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const K = BASTION_SPRITE_KIND;
const P = BASTION_PASSAGE;
const hit: BastionPassageHit = { kind: 'far', t: 0, x: 0, y: 0, z: 0 };
/** A plain sloping ground for the sprite plan: the knoll's own fall, roughly. */
const slope = (lx: number, lz: number) => 0.47 * lz - 0.2 * lx;

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

afterEach(() => setDayNightPhaseOverride(null));

describe('the night gate', () => {
  it('nothing of the night at noon, all of it at midnight, and dusk is on the way', () => {
    expect(bastionNightAmount(0.5)).toBe(0);
    expect(bastionNightAmount(0)).toBe(1);
    const dusk = bastionNightAmount(0.77);
    expect(dusk).toBeGreaterThan(0.2);
    expect(dusk).toBeLessThan(0.8);
    expect(bastionNightAmount(0.85)).toBeGreaterThan(dusk);
    // the fog never leaves: it reads at noon and thickens after dark
    expect(bastionFogStrength(0)).toBeGreaterThan(0.5);
    expect(bastionFogStrength(1)).toBe(1);
  });
});

describe("the Fogbeacon's turn", () => {
  it('the beam turns once a period and bears south, down the road, at the start of each', () => {
    expect(bastionBeaconBearing(0, 1)).toBe(0);
    expect(bastionBeaconBearing(BASTION_BEACON.period / 4, 1)).toBeCloseTo(Math.PI / 2, 9);
    expect(bastionBeaconBearing(BASTION_BEACON.period * 3, 1)).toBeCloseTo(0, 9);
    const d = { x: 0, y: 0, z: 0 };
    bastionBeaconDirection(0, d);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.z).toBeLessThan(-0.9);
    expect(d.y).toBeGreaterThan(0.2);
    for (let i = 0; i < 16; i++) {
      bastionBeaconDirection((i / 16) * Math.PI * 2, d);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      // it always climbs: the beam passes over the towers, never through the road
      expect(d.y).toBeCloseTo(Math.sin(BASTION_BEACON.pitch), 9);
    }
    // its foot is hidden behind the knoll, north of the gate and under the door's height
    expect(BASTION_BEACON.lz).toBeGreaterThan(30);
    expect(BASTION_BEACON.y).toBeLessThan(0);
  });

  it('the gate holds a low breathing rest and crests once a turn, when the beam bears on the road', () => {
    const period = BASTION_BEACON.period;
    expect(bastionGatePulse(0, 1)).toBeCloseTo(1, 9);
    expect(bastionGatePulse(period, 1)).toBeCloseTo(1, 6);
    expect(bastionGatePulse(period * 5, 1)).toBeCloseTo(1, 6);
    let low = Infinity;
    let high = -Infinity;
    let above = 0;
    const steps = 1400;
    for (let i = 0; i < steps; i++) {
      const v = bastionGatePulse((i / steps) * period, 1);
      low = Math.min(low, v);
      high = Math.max(high, v);
      if (v > 0.5) above++;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(high).toBeCloseTo(1, 6);
    expect(low).toBeLessThan(0.2);
    expect(low).toBeGreaterThan(0.05);
    // the crest is a moment, not a state: under a fifth of the turn
    expect(above / steps).toBeLessThan(0.2);
    expect(above / steps).toBeGreaterThan(0.05);
    // half way round the gate is at rest
    const half = bastionGatePulse(period / 2, 1);
    expect(half).toBeLessThan(BASTION_BEACON.rest + BASTION_BEACON.breath + 1e-9);
    expect(half).toBeGreaterThan(BASTION_BEACON.rest - BASTION_BEACON.breath - 1e-9);
  });

  it('reduced motion holds the pulse still at one value, and the light follows the pulse', () => {
    for (const t of [0, 3.3, 7, 100.5]) {
      expect(bastionGatePulse(t, 0)).toBe(BASTION_BEACON.still);
    }
    expect(bastionPulseLightIntensity(0)).toBe(BASTION_PULSE_LIGHT.rest);
    expect(bastionPulseLightIntensity(1)).toBe(BASTION_PULSE_LIGHT.crest);
    // the rest level is a real uplight on the court at night, the crest three times it
    expect(BASTION_PULSE_LIGHT.rest).toBeGreaterThan(1.5);
    expect(BASTION_PULSE_LIGHT.crest).toBeGreaterThan(BASTION_PULSE_LIGHT.rest * 3);
    // the light stands in the gate court, in front of the door, inside the lane
    expect(BASTION_PULSE_LIGHT.lz).toBeLessThan(0);
    expect(BASTION_PULSE_LIGHT.lz).toBeGreaterThan(-2.4);
    expect(Math.abs(BASTION_PULSE_LIGHT.lx)).toBeLessThan(SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH);
  });
});

describe('the flooded passage behind the door', () => {
  it('fills the door lane, in the inner arch, behind the flood sill', () => {
    expect(P.half).toBe(SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH);
    const pier = SUNKEN_BASTION_ENTRANCE_COLLIDERS.find((r) => r.name === 'door_pier_w');
    const sill = SUNKEN_BASTION_ENTRANCE_COLLIDERS.find((r) => r.name === 'flood_sill');
    if (!pier || !sill) throw new Error('missing collider rows');
    // the window stands inside the piers' own depth (the arch's reveal)...
    expect(P.z).toBeGreaterThan(0);
    expect(P.z).toBeLessThanOrEqual(pier.lz + (pier.hd ?? 0));
    // ...and behind the front of the closed sill, so no body ever stands past it
    expect(P.z).toBeGreaterThan(sill.lz - (sill.hd ?? 0));
    // the water brims just under the kerb; the vault is the passage's own barrel
    expect(P.water).toBeLessThan(P.kerb);
    expect(P.kerb - P.water).toBeLessThan(0.3);
    expect(P.spring).toBeGreaterThan(P.water + 2);
    // the door arch is about twice a 1.8 yd character
    expect(P.spring + P.half).toBeGreaterThan(3.6);
    expect(P.spring + P.half).toBeLessThan(4.4);
    expect(P.far).toBeGreaterThan(P.grille + 15);
  });

  it('a level ray reaches the far light; a ray looking down finds the water where it should', () => {
    // (over the drowned grille's top, which stands 1.75 out of the water)
    const level = { ...bastionPassageTrace(0, 2.5, P.z, 0, 0, 1, true, hit) };
    expect(level.kind).toBe('far');
    expect(level.t).toBeCloseTo(P.far - P.z, 9);
    const d = norm(0, -0.5, 1);
    const down = { ...bastionPassageTrace(0.3, 2.2, P.z, ...d, true, hit) };
    expect(down.kind).toBe('water');
    expect(down.y).toBeCloseTo(P.water, 9);
    expect(down.t).toBeCloseTo((2.2 - P.water) / -d[1], 9);
    expect(down.z).toBeGreaterThan(P.z);
    // the reflected ray's trace never meets the water again
    expect(bastionPassageTrace(0.3, P.water, 3, ...norm(0, 0.5, 1), false, hit).kind).not.toBe(
      'water',
    );
    expect(bastionPassageTrace(0.3, 1.5, 3, ...norm(0, -0.5, 1), false, hit).kind).not.toBe(
      'water',
    );
  });

  it('glancing rays find the walls below the springing and the barrel above it', () => {
    const east = { ...bastionPassageTrace(0, 1.5, P.z, ...norm(-1, 0, 0.5), true, hit) };
    expect(east.kind).toBe('wall');
    expect(east.x).toBeCloseTo(-P.half, 9);
    const west = { ...bastionPassageTrace(0, 1.5, P.z, ...norm(1, 0.1, 0.5), true, hit) };
    expect(west.kind).toBe('wall');
    expect(west.x).toBeCloseTo(P.half, 9);
    const up = { ...bastionPassageTrace(0.2, 2.6, P.z, ...norm(0.3, 0.6, 1), true, hit) };
    expect(up.kind).toBe('vault');
    // the hit point lies on the barrel: its own half width from the springing line
    expect(Math.hypot(up.x, up.y - P.spring)).toBeCloseTo(P.half, 6);
    expect(up.y).toBeGreaterThanOrEqual(P.spring);
  });

  it('nothing escapes the passage: every ray from the window ends on a surface within reach', () => {
    const kinds = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const ox = Math.sin(k * 1.7) * (P.half - 0.05);
      const oy = P.kerb + 0.05 + (k % 13) * 0.22;
      if (oy > P.spring && Math.hypot(ox, oy - P.spring) > P.half - 0.05) continue;
      const d = norm(Math.sin(k * 0.9) * 0.8, Math.cos(k * 1.3) * 0.7, 0.15 + (k % 7) * 0.25);
      const r = bastionPassageTrace(ox, oy, P.z, ...d, true, hit);
      kinds.add(r.kind);
      expect(r.t, `ray ${k}`).toBeGreaterThan(0);
      expect(r.t, `ray ${k}`).toBeLessThanOrEqual((P.far - P.z) / d[2] + 1e-6);
      expect(Math.abs(r.x), `ray ${k}`).toBeLessThanOrEqual(P.half + 1e-6);
      expect(r.y, `ray ${k}`).toBeGreaterThanOrEqual(P.water - 1e-6);
      expect(r.z, `ray ${k}`).toBeLessThanOrEqual(P.far + 1e-6);
    }
    // (the far light is only met by rays near the passage's own axis: the test above)
    expect([...kinds].sort()).toEqual(['grille', 'vault', 'wall', 'water']);
  });

  it('the drowned grille stands half out of the water: bars and two rails, open between, nothing above', () => {
    const top = (x: number) => P.water + P.grilleRise + P.grilleTilt * x;
    // on a bar's centre line, anywhere under the top
    expect(bastionGrilleSolid(0, P.water + 0.3)).toBe(true);
    expect(bastionGrilleSolid(P.barPitch, top(P.barPitch) - 0.6)).toBe(true);
    // between two bars, between the rails: open
    expect(bastionGrilleSolid(P.barPitch / 2, top(P.barPitch / 2) - 0.6)).toBe(false);
    // the top rail closes the gap between bars
    expect(bastionGrilleSolid(P.barPitch / 2, top(P.barPitch / 2) - 0.22)).toBe(true);
    // over the top there is no iron
    expect(bastionGrilleSolid(0, top(0) + 0.05)).toBe(false);
    // it hangs crooked
    expect(top(1)).not.toBe(top(-1));
    // a ray down the middle is stopped by a bar, one beside it passes to the light
    expect(bastionPassageTrace(0, 1.2, P.z, 0, 0, 1, true, hit).kind).toBe('grille');
    expect(bastionPassageTrace(P.barPitch / 2, 1.2, P.z, 0, 0, 1, true, hit).kind).toBe('far');
  });

  it('the passage is drawn for an eye that never stands under the sill, and its light never goes out', () => {
    const floor = P.kerb + P.eye;
    // a climber far down the road, a rider, and a camera over the gate
    expect(bastionPassageEye(-6)).toBe(floor);
    expect(bastionPassageEye(floor - 0.01)).toBe(floor);
    expect(bastionPassageEye(3.4)).toBe(3.4);
    // from the floor eye, ten yards off, the waterline falls in the lower third of the opening
    const sill = P.kerb;
    const crown = P.spring + P.half;
    let waterline: number = sill;
    for (let y = sill + 0.02; y < crown; y += 0.02) {
      const d = norm(0, y - floor, 10.5);
      if (bastionPassageTrace(0.21, y, P.z, ...d, true, hit).kind !== 'water') break;
      waterline = y;
    }
    const share = (waterline - sill) / (crown - sill);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
    expect(bastionPassageLight(0)).toBe(P.restGlow);
    expect(bastionPassageLight(1)).toBeCloseTo(1, 9);
    expect(P.restGlow).toBeGreaterThan(0.25);
    expect(P.restGlow).toBeLessThan(0.5);
  });

  it("the beacon's light on the passage falls with the distance from its far end and scales with the pulse", () => {
    expect(bastionPassageGlow(P.far, 1)).toBeCloseTo(1.6, 9);
    expect(bastionPassageGlow(P.far - 10, 1)).toBeLessThan(bastionPassageGlow(P.far, 1));
    expect(bastionPassageGlow(P.z, 1)).toBeGreaterThan(0.15);
    expect(bastionPassageGlow(P.z, 1)).toBeLessThan(0.5);
    expect(bastionPassageGlow(12, 0.25)).toBeCloseTo(bastionPassageGlow(12, 1) * 0.25, 9);
  });
});

describe('the marsh fog', () => {
  it('the shares add up, the gate field pours down the road, and the count follows the static tier', () => {
    expect(BASTION_FOG_FIELDS.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1, 9);
    const gate = BASTION_FOG_FIELDS[0];
    expect(gate.name).toBe('gate');
    // born in the court, inside the outer arch
    expect(Math.abs(gate.ox) + gate.rx).toBeLessThanOrEqual(
      SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH,
    );
    expect(gate.oz).toBeGreaterThan(-3);
    expect(gate.oz).toBeLessThan(0);
    // it runs south and a little east, the way the road falls
    expect(gate.dz).toBeLessThan(-8);
    expect(gate.dx).toBeLessThan(0);
    expect(gate.lit).toBe(1);
    const counts = TIERS.map(bastionFogPuffCount);
    expect(counts).toEqual([18, 34, 52, 70]);
    for (const f of BASTION_FOG_FIELDS) {
      expect(f.size).toBeGreaterThan(2);
      expect(f.lit).toBeGreaterThanOrEqual(0);
      expect(f.lit).toBeLessThanOrEqual(1);
    }
  });

  it('every field gets its puffs on every tier, deterministically', () => {
    for (const tier of TIERS) {
      const n = bastionFogPuffCount(tier);
      const fields = new Set<number>();
      for (let i = 0; i < n; i++) {
        const p = bastionFogPuff(i, n);
        fields.add(p.field);
        expect(bastionFogPuff(i, n)).toEqual(p);
        const f = BASTION_FOG_FIELDS[p.field];
        expect(Math.hypot((p.ox - f.ox) / f.rx, (p.oz - f.oz) / f.rz)).toBeLessThanOrEqual(
          1 + 1e-9,
        );
        expect(p.speed).toBeGreaterThan(0.02);
        expect(p.speed).toBeLessThan(0.06);
        expect(p.lit).toBe(f.lit);
      }
      expect(fields.size, tier).toBe(BASTION_FOG_FIELDS.length);
    }
  });

  it('a puff is born clear, drifts along its lane growing, dies clear, and stands still under reduced motion', () => {
    const pose: BastionFogPose = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
    const n = bastionFogPuffCount('high');
    const puff = bastionFogPuff(0, n);
    const birth = (1 - puff.phase) / puff.speed;
    expect(bastionFogPose(puff, birth + 1e-6, 1, pose).alpha).toBeLessThan(0.01);
    const early = { ...bastionFogPose(puff, birth + 0.3 / puff.speed, 1, pose) };
    const late = { ...bastionFogPose(puff, birth + 0.5 / puff.speed, 1, pose) };
    expect(early.alpha).toBeGreaterThan(0.9);
    expect(late.scale).toBeGreaterThan(early.scale);
    expect(late.t).toBeGreaterThan(early.t);
    // the gate field's puff has gone down the road
    expect(late.z).toBeLessThan(early.z);
    expect(bastionFogPose(puff, birth + 0.999 / puff.speed, 1, pose).alpha).toBeLessThan(0.01);
    const held = { ...bastionFogPose(puff, 5, 0, pose) };
    expect(bastionFogPose(puff, 500, 0, pose)).toEqual(held);
    expect(held.t).toBeCloseTo(puff.phase, 9);
  });
});

describe('the gate sprites', () => {
  const kindCount = (tier: BastionEffectsTier, kind: number) =>
    bastionSprites(tier, slope).filter((s) => s.kind === kind).length;

  it("the door's own cues draw on every tier; the tier only thins the dressing", () => {
    for (const tier of TIERS) {
      expect(kindCount(tier, K.roseCore), tier).toBe(1);
      expect(kindCount(tier, K.pool), tier).toBe(1);
      expect(kindCount(tier, K.gateShaft), tier).toBe(BASTION_GATE_SHAFTS.length);
      expect(kindCount(tier, K.mouth), tier).toBeGreaterThanOrEqual(1);
      expect(kindCount(tier, K.drip), tier).toBeGreaterThanOrEqual(3);
    }
    // low sheds the sky beam, the rosette's shafts, the marsh lights and the puddle rings
    expect(kindCount('low', K.skyBeam)).toBe(0);
    expect(kindCount('low', K.roseShaft)).toBe(0);
    expect(kindCount('low', K.marshLight)).toBe(0);
    expect(kindCount('low', K.mouth)).toBe(2);
    expect(kindCount('ultra', K.skyBeam)).toBe(1);
    expect(kindCount('ultra', K.roseShaft)).toBe(3);
    expect(kindCount('ultra', K.mouth)).toBe(3);
    expect(TIERS.map((t) => kindCount(t, K.marshLight))).toEqual([0, 5, 9, 13]);
    expect(kindCount('ultra', K.drip)).toBe(BASTION_DRIP_SOURCES.length);
    expect(kindCount('medium', K.drip)).toBeLessThan(kindCount('ultra', K.drip));
    expect(kindCount('low', K.drip)).toBeLessThan(kindCount('medium', K.drip));
    const sizes = TIERS.map((t) => bastionSprites(t, slope).length);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    // the whole layer is a handful of quads even on ultra
    expect(sizes[3]).toBeLessThan(64);
  });

  it('the build tables are in: the drips hang from the portcullis over the lane, the puddles lie at the wall foot', () => {
    expect(BASTION_DRIP_SOURCES.length).toBeGreaterThanOrEqual(9);
    const spikes = BASTION_DRIP_SOURCES.filter(([, , z]) => z < -3);
    expect(spikes.length).toBeGreaterThanOrEqual(9);
    for (const [x, y] of spikes) {
      expect(Math.abs(x)).toBeLessThan(SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH);
      // the spikes hang well over a mounted rider's head (the lane's ground
      // under the outer arch lies about 1.4 below the door)
      expect(y).toBeGreaterThan(1.6);
      expect(y).toBeLessThan(2.6);
    }
    expect(BASTION_PUDDLES.length).toBeGreaterThanOrEqual(3);
    expect(BASTION_ROSETTE.y).toBeGreaterThan(6);
    expect(BASTION_ROSETTE.lz).toBeLessThan(-3);
  });

  it('a drop falls from its iron to the ground under it, then its ring opens and fades', () => {
    const pose: BastionSpritePose = { x: 0, y: 0, z: 0, alpha: 0 };
    const sprites = bastionSprites('ultra', slope);
    const drip = sprites.find((s) => s.kind === K.drip);
    const ring = sprites.find((s) => s.kind === K.ring && s.range > 0.3);
    if (!drip || !ring) throw new Error('missing sprite');
    // the first drop and its ring share one clock
    expect(ring.phase).toBe(drip.phase);
    expect(ring.speed).toBe(drip.speed);
    expect(ring.range).toBe(drip.range);
    const fall = bastionDripFallTime(drip.range);
    expect(fall).toBeGreaterThan(0.3);
    expect(fall).toBeLessThan(1.2);
    const start = (1 - drip.phase) / drip.speed;
    const a = { ...bastionSpritePose(drip, start + fall * 0.3, 0, 1, 0.2, pose) };
    const b = { ...bastionSpritePose(drip, start + fall * 0.9, 0, 1, 0.2, pose) };
    expect(a.alpha).toBeGreaterThan(0.5);
    expect(a.y).toBeLessThan(drip.y);
    expect(b.y).toBeLessThan(a.y);
    // it lands on the ring's own ground, never under it
    const landed = bastionSpritePose(drip, start + fall * 0.999, 0, 1, 0.2, pose).y;
    expect(landed).toBeGreaterThanOrEqual(ring.y - 0.1);
    expect(landed - ring.y).toBeLessThan(0.2);
    expect(bastionSpritePose(drip, start + fall + 0.2, 0, 1, 0.2, pose).alpha).toBe(0);
    // the ring: nothing while the drop is in the air, then it shows and dies away
    expect(bastionSpritePose(ring, start + fall * 0.5, 0, 1, 0.2, pose).alpha).toBe(0);
    const fresh = bastionSpritePose(ring, start + fall + 0.05, 0, 1, 0.2, pose).alpha;
    const old = bastionSpritePose(ring, start + fall + 1.5, 0, 1, 0.2, pose).alpha;
    expect(fresh).toBeGreaterThan(0.8);
    expect(old).toBeLessThan(fresh * 0.2);
    // the ring lies on the slope under it
    expect(ring.dz).toBeCloseTo(0.47, 6);
    expect(ring.dx).toBeCloseTo(-0.2, 6);
  });

  it("the beacon's cues follow the pulse; the night's cues follow the night", () => {
    const pose: BastionSpritePose = { x: 0, y: 0, z: 0, alpha: 0 };
    const sprites = bastionSprites('ultra', slope);
    const one = (kind: number) => {
      const s = sprites.find((sp) => sp.kind === kind);
      if (!s) throw new Error(`no sprite ${kind}`);
      return s;
    };
    for (const kind of [K.pool, K.gateShaft, K.mouth]) {
      const s = one(kind);
      const rest = bastionSpritePose(s, 3, 0, 1, 0.14, pose).alpha;
      const crest = bastionSpritePose(s, 3, 0, 1, 1, pose).alpha;
      expect(crest, `kind ${kind}`).toBeGreaterThan(0.45);
      expect(rest, `kind ${kind}`).toBeLessThan(crest * 0.2);
    }
    // the gate's flash is for noon too
    expect(bastionSpritePose(one(K.gateShaft), 3, 0, 1, 1, pose).alpha).toBeGreaterThan(0.5);
    // the far glow over the knoll is almost all night
    const glows = sprites.filter((s) => s.kind === K.mouth);
    const sky = glows.find((s) => s.size > 20);
    const mouth = glows.find((s) => s.size < 20);
    if (!sky || !mouth) throw new Error('missing glow');
    expect(bastionSpritePose(sky, 3, 0, 1, 1, pose).alpha).toBeLessThan(0.2);
    expect(bastionSpritePose(sky, 3, 1, 1, 1, pose).alpha).toBeCloseTo(1, 9);
    expect(bastionSpritePose(mouth, 3, 0, 1, 1, pose).alpha).toBeGreaterThan(0.6);
    // the rosette's core never goes out; its shafts and the marsh lights are the night's
    // (a small one: the glass itself carries the colour, the core only crowns it)
    expect(bastionSpritePose(one(K.roseCore), 3, 0, 1, 0.14, pose).alpha).toBeGreaterThan(0.1);
    expect(bastionSpritePose(one(K.roseCore), 3, 1, 1, 0.14, pose).alpha).toBeGreaterThan(0.2);
    expect(bastionSpritePose(one(K.roseCore), 3, 1, 1, 0.14, pose).alpha).toBeLessThan(0.45);
    // the court's own glow stands between turns at night, behind the portcullis
    const court = glows.find((s) => s.dx > 0);
    if (!court) throw new Error('no court glow');
    expect(court.z).toBeGreaterThan(-3);
    expect(court.z).toBeLessThan(0);
    expect(bastionSpritePose(court, 3, 1, 1, 0.14, pose).alpha).toBeGreaterThan(0.4);
    expect(bastionSpritePose(court, 3, 0, 1, 0.14, pose).alpha).toBeLessThan(0.2);
    expect(bastionSpritePose(one(K.roseShaft), 3, 0, 1, 1, pose).alpha).toBe(0);
    expect(bastionSpritePose(one(K.roseShaft), 3, 1, 1, 1, pose).alpha).toBeGreaterThan(0.3);
    const lights = sprites.filter((s) => s.kind === K.marshLight);
    let moved = 0;
    for (const light of lights) {
      expect(bastionSpritePose(light, 12, 0, 1, 0.2, pose).alpha).toBe(0);
      const inField = BASTION_MARSH_FIELDS.some(
        (f) => light.x >= f.x0 && light.x <= f.x1 && light.z >= f.z0 && light.z <= f.z1,
      );
      expect(inField).toBe(true);
      // no marsh light drifts in the road's own lane or the gate court
      expect(Math.abs(light.x) < 2.2 && light.z > -14 && light.z < 0.5).toBe(false);
      const a = { ...bastionSpritePose(light, 10, 1, 1, 0.2, pose) };
      const b = { ...bastionSpritePose(light, 40, 1, 1, 0.2, pose) };
      if (Math.hypot(a.x - b.x, a.z - b.z) > 0.05) moved++;
      expect(Math.hypot(b.x - light.x, b.z - light.z)).toBeLessThanOrEqual(light.range * 1.5);
      const held = { ...bastionSpritePose(light, 10, 1, 0, 0.2, pose) };
      const later = bastionSpritePose(light, 400, 1, 0, 0.2, pose);
      expect([later.x, later.y, later.z]).toEqual([held.x, held.y, held.z]);
    }
    expect(moved).toBeGreaterThan(lights.length / 2);
  });

  it('the shafts point where they should: the gate shaft out under the portcullis and down the road', () => {
    const sprites = bastionSprites('ultra', slope);
    for (const s of sprites.filter((sp) => sp.kind === K.gateShaft)) {
      expect(Math.hypot(s.dx, s.dy, s.dz)).toBeCloseTo(1, 9);
      expect(s.dz).toBeLessThan(-0.5);
      expect(s.dy).toBeLessThan(0);
      expect(s.range).toBeGreaterThan(6);
      expect(s.spread).toBeGreaterThan(s.size);
      // it starts in the door's mouth
      expect(Math.abs(s.x)).toBeLessThan(P.half);
      expect(s.z).toBeLessThan(P.z);
      expect(s.z).toBeGreaterThan(-1.5);
    }
    for (const s of sprites.filter((sp) => sp.kind === K.roseShaft)) {
      expect(Math.hypot(s.dx, s.dy, s.dz)).toBeCloseTo(1, 9);
      expect(s.dy).toBeLessThan(-0.5);
      expect(s.dz).toBeLessThan(0);
      expect(s.range).toBeLessThan(6);
    }
    // uneven and off the road's own line: no two alike, most of them to the east of south
    const shafts = sprites.filter((sp) => sp.kind === K.gateShaft);
    expect(new Set(shafts.map((s) => s.range)).size).toBe(shafts.length);
    expect(new Set(shafts.map((s) => s.dx.toFixed(3))).size).toBe(shafts.length);
    expect(shafts.filter((s) => s.dx < 0).length).toBeGreaterThan(shafts.length / 2);
    const beam = sprites.find((sp) => sp.kind === K.skyBeam);
    // a beam, not a wedge
    expect(BASTION_BEACON.width1).toBeLessThan(12);
    expect(beam?.range).toBe(BASTION_BEACON.length);
    expect(beam?.z).toBe(BASTION_BEACON.lz);
  });
});

describe('the Drowned Gate Tower painter', () => {
  // the painter's own read: the static effects tier (the preset, lowered by
  // the Advanced Effects dial), never a constant
  const tier = () =>
    resolveUiEffectsProfile({
      presetLabel: GFX.effectsTier,
      effectsQuality: GFX.effectsTier === 'low' ? 0 : 1,
      reduceMotion: false,
    }).tier;
  const door = DUNGEONS.sunken_bastion.doorPos;
  const base = terrainHeight(door.x, door.z, SEED);
  const ground = (lx: number, lz: number) => terrainHeight(door.x + lx, door.z + lz, SEED) - base;

  it('builds one pulse light, one cull group and the cosmetic layer on the door', () => {
    sunkenBastionEntranceInternalsForTest.resetCaches();
    const view = buildSunkenBastionEntrance(SEED);
    expect(view.glowLights).toHaveLength(1);
    const light = view.glowLights[0];
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.color.getHex()).toBe(BASTION_PULSE_LIGHT.color);
    expect(light.distance).toBe(BASTION_PULSE_LIGHT.distance);
    // the fire-light budget flickers about this base, never about its own default
    expect(light.userData.baseIntensity).toBe(bastionPulseLightIntensity(BASTION_BEACON.still));
    expect(light.position.x).toBe(door.x + BASTION_PULSE_LIGHT.lx);
    expect(light.position.y).toBeCloseTo(base + BASTION_PULSE_LIGHT.y, 5);
    expect(light.position.z).toBeCloseTo(door.z + BASTION_PULSE_LIGHT.lz, 5);
    expect(view.cullGroups.map((g) => g.name)).toEqual(['sunkenBastionEntranceBody']);
    const gate = view.cullGroups[0];
    expect(gate.position.x).toBe(door.x);
    expect(gate.position.z).toBe(door.z);
    expect(gate.position.y).toBeCloseTo(base, 6);
    let points = 0;
    view.group.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) points++;
    });
    expect(points, 'exactly one point light, through the fire-light sink').toBe(1);
  });

  it('registers one camera occluder per collider row, in two fading units', () => {
    clearSetPieceOccluders();
    buildSunkenBastionEntrance(SEED);
    expect(setPieceOccludersInternalsForTest.setCount()).toBe(2);
    expect(setPieceOccludersInternalsForTest.boxCount()).toBe(
      SUNKEN_BASTION_ENTRANCE_COLLIDERS.length,
    );
    const ruins = SUNKEN_BASTION_ENTRANCE_COLLIDERS.filter(
      (row) => bastionOccluderSet(row.name) === 'ruins',
    ).map((row) => row.name);
    expect(ruins).toEqual(['curtain_0', 'curtain_1', 'fallen_stones']);
    // the towers, the gate front and the door belong to the gatehouse
    for (const name of ['tower_w', 'tower_e', 'front_wall_w', 'door_pier_e', 'flood_sill']) {
      expect(bastionOccluderSet(name)).toBe('gate');
    }
    // the passage shows to the road only: a camera behind the door sees no lit panel
    const win = buildSunkenBastionEntrance(SEED).group.getObjectByName(
      'sunkenBastionFloodedPassage',
    ) as THREE.Mesh;
    expect((win.material as THREE.Material).side).toBe(THREE.BackSide);
    win.geometry.computeVertexNormals();
    expect(win.geometry.getAttribute('normal').getZ(0)).toBeGreaterThan(0.9);
    // the painter keeps its two handles, and a rebuild retires the last build's
    // sets instead of leaving them registered beside the new ones
    expect(sunkenBastionEntranceInternalsForTest.occluderHandles()).toHaveLength(2);
    expect(setPieceOccludersInternalsForTest.setCount()).toBe(2);
    clearSetPieceOccluders();
  });

  it('the flooded passage goes with the gatehouse when that is the ghost, and returns with it', () => {
    // the plan: all of it while the gate is solid, none at the ghost's alpha
    expect(bastionPassageGhostFade(1)).toBe(1);
    expect(bastionPassageGhostFade(OCCLUDER_FADE_ALPHA)).toBe(0);
    expect(bastionPassageGhostFade(0)).toBe(0);
    expect(bastionPassageGhostFade(0.6)).toBeCloseTo(0.5, 9);
    let previous = 0;
    for (let a = OCCLUDER_FADE_ALPHA; a <= 1; a += 0.05) {
      expect(bastionPassageGhostFade(a)).toBeGreaterThanOrEqual(previous);
      previous = bastionPassageGhostFade(a);
    }
    // the painter: the window is a shader, not a model, so it is told
    clearSetPieceOccluders();
    sunkenBastionEntranceInternalsForTest.resetCaches();
    const view = buildSunkenBastionEntrance(SEED);
    const win = view.group.getObjectByName('sunkenBastionFloodedPassage') as THREE.Mesh;
    const ghost = sunkenBastionEntranceInternalsForTest.uniforms.uBastGhost;
    expect(win.visible).toBe(true);
    expect(ghost.value).toBe(1);
    // the follow camera turned into the west tower, the character under the portcullis
    const tower = sunkenBastionEntranceColliders(SEED, door)[0];
    const eye = [door.x, base + 1.6, door.z - 3.4] as const;
    const inTower = () =>
      updateSetPieceOccluders(tower.x, base + 3, tower.z, eye[0], eye[1], eye[2], 1 / 60, true);
    const behind = () =>
      updateSetPieceOccluders(eye[0], base + 4, eye[2] - 10, eye[0], eye[1], eye[2], 1 / 60, true);
    behind();
    expect(win.visible).toBe(true);
    inTower();
    const [gateHandle, ruinsHandle] = sunkenBastionEntranceInternalsForTest.occluderHandles();
    expect(gateHandle.alpha()).toBe(OCCLUDER_FADE_ALPHA);
    // only the unit in the way goes
    expect(ruinsHandle.alpha()).toBe(1);
    // nothing of the door is left standing in the air: not drawn at all
    expect(ghost.value).toBe(0);
    expect(win.visible).toBe(false);
    behind();
    expect(gateHandle.alpha()).toBe(1);
    expect(ghost.value).toBe(1);
    expect(win.visible).toBe(true);
    // the window fades on the game's one screen-door pattern, in its own program
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    (win.material as THREE.Material).onBeforeCompile(
      shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
      null as unknown as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.uBastGhost).toBe(ghost);
    expect(shader.fragmentShader).toContain('uniform float uBastGhost;');
    expect(shader.fragmentShader).toContain(sunkenBastionEntranceInternalsForTest.passageGhost);
    expect(sunkenBastionEntranceInternalsForTest.passageGhost).toContain('discard');
    expect(sunkenBastionEntranceInternalsForTest.passageGhost).toContain('uBastGhost < 1.0');
    // the drop comes before the passage is traced, so a hidden window costs nothing
    expect(shader.fragmentShader.indexOf('discard')).toBeLessThan(
      shader.fragmentShader.indexOf('bastPassage(vBastP'),
    );
    // what hangs on the gatehouse goes with it too: the rosette's light, the
    // shafts in the arch and the drips off the spikes (kinds 0, 1, 2 and 4),
    // never the ground's rings and pool, the marsh lights or the sky beam
    const sprites = view.group.getObjectByName('sunkenBastionGateSprites') as THREE.Mesh;
    const spriteShader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    (sprites.material as THREE.Material).onBeforeCompile(
      spriteShader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
      null as unknown as THREE.WebGLRenderer,
    );
    expect(spriteShader.uniforms.uBastGhost).toBe(ghost);
    expect(spriteShader.vertexShader).toContain('uniform float uBastGhost;');
    expect(spriteShader.vertexShader).toContain(
      'if (bK < 2.5 || (bK > 3.5 && bK < 4.5)) bA *= uBastGhost;',
    );
    expect([K.roseCore, K.roseShaft, K.gateShaft, K.drip]).toEqual([0, 1, 2, 4]);
    clearSetPieceOccluders();
  });

  it('with no GLB loaded the stand-in blocks stand where the colliders are and leave the lane open', () => {
    const view = buildSunkenBastionEntrance(SEED);
    const blocks: THREE.Mesh[] = [];
    view.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry instanceof THREE.BoxGeometry) blocks.push(mesh);
    });
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    // a block on each tower, and the door's two piers
    for (const sx of [-1, 1]) {
      expect(blocks.some((b) => Math.abs(b.position.x - sx * 7.2) < 0.01)).toBe(true);
      expect(
        blocks.some((b) => Math.sign(b.position.x) === sx && Math.abs(b.position.z) < 0.01),
      ).toBe(true);
    }
    for (const b of blocks) {
      // nothing low stands in the lane (the block over the outer arch hangs above it)
      if (b.position.y - b.scale.y / 2 < 4) {
        expect(Math.abs(b.position.x) - b.scale.x / 2).toBeGreaterThanOrEqual(
          SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH - 1e-9,
        );
      }
    }
  });

  it('the flooded passage is ONE opaque draw of one flat window, on its own program, on every tier', () => {
    const view = buildSunkenBastionEntrance(SEED);
    const win = view.group.getObjectByName('sunkenBastionFloodedPassage') as THREE.Mesh;
    expect(win.isMesh).toBe(true);
    const material = win.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.customProgramCacheKey()).toBe(BASTION_PASSAGE_PROGRAM_CACHE_KEY);
    expect(material).toBe(sunkenBastionEntranceInternalsForTest.passageMaterial());
    const position = win.geometry.getAttribute('position');
    const reach = P.half + P.margin;
    let top = -Infinity;
    for (let i = 0; i < position.count; i++) {
      // flat, in the arch's reveal (float32 attribute storage: a hair of tolerance)
      expect(position.getZ(i)).toBeCloseTo(P.z, 5);
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(reach + 1e-5);
      // it starts under the kerb's top, so the sill hides its foot
      expect(position.getY(i)).toBeGreaterThanOrEqual(P.kerb - 0.5);
      top = Math.max(top, position.getY(i));
    }
    // it reaches the arch's crown and a margin into the masonry, no further
    expect(top).toBeCloseTo(P.spring + reach, 5);
    // a small fan: under twenty triangles
    expect((win.geometry.getIndex()?.count ?? 0) / 3).toBeLessThan(20);
    // the shader is cut from the core's own numbers
    const glsl = sunkenBastionEntranceInternalsForTest.passageCommon;
    for (const value of [
      P.half,
      P.z,
      P.kerb,
      P.water,
      P.spring,
      P.far,
      P.grille,
      P.grilleRise,
      P.restGlow,
    ]) {
      expect(glsl).toContain(value.toFixed(4));
    }
    const pulse = sunkenBastionEntranceInternalsForTest.pulseGlsl;
    for (const value of [BASTION_BEACON.period, BASTION_BEACON.rest, BASTION_BEACON.still]) {
      expect(pulse).toContain(value.toFixed(4));
    }
    expect(glsl).toContain(pulse);
  });

  it('the marsh fog is ONE instanced draw on the shared clock, on the ground band, riding the real slope', () => {
    const view = buildSunkenBastionEntrance(SEED);
    const fog = view.group.getObjectByName('sunkenBastionMarshFog') as THREE.InstancedMesh;
    expect(fog.isInstancedMesh).toBe(true);
    expect(fog.count).toBe(bastionFogPuffCount(tier()));
    expect(fog.frustumCulled).toBe(false);
    expect(fog.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    const material = fog.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.customProgramCacheKey()).toBe(BASTION_FOG_PROGRAM_CACHE_KEY);
    for (const name of ['aA', 'aB', 'aC']) {
      expect(fog.geometry.getAttribute(name).count).toBe(fog.count);
    }
    // each puff carries the ground at its birth and at the end of its drift
    const a = fog.geometry.getAttribute('aA');
    const b = fog.geometry.getAttribute('aB');
    const c = fog.geometry.getAttribute('aC');
    let fell = 0;
    for (let i = 0; i < fog.count; i++) {
      expect(c.getX(i)).toBeCloseTo(ground(a.getX(i), a.getY(i)), 4);
      expect(c.getY(i)).toBeCloseTo(ground(a.getX(i) + b.getX(i), a.getY(i) + b.getY(i)), 4);
      if (c.getY(i) < c.getX(i) - 3) fell++;
    }
    // the gate field's puffs run yards down the knoll
    expect(fell).toBeGreaterThan(fog.count * 0.2);
    // seeded matrices span the fields, so the cull footprint is honest
    const m = new THREE.Matrix4();
    let far = 0;
    for (let i = 0; i < fog.count; i++) {
      fog.getMatrixAt(i, m);
      far = Math.max(far, Math.hypot(m.elements[12], m.elements[14]));
    }
    expect(far).toBeGreaterThan(8);
    expect(sunkenBastionEntranceInternalsForTest.fogVertex).toContain('uTime');
    expect(sunkenBastionEntranceInternalsForTest.fogVertex).toContain('uBastion.y');
    // a puff the camera stands in thins with view depth and collapses its quad:
    // no stacked full-screen overdraw with the follow camera in the gate fog
    expect(bastionFogNearFade(0)).toBe(0);
    expect(bastionFogNearFade(BASTION_FOG_NEAR.start)).toBe(0);
    expect(bastionFogNearFade(BASTION_FOG_NEAR.full)).toBe(1);
    expect(bastionFogNearFade(40)).toBe(1);
    const mid = bastionFogNearFade((BASTION_FOG_NEAR.start + BASTION_FOG_NEAR.full) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    // the follow camera sits ten yards behind the character: the fog round the
    // character is untouched, the fog round the camera is gone
    expect(BASTION_FOG_NEAR.full).toBeLessThan(10);
    expect(BASTION_FOG_NEAR.start).toBeGreaterThan(1.5);
    const fogVertex = sunkenBastionEntranceInternalsForTest.fogVertex;
    expect(fogVertex).toContain(
      `float bNear = smoothstep(${BASTION_FOG_NEAR.start.toFixed(4)}, ${BASTION_FOG_NEAR.full.toFixed(4)}, -mvPosition.z);`,
    );
    // the quad has no size once the puff shows nothing, and the alpha carries the fade
    expect(fogVertex).toMatch(
      /mvPosition\.xy \+= position\.xy \* vec2\([^;]+\) \* step\(0\.004, bNear\);/,
    );
    expect(fogVertex).toMatch(/vBastPuff = vec3\([^;]*\* bNear,/);
    expect(sunkenBastionEntranceInternalsForTest.fogFieldCount).toBe(BASTION_FOG_FIELDS.length);
  });

  it('the gate sprites are ONE instanced additive draw with no fog and no depth write', () => {
    const view = buildSunkenBastionEntrance(SEED);
    const sprites = view.group.getObjectByName('sunkenBastionGateSprites') as THREE.InstancedMesh;
    expect(sprites.isInstancedMesh).toBe(true);
    expect(sprites.count).toBe(bastionSprites(tier(), ground).length);
    expect(sprites.frustumCulled).toBe(false);
    expect(sprites.renderOrder).toBe(floorVfxRenderOrder('ground', 2));
    const material = sprites.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.customProgramCacheKey()).toBe(BASTION_SPRITE_PROGRAM_CACHE_KEY);
    for (const name of ['aS', 'aK', 'aD']) {
      expect(sprites.geometry.getAttribute(name).count).toBe(sprites.count);
    }
    // the shader turns the beam on the core's own period and climb
    const vertex = sunkenBastionEntranceInternalsForTest.spriteVertex;
    expect(vertex).toContain(BASTION_BEACON.period.toFixed(4));
    expect(vertex).toContain(Math.sin(BASTION_BEACON.pitch).toFixed(4));
    expect(vertex).toContain('uBastion.y');
  });

  it('every clock in the three effect programs stops under reduced motion', () => {
    // uBastion.y is the motion switch (0 under reduced motion): a bare uTime
    // anywhere in the shaders keeps animating when the player asked for none.
    const internals = sunkenBastionEntranceInternalsForTest;
    const sources = {
      pulse: internals.pulseGlsl,
      passage: internals.passageCommon,
      fogVertex: internals.fogVertex,
      fogFragment: internals.fogFragment,
      spriteVertex: internals.spriteVertex,
      spriteFragment: internals.spriteFragment,
    };
    let clocks = 0;
    for (const [name, glsl] of Object.entries(sources)) {
      for (const statement of glsl.split(';')) {
        if (!statement.includes('uTime') || statement.includes('uniform float uTime')) continue;
        clocks++;
        expect(statement, `${name}: ${statement.trim()}`).toContain('uBastion.y');
      }
    }
    expect(clocks).toBeGreaterThan(5);
    // the mirror agrees: every sprite holds one alpha and one place at motion 0
    const pose: BastionSpritePose = { x: 0, y: 0, z: 0, alpha: 0 };
    for (const s of bastionSprites('ultra', ground)) {
      const a = { ...bastionSpritePose(s, 3, 1, 0, 0.45, pose) };
      const b = { ...bastionSpritePose(s, 977.3, 1, 0, 0.45, pose) };
      expect(b, `kind ${s.kind}`).toEqual(a);
    }
  });

  it('the whole cosmetic layer is three draws: the window, the fog, the sprites', () => {
    const view = buildSunkenBastionEntrance(SEED);
    const gate = view.cullGroups[0];
    const effects = gate.children.filter((o) => (o as THREE.Mesh).isMesh);
    expect(effects.map((o) => o.name).sort()).toEqual([
      'sunkenBastionFloodedPassage',
      'sunkenBastionGateSprites',
      'sunkenBastionMarshFog',
    ]);
    const keys = new Set(
      effects.map((o) => ((o as THREE.Mesh).material as THREE.Material).customProgramCacheKey()),
    );
    expect(keys.size).toBe(3);
  });

  it('the kit materials: lit stone, double-sided lit leaves, glossy lit water, star glass that holds its light', () => {
    const { kitMaterial } = sunkenBastionEntranceInternalsForTest;
    const stone = kitMaterial('KitStone') as THREE.MeshStandardMaterial;
    expect(stone.vertexColors).toBe(true);
    expect(stone.side).toBe(THREE.FrontSide);
    const leaf = kitMaterial('KitLeaf') as THREE.MeshStandardMaterial;
    expect(leaf.vertexColors).toBe(true);
    expect(leaf.side).toBe(THREE.DoubleSide);
    const wet = kitMaterial('KitWet') as THREE.MeshStandardMaterial;
    expect(wet.vertexColors).toBe(true);
    expect(wet).not.toBe(stone);
    if (wet.isMeshStandardMaterial) expect(wet.roughness).toBeLessThan(0.3);
    const glass = kitMaterial('KitGlow') as THREE.MeshBasicMaterial;
    expect(glass.isMeshBasicMaterial).toBe(true);
    expect(glass.vertexColors).toBe(true);
    expect(kitMaterial('KitGlow')).toBe(glass);
  });

  it("the fog's hook writes the time of day into the shared uniform and the pulse into the light's base, with no allocation path", () => {
    const view = buildSunkenBastionEntrance(SEED);
    const fog = view.group.getObjectByName('sunkenBastionMarshFog') as THREE.InstancedMesh;
    const run = fog.onBeforeRender as unknown as () => void;
    const { uniforms } = sunkenBastionEntranceInternalsForTest;
    const light = view.glowLights[0];
    const before = uniforms.uBastion.value;
    setDayNightPhaseOverride(0);
    run();
    expect(uniforms.uBastion.value.x).toBe(1);
    setDayNightPhaseOverride(0.5);
    run();
    expect(uniforms.uBastion.value.x).toBe(0);
    // headless there is no reduced-motion source: motion stays on
    expect(uniforms.uBastion.value.y).toBe(1);
    expect(uniforms.uBastion.value).toBe(before);
    const time = sharedUniforms.uTime.value;
    expect(time).toBeTypeOf('number');
    expect(light.userData.baseIntensity).toBeCloseTo(
      bastionPulseLightIntensity(bastionGatePulse(time, 1)),
      9,
    );
    // at the crest the base is the crest's
    sharedUniforms.uTime.value = BASTION_BEACON.period * 3;
    run();
    expect(light.userData.baseIntensity).toBeCloseTo(BASTION_PULSE_LIGHT.crest, 5);
    sharedUniforms.uTime.value = BASTION_BEACON.period * 3.5;
    run();
    expect(light.userData.baseIntensity).toBeLessThan(BASTION_PULSE_LIGHT.crest * 0.5);
    sharedUniforms.uTime.value = time;
  });
});
