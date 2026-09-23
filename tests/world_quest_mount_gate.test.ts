import { describe, expect, it } from 'vitest';
import {
  SHADOW_GUARDS,
  SHADOW_NPC_DEF,
  SHADOW_NPC_ID,
  SHADOW_QUEST_ID,
} from '../src/sim/content/world_quest_shadow';
import { BUILTIN_WORLD } from '../src/sim/data';
import { hasShadowCloak } from '../src/sim/shadow_action_lock';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
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
});
