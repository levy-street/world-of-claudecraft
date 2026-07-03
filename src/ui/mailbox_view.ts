// Pure view-core for the Ravenpost mailbox window (DOM/Three/i18n-free).
// Maps the IWorld mail mirror plus the window's local state (tab, opened
// letter, staged attachments) to a render model the thin painter
// (mailbox_window.ts) draws. Registered in UI_PURE_CORES; unit-tested against
// both Sim- and ClientWorld-shaped inputs in tests/mailbox_view.test.ts.

import type { InvSlot } from '../sim/types';
import type { MailInfo, MailKindView } from '../world_api';

export type MailTab = 'inbox' | 'send';

export interface MailInboxRow {
  id: number;
  unread: boolean;
  hasAttachments: boolean;
  kind: MailKindView;
  // Authored letter id (system/NPC mail): the painter localizes sender,
  // subject and body through it; null for player mail (verbatim text).
  letterId: string | null;
  senderName: string;
  subject: string;
  copper: number;
  items: InvSlot[];
}

export interface MailInboxBody {
  rows: MailInboxRow[];
  totalCount: number;
  unread: number;
  // The letter open in the reading pane, resolved against the live rows so a
  // letter deleted under us closes the pane instead of showing stale text.
  opened: (MailInboxRow & { body: string }) | null;
}

export interface MailSendBody {
  postage: number;
  maxAttachments: number;
  deliverySeconds: number;
  attachments: InvSlot[];
  canAttachMore: boolean;
}

export type MailboxView =
  | { kind: 'no-data' }
  | { kind: 'inbox'; body: MailInboxBody }
  | { kind: 'send'; body: MailSendBody };

export function buildMailboxView(input: {
  info: MailInfo | null;
  tab: MailTab;
  openedId: number | null;
  attachments: InvSlot[];
}): MailboxView {
  const { info } = input;
  if (!info) return { kind: 'no-data' };
  if (input.tab === 'send') {
    return {
      kind: 'send',
      body: {
        postage: info.postage,
        maxAttachments: info.maxAttachments,
        deliverySeconds: info.deliverySeconds,
        attachments: input.attachments,
        canAttachMore: input.attachments.length < info.maxAttachments,
      },
    };
  }
  const rows: MailInboxRow[] = info.messages.map((m) => ({
    id: m.id,
    unread: !m.read,
    hasAttachments: m.copper > 0 || m.items.length > 0,
    kind: m.kind,
    letterId: m.letterId ?? null,
    senderName: m.senderName,
    subject: m.subject,
    copper: m.copper,
    items: m.items,
  }));
  const openedSource =
    input.openedId === null ? null : (info.messages.find((m) => m.id === input.openedId) ?? null);
  const openedRow =
    openedSource === null ? null : (rows.find((r) => r.id === openedSource.id) ?? null);
  return {
    kind: 'inbox',
    body: {
      rows,
      totalCount: info.totalCount,
      unread: info.unread,
      opened: openedRow && openedSource ? { ...openedRow, body: openedSource.body } : null,
    },
  };
}

// The full price of sending: the attached coin plus the flat postage.
export function mailSendCost(attachedCopper: number, postage: number): number {
  return Math.max(0, Math.floor(attachedCopper)) + postage;
}

// Client-side pre-check mirrored from the sim's authoritative validation, so
// the Send button can disable with a reason instead of round-tripping a
// guaranteed refusal. The sim re-validates everything regardless.
export type MailSendBlock = 'needRecipient' | 'cantAffordPostage' | null;

export function mailSendBlocked(form: {
  to: string;
  attachedCopper: number;
  postage: number;
  purse: number;
}): MailSendBlock {
  if (form.to.trim().length === 0) return 'needRecipient';
  if (form.purse < mailSendCost(form.attachedCopper, form.postage)) return 'cantAffordPostage';
  return null;
}

// The HUD envelope indicator: visible only while something unread waits.
export interface MailIndicatorView {
  visible: boolean;
  count: number;
}

export function mailIndicatorView(unread: number): MailIndicatorView {
  const count = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
  return { visible: count > 0, count };
}
