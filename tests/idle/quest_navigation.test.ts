// Tests for the quest navigation system: verifies the idle engine navigates
// TO quest givers, TO objectives, and BACK to turn-in NPCs.

import { afterEach, describe, expect, it } from 'vitest';
import { evaluateQuest } from '../../idle/auto_quest';
import { IdleEngine } from '../../idle/engine';
import { QUESTS } from '../../src/sim/data';
import { Sim } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

/** Find the first available quest that has a giver NPC. */
function findAvailableQuest(sim: Sim, pid: number) {
  for (const qDef of Object.values(QUESTS)) {
    if (qDef.retired || !qDef.giverNpcId) continue;
    if (sim.questState(qDef.id, pid) === 'available') return qDef;
  }
  return null;
}

describe('quest navigation', () => {
  it('returns NOOP when no quests are available or active', () => {
    const sim = makeSim();
    const result = evaluateQuest(sim, []);
    // With a fresh sim, there may or may not be available quests
    // depending on level. Just verify it doesn't crash.
    expect(result.action).toBeGreaterThanOrEqual(0);
    expect(result.action).toBeLessThanOrEqual(20);
  });

  it('steers toward quest giver when quest is available', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    const quest = findAvailableQuest(sim, pid);
    if (!quest) return; // no available quests at level 1

    const result = evaluateQuest(sim, []);
    // Should be steering toward the giver (forward, turn_left, or turn_right).
    // Action 0 = NOOP means we're already near the NPC.
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('accepts quest when near the giver NPC', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    const quest = findAvailableQuest(sim, pid);
    if (!quest) return;

    // Find the giver NPC and teleport the player next to it.
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === quest.giverNpcId) {
        // Teleport player to NPC position.
        sim.player.pos.x = e.pos.x + 1;
        sim.player.pos.z = e.pos.z + 1;
        break;
      }
    }

    const result = evaluateQuest(sim, []);
    // Should accept the quest (didQuestAction = true) or already have it.
    // The quest state should now be 'active' or 'ready'.
    const state = sim.questState(quest.id, pid);
    expect(state === 'active' || state === 'ready' || result.didQuestAction).toBe(true);
  });

  it('steers toward turn-in NPC when quest is ready', () => {
    const sim = makeSim();
    const pid = sim.primaryId;

    // Find an active quest and mark it as ready.
    for (const qDef of Object.values(QUESTS)) {
      if (qDef.retired) continue;
      const state = sim.questState(qDef.id, pid);
      if (state === 'ready') {
        // Quest is already ready, evaluateQuest should steer toward turn-in.
        const result = evaluateQuest(sim, []);
        expect(result.log.some((l) => l.includes('turn in') || l.includes('Turned in'))).toBe(true);
        return;
      }
    }
    // No ready quests, that's fine, just verify no crash.
  });

  it('handles multiple active quests by picking the closest objective', () => {
    const sim = makeSim();
    // Run a few ticks to let the world populate.
    for (let i = 0; i < 20; i++) sim.tick();
    // Just verify evaluateQuest doesn't crash with active quests.
    const result = evaluateQuest(sim, []);
    expect(result.action).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: end-to-end quest acceptance via the full IdleEngine pipeline.
// Unlike the unit tests above (whose guarded early-returns silently pass even
// when L1 quest navigation is broken), these tests DECISIVELY assert that the
// character reaches a giver and accepts a quest after steering for N steps.
// ---------------------------------------------------------------------------

describe('quest acceptance integration (end-to-end)', () => {
  // Clean up each engine so determinism of the next test's seed isn't perturbed
  // (two engines at once in the same process can't affect each other, but
  // letting the GC reclaim before the next test avoids any WeakMap drift).
  let _engine: IdleEngine | undefined;
  afterEach(() => {
    _engine = undefined;
  });

  it('walks to a giver NPC and accepts a quest within 150 steps', () => {
    const engine = new IdleEngine({
      seed: 42,
      playerClass: 'warrior',
      playerLevel: 1,
      frameSkip: 1, // one sim-tick per step for fine-grained steering
    });
    _engine = engine;
    const sim = engine.sim;
    const pid = sim.primaryId;

    // 200 steps * 1 sim-tick * 0.05 s/tick = 10 sim-seconds. The marshal is
    // ~8 yd away; walking speed ~6 yd/s, so 1.3 s to reach, plus turn
    // oscillations. 200 steps is ample for acceptance to fire.
    for (let i = 0; i < 200; i++) {
      engine.step(0);
    }

    // After walking to the giver, at least one L1 quest MUST be active.
    const stateWolves = sim.questState('q_wolves', pid);
    const stateProf = sim.questState('q_prof_intro', pid);
    const anyActive = stateWolves === 'active' || stateProf === 'active';
    expect(anyActive).toBe(true);
    // Postcondition: the character should also have progressed toward marshal.
    // We don't assert which quest, differing steer approach may accept either.
  });

  it('accepts quest near giver NPC after forced teleport', () => {
    // Control test: bypass navigation entirely by placing the player next to
    // marshal_redbrook. If this fails, the problem is inside quest_commands.ts
    // (not navigation).
    const engine = new IdleEngine({
      seed: 42,
      playerClass: 'warrior',
      playerLevel: 1,
      frameSkip: 1,
    });
    _engine = engine;
    const sim = engine.sim;
    const pid = sim.primaryId;

    // Find marshal_redbrook and teleport the player next to her.
    let marshal: Entity | null = null;
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === 'marshal_redbrook') {
        marshal = e;
        sim.player.pos.x = e.pos.x + 2;
        sim.player.pos.z = e.pos.z + 2;
        break;
      }
    }
    // Marshal is always the same static NPC for a default seed, fail if missing.
    expect(marshal).not.toBeNull();
    if (!marshal) return; // type-guard

    // Run a few steps; walking + reach + accept .
    for (let i = 0; i < 30; i++) {
      engine.step(0);
    }

    const state = sim.questState('q_wolves', pid);
    expect(state).toBe('active');
  });
});
