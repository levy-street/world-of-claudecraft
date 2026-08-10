import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { POWERFUL_FEL_METEOR_TEXTURE_URL, WarlockMeteorFx } from '../src/render/warlock_meteor_fx';
import {
  planRainMeteorShower,
  routeWarlockMeteorSpellfxAt,
  warlockMeteorDensityScale,
} from '../src/render/warlock_meteor_fx_core';

describe('Warlock fel meteor visuals', () => {
  it('layers the POWERFUL VFX texture into fel-green meteor impacts', () => {
    expect(POWERFUL_FEL_METEOR_TEXTURE_URL).toBe('/vfx/fel_meteor_impact.png');
    expect(
      readFileSync(new URL('../public/vfx/fel_meteor_impact.png', import.meta.url)).byteLength,
    ).toBeGreaterThan(100_000);
    const painterSource = readFileSync(
      new URL('../src/render/warlock_meteor_fx.ts', import.meta.url),
      'utf8',
    );
    expect(painterSource).toMatch(
      /registerDeferredPreload\(\(\) =>\s*loadTexture\(POWERFUL_FEL_METEOR_TEXTURE_URL, \{ srgb: true \}\)\.then\(\(texture\) => \{\s*powerfulFelMeteorTexture = texture/,
    );
    expect(painterSource).toMatch(
      /powerfulImpactTexture: THREE\.Texture \| null = powerfulFelMeteorTexture/,
    );

    const scene = new THREE.Scene();
    const powerfulTexture = new THREE.Texture();
    const fx = new WarlockMeteorFx(scene, () => 0, vi.fn(), powerfulTexture);
    fx.spawnRain({ x: 0, z: 0, radius: 7, duration: 1, sourceId: 5 });
    fx.update(0.1);
    fx.update(0.8);

    const sprite = scene.getObjectByName('warlock-powerful-fel-impact') as THREE.Sprite;
    expect(sprite).toBeDefined();
    expect(sprite.material.map).toBe(powerfulTexture);
    expect(sprite.material.blending).toBe(THREE.AdditiveBlending);
    expect(sprite.material.color.g).toBeGreaterThan(sprite.material.color.r * 2);
  });

  it('plans the same bounded shower from the same authored event', () => {
    const spawn = { x: 10, z: 20, radius: 7, duration: 4, sourceId: 42 };
    const first = planRainMeteorShower(spawn);
    const second = planRainMeteorShower(spawn);

    expect(first).toEqual(second);
    expect(first.count).toBeGreaterThanOrEqual(24);
    expect(first.count).toBeLessThanOrEqual(40);
    expect(first.pending).toHaveLength(first.count);
    expect(first.pending.map((meteor) => meteor.at)).toEqual(
      [...first.pending].sort((a, b) => a.at - b.at || a.seed - b.seed).map((meteor) => meteor.at),
    );
    expect(first.pending.every((meteor) => meteor.at >= 0 && meteor.at < first.duration)).toBe(
      true,
    );
    expect(first.pending.every((meteor) => meteor.at + meteor.fallDuration <= first.duration)).toBe(
      true,
    );
  });

  it('fills Rain of Fire with many compact green meteors rather than one hero rock', () => {
    const scene = new THREE.Scene();
    const impact = vi.fn();
    const fx = new WarlockMeteorFx(scene, () => 2, impact);

    fx.spawnRain({ x: 10, z: 20, radius: 7, duration: 6, sourceId: 42 });

    const shower = scene.getObjectByName('warlock-fel-meteor-rain') as THREE.Group;
    const fragmentCount = shower.userData.fragmentCount as number;
    expect(fragmentCount).toBeGreaterThanOrEqual(24);
    expect(fragmentCount).toBeLessThanOrEqual(40);

    fx.update(0.1);
    const fragments = shower.children.filter(
      (child) => child.name === 'warlock-fel-meteor-fragment',
    ) as THREE.Group[];
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.length).toBeLessThan(fragmentCount);

    const firstRock = fragments[0].getObjectByName('warlock-fel-meteor-rock') as THREE.Mesh<
      THREE.IcosahedronGeometry,
      THREE.MeshStandardMaterial
    >;
    const firstCore = fragments[0].getObjectByName('warlock-fel-meteor-core') as THREE.Mesh<
      THREE.SphereGeometry,
      THREE.MeshBasicMaterial
    >;
    const firstTrail = fragments[0].getObjectByName('warlock-fel-meteor-trail') as THREE.Group;
    expect(firstRock.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect(firstRock.scale.x).toBeLessThan(0.65);
    expect(firstRock.material.emissive.g).toBeGreaterThan(firstRock.material.emissive.r);
    expect(firstCore.material.color.g).toBeGreaterThan(firstCore.material.color.r);
    expect(firstTrail.children.length).toBeGreaterThanOrEqual(3);

    fx.update(0.3);
    const visibleFragments = shower.children.filter(
      (child) => child.name === 'warlock-fel-meteor-fragment',
    ) as THREE.Group[];
    expect(visibleFragments.length).toBeGreaterThan(1);
    for (const fragment of visibleFragments) {
      const rock = fragment.getObjectByName('warlock-fel-meteor-rock') as THREE.Mesh<
        THREE.IcosahedronGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(rock.scale.x).toBeLessThan(0.65);
      expect(rock.material.emissive.g).toBeGreaterThan(rock.material.emissive.r);
    }
    expect(impact).not.toHaveBeenCalled();
    fx.update(0.6);
    const firstWave = impact.mock.calls.filter(([event]) => event.kind === 'rain').length;
    expect(firstWave).toBeGreaterThan(0);
    expect(firstWave).toBeLessThan(fragmentCount);

    fx.update(6);
    expect(impact.mock.calls.filter(([event]) => event.kind === 'rain').length).toBe(fragmentCount);
    expect(scene.getObjectByName('warlock-fel-meteor-impact')).toBeDefined();

    fx.update(1);
    expect(scene.getObjectByName('warlock-fel-meteor-rain')).toBeUndefined();
    expect(scene.getObjectByName('warlock-fel-meteor-impact')).toBeUndefined();
  });

  it('lands the Infernal meteor on schedule with a larger Legion-green impact', () => {
    const scene = new THREE.Scene();
    const impact = vi.fn();
    const fx = new WarlockMeteorFx(scene, () => 3, impact);

    fx.spawnInfernal({ x: 4, z: 7, radius: 6, duration: 1.2, sourceId: 9 });

    const meteor = scene.getObjectByName('warlock-fel-infernal-meteor') as THREE.Group;
    const rock = meteor.getObjectByName('warlock-fel-meteor-rock') as THREE.Mesh<
      THREE.IcosahedronGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(rock.material.emissive.g).toBeGreaterThan(rock.material.emissive.r * 2);
    expect(meteor.getObjectByName('warlock-fel-infernal-telegraph')).toBeDefined();

    fx.update(1.15);
    expect(impact).not.toHaveBeenCalled();
    expect(scene.getObjectByName('warlock-fel-infernal-meteor')).toBe(meteor);

    fx.update(0.05);
    expect(impact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'infernal', x: 4, z: 7, radius: 6, sourceId: 9 }),
    );
    expect(scene.getObjectByName('warlock-fel-infernal-meteor')).toBeUndefined();

    const landing = scene.getObjectByName('warlock-fel-meteor-impact') as THREE.Group;
    expect(landing.scale.x).toBeGreaterThan(1);
    expect(landing.getObjectByName('warlock-fel-impact-fissures')).toBeDefined();

    fx.update(2);
    expect(scene.getObjectByName('warlock-fel-meteor-impact')).toBeUndefined();
  });

  it('routes both authored event kinds through the shared renderer seam', () => {
    const sink = {
      spawnRain: vi.fn(),
      spawnInfernal: vi.fn(),
      stopRain: vi.fn(),
    };

    expect(
      routeWarlockMeteorSpellfxAt(
        {
          type: 'spellfxAt',
          fx: 'felMeteorRain',
          x: 1,
          z: 2,
          school: 'fire',
          radius: 7,
          duration: 6,
          sourceId: 3,
        },
        sink,
        0.55,
      ),
    ).toBe(true);
    expect(sink.spawnRain).toHaveBeenCalledWith({
      x: 1,
      z: 2,
      radius: 7,
      duration: 6,
      sourceId: 3,
      densityScale: 0.55,
    });

    expect(
      routeWarlockMeteorSpellfxAt(
        {
          type: 'spellfxAt',
          fx: 'felMeteorFall',
          x: 4,
          z: 5,
          school: 'fire',
          radius: 6,
          duration: 1.2,
          sourceId: 9,
        },
        sink,
        0.55,
      ),
    ).toBe(true);
    expect(sink.spawnInfernal).toHaveBeenCalledWith({
      x: 4,
      z: 5,
      radius: 6,
      duration: 1.2,
      sourceId: 9,
    });

    expect(
      routeWarlockMeteorSpellfxAt(
        {
          type: 'spellfxAt',
          fx: 'felMeteorRainStop',
          x: 1,
          z: 2,
          school: 'fire',
          sourceId: 3,
          ability: 'rain_of_fire',
        },
        sink,
      ),
    ).toBe(true);
    expect(sink.stopRain).toHaveBeenCalledWith(3);

    expect(
      routeWarlockMeteorSpellfxAt(
        { type: 'spellfxAt', fx: 'nova', x: 0, z: 0, school: 'fire' },
        sink,
        1,
      ),
    ).toBe(false);

    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /if\s*\(\s*routeWarlockMeteorSpellfxAt\(\s*ev,\s*this\.warlockMeteorFx[\s\S]*?\)\s*\)\s*break/,
    );
    expect(renderer).toMatch(/if\s*\(impact\.kind !== 'infernal'\) return/);
    expect(renderer).toMatch(
      /warlockMeteorDensityScale\(\s*coerceFxTier\(\s*typeof document === 'undefined'\s*\?\s*undefined\s*:\s*document\.documentElement\.dataset\.fxLevel,?\s*\),?\s*\)/,
    );
    expect(warlockMeteorDensityScale('low')).toBe(0.55);
    expect(warlockMeteorDensityScale('high')).toBe(1);
  });

  it('caps cosmetic showers, fragments, and impacts without hiding actionable boundaries', () => {
    const scene = new THREE.Scene();
    const fx = new WarlockMeteorFx(scene, () => 0, vi.fn());
    fx.spawnInfernal({ x: 0, z: 0, radius: 6, duration: 10, sourceId: 1 });
    for (let index = 0; index < 30; index++) {
      fx.spawnRain({ x: index * 2, z: 0, radius: 7, duration: 6, sourceId: index + 2 });
    }
    for (let step = 0; step < 4; step++) fx.update(0.17);

    let activeMeteorCount = 0;
    scene.traverse((child) => {
      if (
        child.name === 'warlock-fel-meteor-fragment' ||
        child.name === 'warlock-fel-infernal-meteor'
      )
        activeMeteorCount++;
    });

    const activeShowers = scene.children.filter(
      (child) => child.name === 'warlock-fel-meteor-rain',
    ) as THREE.Group[];
    expect(activeShowers).toHaveLength(30);
    expect(activeShowers.filter((shower) => shower.userData.cosmeticsEnabled)).toHaveLength(12);
    expect(
      activeShowers.filter((shower) => shower.getObjectByName('warlock-fel-rain-boundary')),
    ).toHaveLength(30);
    expect(activeMeteorCount).toBeGreaterThan(20);
    expect(activeMeteorCount).toBeLessThanOrEqual(72);
    expect(scene.getObjectByName('warlock-fel-infernal-meteor')).toBeDefined();

    fx.update(1);
    const activeImpacts = scene.children.filter(
      (child) => child.name === 'warlock-fel-meteor-impact',
    ).length;
    expect(activeImpacts).toBe(48);
  });

  it('stops only the cancelled caster shower and removes its actionable boundary immediately', () => {
    const scene = new THREE.Scene();
    const fx = new WarlockMeteorFx(scene, () => 0, vi.fn());
    fx.spawnRain({ x: 0, z: 0, radius: 7, duration: 4, sourceId: 7 });
    fx.spawnRain({ x: 20, z: 0, radius: 7, duration: 4, sourceId: 8 });
    fx.update(0.2);

    fx.stopRain(7);

    const showers = scene.children.filter(
      (child) => child.name === 'warlock-fel-meteor-rain',
    ) as THREE.Group[];
    expect(showers).toHaveLength(1);
    expect(showers[0].userData.sourceId).toBe(8);
    expect(scene.getObjectByName('warlock-fel-rain-boundary')).toBeDefined();
    expect(
      scene.children.some(
        (child) => child.name === 'warlock-fel-meteor-rain' && child.userData.sourceId === 7,
      ),
    ).toBe(false);
  });

  it('disposes transient telegraph and impact GPU resources after their lifetime', () => {
    const scene = new THREE.Scene();
    const fx = new WarlockMeteorFx(scene, () => 0, vi.fn());
    fx.spawnInfernal({ x: 0, z: 0, radius: 6, duration: 0.1, sourceId: 11 });

    const telegraph = scene.getObjectByName('warlock-fel-infernal-telegraph') as THREE.LineLoop<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const telegraphGeometryDispose = vi.spyOn(telegraph.geometry, 'dispose');
    const telegraphMaterialDispose = vi.spyOn(telegraph.material, 'dispose');
    fx.update(0.1);
    expect(telegraphGeometryDispose).toHaveBeenCalledOnce();
    expect(telegraphMaterialDispose).toHaveBeenCalledOnce();

    const fissures = scene.getObjectByName('warlock-fel-impact-fissures') as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const ring = scene.getObjectByName('warlock-fel-impact-ring-0') as THREE.Mesh<
      THREE.RingGeometry,
      THREE.MeshBasicMaterial
    >;
    const fissureGeometryDispose = vi.spyOn(fissures.geometry, 'dispose');
    const fissureMaterialDispose = vi.spyOn(fissures.material, 'dispose');
    const ringMaterialDispose = vi.spyOn(ring.material, 'dispose');
    fx.update(1.55);
    expect(fissureGeometryDispose).toHaveBeenCalledOnce();
    expect(fissureMaterialDispose).toHaveBeenCalledOnce();
    expect(ringMaterialDispose).toHaveBeenCalledOnce();
  });

  it('drapes telegraphs to terrain and removes the Rain boundary on the damage edge', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.12 + Math.sin(z * 0.45) * 0.8;
    const fx = new WarlockMeteorFx(scene, heightAt, vi.fn());
    fx.spawnRain({ x: 10, z: 20, radius: 7, duration: 6, sourceId: 7 });

    const boundary = scene.getObjectByName('warlock-fel-rain-boundary') as THREE.LineLoop<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const boundaryGeometryDispose = vi.spyOn(boundary.geometry, 'dispose');
    const boundaryMaterialDispose = vi.spyOn(boundary.material, 'dispose');
    const positions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      const world = boundary.localToWorld(
        new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index)),
      );
      expect(world.y).toBeCloseTo(heightAt(world.x, world.z) + 0.09, 4);
    }

    fx.update(5.99);
    expect(scene.getObjectByName('warlock-fel-rain-boundary')).toBeDefined();
    fx.update(0.01);
    expect(scene.getObjectByName('warlock-fel-rain-boundary')).toBeUndefined();
    expect(boundaryGeometryDispose).toHaveBeenCalledOnce();
    expect(boundaryMaterialDispose).toHaveBeenCalledOnce();
  });

  it('reduces density and continuous motion on the low-accessibility path', () => {
    const fullScene = new THREE.Scene();
    const lowScene = new THREE.Scene();
    const full = new WarlockMeteorFx(fullScene, () => 0, vi.fn());
    const low = new WarlockMeteorFx(lowScene, () => 0, vi.fn());
    full.spawnRain({ x: 0, z: 0, radius: 7, duration: 6, densityScale: 1 });
    low.spawnRain({ x: 0, z: 0, radius: 7, duration: 6, densityScale: 0.55 });

    const fullCount = (fullScene.getObjectByName('warlock-fel-meteor-rain') as THREE.Group).userData
      .fragmentCount as number;
    const lowRoot = lowScene.getObjectByName('warlock-fel-meteor-rain') as THREE.Group;
    const lowCount = lowRoot.userData.fragmentCount as number;
    expect(lowCount).toBeLessThan(fullCount);
    expect(lowCount).toBeGreaterThanOrEqual(14);

    low.update(0.1, true);
    const boundary = lowScene.getObjectByName('warlock-fel-rain-boundary') as THREE.LineLoop;
    const rotationBefore = boundary.rotation.z;
    const fragment = lowRoot.getObjectByName('warlock-fel-meteor-fragment') as THREE.Group;
    const rock = fragment.getObjectByName('warlock-fel-meteor-rock') as THREE.Mesh;
    const rockRotationBefore = rock.rotation.clone();
    low.update(0.1, true);
    expect(boundary.rotation.z).toBe(rotationBefore);
    expect(rock.rotation.x).toBe(rockRotationBefore.x);
    expect(rock.rotation.z).toBe(rockRotationBefore.z);
    expect(lowScene.children.some((child) => child instanceof THREE.PointLight)).toBe(false);

    const impactScene = new THREE.Scene();
    const impactFx = new WarlockMeteorFx(impactScene, () => 0, vi.fn());
    impactFx.spawnInfernal({ x: 0, z: 0, radius: 6, duration: 0.1 });
    impactFx.update(0.1, true);
    impactFx.update(0.1, true);
    const ring = impactScene.getObjectByName('warlock-fel-impact-ring-0') as THREE.Mesh;
    const spark = (impactScene.getObjectByName('warlock-fel-impact-sparks') as THREE.Group)
      .children[0];
    const ringScale = ring.scale.clone();
    const sparkPosition = spark.position.clone();
    impactFx.update(0.2, true);
    expect(ring.scale).toEqual(ringScale);
    expect(spark.position).toEqual(sparkPosition);

    const animatedScene = new THREE.Scene();
    const animatedFx = new WarlockMeteorFx(animatedScene, () => 0, vi.fn());
    animatedFx.spawnInfernal({ x: 0, z: 0, radius: 6, duration: 0.1 });
    animatedFx.update(0.1, false);
    animatedFx.update(0.1, false);
    const animatedRing = animatedScene.getObjectByName('warlock-fel-impact-ring-0') as THREE.Mesh;
    const animatedSpark = (
      animatedScene.getObjectByName('warlock-fel-impact-sparks') as THREE.Group
    ).children[0];
    const animatedRingScale = animatedRing.scale.clone();
    const animatedSparkPosition = animatedSpark.position.clone();
    animatedFx.update(0.2, false);
    expect(animatedRing.scale).not.toEqual(animatedRingScale);
    expect(animatedSpark.position).not.toEqual(animatedSparkPosition);
  });
});
