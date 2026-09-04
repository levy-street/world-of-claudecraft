import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterLodBands } from '../src/render/crowd_lod';
import {
  attachEntityViewBody,
  buildQuestCaravanBody,
  isQuestCaravanEntity,
  syncQuestCaravanBody,
} from '../src/render/quest_entity_presentation';
import { buildGroundQuestObject } from '../src/render/quest_objects';
import { buildMovingWorldQuestFreightWagon } from '../src/render/world_quest_freight_visual';
import type { Entity } from '../src/sim/types';

vi.mock('../src/render/quest_objects', () => ({ buildGroundQuestObject: vi.fn() }));
vi.mock('../src/render/world_quest_freight_visual', () => ({
  buildMovingWorldQuestFreightWagon: vi.fn(),
}));

const bands: CharacterLodBands = {
  shadowRangeSq: 100,
  lodRangeSq: 400,
  staticRangeSq: 900,
  actionableStaticRangeSq: 900,
  midCadence: 2,
  farCadence: 4,
};

describe('quest entity presentation lifecycle', () => {
  it.each(['eastbrook_freight_caravan', 'willowfen_remedy_caravan', 'frostveil_supply_caravan'])(
    'routes %s only as a live mob and preserves its owned visual',
    (templateId) => {
      const e = { kind: 'mob', templateId, id: 7 } as Entity;
      expect(isQuestCaravanEntity(e)).toBe(true);
      expect(isQuestCaravanEntity({ ...e, kind: 'object' })).toBe(false);
      expect(isQuestCaravanEntity({ ...e, templateId: 'wolf' })).toBe(false);
      const visual = { group: new THREE.Group(), height: 3, update: vi.fn(), dispose: vi.fn() };
      vi.mocked(buildMovingWorldQuestFreightWagon).mockReturnValueOnce(visual);
      expect(buildQuestCaravanBody(e)).toBe(visual);
      expect(buildMovingWorldQuestFreightWagon).toHaveBeenLastCalledWith(templateId);
    },
  );

  it('keeps a freight fallback body when rig assets are unavailable', () => {
    const group = new THREE.Group();
    vi.mocked(buildMovingWorldQuestFreightWagon).mockReturnValueOnce(null);
    vi.mocked(buildGroundQuestObject).mockReturnValueOnce({ group, height: 2.3 });
    const visual = buildQuestCaravanBody({
      id: 9,
      templateId: 'willowfen_remedy_caravan',
    } as Entity);
    expect(visual.group).toBe(group);
    expect(buildGroundQuestObject).toHaveBeenLastCalledWith('eastbrook_freight_wagon', 9);
    expect(() => {
      visual.update(0.05, true, false);
      visual.dispose();
    }).not.toThrow();
  });

  it.each([
    [1, 0, false, true, true],
    [1, 0, true, true, false],
    [1, 0, false, false, false],
    [200, 1, false, true, false],
    [200, 2, false, true, true],
    [500, 2, false, true, false],
    [500, 4, false, true, true],
  ])(
    'keeps the driver gates at distance %s and phase %s',
    (d2, phase, reduced, visible, expected) => {
      const update = vi.fn();
      const group = new THREE.Group();
      group.position.set(10, 2, -3);
      const view = {
        group,
        height: 3,
        liveScale: 2,
        lastX: 9,
        lastY: 1,
        lastZ: -3,
        freightCaravanVisual: { group, height: 3, update, dispose: vi.fn() },
      };
      const sphere = new THREE.Sphere();
      const frustum = new THREE.Frustum();
      vi.spyOn(frustum, 'intersectsSphere').mockReturnValue(visible);
      syncQuestCaravanBody(view, 0.05, phase, d2, bands, reduced, frustum, sphere);
      expect(update).toHaveBeenLastCalledWith(0.05, true, expected);
      expect(view).toMatchObject({ lastX: 10, lastY: 2, lastZ: -3 });
      expect(sphere.center.toArray()).toEqual([10, 5, -3]);
      expect(sphere.radius).toBe(12);
      syncQuestCaravanBody(view, 0.05, 0, 1, bands, false, null, sphere);
      expect(update).toHaveBeenLastCalledWith(0.05, false, true);
    },
  );

  it('attaches object bodies, tags nested pick targets and hoists only defined ambience', () => {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const child = new THREE.Group();
    body.add(child);
    body.userData.rollRock = child;
    body.userData.riftPulse = [];
    group.userData.mailGlow = 'retained';
    expect(attachEntityViewBody(group, body, 42, null, false)).toBe(body);
    expect(body.parent).toBe(group);
    expect(child.userData.entityId).toBe(42);
    expect(body.userData.entityId).toBe(42);
    expect(group.userData.rollRock).toBe(child);
    expect(group.userData.riftPulse).toBe(body.userData.riftPulse);
    expect(group.userData.mailGlow).toBe('retained');
    expect(attachEntityViewBody(group, null, 42, null, false)).toBe(group);
  });

  it('uses character proxies without attaching object bodies or tagging quest visions', () => {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const clickProxy = new THREE.Group();
    expect(attachEntityViewBody(group, body, 42, { clickProxy }, true)).toBe(clickProxy);
    expect(clickProxy.userData.entityId).toBeUndefined();
    expect(body.parent).toBeNull();
    expect(attachEntityViewBody(group, body, 42, { clickProxy }, false)).toBe(clickProxy);
    expect(clickProxy.userData.entityId).toBe(42);
  });
});
