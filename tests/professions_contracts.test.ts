import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  EMPTY_PROFESSIONS_INFO,
  PROFESSIONS_CHARACTER_STATE_KEY,
  PROFESSIONS_SELF_WIRE_KEY,
} from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import type {
  ProfessionCraftRecord,
  ProfessionNodeRecord,
  ProfessionRecipeRecord,
  ProfessionSkillRecord,
} from '../src/world_api';

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;

  constructor(public readonly url: string) {}

  send(): void {
    /* no-op */
  }

  close(): void {
    /* no-op */
  }
}

function makeClientWorld(): ClientWorld {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    const world = new ClientWorld('professions-contract-token', 1, 'warrior', 'http://localhost');
    world.close();
    return world;
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

describe('professions contracts', () => {
  it('pins the persistence and self-snapshot key names for downstream slices', () => {
    expect(PROFESSIONS_CHARACTER_STATE_KEY).toBe('professions');
    expect(PROFESSIONS_SELF_WIRE_KEY).toBe('professions');
  });

  it('defines content-as-code records for skills, crafts, recipes, and nodes', () => {
    const skill = {
      id: 'mining',
      kind: 'gathering',
      nameKey: 'professions.skill.mining',
      maxRank: 300,
    } satisfies ProfessionSkillRecord;
    const craft = {
      id: 'blacksmithing',
      skillId: skill.id,
      nameKey: 'professions.craft.blacksmithing',
      unlockRank: 1,
    } satisfies ProfessionCraftRecord;
    const recipe = {
      id: 'bronze_sword',
      craftId: craft.id,
      output: { itemId: 'bronze_sword', count: 1 },
      inputs: [{ itemId: 'bronze_bar', count: 2 }],
      tier: 'common',
      unlockRank: 25,
    } satisfies ProfessionRecipeRecord;
    const node = {
      id: 'elwynn_copper_01',
      skillId: skill.id,
      zoneId: 'zone1',
      kind: 'ore',
      material: { itemId: 'copper_ore', count: 1 },
      tier: 'common',
      respawnSeconds: 180,
    } satisfies ProfessionNodeRecord;

    expect({ skill, craft, recipe, node }).toMatchObject({
      skill: { id: 'mining' },
      craft: { skillId: 'mining' },
      recipe: { craftId: 'blacksmithing' },
      node: { material: { itemId: 'copper_ore' } },
    });
  });

  it('exposes the empty professions read surface on Sim and ClientWorld', () => {
    expect(new Sim({ seed: 1, playerClass: 'warrior' }).professionsInfo()).toEqual(
      EMPTY_PROFESSIONS_INFO,
    );
    expect(makeClientWorld().professionsInfo()).toEqual(EMPTY_PROFESSIONS_INFO);
  });
});
