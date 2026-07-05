// Direct unit tests for src/sim/progression/talents.ts (G1a). The talent application
// layer is exercised against a REAL Sim.ctx (so resolve / playerMods /
// refreshKnownAbilities / recalcPlayerStats are the real wired callbacks), proving the
// moved module drives the same flow the Sim facade used to. Covers: applying a spec
// build bakes the flat talentMods + flips the known-ability list, respec wipes ranks
// (spec kept) and reverts stats, save + switchLoadout round-trips a build, setSpec drops
// the prior spec tree's points, the talent-point budget, spend/delete, and the Fiesta
// coupling (a recompute mid-overlay reads playerMods, not raw talentMods).

import { describe, expect, it } from 'vitest';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
  talentPointsAtLevel,
} from '../../src/sim/content/talents';
import {
  applyTalentAllocation,
  deleteTalentLoadout,
  respecTalents,
  saveTalentLoadout,
  setTalentSpec,
  spendTalentPoint,
  switchTalentLoadout,
  talentPointBudget,
} from '../../src/sim/progression/talents';
import { Sim } from '../../src/sim/sim';
import type { SimContext } from '../../src/sim/sim_context';
import { MAX_LEVEL } from '../../src/sim/types';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

// A max-level warrior (autoEquip so stats.armor is nonzero and % talents are visible),
// plus its real SimContext + the player's live meta/entity.
function setup(seed = 5) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as Sim &
    Record<string, any>;
  sim.setPlayerLevel(MAX_LEVEL);
  const ctx = sim.ctx as SimContext;
  // Live meta/entity, poked directly (cast to any like the parity scenarios' AnyEntity).
  const meta = sim.players.get(sim.playerId) as any;
  const e = sim.entities.get(sim.playerId) as any;
  return { sim, ctx, meta, e };
}

const knownIds = (meta: any): string[] => meta.known.map((k: any) => k.def.id).sort();

describe('progression/talents: apply + respec', () => {
  it('applies a spec build (bakes flat talentMods + flips known list), respec wipes ranks but keeps spec and reverts stats', () => {
    const { ctx, meta, e } = setup();
    const armorBase = e.stats.armor;
    const knownBase = knownIds(meta);

    expect(
      applyTalentAllocation(
        ctx,
        alloc({ spec: 'arms', ranks: { war_toughness: 2, arms_imp_overpower: 2 } }),
      ),
    ).toBe(true);
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talentMods.spec).toBe('arms'); // the flat struct re-baked once
    expect(meta.talents.ranks.war_toughness).toBe(2);
    expect(e.stats.armor).toBeGreaterThan(armorBase); // war_toughness raised armor
    expect(knownIds(meta)).not.toEqual(knownBase); // arms spec changed the known list

    expect(respecTalents(ctx)).toBe(true);
    expect(meta.talents.ranks).toEqual({}); // ranks wiped
    expect(meta.talents.spec).toBe('arms'); // spec retained
    expect(e.stats.armor).toBe(armorBase); // stats reverted
  });
});

describe('progression/talents: loadouts', () => {
  it('saveLoadout (object-alloc overload) then switchLoadout restores the build + known list', () => {
    const { ctx, meta } = setup();
    // Save build A into slot 0 via the positional-alloc overload (the HUD path).
    expect(
      saveTalentLoadout(
        ctx,
        'Arms',
        ['mortal_strike', 'overpower'],
        alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }),
      ),
    ).toBe(0);
    expect(meta.activeLoadout).toBe(0);
    const knownArms = knownIds(meta);

    // Apply a different build: the known list changes.
    expect(applyTalentAllocation(ctx, alloc({ spec: 'fury', ranks: { fury_cruelty: 2 } }))).toBe(
      true,
    );
    expect(meta.talentMods.spec).toBe('fury');
    expect(knownIds(meta)).not.toEqual(knownArms);

    // Switch back to slot 0: the build + known list flip back.
    expect(switchTalentLoadout(ctx, 0)).toBe(true);
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talents.ranks.arms_imp_overpower).toBe(2);
    expect(knownIds(meta)).toEqual(knownArms);
  });

  it('deleteLoadout removes a saved build', () => {
    const { ctx, meta } = setup();
    expect(saveTalentLoadout(ctx, 'A', [])).toBe(0);
    expect(meta.loadouts.length).toBe(1);
    expect(deleteTalentLoadout(ctx, 0)).toBe(true);
    expect(meta.loadouts.length).toBe(0);
  });
});

describe('progression/talents: spec + point budget', () => {
  it('setSpec drops the prior spec tree points, keeps class points, and flips the known list', () => {
    const { ctx, meta } = setup();
    expect(
      applyTalentAllocation(
        ctx,
        alloc({ spec: 'arms', ranks: { war_toughness: 2, arms_imp_overpower: 2 } }),
      ),
    ).toBe(true);
    const knownArms = knownIds(meta);

    expect(setTalentSpec(ctx, 'fury')).toBe(true);
    expect(meta.talents.spec).toBe('fury');
    expect(meta.talents.ranks.arms_imp_overpower).toBeUndefined(); // spec-tree point dropped
    expect(meta.talents.ranks.war_toughness).toBe(2); // class-tree point retained
    expect(knownIds(meta)).not.toEqual(knownArms);
  });

  it('talentPointBudget reports total from level + spent from the allocation; spendTalent increments', () => {
    const { ctx, meta } = setup();
    expect(talentPointBudget(ctx)).toEqual({ total: talentPointsAtLevel(MAX_LEVEL), spent: 0 });
    expect(spendTalentPoint(ctx, 'war_toughness')).toBe(true);
    expect(spendTalentPoint(ctx, 'war_toughness')).toBe(true);
    expect(meta.talents.ranks.war_toughness).toBe(2);
    expect(talentPointBudget(ctx).spent).toBe(2);
  });
});

describe('progression/talents: Fiesta coupling (playerMods, not raw talentMods)', () => {
  it('a recompute during an active augment overlay keeps the overlay mods', () => {
    const { ctx, meta, e } = setup();
    // Baseline: no talents.
    respecTalents(ctx);
    const armorNoTalents = e.stats.armor;

    // An active Fiesta overlay: a tanky modifier struct distinct from the base talents.
    meta.fiestaMods = computeTalentModifiers(
      meta.cls,
      alloc({ spec: 'prot', ranks: { prot_toughness: 3 } }),
    );
    // Force a recompute (respec) WHILE the overlay is active. recomputeTalents feeds
    // recalcPlayerStats with playerMods(meta) = fiestaMods ?? talentMods, so the augment
    // overlay survives even though the base talents are now empty.
    respecTalents(ctx);
    expect(e.stats.armor).toBeGreaterThan(armorNoTalents); // overlay armor, NOT empty talentMods

    // Clearing the overlay + recompute reverts to the no-talent armor.
    meta.fiestaMods = null;
    respecTalents(ctx);
    expect(e.stats.armor).toBe(armorNoTalents);
  });
});
