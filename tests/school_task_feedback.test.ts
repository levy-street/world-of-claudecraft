// The Profession Schools task-submission chat-line model
// (src/ui/hud/professions/school_task_feedback.ts): every deny reason's key
// is a hand-written expectation here (the commission_order_feedback.test.ts
// shape), covering the WHOLE schoolTaskResult reason union.

import { describe, expect, it } from 'vitest';
import { ENCHANTERS_SCHOOL_ID } from '../src/sim/content/profession_schools';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from '../src/ui/hud/professions/profession_log_tones';
import {
  type SchoolTaskDenyReason,
  schoolTaskResultLine,
} from '../src/ui/hud/professions/school_task_feedback';
import { hasTranslation } from '../src/ui/i18n';

describe('schoolTaskResultLine', () => {
  it('a success names the school and the points awarded', () => {
    expect(
      schoolTaskResultLine({
        ok: true,
        schoolId: ENCHANTERS_SCHOOL_ID,
        pointsAwarded: 15,
      }),
    ).toEqual({
      key: 'hudChrome.school.taskSubmitted',
      params: { school: 'Enchanters School', points: '15' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('a success with no pointsAwarded interpolates 0 rather than throwing', () => {
    expect(schoolTaskResultLine({ ok: true, schoolId: ENCHANTERS_SCHOOL_ID })).toEqual({
      key: 'hudChrome.school.taskSubmitted',
      params: { school: 'Enchanters School', points: '0' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('an unknown schoolId renders the raw id rather than crashing', () => {
    expect(schoolTaskResultLine({ ok: true, schoolId: 'not_a_real_school' })).toEqual({
      key: 'hudChrome.school.taskSubmitted',
      params: { school: 'not_a_real_school', points: '0' },
      tone: PROF_LOG_GRANT,
    });
  });

  // Every deny reason's line, hand-written (independent of the module's
  // internal table), covering the WHOLE wire union.
  const DENIALS: [SchoolTaskDenyReason, string][] = [
    ['not_a_member', 'hudChrome.school.denyNotAMember'],
    ['out_of_range', 'hudChrome.school.denyOutOfRange'],
    ['on_cooldown', 'hudChrome.school.denyOnCooldown'],
    ['party_required', 'hudChrome.school.denyPartyRequired'],
    ['insufficient_materials', 'hudChrome.school.denyInsufficientMaterials'],
  ];

  it.each(DENIALS)('denial %s names the school, in the deny tone', (reason, key) => {
    expect(schoolTaskResultLine({ ok: false, schoolId: ENCHANTERS_SCHOOL_ID, reason })).toEqual({
      key,
      params: { school: 'Enchanters School' },
      tone: PROF_LOG_DENY,
    });
    expect(hasTranslation(key)).toBe(true);
  });

  it('unknown_task interpolates no school (the sim reports an empty schoolId for it)', () => {
    expect(schoolTaskResultLine({ ok: false, schoolId: '', reason: 'unknown_task' })).toEqual({
      key: 'hudChrome.school.denyUnknownTask',
      params: {},
      tone: PROF_LOG_DENY,
    });
  });

  it('a deny with no reason falls back to the unknown_task line (the malformed-taskId probe arm)', () => {
    expect(schoolTaskResultLine({ ok: false, schoolId: '' })).toEqual({
      key: 'hudChrome.school.denyUnknownTask',
      params: {},
      tone: PROF_LOG_DENY,
    });
  });

  it('the hand-written denial list plus unknown_task covers the WHOLE reason union', () => {
    const listed = [...DENIALS.map(([reason]) => reason), 'unknown_task'].sort();
    const union: SchoolTaskDenyReason[] = [
      'unknown_task',
      'not_a_member',
      'out_of_range',
      'on_cooldown',
      'party_required',
      'insufficient_materials',
    ];
    expect(listed).toEqual(union.slice().sort());
  });
});
