// The Jaguar Maw's cosmetic layer: the pure plan
// (src/render/wildheart_basin_entrance_core.ts: the idol's breath, the flooded
// throat's trace, the mist's puffs, the sprites) and the painter's contract
// (src/render/wildheart_basin_entrance.ts: one clock in every program, reduced
// motion holds it still, the door's own cues on every tier, one occluder per
// collider row in two fading units, the lights it hands to the fire-light sink).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_VFX_LAYER_BASE, FLOOR_VFX_LAYER_SPAN } from '../src/render/floor_vfx_layer';
import { insidePavedGrassExclusion } from '../src/render/foliage_core';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import { clearSetPieceOccluders } from '../src/render/set_piece_occluders';
import {
  buildWildheartBasinEntrance,
  wildheartBasinEntranceInternalsForTest as internals,
  WILDHEART_MIST_PROGRAM_CACHE_KEY,
  WILDHEART_SPRITE_PROGRAM_CACHE_KEY,
  WILDHEART_THROAT_PROGRAM_CACHE_KEY,
} from '../src/render/wildheart_basin_entrance';
import {
  WILDHEART_BRAZIERS,
  WILDHEART_BREATH,
  WILDHEART_DRIP_SOURCES,
  WILDHEART_EAR_TOP,
  WILDHEART_EYES,
  WILDHEART_FIREFLY_FIELDS,
  WILDHEART_LEAN,
  WILDHEART_MAW_SHAFTS,
  WILDHEART_MIST_FIELDS,
  WILDHEART_OVERHANG_SOLIDS,
  WILDHEART_SPRITE_KIND,
  WILDHEART_THROAT,
  type WildheartEffectsTier,
  type WildheartThroatHit,
  wildheartBreathPulse,
  wildheartDripFallTime,
  wildheartFlamePower,
  wildheartMawLightIntensity,
  wildheartMistNearFade,
  wildheartMistPose,
  wildheartMistPuff,
  wildheartMistPuffCount,
  wildheartNightAmount,
  wildheartOccluderSet,
  wildheartOccluderTop,
  wildheartRootSolid,
  wildheartSpritePose,
  wildheartSprites,
  wildheartThroatEye,
  wildheartThroatGhostFade,
  wildheartThroatGlow,
  wildheartThroatRest,
  wildheartThroatTrace,
} from '../src/render/wildheart_basin_entrance_core';
import { DUNGEONS } from '../src/sim/data';
import {
  onWildheartBasinEntranceCauseway,
  WILDHEART_BASIN_ENTRANCE_COLLIDERS,
  WILDHEART_BASIN_ENTRANCE_LANE_HALF_WIDTH,
  WILDHEART_BASIN_ENTRANCE_RING,
} from '../src/sim/wildheart_basin_entrance';
import { WORLD_SEED } from '../src/sim/world_seed';

const TIERS: readonly WildheartEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const K = WILDHEART_SPRITE_KIND;
const flat = () => 0;

afterEach(() => {
  clearSetPieceOccluders();
  internals.resetCaches();
});

