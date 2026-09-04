// Grave Flame and Soulfire rows become palette-specific ground-fire decals,
// one per row, tier-independent, disposed when a row goes.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { abilityVfxFullSpecFor } from '../src/render/ability_vfx/encounter_specs';
import { getFlameTex } from '../src/render/ignivar_fire_vfx';
import { INTERIOR_ENCOUNTER_PREWARM } from '../src/render/interior_encounter_prewarm';
import {
  NYTHRAXIS_GRAVE_FLAME_GROUND_LIFT,
  NYTHRAXIS_GRAVE_FLAME_PALETTE,
  NYTHRAXIS_SOUL_FLAME_PALETTE,
  nythraxisFlamePalette,
  nythraxisGraveFlamePlanInto,
  nythraxisGraveFlamePulseInto,
} from '../src/render/nythraxis_grave_core';
import {
  buildNythraxisGraveFlamePatch,
  buildNythraxisGravePrewarmVisual,
  NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME,
  NYTHRAXIS_GRAVE_FLAME_FILL_NAME,
  NYTHRAXIS_GRAVE_FLAME_FIRE_NAME,
  NYTHRAXIS_GRAVE_FLAME_RIM_NAME,
  NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME,
  NYTHRAXIS_GRAVE_PREWARM_NAME,
  NythraxisGraveFlameVisuals,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_SOFT_FIRE_INSET,
  NYTHRAXIS_SOFT_FIRE_RAMPS,
  NYTHRAXIS_SOFT_FIRE_SHAPES,
  nythraxisGraveFlameSpriteCount,
} from '../src/render/nythraxis_soft_fire_core';
import {
  type ActiveNythraxisGraveFlame,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
} from '../src/sim/nythraxis_grave_eruption';
import { NYTHRAXIS_SOULFIRE_CAST_ID } from '../src/sim/nythraxis_soulfire';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const FLAME: ActiveNythraxisGraveFlame = {
  id: '42:gf:3',
  sourceId: 42,
  kind: 'grave',
  x: 7,
  z: -5,
  radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  duration: 12,
  remaining: 12,
};

const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

type FireMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

function fireOf(root: THREE.Object3D): FireMesh {
  return root.getObjectByName(NYTHRAXIS_GRAVE_FLAME_FIRE_NAME) as FireMesh;
}

