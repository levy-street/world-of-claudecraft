import { t } from './i18n';

// Report-reason code (server enum) -> localized label. Unknown codes fall through to
// the raw code. Ported from the old tables.ts reasonLabel.
export function reasonLabel(reason: string): string {
  return (
    (
      {
        harassment: t('reason.harassment'),
        spam: t('reason.spam'),
        cheating: t('reason.cheating'),
        offensive_name_or_chat: t('reason.offensiveName'),
        other: t('reason.other'),
      } as Record<string, string>
    )[reason] ?? reason
  );
}

// Audit-log action kind (server enum) -> localized label + badge variant. ONE table,
// shared by the account-scoped ModerationHistory component and the realm-wide
// ModerationHistoryPage, which each used to carry their own copy of this switch: a
// new server action kind added to only one of them (or to neither) renders as the
// unlabelled "Other action", which defeats the point of auditing it.
//
// The keys are the union of server/moderation_db.ts MODERATION_ACTIONS (the closed set
// written to account_moderation_actions.action) and the ip_blocks history kinds
// (block / unblock), which only the realm-wide page can surface.
// tests/admin/moderation_action_labels.test.ts pins the table against MODERATION_ACTIONS
// so the next new kind cannot silently regress to "Other action".
export type ModerationBadgeVariant = 'default' | 'neutral' | 'warn' | 'bad' | 'success';

export const MODERATION_ACTION_LABEL_KEYS: Record<string, string> = {
  kick: 'moderationHistory.actionKick',
  kill: 'moderationHistory.actionKill',
  jail: 'moderationHistory.actionJail',
  unjail: 'moderationHistory.actionUnjail',
  suspend: 'moderationHistory.actionSuspend',
  unsuspend: 'moderationHistory.actionUnsuspend',
  ban: 'moderationHistory.actionBan',
  unban: 'moderationHistory.actionUnban',
  chat_mute: 'moderationHistory.actionChatMute',
  chat_unmute: 'moderationHistory.actionChatUnmute',
  note: 'moderationHistory.actionNote',
  force_rename: 'moderationHistory.actionForceRename',
  reset_password: 'moderationHistory.actionResetPassword',
  daily_rewards_ban: 'moderationHistory.actionDailyRewardsBan',
  daily_rewards_unban: 'moderationHistory.actionDailyRewardsUnban',
  daily_rewards_ip_ban: 'moderationHistory.actionDailyRewardsIpBan',
  daily_rewards_ip_unban: 'moderationHistory.actionDailyRewardsIpUnban',
  set_ai: 'moderationHistory.actionSetAi',
  set_streamer: 'moderationHistory.actionSetStreamer',
  block: 'moderationHistory.actionIpBlock',
  unblock: 'moderationHistory.actionIpUnblock',
};

const BAD_ACTIONS = new Set(['ban', 'block', 'daily_rewards_ban', 'daily_rewards_ip_ban']);
const WARN_ACTIONS = new Set(['suspend', 'chat_mute', 'reset_password', 'kick', 'kill', 'jail']);
const GOOD_ACTIONS = new Set([
  'unban',
  'unsuspend',
  'chat_unmute',
  'unjail',
  'unblock',
  'daily_rewards_unban',
  'daily_rewards_ip_unban',
]);

export function moderationActionLabel(action: string): string {
  const key = MODERATION_ACTION_LABEL_KEYS[action];
  return t(key ?? 'moderationHistory.actionUnknown');
}

// Flair (set_ai / set_streamer) and note are neutral on purpose: they are audited but
// not punitive, so they must not read as a sanction in the audit trail.
export function moderationActionVariant(action: string): ModerationBadgeVariant {
  if (BAD_ACTIONS.has(action)) return 'bad';
  if (WARN_ACTIONS.has(action)) return 'warn';
  if (GOOD_ACTIONS.has(action)) return 'success';
  return 'neutral';
}
