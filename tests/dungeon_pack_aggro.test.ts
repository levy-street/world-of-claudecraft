import { describe, expect, it } from 'vitest';

import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import { aggroDungeonPackmates } from '../src/sim/mob/dungeon_pack_aggro';
import { Sim } from '../src/sim/sim';

describe('authored dungeon pack aggro', () => {
  it('pulls idle claim-local packmates without crossing room or slot namespaces', () => {
    const target = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Tank');
    const pulled = createMob(2, MOBS.ignivar_crucible_warden, 20, { x: 0, y: 0, z: 0 });
    const sentinel = createMob(3, MOBS.ignivar_ember_sentinel, 20, { x: 3, y: 0, z: 0 });
    const otherRoom = createMob(4, MOBS.ignivar_ember_sentinel, 20, { x: 6, y: 0, z: 0 });
    const otherSlot = createMob(5, MOBS.ignivar_ember_sentinel, 20, { x: 9, y: 0, z: 0 });
    pulled.dungeonPackId = 'ignivar_molten_assembly:0:final';
    sentinel.dungeonPackId = 'ignivar_molten_assembly:0:final';
    otherRoom.dungeonPackId = 'ignivar_forge_approach:0:final';
    otherSlot.dungeonPackId = 'ignivar_molten_assembly:1:final';

    aggroDungeonPackmates([pulled, sentinel, otherRoom, otherSlot], pulled, target);

    expect(sentinel).toMatchObject({
      aiState: 'chase',
      aggroTargetId: target.id,
      inCombat: true,
      leashAnchor: sentinel.pos,
    });
    expect(sentinel.threat.get(target.id)).toBe(1);
    expect(otherRoom.aiState).toBe('idle');
    expect(otherSlot.aiState).toBe('idle');
  });

  it('pulls the complete authored pack through the real non-social taunt path', () => {
    const sim = new Sim({ seed: 4821, playerClass: 'paladin', autoEquip: false });
    const pulled = createMob(910_001, MOBS.ignivar_crucible_warden, 20, {
      x: sim.player.pos.x + 25,
      y: 0,
      z: sim.player.pos.z,
    });
    const packmate = createMob(910_002, MOBS.ignivar_ember_sentinel, 20, {
      x: sim.player.pos.x + 28,
      y: 0,
      z: sim.player.pos.z,
    });
    const otherPack = createMob(910_003, MOBS.ignivar_ember_sentinel, 20, {
      x: sim.player.pos.x + 27,
      y: 0,
      z: sim.player.pos.z,
    });
    pulled.dungeonPackId = 'ignivar_forge_approach:0:pack-3';
    packmate.dungeonPackId = pulled.dungeonPackId;
    otherPack.dungeonPackId = 'ignivar_forge_approach:0:pack-4';
    sim.entities.set(pulled.id, pulled);
    sim.entities.set(packmate.id, packmate);
    sim.entities.set(otherPack.id, otherPack);

    (
      sim as unknown as { applyTaunt: (player: typeof sim.player, mob: typeof pulled) => void }
    ).applyTaunt(sim.player, pulled);

    expect(pulled.aggroTargetId).toBe(sim.playerId);
    expect(packmate).toMatchObject({
      aiState: 'chase',
      aggroTargetId: sim.playerId,
      inCombat: true,
    });
    expect(otherPack.aiState).toBe('idle');
  });
});
