// The World Quests tracker section lists a world quest only while its player is
// in the quest's area, with a grace period on leaving and on completion
// (src/ui/hud/quest/world_quest_tracker_visibility.ts).
import { describe, expect, it } from 'vitest';
import { positionInWorldQuestArea } from '../src/sim/world_quest_area';
import {
  createWorldQuestTrackerVisibility,
  WORLD_QUEST_TRACKER_GRACE_MS as GRACE,
} from '../src/ui/hud/quest/world_quest_tracker_visibility';

const inside = { inArea: true, complete: false, lessonRunning: false };
const outside = { inArea: false, complete: false, lessonRunning: false };
const done = { inArea: true, complete: true, lessonRunning: false };

describe('world quest tracker visibility', () => {
  it('lists a quest only inside its area; never one the player has not entered', () => {
    const v = createWorldQuestTrackerVisibility();
    expect(v.visible('wq_a', outside, 0)).toBe(false);
    expect(v.visible('wq_a', inside, 100)).toBe(true);
  });

  it('keeps a quest a few seconds after leaving, and keeps it if the player returns in time', () => {
    const v = createWorldQuestTrackerVisibility();
    v.visible('wq_a', inside, 0);
    expect(v.visible('wq_a', outside, 1_000)).toBe(true);
    expect(v.visible('wq_a', outside, 1_000 + GRACE - 1)).toBe(true);
    // Back inside before the grace ran out: it stays, and the clock resets.
    expect(v.visible('wq_a', inside, 1_000 + GRACE - 1)).toBe(true);
    expect(v.visible('wq_a', outside, 10_000)).toBe(true);
    // Away for good: gone once the grace runs out, back when the player returns.
    expect(v.visible('wq_a', outside, 10_000 + GRACE)).toBe(false);
    expect(v.visible('wq_a', outside, 60_000)).toBe(false);
    expect(v.visible('wq_a', inside, 61_000)).toBe(true);
  });

  it('shows a completed quest for a few seconds, then drops it even inside the area', () => {
    const v = createWorldQuestTrackerVisibility();
    v.visible('wq_a', inside, 0);
    expect(v.visible('wq_a', done, 2_000)).toBe(true);
    expect(v.visible('wq_a', done, 2_000 + GRACE - 1)).toBe(true);
    expect(v.visible('wq_a', done, 2_000 + GRACE)).toBe(false);
    expect(v.visible('wq_a', done, 90_000)).toBe(false);
  });

  it('never flashes a quest completed before the tracker listed it (a reload, a relog)', () => {
    const v = createWorldQuestTrackerVisibility();
    expect(v.visible('wq_a', done, 0)).toBe(false);
  });

  it('always lists a running lesson, wherever the player is', () => {
    const v = createWorldQuestTrackerVisibility();
    expect(v.visible('wq_a', { inArea: false, complete: false, lessonRunning: true }, 0)).toBe(
      true,
    );
  });

  it('forgets quests that left the log, so a new day starts clean', () => {
    const v = createWorldQuestTrackerVisibility();
    v.visible('wq_a', inside, 0);
    v.retain(new Set());
    expect(v.visible('wq_a', outside, 1)).toBe(false);
  });

  it('uses the sim area edge (one shared rule)', () => {
    const quest = { area: { x: 10, z: 20, radius: 5 } };
    expect(positionInWorldQuestArea({ x: 10, z: 25 }, quest)).toBe(true);
    expect(positionInWorldQuestArea({ x: 10, z: 25.01 }, quest)).toBe(false);
  });
});
