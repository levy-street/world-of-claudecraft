// Pure craft-cast view core (Craft Cast System Phase 2): duration, button
// state machine, progress fraction, session build. DOM-free.

import { describe, expect, it } from 'vitest';
import {
  CRAFT_CAST_DURATION_FIELD_SEC,
  CRAFT_CAST_DURATION_SKILL_25_SEC,
  CRAFT_CAST_DURATION_SKILL_50_SEC,
  CRAFT_CAST_DURATION_SKILL_75_SEC,
  CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC,
} from '../src/sim/content/professions';
import { CRAFT_CAST_ID, GATHER_CAST_ID } from '../src/sim/types';
import {
  buildCraftCastSession,
  CRAFT_BATCH_UI_MAX,
  clampCraftQty,
  craftBatchIndicatorVisible,
  craftButtonBusy,
  craftButtonEnabled,
  craftButtonState,
  craftCastActivitySig,
  craftCastProgressFraction,
  IDLE_CRAFT_CAST_SESSION,
  maxCraftsFromReagents,
  recipeDurationSec,
} from '../src/ui/craft_cast_view';

function row(partial: {
  recipeId?: string;
  craftable?: boolean;
  reagents?: { satisfied: boolean }[];
  station?: { inRange: boolean } | null;
  comboMet?: boolean | null;
}) {
  return {
    recipeId: partial.recipeId ?? 'recipe_a',
    craftable: partial.craftable ?? true,
    reagents: partial.reagents ?? [{ satisfied: true }],
    station: partial.station === undefined ? null : partial.station,
    ...(partial.comboMet !== undefined ? { comboRequirement: { met: partial.comboMet } } : {}),
  };
}

describe('recipeDurationSec', () => {
  it('pins the content duration bands', () => {
    expect(recipeDurationSec({ skillReq: 0 })).toBe(CRAFT_CAST_DURATION_FIELD_SEC);
    expect(recipeDurationSec({ skillReq: 25 })).toBe(CRAFT_CAST_DURATION_SKILL_25_SEC);
    expect(recipeDurationSec({ skillReq: 50 })).toBe(CRAFT_CAST_DURATION_SKILL_50_SEC);
    expect(recipeDurationSec({ skillReq: 75 })).toBe(CRAFT_CAST_DURATION_SKILL_75_SEC);
    expect(recipeDurationSec({ skillReq: 100 })).toBe(CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC);
    expect(
      recipeDurationSec({
        skillReq: 0,
        comboRequirement: { craftA: 'a', craftB: 'b', minTier: 1 },
      }),
    ).toBe(CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC);
  });
});

describe('craftCastProgressFraction', () => {
  it('grows from 0 to 1 as remaining drains (hardcast)', () => {
    expect(craftCastProgressFraction(4, 4)).toBe(0);
    expect(craftCastProgressFraction(2, 4)).toBe(0.5);
    expect(craftCastProgressFraction(0, 4)).toBe(1);
  });

  it('returns 0 when total is not positive', () => {
    expect(craftCastProgressFraction(1, 0)).toBe(0);
    expect(craftCastProgressFraction(1, -1)).toBe(0);
  });

  it('clamps remaining outside [0, total]', () => {
    expect(craftCastProgressFraction(-1, 4)).toBe(1);
    expect(craftCastProgressFraction(8, 4)).toBe(0);
  });
});

describe('buildCraftCastSession', () => {
  it('is idle when not on the craft cast sentinel', () => {
    expect(
      buildCraftCastSession({
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        craftCastRecipeId: '',
      }),
    ).toEqual(IDLE_CRAFT_CAST_SESSION);
    expect(
      buildCraftCastSession({
        castingAbility: GATHER_CAST_ID,
        castRemaining: 1,
        castTotal: 2,
        craftCastRecipeId: 'recipe_a',
      }).active,
    ).toBe(false);
  });

  it('is active for CRAFT_CAST_ID with positive total and carries the entity recipe id', () => {
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_entity',
      craftCastBatchRemaining: 2,
      craftCastBatchTotal: 5,
    });
    expect(session.active).toBe(true);
    expect(session.recipeId).toBe('recipe_entity');
    expect(session.progress).toBe(0.5);
    expect(session.remainingSec).toBe(1);
    expect(session.totalSec).toBe(2);
    expect(session.batchRemaining).toBe(2);
    expect(session.batchTotal).toBe(5);
    expect(craftBatchIndicatorVisible(session)).toBe(true);
  });

  it('stays active with an empty recipe id (mirror gap frame): rows read busy, never a stale name', () => {
    // Entity fields are authoritative on both hosts (the self-only ccast wire
    // fragment online); an empty id on an active cast is at most a one-frame
    // decode gap and must not invent a recipe.
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 2,
      castTotal: 2,
      craftCastRecipeId: '',
    });
    expect(session.active).toBe(true);
    expect(session.recipeId).toBe('');
    expect(session.progress).toBe(0);
  });
});