function maxRadiusOf(mesh: THREE.Mesh): number {
  const positions = mesh.geometry.getAttribute('position');
  let maxRadius = 0;
  for (let index = 0; index < positions.count; index++) {
    maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return maxRadius;
}

describe('Nythraxis Grave Flame rendering', () => {
  it('builds the authoritative radius as tier-independent actionable geometry', () => {
    // No graphics-tier input reaches the builder at all (the module never
    // imports gfx.ts), so two builds are the same geometry by construction.
    expect(readSource('../src/render/nythraxis_grave_flame_visual.ts')).not.toMatch(
      /from '\.\/gfx'/,
    );
    const first = buildNythraxisGraveFlamePatch(FLAME, 3);
    const second = buildNythraxisGraveFlamePatch(FLAME, 3);
    for (const visual of [first, second]) {
      expect(visual.name).toBe(NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME);
      expect(visual.userData).toMatchObject({
        renderCategory: 'ui3d',
        actionable: true,
        flameId: FLAME.id,
        sourceId: FLAME.sourceId,
        radius: FLAME.radius,
      });
      expect(visual.position.toArray()).toEqual([
        FLAME.x,
        3 + NYTHRAXIS_GRAVE_FLAME_GROUND_LIFT,
        FLAME.z,
      ]);
      const rim = visual.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
      expect(maxRadiusOf(rim)).toBeCloseTo(FLAME.radius, 5);
      const fill = visual.getObjectByName(NYTHRAXIS_GRAVE_FLAME_FILL_NAME) as THREE.Mesh;
      expect(maxRadiusOf(fill)).toBeLessThan(FLAME.radius);
      expect(visual.getObjectByName(NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME)).toBeDefined();
      const fire = fireOf(visual);
      expect(fire.geometry.instanceCount).toBe(nythraxisGraveFlameSpriteCount(FLAME.radius));
      expect((rim.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
        NYTHRAXIS_GRAVE_FLAME_PALETTE.rim,
      );
    }
    const firstRim = first.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    const secondRim = second.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    expect(firstRim.geometry.getAttribute('position').count).toBe(
      secondRim.geometry.getAttribute('position').count,
    );
  });

  it('burns a soft sprite fire over the patch, seated inside the circle on the ground', () => {
    const patch = buildNythraxisGraveFlamePatch(FLAME, 3);
    const fire = fireOf(patch);
    expect(fire).toBeInstanceOf(THREE.Mesh);
    expect(fire.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(fire.material.blending).toBe(THREE.AdditiveBlending);
    expect(fire.material.depthWrite).toBe(false);
    expect(fire.material.uniforms.uTex.value).toBe(getFlameTex());
    expect((fire.material.uniforms.uBody.value as THREE.Color).getHex()).toBe(
      NYTHRAXIS_SOFT_FIRE_RAMPS.grave.body,
    );
    // A patch is lit end to end: the window is open and nothing is boosted.
    expect(fire.material.uniforms.uTail.value).toBeLessThan(-1e6);
    expect(fire.material.uniforms.uHead.value).toBeGreaterThan(1e6);
    expect(fire.material.uniforms.uHeadBoost.value).toBe(1);
    const spots = fire.geometry.getAttribute('iSpot');
    for (let index = 0; index < fire.geometry.instanceCount; index++) {
      expect(Math.hypot(spots.getX(index), spots.getZ(index))).toBeLessThanOrEqual(
        FLAME.radius * NYTHRAXIS_SOFT_FIRE_INSET + 1e-9,
      );
      expect(spots.getY(index)).toBe(0);
    }
    expect(fire.renderOrder).toBeGreaterThan(
      (patch.getObjectByName(NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME) as THREE.Mesh).renderOrder,
    );
  });

  it('keys Grave Flame and Soulfire materials on the authoritative row kind', () => {
    expect(nythraxisFlamePalette('grave')).toBe(NYTHRAXIS_GRAVE_FLAME_PALETTE);
    expect(nythraxisFlamePalette('soul')).toBe(NYTHRAXIS_SOUL_FLAME_PALETTE);
    const grave = buildNythraxisGraveFlamePatch(FLAME, 0);
    const soul = buildNythraxisGraveFlamePatch(
      { ...FLAME, id: '42:sf:1', kind: 'soul', radius: 4 },
      0,
    );
    const graveRim = grave.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    const soulFill = soul.getObjectByName(NYTHRAXIS_GRAVE_FLAME_FILL_NAME) as THREE.Mesh;
    const soulRim = soul.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    const soulEmbers = soul.getObjectByName(NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME) as THREE.Mesh;
    const soulFire = fireOf(soul);
    expect((graveRim.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_GRAVE_FLAME_PALETTE.rim,
    );
    expect((soulRim.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_SOUL_FLAME_PALETTE.rim,
    );
    expect((soulFill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_SOUL_FLAME_PALETTE.fill,
    );
    expect((soulEmbers.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_SOUL_FLAME_PALETTE.ember,
    );
    expect((soulFire.material.uniforms.uBody.value as THREE.Color).getHex()).toBe(
      NYTHRAXIS_SOFT_FIRE_RAMPS.soul.body,
    );
    expect(soulFire.material.uniforms.uRise.value).toBe(NYTHRAXIS_SOFT_FIRE_SHAPES.soul.rise);
    expect(soulFire.geometry.instanceCount).toBe(nythraxisGraveFlameSpriteCount(4));
    expect(maxRadiusOf(graveRim)).toBeCloseTo(3, 5);
    expect(maxRadiusOf(soulRim)).toBeCloseTo(4, 5);
    expect(soul.userData.kind).toBe('soul');
    expect(abilityVfxFullSpecFor(NYTHRAXIS_SOULFIRE_CAST_ID)).toMatchObject({
      archetype: 'dot',
      palette: 'blood',
      filler: true,
      tint: '#ff6a4a',
    });
  });

  it('frustum-culls the fire with a reusable conservative patch bound', () => {
    const patch = buildNythraxisGraveFlamePatch(FLAME, 3);
    const fire = fireOf(patch);
    expect(fire.frustumCulled).toBe(true);
    expect(fire.geometry.boundingSphere).not.toBeNull();
    const shape = NYTHRAXIS_SOFT_FIRE_SHAPES.grave;
    expect(fire.geometry.boundingSphere?.center.toArray()).toEqual([0, shape.rise * 0.5, 0]);
    expect(fire.geometry.boundingSphere?.radius).toBeGreaterThanOrEqual(FLAME.radius + shape.rise);

    const scene = new THREE.Scene();
    const visuals = new NythraxisGraveFlameVisuals(scene, () => 0);
    visuals.sync([FLAME]);
    const liveFire = fireOf(scene.children[0]);
    const bound = liveFire.geometry.boundingSphere;
    visuals.update(0.1);
    expect(liveFire.geometry.boundingSphere).toBe(bound);
    expect(liveFire.geometry.boundingSphere?.radius).toBeGreaterThanOrEqual(
      FLAME.radius + shape.rise,
    );
  });

  it('creates one patch per row, keeps it across snapshots, and samples the ground once', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn(() => 2);
    const visuals = new NythraxisGraveFlameVisuals(scene, groundY);
    visuals.sync([FLAME, { ...FLAME, id: '42:gf:4', x: 12 }]);
    const patches = scene.children.filter((c) => c.name === NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME);
    expect(patches).toHaveLength(2);
    expect(groundY).toHaveBeenCalledTimes(2);
    const first = patches.find((c) => c.userData.flameId === FLAME.id) as THREE.Group;
    visuals.sync([
      { ...FLAME, remaining: 6 },
      { ...FLAME, id: '42:gf:4', x: 12, remaining: 6 },
    ]);
    visuals.update(0.1);
    expect(scene.children.find((c) => c.userData.flameId === FLAME.id)).toBe(first);
    expect(groundY).toHaveBeenCalledTimes(2);
  });

  it('disposes a patch the frame its row vanishes, and everything on dispose', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGraveFlameVisuals(scene, () => 0);
    visuals.sync([FLAME, { ...FLAME, id: '42:gf:4', x: 12 }]);
    const first = scene.children.find((c) => c.userData.flameId === FLAME.id) as THREE.Group;
    const rim = first.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    const fill = first.getObjectByName(NYTHRAXIS_GRAVE_FLAME_FILL_NAME) as THREE.Mesh;
    const embers = first.getObjectByName(NYTHRAXIS_GRAVE_FLAME_EMBERS_NAME) as THREE.Mesh;
    const fire = fireOf(first);
    const materialDisposes = [fill, rim, embers, fire].map((mesh) =>
      vi.spyOn(mesh.material as THREE.Material, 'dispose'),
    );
    const geometryDisposes = [fill, rim, embers, fire].map((mesh) =>
      vi.spyOn(mesh.geometry, 'dispose'),
    );
    const atlasDispose = vi.spyOn(getFlameTex(), 'dispose');
    expect(scene.children).toHaveLength(2);
    visuals.sync([{ ...FLAME, id: '42:gf:4', x: 12 }]);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0].userData.flameId).toBe('42:gf:4');
    for (const dispose of materialDisposes) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of geometryDisposes) expect(dispose).toHaveBeenCalledOnce();
    expect(atlasDispose).not.toHaveBeenCalled();
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
    // An empty sync after dispose is a no-op, not a rebuild.
    visuals.sync([]);
    expect(scene.children).toHaveLength(0);
  });

  it('breathes the rim above a readable floor, runs the fire clock, and settles both for reduced motion', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGraveFlameVisuals(scene, () => 0);
    visuals.sync([FLAME]);
    const patch = scene.children[0] as THREE.Group;
    const rim = patch.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
    const fire = fireOf(patch);
    const rimMaterial = rim.material as THREE.MeshBasicMaterial;

    visuals.update(0.5, true);
    const settled = rimMaterial.opacity;
    const heldTime = fire.material.uniforms.uTime.value;
    visuals.update(0.5, true);
    expect(rimMaterial.opacity).toBe(settled);
    expect(fire.material.uniforms.uTime.value).toBe(heldTime);
    expect(settled).toBeGreaterThan(0.75);

    for (let step = 0; step < 12; step++) {
      visuals.update(0.1);
      expect(rimMaterial.opacity).toBeGreaterThan(0.75);
    }
    expect(fire.material.uniforms.uTime.value).toBeCloseTo(heldTime + 1.2, 6);
    // The fire's opacity rides the same pulse as the footprint.
    expect(fire.material.uniforms.uOpacity.value).toBeGreaterThan(0);
  });

  it('syncs the world projection field the renderer hands it', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGraveFlameVisuals(scene, () => 0);
    visuals.syncWorld({ activeNythraxisGraveFlames: [FLAME] });
    expect(scene.children.map((c) => c.userData.flameId)).toEqual([FLAME.id]);
    visuals.syncWorld({ activeNythraxisGraveFlames: [] });
    expect(scene.children).toHaveLength(0);
  });

  it('is wired at both renderer frame paths and torn down with the renderer', () => {
    const renderer = readSource('../src/render/renderer.ts');
    expect(
      renderer.match(/this\.nythraxisMechanicVisuals\?\.syncWorld\(this\.sim\);/g),
    ).toHaveLength(2);
    expect(
      renderer.match(/this\.nythraxisMechanicVisuals\?\.update\(dt, this\.reducedMotion\(\)\);/g),
    ).toHaveLength(2);
    expect(renderer).toContain('new NythraxisMechanicVisuals(this.scene');
    expect(renderer.match(/this\.nythraxisMechanicVisuals\?\.dispose\(\)/g)).toHaveLength(2);
    const facade = readSource('../src/render/nythraxis_mechanic_visuals.ts');
    expect(facade).toContain('this.flames.syncWorld(world)');
    expect(facade).toContain('this.flames.dispose()');
  });

  it('has its prewarm home at the crypt attach, staging both patches and the eruption', () => {
    expect(INTERIOR_ENCOUNTER_PREWARM.nythraxis.nythraxisGraveVisuals).toBe(true);
    expect(INTERIOR_ENCOUNTER_PREWARM.ignivar_depths.nythraxisGraveVisuals).toBeUndefined();
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    expect(pass).toContain('spec.nythraxisGraveVisuals');
    expect(pass).toContain('buildNythraxisGravePrewarmVisual()');

    const root = buildNythraxisGravePrewarmVisual();
    expect(root.name).toBe(NYTHRAXIS_GRAVE_PREWARM_NAME);
    const patches = root.children.filter((c) => c.name === NYTHRAXIS_GRAVE_FLAME_VISUAL_NAME);
    // Both fire programs (green and red ramps) are staged so neither links under a cast.
    expect(patches.map((c) => c.userData.kind).sort()).toEqual(['grave', 'soul']);
    for (const patch of patches) expect(fireOf(patch)).toBeDefined();
    const eruption = root.getObjectByName('mage-meteor-fx') as THREE.Group;
    expect(eruption.userData.graveEruption).toBe(true);
    // The landed shard burst is staged (instanced program), the fire-only
    // falling body is not drawn.
    expect(root.getObjectByName('mage-meteor-telegraph-flames')?.visible).toBe(true);
    expect(root.getObjectByName('mage-meteor-body')?.visible).toBe(false);
    expect(root.getObjectByName('mage-meteor-trail')?.visible).toBe(false);
    expect(root.getObjectByName('ground_fire_aoe')).toBeUndefined();
  });
});

