// The Target dots frame's pure selection core: which (enemy, aura) pairs become
// rows, in what order, and what each row carries.
//
// Every load-bearing claim gets a case that would fail if the rule were dropped:
// only the LOCAL player's debuffs, class-agnostic selection, the current target
// leading, a stable order that never re-sorts by remaining time, the cap and its
// overflow count, duplicate keying, and the off switch.

import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS, SETTING_RANGES, Settings } from '../src/game/settings';
import type { AuraKind } from '../src/sim/types';
import {
  createTargetDotsView,
  TARGET_DOTS_DECIMAL_BELOW_SEC,
  TARGET_DOTS_ROW_CAP,
  type TargetDotsAuraInput,
  type TargetDotsEntityInput,
} from '../src/ui/hud/target_dots';

const MINE = 4;
const THEIRS = 11;

function aura(over: Partial<TargetDotsAuraInput> & { id: string }): TargetDotsAuraInput {
  return {
    name: over.id,
    kind: 'dot' as AuraKind,
    value: 6,
    remaining: 12,
    duration: 18,
    school: 'shadow',
    sourceId: MINE,
    ...over,
  };
}

function mob(id: number, name: string, auras: TargetDotsAuraInput[]): TargetDotsEntityInput {
  return { id, kind: 'mob', name, dead: false, auras };
}

function makeView() {
  return createTargetDotsView({
    isOwn: (a) => a.sourceId === MINE,
    auraName: (a) => `name:${a.id}`,
    targetName: (e) => `target:${e.name}`,
    iconKey: (a) => `icon:${a.id}`,
  });
}

