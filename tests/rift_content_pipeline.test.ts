import { describe, expect, it } from 'vitest';
import { RIFT_MOBS } from '../src/sim/content/rift/mobs';
import {
  queryRiftMonsters,
  RIFT_MONSTER_BY_ID,
  RIFT_MONSTER_INDEX,
} from '../src/sim/content/rift/monster_index';
import { BUILTIN_WORLD } from '../src/sim/data';
import { loadRiftWorldState, serializeRiftWorldState } from '../src/sim/rift/persistence';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { applyRiftUpgrade, validateRiftUpgrade } from '../src/sim/rift/upgrade';
import { buildHeuristicRiftUpgrade, buildRiftDungeonDraft } from '../src/sim/rift/upgrader_draft';
import { Sim } from '../src/sim/sim';

const TEST_WORLD = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function makeSim(seed = 44221): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    riftPortals: true,
    world: TEST_WORLD,
  });
}

describe('Rift monster index', () => {
  it('indexes every static combat template with searchable metadata', () => {
    expect(RIFT_MONSTER_INDEX.map((entry) => entry.id).sort()).toEqual(
      Object.keys(RIFT_MOBS).sort(),
    );
    for (const entry of RIFT_MONSTER_INDEX) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.themes.length).toBeGreaterThan(0);
      expect(entry.biomes.length).toBeGreaterThan(0);
      expect(entry.lore.length).toBeGreaterThan(20);
      expect(entry.stats.hpPerLevel).toBeGreaterThan(0);
    }
    expect(queryRiftMonsters({ themeId: 'frost', bosses: false }).length).toBeGreaterThanOrEqual(2);
    expect(queryRiftMonsters({ themeId: 'frost', bosses: true })).toHaveLength(1);
  });
});

