// The per-class script asks each class only for things a fresh level 1 of that
// class can actually do. A step naming an ability the player has not learned yet
// is an unwinnable tutorial, so this is checked against the real ABILITIES table
// rather than a copy of it.

import { describe, expect, it } from 'vitest';
import { AUTO_SHOT_LABEL } from '../src/sim/combat/auto_attack';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ALL_CLASSES } from '../src/sim/types';
import { hasTranslation, type TranslationKey } from '../src/ui/i18n';
import { AUTO_SHOT_ABILITY_LABEL } from '../src/ui/starter_tutorial';
import {
  scriptedAbilityIds,
  starterTutorialScript,
  TUTORIAL_QUEST_ID,
  WARDEN_REACH_YARDS,
} from '../src/ui/starter_tutorial_script';

describe('starter tutorial script', () => {
  it('never asks a class for an ability it has not learned at level 1', () => {
    for (const cls of ALL_CLASSES) {
      const known = new Set(abilitiesKnownAt(cls, 1).map((a) => a.def.id));
      for (const id of scriptedAbilityIds(cls)) {
        expect(known.has(id), `${cls} is asked for ${id}, which it does not know at level 1`).toBe(
          true,
        );
      }
    }
  });

  it('the hunter is the one class taught to shoot, and it is a real hunter thing', () => {
    // The hunter has exactly ONE ability at level 1, so its second challenge cannot
    // be another ability. It is the ranged auto-attack instead, which is the whole
    // point of the class, and which every hunter can do from the first second (the
    // class carries an intrinsic `ranged` profile, no bow item required).
    const hunter = starterTutorialScript('hunter');
    expect(hunter.find((s) => s.id === 'mastery')!.objective).toEqual({
      kind: 'rangedHit',
      count: 3,
    });
    expect(abilitiesKnownAt('hunter', 1)).toHaveLength(1);
  });

  it('the ranged-hit step matches the label the sim actually stamps on the event', () => {
    // The controller counts an Auto Shot by matching this literal against the damage
    // event's `ability`. If the sim renames the label, the hunter's step silently
    // stops advancing, so the two are pinned together here.
    expect(AUTO_SHOT_ABILITY_LABEL).toBe(AUTO_SHOT_LABEL);
  });

  it('the rogue spends what the rogue built', () => {
    // Sinister Strike awards combo points; Eviscerate spends them. Ordering the two
    // steps the other way round would make the finisher uncastable.
    const rogue = starterTutorialScript('rogue');
    const sig = rogue.findIndex((s) => s.id === 'signature');
    const mas = rogue.findIndex((s) => s.id === 'mastery');
    expect(sig).toBeLessThan(mas);
    expect(rogue[sig].objective).toMatchObject({ abilityId: 'sinister_strike' });
    expect(rogue[mas].objective).toMatchObject({ abilityId: 'eviscerate' });
  });

  it('every step points somewhere the player can be sent', () => {
    for (const cls of ALL_CLASSES) {
      for (const step of starterTutorialScript(cls)) {
        expect(['warden', 'yard', 'hollow', null], `${cls}/${step.id}`).toContain(step.pointAt);
      }
    }
  });

  it('every step the script can produce has all of its copy', () => {
    // The regression this exists for: the objective line is keyed by STEP id for the
    // shared spine but by objective KIND for the two class steps, and getting that
    // resolution backwards throws on an untracked key at runtime, which blanks the
    // whole card. Walk every class's every step and prove each key resolves.
    const CLASS_STEPS = new Set(['signature', 'mastery']);
    for (const cls of ALL_CLASSES) {
      for (const step of starterTutorialScript(cls)) {
        const objectiveKey = `hudChrome.starterTutorial.objective.${
          CLASS_STEPS.has(step.id) ? step.objective.kind : step.id
        }`;
        expect(hasTranslation(objectiveKey as TranslationKey), objectiveKey).toBe(true);

        const bodyKey = CLASS_STEPS.has(step.id)
          ? `hudChrome.starterTutorial.class.${cls}.${step.id}`
          : `hudChrome.starterTutorial.steps.${step.id}`;
        expect(hasTranslation(bodyKey as TranslationKey), bodyKey).toBe(true);
      }
    }
    // ...and the chrome around them.
    for (const key of [
      'hudChrome.starterTutorial.stepLabel',
      'hudChrome.starterTutorial.skip',
      'hudChrome.starterTutorial.leave',
      'hudChrome.starterTutorial.doneTitle',
      'hudChrome.starterTutorial.doneBody',
      'hudChrome.starterTutorial.objectiveDone',
      'hudChrome.starterTutorial.objectiveCount',
      'hudChrome.starterTutorial.scenes.wardenReveal',
      'hudChrome.starterTutorial.scenes.yardReveal',
      'hudChrome.starterTutorial.scenes.wolfReveal',
      'starterTutorial.title',
      'starterTutorial.body',
      'starterTutorial.accept',
      'starterTutorial.decline',
    ]) {
      expect(hasTranslation(key as TranslationKey), key).toBe(true);
    }
  });

  it('the reach radius is generous enough to be inside talking range', () => {
    // The `land` step completes on proximity; the `enlist` step then needs the
    // player to actually be able to talk to her. A reach radius wider than the sim's
    // interact range would complete the walk step while she is still out of reach.
    expect(WARDEN_REACH_YARDS).toBeLessThanOrEqual(6);
    expect(TUTORIAL_QUEST_ID).toBe('q_dawnhaven_wolves');
  });
});
