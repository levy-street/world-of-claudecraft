import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FLAME_ATLAS_GLSL, getFlameTex } from '../src/render/ignivar_fire_vfx';
import { NythraxisSoftFire } from '../src/render/nythraxis_soft_fire';
import {
  NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX,
  NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
  NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD,
  NYTHRAXIS_SOFT_FIRE_INSET,
  NYTHRAXIS_SOFT_FIRE_RAMPS,
  NYTHRAXIS_SOFT_FIRE_SHAPES,
  NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET,
  NythraxisSoftFireBudget,
  type NythraxisSoftFireKind,
  nythraxisGraveFlameSpriteCount,
  nythraxisGravefireSpotInto,
  nythraxisGravefireSpriteCount,
  nythraxisGravefireSpritesPerYard,
  nythraxisSoftFireDiscSpotInto,
  nythraxisSoftFireSeed,
  nythraxisSoftFireSpriteCountUnderBudget,
} from '../src/render/nythraxis_soft_fire_core';
import { NYTHRAXIS_GRAVE_FLAME_CAP } from '../src/sim/nythraxis_grave_eruption';
import {
  NYTHRAXIS_GRAVEFIRE_CAP,
  NYTHRAXIS_GRAVEFIRE_LENGTH,
} from '../src/sim/nythraxis_gravefire';
import { NYTHRAXIS_SOULFIRE_CAP } from '../src/sim/nythraxis_soulfire';

const KINDS: NythraxisSoftFireKind[] = ['grave', 'soul', 'gravefire'];

