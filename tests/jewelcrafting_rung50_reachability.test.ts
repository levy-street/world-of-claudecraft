// Jewelcrafting reachability, derived from the live gain schedule and catalog.
//
// The guide tells players two things about a craft's climb (guide.professions:
// craftMasteryBody and ringBody): every craft caps at 125, and reaching a cap
// takes at least 125 successful crafts because a full-gain craft moves skill by
// exactly one point. Nothing pinned either claim. tests/jewelcrafting_flow.test.ts
// drives ONE 49-to-50 crossing through a real Sim, which proves the gain path
// runs but says nothing about whether the band is reachable from the bottom, and
// tests/jewelcrafting_catalog.test.ts owns the catalog's shape and never touches
// the schedule.
//
// This file walks the climb instead, over the LIVE tables: the real
// craftSkillGainMultiplier for the per-craft amount and the real gainCraftSkill
// for the accrual and the cap clamp, so an authored gap between rungs (or a
// retuned band curve, or a moved cap) reds here rather than shipping as a stall
// no test can see. It is deliberately magnitude-light: WHETHER the walk arrives
// depends only on some row paying a positive multiplier at every skill value,
// which is true for any positive base gain, so the reachability arms hold
// without knowing the module-private CRAFT_SKILL_GAIN. The craft COUNT arms name
// that mirror explicitly and pin it against the live curve's own ceiling.
import { describe, expect, it } from 'vitest';
import { craftMaxSkillFor } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import { teachTierMet } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import {
  type CraftSkills,
  gainCraftSkill,
  skillInCraft,
  tierForSkill,
} from '../src/sim/professions/wheel';

const CRAFT = 'jewelcrafting';
const RUNG_50 = 50;
// The base amount one successful craft pays before the four-state curve scales
// it, mirrored from the module-private CRAFT_SKILL_GAIN in
// src/sim/professions/crafting.ts (the same mirror-and-name convention
// tests/professions_crafts_to_mastery.test.ts uses). It is load-bearing for the
// craft COUNTS below and for nothing else: every reachability arm holds for any
// positive base. The live 49-to-50 crossing that proves the value is
// tests/jewelcrafting_flow.test.ts's, and is not restated here.
const BASE_GAIN_PER_CRAFT = 1;
// A walk that has not arrived by here is stalled, not slow: the cap is 125 and
// the smallest live nonzero multiplier is a quarter, so 4 * 125 crafts is the
// arithmetic ceiling of any arriving climb and anything past it is a loop.
const WALK_CEILING = 4 * 125 + 1;

const JEWELCRAFTING: readonly ProfessionRecipeRecord[] = ALL_RECIPES.filter(
  (r) => r.professionId === CRAFT,
);

/** The best multiplier any live jewelcrafting row pays at `skill`, 0 if none. */
function bestGainAt(skills: CraftSkills, activeArchetype: string | null): number {
  let best = 0;
  for (const recipe of JEWELCRAFTING) {
    const gain = craftSkillGainMultiplier(
      skills,
      activeArchetype,
      null,
      CRAFT,
      null,
      recipe.skillReq,
    );
    if (gain > best) best = gain;
  }
  return best;
}

interface Walk {
  readonly reached: boolean;
  readonly crafts: number;
  readonly stalledAt: number;
}

/** Climb from 0 toward `target`, always taking the best-paying live row. */
function climb(target: number, activeArchetype: string | null): Walk {
  const skills: CraftSkills = { [CRAFT]: 0 };
  let crafts = 0;
  while (skillInCraft(skills, CRAFT) < target) {
    const gain = bestGainAt(skills, activeArchetype);
    if (gain <= 0) return { reached: false, crafts, stalledAt: skillInCraft(skills, CRAFT) };
    gainCraftSkill(skills, CRAFT, BASE_GAIN_PER_CRAFT * gain);
    crafts += 1;
    if (crafts > WALK_CEILING) {
      throw new Error(`jewelcrafting climb to ${target} never arrived in ${WALK_CEILING} crafts`);
    }
  }
  return { reached: true, crafts, stalledAt: skillInCraft(skills, CRAFT) };
}

