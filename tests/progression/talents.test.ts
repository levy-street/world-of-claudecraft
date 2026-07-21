// Direct unit tests for src/sim/progression/talents.ts (G1a). The talent application
// layer is exercised against a REAL Sim.ctx (so resolve / playerMods /
// refreshKnownAbilities / recalcPlayerStats are the real wired callbacks), proving the
// moved module drives the same flow the Sim facade used to. Covers: applying a
// canonical spec+rows build bakes flat talentMods + flips the known-ability list,
// respec wipes rows (spec kept), save + switchLoadout round-trips a build, setSpec
// preserves class-wide rows, the row budget and selection API, loadout deletion, and
// the Fiesta coupling (a recompute mid-overlay reads playerMods, not raw talentMods).

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
  selectTalentRow,
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
  it('applies a spec+rows build, then respec clears rows while retaining the spec', () => {
    const { ctx, meta } = setup();
    const knownBase = knownIds(meta);

    expect(
      applyTalentAllocation(
        ctx,
        alloc({
          spec: 'arms',
          rows: {
            8: 'war_row_die_by_the_sword',
            14: 'war_row_anger_management',
          },
        }),
      ),
    ).toBe(true);
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talentMods.spec).toBe('arms'); // the flat struct re-baked once
    expect(meta.talents.rows).toEqual({
      8: 'war_row_die_by_the_sword',
      14: 'war_row_anger_management',
    });
    // v0.27.1 rage fix: Anger Management trimmed to +10% auto rage.
    expect(meta.talentMods.global.autoRagePct).toBe(0.1);
    expect(knownIds(meta)).toContain('die_by_sword');
    expect(knownIds(meta)).not.toEqual(knownBase); // arms spec changed the known list

    expect(respecTalents(ctx)).toBe(true);
    expect(meta.talents.rows).toEqual({}); // row choices wiped
    expect(meta.talents.spec).toBe('arms'); // spec retained
    expect(meta.talentMods.global.autoRagePct).toBe(0);
    expect(knownIds(meta)).not.toContain('die_by_sword');
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
        alloc({ spec: 'arms', rows: { 8: 'war_row_die_by_the_sword' } }),
      ),
    ).toBe(0);
    expect(meta.activeLoadout).toBe(0);
    const knownArms = knownIds(meta);

    // Apply a different build: the known list changes.
    expect(
      applyTalentAllocation(ctx, alloc({ spec: 'fury', rows: { 8: 'war_row_victory_rush' } })),
    ).toBe(true);
    expect(meta.talentMods.spec).toBe('fury');
    expect(knownIds(meta)).not.toEqual(knownArms);

    // Switch back to slot 0: the build + known list flip back.
    expect(switchTalentLoadout(ctx, 0)).toBe(true);
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talents.rows).toEqual({ 8: 'war_row_die_by_the_sword' });
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

describe('progression/talents: spec + row budget', () => {
  it('setSpec preserves class-wide rows and flips the spec known-ability list', () => {
    const { ctx, meta } = setup();
    expect(
      applyTalentAllocation(
        ctx,
        alloc({
          spec: 'arms',
          rows: {
            5: 'war_row_double_charge',
            8: 'war_row_die_by_the_sword',
          },
        }),
      ),
    ).toBe(true);
    const knownArms = knownIds(meta);

    expect(setTalentSpec(ctx, 'fury')).toBe(true);
    expect(meta.talents.spec).toBe('fury');
    expect(meta.talents.rows).toEqual({
      5: 'war_row_double_charge',
      8: 'war_row_die_by_the_sword',
    });
    expect(knownIds(meta)).not.toEqual(knownArms);
  });

  it('reports unlocked/selected rows, rejects the retired point API, and replaces one row', () => {
    const { ctx, meta } = setup();
    expect(talentPointBudget(ctx)).toEqual({ total: talentPointsAtLevel(MAX_LEVEL), spent: 0 });
    expect(talentPointBudget(ctx).total).toBe(6);

    expect(spendTalentPoint(ctx, 'war_toughness')).toBe(false);
    expect(meta.talents).toEqual({ spec: null, rows: {} });

    expect(selectTalentRow(ctx, 5, 'war_row_double_charge')).toBe(true);
    expect(talentPointBudget(ctx).spent).toBe(1);
    expect(selectTalentRow(ctx, 5, 'war_row_pursuit')).toBe(true);
    expect(meta.talents.rows).toEqual({ 5: 'war_row_pursuit' });
    expect(talentPointBudget(ctx).spent).toBe(1);
  });
});

describe('progression/talents: Fiesta coupling (playerMods, not raw talentMods)', () => {
  it('a recompute during an active augment overlay keeps the overlay mods', () => {
    const { ctx, meta, e } = setup();
    // Baseline: no specialization or selected rows.
    const armorNoTalents = e.stats.armor;

    // An active Fiesta overlay: Protection's armor mastery is distinct from the
    // player's base allocation. A live row mutation forces recomputeTalents, which
    // must recalc through playerMods(meta) = fiestaMods ?? talentMods.
    meta.fiestaMods = computeTalentModifiers(meta.cls, alloc({ spec: 'prot' }));
    expect(applyTalentAllocation(ctx, alloc({ rows: { 5: 'war_row_double_charge' } }))).toBe(true);
    expect(e.stats.armor).toBeGreaterThan(armorNoTalents);

    // Clearing the selected row is another real recompute; the overlay must survive.
    respecTalents(ctx);
    expect(e.stats.armor).toBeGreaterThan(armorNoTalents);

    // Clearing the overlay and applying a different base row recomputes back to the
    // no-talent armor (the selected row itself has no stat modifier).
    meta.fiestaMods = null;
    expect(applyTalentAllocation(ctx, alloc({ rows: { 5: 'war_row_pursuit' } }))).toBe(true);
    expect(e.stats.armor).toBe(armorNoTalents);
  });
});
