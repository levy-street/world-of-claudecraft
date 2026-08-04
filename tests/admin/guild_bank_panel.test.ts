// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BANK = {
  guildId: 12,
  treasury: 12_345,
  capacity: 30,
  purchasedSlots: 30,
  usedSlots: 3,
  dormantSlots: 1,
  slots: [
    { index: 0, itemId: 'wolf_fang', count: 3, dormant: false },
    { index: 1, itemId: 'reins_grag_bear', count: 1, dormant: true },
    { index: 2, itemId: 'iron_sword', count: 1, dormant: false },
  ],
};

let bankResponse: unknown = BANK;

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async (path: string) => {
    if (path === '/admin/api/guilds/12/bank') {
      if (bankResponse instanceof Error) throw bankResponse;
      return bankResponse;
    }
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({ audited: true })),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { ApiError, apiGet, apiPost } from '../../src/admin/api';
import GuildBankPanel from '../../src/admin/components/GuildBankPanel.svelte';
import { t } from '../../src/admin/i18n';
import { grantPermissions } from './_grant';

/** Open the purge dialog on the one stuck row and fill it in. */
async function openConfirmedDialog(): Promise<HTMLElement> {
  await fireEvent.click(await screen.findByRole('button', { name: t('guilds.bankPurgeAction') }));
  const dialog = screen.getByRole('dialog', { name: t('guilds.bankPurgeTitle') });
  await fireEvent.input(within(dialog).getByLabelText(t('dialog.reason')), {
    target: { value: 'guild cannot disband' },
  });
  await fireEvent.click(within(dialog).getByLabelText(t('guilds.bankPurgeConfirmation')));
  return dialog;
}

