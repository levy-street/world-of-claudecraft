// When the Fire and Fly arena is prebuilt and released
// (src/render/fire_and_fly_arena_intent_core.ts): the player targeting Master
// Gunner Alder while eligible, never a passer-by at the Evergarden gate.
import { describe, expect, it } from 'vitest';
import {
  ARENA_INTENT_LAPSE_MS,
  ARENA_INTENT_REACH,
  ARENA_RELEASE_REACH,
  type ArenaIntentWorld,
  createArenaPrebuildState,
  fireAndFlyArenaIntent,
  stepArenaPrebuild,
} from '../src/render/fire_and_fly_arena_intent_core';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';

const ALDER = FIRE_AND_FLY_NPC_DEF.pos;

function world(over: {
  dx?: number;
  targetId?: number | null;
  level?: number;
  row?: 'active' | 'completed' | null;
  dead?: boolean;
  ghost?: boolean;
  seated?: boolean;
}): ArenaIntentWorld {
  const row = over.row === undefined ? 'active' : over.row;
  return {
    player: {
      pos: { x: ALDER.x + (over.dx ?? 3), z: ALDER.z },
      level: over.level ?? WORLD_QUEST_FIRE_AND_FLY.minLevel,
      dead: over.dead ?? false,
      ghost: over.ghost ?? false,
      targetId: over.targetId === undefined ? FIRE_AND_FLY_NPC_ID : over.targetId,
    },
    worldQuestLog: new Map(row ? [[FIRE_AND_FLY_QUEST_ID, { state: row }]] : []),
    turretSession: over.seated ? {} : null,
  };
}

describe('the Fire and Fly arena intent', () => {
  it('holds while an eligible player targets Alder near his post, to play or to practice', () => {
    expect(fireAndFlyArenaIntent(world({}))).toBe(true);
    expect(fireAndFlyArenaIntent(world({ row: 'completed' }))).toBe(true);
    expect(fireAndFlyArenaIntent(world({ dx: ARENA_INTENT_REACH }))).toBe(true);
  });

  it('never fires for a passer-by at the gate, however close', () => {
    expect(fireAndFlyArenaIntent(world({ targetId: null, dx: 1 }))).toBe(false);
    expect(fireAndFlyArenaIntent(world({ targetId: FIRE_AND_FLY_NPC_ID + 1, dx: 1 }))).toBe(false);
  });

  it('needs what the dialog needs: a row, the level, a living player, and no seat', () => {
    expect(fireAndFlyArenaIntent(world({ row: null }))).toBe(false);
    expect(fireAndFlyArenaIntent(world({ level: WORLD_QUEST_FIRE_AND_FLY.minLevel - 1 }))).toBe(
      false,
    );
    expect(fireAndFlyArenaIntent(world({ dead: true }))).toBe(false);
    expect(fireAndFlyArenaIntent(world({ ghost: true }))).toBe(false);
    expect(fireAndFlyArenaIntent(world({ seated: true }))).toBe(false);
  });

  it('ignores a target kept from far away', () => {
    expect(fireAndFlyArenaIntent(world({ dx: ARENA_INTENT_REACH + 0.5 }))).toBe(false);
    expect(fireAndFlyArenaIntent({ player: { targetId: FIRE_AND_FLY_NPC_ID, level: 60 } })).toBe(
      false,
    );
  });
});

describe('the arena prebuild step', () => {
  it('builds nothing without intent, as at world boot', () => {
    const state = createArenaPrebuildState();
    for (let t = 0; t < 10; t++) {
      expect(stepArenaPrebuild(state, world({ targetId: null }), t * 50)).toBe('hold');
    }
    expect(state.built).toBe(false);
  });

  it('builds once on intent and holds while it lasts', () => {
    const state = createArenaPrebuildState();
    expect(stepArenaPrebuild(state, world({}), 0)).toBe('build');
    expect(stepArenaPrebuild(state, world({}), 50)).toBe('hold');
    expect(stepArenaPrebuild(state, world({}), 60_000)).toBe('hold');
    expect(state.built).toBe(true);
  });

  it('releases at the seat: the live arena takes over', () => {
    const state = createArenaPrebuildState();
    stepArenaPrebuild(state, world({}), 0);
    expect(stepArenaPrebuild(state, world({ seated: true }), 50)).toBe('release');
    expect(stepArenaPrebuild(state, world({ seated: true }), 100)).toBe('hold');
    expect(state.built).toBe(false);
  });

  it('releases once the intent has lapsed long enough, and not before', () => {
    const state = createArenaPrebuildState();
    stepArenaPrebuild(state, world({}), 1_000);
    const away = world({ targetId: null });
    expect(stepArenaPrebuild(state, away, 1_000 + ARENA_INTENT_LAPSE_MS - 1)).toBe('hold');
    expect(stepArenaPrebuild(state, away, 1_000 + ARENA_INTENT_LAPSE_MS)).toBe('release');
    expect(stepArenaPrebuild(state, away, 1_000 + ARENA_INTENT_LAPSE_MS + 50)).toBe('hold');
  });

  it('restarts the lapse whenever the intent comes back', () => {
    const state = createArenaPrebuildState();
    stepArenaPrebuild(state, world({}), 0);
    stepArenaPrebuild(state, world({ targetId: null }), ARENA_INTENT_LAPSE_MS - 10);
    stepArenaPrebuild(state, world({}), ARENA_INTENT_LAPSE_MS - 5);
    expect(stepArenaPrebuild(state, world({ targetId: null }), ARENA_INTENT_LAPSE_MS + 5)).toBe(
      'hold',
    );
  });

  it('releases at once when the player walks away', () => {
    const state = createArenaPrebuildState();
    stepArenaPrebuild(state, world({}), 0);
    expect(stepArenaPrebuild(state, world({ dx: ARENA_RELEASE_REACH - 1 }), 50)).toBe('hold');
    expect(stepArenaPrebuild(state, world({ dx: ARENA_RELEASE_REACH + 1 }), 100)).toBe('release');
  });

  it('builds again on a later intent', () => {
    const state = createArenaPrebuildState();
    stepArenaPrebuild(state, world({}), 0);
    stepArenaPrebuild(state, world({ seated: true }), 50);
    expect(stepArenaPrebuild(state, world({}), 90_000)).toBe('build');
  });
});
