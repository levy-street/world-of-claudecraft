import { t } from './i18n';
import type { PendingAction } from './moderation_actions';

export interface GeneralChatRateLimitFormErrors {
  messages?: string;
  windowMinutes?: string;
  reason?: string;
}

export type GeneralChatRateLimitBuild =
  | { pending: PendingAction }
  | { errors: GeneralChatRateLimitFormErrors };

type NumericInput = string | number | undefined;

export const GENERAL_CHAT_RATE_LIMIT_MAX_MESSAGES = 1000;
export const GENERAL_CHAT_RATE_LIMIT_MAX_WINDOW_MINUTES = 1440;
export const GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH = 500;

function boundedPositiveInteger(value: NumericInput, max: number): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
  }
  const trimmed = value?.trim() ?? '';
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function pendingAction(
  accountId: number,
  rateLimit: { messages: number; windowMinutes: number } | null,
  reason: string,
): PendingAction {
  const action = rateLimit ? t('generalChatRateLimit.save') : t('generalChatRateLimit.remove');
  return {
    title: action,
    rows: [
      { label: t('dialog.account'), value: `#${accountId}` },
      { label: t('dialog.action'), value: action },
    ],
    endpoint: `/admin/api/accounts/${accountId}/general-chat-rate-limit`,
    body: { rateLimit, reason },
  };
}

export function buildGeneralChatRateLimitUpdate(
  accountId: number,
  messagesInput: NumericInput,
  windowMinutesInput: NumericInput,
  reasonInput: string,
): GeneralChatRateLimitBuild {
  const messages = boundedPositiveInteger(messagesInput, GENERAL_CHAT_RATE_LIMIT_MAX_MESSAGES);
  const windowMinutes = boundedPositiveInteger(
    windowMinutesInput,
    GENERAL_CHAT_RATE_LIMIT_MAX_WINDOW_MINUTES,
  );
  const reason = reasonInput.trim();
  const errors: GeneralChatRateLimitFormErrors = {};
  if (messages === null) {
    errors.messages = 'generalChatRateLimit.messagesError';
  }
  if (windowMinutes === null) {
    errors.windowMinutes = 'generalChatRateLimit.windowMinutesError';
  }
  if (!reason) errors.reason = 'generalChatRateLimit.reasonRequired';
  else if (reason.length > GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH) {
    errors.reason = 'generalChatRateLimit.reasonTooLong';
  }
  if (
    messages === null ||
    windowMinutes === null ||
    !reason ||
    reason.length > GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH
  ) {
    return { errors };
  }

  return {
    pending: pendingAction(accountId, { messages, windowMinutes }, reason),
  };
}

export function buildGeneralChatRateLimitRemoval(
  accountId: number,
  reasonInput: string,
): GeneralChatRateLimitBuild {
  const reason = reasonInput.trim();
  if (!reason) {
    return { errors: { reason: 'generalChatRateLimit.reasonRequired' } };
  }
  if (reason.length > GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH) {
    return { errors: { reason: 'generalChatRateLimit.reasonTooLong' } };
  }
  return { pending: pendingAction(accountId, null, reason) };
}
