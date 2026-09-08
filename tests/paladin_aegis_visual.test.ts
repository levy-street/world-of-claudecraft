import * as THREE from 'three';
import { syncRigMatrixFreeze } from '../src/render/rig_visibility_freeze';
import { describe, expect, it, vi } from 'vitest';
import {
  PALADIN_AEGIS_DOME_RADIUS,
  PaladinAegisVisual,
  routePaladinAegisCue,
  syncPaladinAegisVisual,
} from '../src/render/paladin_aegis_visual';

describe('PaladinAegisVisual', () => {
  it('keeps the channel field visible while the caster model is hidden and removes its reach on completion', () => {
    const scene = new THREE.Scene(),
      parent = new THREE.Group();
    scene.add(parent);
    parent.visible = false;
    syncRigMatrixFreeze(parent, false);
    parent.position.set(3, 2, -5);
    parent.scale.setScalar(2);
    const visual = syncPaladinAegisVisual(
      null,
      parent,
      true,
      0.1,
      false,
      2,
      scene,
    )!;
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
    expect(
      visual.group.getObjectByName('paladin-aegis-ground-ring')!.visible,
    ).toBe(false);
    visual.update(false, 0.5, true);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
    expect(scene.children).toEqual([parent]);
  });

  it('claims only identified Aegis pulse/completion cues and never guesses a missing owner', () => {
    const scene = new THREE.Scene();
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
    expect(
      routePaladinAegisCue({ ...event, ability: 'other' }, views, scene),
    ).toBe(false);
    expect(
      routePaladinAegisCue({ ...event, sourceId: undefined }, views, scene),
    ).toBe(true);
    expect(view.paladinAegisVisual).toBeNull();
    expect(routePaladinAegisCue(event, views, scene)).toBe(true);
    const visual = view.paladinAegisVisual!;
    visual.update(false, 0.1, false);
    expect(visual.group.visible).toBe(false); // A pulse cannot invent an active channel.
    routePaladinAegisCue({ ...event, fx: 'burst' }, views, scene);
    visual.update(false, 0.1, false);
    expect(visual.group.visible).toBe(true);
    expect(view.paladinAegisVisual).toBe(visual);
    visual.dispose();
  });

  it('continues cleanup after failure, retains shared resources and retries failed material disposal', () => {
    const visual = new PaladinAegisVisual();
    const dome = visual.group.getObjectByName(
      'paladin-aegis-dome',
    ) as THREE.Mesh;
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
  it('builds a readable dome, holy sun, planted weapon, and rotating runes', () => {
    const visual = new PaladinAegisVisual();
    visual.update(true, 0.5, true);

    expect(visual.group.visible).toBe(true);
    expect(PALADIN_AEGIS_DOME_RADIUS).toBe(10);
    expect(visual.group.getObjectByName('paladin-aegis-dome')).toBeTruthy();
    expect(visual.group.getObjectByName('paladin-aegis-sun')).toBeTruthy();
    expect(
      visual.group.getObjectByName('paladin-aegis-planted-weapon'),
    ).toBeTruthy();
    const firstRune = visual.group.getObjectByName('paladin-aegis-rune-1');
    if (!firstRune) throw new Error('missing first solar rune');
    const frozen = firstRune.position.clone();

    visual.update(true, 0.5, true);
    expect(firstRune.position.equals(frozen)).toBe(true);
    visual.update(true, 0.5, false);
    expect(firstRune.position.equals(frozen)).toBe(false);

    visual.update(true, 0.5, true, 1.9);
    expect(visual.group.scale.x).toBeCloseTo(1 / 1.9, 10);

    visual.update(false, 0.5, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });
});
