// The offline guild bank log answer, moved out of sim.ts under the monolith
// ratchet: a FROZEN empty ready view. Offline play never has a guild (guilds
// live in the server social DB) and there is no bank_ledger to read, so the log
// is empty rather than loading or refused. One shared frozen instance so the
// inert facet arm can never be mutated by a caller into a per-Sim divergence.

import type { GuildBankLogEntry, GuildBankLogView } from '../world_api';

export const OFFLINE_GUILD_BANK_LOG: GuildBankLogView = Object.freeze({
  state: 'ready' as const,
  kind: 'all' as const,
  entries: Object.freeze([]) as readonly GuildBankLogEntry[],
  more: false,
  olderPending: false,
});
