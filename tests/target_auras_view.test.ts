import { describe, expect, it } from 'vitest';
import type { AurasState } from '../src/ui/auras_view';
import { createTargetAurasWindowView, targetAuraSourceName } from '../src/ui/target_auras_view';
import { assertAllocationStable } from './util/alloc_probe';

function state(): AurasState {
  return {
    count: 4,
    slots: [
      {
        key: 'own_dot',
        iconKey: 'own_dot',
        isDebuff: true,
        school: 'shadow',
        durationText: '6s',
        stacksText: '',
        name: 'Own DoT',
        remaining: 6,
        duration: 12,
        sourceId: 7,
        cancelable: false,
        effectHtml: '',
        own: true,
        expiring: false,
        toggle: false,
        alwaysRender: false,
      },
      {
        key: 'own_hot',
        iconKey: 'own_hot',
        isDebuff: false,
        school: '',
        durationText: '20s',
        stacksText: '2',
        name: 'Own HoT',
        remaining: 20,
        duration: 10,
        sourceId: 7,
        cancelable: false,
        effectHtml: '',
        own: true,
        expiring: false,
        toggle: false,
        alwaysRender: false,
      },
      {
        key: 'foreign_dot',
        iconKey: 'foreign_dot',
        isDebuff: true,
        school: 'fire',
        durationText: '3s',
        stacksText: '',
        name: 'Foreign DoT',
        remaining: 3,
        duration: 0,
        sourceId: 9,
        cancelable: false,
        effectHtml: '',
        own: false,
        expiring: true,
        toggle: false,
        alwaysRender: false,
      },
      {
        key: 'foreign_buff',
        iconKey: 'foreign_buff',
        isDebuff: false,
        school: '',
        durationText: '',
        stacksText: '',
        name: 'Foreign Buff',
        remaining: Number.POSITIVE_INFINITY,
        duration: undefined,
        sourceId: 51,
        cancelable: false,
        effectHtml: '',
        own: false,
        expiring: false,
        toggle: false,
        alwaysRender: false,
      },
    ],
  };
}

describe('buildTargetAurasWindowView', () => {
  it('keeps debuffs and buffs in simultaneous vertical sections', () => {
    const view = createTargetAurasWindowView().tick(state(), (sourceId) =>
      sourceId === 7 ? 'Hero' : sourceId === 9 ? 'Mage' : 'Target',
    );

    expect(view.debuffs.map((row) => row.name)).toEqual(['Own DoT', 'Foreign DoT']);
    expect(view.buffs.map((row) => row.name)).toEqual(['Own HoT', 'Foreign Buff']);
    expect(view.debuffs.map((row) => row.sourceName)).toEqual(['Hero', 'Mage']);
    expect(view.buffCount).toBe(2);
    expect(view.debuffCount).toBe(2);
  });

  it('stably promotes the local player auras ahead of every foreign caster', () => {
    const input = state();
    input.slots = [input.slots[2], input.slots[0], input.slots[3], input.slots[1]];

    const view = createTargetAurasWindowView().tick(input, () => 'Caster', 'all');

    expect(view.debuffs.map((row) => row.name)).toEqual(['Own DoT', 'Foreign DoT']);
    expect(view.buffs.map((row) => row.name)).toEqual(['Own HoT', 'Foreign Buff']);
  });

  it('keeps every raid-sized aura reachable after own-first ordering', () => {
    const template = state().slots[2];
    const slots = Array.from({ length: 15 }, (_, index) => ({
      ...template,
      key: `debuff_${index}`,
      name: `Debuff ${index}`,
      own: index === 14,
    }));
    const input: AurasState = { slots, count: slots.length };

    const view = createTargetAurasWindowView().tick(input, () => 'Caster', 'debuffs');

    expect(view.debuffCount).toBe(15);
    expect(view.debuffTotal).toBe(15);
    expect(view.debuffs[0].name).toBe('Debuff 14');
    expect(view.buffs).toHaveLength(0);
    expect(view.buffCount).toBe(0);
  });

  it('clamps progress and degrades untimed auras to a full steady bar', () => {
    const view = createTargetAurasWindowView().tick(state(), () => '');

    expect(view.debuffs.map((row) => row.remainingFraction)).toEqual([0.5, 0]);
    expect(view.buffs.map((row) => row.remainingFraction)).toEqual([1, 1]);
  });

  it('reuses the view, arrays, and active row objects across ticks', () => {
    const core = createTargetAurasWindowView();
    const first = core.tick(state(), () => 'Caster');
    const firstDebuff = first.debuffs[0];
    const next = state();
    next.slots[0].remaining = 2;
    const second = core.tick(next, () => 'Caster');

    expect(second).toBe(first);
    expect(second.debuffs).toBe(first.debuffs);
    expect(second.debuffs[0]).toBe(firstDebuff);
    expect(second.debuffs[0].remaining).toBe(2);
  });

  it('keeps its returned container and section pools allocation-stable', () => {
    const core = createTargetAurasWindowView();
    const input = state();
    const sourceName = () => 'Caster';
    const first = core.tick(input, sourceName);
    const rowRefs = [...first.debuffs, ...first.buffs];

    assertAllocationStable(() => core.tick(input, sourceName), 64);
    for (let call = 0; call < 64; call++) {
      const view = core.tick(input, sourceName);
      const currentRows = [...view.debuffs, ...view.buffs];
      expect(currentRows).toHaveLength(rowRefs.length);
      for (let i = 0; i < rowRefs.length; i++) expect(currentRows[i]).toBe(rowRefs[i]);
    }
  });
});

describe('targetAuraSourceName', () => {
  const entities = new Map([[7, { name: 'Hero' }]]);

  it('resolves known casters and leaves missing or interest-scoped casters blank', () => {
    const resolve = (id: number | undefined) =>
      targetAuraSourceName(
        id,
        (entityId) => entities.get(entityId),
        (entity) => entity.name,
      );

    expect(resolve(7)).toBe('Hero');
    expect(resolve(0)).toBe('');
    expect(resolve(undefined)).toBe('');
    expect(resolve(99)).toBe('');
  });
});
