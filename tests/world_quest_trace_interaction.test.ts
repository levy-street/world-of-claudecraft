import { describe, expect, it, vi } from 'vitest';
import {
  handlePickedEntity,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import {
  type NearbyInteractionHud,
  type NearbyInteractionWorld,
  tryNearbyInteraction,
} from '../src/game/nearby_interaction';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';
import { isWorldQuestTraceInstructor } from '../src/sim/world_quest_trace_identity';

function rig(templateId = 'calligraphy_instructor', distance = 1) {
  const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const npc = {
    id: 2,
    kind: 'npc',
    templateId,
    pos: { x: distance, y: 0, z: 0 },
    dead: false,
  } as Entity;
  const calls: string[] = [];
  const world = {
    player,
    entities: new Map([
      [1, player],
      [2, npc],
    ]),
    questLog: new Map(),
    farmPatches: [],
    targetEntity: (id: number | null) => calls.push(`target:${id}`),
    interact: () => calls.push('interact'),
  } as unknown as PickInteractionWorld & NearbyInteractionWorld;
  const hud = {
    openQuestDialog: vi.fn(),
    closeContextMenu: vi.fn(),
    showError: vi.fn(),
    openPlantSheet: vi.fn(),
  } as unknown as PickInteractionHud & NearbyInteractionHud;
  return { world, hud, calls, player, npc };
}

describe('calligraphy NPC interaction', () => {
  it('recognizes only the instructor, not learners or similarly named NPCs', () => {
    expect(isWorldQuestTraceInstructor('calligraphy_instructor')).toBe(true);
    expect(isWorldQuestTraceInstructor('calligraphy_instructor_2')).toBe(false);
    expect(isWorldQuestTraceInstructor('calligraphy_apprentice_1')).toBe(false);
  });

  it.each([0, 2])(
    'opens quest dialog with mouse button %i to confirm starting the WQ',
    (button) => {
      const r = rig();
      expect(handlePickedEntity(r.world, r.hud, 2, button, 0, 0)).toBe(true);
      expect(r.calls).toEqual(['target:2']);
      expect(r.hud.openQuestDialog).toHaveBeenCalledWith(2);
    },
  );

  it.each([0, 2])('keeps dead and out-of-range gates for button %i', (button) => {
    const r = rig();
    r.player.dead = true;
    expect(handlePickedEntity(r.world, r.hud, 2, button, 0, 0)).toBe(false);
    r.player.dead = false;
    r.npc.pos.x = INTERACT_RANGE + 3;
    expect(handlePickedEntity(r.world, r.hud, 2, button, 0, 0)).toBe(false);
    expect(r.calls).not.toContain('interact');
  });

  it.each([undefined, 2])(
    'uses the shared nearby keyboard/pad route with preferred target %s',
    (preferred) => {
      const r = rig();
      if (preferred !== undefined) {
        const nearerApprentice = {
          ...r.npc,
          id: 3,
          templateId: 'calligraphy_apprentice_1',
          pos: { x: 0.25, y: 0, z: 0 },
        };
        (r.world.entities as Map<number, Entity>).set(3, nearerApprentice);
      }
      expect(tryNearbyInteraction(r.world, r.hud, 'away', 'nothing', true, preferred)).toBe(true);
      expect(r.hud.openQuestDialog).toHaveBeenCalledWith(2);
    },
  );

  it('does not dispatch a nearby lesson while dead or beyond interaction range', () => {
    const r = rig();
    r.player.dead = true;
    expect(tryNearbyInteraction(r.world, r.hud, 'away', 'nothing')).toBe(false);
    r.player.dead = false;
    r.npc.pos.x = INTERACT_RANGE + 3;
    expect(tryNearbyInteraction(r.world, r.hud, 'away', 'nothing')).toBe(false);
    expect(r.calls).not.toContain('interact');
  });

  it('preserves normal apprentice gossip', () => {
    const r = rig('calligraphy_apprentice_1');
    expect(handlePickedEntity(r.world, r.hud, 2, 0, 0, 0)).toBe(true);
    expect(r.hud.openQuestDialog).toHaveBeenCalledWith(2);
    expect(r.calls).toEqual(['target:2']);
  });
});
