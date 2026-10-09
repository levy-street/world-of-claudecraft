import { t } from './i18n';
import type { Built } from './moderation_actions';

// Pure builders for the world quest block panel (the cheater_mark_form.ts
// pattern): each returns either a PendingAction (title + summary rows + endpoint
// + body for the confirm dialog) or an errorKey to surface. Side-effect-free so a
// Vitest asserts the endpoint and body directly; WorldQuestBlockControls performs
// the apiPost after the operator confirms.

export function blockWorldQuests(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmWorldQuestBlock'),
      rows: [
        { label: t('dialog.account'), value: `#${accountId}` },
        { label: t('dialog.action'), value: t('dialog.actionWorldQuestBlock') },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/world-quests-block`,
      body: { reason: note },
      danger: true,
    },
  };
}

export function unblockWorldQuests(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmWorldQuestUnblock'),
      rows: [
        { label: t('dialog.account'), value: `#${accountId}` },
        { label: t('dialog.action'), value: t('dialog.actionWorldQuestUnblock') },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/world-quests-unblock`,
      body: { reason: note },
    },
  };
}
