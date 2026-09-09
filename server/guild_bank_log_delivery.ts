// On-demand guild-bank transaction-history delivery. The cached database read
// stays in guild_bank_log; this coordinator owns the request decode, the
// initial refusal, the authority re-check after the await, and the explicit
// failure frame.
//
// The answer ECHOES the query (kind + cursor) it is answering. The client can
// switch filters or page while an answer is in flight, and an answer that
// lands under a different filter than the pane is showing must be dropped,
// not installed: the echo is what lets the client tell them apart.

import type { GuildBankLogEntry, GuildBankLogKind } from '../src/world_api/guild_bank';
import { type GuildBankLogQuery, parseGuildBankLogQuery, readGuildBankLog } from './guild_bank_log';

export type GuildBankLogFrame =
  | { readonly t: 'gbanklog'; readonly ok: false }
  | {
      readonly t: 'gbanklog';
      readonly ok: true;
      readonly kind: GuildBankLogKind;
      readonly before: number | null;
      readonly entries: readonly GuildBankLogEntry[];
      readonly more: boolean;
    };

export interface GuildBankLogDeliveryHost {
  readonly guildId: number | null;
  /** The raw command message; only its `kind` and `before` fields are read,
   *  and both are re-validated (parseGuildBankLogQuery). The guild is never
   *  taken from it. */
  readonly request: unknown;
  readonly stillAuthorized: (guildId: number) => boolean;
  readonly send: (frame: GuildBankLogFrame) => void;
  readonly recordReadFailure: () => void;
  readonly logError: (message: string, error: unknown) => void;
}

export function deliverGuildBankLog(host: GuildBankLogDeliveryHost): void {
  const guildId = host.guildId;
  if (guildId === null) {
    host.send({ t: 'gbanklog', ok: false });
    return;
  }
  const query: GuildBankLogQuery = parseGuildBankLogQuery(host.request);
  readGuildBankLog(guildId, query)
    .then((page) => {
      if (!host.stillAuthorized(guildId)) {
        host.send({ t: 'gbanklog', ok: false });
        return;
      }
      host.send({
        t: 'gbanklog',
        ok: true,
        kind: query.kind,
        before: query.before,
        entries: page.entries,
        more: page.more,
      });
    })
    .catch((error) => {
      host.recordReadFailure();
      host.logError(`guild bank log read failed for guild ${guildId}:`, error);
      host.send({ t: 'gbanklog', ok: false });
    });
}
