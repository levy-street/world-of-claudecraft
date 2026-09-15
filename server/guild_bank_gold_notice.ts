// The guild-wide NOTICE for a guild bank gold movement: one chat-log line,
// delivered to every online member of the guild the moment an officer deposits
// into or withdraws from the shared treasury.
//
// WHY IT EXISTS. The activity log (server/guild_bank_log.ts) is a PULL read: a
// member sees a withdrawal only if they later stand at a banker and open the
// Log tab. Gold is the one holding an officer can quietly walk away with, so
// the guild should hear about it when it happens, not discover it in an audit.
// This is the push half of the same trust mechanism the log provides.
//
// The text is English and is re-localized on every client through the server
// matcher (src/ui/server_i18n.ts, the `guild.bankGoldDeposited` /
// `guild.bankGoldWithdrawn` rules). Money is rendered in the compact English
// form the client's formatMoney uses ("5g 20s 3c") so the matcher can parse it
// back to copper and re-format it for the viewer's locale.
//
// Pure: the sentence builder and the money formatter take values and return
// strings; the fan-out takes a narrow transport port (the same three calls the
// social service's guild broadcast uses) so it is unit-tested without a
// database or a socket.

import type { GuildBankLedgerOp } from './bank_ledger';

/** The two ledger ops this notice speaks for. Item moves stay log-only: a
 *  stack of cloth is not the thing a guild worries about walking off. */
export type GuildBankGoldNoticeOp = Extract<GuildBankLedgerOp, 'deposit_gold' | 'withdraw_gold'>;

/** The guild-event green every other guild system line uses ("has joined the
 *  guild."), so the notice reads as guild news, not as an error or a loot roll. */
export const GUILD_BANK_GOLD_NOTICE_COLOR = '#40ff7f';

/** English compact money, the exact shape src/ui/i18n.ts formatMoney produces
 *  for the `en` locale: gold when present, silver whenever gold is present or
 *  silver is non-zero, copper when non-zero or when nothing else printed. */
export function formatGuildBankNoticeMoney(copper: number): string {
  const safe = Number.isFinite(copper) ? Math.max(0, Math.floor(copper)) : 0;
  const gold = Math.floor(safe / 10000);
  const silver = Math.floor((safe % 10000) / 100);
  const cop = safe % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  if (cop > 0 || parts.length === 0) parts.push(`${cop}c`);
  return parts.join(' ');
}

/** The sentence one guild member reads. `copper` is the positive magnitude
 *  moved; the op carries the direction. */
export function guildBankGoldNoticeText(
  op: GuildBankGoldNoticeOp,
  actorName: string,
  copper: number,
): string {
  const amount = formatGuildBankNoticeMoney(copper);
  return op === 'deposit_gold'
    ? `${actorName} deposited ${amount} into the guild bank.`
    : `${actorName} withdrew ${amount} from the guild bank.`;
}

/** The narrow transport the fan-out needs: who is in the guild, who is online,
 *  and how to hand a session a list of events. Mirrors SocialTransport
 *  (server/social.ts) so GameServer wires it with the same three closures. */
export interface GuildBankGoldNoticePort {
  guildMembers(guildId: number): Promise<readonly { readonly id: number }[]>;
  isOnline(characterId: number): boolean;
  deliver(
    characterId: number,
    events: readonly { type: 'log'; text: string; color?: string }[],
  ): void;
}

/**
 * Deliver the gold-movement line to every online member of the guild,
 * the actor included: their own line confirms the treasury took the action,
 * and one rule for everyone means no member can claim they were not told.
 *
 * Membership comes from the social read (cached per guild, TTL + bust on
 * roster change), so a guild working its bank does not cost a query per op.
 * A membership read failure is reported through `logError` and swallowed: the
 * ledger row and the log already carry the truth, and a missing chat line must
 * never fail the op it describes (which has already committed by the time this
 * runs).
 */
export async function broadcastGuildBankGoldNotice(
  port: GuildBankGoldNoticePort,
  guildId: number,
  op: GuildBankGoldNoticeOp,
  actorName: string,
  copper: number,
  logError: (message: string, error: unknown) => void,
): Promise<void> {
  let members: readonly { readonly id: number }[];
  try {
    members = await port.guildMembers(guildId);
  } catch (error) {
    logError(`guild bank gold notice: membership read failed for guild ${guildId}`, error);
    return;
  }
  const events = [
    {
      type: 'log' as const,
      text: guildBankGoldNoticeText(op, actorName, copper),
      color: GUILD_BANK_GOLD_NOTICE_COLOR,
    },
  ];
  for (const m of members) {
    if (port.isOnline(m.id)) port.deliver(m.id, events);
  }
}
