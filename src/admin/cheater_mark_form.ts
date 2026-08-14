import { t } from './i18n';
import type { Built } from './moderation_actions';

// Pure builders for the Cheater mark panel (the moderation_actions.ts pattern):
// each returns either a PendingAction (title + summary rows + endpoint + body for
// the confirm dialog) or an errorKey to surface. Host-agnostic and side-effect-free
// so a Vitest asserts the hour conversion, validation, and endpoint/body directly;
// CheaterMarkControls performs the apiPost after the operator confirms.
//
// The form takes HOURS (operators think in hours of played time); the wire takes
// SECONDS (the sim burns a played-second budget). The conversion lives here, in one
// tested place, never inline in a template.

const SECONDS_PER_HOUR = 3600;

// Mirrors CHEATER_MARK_MAX_SECONDS (src/sim/moderation/cheater_mark.ts, 100 hours).
// The admin SPA cannot import from src/sim (src/admin/CLAUDE.md), so the bound is
// restated here; tests/admin/cheater_mark_form.test.ts pins the two constants equal.
export const CHEATER_MARK_MAX_HOURS = 100;

/**
 * Convert the form's whole-hours budget to the wire's seconds, refusing anything
 * moderation_db would clamp or reject: the result is null unless hours is an
 * integer in [1, CHEATER_MARK_MAX_HOURS].
 */
export function cheaterMarkHoursToSeconds(hours: unknown): number | null {
  if (typeof hours !== 'number' || !Number.isInteger(hours)) return null;
  if (hours < 1 || hours > CHEATER_MARK_MAX_HOURS) return null;
  return hours * SECONDS_PER_HOUR;
}

export function applyCheaterMark(accountId: number, hours: unknown, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  const seconds = cheaterMarkHoursToSeconds(hours);
  if (seconds === null) return { errorKey: 'alert.cheaterMarkDurationInvalid' };
  return {
    pending: {
      title: t('dialog.confirmCheaterMark'),
      rows: [
        { label: t('dialog.account'), value: `#${accountId}` },
        { label: t('dialog.action'), value: t('dialog.actionCheaterMark') },
        { label: t('dialog.length'), value: t('detail.lengthHours', { count: hours as number }) },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/cheater-mark`,
      body: { reason: note, seconds },
      danger: true,
    },
  };
}

export function liftCheaterMark(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmCheaterMarkLift'),
      rows: [
        { label: t('dialog.account'), value: `#${accountId}` },
        { label: t('dialog.action'), value: t('dialog.actionCheaterMarkLift') },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/lift-cheater-mark`,
      body: { reason: note },
    },
  };
}
