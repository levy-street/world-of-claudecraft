// The Fallen Chapel's cosmetic layer: the pure plan
// (hollow_crypt_entrance_core.ts: the virtual stair's trace, the grave mist,
// the spirit sprites, the night gate) and the painter's contract
// (hollow_crypt_entrance.ts: one point light, one cull group, the stair's
// window box as one opaque draw, one instanced mist draw and one instanced
// additive sprite draw on the shared clock, the floor ladder, the stand-in
// when no GLB loaded). Three.js runs headless in Node.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveUiEffectsProfile } from '../src/game/ui_effects_profile';
import { setDayNightPhaseOverride } from '../src/render/day_night_clock';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { GFX, sharedUniforms } from '../src/render/gfx';
import {
  buildHollowCryptEntrance,
  CRYPT_MIST_PROGRAM_CACHE_KEY,
  CRYPT_SPRITE_PROGRAM_CACHE_KEY,
  CRYPT_STAIR_PROGRAM_CACHE_KEY,
  hollowCryptEntranceInternalsForTest,
} from '../src/render/hollow_crypt_entrance';
import {
  CRYPT_CANDLE_WICKS,
  CRYPT_MIST_FIELDS,
  CRYPT_ROSE,
  CRYPT_SOUL_LIGHT,
  CRYPT_SPRITE_KIND,
  CRYPT_STAIR,
  CRYPT_WISP_FIELD,
  type CryptEffectsTier,
  type CryptMistPose,
  type CryptSpritePose,
  type CryptStairHit,
  cryptCandleClusters,
  cryptMistPose,
  cryptMistPuff,
  cryptMistPuffCount,
  cryptMistStrength,
  cryptNightAmount,
  cryptSpritePose,
  cryptSprites,
  cryptStairBreath,
  cryptStairTrace,
  cryptStairTreadY,
} from '../src/render/hollow_crypt_entrance_core';
import { DUNGEONS } from '../src/sim/data';
import { HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH } from '../src/sim/hollow_crypt_entrance';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;
const TIERS: readonly CryptEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const hit: CryptStairHit = { kind: 'void', t: 0, step: 0, depth: 0 };

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

afterEach(() => setDayNightPhaseOverride(null));

describe('the night gate', () => {
  it('nothing haunts at noon, everything at midnight, and dusk is on the way', () => {
    expect(cryptNightAmount(0.5)).toBe(0);
    expect(cryptNightAmount(0)).toBe(1);
    const dusk = cryptNightAmount(0.77);
    expect(dusk).toBeGreaterThan(0.2);
    expect(dusk).toBeLessThan(0.8);
    expect(cryptNightAmount(0.85)).toBeGreaterThan(dusk);
    // the mist never leaves: thin by day, thick by night
    for (const field of CRYPT_MIST_FIELDS) {
      expect(cryptMistStrength(field.dayAlpha, 0)).toBeGreaterThan(0.3);
      expect(cryptMistStrength(field.dayAlpha, 1)).toBe(1);
    }
    // the soul column is the daytime signature: at noon it outshines the ground mist
    const column = CRYPT_MIST_FIELDS.find((f) => f.name === 'column');
    const stair = CRYPT_MIST_FIELDS.find((f) => f.name === 'stair');
    if (!column || !stair) throw new Error('missing field');
    expect(cryptMistStrength(column.dayAlpha, 0)).toBeGreaterThan(
      cryptMistStrength(stair.dayAlpha, 0) * 2,
    );
  });
});

