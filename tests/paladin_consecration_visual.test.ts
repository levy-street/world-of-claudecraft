import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';

function radialBounds(root: THREE.Object3D, centerX: number, centerZ: number, name: string) {
  const mesh = root.getObjectByName(name) as THREE.Mesh | undefined;
  const positions = mesh?.geometry.getAttribute('position');
  if (!positions) throw new Error(`missing ${name}`);
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let index = 0; index < positions.count; index++) {
    const distance = Math.hypot(positions.getX(index) - centerX, positions.getZ(index) - centerZ);
    if (distance > 0.01) min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return { min, max };
}

describe('Paladin Consecration ground visual', () => {
  it('fills the exact six-metre damage area with a layered sacred seal', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 2);

    groundFx.sync([
      {
        id: 'consecration:1:20',
        x: 4,
        z: 7,
        radius: 6,
        duration: 9,
        remaining: 4,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const baseBounds = radialBounds(visual, 4, 7, 'paladin-consecration-base-glow');
    const runeBounds = radialBounds(visual, 4, 7, 'paladin-consecration-sun-rune-field');
    const perimeterBounds = radialBounds(visual, 4, 7, 'paladin-consecration-perimeter');

    expect(baseBounds.max).toBeCloseTo(6);
    expect(perimeterBounds.min).toBeGreaterThan(5.8);
    expect(perimeterBounds.max).toBeCloseTo(6);
    expect(runeBounds.max).toBeGreaterThan(5);
    expect(runeBounds.max).toBeLessThanOrEqual(6);

    expect(visual.getObjectByName('paladin-consecration-light-fissures')).toBeUndefined();
    expect(visual.getObjectByName('paladin-consecration-inner-ring')).toBeDefined();
    expect(visual.getObjectByName('paladin-consecration-middle-ring')).toBeDefined();
    expect(visual.getObjectByName('paladin-consecration-shimmer')).toBeDefined();
    const motes = visual.getObjectByName('paladin-consecration-motes');
    expect(motes).toBeInstanceOf(THREE.InstancedMesh);
    // No pulsing pillars stand around the rune band.
    expect(visual.getObjectByName('paladin-consecration-edge-wisps')).toBeUndefined();
    const rotation = motes?.rotation.y ?? 0;
    groundFx.update(1, true);
    expect(motes?.rotation.y).toBe(rotation);
    groundFx.update(1, false);
    expect(motes?.rotation.y).toBeGreaterThan(rotation);
    groundFx.update(4, false);
    expect(scene.getObjectByName('paladin-consecration')).toBeUndefined();
  });

  it('drapes the full yellow damage circle over uneven terrain', () => {
    const scene = new THREE.Scene();
    const groundY = (x: number, z: number): number => Math.sin(x * 0.25) + Math.cos(z * 0.2) * 0.5;
    const groundFx = new PaladinConsecrationVisuals(scene, groundY);

    groundFx.sync([
      {
        id: 'consecration:normal',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const base = visual.getObjectByName('paladin-consecration-base-glow') as THREE.Mesh;
    const positions = base.geometry.getAttribute('position');
    const sampledRadii = new Set<string>();
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      sampledRadii.add(Math.hypot(x, z).toFixed(2));
      expect(y).toBeCloseTo(groundY(x, z) + 0.055, 4);
    }
    expect(sampledRadii.has('0.00')).toBe(true);
    expect(sampledRadii.has('6.00')).toBe(true);
    expect(sampledRadii.size).toBe(9);

    const pulse = visual.getObjectByName('paladin-consecration-pulse-ring');
    const initialScale = pulse?.scale.x ?? 0;
    groundFx.update(0.15, false);
    expect(pulse?.scale.x).toBeGreaterThan(initialScale);
  });

  it('keeps the sacred seal readable while dropping decorative drawables at low quality', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 0);
    groundFx.setQuality(0);
    groundFx.sync([
      {
        id: 'consecration:low',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    expect(visual.getObjectByName('paladin-consecration-base-glow')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-perimeter')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-sun-rune-field')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-pulse-ring')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-middle-ring')?.visible).toBe(false);
    expect(visual.getObjectByName('paladin-consecration-shimmer')?.visible).toBe(false);
    expect(visual.getObjectByName('paladin-consecration-motes')?.visible).toBe(false);
  });

  it('disposes the rising motes when a seal expires', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 0);
    groundFx.sync([
      {
        id: 'consecration:dispose',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const motes = visual.getObjectByName('paladin-consecration-motes') as THREE.InstancedMesh;
    const moteDisposeSpy = vi.spyOn(motes, 'dispose');

    groundFx.update(10, false);

    expect(moteDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('draws the holy ground and the rune band in light, and opens with a fading column', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 0);
    groundFx.sync([{ id: 'consecration:open', x: 3, z: -2, radius: 6, duration: 9, remaining: 9 }]);
    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const ground = visual.getObjectByName('paladin-consecration-base-glow') as THREE.Mesh;
    const runes = visual.getObjectByName('paladin-consecration-sun-rune-field') as THREE.Mesh;
    const opening = visual.getObjectByName('paladin-consecration-opening') as THREE.Mesh;
    for (const mesh of [ground, runes, opening])
      expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    const groundMaterial = ground.material as THREE.ShaderMaterial;
    expect(groundMaterial.uniforms.uCenter.value.toArray()).toEqual([3, -2]);
    expect(groundMaterial.uniforms.uRadius.value).toBe(6);
    const openingAlpha = () => (opening.material as THREE.ShaderMaterial).uniforms.uAlpha.value;
    groundFx.update(0.1, false);
    expect(openingAlpha()).toBeGreaterThan(0);
    expect(groundMaterial.uniforms.uReveal.value).toBeLessThan(1);
    groundFx.update(1, false);
    expect(openingAlpha()).toBe(0);
    expect(groundMaterial.uniforms.uReveal.value).toBe(1);
    // It fades out over its last moments.
    groundFx.update(7.6, false);
    expect(groundMaterial.uniforms.uAlpha.value).toBeLessThan(1);
    groundFx.dispose();
  });

  it('sends a wall of holy fire out with each tick, burning down at the rim', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 1);
    groundFx.sync([{ id: 'consecration:fire', x: 0, z: 0, radius: 6, duration: 9, remaining: 9 }]);
    const fire = scene.getObjectByName('paladin-consecration-fire-wall') as THREE.Mesh;
    expect(fire.material).toBeInstanceOf(THREE.ShaderMaterial);
    // Mid-tick: out on its way to the rim, standing on the ground.
    groundFx.update(1.4, false);
    expect(fire.visible).toBe(true);
    expect(fire.scale.x).toBeGreaterThan(2);
    expect(fire.scale.x).toBeLessThanOrEqual(6);
    expect(fire.position.y - fire.scale.y / 2).toBeCloseTo(1);
    const early = fire.scale.x;
    groundFx.update(0.3, false);
    expect(fire.scale.x).toBeGreaterThan(early);
    // Reduced motion keeps the ground but no sweeping fire.
    groundFx.update(0.1, true);
    expect(fire.visible).toBe(false);
    groundFx.dispose();
  });

  it('claims the cast burst and the ticks so no generic dome or rings stack on the ground', () => {
    const releaseGesture = vi.fn(),
      abilityAudio = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx: { groundYAt: () => 0 }, abilityAudio },
      releaseGesture,
    }) as AbilityVfx;
    const base = { sourceId: 1, targetId: 1, school: 'holy', ability: 'consecration' };
    expect(p.handleSpellfx({ ...base, fx: 'selfCast' })).toBe(true);
    expect(p.handleSpellfx({ ...base, fx: 'nova' })).toBe(true);
    expect(releaseGesture).toHaveBeenCalledOnce();
    expect(
      p.handleSpellfxAt({
        x: 1,
        z: 2,
        school: 'holy',
        fx: 'tick',
        radius: 6,
        ability: 'consecration',
        sourceId: 1,
      }),
    ).toBe(true);
    // The tick keeps its pulse of sound.
    expect(abilityAudio).toHaveBeenCalledOnce();
  });
});
