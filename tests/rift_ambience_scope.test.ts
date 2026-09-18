// RiftAmbienceSources (rift_ambience.ts): the per-frame caller's view. Outside
// the rift band the roster is walked only when it changed; inside, every frame.
// Either way the set is exactly what the plain walk returns.
import { describe, expect, it, vi } from 'vitest';
import type { AmbientPointSource } from '../src/render/audio_sink';
import { RiftAmbienceSources, riftAmbientSources } from '../src/render/rift_ambience';
import { MOBS, RIFT_BAND_X_MIN } from '../src/sim/data';
import { createGroundObject, createMob, createPlayer } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function portal(id: number, x: number): Entity {
  const e = createGroundObject(id, 'rift_portal', 'Rift Portal', { x, y: 1, z: 2 });
  e.templateId = 'rift_portal';
  return e;
}

function roster(): { entities: Map<number, Entity>; entityRosterVersion: number } {
  const glider = createPlayer(5, 'warrior', { x: RIFT_BAND_X_MIN + 10, y: 0, z: 0 }, 'Glide');
  glider.riftSliding = true;
  const roller = createMob(6, MOBS.ridge_stalker, 3, { x: RIFT_BAND_X_MIN + 12, y: 0, z: 0 });
  roller.templateId = 'rift_roller';
  const entities = new Map<number, Entity>([
    [1, createMob(1, MOBS.ridge_stalker, 3, { x: 0, y: 0, z: 0 })],
    [2, portal(2, 40)],
    [3, portal(3, -70)],
    [5, glider],
    [6, roller],
  ]);
  return { entities, entityRosterVersion: 1 };
}

describe('RiftAmbienceSources', () => {
  it('outside the rift band lists the portals, walking the roster once per roster version', () => {
    const world = roster();
    const plainWalk = riftAmbientSources(world.entities).filter((s) => s.kind === 'rift_portal');
    const values = vi.spyOn(world.entities, 'values');
    const sources = new RiftAmbienceSources();
    const out: AmbientPointSource[] = [];
    sources.collect(world, 0, out);
    expect(out).toEqual(plainWalk);
    expect(out.map((s) => s.id)).toEqual(['rift_portal:2', 'rift_portal:3']);
    for (let frame = 0; frame < 20; frame++) sources.collect(world, 0, out);
    expect(values).toHaveBeenCalledTimes(1);
    // A portal that closed leaves the set on the next roster version.
    world.entities.delete(2);
    world.entityRosterVersion = 2;
    sources.collect(world, 0, out);
    expect(out.map((s) => s.id)).toEqual(['rift_portal:3']);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it('inside the rift band walks the roster every frame and lists rollers and gliders too', () => {
    const world = roster();
    const values = vi.spyOn(world.entities, 'values');
    const sources = new RiftAmbienceSources();
    const out: AmbientPointSource[] = [];
    sources.collect(world, RIFT_BAND_X_MIN + 5, out);
    sources.collect(world, RIFT_BAND_X_MIN + 5, out);
    expect(values).toHaveBeenCalledTimes(2);
    expect(out).toEqual(riftAmbientSources(world.entities));
    expect(out.map((s) => s.kind)).toEqual([
      'rift_portal',
      'rift_portal',
      'rift_ice_glide',
      'rift_roller',
    ]);
  });
});
