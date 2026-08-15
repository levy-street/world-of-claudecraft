// Pure structured-error resolver for sender-only General chat quota events.
// The server keeps English `text` as the mixed-release fallback, while current
// clients prefer the stable code and validated data here. Unknown or malformed
// additions return null so Hud preserves the existing prose/system path.

import { formatDuration, t } from './i18n';

export interface GeneralChatQuotaEventInput {
  type: 'error';
  text: string;
  code?: string;
  channel?: string;
  retryAfterSeconds?: number;
}

export interface GeneralChatQuotaView {
  text: string;
  channel: 'general';
  announceWhenFiltered: true;
}

export function generalChatQuotaView(
  event: GeneralChatQuotaEventInput,
): GeneralChatQuotaView | null {
  if (event.channel !== 'general') return null;
  const seconds = event.retryAfterSeconds;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) {
    return null;
  }

  if (event.code === 'general_chat_quota') {
    return {
      text: t('hudChrome.chatQuota.limitReached', {
        seconds: formatDuration(seconds),
      }),
      channel: 'general',
      announceWhenFiltered: true,
    };
  }
  if (event.code === 'general_chat_quota_pending' && seconds === 1) {
    return {
      text: t('hudChrome.chatQuota.pending'),
      channel: 'general',
      announceWhenFiltered: true,
    };
  }
  if (event.code === 'general_chat_quota_unavailable' && seconds === 1) {
    return {
      text: t('hudChrome.chatQuota.unavailable'),
      channel: 'general',
      announceWhenFiltered: true,
    };
  }
  return null;
}
