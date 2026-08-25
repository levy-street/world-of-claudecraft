// The Proving Shore coach's pure core: the ordered Gauntlet ladder (talk to
// Warden Tam, forward, turn-and-walk, strafe, the end-of-course camera swing,
// hand in), the arrow targeting (Tam, the current lane's flag, Overseer
// Pell), the three copy arms (keyboard / touch / gamepad) resolving to real
// catalog keys, the on-screen keycap chips appearing only where physical keys
// exist, and the generic rail coach that keeps the card up for every later
// quest on the relay.

import { describe, expect, it } from 'vitest';
import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_OBJECTS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
} from '../src/sim/content/proving_shore';
import {
  BELL_STEP_TARGET,
  BOOTCAMP_STEP_ORDER,
  type BootcampStep,
  bellCardPlan,
  bootcampArrowTarget,
  bootcampBodyPlan,
  bootcampKeycaps,
  bootcampTitleKey,
  CAMERA_LESSON_TRAVEL_RAD,
  COACH_ACTIVE_TARGETS,
  COACH_GAUNTLET_QUEST_ID,
  type CoachState,
  coachCardPlan,
  coachFocus,
  coachKeycaps,
  computeBootcampStep,
  ringCardPlan,
  ringLessonPhase,
} from '../src/ui/bootcamp_view';
import { t } from '../src/ui/i18n';

describe('computeBootcampStep', () => {
  it('walks the ladder in the Gauntlet running order, camera last', () => {
    const base = { cameraTurned: false };
    expect(computeBootcampStep({ questActive: false, checkpointsReached: 0, ...base })).toBe(
      'talk',
    );
    expect(computeBootcampStep({ questActive: true, checkpointsReached: 0, ...base })).toBe(
      'forward',
    );
    expect(computeBootcampStep({ questActive: true, checkpointsReached: 1, ...base })).toBe(
      'turnwalk',
    );
    expect(computeBootcampStep({ questActive: true, checkpointsReached: 2, ...base })).toBe(
      'strafe',
    );
    // All flags tagged: the camera lesson holds the card until the view has
    // genuinely swung, then the hand-in card takes over.
    expect(computeBootcampStep({ questActive: true, checkpointsReached: 3, ...base })).toBe(
      'camera',
    );
    expect(
      computeBootcampStep({ questActive: true, checkpointsReached: 3, cameraTurned: true }),
    ).toBe('done');
    // One deliberate drag completes the camera lesson immediately: the
    // travel ask stays a fraction of a turn, never a full circle.
    expect(CAMERA_LESSON_TRAVEL_RAD).toBeLessThanOrEqual(0.5);
  });
});

// NOTE flag tagging is covered sim-side (tests/tutorial_greeting.test.ts
// drives updateGauntletRuns through a real Sim): this core never tags.

describe('bootcampArrowTarget', () => {
  it('leads to Tam, then the current lane flag, then Overseer Pell', () => {
    expect(bootcampArrowTarget('talk', 0)).toEqual(PROVING_SHORE_NPCS.warden_tam.pos);
    expect(bootcampArrowTarget('forward', 0)).toEqual(BOOTCAMP_COURSE_CHECKPOINTS[0]);
    expect(bootcampArrowTarget('turnwalk', 1)).toEqual(BOOTCAMP_COURSE_CHECKPOINTS[1]);
    expect(bootcampArrowTarget('strafe', 2)).toEqual(BOOTCAMP_COURSE_CHECKPOINTS[2]);
    // The camera lesson has no world target: the lesson is the view itself.
    expect(bootcampArrowTarget('camera', 3)).toBeNull();
    expect(bootcampArrowTarget('done', 3)).toEqual(PROVING_SHORE_NPCS.overseer_pell.pos);
  });
});

