import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HunterMarkMarkers } from '../src/render/hunter_mark_markers';
import type { Aura, Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const mark: Aura = {
  id: 'hunters_mark',
  name: "Hunter's Mark",
  kind: 'hunter_mark',
  remaining: 60,
  duration: 60,
  value: 0.05,
  sourceId: 1,
  school: 'physical',
};

describe("Hunter's Mark render markers", () => {
  it('counter-scales the diana and updates its head anchor after live scale changes', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const target = { id: 9, dead: false, auras: [mark], scale: 2 } as Entity;
    const world = { entities: new Map([[target.id, target]]) } as unknown as IWorld;
    const group = new THREE.Group();
    group.scale.setScalar(target.scale);
    const views = new Map([[target.id, { group, height: 3 }]]);
    const markers = new HunterMarkMarkers();

    markers.update(world, views);
    const sprite = group.getObjectByName('hunters-mark-bullseye') as THREE.Sprite;
    expect(sprite.position.y).toBeCloseTo(3.325, 4);
    expect(sprite.scale.x).toBeCloseTo(0.45, 4);

    target.scale = 1;
    group.scale.setScalar(1);
    markers.update(world, views);
    expect(sprite.position.y).toBeCloseTo(3.65, 4);
    expect(sprite.scale.x).toBeCloseTo(0.9, 4);

    target.auras = [];
    markers.update(world, views);
    expect(group.getObjectByName('hunters-mark-bullseye')).toBeUndefined();
  });
});
