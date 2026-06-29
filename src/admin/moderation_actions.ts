import { blockExpiryIso } from './block_expiry';
import { fmtDate } from './format';
import { t } from './i18n';

// Pure builders for the account/character moderation actions. Each returns either a
// PendingAction (title + summary rows + endpoint + body for the confirm dialog) or an
// errorKey to surface (note required, bad custom expiry). Kept host-agnostic and
// side-effect-free so a Vitest can assert the endpoint/body/validation directly; the
// component performs the apiPost after the operator confirms. Ported 1:1 from the old
// main.ts handleModerationActionClick branches.

export interface PendingAction {
  title: string;
  rows: { label: string; value: string }[];
  endpoint: string;
  body: unknown;
  danger?: boolean;
}

export type Built = { pending: PendingAction } | { errorKey: string };

const HOUR_MS = 3600 * 1000;

const accountRow = (accountId: number) => ({ label: t('dialog.account'), value: `#${accountId}` });
const reasonRow = (note: string) => ({ label: t('dialog.reason'), value: note });

function futureExpiry(raw: string, missingKey: string): { iso: string } | { errorKey: string } {
  const expiry = raw ? new Date(raw) : null;
  if (!expiry || !Number.isFinite(expiry.getTime())) return { errorKey: missingKey };
  if (expiry.getTime() <= Date.now()) return { errorKey: 'alert.customExpiryFuture' };
  return { iso: expiry.toISOString() };
}

export function suspendHours(accountId: number, hours: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  const expiresAt = new Date(Date.now() + hours * HOUR_MS).toISOString();
  return {
    pending: {
      title: t('dialog.confirmSuspension'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionSuspend') },
        { label: t('dialog.length'), value: t('detail.lengthHours', { count: hours }) },
        { label: t('dialog.until'), value: fmtDate(expiresAt) },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/suspend`,
      body: { reason: note, expiresAt },
    },
  };
}

export function suspendCustom(accountId: number, rawExpiry: string, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  const r = futureExpiry(rawExpiry, 'alert.customExpiryRequired');
  if ('errorKey' in r) return r;
  return {
    pending: {
      title: t('dialog.confirmCustomSuspension'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionSuspend') },
        { label: t('dialog.until'), value: fmtDate(r.iso) },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/suspend`,
      body: { reason: note, expiresAt: r.iso },
    },
  };
}

export function unsuspendAccount(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmUnsuspension'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionUnsuspend') },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/unsuspend`,
      body: { reason: note },
    },
  };
}

export function chatMuteHours(accountId: number, hours: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  const expiresAt = new Date(Date.now() + hours * HOUR_MS).toISOString();
  return {
    pending: {
      title: t('dialog.confirmChatMute'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionChatMute') },
        { label: t('dialog.length'), value: t('detail.lengthHours', { count: hours }) },
        { label: t('dialog.until'), value: fmtDate(expiresAt) },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/chat-mute`,
      body: { reason: note, expiresAt },
    },
  };
}

export function chatMuteCustom(accountId: number, rawExpiry: string, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  const r = futureExpiry(rawExpiry, 'alert.customChatMuteRequired');
  if ('errorKey' in r) return r;
  return {
    pending: {
      title: t('dialog.confirmCustomChatMute'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionChatMute') },
        { label: t('dialog.until'), value: fmtDate(r.iso) },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/chat-mute`,
      body: { reason: note, expiresAt: r.iso },
    },
  };
}

export function liftChatMute(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmChatUnmute'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionChatUnmute') },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/lift-mute`,
      body: { reason: note },
    },
  };
}

// A free-form moderator note. Non-punitive and additive only: it posts to the note
// endpoint, which appends to the audit log without changing account state. The note
// text rides in `reason` for parity with the other actions; the inline form submits
// it directly, so title/rows are present only to satisfy PendingAction.
export function addNote(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('detail.addNote'),
      rows: [accountRow(accountId), reasonRow(note)],
      endpoint: `/admin/api/moderation/accounts/${accountId}/note`,
      body: { reason: note },
    },
  };
}

export function banAccount(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmBan'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionBan') },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/ban`,
      body: { reason: note },
      danger: true,
    },
  };
}

export function unbanAccount(accountId: number, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmUnban'),
      rows: [
        accountRow(accountId),
        { label: t('dialog.action'), value: t('dialog.actionUnban') },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/accounts/${accountId}/unban`,
      body: { reason: note },
    },
  };
}

// Ban one of an account's known IPs. No note is required (matches the old flow); the
// shared-IP caveat is surfaced as a confirm row. duration is a block_expiry token
// ('1d'|'7d'|'30d'|'' for forever); actionLabel is the clicked button's text.
export function banIp(
  ip: string,
  actionLabel: string,
  duration: string,
  note: string,
): PendingAction {
  return {
    title: t('blockedIps.confirmBanTitle'),
    rows: [
      { label: t('blockedIps.colIp'), value: ip },
      { label: t('dialog.action'), value: actionLabel },
      { label: t('dialog.reason'), value: note || t('common.emptyValue') },
      { label: t('dialog.warning'), value: t('blockedIps.sharedIpWarning') },
    ],
    endpoint: '/admin/api/blocked-ips',
    body: { ip, reason: note, expiresAt: blockExpiryIso(duration) },
    danger: true,
  };
}

export function forceRename(characterId: number, characterName: string, note: string): Built {
  if (!note) return { errorKey: 'alert.noteRequired' };
  return {
    pending: {
      title: t('dialog.confirmForceName'),
      rows: [
        { label: t('dialog.character'), value: characterName },
        { label: t('dialog.action'), value: t('dialog.actionForceName') },
        reasonRow(note),
      ],
      endpoint: `/admin/api/moderation/characters/${characterId}/force-rename`,
      body: { reason: note },
    },
  };
}