describe('batch qty clamp', () => {
  it('maxCraftsFromReagents is limited by the scarcest reagent and the batch max', () => {
    expect(maxCraftsFromReagents([{ have: 10, required: 2 }])).toBe(5);
    expect(
      maxCraftsFromReagents([
        { have: 10, required: 2 },
        { have: 3, required: 1 },
      ]),
    ).toBe(3);
    expect(maxCraftsFromReagents([{ have: 0, required: 1 }])).toBe(0);
    expect(maxCraftsFromReagents([{ have: 10_000, required: 1 }])).toBe(CRAFT_BATCH_UI_MAX);
  });

  it('clampCraftQty floors and clamps to 1..min(max, mats-fit)', () => {
    expect(clampCraftQty(1, 10)).toBe(1);
    expect(clampCraftQty(0, 10)).toBe(1);
    expect(clampCraftQty(99, 10)).toBe(10);
    expect(clampCraftQty(99, 100)).toBe(CRAFT_BATCH_UI_MAX);
    expect(clampCraftQty(3.7, 10)).toBe(3);
  });
});

describe('craftButtonState', () => {
  const idle = IDLE_CRAFT_CAST_SESSION;

  it('is ready when craftable and idle', () => {
    expect(craftButtonState(row({ craftable: true }), idle)).toBe('ready');
    expect(craftButtonEnabled('ready')).toBe(true);
    expect(craftButtonBusy('ready')).toBe(false);
  });

  it('is casting for the active recipe and busy for every other row', () => {
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
    });
    expect(craftButtonState(row({ recipeId: 'recipe_a' }), session)).toBe('casting');
    expect(craftButtonState(row({ recipeId: 'recipe_b' }), session)).toBe('busy');
    expect(craftButtonEnabled('casting')).toBe(false);
    expect(craftButtonBusy('casting')).toBe(true);
    expect(craftButtonEnabled('busy')).toBe(false);
  });

  it('is station when the station gate is out of range', () => {
    expect(craftButtonState(row({ craftable: false, station: { inRange: false } }), idle)).toBe(
      'station',
    );
  });

  it('is missing_mats when any reagent is short (and not station/combo)', () => {
    expect(
      craftButtonState(
        row({
          craftable: false,
          reagents: [{ satisfied: true }, { satisfied: false }],
        }),
        idle,
      ),
    ).toBe('missing_mats');
  });

  it('is unknown when combo is unmet or no other reason fits', () => {
    expect(craftButtonState(row({ craftable: false, comboMet: false }), idle)).toBe('unknown');
    expect(craftButtonState(row({ craftable: false, reagents: [] }), idle)).toBe('unknown');
  });

  it('prefers casting over material shortfalls while the cast is active', () => {
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
    });
    expect(
      craftButtonState(
        row({
          recipeId: 'recipe_a',
          craftable: false,
          reagents: [{ satisfied: false }],
          station: { inRange: false },
        }),
        session,
      ),
    ).toBe('casting');
  });
});

describe('craftCastActivitySig', () => {
  it('is stable for fill ticks and moves only on activity edges', () => {
    const mid = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
    });
    const later = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 0.5,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
    });
    expect(craftCastActivitySig(mid)).toBe('1:recipe_a:0:0');
    expect(craftCastActivitySig(later)).toBe(craftCastActivitySig(mid));
    expect(craftCastActivitySig(IDLE_CRAFT_CAST_SESSION)).toBe('0');
  });

  it('moves on batch item boundaries so the cold batch label repaints', () => {
    const two = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
      craftCastBatchRemaining: 2,
      craftCastBatchTotal: 3,
    });
    const one = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 2,
      castTotal: 2,
      craftCastRecipeId: 'recipe_a',
      craftCastBatchRemaining: 1,
      craftCastBatchTotal: 3,
    });
    expect(craftCastActivitySig(two)).toBe('1:recipe_a:2:3');
    expect(craftCastActivitySig(one)).toBe('1:recipe_a:1:3');
    expect(craftCastActivitySig(two)).not.toBe(craftCastActivitySig(one));
  });
});
