import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The Ravenpost (in-game mail). Letters are world-scoped, keyed to a stable
// recipient identity, and carry optional coin + item attachments held in
// escrow until taken. mailInfo streams only while standing at a mailbox (the
// marketInfo pattern); mailUnread streams always and powers the HUD envelope.
// ---------------------------------------------------------------------------

export type MailKindView = 'player' | 'system' | 'npc';

export interface MailMessageView {
  id: number;
  senderName: string;
  kind: MailKindView;
  // Authored-letter id (system/NPC mail): the client localizes sender, subject
  // and body through it; player mail renders subject/body verbatim.
  letterId?: string;
  subject: string;
  body: string;
  copper: number; // attached coin still waiting in the letter
  items: InvSlot[]; // attached parcels still waiting in the letter
  read: boolean;
}

export interface MailInfo {
  messages: MailMessageView[]; // newest first, capped to one wire window
  totalCount: number; // all delivered letters in the box
  unread: number;
  postage: number; // copper cost per sent letter
  maxAttachments: number; // item stacks a letter can carry
  deliverySeconds: number; // the raven's flight time for player mail
}

export interface IWorldMail {
  // Non-null only while standing at a mailbox.
  mailInfo: MailInfo | null;
  // Delivered-and-unread count, always available (the HUD envelope indicator).
  mailUnread: number;
  mailSend(to: string, subject: string, body: string, copper: number, items: InvSlot[]): void;
  mailTake(mailId: number): void;
  mailDelete(mailId: number): void;
  mailMarkRead(mailId: number): void;
}
