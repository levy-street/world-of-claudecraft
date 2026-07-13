// The starter tutorial's step machine. These assertions are the contract that a
// step CANNOT advance without the evidence it asks for, and that evidence for one
// class's challenge never credits another's.

import { describe, expect, it } from 'vitest';
import { ALL_CLASSES, type PlayerClass, type QuestState } from '../src/sim/types';
import {
  advanceTutorial,
  currentStep,
  EMPTY_TICK,
  initialTutorialState,
  isTutorialComplete,
  objectiveProgress,
  type TutorialSnapshot,
  type TutorialTick,
} from '../src/ui/starter_tutorial_core';
import {
  scriptedAbilityIds,
  starterTutorialScript,
  TUTORIAL_DUMMY_ID,
  TUTORIAL_LOOT_ITEM_ID,
} from '../src/ui/starter_tutorial_script';

function snap(over: Partial<TutorialSnapshot> = {}): TutorialSnapshot {
  return {
    distToWarden: 100,
    targetTemplateId: null,
    auraAbilityIds: [],
    hasPet: false,
    lootItemCount: 0,
    questState: 'available' as QuestState,
    ...over,
  };
}

function tick(over: Partial<TutorialTick> = {}): TutorialTick {
  return { ...EMPTY_TICK, ...over };
}

/** Drive the machine to the step with this id, by feeding it exactly the evidence
 *  each earlier step wants. Returns the state parked on `stepId`. */
function driveTo(cls: PlayerClass, stepId: string) {
  const script = starterTutorialScript(cls);
  let state = initialTutorialState();
  let s = snap();

  const target = script.findIndex((st) => st.id === stepId);
  expect(target).toBeGreaterThanOrEqual(0);

  for (let guard = 0; state.stepIndex < target && guard < 50; guard++) {
    const step = script[state.stepIndex];
    const o = step.objective;
    let t = tick();
    switch (o.kind) {
      case 'reachWarden':
        s = { ...s, distToWarden: 1 };
        break;
      case 'targetMob':
        s = { ...s, targetTemplateId: o.templateId };
        break;
      case 'autoAttack':
        t = tick({ autoAttackHits: o.count });
        break;
      case 'abilityHit':
        t = tick({ abilityHits: { [o.abilityId]: o.count } });
        break;
      case 'auraUp':
        s = { ...s, auraAbilityIds: [o.abilityId] };
        break;
      case 'healSelf':
        t = tick({ selfHeals: o.count });
        break;
      case 'rangedHit':
        t = tick({ rangedHits: o.count });
        break;
      case 'petSummoned':
        s = { ...s, hasPet: true };
        break;
      case 'questState':
        s = { ...s, questState: o.state };
        break;
      case 'lootItem':
        s = { ...s, lootItemCount: o.count };
        break;
    }
    state = advanceTutorial(state, script, s, t);
  }
  return { script, state, snapshot: s };
}

