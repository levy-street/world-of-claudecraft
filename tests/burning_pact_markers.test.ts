import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BurningPactMarkers, burningPactStages } from '../src/render/burning_pact_markers';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

function target(remaining = 15): Entity {
  return {
    id: 9,
    dead: false,
    scale: 2,
    auras: [
      {
        id: 'immolate',
        name: 'Burning Pact',
        kind: 'dot',
        remaining,
        duration: 15,
        value: 10,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: 1,
        school: 'fire',
      },
    ],
  } as Entity;
}

describe('Burning Pact stage markers', () => {
  it('maps remaining periodic stages to five deterministic ember knots', () => {
    expect(burningPactStages(target(15), 1)).toBe(5);
    expect(burningPactStages(target(12), 1)).toBe(4);
    expect(burningPactStages(target(6), 1)).toBe(2);
    expect(burningPactStages(target(0), 1)).toBe(0);
    expect(burningPactStages(target(15), 2)).toBe(0);
  });

  it('extinguishes one visible knot when Conflagrate advances a tick', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const entity = target();
    const world = {
      playerId: 1,
      entities: new Map([[entity.id, entity]]),
    } as unknown as IWorld;
    const host = new THREE.Group();
    const views = new Map([[entity.id, { group: host, height: 3 }]]);
    const markers = new BurningPactMarkers();

    markers.update(world, views, true);
    const group = host.getObjectByName('burning-pact-stages') as THREE.Group;
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.scale.x).toBeCloseTo(0.5, 4);
    expect(
      group.children.filter((child) => child.name.startsWith('burning-pact-stage-')),
    ).toHaveLength(5);
    expect(group.children.filter((child) => child.visible)).toHaveLength(6);

    entity.auras[0].remaining = 12;
    markers.update(world, views, true);
    expect(group.getObjectByName('burning-pact-stage-5')?.visible).toBe(false);
    expect(group.getObjectByName('burning-pact-stage-4')?.visible).toBe(true);

    entity.auras = [];
    markers.update(world, views, true);
    expect(host.getObjectByName('burning-pact-stages')).toBeUndefined();
  });

  it('disposes the six per-marker materials when the pact expires off an entity', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const entity = target();
    const world = {
      playerId: 1,
      entities: new Map([[entity.id, entity]]),
    } as unknown as IWorld;
    const host = new THREE.Group();
    const views = new Map([[entity.id, { group: host, height: 3 }]]);
    const markers = new BurningPactMarkers();

    markers.update(world, views, true);
    const group = host.getObjectByName('burning-pact-stages') as THREE.Group;
    const halo = group.getObjectByName('burning-pact-halo') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const shards = group.children.filter((child) =>
      child.name.startsWith('burning-pact-stage-'),
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    expect(shards).toHaveLength(5);
    const disposeSpies = [halo, ...shards].map((mesh) => vi.spyOn(mesh.material, 'dispose'));

    entity.auras = [];
    markers.update(world, views, true);

    expect(host.getObjectByName('burning-pact-stages')).toBeUndefined();
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disposes every tracked marker material on clear()', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const entity = target();
    const world = {
      playerId: 1,
      entities: new Map([[entity.id, entity]]),
    } as unknown as IWorld;
    const host = new THREE.Group();
    const views = new Map([[entity.id, { group: host, height: 3 }]]);
    const markers = new BurningPactMarkers();

    markers.update(world, views, true);
    const group = host.getObjectByName('burning-pact-stages') as THREE.Group;
    const halo = group.getObjectByName('burning-pact-halo') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const shards = group.children.filter((child) =>
      child.name.startsWith('burning-pact-stage-'),
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    const disposeSpies = [halo, ...shards].map((mesh) => vi.spyOn(mesh.material, 'dispose'));

    markers.clear();

    expect(host.getObjectByName('burning-pact-stages')).toBeUndefined();
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps the stage manager wired into the renderer frame update', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('new BurningPactMarkers()');
    expect(renderer).toContain(
      'this.burningPactMarkers.update(this.sim, this.views, this.reducedMotion())',
    );
  });
});