describe('the idol breathes on one clock', () => {
  it('smoulders low, crests once a breath, quick to catch and slow to die', () => {
    const b = WILDHEART_BREATH;
    expect(wildheartBreathPulse(b.crest, 1)).toBeCloseTo(1, 6);
    expect(wildheartBreathPulse(b.crest + b.period, 1)).toBeCloseTo(1, 6);
    // between breaths the idol holds a low rest
    for (const t of [10, 12, 15]) {
      expect(wildheartBreathPulse(t, 1)).toBeLessThan(0.2);
      expect(wildheartBreathPulse(t, 1)).toBeGreaterThan(0.04);
    }
    // the fire catches faster than it dies
    const rise = wildheartBreathPulse(b.crest - 0.6, 1);
    const fall = wildheartBreathPulse(b.crest + 0.6, 1);
    expect(fall).toBeGreaterThan(rise);
    expect(wildheartBreathPulse(b.crest + 2 * b.decay, 1)).toBeLessThan(0.3);
    // no step where the cycle wraps
    expect(
      Math.abs(
        wildheartBreathPulse(b.period - 0.001, 1) - wildheartBreathPulse(b.period + 0.001, 1),
      ),
    ).toBeLessThan(0.01);
  });

  it('reduced motion holds the breath still', () => {
    const still = wildheartBreathPulse(0, 0);
    expect(still).toBe(WILDHEART_BREATH.still);
    for (const t of [1, 3, 7.5, 40]) expect(wildheartBreathPulse(t, 0)).toBe(still);
  });

  it('the maw light and the flames follow it', () => {
    expect(wildheartMawLightIntensity(1)).toBeGreaterThan(wildheartMawLightIntensity(0) * 4);
    expect(wildheartFlamePower(0.1, 0)).toBeCloseTo(0.1, 9);
    expect(wildheartFlamePower(0.1, 1)).toBeCloseTo(1, 9);
    expect(wildheartFlamePower(0.78, 0.5)).toBeGreaterThan(0.78);
  });

  it('night comes on through dusk', () => {
    expect(wildheartNightAmount(0.5)).toBe(0);
    expect(wildheartNightAmount(0)).toBe(1);
  });
});

describe('the flooded throat is traced, not painted', () => {
  const t = WILDHEART_THROAT;
  const hit: WildheartThroatHit = { kind: 'far', t: 0, x: 0, y: 0, z: 0 };
  const cast = (ox: number, oy: number, dx: number, dy: number, dz: number, water = true) => {
    const n = Math.hypot(dx, dy, dz);
    return wildheartThroatTrace(ox, oy, t.z, dx / n, dy / n, dz / n, water, hit).kind;
  };

  it('a ray meets the water, a wall, the vault or the far light where the throat really is', () => {
    expect(cast(0, 1.2, 0, -0.3, 1)).toBe('water');
    expect(hit.y).toBeCloseTo(t.water, 6);
    expect(cast(0, 1.2, 1, 0, 0.6)).toBe('wall');
    expect(hit.x).toBeCloseTo(t.half, 6);
    expect(cast(0, 1.2, -1, 0, 0.6)).toBe('wall');
    expect(cast(0, 2, 0, 1, 0.5)).toBe('vault');
    expect(hit.y).toBeGreaterThan(t.spring);
    expect(Math.hypot(hit.x, hit.y - t.spring)).toBeCloseTo(t.half, 5);
    // level with the water's far end and under the roots: the light
    expect(cast(0, 0.4, 0, 0, 1)).toBe('far');
    expect(hit.z).toBeCloseTo(t.far, 6);
    // the reflected ray never meets the water again
    expect(cast(0, t.water, 0, -0.01, 1, false)).not.toBe('water');
  });

  it('the roots hang from the vault and never reach the water in the middle', () => {
    let solid = 0;
    for (let x = -t.half; x <= t.half; x += 0.02) {
      const vault = t.spring + Math.sqrt(Math.max(t.half * t.half - x * x, 0));
      if (wildheartRootSolid(x, vault - 0.3)) solid++;
      if (Math.abs(x) < 1.2) expect(wildheartRootSolid(x, t.water + 0.3), `x ${x}`).toBe(false);
    }
    // some of the curtain is root and most of it is air
    expect(solid).toBeGreaterThan(10);
    expect(solid).toBeLessThan(120);
    expect(cast(0.02, 5.2, 0, 0.01, 1)).toMatch(/roots|far|vault/);
  });

  it('the eye never stands under the last step, and the far light never goes out', () => {
    expect(wildheartThroatEye(-3)).toBe(t.kerb + t.eye);
    expect(wildheartThroatEye(4)).toBe(4);
    expect(t.water).toBeLessThan(t.kerb);
    expect(wildheartThroatRest(0)).toBe(t.restDay);
    expect(wildheartThroatRest(1)).toBe(t.restNight);
    expect(t.restNight).toBeGreaterThan(0);
    expect(wildheartThroatGlow(t.far, 1)).toBeGreaterThan(wildheartThroatGlow(t.z, 1) * 3);
  });

  it('the throat goes with the idol when the idol is the camera ghost', () => {
    expect(wildheartThroatGhostFade(1)).toBe(1);
    expect(wildheartThroatGhostFade(OCCLUDER_FADE_ALPHA)).toBe(0);
    expect(wildheartThroatGhostFade(0)).toBe(0);
    const half = wildheartThroatGhostFade((1 + OCCLUDER_FADE_ALPHA) / 2);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });
});

