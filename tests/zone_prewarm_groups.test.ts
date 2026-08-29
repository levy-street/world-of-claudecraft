// Paired test for src/render/zone_prewarm_groups.ts: drives buildNpcPrewarmGroup
// through a fake ZonePrewarmGroupHost so the warmed/planned/trimmed contract is
// pinned by behavior (the prewarm_policy source pin proves the same rule only by
// text order). createCharacterVisual is mocked so the asset-unavailable arm and
// the build count are controllable from the test.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNpcPrewarmGroup, type ZonePrewarmGroupHost } from '../src/render/zone_prewarm_groups';
import type { Entity, ZoneDef } from '../src/sim/types';

const state = vi.hoisted(() => ({
  createCalls: [] as string[],
  unavailable: new Set<string>(),
  modelKeys: {} as Record<string, string>,
}));

vi.mock('../src/render/characters', async () => {
  const THREE = await import('three');
  return {
    createCharacterVisual: (entity: Pick<Entity, 'templateId'>) => {
      state.createCalls.push(entity.templateId);
      if (state.unavailable.has(entity.templateId)) return null;
      return { root: new THREE.Object3D() };
    },
  };
});

// The builder dedups by model key; the mapping is test-owned so two npc ids can
// share one model on demand. skinCount only feeds the player builder.
vi.mock('../src/render/characters/manifest', () => ({
  skinCount: () => 1,
  visualKeyFor: (entity: Pick<Entity, 'templateId'>) =>
    state.modelKeys[entity.templateId] ?? `model:${entity.templateId}`,
}));

// Static NPC records under test control; only the three named ids exist.
vi.mock('../src/sim/data', () => ({
  CLASSES: {},
  MOBS: {},
  NPCS: {
    npc_guard: { id: 'npc_guard', color: 0x111111 },
    npc_knight: { id: 'npc_knight', color: 0x222222 },
    npc_mage: { id: 'npc_mage', color: 0x333333 },
  },
}));

// Only the object builder reaches quest objects; kept inert so importing the
// module under test never touches the asset pipeline.
vi.mock('../src/render/quest_objects', () => ({
  buildGroundQuestObject: vi.fn(),
}));

const ZONE = { id: 'test_zone' } as ZoneDef;
const NO_DEADLINE = Number.MAX_SAFE_INTEGER;

const makeHost = (npcIds: string[]): ZonePrewarmGroupHost => ({
  sim: { player: { pos: { x: 3, y: 1, z: -2 } } },
  prewarmEntity: (kind, templateId, color, scale, skin = 0, id = -10_000) =>
    ({ kind, templateId, color, scale, skin, id }) as unknown as Entity,
  storePooledObject: () => {},
  templateIdsInZone: () => npcIds,
  prewarmedMobTemplates: new Set<string>(),
  prewarmedNpcModels: new Set<string>(),
});

describe('buildNpcPrewarmGroup warmed/planned/trimmed semantics', () => {
  beforeEach(() => {
    state.createCalls.length = 0;
    state.unavailable.clear();
    state.modelKeys = {};
  });

  it('leaves an asset-skipped id uncounted and its model unmarked, so a later pass retries it', () => {
    state.unavailable.add('npc_guard');
    const host = makeHost(['npc_guard', 'npc_knight']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.planned).toBe(2);
    expect(built.warmed).toBe(1);
    expect(built.trimmed).toBe(false);
    expect(host.prewarmedNpcModels.has('model:npc_knight')).toBe(true);
    expect(host.prewarmedNpcModels.has('model:npc_guard')).toBe(false);
    // The skipped id stays retryable: with the asset available, the same host
    // warms it on the next zone preparation and the count reaches planned.
    state.unavailable.clear();
    const retry = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(retry.warmed).toBe(2);
    expect(host.prewarmedNpcModels.has('model:npc_guard')).toBe(true);
  });

  it('counts each id sharing a model as done while building the shared visual once', () => {
    state.modelKeys = { npc_knight: 'model:shared', npc_mage: 'model:shared' };
    const host = makeHost(['npc_knight', 'npc_mage']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.warmed).toBe(2);
    expect(built.planned).toBe(2);
    expect(state.createCalls).toEqual(['npc_knight']);
    expect(built.pooled).toHaveLength(1);
    expect(built.pooled[0].key).toBe('npc:npc_knight:0');
    expect(built.group.children).toHaveLength(1);
  });

  it('counts an id with no static NPC record done with nothing built', () => {
    const host = makeHost(['dynamic_only_template']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.warmed).toBe(1);
    expect(built.planned).toBe(1);
    expect(state.createCalls).toEqual([]);
    expect(built.group.children).toHaveLength(0);
  });

  it('reports a deadline trim with the remainder unwarmed instead of masquerading as complete', () => {
    const host = makeHost(['npc_guard', 'npc_knight']);
    const built = buildNpcPrewarmGroup(host, ZONE, 0);
    expect(built.trimmed).toBe(true);
    expect(built.warmed).toBe(0);
    expect(built.planned).toBe(2);
    expect(host.prewarmedNpcModels.size).toBe(0);
  });
});