describe('nythraxis soft fire core', () => {
  it('gives every mechanic a three-stop ramp of distinct colours and a positive shape', () => {
    for (const kind of KINDS) {
      const ramp = NYTHRAXIS_SOFT_FIRE_RAMPS[kind];
      expect(new Set([ramp.core, ramp.body, ramp.tip]).size).toBe(3);
      const shape = NYTHRAXIS_SOFT_FIRE_SHAPES[kind];
      expect(shape.spriteScale).toBeGreaterThan(0);
      expect(shape.rise).toBeGreaterThan(0);
      expect(shape.duration).toBeGreaterThan(0);
    }
    // Grave Flame, Soulfire, and Gravefire all read as the same purple danger
    // family (offensive-VFX purple pass): Soulfire runs warmer/redder than
    // the other two so the pools stay tellable apart.
    const grave = new THREE.Color(NYTHRAXIS_SOFT_FIRE_RAMPS.grave.body);
    const soul = new THREE.Color(NYTHRAXIS_SOFT_FIRE_RAMPS.soul.body);
    const violet = new THREE.Color(NYTHRAXIS_SOFT_FIRE_RAMPS.gravefire.body);
    expect(grave.b).toBeGreaterThan(grave.g);
    expect(soul.b).toBeGreaterThan(soul.g);
    expect(violet.b).toBeGreaterThan(violet.g);
    expect(soul.r).toBeGreaterThan(grave.r);
  });

  it('budgets patch sprites by area inside a fixed band and line sprites by yard', () => {
    expect(nythraxisGraveFlameSpriteCount(0.5)).toBe(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN);
    expect(nythraxisGraveFlameSpriteCount(40)).toBe(NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX);
    const three = nythraxisGraveFlameSpriteCount(3);
    const four = nythraxisGraveFlameSpriteCount(4);
    expect(three).toBeGreaterThan(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN);
    expect(four).toBeGreaterThan(three);
    expect(four).toBeLessThan(NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX);
    expect(nythraxisGravefireSpriteCount()).toBe(
      NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD * NYTHRAXIS_GRAVEFIRE_LENGTH,
    );
    expect(nythraxisGravefireSpriteCount(10)).toBe(NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD * 10);
    expect(nythraxisGravefireSpriteCount(10, 2)).toBe(20);
  });

  it('holds every live emitter under one global sprite ceiling, never below the floor', () => {
    const wanted = NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX;
    const budget = 1000;
    // Headroom: an emitter that fits keeps its authored density exactly.
    expect(nythraxisSoftFireSpriteCountUnderBudget(wanted, 0, budget)).toBe(wanted);
    expect(nythraxisSoftFireSpriteCountUnderBudget(wanted, budget - wanted, budget)).toBe(wanted);

    // Taper: past the ceiling the grant falls monotonically toward the floor.
    let previous = wanted;
    for (let live = budget - wanted + 1; live <= budget; live += 1) {
      const granted = nythraxisSoftFireSpriteCountUnderBudget(wanted, live, budget);
      expect(granted).toBeLessThanOrEqual(previous);
      expect(granted).toBeGreaterThanOrEqual(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN);
      previous = granted;
    }
    expect(previous).toBeLessThan(wanted);

    // Floor: saturated, and well past saturated, an emitter still burns.
    expect(nythraxisSoftFireSpriteCountUnderBudget(wanted, budget, budget)).toBe(
      NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
    );
    expect(nythraxisSoftFireSpriteCountUnderBudget(wanted, budget * 10, budget)).toBe(
      NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
    );
    // A patch that already wants no more than the floor is never inflated or cut.
    expect(
      nythraxisSoftFireSpriteCountUnderBudget(
        NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
        budget * 10,
        budget,
      ),
    ).toBe(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN);

    // The shipped ceiling sits under what the sim's own caps could ask for.
    expect(NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET).toBeGreaterThan(0);
    const uncapped =
      NYTHRAXIS_GRAVE_FLAME_CAP * nythraxisGraveFlameSpriteCount(3) +
      NYTHRAXIS_SOULFIRE_CAP * nythraxisGraveFlameSpriteCount(4) +
      NYTHRAXIS_GRAVEFIRE_CAP * nythraxisGravefireSpriteCount();
    expect(NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET).toBeLessThan(uncapped);
  });

  it('thins a line by its sprites-per-yard rate so the far end still burns', () => {
    const full = nythraxisGravefireSpriteCount();
    expect(nythraxisGravefireSpritesPerYard(full)).toBe(NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD);
    // Never above the authored rate, whatever the grant says.
    expect(nythraxisGravefireSpritesPerYard(full * 4)).toBe(NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD);
    // Never below one per yard: the last yards of a lit window keep their fire.
    expect(nythraxisGravefireSpritesPerYard(0)).toBe(1);
    expect(nythraxisGravefireSpritesPerYard(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN)).toBe(1);
    const thinned = nythraxisGravefireSpritesPerYard(Math.floor(full / 2));
    expect(thinned).toBeGreaterThanOrEqual(1);
    expect(thinned).toBeLessThan(NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD);
    // Whatever the rate, every yard of the line owns at least one sprite.
    const spot = { along: 0, across: 0 };
    const count = nythraxisGravefireSpriteCount(NYTHRAXIS_GRAVEFIRE_LENGTH, thinned);
    const yards = new Set<number>();
    for (let index = 0; index < count; index++) {
      nythraxisGravefireSpotInto(spot, index, 1.5, thinned);
      yards.add(Math.floor(spot.along));
    }
    expect(yards.size).toBe(NYTHRAXIS_GRAVEFIRE_LENGTH);
  });

  it('books and hands back sprites through the shared ledger', () => {
    const budget = new NythraxisSoftFireBudget(200);
    expect(budget.live).toBe(0);
    expect(budget.grant(96)).toBe(96);
    expect(budget.reserve(96)).toBe(96);
    expect(budget.live).toBe(96);
    expect(budget.reserve(budget.grant(96))).toBe(96);
    expect(budget.live).toBe(192);
    // Saturated: the next emitter is sized to the floor, and still built.
    const squeezed = budget.grant(96);
    expect(squeezed).toBeGreaterThanOrEqual(NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN);
    expect(squeezed).toBeLessThan(96);
    budget.reserve(squeezed);
    expect(budget.live).toBe(192 + squeezed);

    // Release round-trips exactly, and the headroom comes back with it.
    budget.release(squeezed);
    budget.release(96);
    budget.release(96);
    expect(budget.live).toBe(0);
    expect(budget.grant(96)).toBe(96);
    // Never negative, whatever a double release or a junk count says.
    budget.release(500);
    expect(budget.live).toBe(0);
    budget.reserve(-5);
    expect(budget.live).toBe(0);
  });

  it('seats disc sprites inside the inset circle, deterministically', () => {
    const spot = { dx: 0, dz: 0 };
    const seen = new Set<string>();
    for (let index = 0; index < 64; index++) {
      nythraxisSoftFireDiscSpotInto(spot, index, 3);
      expect(Math.hypot(spot.dx, spot.dz)).toBeLessThanOrEqual(
        3 * NYTHRAXIS_SOFT_FIRE_INSET + 1e-9,
      );
      seen.add(`${spot.dx.toFixed(4)},${spot.dz.toFixed(4)}`);
    }
    // Not a pile: the hashed scatter spreads the sprites out.
    expect(seen.size).toBeGreaterThan(60);
    const a = { ...nythraxisSoftFireDiscSpotInto(spot, 7, 3) };
    const b = { ...nythraxisSoftFireDiscSpotInto(spot, 7, 3) };
    expect(a).toEqual(b);
  });

  it('seats line sprites in their own yard inside the half-width, and seeds in [0, 1)', () => {
    const spot = { along: 0, across: 0 };
    for (let index = 0; index < nythraxisGravefireSpriteCount(); index++) {
      nythraxisGravefireSpotInto(spot, index, 1.5);
      const yard = Math.floor(index / NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD);
      expect(spot.along).toBeGreaterThanOrEqual(yard);
      expect(spot.along).toBeLessThan(yard + 1);
      expect(Math.abs(spot.across)).toBeLessThanOrEqual(1.5 * NYTHRAXIS_SOFT_FIRE_INSET + 1e-9);
      const seed = nythraxisSoftFireSeed(index);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
    }
    expect(nythraxisSoftFireSeed(11)).toBe(nythraxisSoftFireSeed(11));
    expect(nythraxisSoftFireSeed(11)).not.toBe(nythraxisSoftFireSeed(12));
  });
});