describe('AI Dungeon Upgrader contract', () => {
  it('builds a valid deterministic fallback after procedural generation', () => {
    const draft = buildRiftDungeonDraft(424242, 22);
    const first = buildHeuristicRiftUpgrade(draft)!;
    const second = buildHeuristicRiftUpgrade(buildRiftDungeonDraft(424242, 22))!;
    expect(first).toEqual(second);
    expect(validateRiftUpgrade(first, draft.floorCount).ok).toBe(true);
    for (const floor of first.floors) {
      for (const monsterId of floor.monsterIds) expect(RIFT_MONSTER_BY_ID[monsterId]).toBeDefined();
    }

    const base = generateRiftFloor(424242, 22, 0);
    const upgraded = applyRiftUpgrade(base, first);
    expect(upgraded).not.toBe(base);
    expect(generateRiftFloor(424242, 22, 0)).toBe(base);
    expect(upgraded.name).toContain(first.title);
  });

  it('rejects invented templates, executable-shaped data, and out-of-range rewards', () => {
    const draft = buildRiftDungeonDraft(424242, 22);
    const manifest = structuredClone(buildHeuristicRiftUpgrade(draft)!);
    manifest.floors[0].monsterIds = ['../../server/evil.ts'];
    manifest.rewards.lootMultiplier = 99;
    (manifest as unknown as Record<string, unknown>).execute = 'rm -rf /';
    const result = validateRiftUpgrade(manifest, draft.floorCount);
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
  });

  // One violation per case, pinned to its own error string, so reverting any
  // single check in validateRiftUpgrade fails its own test (never masked by a
  // sibling violation: the validator accumulates errors and any one rejects).
  it('rejects each violated dimension on its own', () => {
    const draft = buildRiftDungeonDraft(424242, 22);
    const valid = buildHeuristicRiftUpgrade(draft)!;
    const breakOne = (mutate: (m: typeof valid) => void): string[] => {
      const m = structuredClone(valid);
      mutate(m);
      const result = validateRiftUpgrade(m, draft.floorCount);
      expect(result.ok).toBe(false);
      expect(result.value).toBeNull();
      return result.errors ?? [];
    };
    expect(breakOne((m) => (m.floors[0].monsterIds = ['not_a_mob']))).toContain(
      'floor 0 contains an incompatible monster',
    );
    expect(
      breakOne((m) => (m.floors[0].themeId = 'volcano_lair' as (typeof m.floors)[0]['themeId'])),
    ).toContain('floor 0 has invalid theme');
    expect(
      breakOne((m) => (m.floors[0].pacing = 'ultra' as (typeof m.floors)[0]['pacing'])),
    ).toContain('floor 0 has invalid pacing');
    expect(
      breakOne(
        (m) => (m.floors[0].specialEvent = 'jackpot' as (typeof m.floors)[0]['specialEvent']),
      ),
    ).toContain('floor 0 has invalid special event');
    expect(breakOne((m) => (m.rewards.lootMultiplier = 99))).toContain('invalid loot multiplier');
    expect(breakOne((m) => (m.rewards.craftingMaterialBias = -3))).toContain(
      'invalid crafting material bias',
    );
    expect(breakOne((m) => (m.boss.templateId = 'rift_hellguard'))).toContain(
      'invalid boss template',
    );
    expect(breakOne((m) => (m.title = ''))).toContain('invalid title');
    expect(breakOne((m) => m.floors.pop())).toContain(`expected ${draft.floorCount} floors`);
    // Unknown keys are ignored BY DESIGN: an injected executable-shaped key is
    // dropped from the sanitized value, never carried through.
    const smuggled = structuredClone(valid);
    (smuggled as unknown as Record<string, unknown>).execute = 'rm -rf /';
    const sanitized = validateRiftUpgrade(smuggled, draft.floorCount);
    expect(sanitized.ok).toBe(true);
    expect('execute' in (sanitized.value as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('Rift shared-world persistence', () => {
  it('recreates a still-open portal without persisting any group instance', () => {
    const source = makeSim();
    expect(spawnNaturalRiftPortal(source.ctx, 0)).toBe(true);
    const original = source.riftEvents[0];
    const now = 1_800_000_000_000;
    const save = serializeRiftWorldState(source.ctx, now);

    const restored = makeSim();
    expect(loadRiftWorldState(restored.ctx, save, now + 60_000)).toBe(1);
    expect(restored.riftInstances.every((instance) => instance.partyKey === null)).toBe(true);
    expect(restored.riftEvents[0]).toEqual(
      expect.objectContaining({
        eventId: original.eventId,
        status: 'open',
        seed: original.seed,
        contentHash: original.contentHash,
      }),
    );
    const portal = restored.entities.get(restored.naturalRiftPortals[0].id)!;
    expect(portal.riftEventId).toBe(original.eventId);
    expect(portal.pos.x).toBeCloseTo(original.position.x);
    expect(portal.pos.z).toBeCloseTo(original.position.z);
  });

  it('drops malformed saved events instead of loading them', () => {
    const source = makeSim();
    expect(spawnNaturalRiftPortal(source.ctx, 0)).toBe(true);
    const now = 1_800_000_000_000;
    const save = serializeRiftWorldState(source.ctx, now) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    // One saved row, broken one field at a time: the defensive loader must skip
    // the row (0 portals restored), never trust the malformed JSONB.
    const breakOne = (mutate: (row: Record<string, unknown>) => void): number => {
      const copy = structuredClone(save);
      mutate(copy.events[0]);
      const restored = makeSim();
      return loadRiftWorldState(restored.ctx, copy, now + 60_000);
    };
    expect(breakOne((row) => (row.eventId = 'DROP TABLE events'))).toBe(0);
    expect(breakOne((row) => (row.ordinal = 1.5))).toBe(0);
    expect(breakOne((row) => (row.tier = 'X'))).toBe(0);
    expect(breakOne((row) => (row.status = 'winning'))).toBe(0);
    expect(breakOne((row) => (row.upgradeStatus = 'hacked'))).toBe(0);
    expect(breakOne((row) => (row.position = { x: Number.NaN, z: 0 }))).toBe(0);
    expect(breakOne((row) => (row.zoneId = 'eastbrook_vale'))).toBe(0); // not rift-eligible
    expect(breakOne((row) => delete row.riftName)).toBe(0);
  });

  it('collapses an event whose wall-clock deadline elapsed while the realm was down', () => {
    const source = makeSim();
    spawnNaturalRiftPortal(source.ctx, 0);
    const now = 1_800_000_000_000;
    const save = serializeRiftWorldState(source.ctx, now);
    const restored = makeSim();
    expect(loadRiftWorldState(restored.ctx, save, now + 2 * 60 * 60 * 1000)).toBe(0);
    expect(restored.riftEvents[0].status).toBe('collapsed');
    expect(restored.naturalRiftPortals).toHaveLength(0);
  });
});