describe('copy plans', () => {
  const steps: BootcampStep[] = [...BOOTCAMP_STEP_ORDER, 'done'];

  it('every step resolves a real English string in all three input arms', () => {
    for (const step of steps) {
      for (const mode of ['keyboard', 'touch', 'pad'] as const) {
        const plan = bootcampBodyPlan(step, mode);
        const params: Record<string, string> = {};
        for (const p of plan.params) params[p] = 'X';
        const body = t(plan.bodyKey, params);
        expect(body, `${step}/${mode}`).toBeTruthy();
        expect(body, `${step}/${mode} leaked its key`).not.toBe(plan.bodyKey);
        // No unresolved {placeholder} survives interpolation.
        expect(body, `${step}/${mode} has an unfilled param`).not.toMatch(/\{\w+\}/);
      }
      const title = t(bootcampTitleKey(step));
      expect(title, `${step} title`).toBeTruthy();
    }
  });

  it('both corners teach ONE shape: turn, then walk, on every input', () => {
    // The playtest ruling. Lane 2 turns right and lane 3 turns left, but the
    // instruction is the same sentence and the same press order in both, so a
    // new player never learns the course twice. Keyboard names the two binds;
    // touch and pad name their own affordances, in the same order.
    const lane2 = bootcampBodyPlan('turnwalk', 'keyboard');
    const lane3 = bootcampBodyPlan('strafe', 'keyboard');
    expect(lane2.params).toEqual(['turnKey', 'forwardKey']);
    expect(lane3.params).toEqual(['turnLeftKey', 'forwardKey']);
    const body = t(lane3.bodyKey, { turnLeftKey: 'A', forwardKey: 'W' });
    // Turn FIRST, walk second, and no sidestep anywhere in the lesson.
    expect(body.indexOf('A')).toBeLessThan(body.indexOf('W'));
    expect(body).not.toMatch(/strafe|sidestep/i);
    expect(body).not.toMatch(/mouse/i);
    for (const mode of ['touch', 'pad'] as const) {
      const copy = t(bootcampBodyPlan('strafe', mode).bodyKey);
      expect(copy, mode).toMatch(/turn/i);
      expect(copy, mode).not.toMatch(/strafe|sidestep/i);
      // The turn is named before the walk in every arm.
      expect(copy.search(/turn/i), mode).toBeLessThan(copy.search(/walk|push the stick up/i));
    }
    // Both corners share a title, because they are the same lesson twice.
    expect(t(bootcampTitleKey('strafe'))).toBe(t(bootcampTitleKey('turnwalk')));
  });

  it('touch and pad copy never interpolate bind labels', () => {
    for (const step of steps) {
      for (const mode of ['touch', 'pad'] as const) {
        const plan = bootcampBodyPlan(step, mode);
        expect(plan.params, `${step}/${mode} interpolates bind labels`).toHaveLength(0);
      }
    }
  });

  it('keycap chips show the ordered buttons per lesson, keyboard only', () => {
    const labels = {
      forwardKey: 'W',
      turnKey: 'D',
      turnLeftKey: 'A',
      strafeKey: 'Q',
      interactKey: 'F',
    };
    expect(bootcampKeycaps('talk', 'keyboard', labels)).toEqual(['F']);
    expect(bootcampKeycaps('forward', 'keyboard', labels)).toEqual(['W']);
    // The two corners: right then walk, left then walk.
    expect(bootcampKeycaps('turnwalk', 'keyboard', labels)).toEqual(['D', 'W']);
    expect(bootcampKeycaps('strafe', 'keyboard', labels)).toEqual(['A', 'W']);
    // The camera lesson is mouse/stick work: no keycaps anywhere.
    expect(bootcampKeycaps('camera', 'keyboard', labels)).toEqual([]);
    expect(bootcampKeycaps('done', 'keyboard', labels)).toEqual(['F']);
    expect(bootcampKeycaps('forward', 'touch', labels)).toEqual([]);
    expect(bootcampKeycaps('strafe', 'pad', labels)).toEqual([]);
  });
});