describe('the mist', () => {
  it('the fields share every puff, and the tier only thins them', () => {
    expect(WILDHEART_MIST_FIELDS.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1, 9);
    expect(internals.mistFieldCount).toBe(WILDHEART_MIST_FIELDS.length);
    const counts = TIERS.map(wildheartMistPuffCount);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBeGreaterThan(0);
    const used = new Set<number>();
    const n = wildheartMistPuffCount('ultra');
    for (let i = 0; i < n; i++) used.add(wildheartMistPuff(i, n).field);
    expect(used.size).toBe(WILDHEART_MIST_FIELDS.length);
    // the breath field is the one that takes the jade whole, and it pours down the causeway
    const maw = WILDHEART_MIST_FIELDS[0];
    expect(maw.name).toBe('maw');
    expect(maw.lit).toBe(1);
    expect(maw.dz).toBeLessThan(-6);
    const door = DUNGEONS.wildheart_basin.doorPos;
    expect(
      onWildheartBasinEntranceCauseway(door, door.x + maw.ox + maw.dx, door.z + maw.oz + maw.dz),
    ).toBe(true);
  });

  it('no mist and no firefly drifts into the ring of columns', () => {
    const door = DUNGEONS.wildheart_basin.doorPos;
    const ring = WILDHEART_BASIN_ENTRANCE_RING;
    const clear = (lx: number, lz: number) =>
      Math.hypot(door.x + lx - ring.x, door.z + lz - ring.z) - ring.radius;
    const n = wildheartMistPuffCount('ultra');
    for (let i = 0; i < n; i++) {
      const puff = wildheartMistPuff(i, n);
      for (const t of [0, 0.5, 1]) {
        expect(clear(puff.ox + puff.dx * t, puff.oz + puff.dz * t), `puff ${i}`).toBeGreaterThan(
          ring.clear,
        );
      }
    }
    for (const f of WILDHEART_FIREFLY_FIELDS) {
      for (const [lx, lz] of [
        [f.x0, f.z0],
        [f.x1, f.z0],
        [f.x0, f.z1],
        [f.x1, f.z1],
      ]) {
        // a firefly wanders a yard and a half off its own place
        expect(clear(lx, lz) - 1.5).toBeGreaterThan(ring.clear);
      }
    }
  });

  it('a puff is born and dies unseen, drifts with time and stands still under reduced motion', () => {
    const puff = wildheartMistPuff(3, 52);
    const a = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
    const b = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
    wildheartMistPose({ ...puff, phase: 0 }, 0, 1, a);
    expect(a.alpha).toBe(0);
    wildheartMistPose(puff, 5, 1, a);
    wildheartMistPose(puff, 9, 1, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.01);
    wildheartMistPose(puff, 5, 0, a);
    wildheartMistPose(puff, 9, 0, b);
    expect(b).toEqual(a);
    expect(wildheartMistNearFade(1)).toBe(0);
    expect(wildheartMistNearFade(20)).toBe(1);
  });
});