describe('starter tutorial step machine', () => {
  it('starts parked on the first step and does not advance on empty evidence', () => {
    const script = starterTutorialScript('warrior');
    let state = initialTutorialState();
    expect(currentStep(state, script)?.id).toBe('land');

    // Standing on the beach doing nothing for a hundred frames advances nothing.
    for (let i = 0; i < 100; i++) state = advanceTutorial(state, script, snap(), tick());
    expect(currentStep(state, script)?.id).toBe('land');
    expect(isTutorialComplete(state, script)).toBe(false);
  });

  it("advances only when the current step's own evidence arrives", () => {
    const script = starterTutorialScript('mage');
    let state = initialTutorialState();

    // Wrong evidence for `land`: hitting things does not walk you to the Warden.
    state = advanceTutorial(state, script, snap(), tick({ autoAttackHits: 99 }));
    expect(currentStep(state, script)?.id).toBe('land');

    // Right evidence.
    state = advanceTutorial(state, script, snap({ distToWarden: 3 }), tick());
    expect(currentStep(state, script)?.id).toBe('enlist');
  });

  it("does not credit one class's signature ability with another's", () => {
    const script = starterTutorialScript('mage');
    const { state: atSignature } = driveTo('mage', 'signature');
    expect(currentStep(atSignature, script)?.id).toBe('signature');

    // The warrior's opener lands twice. The mage's step must not move.
    const wrong = advanceTutorial(
      atSignature,
      script,
      snap({ questState: 'active', distToWarden: 40 }),
      tick({ abilityHits: { heroic_strike: 2 } }),
    );
    expect(currentStep(wrong, script)?.id).toBe('signature');

    // One Cinderbolt is not enough either: the step asks for two.
    const half = advanceTutorial(
      atSignature,
      script,
      snap({ questState: 'active' }),
      tick({ abilityHits: { fireball: 1 } }),
    );
    expect(currentStep(half, script)?.id).toBe('signature');
    expect(objectiveProgress(script[half.stepIndex].objective, half, snap())).toEqual({
      current: 1,
      total: 2,
    });

    // The second one advances it.
    const done = advanceTutorial(
      half,
      script,
      snap({ questState: 'active' }),
      tick({
        abilityHits: { fireball: 1 },
      }),
    );
    expect(currentStep(done, script)?.id).toBe('mastery');
  });

  it('keeps progress once earned: a dropped aura does not un-complete its step', () => {
    const script = starterTutorialScript('mage');
    const { state } = driveTo('mage', 'mastery');
    expect(currentStep(state, script)?.id).toBe('mastery'); // auraUp frost_armor

    // Frost Armor goes up...
    const up = advanceTutorial(state, script, snap({ auraAbilityIds: ['frost_armor'] }), tick());
    expect(currentStep(up, script)?.id).toBe('hunt');

    // ...and later expires. The tutorial must not walk backwards into the step it
    // already cleared.
    const expired = advanceTutorial(up, script, snap({ auraAbilityIds: [] }), tick());
    expect(currentStep(expired, script)?.id).toBe('hunt');
  });

  it('treats a quest milestone as reached when the player has already blown past it', () => {
    // `enlist` wants the quest 'active'. A player who somehow arrives with it
    // already 'ready' must not be stranded on a milestone they are past.
    const script = starterTutorialScript('rogue');
    let state = initialTutorialState();
    state = advanceTutorial(state, script, snap({ distToWarden: 1, questState: 'ready' }), tick());
    expect(currentStep(state, script)?.id).toBe('target');
  });

  it('runs every class end to end and finishes', () => {
    for (const cls of ALL_CLASSES) {
      const script = starterTutorialScript(cls);
      const { state } = driveTo(cls, script[script.length - 1].id);
      // Park on the last step, then satisfy it.
      const final = advanceTutorial(state, script, snap({ questState: 'done' }), tick());
      expect(isTutorialComplete(final, script), `${cls} should finish`).toBe(true);
      expect(currentStep(final, script)).toBeNull();
    }
  });

  it('the loot step counts the item, not the kill', () => {
    const script = starterTutorialScript('priest');
    const { state } = driveTo('priest', 'spoils');
    expect(script[state.stepIndex].objective).toEqual({
      kind: 'lootItem',
      itemId: TUTORIAL_LOOT_ITEM_ID,
      count: 1,
    });
    // Quest ready (three wolves dead) but nothing looted: still on `spoils`.
    const unlooted = advanceTutorial(state, script, snap({ questState: 'ready' }), tick());
    expect(currentStep(unlooted, script)?.id).toBe('spoils');

    const looted = advanceTutorial(
      state,
      script,
      snap({ questState: 'ready', lootItemCount: 1 }),
      tick(),
    );
    expect(currentStep(looted, script)?.id).toBe('report');
  });

  it('targets the practice dummy, not any old mob', () => {
    const script = starterTutorialScript('shaman');
    const { state } = driveTo('shaman', 'target');
    const wrongMob = advanceTutorial(
      state,
      script,
      snap({ questState: 'active', targetTemplateId: 'dawnhaven_strandwolf' }),
      tick(),
    );
    expect(currentStep(wrongMob, script)?.id).toBe('target');

    const right = advanceTutorial(
      state,
      script,
      snap({ questState: 'active', targetTemplateId: TUTORIAL_DUMMY_ID }),
      tick(),
    );
    expect(currentStep(right, script)?.id).toBe('strike');
  });

  it('every class is taught exactly two class-specific steps', () => {
    for (const cls of ALL_CLASSES) {
      const script = starterTutorialScript(cls);
      const ids = script.map((s) => s.id);
      expect(ids, cls).toContain('signature');
      expect(ids, cls).toContain('mastery');
      expect(ids.length, cls).toBe(9);
    }
  });

  it('no two classes get the same pair of class challenges', () => {
    const seen = new Map<string, PlayerClass>();
    for (const cls of ALL_CLASSES) {
      const script = starterTutorialScript(cls);
      const sig = script.find((s) => s.id === 'signature')!.objective;
      const mas = script.find((s) => s.id === 'mastery')!.objective;
      const key = JSON.stringify([sig, mas]);
      expect(seen.has(key), `${cls} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, cls);
    }
  });

  it('exposes the ability ids its class steps name', () => {
    expect(scriptedAbilityIds('warrior')).toEqual(['heroic_strike', 'battle_shout']);
    // The warlock's mastery is his demon, which names no ability.
    expect(scriptedAbilityIds('warlock')).toEqual(['shadow_bolt']);
  });
});
