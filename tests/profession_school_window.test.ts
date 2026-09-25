// @vitest-environment jsdom

// Thin-consumer tests for the Profession Schools board painter: each row's
// Join/Swear button fires the matching deps callback with the school id, a
// task's Submit button fires onSubmitTask with the taskId only while ready
// and not pending, and a pending submit disables the button with aria-busy.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENCHANTERS_SCHOOL_ID } from '../src/sim/content/profession_schools';
import { buildProfessionSchoolsModel } from '../src/ui/hud/professions/profession_school_view';
import {
  type ProfessionSchoolWindowDeps,
  renderProfessionSchoolWindow,
} from '../src/ui/hud/professions/profession_school_window';
import { setLanguage } from '../src/ui/i18n';
import type { PlayerProfessionSchoolsView } from '../src/world_api/professions';

afterEach(() => setLanguage('en'));

function deps(overrides: Partial<ProfessionSchoolWindowDeps> = {}): ProfessionSchoolWindowDeps {
  return {
    hideTooltip: vi.fn(),
    onJoin: vi.fn(),
    onSwear: vi.fn(),
    onSubmitTask: vi.fn(),
    onClose: vi.fn(),
    taskPending: () => false,
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    ...overrides,
  };
}

function view(overrides: Partial<PlayerProfessionSchoolsView> = {}): PlayerProfessionSchoolsView {
  return { memberships: [], tasks: [], ...overrides };
}

describe('renderProfessionSchoolWindow', () => {
  it('a not-yet-joined school renders a Join button that calls onJoin with its id', () => {
    const el = document.createElement('div');
    const d = deps();
    renderProfessionSchoolWindow(el, buildProfessionSchoolsModel(view(), {}), d);
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Join');
    expect(btn).toBeTruthy();
    btn?.click();
    expect(d.onJoin).toHaveBeenCalledWith(ENCHANTERS_SCHOOL_ID);
  });

  it('a joined, unsworn school renders a Swear Allegiance button that calls onSwear', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [
          {
            schoolId: ENCHANTERS_SCHOOL_ID,
            points: 0,
            rankId: 'initiate',
            rankName: 'Initiate',
            sworn: false,
            nextRankPoints: 60,
          },
        ],
      }),
      {},
    );
    renderProfessionSchoolWindow(el, model, d);
    const btn = [...el.querySelectorAll('button')].find(
      (b) => b.textContent === 'Swear Allegiance',
    );
    expect(btn).toBeTruthy();
    btn?.click();
    expect(d.onSwear).toHaveBeenCalledWith(ENCHANTERS_SCHOOL_ID);
    // Neither membership button renders once already sworn.
    el.innerHTML = '';
    const sworn = buildProfessionSchoolsModel(
      view({
        memberships: [
          {
            schoolId: ENCHANTERS_SCHOOL_ID,
            points: 750,
            rankId: 'master',
            rankName: 'Master',
            sworn: true,
            nextRankPoints: 1300,
          },
        ],
      }),
      {},
    );
    renderProfessionSchoolWindow(el, sworn, deps());
    expect(
      [...el.querySelectorAll('button')].some(
        (b) => b.textContent === 'Join' || b.textContent === 'Swear Allegiance',
      ),
    ).toBe(false);
  });

  it('a ready task renders a Submit button that calls onSubmitTask with its id', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [
          {
            schoolId: ENCHANTERS_SCHOOL_ID,
            points: 0,
            rankId: 'initiate',
            rankName: 'Initiate',
            sworn: false,
            nextRankPoints: 60,
          },
        ],
        tasks: [
          {
            taskId: 'school_task_enchanters_daily_dust',
            schoolId: ENCHANTERS_SCHOOL_ID,
            kind: 'daily',
            requiredItemId: 'arcane_dust',
            requiredCount: 10,
            points: 15,
            readySeconds: 0,
          },
        ],
      }),
      {},
    );
    renderProfessionSchoolWindow(el, model, d);
    const submit = el.querySelector<HTMLButtonElement>('.school-task-submit-btn');
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toBe('Submit');
    submit?.click();
    expect(d.onSubmitTask).toHaveBeenCalledWith('school_task_enchanters_daily_dust');
  });

  it('a cooling-down task shows a countdown and a disabled button, no click fires', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [
          {
            schoolId: ENCHANTERS_SCHOOL_ID,
            points: 0,
            rankId: 'initiate',
            rankName: 'Initiate',
            sworn: false,
            nextRankPoints: 60,
          },
        ],
        tasks: [
          {
            taskId: 'school_task_enchanters_daily_dust',
            schoolId: ENCHANTERS_SCHOOL_ID,
            kind: 'daily',
            requiredItemId: 'arcane_dust',
            requiredCount: 10,
            points: 15,
            readySeconds: 125,
          },
        ],
      }),
      {},
    );
    renderProfessionSchoolWindow(el, model, d);
    const submit = el.querySelector<HTMLButtonElement>('.school-task-submit-btn');
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toBe('Ready in 2 minutes');
    submit?.click();
    expect(d.onSubmitTask).not.toHaveBeenCalled();
  });

  it('a pending submit disables the button and sets aria-busy, even though the task is ready', () => {
    const el = document.createElement('div');
    const d = deps({ taskPending: (taskId) => taskId === 'school_task_enchanters_daily_dust' });
    const model = buildProfessionSchoolsModel(
      view({
        memberships: [
          {
            schoolId: ENCHANTERS_SCHOOL_ID,
            points: 0,
            rankId: 'initiate',
            rankName: 'Initiate',
            sworn: false,
            nextRankPoints: 60,
          },
        ],
        tasks: [
          {
            taskId: 'school_task_enchanters_daily_dust',
            schoolId: ENCHANTERS_SCHOOL_ID,
            kind: 'daily',
            requiredItemId: 'arcane_dust',
            requiredCount: 10,
            points: 15,
            readySeconds: 0,
          },
        ],
      }),
      {},
    );
    renderProfessionSchoolWindow(el, model, d);
    const submit = el.querySelector<HTMLButtonElement>('.school-task-submit-btn');
    expect(submit?.disabled).toBe(true);
    expect(submit?.getAttribute('aria-busy')).toBe('true');
  });

  it('the close button calls onClose', () => {
    const el = document.createElement('div');
    const d = deps();
    renderProfessionSchoolWindow(el, buildProfessionSchoolsModel(view(), {}), d);
    el.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(d.onClose).toHaveBeenCalled();
  });
});
