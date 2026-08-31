import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildVarkhulCinderFire,
  buildVarkhulCinderOrbProjectile,
  VarkhulCinderOrbVisuals,
} from '../src/render/varkhul_cinder_orb_visual';
import type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../src/sim/varkhul_cinder_orbs';

const FIRE: ActiveVarkhulCinderFire = {
  id: '42:cinder-fire:3:0',
  sourceId: 42,
  x: 7,
  z: -5,
  radius: 3.5,
};

const ORB: ActiveVarkhulCinderOrbProjectile = {
  id: '42:cinder-orbs:3:0:0',
  sourceId: 42,
  x: 3,
  z: 4,
  dirX: 1,
  dirZ: 0,
  radius: 1.1,
  duration: 5.5,
  remaining: 5,
};

describe('Varkhul Cinder Orbs POWERFUL VFX', () => {
  it('renders permanent living fire inside the exact actionable boundary', () => {
    const group = buildVarkhulCinderFire(FIRE, 2);
    expect(group.userData).toMatchObject({
      actionable: true,
      fireId: FIRE.id,
      radius: 3.5,
      permanent: true,
    });
    expect(group.position.toArray()).toEqual([7, 2.09, -5]);
    const flames = group.getObjectByName('ground_fire_aoe__flames') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(flames).toBeInstanceOf(THREE.Mesh);
    expect(flames.material.uniforms.uOuterRadiusRatio.value).toBe(0.82);
    expect(group.getObjectByName('varkhul-cinder-orb-core')).toBeUndefined();

    const edge = group.getObjectByName('varkhul-cinder-fire-edge') as THREE.Mesh;
    const positions = edge.geometry.getAttribute('position');
    let maxRadius = 0;
    for (let index = 0; index < positions.count; index++) {
      maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
    }
    expect(maxRadius).toBeCloseTo(FIRE.radius, 5);
  });

  it('renders a large directional layered fireball with a readable tail', () => {
    const group = buildVarkhulCinderOrbProjectile(ORB, 2);
    expect(group.userData).toMatchObject({
      actionable: true,
      projectileId: ORB.id,
      radius: 1.1,
      dirX: 1,
      dirZ: 0,
    });
    expect(group.position.toArray()).toEqual([3, 3.05, 4]);
    expect(group.scale.toArray()).toEqual([1, 1, 1]);

    const core = group.getObjectByName('varkhul-cinder-orb-core') as THREE.Mesh;
    const shell = group.getObjectByName('varkhul-cinder-orb-shell') as THREE.Mesh;
    const tail = group.getObjectByName('varkhul-cinder-orb-tail') as THREE.Group;
    expect((core.geometry as THREE.IcosahedronGeometry).parameters.radius).toBe(0.76);
    expect((shell.geometry as THREE.IcosahedronGeometry).parameters.radius).toBe(1.1);
    expect(tail.children).toHaveLength(3);
    const assemblyOrb = buildVarkhulCinderOrbProjectile(
      { ...ORB, id: '42:assembly-links:0:0:0', radius: 1.45, duration: 7 },
      2,
    );
    expect(assemblyOrb.scale.x).toBeCloseTo(1.45 / 1.1, 5);
  });

  it('reconciles permanent fires and authoritative traveling projectile positions', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulCinderOrbVisuals(scene, () => 0);
    visuals.sync([FIRE], [ORB]);
    expect(scene.getObjectByName('varkhul-cinder-fire')).toBeInstanceOf(THREE.Group);
    const projectile = scene.getObjectByName('varkhul-cinder-orb-projectile') as THREE.Group;
    expect(projectile.position.toArray()).toEqual([3, 1.05, 4]);

    visuals.sync([FIRE], [{ ...ORB, x: 8, z: -2, dirX: 0, dirZ: -1 }]);
    expect(projectile.position.toArray()).toEqual([8, 1.05, -2]);
    expect(projectile.rotation.y).toBeCloseTo(Math.PI, 5);

    visuals.sync([], []);
    expect(scene.getObjectByName('varkhul-cinder-fire')).toBeUndefined();
    expect(scene.getObjectByName('varkhul-cinder-orb-projectile')).toBeUndefined();
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('freezes ambient projectile motion while reduced motion keeps snapshot movement', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulCinderOrbVisuals(scene, () => 0);
    visuals.sync([], [ORB]);
    const projectile = scene.getObjectByName('varkhul-cinder-orb-projectile') as THREE.Group;
    const shell = projectile.getObjectByName('varkhul-cinder-orb-shell') as THREE.Mesh;
    visuals.update(0.5, true);
    const rotation = shell.rotation.y;
    const scale = shell.scale.toArray();
    visuals.update(0.5, true);
    expect(shell.rotation.y).toBe(rotation);
    expect(shell.scale.toArray()).toEqual(scale);

    visuals.sync([], [{ ...ORB, x: 9 }]);
    expect(projectile.position.x).toBe(9);
    visuals.dispose();
  });

  it('never pulses the visible flame shell inside the authoritative hit radius', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulCinderOrbVisuals(scene, () => 0);
    visuals.sync([], [ORB]);
    const shell = scene.getObjectByName('varkhul-cinder-orb-shell') as THREE.Mesh;
    visuals.update(0.7, false);
    expect(shell.scale.x).toBeGreaterThanOrEqual(1);
    visuals.update(0.7, false);
    expect(shell.scale.x).toBeGreaterThanOrEqual(1);
    visuals.dispose();
  });

  it('keeps both renderer frame paths on the combined world projection', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(
      renderer.match(/this\.varkhulForgestormVisuals\?\.syncWorld\(this\.sim\)/g),
    ).toHaveLength(2);
    const compositor = readFileSync(
      new URL('../src/render/varkhul_forgestorm_visual.ts', import.meta.url),
      'utf8',
    );
    expect(compositor).toContain('world.activeVarkhulCinderFires');
    expect(compositor).toContain('world.activeVarkhulCinderOrbProjectiles');
    expect(compositor).toContain('this.cinderOrbVisuals.update(dt, reducedMotion);');
  });
});
