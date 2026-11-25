import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import {
  PaladinSunVerdictVisual,
  syncPaladinSunVerdictVisual,
} from '../src/render/paladin_sun_verdict_visual';

// Node tests run at the Medium preset; the tests below pin the authored
// composition (full detail) unless a test names another tier.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

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
    visual.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material && !Array.isArray(material)) expect(material.depthTest).toBe(true);
    });
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

  it('keeps the spear and both charge wings on every tier and drops the sentence flash below full', () => {
    const drawn = (detail: 'full' | 'light' | 'minimal') => {
      setPaladinVfxDetailForTest(detail);
      const visual = new PaladinSunVerdictVisual(1.8);
      const segments = [1, 2, 3].map(
        (index) =>
          visual.group.getObjectByName(`paladin-sun-verdict-segment-${index}`) as THREE.Object3D,
      );
      const base = visual.group.getObjectByName('paladin-sun-verdict-base') as THREE.Sprite;
      visual.update({ active: true, charges: 2, imminent: true }, 0.1, false);
      const charged = segments.map((segment) => segment.visible);
      visual.update({ active: true, charges: 3, imminent: true }, 0.1, false);
      const out = {
        base: base.visible,
        charged,
        sentence: segments.map((segment) => segment.visible),
        steady: base.material.opacity === 1 && visual.group.scale.x === 1,
      };
      visual.dispose();
      return out;
    };
    expect(drawn('full')).toEqual({
      base: true,
      charged: [true, true, false],
      sentence: [true, true, true],
      steady: false,
    });
    for (const detail of ['light', 'minimal'] as const) {
      // The charges a player reads stay; the render-only flash after the
      // sentence and the brand's flicker are accents.
      expect(drawn(detail)).toEqual({
        base: true,
        charged: [true, true, false],
        sentence: [true, true, false],
        steady: true,
      });
    }
  });

  it('reads the detail as the mark appears and keeps it while the mark stays', () => {
    setPaladinVfxDetailForTest('minimal');
    const visual = new PaladinSunVerdictVisual(1.8);
    const sentence = visual.group.getObjectByName(
      'paladin-sun-verdict-segment-3',
    ) as THREE.Object3D;
    visual.update({ active: true, charges: 1, imminent: false }, 0.1, false);
    setPaladinVfxDetailForTest('full');
    visual.update({ active: true, charges: 3, imminent: true }, 0.1, false);
    expect(sentence.visible).toBe(false);
    // A new mark reads afresh.
    visual.update({ active: false, charges: 0, imminent: false }, 0.1, false);
    visual.update({ active: true, charges: 3, imminent: true }, 0.1, false);
    expect(sentence.visible).toBe(true);
    visual.dispose();
  });
});
