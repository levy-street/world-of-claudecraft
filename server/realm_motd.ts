// The realm message of the day: one admin-authored line every player sees in
// chat when they enter the world, pushed to everyone online the moment an admin
// sets it. `/motd` rides the staff chat-command family (moderation_commands.ts
// parses it, ModerationService gates it on the 'realm.motd' permission); this
// module owns the live value, its persistence, and the fan-out. The server emits
// stable English and the client re-localizes every line in
// src/ui/system_text_i18n.ts (the admin's message itself is spliced verbatim).

import { logger } from './http/logger';

export const REALM_MOTD_MAX = 240;

const LINE_COLOR = '#ffd100';

export type RealmMotdCommand =
  | { op: 'show' }
  | { op: 'clear' }
  | { op: 'set'; text: string }
  | { op: 'usage' }
  | { op: 'tooLong' };

export const REALM_MOTD_NOTICES = {
  updated: 'Message of the day updated.',
  cleared: 'Message of the day cleared.',
  none: 'No message of the day is set.',
  usage: 'Usage: /motd "<message>" to set it, /motd clear to remove it.',
  tooLong: `The message of the day is limited to ${REALM_MOTD_MAX} characters.`,
  saveFailed: 'The message of the day could not be saved and will not survive a restart.',
} as const;

export function realmMotdLine(text: string): string {
  return `Message of the day: ${text}`;
}

// Control characters and runs of whitespace (a pasted newline included) fold to
// one space, so the message renders as a single chat line; invisible format
// characters (bidi overrides, zero-width marks) are dropped so the line cannot
// display reordered or spoofed text.
export function cleanRealmMotdText(raw: string): string {
  return raw
    .replace(/\p{Cf}+/gu, '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The text after "/motd": nothing shows the current message, a bare `clear`
// removes it, and anything else is the new message, either wrapped in one pair
// of double quotes (`/motd "Welcome!"`) or bare (`/motd Welcome!`). A quoted
// `"clear"` is a message, not the clear command.
export function parseRealmMotdArguments(rest: string): RealmMotdCommand {
  const trimmed = rest.trim();
  if (!trimmed) return { op: 'show' };
  if (/^clear$/i.test(trimmed)) return { op: 'clear' };
  const quoted = /^"([^"]*)"$/.exec(trimmed);
  const text = cleanRealmMotdText(quoted ? quoted[1] : trimmed);
  if (!text) return { op: 'usage' };
  if (text.length > REALM_MOTD_MAX) return { op: 'tooLong' };
  return { op: 'set', text };
}

export interface RealmMotdStore {
  load(): Promise<string | null>;
  save(text: string | null, setByAccountId: number): Promise<void>;
}

export interface RealmMotdSession {
  accountId: number;
}

export interface RealmMotdHost<TSession> {
  sessions(): Iterable<TSession>;
  sendRaw(session: TSession, payload: string): void;
}

function logPayload(text: string): string {
  return JSON.stringify({ t: 'events', list: [{ type: 'log', text, color: LINE_COLOR }] });
}

export class RealmMotd<TSession extends RealmMotdSession> {
  private text: string | null = null;
  // The login greeting, serialized once per change rather than once per join.
  private greeting: string | null = null;
  // An admin edit that lands before the boot load resolves wins over the
  // stored value the load brings back.
  private changedSinceBoot = false;
  // Saves run one after another so the stored row always ends on the last
  // command issued, even when two edits are in flight at once.
  private saves: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: RealmMotdHost<TSession>,
    private readonly store: RealmMotdStore,
  ) {}

  get current(): string | null {
    return this.text;
  }

  async load(): Promise<void> {
    try {
      const stored = await this.store.load();
      if (!this.changedSinceBoot) this.setText(stored);
    } catch (err) {
      logger.error({ err }, 'failed to load the realm message of the day');
    }
  }

  greet(session: TSession): void {
    if (this.greeting !== null) this.host.sendRaw(session, this.greeting);
  }

  handle(actor: TSession, command: RealmMotdCommand): void {
    switch (command.op) {
      case 'show':
        this.notice(actor, this.text === null ? REALM_MOTD_NOTICES.none : realmMotdLine(this.text));
        return;
      case 'usage':
        this.notice(actor, REALM_MOTD_NOTICES.usage);
        return;
      case 'tooLong':
        this.notice(actor, REALM_MOTD_NOTICES.tooLong);
        return;
      case 'set': {
        this.change(actor, command.text);
        for (const session of this.host.sessions()) this.greet(session);
        this.notice(actor, REALM_MOTD_NOTICES.updated);
        return;
      }
      case 'clear':
        this.change(actor, null);
        this.notice(actor, REALM_MOTD_NOTICES.cleared);
        return;
    }
  }

  private setText(text: string | null): void {
    this.text = text;
    this.greeting = text === null ? null : logPayload(realmMotdLine(text));
  }

  private change(actor: TSession, text: string | null): void {
    this.setText(text);
    this.changedSinceBoot = true;
    logger.info(
      { adminAccountId: actor.accountId, cleared: text === null },
      'realm message of the day changed',
    );
    this.saves = this.saves
      .then(() => this.store.save(text, actor.accountId))
      .catch((err) => {
        logger.error({ err }, 'failed to save the realm message of the day');
        this.notice(actor, REALM_MOTD_NOTICES.saveFailed);
      });
  }

  private notice(actor: TSession, text: string): void {
    this.host.sendRaw(actor, logPayload(text));
  }
}