describe('the rail coach', () => {
  it('focuses the first quest still moving, in chain order', () => {
    expect(COACH_GAUNTLET_QUEST_ID).toBe('q_ps_the_gauntlet');
    // Nothing moving: no card.
    expect(coachFocus(() => null)).toBeNull();
    // The head quest wins even when a later state might exist.
    expect(coachFocus((id) => (id === 'q_ps_the_gauntlet' ? 'available' : null))).toEqual({
      questId: 'q_ps_the_gauntlet',
      state: 'available',
    });
    // Mid-rail: the relay's current station is the first non-null state.
    expect(coachFocus((id) => (id === 'q_ps_shell_and_claw' ? 'active' : null))).toEqual({
      questId: 'q_ps_shell_and_claw',
      state: 'active',
    });
  });

  it('every rail quest resolves a full three-state card in all three arms', () => {
    for (const questId of PROVING_SHORE_QUEST_ORDER) {
      for (const state of ['available', 'active', 'ready'] as CoachState[]) {
        for (const mode of ['keyboard', 'touch', 'pad'] as const) {
          const plan = coachCardPlan({ questId, state }, mode);
          const params: Record<string, string> = { npc: 'X' };
          // {ability} rides bodyHasAbility, not params, because the ability
          // drill names the class's attack on touch and pad too.
          if (plan.bodyHasAbility) params.ability = 'X';
          for (const p of plan.params) params[p] = 'X';
          const body = t(plan.bodyKey, params);
          expect(body, `${questId}/${state}/${mode}`).toBeTruthy();
          expect(body, `${questId}/${state}/${mode} unfilled param`).not.toMatch(/\{\w+\}/);
          if (plan.titleKey) {
            const title = t(plan.titleKey, { npc: 'X' });
            expect(title, `${questId}/${state}/${mode} title`).toBeTruthy();
            expect(title).not.toMatch(/\{\w+\}/);
          } else {
            // The active card is titled with the quest's own localized name.
            expect(state).toBe('active');
          }
          // Touch and pad never interpolate bind labels.
          if (mode !== 'keyboard') expect(plan.params).toHaveLength(0);
        }
      }
    }
  });

  it('arrows lead to the giver, the task ground, then the turn-in', () => {
    for (const questId of PROVING_SHORE_QUEST_ORDER) {
      const quest = PROVING_SHORE_QUESTS[questId];
      const giver = PROVING_SHORE_NPCS[quest.giverNpcId];
      const turnIn = PROVING_SHORE_NPCS[quest.turnInNpcId];
      expect(coachCardPlan({ questId, state: 'available' }, 'keyboard').arrow).toEqual(giver.pos);
      expect(coachCardPlan({ questId, state: 'ready' }, 'keyboard').arrow).toEqual(turnIn.pos);
      const active = coachCardPlan({ questId, state: 'active' }, 'keyboard').arrow;
      expect(active).toEqual(
        COACH_ACTIVE_TARGETS[questId] === undefined ? turnIn.pos : COACH_ACTIVE_TARGETS[questId],
      );
    }
    // Every quest after the Gauntlet has an authored task-target ENTRY (the
    // head quest's active card is the lesson ladder, which aims at the
    // flags). The crate line's entry is deliberately null: the crates line
    // the path itself, so its active card shows NO marker at all.
    for (const questId of PROVING_SHORE_QUEST_ORDER.slice(1)) {
      expect(questId in COACH_ACTIVE_TARGETS, `${questId} task target entry`).toBe(true);
    }
    expect(COACH_ACTIVE_TARGETS.q_ps_the_wreck_line).toBeNull();
    expect(
      coachCardPlan({ questId: 'q_ps_the_wreck_line', state: 'active' }, 'touch').arrow,
    ).toBeNull();
    // The scuttler strand's marker sits on the relocated south-west anchor.
    expect(COACH_ACTIVE_TARGETS.q_ps_shell_and_claw).toEqual({ x: -380, z: -42 });
  });

  it('the npc whose name the card splices is the giver in, the turn-in back', () => {
    for (const questId of PROVING_SHORE_QUEST_ORDER) {
      const quest = PROVING_SHORE_QUESTS[questId];
      expect(coachCardPlan({ questId, state: 'available' }, 'touch').npcId).toBe(quest.giverNpcId);
      expect(coachCardPlan({ questId, state: 'ready' }, 'touch').npcId).toBe(quest.turnInNpcId);
    }
  });

  it('coach keycaps mirror the card plan params, minus the map-key aside', () => {
    const labels = {
      interactKey: 'F',
      mapKey: 'M',
      targetKey: 'Tab',
      attackKey: '1',
      abilityKey: '2',
      bagsKey: 'B',
      charKey: 'C',
    };
    const at = (questId: string, state: CoachState, mode: 'keyboard' | 'touch' | 'pad') =>
      coachKeycaps(coachCardPlan({ questId, state }, mode), mode, labels);
    expect(at('q_ps_shell_and_claw', 'available', 'keyboard')).toEqual(['F']);
    expect(at('q_ps_shell_and_claw', 'ready', 'keyboard')).toEqual(['F']);
    // The generic task card's only param is the map key, which stays an
    // aside in the copy, never a chip (Set Sail is the one generic task).
    expect(at('q_ps_set_sail', 'active', 'keyboard')).toEqual([]);
    // One chip, not two: the combat lessons ask for a click and then ONE
    // key, so no targeting bind is ever chipped.
    expect(at('q_ps_strike_true', 'active', 'keyboard')).toEqual(['1']);
    expect(at('q_ps_shell_and_claw', 'active', 'keyboard')).toEqual(['2']);
    expect(at('q_ps_mother_of_pearl', 'active', 'keyboard')).toEqual(['B', 'F']);
    expect(at('q_ps_the_wreck_line', 'active', 'keyboard')).toEqual(['F']);
    expect(at('q_ps_pouch_and_purse', 'active', 'keyboard')).toEqual(['F']);
    expect(at('q_ps_pouch_and_purse', 'ready', 'keyboard')).toEqual(['B', 'F']);
    expect(at('q_ps_shell_and_claw', 'available', 'touch')).toEqual([]);
    expect(at('q_ps_strike_true', 'active', 'pad')).toEqual([]);
  });

  it('the ring lesson phases and cards walk equip then admire', () => {
    // Armed only once the pearl quest is done; the equip card asks for the
    // bags, the admire card for the character sheet, and the lesson lets go
    // once the sheet has been seen (or the ring left both bags and fingers).
    const base = { questDone: true, inBags: true, equipped: false, charSeen: false };
    expect(ringLessonPhase({ ...base, questDone: false })).toBeNull();
    expect(ringLessonPhase(base)).toBe('equip');
    expect(ringLessonPhase({ ...base, inBags: false, equipped: true })).toBe('admire');
    expect(ringLessonPhase({ ...base, inBags: false, equipped: true, charSeen: true })).toBeNull();
    expect(ringLessonPhase({ ...base, inBags: false })).toBeNull();

    const labels = {
      interactKey: 'F',
      mapKey: 'M',
      targetKey: 'Tab',
      attackKey: '1',
      abilityKey: '2',
      bagsKey: 'B',
      charKey: 'C',
    };
    const equip = ringCardPlan('equip', 'keyboard');
    expect(coachKeycaps(equip, 'keyboard', labels)).toEqual(['B']);
    const equipBody = t(equip.bodyKey, { bagsKey: 'B' });
    expect(equipBody).toMatch(/ring/i);
    expect(equipBody).not.toMatch(/\{\w+\}/);
    const admire = ringCardPlan('admire', 'keyboard');
    expect(coachKeycaps(admire, 'keyboard', labels)).toEqual(['C']);
    const admireBody = t(admire.bodyKey, { charKey: 'C' });
    expect(admireBody).toMatch(/character/i);
    expect(admireBody).not.toMatch(/\{\w+\}/);
    // Touch and pad arms interpolate nothing, the ladder's rule.
    for (const phase of ['equip', 'admire'] as const) {
      for (const mode of ['touch', 'pad'] as const) {
        expect(ringCardPlan(phase, mode).params).toHaveLength(0);
      }
    }
  });

  it('quest-mechanic overrides replace the generic bodies with real lessons', () => {
    // Strike True teaches targeting and the swing; the Wreck Line teaches
    // the pickup press; the pouch lesson's hand-in card walks the buckle-on.
    const strike = coachCardPlan({ questId: 'q_ps_strike_true', state: 'active' }, 'keyboard');
    // No {targetKey}: the select half of the lesson asks for a CLICK now,
    // so the card names one key, the attack, and never a targeting bind.
    expect(strike.params).toEqual(['attackKey']);
    const strikeBody = t(strike.bodyKey, { attackKey: '1' });
    expect(strikeBody).toMatch(/target/i);
    expect(strikeBody).toMatch(/left-click/i);
    expect(strikeBody).not.toMatch(/\{\w+\}/);
    const wreck = coachCardPlan({ questId: 'q_ps_the_wreck_line', state: 'active' }, 'keyboard');
    expect(wreck.params).toEqual(['interactKey']);
    expect(t(wreck.bodyKey, { interactKey: 'F' })).toMatch(/crate/i);
    // The scuttler cull's card carries the retreat warning.
    const shell = coachCardPlan({ questId: 'q_ps_shell_and_claw', state: 'active' }, 'keyboard');
    // Names the ABILITY, not slot 1: this lesson follows the drill, and
    // "press 1" is the plain attack (CX).
    expect(shell.params).toEqual(['abilityKey']);
    const shellBody = t(shell.bodyKey, { abilityKey: '2', ability: 'Reaver Strike' });
    expect(shellBody).toMatch(/retreat/i);
    expect(shellBody).toMatch(/left-click/i);
    expect(shellBody).not.toMatch(/\{\w+\}/);
    // The pouch lesson's ACTIVE card walks the stall purchase, naming the
    // GIVER (Quartermaster Finch, who runs the stall), not the turn-in.
    const pouchBuy = coachCardPlan(
      { questId: 'q_ps_pouch_and_purse', state: 'active' },
      'keyboard',
    );
    expect(pouchBuy.params).toEqual(['interactKey']);
    expect(pouchBuy.bodyHasNpc).toBe(true);
    expect(pouchBuy.npcId).toBe('quartermaster_finch');
    const pouchBuyBody = t(pouchBuy.bodyKey, { interactKey: 'F', npc: 'X' });
    expect(pouchBuyBody).toMatch(/pouch/i);
    expect(pouchBuyBody).not.toMatch(/\{\w+\}/);
    const pouch = coachCardPlan({ questId: 'q_ps_pouch_and_purse', state: 'ready' }, 'keyboard');
    expect(pouch.params).toEqual(['bagsKey', 'interactKey']);
    expect(pouch.bodyHasNpc).toBe(true);
    const pouchBody = t(pouch.bodyKey, { bagsKey: 'B', interactKey: 'F', npc: 'X' });
    expect(pouchBody).toMatch(/bag/i);
    expect(pouchBody).not.toMatch(/\{\w+\}/);
    // Quests without an override keep the generic three-state copy.
    const generic = coachCardPlan({ questId: 'q_ps_set_sail', state: 'active' }, 'keyboard');
    expect(generic.bodyKey).toBe('hudChrome.bootcamp.coachTaskBody');
  });

  it('caster classes get the second-button casting lesson for both fights', () => {
    // Mage, warlock, priest, and druid open with a slot-2 spell, so their
    // combat cards teach the SECOND action button and speak of casting; the
    // melee arm keeps the first-button swing copy untouched.
    for (const questId of ['q_ps_strike_true', 'q_ps_shell_and_claw'] as const) {
      for (const mode of ['keyboard', 'touch', 'pad'] as const) {
        const caster = coachCardPlan({ questId, state: 'active' }, mode, true);
        const melee = coachCardPlan({ questId, state: 'active' }, mode, false);
        expect(caster.bodyKey, `${questId}/${mode}`).toMatch(/Caster/);
        expect(melee.bodyKey, `${questId}/${mode}`).not.toMatch(/Caster/);
        const body = t(caster.bodyKey, {
          targetKey: 'Tab',
          attackKey: '2',
          abilityKey: '2',
          ability: 'Cinderbolt',
        });
        expect(body, `${questId}/${mode}`).toMatch(/cast/i);
        // Strike True is still the "which button" lesson, so its touch and
        // pad copy has to say WHICH one. Shell and Claw comes after the
        // drill and names the ability instead, which is more specific still.
        if (mode !== 'keyboard') {
          const wanted = questId === 'q_ps_strike_true' ? /second/i : /Cinderbolt/;
          expect(body, `${questId}/${mode}`).toMatch(wanted);
        }
        expect(body).not.toMatch(/\{\w+\}/);
      }
    }
    // The caster flag changes nothing outside the two fight lessons.
    const wreck = coachCardPlan(
      { questId: 'q_ps_the_wreck_line', state: 'active' },
      'keyboard',
      true,
    );
    expect(wreck.bodyKey).not.toMatch(/Caster/);
  });
});

