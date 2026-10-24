import { describe, expect, it, vi } from 'vitest';
import { NPCS } from '../src/sim/data';
import { createNpc } from '../src/sim/entity';
import { updateNpc } from '../src/sim/npc_update';
import type { SimContext } from '../src/sim/sim_context';

describe('friendly NPC scripted movement', () => {
  it('leaves ordinary NPCs stationary', () => {
    const npc = createNpc(1, NPCS.brother_aldric_raid, { x: 0, y: 0, z: 0 });
    const moveToward = vi.fn();
    updateNpc({ emit: vi.fn(), moveToward } as unknown as SimContext, npc);
    expect(moveToward).not.toHaveBeenCalled();
  });

  it('cleanses hostile auras before walking and clears the target only on arrival', () => {
    const npc = createNpc(1, NPCS.brother_aldric_raid, { x: 0, y: 0, z: 0 });
    npc.auras.push({
      id: 'test_stun',
      name: 'Test stun',
      kind: 'stun',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: 2,
      school: 'physical',
    });
    const target = { x: 8, y: 0, z: 24 };
    npc.wanderTarget = target;
    const moveToward = vi.fn(() => {
      expect(npc.auras).toHaveLength(0);
      return false;
    });
    const ctx = { emit: vi.fn(), moveToward } as unknown as SimContext;
    updateNpc(ctx, npc);
    expect(moveToward).toHaveBeenCalledWith(npc, target, npc.moveSpeed);
    expect(npc.wanderTarget).toBe(target);
    moveToward.mockReturnValue(true);
    updateNpc(ctx, npc);
    expect(npc.wanderTarget).toBeNull();
    updateNpc(ctx, npc);
    expect(moveToward).toHaveBeenCalledTimes(2);
  });
});
