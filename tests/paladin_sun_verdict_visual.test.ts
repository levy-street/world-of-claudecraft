import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PaladinSunVerdictVisual,
  syncPaladinSunVerdictVisual,
} from '../src/render/paladin_sun_verdict_visual';

describe('PaladinSunVerdictVisual', () => {
  it('syncs before the character-rig guard so ordinary enemy mobs can display it', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');
    const planIndex = renderer.indexOf('const sunVerdictPlan =');
    const syncIndex = renderer.indexOf('syncPaladinSunVerdictVisual(', planIndex);
    const characterGuardIndex = renderer.indexOf('if (!v.visual) continue;', planIndex);

    expect(planIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(planIndex);
    expect(characterGuardIndex).toBeGreaterThan(syncIndex);
  });

  it('fills exactly one of three solar segments per charge', () => {
    const visual = new PaladinSunVerdictVisual(1.8);
    const segments = Array.from({ length: 3 }, (_, index) => {
      const segment = visual.group.getObjectByName(`paladin-sun-verdict-segment-${index + 1}`);
      if (!segment) throw new Error(`missing sun segment ${index + 1}`);
      return segment;
    });

    visual.update({ active: true, charges: 0, imminent: false }, 0.1, false);
    expect(segments.map((segment) => segment.visible)).toEqual([false, false, false]);
    visual.update({ active: true, charges: 1, imminent: false }, 0.1, false);
    expect(segments.map((segment) => segment.visible)).toEqual([true, false, false]);
    visual.update({ active: true, charges: 2, imminent: true }, 0.1, false);
    expect(segments.map((segment) => segment.visible)).toEqual([true, true, false]);
    visual.update({ active: true, charges: 3, imminent: true }, 0.1, false);
    expect(segments.map((segment) => segment.visible)).toEqual([true, true, true]);
    expect(visual.group.userData.charges).toBe(3);
    const sprites = visual.group.children as THREE.Sprite[];
    expect(sprites.every((sprite) => sprite.material.depthTest)).toBe(true);
    visual.update({ active: false, charges: 0, imminent: false }, 0.1, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  it('stays fixed with reduced motion and lazy-creates only while marked', () => {
    const parent = new THREE.Group();
    let visual = syncPaladinSunVerdictVisual(
      null,
      parent,
      1.8,
      { active: false, charges: 0, imminent: false },
      0.5,
      true,
    );
    expect(visual).toBeNull();

    visual = syncPaladinSunVerdictVisual(
      visual,
      parent,
      1.8,
      { active: true, charges: 2, imminent: true },
      0.5,
      true,
    );
    const first = visual;
    const base = visual?.group.getObjectByName('paladin-sun-verdict-base') as THREE.Sprite;
    const rotation = (base.material as THREE.SpriteMaterial).rotation;
    visual = syncPaladinSunVerdictVisual(
      visual,
      parent,
      1.8,
      { active: true, charges: 2, imminent: true },
      0.5,
      true,
    );
    expect(visual).toBe(first);
    expect((base.material as THREE.SpriteMaterial).rotation).toBe(rotation);
    expect(parent.children).toEqual([visual?.group]);
    visual?.dispose();
  });
});
