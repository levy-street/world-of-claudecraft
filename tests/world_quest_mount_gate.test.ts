import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_CALLIGRAPHY_NPC_IDS } from '../src/sim/content/world_quest_calligraphy';
import { FORGE_NPC_ID } from '../src/sim/content/world_quest_forging';
import { GLIDER_NPC_ID } from '../src/sim/content/world_quest_glider';
import {
  SHADOW_GUARDS,
  SHADOW_NPC_DEF,
  SHADOW_NPC_ID,
  SHADOW_QUEST_ID,
} from '../src/sim/content/world_quest_shadow';
import { WISP_MAZE_NPC_ID } from '../src/sim/content/world_quest_wisp_maze';
import { BUILTIN_WORLD } from '../src/sim/data';
import { hasShadowCloak } from '../src/sim/shadow_action_lock';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import { dismountForWorldQuestInstructor } from '../src/sim/world_quest_mount_gate';
import { WORLD_SEED } from '../src/sim/world_seed';

function fakeCtx() {
  const calls: Entity[] = [];
  return { ctx: { forceDismount: (e: Entity) => void calls.push(e) }, calls };
}

describe('world quest instructor mount gate', () => {
  it('puts the rider own mount away and lets the instructor proceed', () => {
    const { ctx, calls } = fakeCtx();
    const player = { id: 1 } as Entity;
    expect(dismountForWorldQuestInstructor(ctx, player, { vehicle: null, mountRace: null })).toBe(
      true,
    );
    expect(calls).toEqual([player]);
  });

  it.each([
    ['vehicle', { vehicle: {} as never, mountRace: null }],
    ['mount race', { vehicle: null, mountRace: {} as never }],
  ])('refuses without dismounting while a %s owns the player', (_label, meta) => {
    const { ctx, calls } = fakeCtx();
    expect(dismountForWorldQuestInstructor(ctx, { id: 1 } as Entity, meta)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('dismounts a rider who talks to the shadow scout instead of ignoring the talk', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: {
        ...BUILTIN_WORLD,
        camps: [],
        groundObjects: [],
        npcs: Object.fromEntries(
          [SHADOW_NPC_DEF, ...SHADOW_GUARDS.map((row) => row.npc)].map((npc) => [npc.id, npc]),
        ),
      },
    });
    sim.resetDay = '2026-09-06';
    sim.chat('/dev shadow');
    sim.player.mountKey = 'valorsteed';
    sim.talkToNpc(SHADOW_NPC_ID);
    expect(sim.player.mountKey).toBe('');
    expect(hasShadowCloak(sim.player)).toBe(true);
    expect(sim.worldQuestLog.get(SHADOW_QUEST_ID)?.shadow?.phase).toBe('cloaked');
  });

  it.each([
    [
      'glider',
      '/dev glider',
      GLIDER_NPC_ID,
      'countdown',
      (p: WorldQuestProgress) => p.glider?.phase,
    ],
    ['forge', '/dev forge', FORGE_NPC_ID, 'countdown', (p: WorldQuestProgress) => p.forging?.phase],
    [
      'wisp maze',
      '/dev wisps',
      WISP_MAZE_NPC_ID,
      'countdown',
      (p: WorldQuestProgress) => p.wispMaze?.phase,
    ],
    [
      'calligraphy',
      '/dev calligraphy',
      WORLD_QUEST_CALLIGRAPHY_NPC_IDS.calligraphy_instructor,
      'preview',
      (p: WorldQuestProgress) => p.tracing?.phase,
    ],
  ] as const)(
    'starts the %s activity for a rider and puts the mount away',
    (_l, cmd, npcId, start, phase) => {
      const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
      sim.resetDay = '2026-09-06';
      sim.chat(cmd);
      sim.tick();
      const npc = sim.entities.get(npcId)!;
      sim.player.pos = sim.groundPos(npc.pos.x + 1.5, npc.pos.z);
      sim.player.prevPos = { ...sim.player.pos };
      // Nothing is running before the talk, so the phase below is the talk's own start.
      expect([...sim.worldQuestLog.values()].map(phase).filter(Boolean)).toEqual([]);
      sim.player.mountKey = 'valorsteed';
      sim.player.targetId = npcId;
      sim.interact();
      expect(sim.player.mountKey).toBe('');
      expect([...sim.worldQuestLog.values()].map(phase).filter(Boolean)).toEqual([start]);
    },
  );
});