describe('the sprites', () => {
  it("the door's own cues draw on every tier; the tier only thins the dressing", () => {
    const count = (tier: WildheartEffectsTier, kind: number) =>
      wildheartSprites(tier, flat).filter((s) => s.kind === kind).length;
    for (const tier of TIERS) {
      expect(count(tier, K.eyeGlow), tier).toBe(WILDHEART_EYES.length);
      // five tongues in each eye, three in each fire bowl
      expect(count(tier, K.flame), tier).toBe(
        WILDHEART_EYES.length * 5 + WILDHEART_BRAZIERS.length * 3,
      );
      expect(count(tier, K.glow), tier).toBe(2);
      expect(count(tier, K.pool), tier).toBe(1);
      expect(count(tier, K.mawShaft), tier).toBe(5);
      expect(count(tier, K.drip), tier).toBe(count(tier, K.ring));
      expect(count(tier, K.drip), tier).toBeGreaterThan(0);
    }
    expect(count('low', K.eyeShaft)).toBe(0);
    expect(count('ultra', K.eyeShaft)).toBe(WILDHEART_EYES.length);
    expect(count('low', K.firefly)).toBe(0);
    expect(count('ultra', K.firefly)).toBeGreaterThan(count('medium', K.firefly));
    expect(count('ultra', K.drip)).toBe(WILDHEART_DRIP_SOURCES.length);
    const totals = TIERS.map((tier) => wildheartSprites(tier, flat).length);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("the maw's shafts lie near level over the causeway, and a firefly flies over its own ground", () => {
    // the causeway falls away from the door: a shaft pitched up would leave
    // the walker under it, one pitched down would bury itself in the rise
    for (const [, pitch] of WILDHEART_MAW_SHAFTS) expect(Math.abs(pitch)).toBeLessThan(0.2);
    const shafts = wildheartSprites('ultra', flat).filter((s) => s.kind === K.mawShaft);
    for (const s of shafts) {
      expect(s.dz).toBeLessThan(-0.8);
      // ten yards out it is still over a walker's head on the causeway's foot (two yards down)
      expect(s.y + s.dy * 10).toBeGreaterThan(0.2);
      expect(s.y + s.dy * 10).toBeLessThan(3.2);
    }
    // the ground the painter hands over is the terrain or the lagoon: a
    // firefly over the low bank flies a yard over the bank, not over the door
    const low = (lx: number) => (lx > 2 ? -4.5 : 0);
    const flies = wildheartSprites('ultra', low).filter((s) => s.kind === K.firefly);
    expect(flies.length).toBeGreaterThan(10);
    for (const f of flies) {
      expect(f.y - low(f.x)).toBeGreaterThan(0.7);
      expect(f.y - low(f.x)).toBeLessThan(2.5);
    }
  });

  it('every sprite is finite, and what hangs on the idol is marked to go with its ghost', () => {
    const sprites = wildheartSprites('ultra', flat);
    for (const s of sprites) {
      for (const v of [
        s.x,
        s.y,
        s.z,
        s.size,
        s.phase,
        s.speed,
        s.range,
        s.dx,
        s.dy,
        s.dz,
        s.spread,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    const flames = sprites.filter((s) => s.kind === K.flame);
    const eye = flames.filter((s) => s.dy === 1);
    const bowl = flames.filter((s) => s.dy === 0);
    expect(eye).toHaveLength(WILDHEART_EYES.length * 5);
    expect(bowl).toHaveLength(WILDHEART_BRAZIERS.length * 3);
    // the fire in an eye is always jade and only an ember between breaths;
    // a fire bowl always burns and turns jade with the breath
    for (const f of eye) {
      expect(f.spread).toBe(1);
      expect(f.dx).toBeLessThan(0.2);
      expect(f.y).toBeGreaterThan(9);
    }
    for (const f of bowl) {
      expect(f.spread).toBe(0);
      expect(f.dx).toBeGreaterThan(0.6);
    }
  });

  it('a drop falls from a fang to the ground under it and leaves its ring there', () => {
    const ground = (lx: number) => 0.3 * lx;
    const sprites = wildheartSprites('ultra', ground);
    const drips = sprites.filter((s) => s.kind === K.drip);
    const rings = sprites.filter((s) => s.kind === K.ring);
    const pose = { x: 0, y: 0, z: 0, alpha: 0 };
    drips.forEach((d, i) => {
      const ring = rings[i];
      expect(ring.x).toBe(d.x);
      expect(ring.y).toBeCloseTo(ground(d.x) + 0.2, 9);
      expect(d.y - d.range).toBeCloseTo(ring.y, 6);
      // at the end of its fall the drop is at the ring
      const fall = wildheartDripFallTime(d.range);
      const start = (1 - d.phase) / d.speed;
      wildheartSpritePose(d, start + fall * 0.999, 0, 1, 0, pose);
      expect(pose.y).toBeCloseTo(ring.y, 1);
      expect(pose.alpha).toBeGreaterThan(0);
      wildheartSpritePose(ring, start + fall * 0.5, 0, 1, 0, pose);
      expect(pose.alpha).toBe(0);
      wildheartSpritePose(ring, start + fall + 0.2, 0, 1, 0, pose);
      expect(pose.alpha).toBeGreaterThan(0);
    });
  });

  it('nothing moves under reduced motion, and the fireflies wait for the dark', () => {
    const sprites = wildheartSprites('ultra', flat);
    const a = { x: 0, y: 0, z: 0, alpha: 0 };
    const b = { x: 0, y: 0, z: 0, alpha: 0 };
    for (const s of sprites) {
      wildheartSpritePose(s, 2, 1, 0, WILDHEART_BREATH.still, a);
      wildheartSpritePose(s, 31, 1, 0, WILDHEART_BREATH.still, b);
      expect(b, `kind ${s.kind}`).toEqual(a);
    }
    for (const s of sprites.filter((sp) => sp.kind === K.firefly)) {
      wildheartSpritePose(s, 4, 0, 1, 0.1, a);
      expect(a.alpha).toBe(0);
    }
    // the eyes never go quite out, and blaze at the crest
    const glow = sprites.find((s) => s.kind === K.eyeGlow);
    if (!glow) throw new Error('no eye glow');
    wildheartSpritePose(glow, 10, 0, 1, 0.1, a);
    wildheartSpritePose(glow, 3, 0, 1, 1, b);
    expect(a.alpha).toBeGreaterThan(0.05);
    expect(b.alpha).toBeGreaterThan(a.alpha * 5);
  });
});

describe('the painter', () => {
  it('every collider row is an occluder, in two fading units', () => {
    const sets = WILDHEART_BASIN_ENTRANCE_COLLIDERS.map((r) => wildheartOccluderSet(r.name));
    expect(sets.filter((s) => s === 'idol')).toHaveLength(3);
    expect(sets.filter((s) => s === 'court')).toHaveLength(5);
    expect(wildheartOccluderSet('head')).toBe('idol');
    expect(wildheartOccluderSet('tusk_w')).toBe('court');
  });

  it("the head's occluder box reaches the ears, and no other row's top moves", () => {
    // the collider's camera top is the sim's and stays under the crown; the
    // box the camera's ghost test reads is the render's and covers the ears
    const head = WILDHEART_BASIN_ENTRANCE_COLLIDERS.find((r) => r.name === 'head');
    expect(head?.top).toBe(15.8);
    expect(wildheartOccluderTop('head', 15.8)).toBe(WILDHEART_EAR_TOP);
    expect(WILDHEART_EAR_TOP).toBeGreaterThan(15.8);
    expect(wildheartOccluderTop('head', 25)).toBe(25);
    for (const r of WILDHEART_BASIN_ENTRANCE_COLLIDERS) {
      if (r.name !== 'head') expect(wildheartOccluderTop(r.name, r.top), r.name).toBe(r.top);
    }
  });

  it('the overhanging jaw and skull are occluders that begin over head height', () => {
    const lane = WILDHEART_BASIN_ENTRANCE_LANE_HALF_WIDTH;
    for (const o of WILDHEART_OVERHANG_SOLIDS) {
      // someone on foot or mounted passes under every one of them
      expect(o.baseY, o.name).toBeGreaterThanOrEqual(4);
      expect(o.topY, o.name).toBeGreaterThan(o.baseY);
      expect(o.topY, o.name).toBeLessThanOrEqual(WILDHEART_EAR_TOP);
      // each spans the way in, wider than the head's own row
      expect(o.hw, o.name).toBeGreaterThan(8.05);
      expect(Math.abs(o.lx) + lane, o.name).toBeLessThan(o.hw);
    }
    const jaw = WILDHEART_OVERHANG_SOLIDS[0];
    const skull = WILDHEART_OVERHANG_SOLIDS[1];
    expect([jaw.name, skull.name]).toEqual(['jaw', 'skull']);
    // the jaw hangs out before the door plane and meets the skull behind it
    expect(jaw.lz - jaw.hd).toBeLessThan(-5);
    expect(jaw.lz + jaw.hd).toBeGreaterThanOrEqual(skull.lz - skull.hd - 0.01);
    expect(skull.topY).toBe(WILDHEART_EAR_TOP);
  });

  it('builds the idol, the leaning throat, the mist, the sprites and three lights for the sink', () => {
    const view = buildWildheartBasinEntrance(WORLD_SEED);
    expect(view.cullGroups).toHaveLength(1);
    const body = view.cullGroups[0];
    expect(body.name).toBe('wildheartBasinEntranceBody');
    expect(body.position.x).toBe(-237);
    expect(body.position.z).toBe(1093);
    // the jade in the maw and the two fire bowls, lifted to the feature's root
    expect(view.glowLights).toHaveLength(1 + WILDHEART_BRAZIERS.length);
    for (const light of view.glowLights) {
      expect(light.parent).toBe(view.group);
      expect(light.userData.baseIntensity).toBe(light.intensity);
      expect(Math.hypot(light.position.x + 237, light.position.z - 1093)).toBeLessThan(6);
    }
    const throat = body.getObjectByName('wildheartBasinFloodedThroat') as THREE.Mesh;
    const mist = body.getObjectByName('wildheartBasinMawMist') as THREE.InstancedMesh;
    const sprites = body.getObjectByName('wildheartBasinMawSprites') as THREE.InstancedMesh;
    expect(throat).toBeDefined();
    // the window leans with the idol, about the door
    const lean = throat.parent as THREE.Group;
    expect(lean.name).toBe('wildheartBasinEntranceLean');
    expect(lean.position.lengthSq()).toBe(0);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(lean.quaternion);
    expect(up.x).toBeCloseTo(Math.sin(WILDHEART_LEAN.roll), 3);
    expect(up.z).toBeCloseTo(-Math.sin(WILDHEART_LEAN.pitch), 3);
    // seen from the causeway only: its lit side is its BACK side
    expect((throat.material as THREE.Material).side).toBe(THREE.BackSide);
    expect((throat.material as THREE.Material).transparent).toBe(false);
    for (const mesh of [mist, sprites]) {
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.renderOrder).toBeGreaterThanOrEqual(FLOOR_VFX_LAYER_BASE.ground);
      expect(mesh.renderOrder).toBeLessThan(
        FLOOR_VFX_LAYER_BASE.ground + FLOOR_VFX_LAYER_SPAN.ground,
      );
      expect((mesh.material as THREE.Material).depthWrite).toBe(false);
    }
    expect(TIERS.map(wildheartMistPuffCount)).toContain(mist.count);
    expect((sprites.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    expect(typeof mist.onBeforeRender).toBe('function');
    // one occluder per collider row
    const handles = internals.occluderHandles();
    expect(handles).toHaveLength(2);
    // the idol's three collider rows, then its two overhangs
    expect(handles[0].boxes).toHaveLength(3 + WILDHEART_OVERHANG_SOLIDS.length);
    expect(handles[0].boxes.map((b) => b.baseY !== undefined)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(handles[1].boxes).toHaveLength(5);
    // a rebuild retires the last entrance's sets
    buildWildheartBasinEntrance(WORLD_SEED);
    expect(internals.occluderHandles()).toHaveLength(2);
    expect(internals.occluderHandles()[0]).not.toBe(handles[0]);
  });

  it('the three effect programs have their own cache keys and share one clock', () => {
    const keys = [
      WILDHEART_THROAT_PROGRAM_CACHE_KEY,
      WILDHEART_MIST_PROGRAM_CACHE_KEY,
      WILDHEART_SPRITE_PROGRAM_CACHE_KEY,
    ];
    expect(new Set(keys).size).toBe(3);
    expect(internals.throatMaterial().customProgramCacheKey()).toBe(keys[0]);
    expect(internals.mistMaterial().customProgramCacheKey()).toBe(keys[1]);
    expect(internals.spriteMaterial().customProgramCacheKey()).toBe(keys[2]);
    // the breath's constants are the core's, spliced into every program
    for (const v of [WILDHEART_BREATH.period, WILDHEART_BREATH.crest, WILDHEART_BREATH.decay]) {
      expect(internals.pulseGlsl).toContain(v.toFixed(4));
    }
    expect(internals.throatCommon).toContain(internals.pulseGlsl);
    expect(internals.throatCommon).toContain(WILDHEART_THROAT.roots.toFixed(4));
    expect(internals.throatCommon).toContain(WILDHEART_THROAT.far.toFixed(4));
  });

  it('every use of the clock in a shader is under the reduced-motion switch', () => {
    const sources = [
      internals.pulseGlsl,
      internals.throatCommon,
      internals.mistVertex,
      internals.mistFragment,
      internals.spriteVertex,
      internals.spriteFragment,
    ];
    let uses = 0;
    for (const source of sources) {
      for (const statement of source.split(';')) {
        if (!statement.includes('uTime') || /uniform float uTime/.test(statement)) continue;
        uses++;
        expect(statement, statement.trim().slice(0, 80)).toContain('uWildheart.y');
      }
    }
    expect(uses).toBeGreaterThan(6);
  });

  it('the meadow grows no grass through the causeway, in any of the three grass systems', () => {
    const door = DUNGEONS.wildheart_basin.doorPos;
    // on the flagstones, and a hand past their edge
    expect(insidePavedGrassExclusion(door.x, door.z - 4)).toBe(true);
    expect(insidePavedGrassExclusion(door.x - 1.6, door.z - 14.6)).toBe(true);
    expect(insidePavedGrassExclusion(door.x + 3.2, door.z - 3.4)).toBe(true);
    // beside the causeway, at the fire bowls, on the road and far away the grass grows
    expect(insidePavedGrassExclusion(door.x + 4.4, door.z - 3.4)).toBe(false);
    expect(insidePavedGrassExclusion(door.x - 8, door.z - 10)).toBe(false);
    expect(insidePavedGrassExclusion(door.x, door.z - 16)).toBe(false);
    expect(insidePavedGrassExclusion(-256, 1072)).toBe(false);
    expect(insidePavedGrassExclusion(0, 0)).toBe(false);
    for (const file of ['foliage.ts', 'blade_grass.ts', 'blade_grass_band.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('insidePavedGrassExclusion(x, z)');
    }
  });

  it('the kit slots get lit materials, and only the coals hold their own light', () => {
    expect(internals.kitMaterial('KitGlow')).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(internals.kitMaterial('KitGlow').name).toBe('WildheartBasinCoals');
    expect(internals.kitMaterial('KitLeaf').side).toBe(THREE.DoubleSide);
    expect(internals.kitMaterial('KitStone')).not.toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(internals.kitMaterial('KitWet')).not.toBe(internals.kitMaterial('KitStone'));
  });
});
