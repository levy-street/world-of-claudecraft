// Profession Schools task-submission chat-line model: maps a text-free
// schoolTaskResult event to the hudChrome key it renders, the values that key
// interpolates, and the professions log tone (the tool_effect_result_view.ts
// / commission_order_feedback.ts precedent). ONE chat line either way (the
// trainResult single-surface rule: no toast, no extra sound cue).
//
// DOM/Three-free, covered by architecture.test.ts's remainder sweep (it
// touches no browser global, so it needs no explicit registration).

import type { SimEvent } from '../../../sim/types';
import { formatNumber, type TranslationKey } from '../../i18n';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from './profession_log_tones';
import { schoolNameText } from './profession_school_i18n';

type SchoolTaskResultEvent = Extract<SimEvent, { type: 'schoolTaskResult' }>;
export type SchoolTaskDenyReason = NonNullable<SchoolTaskResultEvent['reason']>;

export interface SchoolTaskResultLine {
  key: TranslationKey;
  params: Record<string, string>;
  /** PROF_LOG_GRANT on success, PROF_LOG_DENY on a refusal. */
  tone: string;
}

const UNKNOWN_TASK: TranslationKey = 'hudChrome.school.denyUnknownTask';

/** Every deny reason's key, as an EXHAUSTIVE Record (the craft_denial_line_view
 *  shape): a reason added to the wire union fails tsc HERE until it gets a
 *  line. `unknown_task` interpolates no school (resolveSchoolTaskSubmission
 *  reports an empty schoolId for it, nothing to name); every other reason
 *  names the school the sim already resolved. Exported for the membership pin
 *  in tests/school_task_feedback.test.ts. */
export const SCHOOL_TASK_DENY_KEY_BY_REASON: Record<SchoolTaskDenyReason, TranslationKey> = {
  unknown_task: UNKNOWN_TASK,
  not_a_member: 'hudChrome.school.denyNotAMember',
  out_of_range: 'hudChrome.school.denyOutOfRange',
  on_cooldown: 'hudChrome.school.denyOnCooldown',
  party_required: 'hudChrome.school.denyPartyRequired',
  insufficient_materials: 'hudChrome.school.denyInsufficientMaterials',
};

/** The chat-line model for one schoolTaskResult. The school name resolves off
 *  the event's own `schoolId` plus static content (the trainResult idiom): no
 *  caller-supplied name is needed. */
export function schoolTaskResultLine(
  ev: Pick<SchoolTaskResultEvent, 'ok' | 'schoolId' | 'reason' | 'pointsAwarded'>,
): SchoolTaskResultLine {
  if (ev.ok) {
    return {
      key: 'hudChrome.school.taskSubmitted',
      params: {
        school: schoolNameText(ev.schoolId),
        points: formatNumber(ev.pointsAwarded ?? 0, { maximumFractionDigits: 0 }),
      },
      tone: PROF_LOG_GRANT,
    };
  }
  const key = ev.reason ? SCHOOL_TASK_DENY_KEY_BY_REASON[ev.reason] : UNKNOWN_TASK;
  const params: Record<string, string> =
    key === UNKNOWN_TASK ? {} : { school: schoolNameText(ev.schoolId) };
  return { key, params, tone: PROF_LOG_DENY };
}