describe('NythraxisSoftFire emitter', () => {
  it('is one instanced additive draw on the shared flame atlas, coloured by its kind', () => {
    const fire = new NythraxisSoftFire('soul', 24, 'fire-test', 13);
    expect(fire.mesh.name).toBe('fire-test');
    expect(fire.mesh.renderOrder).toBe(13);
    expect(fire.mesh.frustumCulled).toBe(true);
    expect(fire.mesh.userData.renderCategory).toBe('ui3d');
    expect(fire.count).toBe(24);
    expect(fire.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(fire.geometry.instanceCount).toBe(24);
    expect(fire.geometry.getAttribute('iSeed').count).toBe(24);
    expect(fire.geometry.getAttribute('iSpot').count).toBe(24);
    expect(fire.geometry.getAttribute('iAlong').count).toBe(24);
    expect(fire.geometry.boundingSphere).not.toBeNull();

    const material = fire.material;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uTex.value).toBe(getFlameTex());
    const ramp = NYTHRAXIS_SOFT_FIRE_RAMPS.soul;
    expect((material.uniforms.uCore.value as THREE.Color).getHex()).toBe(ramp.core);
    expect((material.uniforms.uBody.value as THREE.Color).getHex()).toBe(ramp.body);
    expect((material.uniforms.uTip.value as THREE.Color).getHex()).toBe(ramp.tip);
    const shape = NYTHRAXIS_SOFT_FIRE_SHAPES.soul;
    expect(material.uniforms.uSpriteScale.value).toBe(shape.spriteScale);
    expect(material.uniforms.uRise.value).toBe(shape.rise);
    expect(material.uniforms.uDuration.value).toBe(shape.duration);
    // The shader addresses the atlas through the shared helpers and reads the spot attributes.
    expect(material.vertexShader).toContain(FLAME_ATLAS_GLSL);
    expect(material.vertexShader).toContain('iSpot');
    expect(material.vertexShader).toContain('uTail');
    expect(material.fragmentShader).toContain('uCore');
    fire.dispose();
  });

  it('starts with an open window so a patch shows every sprite', () => {
    const fire = new NythraxisSoftFire('grave', 8, 'fire-test', 13);
    expect(fire.material.uniforms.uTail.value).toBeLessThan(-1e6);
    expect(fire.material.uniforms.uHead.value).toBeGreaterThan(1e6);
    expect(fire.material.uniforms.uHeadBoost.value).toBe(1);
    fire.dispose();
  });

  it('writes spots and windows into the buffers and uniforms', () => {
    const fire = new NythraxisSoftFire('gravefire', 8, 'fire-test', 15);
    const spots = fire.geometry.getAttribute('iSpot') as THREE.InstancedBufferAttribute;
    const version = spots.version;
    fire.setSpot(3, 1, 2, 3, 4.5);
    expect(fire.spotY(3)).toBe(2);
    expect(fire.spotAlong(3)).toBe(4.5);
    fire.commitSpots();
    expect(spots.version).toBeGreaterThan(version);
    fire.setWindow(2, 8, 6, 1.4);
    expect(fire.material.uniforms.uTail.value).toBe(2);
    expect(fire.material.uniforms.uHead.value).toBe(8);
    expect(fire.material.uniforms.uHeadCapTail.value).toBe(6);
    expect(fire.material.uniforms.uHeadBoost.value).toBe(1.4);
    fire.setOpacity(0.4);
    expect(fire.material.uniforms.uOpacity.value).toBe(0.4);
    const center = new THREE.Vector3(5, 1, 5);
    fire.setBoundingSphere(center, 9);
    expect(fire.geometry.boundingSphere?.center.equals(center)).toBe(true);
    expect(fire.geometry.boundingSphere?.radius).toBe(9);
    fire.dispose();
  });

  it('runs its clock into the time uniform and holds it under reduced motion', () => {
    const fire = new NythraxisSoftFire('grave', 8, 'fire-test', 13);
    expect(fire.material.uniforms.uTime.value).toBe(0);
    fire.update(0.5, false);
    expect(fire.clock).toBeCloseTo(0.5, 9);
    expect(fire.material.uniforms.uTime.value).toBeCloseTo(0.5, 9);
    fire.update(0.5, true);
    expect(fire.material.uniforms.uTime.value).toBeCloseTo(0.5, 9);
    fire.update(-1, false);
    expect(fire.material.uniforms.uTime.value).toBeCloseTo(0.5, 9);
    fire.dispose();
  });

  it('disposes its own geometry and material, never the shared atlas', () => {
    const parent = new THREE.Group();
    const fire = new NythraxisSoftFire('soul', 8, 'fire-test', 13);
    parent.add(fire.mesh);
    const geometryDispose = vi.spyOn(fire.geometry, 'dispose');
    const materialDispose = vi.spyOn(fire.material, 'dispose');
    const atlasDispose = vi.spyOn(getFlameTex(), 'dispose');
    fire.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(atlasDispose).not.toHaveBeenCalled();
    expect(fire.mesh.parent).toBeNull();
    // Two emitters never share a quad buffer, so one disposal cannot starve the other.
    const a = new NythraxisSoftFire('grave', 4, 'a', 13);
    const b = new NythraxisSoftFire('grave', 4, 'b', 13);
    expect(a.geometry.getAttribute('position')).not.toBe(b.geometry.getAttribute('position'));
    a.dispose();
    b.dispose();
  });
});
