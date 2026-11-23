import type { Pool } from 'pg';
import { discordFlairHiddenForAccount, setDiscordFlairHidden } from './discord_db';
import { acquireFlairCommand } from './flair_command_guard';

// The player-facing /flair command: a linked player shows or hides their
// Discord role flair (the colored name, the [Role] tag on their nameplate and
// inspect card, and the verified chat tag) for every other player.
//
//   /flair       reports whether the role is currently shown
//   /flair on    shows it (the default for every linked account)
//   /flair off   hides it
//
// Hiding is applied at the ONE read every surface derives from:
// discordFlairForAccount (server/discord_db.ts) returns no role for a hidden
// account, so the entity stamp, the nameplate, the inspect card and the chat
// stamp all follow without checks of their own. The preference lives on the
// Discord link row, so it survives logout and resets only on unlink.
//
// The parser lives here rather than as `case` labels in game.ts's dispatch
// because tests/command_schema.test.ts scrapes those labels as wire commands
// (the reason server/chat_filter_commands.ts exists too).

export type FlairCommand =
  | { kind: 'status' }
  | { kind: 'set'; hidden: boolean }
  | { kind: 'usage' };

/** The exact English the client re-localizes (the flair.* rows in src/ui/server_i18n.ts). */
export const FLAIR_NOTICES = {
  shown: 'Your Discord role is shown to other players. Type /flair off to hide it.',
  hidden: 'Your Discord role is hidden from other players. Type /flair on to show it.',
  notLinked: 'Link your Discord account to use /flair.',
  usage: 'Usage: /flair, /flair on, or /flair off.',
} as const;

/** Parse a chat line as /flair, or null when it is not one. Any other argument is a usage error. */
export function parseFlairCommand(text: string): FlairCommand | null {
  const match = /^\/flair(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const arg = (match[1] ?? '').trim().toLowerCase();
  if (arg === '') return { kind: 'status' };
  if (arg === 'on') return { kind: 'set', hidden: false };
  if (arg === 'off') return { kind: 'set', hidden: true };
  return { kind: 'usage' };
}

/** What the command needs from GameServer, so it never reaches into the coordinator. */
export interface FlairCommandHost<S extends { accountId: number }> {
  pool: Pool;
  /** Draw the command lane; false when the sender is throttled. */
  consumeCommandLane(session: S, nowSec: number): boolean;
  /** Re-read and re-stamp the sender's Discord flair so nearby players see the change now. */
  refreshDiscordFlair(session: S): Promise<void>;
  sendChatNotice(session: S, text: string): void;
}

function noticeFor(hidden: boolean | null): string {
  if (hidden === null) return FLAIR_NOTICES.notLinked;
  return hidden ? FLAIR_NOTICES.hidden : FLAIR_NOTICES.shown;
}

/** Run a parsed /flair command: read or write the preference, then tell the sender. */
export async function runFlairCommand<S extends { accountId: number }>(
  host: FlairCommandHost<S>,
  session: S,
  cmd: FlairCommand,
): Promise<void> {
  if (cmd.kind === 'usage') {
    host.sendChatNotice(session, FLAIR_NOTICES.usage);
    return;
  }
  if (cmd.kind === 'status') {
    host.sendChatNotice(
      session,
      noticeFor(await discordFlairHiddenForAccount(host.pool, session.accountId)),
    );
    return;
  }
  const linked = await setDiscordFlairHidden(host.pool, session.accountId, cmd.hidden);
  if (linked) await host.refreshDiscordFlair(session);
  host.sendChatNotice(session, noticeFor(linked ? cmd.hidden : null));
}

/**
 * Claim a chat line as /flair. Returns false when it is not one, so the chat
 * dispatch carries on. A claimed line pays the command lane like /pvp and
 * /unstuck (it does a DB read or write), and is never broadcast as chat.
 */
export function handleFlairChatCommand<S extends { accountId: number }>(
  host: FlairCommandHost<S>,
  session: S,
  text: string,
  nowSec: number,
): boolean {
  const cmd = parseFlairCommand(text);
  if (!cmd) return false;
  if (!host.consumeCommandLane(session, nowSec)) return true;
  const release = acquireFlairCommand(host, session, nowSec);
  if (!release) return true;
  void runFlairCommand(host, session, cmd)
    .catch((err) => console.error('flair command failed:', err))
    .finally(release);
  return true;
}
