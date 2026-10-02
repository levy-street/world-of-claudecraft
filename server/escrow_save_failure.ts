// Which thrown character save counts as `escrow_save_failed` on the guild bank
// incident counter (moved out of GameServer.saveCharacter's catch, which keeps
// the reasons beside the call). A save that carried dirty guild books and threw
// is a FAILED escrow save, except the refusals that have their own handling and
// their own vocabulary, so an operator alerting on escrow_save_failed > 0 sees
// only real failures:
// - a book refusal (GuildBankEscrowRefused): server/guild_bank_escrow_refusal.ts
//   counts its retry and terminal arms;
// - a durable-ledger growth refusal (BankLedgerGrowthLimitExceeded): a capacity
//   ceiling with its own quarantine, not a failed write;
// - a housing mutation refusal (FreeholdMutationRefused): a hooked save its
//   Hearth or plot participant refused, rolled back whole and counted by the
//   housing trip (server/freehold_hearth_trip.ts).
import { BankLedgerGrowthLimitExceeded } from './bank_ledger_growth_budget';
import { FreeholdMutationRefused } from './freehold_mutation';
import { GuildBankEscrowRefused } from './guild_bank_state';

export function countsAsEscrowSaveFailure(error: unknown, carriesGuildBooks: boolean): boolean {
  return (
    carriesGuildBooks &&
    !(error instanceof GuildBankEscrowRefused) &&
    !(error instanceof BankLedgerGrowthLimitExceeded) &&
    !(error instanceof FreeholdMutationRefused)
  );
}