describe('jewelcrafting rung-50 reachability under 125-cap pacing', () => {
  it('the premise: the live catalog spans the rungs the climb needs', () => {
    // Non-vacuity for every arm below, and the reason this file reads
    // ALL_RECIPES rather than JEWELCRAFTING_RECIPES: the exported base catalog
    // stops at rung 50, and the rows that carry the climb past it live in the
    // intermediate and apex arrays.
    const rungs = [...new Set(JEWELCRAFTING.map((r) => r.skillReq))].sort((a, b) => a - b);
    expect(rungs, 'the live jewelcrafting rung ladder').toEqual([0, 25, 50, 75, 100]);
    expect(JEWELCRAFTING.length, 'live jewelcrafting recipes').toBeGreaterThanOrEqual(13);
    expect(craftMaxSkillFor(CRAFT), 'the enforced cap').toBe(125);
  });

  it('no skill value on the climb is a dead band, for an undeclared or attuned crafter', () => {
    // The reachability claim itself, checked at EVERY integer the climb passes
    // through rather than at the rung boundaries, so a gap authored between two
    // rungs cannot hide between sample points.
    //
    // Swept to the CAP rather than to rung 50, and that width is what makes the
    // arm bite: below 50 a capability tier is never three tiers above the rung-0
    // rows, so nothing there could go gray whatever the catalog held, and an arm
    // stopping at 50 would be true by arithmetic instead of by content. Past 75
    // it is the rare rung that carries the undeclared climb, so dropping that
    // rung strands one, and this is the arm that says so.
    for (const archetype of [null, CRAFT]) {
      const dead: number[] = [];
      for (let skill = 0; skill < 125; skill++) {
        if (bestGainAt({ [CRAFT]: skill }, archetype) <= 0) dead.push(skill);
      }
      expect(
        dead,
        `${archetype ?? 'undeclared'}: skill values where no jewelcrafting row gains: ${dead.join(', ')}`,
      ).toEqual([]);
    }
    // And the rung under this file's headline does not cliff: 50 is where the
    // rare band opens, so a climber arriving there still has somewhere to go.
    expect(bestGainAt({ [CRAFT]: RUNG_50 }, null), 'gain at the rung itself').toBeGreaterThan(0);
  });

  it('a climber really arrives at rung 50, through the live gain and clamp path', () => {
    // Walked with the shipped gainCraftSkill, not with arithmetic over the
    // multiplier: the accrual and its cap clamp are the code that has to hold.
    const walk = climb(RUNG_50, null);
    expect(walk.reached, `stalled at skill ${walk.stalledAt}`).toBe(true);
    // Every rung to 50 pays FULL gain to a climber standing on it, so the walk
    // costs exactly one craft per point. This is the guide's "one point per
    // full-gain craft" for this stretch, stated as a count rather than prose.
    expect(walk.crafts, 'crafts from 0 to rung 50').toBe(RUNG_50 / BASE_GAIN_PER_CRAFT);
  });

  it('the trainer teaches a positive-gain row at every rung the climb stands on', () => {
    // Reachable in the PLAYER'S sense, not just the schedule's: a band whose
    // only positive-gain rows were undiscoverable would satisfy the arm above
    // and still strand a climber. Scoped below 100 deliberately: the three apex
    // rows are `acquisition: ['drop']` by design, so a trainer arm over them
    // would be asserting the opposite of what the catalog says.
    for (let skill = 0; skill < 100; skill++) {
      const skills: CraftSkills = { [CRAFT]: skill };
      const learnable = JEWELCRAFTING.filter(
        (r) => (r.acquisition ?? []).includes('trainer') && teachTierMet(r, skills),
      );
      const best = Math.max(
        0,
        ...learnable.map((r) =>
          craftSkillGainMultiplier(skills, CRAFT, null, CRAFT, null, r.skillReq),
        ),
      );
      expect(best, `a trainer-taught row still gains at skill ${skill}`).toBeGreaterThan(0);
    }
    // Non-vacuity: the filter really admits rows, and really excludes the apex
    // band, so the loop above is not passing over an empty set at every step.
    const trainerRungs = [
      ...new Set(
        JEWELCRAFTING.filter((r) => (r.acquisition ?? []).includes('trainer')).map(
          (r) => r.skillReq,
        ),
      ),
    ].sort((a, b) => a - b);
    expect(trainerRungs, 'trainer-taught rungs').toEqual([0, 25, 50, 75]);
  });

  it('the cap costs exactly 125 crafts to a major, and far more to the undeclared', () => {
    // The guide's "at least 125 successful crafts", as a pair of counts. A major
    // stands on a full-gain row at every band, so its climb is one craft per
    // point and the promise is exact. The UNDECLARED crafter still arrives (the
    // rare ceiling admits the rung-50 rows, which keep paying reduced then
    // minimal gain past 75), just slower, which is the honest reading of the
    // guide's "somewhat more in practice as recipes fade between rungs".
    const attuned = climb(125, CRAFT);
    expect(attuned.reached, `attuned climb stalled at ${attuned.stalledAt}`).toBe(true);
    expect(attuned.crafts, 'crafts from 0 to the cap, attuned').toBe(125 / BASE_GAIN_PER_CRAFT);

    const undeclared = climb(125, null);
    expect(undeclared.reached, `undeclared climb stalled at ${undeclared.stalledAt}`).toBe(true);
    // 75 full-gain crafts to the rare ceiling, then 50 at a half and 100 at a
    // quarter as the rung-50 rows fade: the ladder's own arithmetic, pinned so a
    // retuned band curve moves this number deliberately.
    expect(undeclared.crafts, 'crafts from 0 to the cap, undeclared').toBe(225);
    expect(undeclared.crafts, 'the undeclared climb is strictly the slower one').toBeGreaterThan(
      attuned.crafts,
    );
  });

  it('a DORMANT craft stalls at 75, the ceiling the guide names', () => {
    // The prose this backs: a craft that falls dormant behind another archetype
    // "climbs only on their common recipes, and past skill 75 not at all". That
    // is the COMMON ceiling (tier 0), which only an attuned-elsewhere crafter
    // carries; an undeclared one holds the rare ceiling and is the arm above.
    // Stated as its own case so the two are never confused again.
    const dormant = climb(125, 'alchemy');
    expect(dormant.reached, 'a dormant craft must NOT reach the cap').toBe(false);
    expect(dormant.stalledAt, 'the dormant ceiling').toBe(75);
    expect(tierForSkill(dormant.stalledAt), 'the tier it stalls in').toBe(3);
    // And it really did climb to get there, rather than stalling at zero: the
    // rung-0 rows alone carry it through three bands, 25 crafts at full gain,
    // then 50 at a half and 100 at a quarter as they fade under it.
    expect(dormant.crafts, 'crafts before the dormant stall').toBe(175);
    // Rung 50 is still reachable while dormant, which is what makes THIS file's
    // headline claim independent of the archetype question.
    expect(climb(RUNG_50, 'alchemy').reached, 'rung 50 while dormant').toBe(true);
  });

  it('no live row ever pays MORE than a full-gain craft, at any skill on the climb', () => {
    // What makes the count above a floor rather than a coincidence: if a row
    // could pay above the full multiplier the climb would be shorter than the
    // guide promises, and the two would silently disagree.
    for (let skill = 0; skill <= 125; skill++) {
      expect(
        bestGainAt({ [CRAFT]: skill }, CRAFT),
        `best multiplier at skill ${skill}`,
      ).toBeLessThanOrEqual(1);
    }
    // At the cap itself the curve pays nothing at all: the climb stops there
    // rather than running on, which is what makes 125 a cap and not a rung.
    expect(bestGainAt({ [CRAFT]: 125 }, CRAFT), 'gain at the cap').toBe(0);
  });
});
