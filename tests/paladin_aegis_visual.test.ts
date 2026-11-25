import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import {
  PALADIN_AEGIS_DOME_RADIUS,
  PALADIN_AEGIS_SUN_OUTLINE,
  PaladinAegisVisual,
  routePaladinAegisCue,
  syncPaladinAegisVisual,
} from '../src/render/paladin_aegis_visual';
import { syncRigMatrixFreeze } from '../src/render/rig_visibility_freeze';

// Node tests run at the Medium preset; the tests below pin the authored
// composition (full detail) unless a test names another tier.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('PaladinAegisVisual', () => {
  it('keeps the channel field visible while the caster model is hidden and removes its reach on completion', () => {
    const scene = new THREE.Scene(),
      parent = new THREE.Group();
    scene.add(parent);
    parent.visible = false;
    syncRigMatrixFreeze(parent, false);
    parent.position.set(3, 2, -5);
    parent.scale.setScalar(2);
    const visual = syncPaladinAegisVisual(null, parent, true, 0.1, false, 2, scene)!;
    expect(visual.group.parent).toBe(scene);
    expect(visual.group.position.toArray()).toEqual([3, 2, -5]);
    expect(visual.group.scale.x).toBe(1);
    const dome = visual.group.getObjectByName('paladin-aegis-dome')!;
    visual.pulse(false);
    visual.update(true, 0.01, false);
    expect(dome.scale.x).toBe(1);
    visual.pulse(true);
    visual.update(false, 0.1, true);
    expect(visual.group.visible).toBe(true);
    expect(dome.visible).toBe(false);
    expect(visual.group.getObjectByName('paladin-aegis-ground-ring')!.visible).toBe(false);
    visual.update(false, 0.5, true);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
    expect(scene.children).toEqual([parent]);
  });

  it('claims only identified Aegis pulse/completion cues and never guesses a missing owner', () => {
    const view = {
      group: new THREE.Group(),
      paladinAegisVisual: null as PaladinAegisVisual | null,
    };
    const views = new Map([[9, view]]);
    const event = {
      type: 'spellfxAt' as const,
      ability: 'aegis_first_dawn',
      sourceId: 9,
      x: 0,
      z: 0,
      school: 'holy' as const,
      fx: 'tick' as const,
      radius: 10,
    };
    expect(routePaladinAegisCue({ ...event, ability: 'other' }, views)).toBe(false);
    expect(routePaladinAegisCue({ ...event, sourceId: undefined }, views)).toBe(true);
    expect(view.paladinAegisVisual).toBeNull();
    expect(routePaladinAegisCue(event, views)).toBe(true);
    const visual = view.paladinAegisVisual!;
    // Built the way the sync builds it: under the caster's view group, never a
    // bare scene attach.
    expect(visual.group.parent).toBe(view.group);
    visual.update(false, 0.1, false);
    expect(visual.group.visible).toBe(false); // A pulse cannot invent an active channel.
    routePaladinAegisCue({ ...event, fx: 'burst' }, views);
    visual.update(false, 0.1, false);
    expect(visual.group.visible).toBe(true);
    expect(view.paladinAegisVisual).toBe(visual);
    visual.dispose();
  });

  it('continues cleanup after failure, retains shared resources and retries failed material disposal', () => {
    const visual = new PaladinAegisVisual();
    const dome = visual.group.getObjectByName('paladin-aegis-dome') as THREE.Mesh;
    const material = dome.material as THREE.Material;
    const shared = vi.spyOn(dome.geometry, 'dispose');
    const fail = vi.spyOn(material, 'dispose').mockImplementationOnce(() => {
      throw new Error('driver failure');
    });
    expect(() => visual.dispose()).toThrow(AggregateError);
    visual.pulse(true);
    visual.update(true, 0.1, false);
    expect(visual.group.visible).toBe(false);
    expect(() => visual.dispose()).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
    expect(shared).not.toHaveBeenCalled();
    shared.mockRestore();
    fail.mockRestore();
  });
  it('builds a readable dome, holy sun, planted weapon, and rising pluses', () => {
    const visual = new PaladinAegisVisual();
    visual.update(true, 0.5, true);

    expect(visual.group.visible).toBe(true);
    expect(PALADIN_AEGIS_DOME_RADIUS).toBe(10);
    expect(visual.group.getObjectByName('paladin-aegis-dome')).toBeTruthy();
    expect(visual.group.getObjectByName('paladin-aegis-sun')).toBeTruthy();
    expect(visual.group.getObjectByName('paladin-aegis-planted-weapon')).toBeTruthy();
    // The suns that once turned about the dome are gone; the pluses rise, and
    // hold still for reduced motion.
    expect(visual.group.getObjectByName('paladin-aegis-rune-1')).toBeUndefined();
    const firstPlus = visual.group.getObjectByName('paladin-aegis-plus-1');
    if (!firstPlus) throw new Error('missing first rising plus');
    const frozen = firstPlus.position.clone();

    visual.update(true, 0.5, true);
    expect(firstPlus.position.equals(frozen)).toBe(true);
    visual.update(true, 0.5, false);
    expect(firstPlus.position.equals(frozen)).toBe(false);

    visual.update(true, 0.5, true, 1.9);
    expect(visual.group.scale.x).toBeCloseTo(1 / 1.9, 10);

    visual.update(false, 0.5, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  it('draws the ground sun as a faint outline so the dome and raised weapon carry the moment', () => {
    const visual = new PaladinAegisVisual();
    const ground = visual.group.getObjectByName('paladin-aegis-ground-runes') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    const shader = ground.material.fragmentShader;
    expect(PALADIN_AEGIS_SUN_OUTLINE).toBeGreaterThan(0);
    expect(PALADIN_AEGIS_SUN_OUTLINE).toBeLessThanOrEqual(0.35);
    expect(shader).toContain(`float sunLine=${PALADIN_AEGIS_SUN_OUTLINE.toFixed(2)};`);
    // Strokes only: no filled rays and no filled disc.
    expect(shader).not.toContain('rayFill');
    expect(shader).not.toContain('1.0-smoothstep(0.15,0.16,r)');
    visual.dispose();
  });

  it('draws a thinner dome on lighter tiers: fewer pluses, no sparkles or sun glow, the core kept', () => {
    const drawn = (detail: 'full' | 'light' | 'minimal') => {
      setPaladinVfxDetailForTest(detail);
      const visual = new PaladinAegisVisual();
      visual.update(true, 0.5, false);
      const shown = (prefix: string) => {
        let n = 0;
        visual.group.traverse((o) => {
          if (o.name.startsWith(prefix) && o.visible) n++;
        });
        return n;
      };
      const out = {
        pluses: shown('paladin-aegis-plus-'),
        sparkles: shown('paladin-aegis-sparkle-'),
        ring: shown('paladin-aegis-ground-ring'),
        sun: shown('paladin-aegis-sun'),
        core: ['dome', 'ground-runes', 'sun-halo', 'planted-weapon'].every(
          (name) => visual.group.getObjectByName(`paladin-aegis-${name}`)?.visible,
        ),
      };
      visual.dispose();
      return out;
    };
    const full = drawn('full'),
      light = drawn('light'),
      minimal = drawn('minimal');
    expect(full).toEqual({ pluses: 14, sparkles: 28, ring: 1, sun: 2, core: true });
    // Light keeps the second ring, halves the pluses, drops the accents.
    expect(light).toEqual({ pluses: 7, sparkles: 0, ring: 1, sun: 1, core: true });
    // Minimal keeps only the core: the dome, ground, sign, blade and a few pluses.
    expect(minimal).toEqual({ pluses: 4, sparkles: 0, ring: 0, sun: 1, core: true });
  });

  it('holds a channel at the detail it began with and shortens the closing flare on lighter tiers', () => {
    setPaladinVfxDetailForTest('minimal');
    const visual = new PaladinAegisVisual();
    visual.update(true, 0.1, false);
    // The governor moves mid-channel: the running dome keeps its shape.
    setPaladinVfxDetailForTest('full');
    visual.update(true, 0.1, false);
    expect(visual.group.getObjectByName('paladin-aegis-sparkle-1')?.visible).toBe(false);
    visual.pulse(true);
    // Minimal's flare tail is 0.45 of the authored 0.55 s.
    visual.update(false, 0.2, false);
    expect(visual.group.visible).toBe(true);
    visual.update(false, 0.06, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });
});
