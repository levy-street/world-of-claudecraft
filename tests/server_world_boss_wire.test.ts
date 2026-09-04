import { describe, expect, it, vi } from 'vitest';
import { activeWorldBossIdsWireJson } from '../server/world_boss_wire';
import { WORLD_BOSSES } from '../src/sim/world_boss';

describe('world-boss realm snapshot fragment', () => {
  it('serializes only active registry ids in registry order', () => {
    const active = vi.fn((bossId: string) => bossId === WORLD_BOSSES[0].templateId);
    expect(activeWorldBossIdsWireJson({ worldBossActive: active })).toBe(
      JSON.stringify([WORLD_BOSSES[0].templateId]),
    );
    expect(active).toHaveBeenCalledTimes(WORLD_BOSSES.length);
  });

  it('serializes the stable empty state', () => {
    expect(activeWorldBossIdsWireJson({ worldBossActive: () => false })).toBe('[]');
  });
});
