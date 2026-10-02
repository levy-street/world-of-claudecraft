import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CelestialSprites } from '../src/render/celestial_sprites';
import { duskWarmAmount } from '../src/render/day_night_core';
import { aimCelestialSprites, aimGodRays } from '../src/render/sky_overlays';
import { stripComments } from './helpers/strip_comments';

const callsOf = (source: string, callee: string): number => source.split(`${callee}(`).length - 1;

function sprite(baseOpacity = 1): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial());
  sp.userData.baseOpacity = baseOpacity;
  return sp;
}

function celestial(): CelestialSprites {
  return {
    sunSprites: [sprite(0.8), sprite(1)],
    moonSprites: [sprite(0.5)],
    setMoonPhase: vi.fn(),
    setSunWarmth: vi.fn(),
  } as unknown as CelestialSprites;
}

describe('sky overlays', () => {
  it('rides the sun and moon sprites 760 units out along their directions, faded by height', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 20, 30);
    const sky = celestial();
    const sunDir = new THREE.Vector3(0, 1, 0);
    const moonDir = new THREE.Vector3(1, 0, 0);
    aimCelestialSprites(sky, camera, true, sunDir, 0.5, moonDir, 0.01);
    expect(sky.setMoonPhase).toHaveBeenCalledTimes(1);
    expect(sky.setSunWarmth).toHaveBeenCalledTimes(1);
    const [corona, core] = sky.sunSprites;
    expect(corona.position.toArray()).toEqual([10, 780, 30]);
    expect(corona.visible).toBe(true);
    expect(corona.material.opacity).toBeCloseTo(0.4, 12);
    expect(core.material.opacity).toBeCloseTo(0.5, 12);
    const [moon] = sky.moonSprites;
    expect(moon.position.toArray()).toEqual([770, 20, 30]);
    expect(moon.visible).toBe(false);
    aimCelestialSprites(sky, camera, false, sunDir, 0.5, moonDir, 0.5);
    expect(corona.visible).toBe(false);
    expect(moon.visible).toBe(false);
    expect(() => aimCelestialSprites(null, camera, true, sunDir, 1, moonDir, 1)).not.toThrow();
  });

  it('lights the shafts only outdoors, facing the sun, and hides them in an enclosed zone', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 10, -1);
    const rays = [sprite(), sprite(), sprite()];
    const sunDir = new THREE.Vector3(0, 0.6, -0.8);
    aimGodRays(rays, camera, true, 1, sunDir, 1, 0);
    expect(rays.every((r) => r.visible)).toBe(true);
    expect(rays[0].material.opacity).toBeCloseTo(0.3, 9);
    expect(rays[2].material.opacity).toBeCloseTo(0.2, 9);
    expect(rays[0].position.y).toBe(26);
    expect(rays[1].position.z).toBeCloseTo(-(48 + 26), 9);
    aimGodRays(rays, camera, true, 0.5, new THREE.Vector3(0, 0.6, 0.8), 1, 0);
    expect(rays[0].material.opacity).toBe(0);
    aimGodRays(rays, camera, false, 1, sunDir, 1, 0);
    expect(rays.some((r) => r.visible)).toBe(false);
    aimGodRays(rays, camera, true, 0.01, sunDir, 1, 0);
    expect(rays.some((r) => r.visible)).toBe(false);
    expect(() => aimGodRays([], camera, true, 1, sunDir, 1, 0)).not.toThrow();
  });

  it('warms the sun by its own height and fades a risen moon by its own', () => {
    const camera = new THREE.PerspectiveCamera();
    const sky = celestial();
    const sunDir = new THREE.Vector3(0, 0.1, 0.995);
    const moonDir = new THREE.Vector3(0, 0.8, -0.6);
    expect(duskWarmAmount(sunDir.y)).not.toBeCloseTo(duskWarmAmount(moonDir.y), 3);
    aimCelestialSprites(sky, camera, true, sunDir, 0.5, moonDir, 0.6);
    expect(sky.setSunWarmth).toHaveBeenCalledWith(duskWarmAmount(sunDir.y));
    const [moon] = sky.moonSprites;
    expect(moon.visible).toBe(true);
    expect(moon.material.opacity).toBeCloseTo(0.5 * 0.6, 12);
  });

  it('fades the shafts by the cube of the facing, the sun height and the zone scale', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 10, -1);
    const rays = [sprite(), sprite(), sprite()];
    // 60 degrees off the camera's heading: a facing of one half.
    const sunDir = new THREE.Vector3(Math.sin(Math.PI / 3), 0.6, -Math.cos(Math.PI / 3));
    aimGodRays(rays, camera, true, 0.5, sunDir, 0.8, 0);
    expect(rays[0].material.opacity).toBeCloseTo(0.125 * 0.3 * 0.8 * 0.5, 9);
    expect(rays[2].material.opacity).toBeCloseTo(0.125 * 0.2 * 0.8 * 0.5, 9);
  });

  it('is what the renderer paints both overlays with, once each (source pin)', () => {
    expect(callsOf(stripComments('// aimGodRays(a);\n/* aimGodRays(b); */'), 'aimGodRays')).toBe(0);
    expect(callsOf(stripComments('aimGodRays(a);'), 'aimGodRays')).toBe(1);
    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    expect(callsOf(renderer, 'aimCelestialSprites')).toBe(1);
    expect(callsOf(renderer, 'aimGodRays')).toBe(1);
  });
});