describe('Nythraxis grave flame core', () => {
  it('plans the patch on the sampled ground and pulses inside readable bounds', () => {
    const plan = { id: '', sourceId: 0, x: 0, y: 0, z: 0, radius: 0 };
    expect(nythraxisGraveFlamePlanInto(plan, FLAME, 1.5)).toEqual({
      id: FLAME.id,
      sourceId: FLAME.sourceId,
      x: FLAME.x,
      y: 1.5 + NYTHRAXIS_GRAVE_FLAME_GROUND_LIFT,
      z: FLAME.z,
      radius: FLAME.radius,
    });
    const pulse = { rim: 0, fill: 0, ember: 0, tongue: 0 };
    for (const phase of [0, 1, 2, 3, 4, 5, 6]) {
      nythraxisGraveFlamePulseInto(pulse, phase, false);
      expect(pulse.rim).toBeGreaterThanOrEqual(0.78);
      expect(pulse.rim).toBeLessThanOrEqual(0.96);
      expect(pulse.fill).toBeGreaterThan(0);
      expect(pulse.tongue).toBeGreaterThan(0);
    }
    const reduced = nythraxisGraveFlamePulseInto(pulse, 1.3, true);
    expect(reduced.rim).toBeCloseTo(0.87, 5);
  });
});
