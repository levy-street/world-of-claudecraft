import { describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import type { AmbientPointSource } from '../src/render/audio_sink';
import { DynamicEntityAmbienceSources } from '../src/render/dynamic_entity_ambience';
import { HoardAmbienceSources, hoardAmbientSources } from '../src/render/hoard_ambience';
import { createGroundObject } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function object(id: number, templateId: string, x: number): Entity {
  const entity = createGroundObject(id, '', templateId, { x, y: 3, z: 7 });
  entity.templateId = templateId;
  return entity;
}

function roster(): { entities: Map<number, Entity>; entityRosterVersion: number } {
  return {
    entities: new Map([
      [1, object(1, 'hoard_entrance', 12)],
      [2, object(2, 'rift_portal', 18)],
      [3, object(3, 'mailbox', 24)],
    ]),
    entityRosterVersion: 1,
  };
}

describe('HoardAmbienceSources', () => {
  it('ships a preloaded reveal and a distinct spatial loop, routing its live point to that loop', () => {
    expect(SFX_CLIPS.hoard_entrance_open).toMatchObject({
      preload: 'startup',
      spatial: true,
      loop: false,
    });
    expect(SFX_CLIPS.hoard_entrance_hum).toMatchObject({ spatial: true, loop: true });
    expect(SFX_CLIPS.hoard_entrance_hum.hash).not.toBe(SFX_CLIPS.rift_portal_drone.hash);
    const loop = vi.spyOn(sfx, 'loop').mockImplementation(() => {});
    try {
      sfx.ambience('vale', false, null, false, 0, [
        { id: 'hoard_entrance:1', kind: 'hoard_entrance', x: 0, y: 0, z: 0 },
      ]);
      expect(loop).toHaveBeenCalledWith(
        'hoard_entrance:1',
        'hoard_entrance_hum',
        0.12,
        0,
        0,
        0,
        undefined,
      );
    } finally {
      loop.mockRestore();
    }
  });

  it('collects only buried-hoard entrances with their own non-rift kind and id', () => {
    const world = roster();
    expect(hoardAmbientSources(world.entities)).toEqual([
      { id: 'hoard_entrance:1', kind: 'hoard_entrance', x: 12, y: 3, z: 7 },
    ]);
  });

  it('walks the roster only when its version changes', () => {
    const world = roster();
    const values = vi.spyOn(world.entities, 'values');
    const sources = new HoardAmbienceSources();
    const out: AmbientPointSource[] = [];
    sources.collect(world, out);
    sources.collect(world, out);
    expect(values).toHaveBeenCalledTimes(1);
    world.entities.delete(1);
    world.entityRosterVersion++;
    sources.collect(world, out);
    expect(values).toHaveBeenCalledTimes(2);
    expect(out).toEqual([]);
  });
});

describe('DynamicEntityAmbienceSources', () => {
  it('composes the unchanged rift collector with the hoard collector', () => {
    const world = roster();
    const sources = new DynamicEntityAmbienceSources();
    const out: AmbientPointSource[] = [];
    sources.collect(world, 0, out);
    expect(out.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'rift_portal:2', kind: 'rift_portal' },
      { id: 'hoard_entrance:1', kind: 'hoard_entrance' },
    ]);
  });
});
