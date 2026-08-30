// On-demand guild-bank activity-log delivery. The cached database read stays
// in guild_bank_log; this coordinator owns the initial refusal, the authority
// re-check after the await, and the explicit failure frame.

import type { GuildBankLogEntry } from '../src/world_api/guild_bank';
import { readGuildBankLog } from './guild_bank_log';

export type GuildBankLogFrame =
  | { readonly t: 'gbanklog'; readonly ok: false }
  | {
      readonly t: 'gbanklog';
      readonly ok: true;
      readonly entries: readonly GuildBankLogEntry[];
    };

export interface GuildBankLogDeliveryHost {
  readonly guildId: number | null;
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
  readGuildBankLog(guildId)
    .then((entries) => {
      if (!host.stillAuthorized(guildId)) {
        host.send({ t: 'gbanklog', ok: false });
        return;
      }
      host.send({ t: 'gbanklog', ok: true, entries });
    })
    .catch((error) => {
      host.recordReadFailure();
      host.logError(`guild bank log read failed for guild ${guildId}:`, error);
      host.send({ t: 'gbanklog', ok: false });
    });
}
