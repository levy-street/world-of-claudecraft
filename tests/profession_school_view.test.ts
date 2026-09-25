// Pure-core tests for the Profession Schools board (rank-gated crafting
// institutions; first implementation: the Enchanters School). Drives
// buildProfessionSchoolsModel directly with a hand-built
// PlayerProfessionSchoolsView (the IWorld projection shape both hosts
// mirror), the tests/commission_order_view.test.ts pattern.

import { describe, expect, it } from 'vitest';
import { ENCHANTERS_SCHOOL_ID, PROFESSION_SCHOOLS } from '../src/sim/content/profession_schools';
import type { ItemDef } from '../src/sim/types';
import { buildProfessionSchoolsModel } from '../src/ui/hud/professions/profession_school_view';
import type {
  PlayerProfessionSchoolsView,
  SchoolMembershipView,
  SchoolTaskView,
} from '../src/world_api/professions';

const DUST_ITEM: ItemDef = {
  id: 'arcane_dust',
  name: 'Arcane Dust',
  quality: 'common',
  kind: 'junk',
  sellValue: 0,
} as unknown as ItemDef;

const ITEMS: Record<string, ItemDef> = { arcane_dust: DUST_ITEM };

function membership(overrides: Partial<SchoolMembershipView> = {}): SchoolMembershipView {
  return {
    schoolId: ENCHANTERS_SCHOOL_ID,
    points: 0,
    rankId: 'initiate',
    rankName: 'Initiate',
    sworn: false,
    nextRankPoints: 60,
    ...overrides,
  };
}

function task(overrides: Partial<SchoolTaskView> = {}): SchoolTaskView {
  return {
    taskId: 'school_task_enchanters_daily_dust',
    schoolId: ENCHANTERS_SCHOOL_ID,
    kind: 'daily',
    requiredItemId: 'arcane_dust',
    requiredCount: 10,
    points: 15,
    readySeconds: 0,
    ...overrides,
  };
}

function view(overrides: Partial<PlayerProfessionSchoolsView> = {}): PlayerProfessionSchoolsView {
  return { memberships: [], tasks: [], ...overrides };
}

describe('buildProfessionSchoolsModel', () => {
  it('rows the FULL catalog even when the viewer has joined nothing', () => {
    const model = buildProfessionSchoolsModel(view(), ITEMS);
    expect(model.schools).toHaveLength(PROFESSION_SCHOOLS.length);
    const row = model.schools.find((s) => s.schoolId === ENCHANTERS_SCHOOL_ID);
    expect(row).toMatchObject({
      joined: false,
      points: 0,
      rankId: null,
      sworn: false,
      nextRankPoints: null,
      tasks: [],
    });
  });

  it('resolves the join-qualification hint off the viewer craft skill', () => {
    const school = PROFESSION_SCHOOLS.find((s) => s.id === ENCHANTERS_SCHOOL_ID);
    if (!school) throw new Error('enchanters_school missing from catalog');
    const under = buildProfessionSchoolsModel(view(), ITEMS, {
      [school.professionId]: school.joinProficiency - 1,
    });
    const over = buildProfessionSchoolsModel(view(), ITEMS, {
      [school.professionId]: school.joinProficiency,
    });
    expect(under.schools[0].qualifiesToJoin).toBe(false);
    expect(over.schools[0].qualifiesToJoin).toBe(true);
    expect(under.schools[0].joinProficiency).toBe(school.joinProficiency);
  });

  it('decorates a joined row with its membership fields verbatim', () => {
    const model = buildProfessionSchoolsModel(
      view({ memberships: [membership({ points: 90, rankId: 'apprentice', sworn: true })] }),
      ITEMS,
    );
    const row = model.schools.find((s) => s.schoolId === ENCHANTERS_SCHOOL_ID);
    expect(row).toMatchObject({
      joined: true,
      points: 90,
      rankId: 'apprentice',
      sworn: true,
      nextRankPoints: 60,
    });
  });

  it('buckets every task under its owning school, resolving the item def', () => {
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [membership()],
        tasks: [task({ readySeconds: 0 }), task({ taskId: 'other_task', readySeconds: 42 })],
      }),
      ITEMS,
    );
    const row = model.schools.find((s) => s.schoolId === ENCHANTERS_SCHOOL_ID);
    expect(row?.tasks).toHaveLength(2);
    const ready = row?.tasks.find((t) => t.taskId === 'school_task_enchanters_daily_dust');
    expect(ready).toMatchObject({ ready: true, readySeconds: 0, requiredCount: 10, points: 15 });
    expect(ready?.item).toBe(DUST_ITEM);
    const cooling = row?.tasks.find((t) => t.taskId === 'other_task');
    expect(cooling).toMatchObject({ ready: false, readySeconds: 42 });
  });

  it('leaves task.item undefined for an id with no def in the table', () => {
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [membership()],
        tasks: [task({ requiredItemId: 'unknown_reagent' })],
      }),
      {},
    );
    const row = model.schools.find((s) => s.schoolId === ENCHANTERS_SCHOOL_ID);
    expect(row?.tasks[0].item).toBeUndefined();
  });

  it('defaults craftSkills to empty, treating an unrepresented profession as skill 0', () => {
    const model = buildProfessionSchoolsModel(view(), ITEMS);
    const row = model.schools.find((s) => s.schoolId === ENCHANTERS_SCHOOL_ID);
    expect(row?.playerCraftSkill).toBe(0);
    expect(row?.qualifiesToJoin).toBe(false);
  });
});
