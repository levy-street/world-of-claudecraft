import { expect, it, vi } from 'vitest';
import {
  handlePickedEntity,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import { FORGE_NPC_DEF, FORGE_STATIONS } from '../src/sim/content/world_quest_forging';
import { Sim } from '../src/sim/sim';

it.each([0, 2])(
  'button %i activates distant workshop supplies without walking or opening dialogue',
  (button) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const player = sim.player;
    player.pos = { x: FORGE_NPC_DEF.pos.x, y: 0, z: FORGE_NPC_DEF.pos.z + 4 };
    const pickUpObject = vi.fn(() => true);
    const interact = vi.fn();
    const world = {
      player,
      questLog: new Map(),
      entities: new Map(),
      targetEntity: vi.fn(),
      pickUpObject,
      interact,
    } as unknown as PickInteractionWorld;
    const hud = {
      openQuestDialog: vi.fn(),
      closeContextMenu: vi.fn(),
      showError: vi.fn(),
    } as unknown as PickInteractionHud;
    for (const station of FORGE_STATIONS) {
      world.entities.set(station.entityId, {
        ...player,
        id: station.entityId,
        kind: 'object',
        templateId: `ground_${station.objectItemId}`,
        objectItemId: station.objectItemId,
        pos: { x: station.x, y: 0, z: station.z },
      });
      expect(handlePickedEntity(world, hud, station.entityId, button, 0, 0)).toBe(true);
      expect(pickUpObject).toHaveBeenLastCalledWith(station.entityId);
    }
    world.entities.set(20, {
      ...player,
      id: 20,
      kind: 'npc',
      templateId: FORGE_NPC_DEF.id,
      pos: { ...FORGE_NPC_DEF.pos, y: 0 },
    });
    expect(handlePickedEntity(world, hud, 20, button, 0, 0)).toBe(true);
    expect(hud.openQuestDialog).toHaveBeenCalledWith(20);
    expect(hud.showError).not.toHaveBeenCalled();
  },
);
