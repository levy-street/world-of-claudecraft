import { describe, expect, it, vi } from 'vitest';
import { BANK_LEDGER_SAVE_HIGH_WATER_ROWS } from '../../server/bank_ledger_session';
import { dispatchBankStorageCommand } from '../../server/bank_storage_command';
import { dispatchBankCommand } from '../../server/bank_wire';
import { dispatchVaultCommand } from '../../server/vault_wire';

vi.mock('../../server/bank_wire', () => ({ dispatchBankCommand: vi.fn() }));
vi.mock('../../server/vault_wire', () => ({ dispatchVaultCommand: vi.fn() }));

describe('storage command admission and save orchestration', () => {
  it.each([
    'bank_deposit',
    'bank_withdraw',
    'bank_buy_slots',
    'bank_unlock_socket',
    'bank_socket_bag',
    'bank_unsocket_bag',
    'vault_deposit',
    'vault_withdraw',
    'vault_deposit_all',
    'vault_buy_upgrade',
  ] as const)(
    'preserves the owner and admission for %s and checks post-command usage',
    (command) => {
      vi.clearAllMocks();
      const usage = { queuedRows: 0, queuedEncodedBytes: 0 };
      const session = {
        pid: 17,
        characterId: 31,
        accountId: 9,
        bankVaultLedgerGuard: { admission: {} },
        bankLedgerJournal: { outbox: { usage } },
      } as unknown as Parameters<typeof dispatchBankStorageCommand>[1];
      const sim = {} as Parameters<typeof dispatchBankStorageCommand>[0];
      const msg = { slot: 2 };
      const save = vi.fn();
      const selected = command.startsWith('bank_') ? dispatchBankCommand : dispatchVaultCommand;
      const other = command.startsWith('bank_') ? dispatchVaultCommand : dispatchBankCommand;
      vi.mocked(selected).mockImplementationOnce(() => {
        usage.queuedRows = BANK_LEDGER_SAVE_HIGH_WATER_ROWS;
      });
      dispatchBankStorageCommand(sim, session, command, msg, save);
      expect(selected).toHaveBeenCalledWith(
        sim,
        session,
        command,
        msg,
        session.pid,
        session.bankVaultLedgerGuard.admission,
      );
      expect(other).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledOnce();
      usage.queuedRows = 0;
      save.mockClear();
      dispatchBankStorageCommand(sim, session, command, msg, save);
      expect(save).not.toHaveBeenCalled();
    },
  );
});