describe('the stair behind the portal', () => {
  it('fills the portal lane, behind the trigger, under the vault', () => {
    expect(CRYPT_STAIR.halfWidth).toBe(HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH);
    expect(CRYPT_STAIR.z0).toBeGreaterThan(0);
    expect(CRYPT_STAIR.z1).toBeGreaterThan(CRYPT_STAIR.z0 + 3);
    // the lid stands over the tallest meadow blades, under the springing
    expect(CRYPT_STAIR.lid).toBeGreaterThanOrEqual(1);
    expect(CRYPT_STAIR.lid).toBeLessThan(CRYPT_STAIR.spring);
    expect(CRYPT_STAIR.apex).toBeGreaterThan(CRYPT_STAIR.spring + 1);
    // every tread lies lower than the one before, from just under the floor
    expect(cryptStairTreadY(0)).toBeCloseTo(CRYPT_STAIR.y - CRYPT_STAIR.lip, 9);
    for (let k = 1; k < CRYPT_STAIR.steps; k++) {
      expect(cryptStairTreadY(k)).toBeCloseTo(cryptStairTreadY(k - 1) - CRYPT_STAIR.riser, 9);
    }
    // a flight worth the name: more than five yards down
    expect(CRYPT_STAIR.y - cryptStairTreadY(CRYPT_STAIR.steps - 1)).toBeGreaterThan(5);
  });

  it('a ray down through the lid lands on a tread, and a steeper or later ray on a deeper one', () => {
    const s = CRYPT_STAIR;
    const first = { ...cryptStairTrace(0, s.lid, s.z0 + 0.3, ...norm(0, -1, 0.2), hit) };
    expect(first.kind).toBe('tread');
    expect(first.step).toBeLessThanOrEqual(1);
    const later = { ...cryptStairTrace(0, s.lid, s.z0 + 2.4, ...norm(0, -1, 0.2), hit) };
    expect(later.kind).toBe('tread');
    expect(later.step).toBeGreaterThan(first.step);
    expect(later.depth).toBeGreaterThan(first.depth);
    expect(later.t).toBeGreaterThan(first.t);
    // the hit point really is on that tread
    const [, dy, dz] = norm(0, -1, 0.2);
    const y = s.lid + dy * later.t;
    const z = s.z0 + 2.4 + dz * later.t;
    expect(y).toBeCloseTo(cryptStairTreadY(later.step), 6);
    expect(z).toBeGreaterThanOrEqual(s.z0 + later.step * s.tread - 1e-9);
    expect(z).toBeLessThanOrEqual(s.z0 + (later.step + 1) * s.tread + 1e-9);
  });

  it('a ray going north only ever meets treads; one coming back south can meet a riser', () => {
    const s = CRYPT_STAIR;
    for (let k = 0; k < 40; k++) {
      const d = norm((k % 5) * 0.02 - 0.04, -0.2 - (k % 7) * 0.12, 1);
      const r = cryptStairTrace(0, s.lid, s.z0 + (k % 6) * 0.5, ...d, hit);
      expect(r.kind === 'riser', `north ray ${k}`).toBe(false);
    }
    const south = cryptStairTrace(0, s.lid, s.z1 - 0.2, ...norm(0, -0.35, -1), hit);
    expect(south.kind).toBe('riser');
  });

  it('level rays into the back find the vault, glancing rays the walls, and nothing escapes the well', () => {
    const s = CRYPT_STAIR;
    expect(cryptStairTrace(0, 2.2, s.z1, ...norm(0, 0.02, 1), hit).kind).toBe('ceiling');
    expect(cryptStairTrace(0.4, 2, s.z1, ...norm(1, -0.1, 0.4), hit).kind).toBe('wall');
    expect(cryptStairTrace(-0.4, 2, s.z1, ...norm(-1, -0.1, 0.4), hit).kind).toBe('wall');
    // a ray straight down the flight's own slope from the back reaches its foot
    const slope = s.riser / s.tread;
    const foot = cryptStairTrace(0, 1.4, s.z1, ...norm(0, -slope, 1), hit);
    expect(foot.kind).toBe('void');
    expect(foot.depth).toBeGreaterThan(2.5);
    for (let k = 0; k < 60; k++) {
      const d = norm(Math.sin(k * 1.3) * 0.6, -0.05 - (k % 9) * 0.1, 0.4 + (k % 4) * 0.3);
      const r = cryptStairTrace(Math.sin(k) * 1.1, s.lid, s.z0 + (k % 7) * 0.5, ...d, hit);
      expect(r.t, `ray ${k}`).toBeLessThan(40);
      expect(r.t).toBeGreaterThan(0);
    }
  });

  it('the soul light breathes UP the flight and holds still under reduced motion', () => {
    // the crest at depth 2 arrives at depth 1 a moment later
    const crestAt = (depth: number) => (Math.PI / 2 + depth * 1.3) / 0.9;
    expect(cryptStairBreath(2, crestAt(2), 1)).toBeCloseTo(1, 6);
    expect(crestAt(1)).toBeLessThan(crestAt(2));
    expect(cryptStairBreath(1, crestAt(1), 1)).toBeCloseTo(1, 6);
    expect(cryptStairBreath(1.5, 3, 0)).toBe(cryptStairBreath(1.5, 99, 0));
    for (let t = 0; t < 20; t += 0.7) {
      expect(cryptStairBreath(2, t, 1)).toBeGreaterThanOrEqual(0.44 - 1e-9);
      expect(cryptStairBreath(2, t, 1)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('the grave mist', () => {
  it('thins the puffs by the static effects tier, never to zero', () => {
    expect(TIERS.map(cryptMistPuffCount)).toEqual([14, 28, 44, 60]);
    expect(CRYPT_MIST_FIELDS.reduce((sum, f) => sum + f.share, 0)).toBeCloseTo(1, 9);
  });

  it('every field gets puffs on every tier, and the stair pours south down the nave', () => {
    for (const tier of TIERS) {
      const count = cryptMistPuffCount(tier);
      const fields = new Set<number>();
      for (let i = 0; i < count; i++) {
        const p = cryptMistPuff(i, count);
        fields.add(p.field);
        expect(p.phase).toBeGreaterThanOrEqual(0);
        expect(p.phase).toBeLessThan(1);
        expect(p.speed).toBeGreaterThan(0);
        // no random stream: the same index always gives the same puff
        expect(cryptMistPuff(i, count)).toEqual(p);
        if (CRYPT_MIST_FIELDS[p.field].name === 'stair') {
          expect(p.oz, 'born at the mouth').toBeGreaterThan(-0.2);
          expect(Math.abs(p.ox)).toBeLessThan(CRYPT_STAIR.halfWidth);
          expect(p.dz, 'flows south').toBeLessThan(-8);
        }
      }
      expect([...fields].sort()).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('the soul column rises up the gable in tall streaks and clears its bellcote', () => {
    const pose: CryptMistPose = { x: 0, y: 0, z: 0, scale: 0, alpha: 0 };
    const count = cryptMistPuffCount('high');
    const wisps = Array.from({ length: count }, (_, i) => cryptMistPuff(i, count)).filter(
      (p) => CRYPT_MIST_FIELDS[p.field].name === 'column',
    );
    expect(wisps.length).toBeGreaterThanOrEqual(6);
    for (const wisp of wisps) {
      // born at the gable (lz -22), across its width, and drifting south
      expect(Math.abs(wisp.ox)).toBeLessThan(5);
      expect(Math.abs(wisp.oz + 22)).toBeLessThan(2.5);
      expect(wisp.dz).toBeLessThan(0);
      expect(wisp.aspect).toBeGreaterThan(1.5);
      const t0 = (1 - wisp.phase) / wisp.speed;
      const low = cryptMistPose(wisp, t0 + 0.05 / wisp.speed, 1, pose).y;
      const high = cryptMistPose(wisp, t0 + 0.9 / wisp.speed, 1, pose).y;
      expect(low).toBeGreaterThan(1);
      // over the gable's apex (17.6) and its bellcote
      expect(high).toBeGreaterThan(24);
    }
    // the ground mist still hugs the ground
    expect(cryptMistPuff(0, count).rise).toBeLessThan(0.5);
  });

  it('a puff fades in, drifts along its lane widening, fades out; reduced motion freezes it in place', () => {
    const puff = cryptMistPuff(1, 28);
    const pose: CryptMistPose = { x: 0, y: 0, z: 0, scale: 0, alpha: 0 };
    const t0 = (1 - puff.phase) / puff.speed;
    const born = { ...cryptMistPose(puff, t0 + 0.001, 1, pose) };
    const mid = { ...cryptMistPose(puff, t0 + 0.4 / puff.speed, 1, pose) };
    const dying = { ...cryptMistPose(puff, t0 + 0.999 / puff.speed, 1, pose) };
    expect(born.z).toBeCloseTo(puff.oz, 1);
    expect(dying.z).toBeCloseTo(puff.oz + puff.dz, 0);
    expect(mid.scale).toBeGreaterThan(born.scale);
    expect(born.alpha).toBeLessThan(0.05);
    expect(mid.alpha).toBeCloseTo(1, 5);
    expect(dying.alpha).toBeLessThan(0.05);
    // it hugs the ground the whole way
    expect(mid.y).toBeLessThan(0.7);
    const still = { ...cryptMistPose(puff, 3, 0, pose) };
    expect(cryptMistPose(puff, 500, 0, pose)).toEqual(still);
  });
});

describe('the spirit sprites', () => {
  it('every modelled wick is a real candle by the stair, the altar, the lectern or the vestry', () => {
    expect(CRYPT_CANDLE_WICKS.length).toBeGreaterThanOrEqual(20);
    for (const [x, y, z] of CRYPT_CANDLE_WICKS) {
      expect(Math.hypot(x, z)).toBeLessThan(9);
      expect(y).toBeGreaterThan(-0.1);
      expect(y).toBeLessThan(1.6);
    }
    const clusters = cryptCandleClusters();
    expect(clusters.length).toBeGreaterThanOrEqual(5);
    expect(clusters.length).toBeLessThan(CRYPT_CANDLE_WICKS.length);
    expect(clusters.reduce((sum, c) => sum + c.count, 0)).toBe(CRYPT_CANDLE_WICKS.length);
    // the door lane itself carries candles on both jambs
    expect(clusters.some((c) => c.x > 1 && c.x < 2.2 && Math.abs(c.z) < 2.5)).toBe(true);
    expect(clusters.some((c) => c.x < -1 && c.x > -2.2 && Math.abs(c.z) < 2.5)).toBe(true);
  });

  it('every flame and halo burns on every tier; motes and wisps thin and are gone on low', () => {
    const count = (tier: CryptEffectsTier, kind: number) =>
      cryptSprites(tier).filter((s) => s.kind === kind).length;
    for (const tier of TIERS) {
      expect(count(tier, CRYPT_SPRITE_KIND.flame)).toBe(CRYPT_CANDLE_WICKS.length);
      expect(count(tier, CRYPT_SPRITE_KIND.halo)).toBe(cryptCandleClusters().length);
    }
    expect(TIERS.map((t) => count(t, CRYPT_SPRITE_KIND.mote))).toEqual([0, 8, 14, 20]);
    expect(TIERS.map((t) => count(t, CRYPT_SPRITE_KIND.wisp))).toEqual([0, 3, 5, 7]);
    // the night glow of the rose window goes with them on the daylight-only preset
    expect(TIERS.map((t) => count(t, CRYPT_SPRITE_KIND.rose))).toEqual([0, 1, 1, 1]);
    expect(TIERS.map((t) => count(t, CRYPT_SPRITE_KIND.shaft))).toEqual([0, 2, 2, 2]);
    // each flame stands on its own wick
    const flames = cryptSprites('ultra').filter((s) => s.kind === CRYPT_SPRITE_KIND.flame);
    flames.forEach((f, i) => {
      expect([f.x, f.y, f.z]).toEqual([...CRYPT_CANDLE_WICKS[i]]);
    });
    const rose = cryptSprites('medium').find((s) => s.kind === CRYPT_SPRITE_KIND.rose);
    expect(rose).toMatchObject({ x: CRYPT_ROSE.lx, y: CRYPT_ROSE.y, z: CRYPT_ROSE.lz });
    // the glow card stays inside the window's own opening
    expect(rose?.size).toBe(CRYPT_ROSE.radius * 2);
    const shafts = cryptSprites('ultra').filter((s) => s.kind === CRYPT_SPRITE_KIND.shaft);
    expect(shafts.map((s) => s.range).sort()).toEqual([-1, 1]);
  });

  it('wisps wander inside the nave after dusk only, and hold their place under reduced motion', () => {
    const w = CRYPT_WISP_FIELD;
    const pose: CryptSpritePose = { x: 0, y: 0, z: 0, w: 0, h: 0, alpha: 0 };
    const wisps = cryptSprites('ultra').filter((s) => s.kind === CRYPT_SPRITE_KIND.wisp);
    let moved = 0;
    for (const wisp of wisps) {
      const start = { ...cryptSpritePose(wisp, 0, 1, 1, pose) };
      for (let t = 0; t < 400; t += 3.7) {
        cryptSpritePose(wisp, t, 1, 1, pose);
        expect(pose.x).toBeGreaterThanOrEqual(w.x0 - 1e-9);
        expect(pose.x).toBeLessThanOrEqual(w.x1 + 1e-9);
        expect(pose.z).toBeGreaterThanOrEqual(w.z0 - 1e-9);
        expect(pose.z).toBeLessThanOrEqual(w.z1 + 1e-9);
        expect(pose.y).toBeGreaterThan(0.9);
        expect(pose.alpha).toBeGreaterThanOrEqual(0);
        expect(pose.alpha).toBeLessThanOrEqual(1);
        if (Math.hypot(pose.x - start.x, pose.z - start.z) > 1) moved++;
        // by day there is nothing to see
        expect(cryptSpritePose(wisp, t, 0, 1, pose).alpha).toBe(0);
      }
      const held = { ...cryptSpritePose(wisp, 5, 1, 0, pose) };
      const later = cryptSpritePose(wisp, 300, 1, 0, pose);
      expect([later.x, later.y, later.z]).toEqual([held.x, held.y, held.z]);
    }
    expect(moved).toBeGreaterThan(wisps.length * 10);
    // the rose glow is a night thing too
    const rose = cryptSprites('ultra').find((s) => s.kind === CRYPT_SPRITE_KIND.rose);
    if (!rose) throw new Error('no rose');
    expect(cryptSpritePose(rose, 12, 0, 1, pose).alpha).toBe(0);
    expect(cryptSpritePose(rose, 12, 1, 1, pose).alpha).toBeGreaterThan(0.5);
  });

  it('a flame flickers within bounds on its wick; a mote rises and fades; both stand still when motion is reduced', () => {
    const pose: CryptSpritePose = { x: 0, y: 0, z: 0, w: 0, h: 0, alpha: 0 };
    const sprites = cryptSprites('high');
    const flame = sprites.find((s) => s.kind === CRYPT_SPRITE_KIND.flame);
    const mote = sprites.find((s) => s.kind === CRYPT_SPRITE_KIND.mote);
    if (!flame || !mote) throw new Error('missing sprite');
    const heights = new Set<number>();
    for (let t = 0; t < 30; t += 0.13) {
      cryptSpritePose(flame, t, 0, 1, pose);
      expect(pose.h).toBeGreaterThan(flame.size * 0.8);
      expect(pose.h).toBeLessThan(flame.size * 1.2);
      expect(Math.abs(pose.x - flame.x)).toBeLessThan(0.02);
      expect(pose.alpha).toBeGreaterThan(0.75);
      heights.add(Math.round(pose.h * 1000));
    }
    expect(heights.size).toBeGreaterThan(20);
    const steady = { ...cryptSpritePose(flame, 1, 0, 0, pose) };
    expect(cryptSpritePose(flame, 77, 0, 0, pose)).toEqual(steady);
    const t0 = (1 - mote.phase) / mote.speed;
    const low = { ...cryptSpritePose(mote, t0 + 0.2 / mote.speed, 1, 1, pose) };
    const high = { ...cryptSpritePose(mote, t0 + 0.5 / mote.speed, 1, 1, pose) };
    expect(high.y).toBeGreaterThan(low.y + 0.3);
    expect(cryptSpritePose(mote, t0 + 0.999 / mote.speed, 1, 1, pose).alpha).toBeLessThan(0.05);
    const hung = { ...cryptSpritePose(mote, 4, 1, 0, pose) };
    expect(cryptSpritePose(mote, 400, 1, 0, pose)).toEqual(hung);
  });
});

describe('the Fallen Chapel painter', () => {
  const tier = () =>
    resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false }).tier;

  it('builds one soul light, one cull group and the cosmetic layer on the door', () => {
    hollowCryptEntranceInternalsForTest.resetCaches();
    const view = buildHollowCryptEntrance(SEED);
    expect(view.glowLights).toHaveLength(1);
    const light = view.glowLights[0];
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.color.getHex()).toBe(CRYPT_SOUL_LIGHT.color);
    const door = DUNGEONS.hollow_crypt.doorPos;
    const base = terrainHeight(door.x, door.z, SEED);
    expect(light.position.x).toBe(door.x + CRYPT_SOUL_LIGHT.lx);
    expect(light.position.y).toBeCloseTo(base + CRYPT_SOUL_LIGHT.y, 5);
    expect(light.position.z).toBeCloseTo(door.z + CRYPT_SOUL_LIGHT.lz, 5);
    // the light hangs in the portal's mouth, inside the lane
    expect(CRYPT_SOUL_LIGHT.lz).toBeGreaterThan(0);
    expect(CRYPT_SOUL_LIGHT.lz).toBeLessThan(CRYPT_STAIR.z1);
    expect(view.cullGroups.map((g) => g.name)).toEqual(['hollowCryptEntranceBody']);
    const chapel = view.cullGroups[0];
    expect(chapel.position.x).toBe(door.x);
    expect(chapel.position.z).toBe(door.z);
    expect(chapel.position.y).toBeCloseTo(base, 6);
    let points = 0;
    view.group.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) points++;
    });
    expect(points, 'exactly one point light, through the fire-light sink').toBe(1);
  });

  it('with no GLB loaded the stand-in blocks stand where the colliders are', () => {
    const view = buildHollowCryptEntrance(SEED);
    const blocks: THREE.Mesh[] = [];
    view.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry instanceof THREE.BoxGeometry) blocks.push(mesh);
    });
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    // the two sides of the stair-house leave the lane open
    expect(blocks.some((b) => b.position.x > 1.3 && Math.abs(b.position.z - 2.3) < 1)).toBe(true);
    expect(blocks.some((b) => b.position.x < -1.3 && Math.abs(b.position.z - 2.3) < 1)).toBe(true);
    for (const b of blocks) {
      if (b.position.y - b.scale.y / 2 < 3 && Math.abs(b.position.z) < 4) {
        expect(Math.abs(b.position.x) - b.scale.x / 2).toBeGreaterThanOrEqual(1.3 - 1e-9);
      }
    }
  });

  it('the stair is ONE opaque draw of the window box, on its own program, on every tier', () => {
    const view = buildHollowCryptEntrance(SEED);
    const stair = view.group.getObjectByName('hollowCryptStair') as THREE.Mesh;
    expect(stair.isMesh).toBe(true);
    const material = stair.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.customProgramCacheKey()).toBe(CRYPT_STAIR_PROGRAM_CACHE_KEY);
    expect(material).toBe(hollowCryptEntranceInternalsForTest.stairMaterial());
    // front, lid, and the back as a fan under the vault's pointed curve
    expect(stair.geometry.getIndex()?.count).toBe(12 + 14 * 3);
    const position = stair.geometry.getAttribute('position');
    const s = CRYPT_STAIR;
    for (let i = 0; i < position.count; i++) {
      // (float32 attribute storage: a rounding hair of tolerance)
      // (the back fan is a hand wider than the vault, its rim inside the masonry)
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(s.halfWidth * 1.07 + 1e-6);
      expect(position.getZ(i)).toBeGreaterThanOrEqual(s.z0 - 1e-6);
      expect(position.getZ(i)).toBeLessThanOrEqual(s.z1 + 1e-6);
      expect(position.getY(i)).toBeGreaterThanOrEqual(s.y - 1e-6);
      expect(position.getY(i)).toBeLessThanOrEqual(s.apex + 0.15);
    }
    // the shader is cut from the core's own numbers
    const glsl = hollowCryptEntranceInternalsForTest.stairCommon;
    for (const value of [s.halfWidth, s.z0, s.z1, s.y, s.apex, s.lip, s.tread, s.riser]) {
      expect(glsl).toContain(value.toFixed(3));
    }
    expect(glsl).toContain(`k < ${s.steps}`);
    expect(glsl).not.toMatch(/\bpow\s*\(/);
  });

  it('the grave mist is ONE instanced draw on the shared clock, on the ground band', () => {
    const view = buildHollowCryptEntrance(SEED);
    const mist = view.group.getObjectByName('hollowCryptGraveMist') as THREE.InstancedMesh;
    expect(mist.isInstancedMesh).toBe(true);
    expect(mist.count).toBe(cryptMistPuffCount(tier()));
    expect(mist.frustumCulled).toBe(false);
    expect(mist.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    const material = mist.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.customProgramCacheKey()).toBe(CRYPT_MIST_PROGRAM_CACHE_KEY);
    expect(mist.geometry.getAttribute('aA').count).toBe(mist.count);
    expect(mist.geometry.getAttribute('aB').count).toBe(mist.count);
    // seeded matrices span the fields, so the cull footprint is honest
    const m = new THREE.Matrix4();
    let far = 0;
    for (let i = 0; i < mist.count; i++) {
      mist.getMatrixAt(i, m);
      far = Math.max(far, Math.hypot(m.elements[12], m.elements[14]));
    }
    expect(far).toBeGreaterThan(12);
    expect(hollowCryptEntranceInternalsForTest.mistVertex).toContain('uTime');
    expect(hollowCryptEntranceInternalsForTest.mistVertex).toContain('uCrypt.y');
  });

  it('the spirit sprites are ONE instanced additive draw with no fog and no depth write', () => {
    const view = buildHollowCryptEntrance(SEED);
    const sprites = view.group.getObjectByName('hollowCryptSpiritSprites') as THREE.InstancedMesh;
    expect(sprites.isInstancedMesh).toBe(true);
    expect(sprites.count).toBe(cryptSprites(tier()).length);
    expect(sprites.frustumCulled).toBe(false);
    expect(sprites.renderOrder).toBe(floorVfxRenderOrder('ground', 2));
    const material = sprites.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.customProgramCacheKey()).toBe(CRYPT_SPRITE_PROGRAM_CACHE_KEY);
    expect(hollowCryptEntranceInternalsForTest.spriteVertex).not.toMatch(/\bpow\s*\(/);
  });

  it('the kit materials: lit stone, double-sided lit leaves, an unlit black void', () => {
    const { kitMaterial } = hollowCryptEntranceInternalsForTest;
    const stone = kitMaterial('KitStone') as THREE.MeshStandardMaterial;
    expect(stone.vertexColors).toBe(true);
    expect(stone.side).toBe(THREE.FrontSide);
    const leaf = kitMaterial('KitLeaf') as THREE.MeshStandardMaterial;
    expect(leaf.vertexColors).toBe(true);
    expect(leaf.side).toBe(THREE.DoubleSide);
    const dark = kitMaterial('KitVoid') as THREE.MeshBasicMaterial;
    expect(dark.isMeshBasicMaterial).toBe(true);
    expect(dark.color.getHex()).toBe(0x000000);
    expect(kitMaterial('KitVoid')).toBe(dark);
  });

  it('the mist hook writes the time of day into the shared effect uniform, with no allocation path', () => {
    const view = buildHollowCryptEntrance(SEED);
    const mist = view.group.getObjectByName('hollowCryptGraveMist') as THREE.InstancedMesh;
    const run = mist.onBeforeRender as unknown as () => void;
    const { uniforms } = hollowCryptEntranceInternalsForTest;
    const before = uniforms.uCrypt.value;
    setDayNightPhaseOverride(0);
    run();
    expect(uniforms.uCrypt.value.x).toBe(1);
    setDayNightPhaseOverride(0.5);
    run();
    expect(uniforms.uCrypt.value.x).toBe(0);
    // headless there is no reduced-motion source: motion stays on
    expect(uniforms.uCrypt.value.y).toBe(1);
    expect(uniforms.uCrypt.value).toBe(before);
    expect(sharedUniforms.uTime.value).toBeTypeOf('number');
  });
});