describe('createTargetDotsView', () => {
  it('lists one row per (enemy, aura) pair the player owns', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy A', [aura({ id: 'corruption' }), aura({ id: 'agony' })]),
        mob(2, 'Dummy B', [aura({ id: 'corruption' })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.count).toBe(3);
    expect(state.rows.slice(0, 3).map((r) => r.key)).toEqual([
      '1:agony',
      '1:corruption',
      '2:corruption',
    ]);
  });

  it('excludes another caster s debuffs, including the same id on the same enemy', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [
          aura({ id: 'corruption', remaining: 5 }),
          aura({ id: 'corruption', sourceId: THEIRS, remaining: 17 }),
          aura({ id: 'agony', sourceId: THEIRS }),
        ]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.count).toBe(1);
    expect(state.rows[0].remaining).toBe(5);
  });

  it('excludes the player s own helpful auras', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [
          aura({ id: 'corruption' }),
          aura({ id: 'blessing', kind: 'buff_ap' as AuraKind, value: 30 }),
        ]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.count).toBe(1);
    expect(state.rows[0].auraName).toBe('name:corruption');
  });

  it('selects across classes and aura kinds without any ability list', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [
          aura({ id: 'a_dot', kind: 'dot' as AuraKind }),
          aura({ id: 'b_poison', kind: 'slow' as AuraKind }),
          aura({ id: 'c_faerie', kind: 'faerie_fire' as AuraKind }),
          aura({ id: 'd_sunder', kind: 'sunder' as AuraKind }),
        ]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.count).toBe(4);
  });

  it('skips players, corpses, and enemies carrying nothing', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        { id: 1, kind: 'player', name: 'Rival', dead: false, auras: [aura({ id: 'corruption' })] },
        { id: 2, kind: 'mob', name: 'Corpse', dead: true, auras: [aura({ id: 'corruption' })] },
        mob(3, 'Clean', []),
        mob(4, 'Live', [aura({ id: 'corruption' })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.count).toBe(1);
    expect(state.rows[0].entityId).toBe(4);
  });

  it('leads with the current target and marks those rows', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Other', [aura({ id: 'corruption' })]),
        mob(9, 'Focus', [aura({ id: 'corruption' })]),
      ],
      targetId: 9,
      enabled: true,
    });
    expect(state.rows.slice(0, 2).map((r) => r.entityId)).toEqual([9, 1]);
    expect(state.rows[0].onCurrentTarget).toBe(true);
    expect(state.rows[1].onCurrentTarget).toBe(false);
  });

  it('orders other enemies by entity id, not by iteration order', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(30, 'C', [aura({ id: 'corruption' })]),
        mob(10, 'A', [aura({ id: 'corruption' })]),
        mob(20, 'B', [aura({ id: 'corruption' })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.rows.slice(0, 3).map((r) => r.entityId)).toEqual([10, 20, 30]);
  });

  it('never re-sorts as time runs down', () => {
    // The refresh-tracker contract: the row you are reaching for stays put.
    const view = makeView();
    const first = view.tick({
      entities: [
        mob(1, 'Dummy', [aura({ id: 'agony', remaining: 17 }), aura({ id: 'zed', remaining: 2 })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(first.rows.slice(0, 2).map((r) => r.auraName)).toEqual(['name:agony', 'name:zed']);
    const second = view.tick({
      entities: [
        mob(1, 'Dummy', [aura({ id: 'agony', remaining: 1 }), aura({ id: 'zed', remaining: 16 })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(second.rows.slice(0, 2).map((r) => r.auraName)).toEqual(['name:agony', 'name:zed']);
  });

  it('caps the list and reports what it dropped', () => {
    const view = makeView();
    const entities = Array.from({ length: 5 }, (_, i) =>
      mob(i + 1, `M${i}`, [aura({ id: 'corruption' }), aura({ id: 'agony' })]),
    );
    const state = view.tick({ entities, targetId: null, enabled: true, cap: 4 });
    expect(state.count).toBe(4);
    expect(state.overflow).toBe(6);
  });

  it('reports no overflow when everything fits', () => {
    const view = makeView();
    const state = view.tick({
      entities: [mob(1, 'Dummy', [aura({ id: 'corruption' })])],
      targetId: null,
      enabled: true,
    });
    expect(state.overflow).toBe(0);
  });

  it('defaults to the shipped cap', () => {
    const view = makeView();
    const entities = Array.from({ length: TARGET_DOTS_ROW_CAP + 2 }, (_, i) =>
      mob(i + 1, `M${i}`, [aura({ id: 'corruption' })]),
    );
    const state = view.tick({ entities, targetId: null, enabled: true });
    expect(state.count).toBe(TARGET_DOTS_ROW_CAP);
    expect(state.overflow).toBe(2);
  });

  it('keys duplicate aura ids on one enemy apart', () => {
    const view = makeView();
    const state = view.tick({
      entities: [mob(1, 'Dummy', [aura({ id: 'corruption' }), aura({ id: 'corruption' })])],
      targetId: null,
      enabled: true,
    });
    expect(state.rows.slice(0, 2).map((r) => r.key)).toEqual(['1:corruption', '1:corruption#1']);
  });

  it('carries the fill fraction, the countdown precision, stacks and the school', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [
          aura({ id: 'a_soon', remaining: 4, duration: 16, school: 'fire', stacks: 3 }),
          aura({ id: 'b_later', remaining: 30, duration: 30, stacks: 1 }),
        ]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.rows[0].fraction).toBeCloseTo(0.25, 5);
    expect(state.rows[0].decimals).toBe(1);
    expect(state.rows[0].school).toBe('fire');
    expect(state.rows[0].stacks).toBe(3);
    expect(state.rows[0].expiring).toBe(true);
    expect(state.rows[1].decimals).toBe(0);
    expect(state.rows[1].fraction).toBe(1);
    // A single stack is not a stack count worth badging.
    expect(state.rows[1].stacks).toBe(0);
    expect(state.rows[1].expiring).toBe(false);
  });

  it('reads a permanent aura as a full bar rather than an empty one', () => {
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [aura({ id: 'brand', permanent: true, remaining: 1, duration: 0 })]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(state.rows[0].fraction).toBe(1);
  });

  it('empties itself when the setting is off', () => {
    const view = makeView();
    const entities = [mob(1, 'Dummy', [aura({ id: 'corruption' })])];
    expect(view.tick({ entities, targetId: null, enabled: true }).count).toBe(1);
    const off = view.tick({ entities, targetId: null, enabled: false });
    expect(off.count).toBe(0);
    expect(off.overflow).toBe(0);
  });

  it('reuses its row records across ticks', () => {
    const view = makeView();
    const entities = [mob(1, 'Dummy', [aura({ id: 'corruption' })])];
    const first = view.tick({ entities, targetId: null, enabled: true });
    const row = first.rows[0];
    const second = view.tick({ entities, targetId: null, enabled: true });
    expect(second.rows[0]).toBe(row);
    expect(second).toBe(first);
  });
});

describe('target dots settings surface', () => {
  it('pins the decimal threshold to ten seconds, on both sides of it', () => {
    // The constant is exported but the fixtures above straddle it widely, so any
    // threshold between them would pass. These two bracket it exactly.
    const view = makeView();
    const state = view.tick({
      entities: [
        mob(1, 'Dummy', [
          aura({ id: 'a_under', remaining: TARGET_DOTS_DECIMAL_BELOW_SEC - 0.01 }),
          aura({ id: 'b_at', remaining: TARGET_DOTS_DECIMAL_BELOW_SEC }),
        ]),
      ],
      targetId: null,
      enabled: true,
    });
    expect(TARGET_DOTS_DECIMAL_BELOW_SEC).toBe(10);
    expect(state.rows[0].decimals).toBe(1);
    expect(state.rows[1].decimals).toBe(0);
  });

  it('ships both surfaces on, at the size the slider defaults to', () => {
    expect(SETTING_RANGES.nameplateDotScale).toEqual({ min: 1, max: 3, def: 1.5 });
    expect(BOOL_SETTINGS.showTargetDots.def).toBe(true);
    expect(BOOL_SETTINGS.showNameplateDots.def).toBe(true);
  });

  it('folds the toggle and the slider into one renderer number, 0 meaning off', () => {
    const settings = new Settings();
    expect(settings.nameplateDotRenderScale()).toBe(1.5);
    settings.set('nameplateDotScale', 3);
    expect(settings.nameplateDotRenderScale()).toBe(3);
    // The toggle wins over any slider value: off is off.
    settings.set('showNameplateDots', false);
    expect(settings.nameplateDotRenderScale()).toBe(0);
    settings.set('showNameplateDots', true);
    expect(settings.nameplateDotRenderScale()).toBe(3);
  });

  it('clamps a stored scale outside the slider range', () => {
    const settings = new Settings();
    settings.set('nameplateDotScale', 99);
    expect(settings.nameplateDotRenderScale()).toBe(3);
    settings.set('nameplateDotScale', 0.1);
    expect(settings.nameplateDotRenderScale()).toBe(1);
  });
});
