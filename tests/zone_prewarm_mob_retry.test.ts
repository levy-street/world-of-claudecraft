// The zone prewarm's mob arm (buildEntityPrewarmGroup, src/render/zone_prewarm_groups.ts)
// skips a template whose body is not resident yet, so a later zone preparation can
// warm it. It used to mark the skipped template as prewarmed anyway, so it was never
// retried: on iOS the Quartered Isle's bodies ride a lane that can still be fetching
// when the player reaches the isle's edge (rift_body_stream_core.ts, the isle lane),
// and their first views then compiled live instead of from the prewarm pool.

import { describe, expect, it, vi } from 'vitest';
import type { Entity, ZoneDef } from '../src/sim/types';

const state = vi.hoisted(() => ({ resident: new Set<string>(), built: [] as string[] }));

vi.mock('../src/render/characters', async () => {
  const THREE = await import('three');
  return {
    visualAssetsResident: (key: string) => state.resident.has(key),
    createCharacterVisual: (e: { templateId: string }) => {
      state.built.push(e.templateId);
      return { root: new THREE.Group() };
    },
  };
});
vi.mock('../src/render/characters/manifest', () => ({
  visualKeyFor: (e: { templateId: string }) => `key_${e.templateId}`,
  skinCount: () => 1,
}));
vi.mock('../src/render/characters/visual_pool', () => ({ characterVisualPoolKey: () => null }));

const { buildEntityPrewarmGroup } = await import('../src/render/zone_prewarm_groups');

function host(templates: string[]) {
  return {
    sim: { player: { pos: { x: 0, y: 0, z: 0 } }, cfg: { playerClass: 'warrior' } },
    prewarmEntity: (kind: string, templateId: string) =>
      ({ kind, templateId }) as unknown as Entity,
    storePooledObject: () => {},
    templateIdsInZone: () => templates,
    prewarmedMobTemplates: new Set<string>(),
    prewarmedNpcModels: new Set<string>(),
  };
}

describe('the zone prewarm retries a mob whose body was not resident', () => {
  it('marks only the templates it built, and warms a skipped one on the next pass', () => {
    const zone = { id: 'quartered_isle' } as ZoneDef;
    const h = host(['rimeglass_bear', 'heatsworn_ember']);
    state.resident = new Set(['key_heatsworn_ember']);
    state.built = [];
    buildEntityPrewarmGroup(h, zone);
    expect(state.built).toEqual(['heatsworn_ember']);
    expect([...h.prewarmedMobTemplates]).toEqual(['heatsworn_ember']);
    // the bear's body lands; the next zone preparation warms it, and only it
    state.resident.add('key_rimeglass_bear');
    state.built = [];
    buildEntityPrewarmGroup(h, zone);
    expect(state.built).toEqual(['rimeglass_bear']);
    expect([...h.prewarmedMobTemplates].sort()).toEqual(['heatsworn_ember', 'rimeglass_bear']);
  });
});