describe('the closing bell card', () => {
  it('aims at the authored island ferry bell and resolves all three arms', () => {
    const bell = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_ferry_bell');
    const island = bell?.positions.find((p) => p.x < -180);
    expect(BELL_STEP_TARGET).toEqual(island);
    for (const mode of ['keyboard', 'touch', 'pad'] as const) {
      const plan = bellCardPlan(mode);
      expect(plan.arrow).toEqual(island);
      const params: Record<string, string> = {};
      for (const p of plan.params) params[p] = 'X';
      const body = t(plan.bodyKey, params);
      expect(body, `bell/${mode}`).toBeTruthy();
      expect(body).not.toMatch(/\{\w+\}/);
      expect(t(plan.titleKey)).toBeTruthy();
      if (mode !== 'keyboard') expect(plan.params).toHaveLength(0);
    }
  });
});

describe('the ability drill card', () => {
  it('names the class attack on EVERY input arm, not just the keyboard', () => {
    // The keyboard arm chips a keycap; touch and pad have no key to name, so
    // the ability's own name is what identifies the button there. A card
    // that only spliced it on keyboard would leave a phone player reading
    // "tap {ability} on the action bar".
    for (const mode of ['keyboard', 'touch', 'pad'] as const) {
      const plan = coachCardPlan({ questId: 'q_ps_hone_the_edge', state: 'active' }, mode);
      expect(plan.bodyHasAbility, mode).toBe(true);
      const body = t(plan.bodyKey, { ability: 'Cinderbolt', abilityKey: '2' });
      expect(body, mode).toMatch(/Cinderbolt/);
      expect(body, mode).not.toMatch(/\{\w+\}/);
    }
  });

  it('splices an ability name on exactly the two combat lessons that name one', () => {
    // bodyHasAbility is opt-in; every other card would render a stray
    // {ability} if it were ever set by accident.
    const namesAbility = new Set(['q_ps_hone_the_edge', 'q_ps_shell_and_claw']);
    for (const questId of PROVING_SHORE_QUEST_ORDER) {
      if (namesAbility.has(questId)) continue;
      for (const state of ['available', 'active', 'ready'] as CoachState[]) {
        const plan = coachCardPlan({ questId, state }, 'keyboard');
        expect(plan.bodyHasAbility, `${questId}/${state}`).toBe(false);
      }
    }
  });
});