describe('GuildBankPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bankResponse = BANK;
    grantPermissions();
  });

  it('shows the treasury, the slot budget, and every slot with its index', async () => {
    render(GuildBankPanel, { guildId: 12 });

    expect(await screen.findByText('reins_grag_bear')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/guilds/12/bank');
    // 12345 copper is 1g 23s 45c: the operator reads money, not a raw integer.
    expect(screen.getByText('1g 23s 45c')).toBeInTheDocument();
    expect(screen.getByText('3 of 30')).toBeInTheDocument();
    // Every slot is listed, dormant ones included: the whole point is that the
    // stuck slot is the one blocking disband, so it must never be hidden.
    expect(screen.getByText('wolf_fang')).toBeInTheDocument();
    expect(screen.getByText('iron_sword')).toBeInTheDocument();
  });

  it('marks the stuck slot distinct, and offers the action on it ALONE', async () => {
    render(GuildBankPanel, { guildId: 12 });

    const stuckRow = (await screen.findByText('reins_grag_bear')).closest('tr');
    if (!stuckRow) throw new Error('expected the stuck row');
    expect(stuckRow.className).toContain('dormant');
    expect(within(stuckRow).getByText(t('guilds.bankStatusStuck'))).toBeInTheDocument();
    expect(
      within(stuckRow).getByRole('button', { name: t('guilds.bankPurgeAction') }),
    ).toBeInTheDocument();

    const ordinaryRow = screen.getByText('wolf_fang').closest('tr');
    if (!ordinaryRow) throw new Error('expected the ordinary row');
    expect(ordinaryRow.className).not.toContain('dormant');
    expect(within(ordinaryRow).getByText(t('guilds.bankStatusNormal'))).toBeInTheDocument();
    // Decisive: exactly one row in the whole table offers the destructive action.
    expect(screen.getAllByRole('button', { name: t('guilds.bankPurgeAction') })).toHaveLength(1);
  });

  it('requires the confirmation before it will submit, then sends slot + itemId + reason', async () => {
    render(GuildBankPanel, { guildId: 12 });
    await fireEvent.click(await screen.findByRole('button', { name: t('guilds.bankPurgeAction') }));

    const dialog = screen.getByRole('dialog', { name: t('guilds.bankPurgeTitle') });
    // The slot and its item are SHOWN, never typed: the itemId is the server's
    // stale-listing guard and only means something if it came from this read.
    expect(within(dialog).getByText('reins_grag_bear')).toBeInTheDocument();
    expect(within(dialog).getByText(t('guilds.bankPurgeWarning'))).toBeInTheDocument();
    // The carrier consequence is stated BEFORE confirming: the save rides an
    // online guild member, and a refused save disconnects them.
    expect(within(dialog).getByText(t('guilds.bankPurgeCarrierWarning'))).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: t('guilds.bankPurgeConfirm') });
    expect(submit).toBeDisabled();

    await fireEvent.input(within(dialog).getByLabelText(t('dialog.reason')), {
      target: { value: 'guild cannot disband' },
    });
    expect(submit).toBeDisabled(); // reason alone is not confirmation
    await fireEvent.click(within(dialog).getByLabelText(t('guilds.bankPurgeConfirmation')));
    await fireEvent.click(submit);

    await vi.waitFor(() =>
      expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/admin/api/guilds/12/bank/purge-slot', {
        slot: 1,
        itemId: 'reins_grag_bear',
        reason: 'guild cannot disband',
      }),
    );
    // A landed purge closes the dialog and re-reads the book (the indices shift).
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: t('guilds.bankPurgeTitle') })).toBeNull(),
    );
    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2);
  });

  it('renders the REAL refusal for each failure mode and refetches the listing', async () => {
    // Every one of these is a distinct operator instruction: retry later, get a
    // member online, your listing was stale, or stop (the guild is going away).
    // A generic "failed" would tell an operator none of it.
    const cases: [number, string, string][] = [
      [400, 'that slot is not a stuck item', t('error.guildBankSlotNotStuck')],
      [
        409,
        'no member of that guild is online to persist the change',
        t('error.guildBankNoCarrier'),
      ],
      [409, 'that guild is being deleted, so its bank is closed', t('error.guildBankDeleting')],
      [503, 'the change could not be saved and was rolled back', t('error.guildBankSaveFailed')],
      [404, 'that guild has no loaded bank', t('error.guildBankNotLoaded')],
    ];
    for (const [status, prose, localized] of cases) {
      vi.clearAllMocks();
      vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(status, prose));
      const view = render(GuildBankPanel, { guildId: 12 });
      const dialog = await openConfirmedDialog();
      await fireEvent.click(
        within(dialog).getByRole('button', { name: t('guilds.bankPurgeConfirm') }),
      );

      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent, prose).toBe(localized);
      // Not the English prose: an operator on a non-English dashboard must not
      // see the server's wire string.
      expect(alert.textContent, prose).not.toBe(prose);
      // The dialog stays open on a refusal (nothing was destroyed), and the
      // listing is re-read because a refusal usually means it moved.
      expect(screen.getByRole('dialog', { name: t('guilds.bankPurgeTitle') })).toBeInTheDocument();
      await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2));
      view.unmount();
    }
  });

  it('says so when the item was removed but its moderation row was not written', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ audited: false });
    render(GuildBankPanel, { guildId: 12 });
    const dialog = await openConfirmedDialog();
    await fireEvent.click(
      within(dialog).getByRole('button', { name: t('guilds.bankPurgeConfirm') }),
    );

    expect(await screen.findByText(t('guilds.bankPurgeUnaudited'))).toBeInTheDocument();
  });

  it('hides the action from an operator without guildbank.purge, and still shows the diagnosis', async () => {
    // The deliberate split: a moderator can SEE that a bank is stuck (which is
    // what the ticket needs) without holding the superadmin-only hatch.
    grantPermissions(['moderation.read']);
    render(GuildBankPanel, { guildId: 12 });

    expect(await screen.findByText('reins_grag_bear')).toBeInTheDocument();
    expect(screen.getByText(t('guilds.bankStatusStuck'))).toBeInTheDocument();
    expect(screen.getByText(t('guilds.bankStuckExplainer'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('guilds.bankPurgeAction') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(t('detail.colActions'))).not.toBeInTheDocument();
  });

  it('renders the load failure, an empty book, and an unopened one distinctly', async () => {
    bankResponse = new ApiError(404, 'that guild has no loaded bank');
    const failedView = render(GuildBankPanel, { guildId: 12 });
    expect(await screen.findByText(t('guilds.bankLoadFailed'))).toBeInTheDocument();
    failedView.unmount();

    bankResponse = { ...BANK, usedSlots: 0, dormantSlots: 0, slots: [] };
    const emptyView = render(GuildBankPanel, { guildId: 12 });
    expect(await screen.findByText(t('guilds.bankEmpty'))).toBeInTheDocument();
    // No stuck slots means no scary explainer.
    expect(screen.queryByText(t('guilds.bankStuckExplainer'))).not.toBeInTheDocument();
    emptyView.unmount();

    bankResponse = { ...BANK, capacity: 0, purchasedSlots: 0, usedSlots: 0, slots: [] };
    render(GuildBankPanel, { guildId: 12 });
    expect(await screen.findByText(t('guilds.bankUnopened'))).toBeInTheDocument();
  });
});
