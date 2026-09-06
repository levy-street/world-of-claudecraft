// The guild bank COMMAND DISPATCH: the wire-shape checks for the five
// officer-plus book mutations (`guild_bank_deposit_gold`, `_withdraw_gold`,
// `_deposit`, `_withdraw`, `_buy_slots`), extracted from GameServer's message
// switch the way server/vault_wire.ts took the Materials Vault cases.
//
// Shape-only checks here (the bank_* idiom): the Sim owns every gameplay rule
// (banker proximity, officer-plus rank via the session membership stamp,
// quest-bind, treasury cap, table price, capacity). `slot` is a container
// index, `count` optional (omit = whole stack), `amount` copper. Every op runs
// through the host's runGuildBankOp (server/guild_bank_op_coordinator.ts): the
// before/after guildBankInfoFor diff is the ONE success signal, pre-reserving
// the bank_ledger rows (container='guild') and marking the book dirty. The
// later fenced save commits those rows atomically with the character and book;
// a refusal diffs empty and stages neither row nor mark.
//
// The guard token (`consume`) is drawn by the HOST before the shape check, once
// per message, malformed or not: a flooder pays for every frame it sends.

import type { GuildBankLedgerOp } from './bank_ledger';

export type GuildBankCommandName =
  | 'guild_bank_deposit_gold'
  | 'guild_bank_withdraw_gold'
  | 'guild_bank_deposit'
  | 'guild_bank_withdraw'
  | 'guild_bank_buy_slots';

export const GUILD_BANK_COMMANDS: readonly GuildBankCommandName[] = [
  'guild_bank_deposit_gold',
  'guild_bank_withdraw_gold',
  'guild_bank_deposit',
  'guild_bank_withdraw',
  'guild_bank_buy_slots',
];

/** The Sim reads and mutations the dispatch needs, by pid. */
export interface GuildBankWireSim {
  guildBankDepositGoldFor(pid: number, amount: number): void;
  guildBankWithdrawGoldFor(pid: number, amount: number): void;
  guildBankDepositFor(pid: number, slot: number, count?: number): void;
  guildBankWithdrawFor(pid: number, slot: number, count?: number): void;
  guildBankBuySlotsFor(pid: number): void;
}

export interface GuildBankWireHost {
  readonly sim: GuildBankWireSim;
  /** GameServer.runGuildBankOp bound to the acting session. */
  readonly run: (op: GuildBankLedgerOp, mutate: () => void) => void;
}

export function isGuildBankCommand(cmd: string): cmd is GuildBankCommandName {
  return (GUILD_BANK_COMMANDS as readonly string[]).includes(cmd);
}

/** Dispatch one guild bank mutation frame. A malformed frame (a missing or
 *  non-numeric `amount` / `slot`) is dropped silently, exactly as the inline
 *  cases did: the honest client never sends one. */
export function dispatchGuildBankCommand(
  host: GuildBankWireHost,
  cmd: GuildBankCommandName,
  msg: Record<string, unknown>,
  pid: number,
): void {
  const { sim } = host;
  switch (cmd) {
    case 'guild_bank_deposit_gold':
      if (typeof msg.amount === 'number') {
        const amount = msg.amount;
        host.run('deposit_gold', () => sim.guildBankDepositGoldFor(pid, amount));
      }
      break;
    case 'guild_bank_withdraw_gold':
      if (typeof msg.amount === 'number') {
        const amount = msg.amount;
        host.run('withdraw_gold', () => sim.guildBankWithdrawGoldFor(pid, amount));
      }
      break;
    case 'guild_bank_deposit':
      if (typeof msg.slot === 'number') {
        const slot = msg.slot;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        host.run('deposit', () => sim.guildBankDepositFor(pid, slot, count));
      }
      break;
    case 'guild_bank_withdraw':
      if (typeof msg.slot === 'number') {
        const slot = msg.slot;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        host.run('withdraw', () => sim.guildBankWithdrawFor(pid, slot, count));
      }
      break;
    case 'guild_bank_buy_slots':
      host.run('buy_slots', () => sim.guildBankBuySlotsFor(pid));
      break;
  }
}
