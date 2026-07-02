import type { InvSlot } from './types';

export const MAIL_ATTACHMENT_LIMIT = 6;
export const MAIL_SUBJECT_MAX = 80;
export const MAIL_BODY_MAX = 500;

export interface PlayerMail {
  id: number;
  fromName: string;
  fromCharacterId?: number;
  subject: string;
  body: string;
  copper: number;
  items: InvSlot[];
  sentAt: number;
  read: boolean;
  attachmentsTaken: boolean;
}

export interface MailboxState {
  nextId: number;
  inbox: PlayerMail[];
}

export interface MailDraft {
  fromName: string;
  fromCharacterId?: number;
  subject?: string;
  body?: string;
  copper?: number;
  items?: InvSlot[];
  sentAt?: number;
}

export interface MailAttachmentPayload {
  copper: number;
  items: InvSlot[];
}

export function emptyMailbox(): MailboxState {
  return { nextId: 1, inbox: [] };
}

export function cloneMailbox(mailbox: MailboxState): MailboxState {
  return {
    nextId: Math.max(1, Math.floor(mailbox.nextId)),
    inbox: mailbox.inbox.map(cloneMail),
  };
}

export function normalizeMailbox(value: MailboxState | undefined): MailboxState {
  if (!value) return emptyMailbox();
  const inbox = Array.isArray(value.inbox)
    ? value.inbox.map(normalizeMail).filter((mail): mail is PlayerMail => mail !== null)
    : [];
  const maxId = inbox.reduce((max, mail) => Math.max(max, mail.id), 0);
  const nextId = Number.isFinite(value.nextId)
    ? Math.max(maxId + 1, Math.floor(value.nextId))
    : maxId + 1;
  return { nextId, inbox };
}

export function normalizeMailItems(items: InvSlot[] | undefined): InvSlot[] {
  const merged = new Map<string, number>();
  for (const slot of (items ?? []).slice(0, MAIL_ATTACHMENT_LIMIT)) {
    if (!slot || typeof slot.itemId !== 'string' || !Number.isFinite(slot.count)) continue;
    const count = Math.max(1, Math.floor(slot.count));
    merged.set(slot.itemId, (merged.get(slot.itemId) ?? 0) + count);
  }
  return [...merged].map(([itemId, count]) => ({ itemId, count }));
}

export function enqueueMail(mailbox: MailboxState, draft: MailDraft): PlayerMail {
  const mail: PlayerMail = {
    id: mailbox.nextId++,
    fromName: clampText(draft.fromName, MAIL_SUBJECT_MAX) || 'Unknown',
    fromCharacterId: draft.fromCharacterId,
    subject: clampText(draft.subject ?? '', MAIL_SUBJECT_MAX),
    body: clampText(draft.body ?? '', MAIL_BODY_MAX),
    copper: normalizeCopper(draft.copper),
    items: normalizeMailItems(draft.items),
    sentAt: normalizeSentAt(draft.sentAt),
    read: false,
    attachmentsTaken: false,
  };
  mailbox.inbox.push(mail);
  return cloneMail(mail);
}

export function markMailRead(mailbox: MailboxState, mailId: number): boolean {
  const mail = mailbox.inbox.find((m) => m.id === mailId);
  if (!mail) return false;
  mail.read = true;
  return true;
}

export function takeMailAttachments(
  mailbox: MailboxState,
  mailId: number,
): MailAttachmentPayload | null {
  const mail = mailbox.inbox.find((m) => m.id === mailId);
  if (!mail || mail.attachmentsTaken) return null;
  const payload = { copper: mail.copper, items: mail.items.map((item) => ({ ...item })) };
  mail.copper = 0;
  mail.items = [];
  mail.attachmentsTaken = true;
  mail.read = true;
  return payload;
}

function normalizeMail(value: PlayerMail): PlayerMail | null {
  if (!value || !Number.isFinite(value.id)) return null;
  return {
    id: Math.max(1, Math.floor(value.id)),
    fromName: clampText(value.fromName, MAIL_SUBJECT_MAX) || 'Unknown',
    fromCharacterId: value.fromCharacterId,
    subject: clampText(value.subject, MAIL_SUBJECT_MAX),
    body: clampText(value.body, MAIL_BODY_MAX),
    copper: normalizeCopper(value.copper),
    items: normalizeMailItems(value.items),
    sentAt: normalizeSentAt(value.sentAt),
    read: !!value.read,
    attachmentsTaken: !!value.attachmentsTaken,
  };
}

function cloneMail(mail: PlayerMail): PlayerMail {
  return {
    ...mail,
    items: mail.items.map((item) => ({ ...item })),
  };
}

function normalizeCopper(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
}

function normalizeSentAt(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
}

function clampText(value: string, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
