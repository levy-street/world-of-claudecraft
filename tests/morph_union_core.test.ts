// The union plan is the one hard decision in merging morph-carrying parts: get
// it wrong and the merged body moves the wrong blendshape, with no error.
import { describe, expect, it } from 'vitest';
import { morphTargetDictionaryOf, morphUnionPlan } from '../src/render/characters/morph_union_core';

describe('morphUnionPlan', () => {
  it('unions target names in first-seen order', () => {
    const plan = morphUnionPlan([
      ['jaw_up', 'jaw_dn'],
      ['jaw_dn', 'nose_up'],
    ]);

    expect(plan.names).toEqual(['jaw_up', 'jaw_dn', 'nose_up']);
  });

  it('maps every output slot to the part index that carries it', () => {
    // The composed parts each ship the subset of the head's shape keys that
    // reaches them, so slot 3 of one part and slot 3 of another are unrelated:
    // the plan is what makes a merged buffer drive them by NAME again.
    const plan = morphUnionPlan([
      ['body_elbows_up', 'body_shoulders_up'],
      ['body_chest_up', 'body_shoulders_up'],
    ]);

    expect(plan.names).toEqual(['body_elbows_up', 'body_shoulders_up', 'body_chest_up']);
    expect(plan.sourceIndex[0]).toEqual([0, 1, -1]);
    expect(plan.sourceIndex[1]).toEqual([-1, 1, 0]);
  });

  it('gives a target-free part an all -1 row', () => {
    // How a morph-free hair style joins the brows it shares a material with.
    const plan = morphUnionPlan([['brow_up', 'brow_dn'], []]);

    expect(plan.sourceIndex[1]).toEqual([-1, -1]);
  });

  it('is empty when no part carries a target', () => {
    const plan = morphUnionPlan([[], []]);

    expect(plan.names).toEqual([]);
    expect(plan.sourceIndex).toEqual([[], []]);
  });

  it('does not depend on how many parts repeat a name', () => {
    const plan = morphUnionPlan([['jaw_up'], ['jaw_up'], ['jaw_up']]);

    expect(plan.names).toEqual(['jaw_up']);
    expect(plan.sourceIndex).toEqual([[0], [0], [0]]);
  });
});

describe('morphTargetDictionaryOf', () => {
  it('indexes the union list the way three drives targets', () => {
    expect(morphTargetDictionaryOf(['a', 'b', 'c'])).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('is empty for an empty list', () => {
    expect(morphTargetDictionaryOf([])).toEqual({});
  });
});
