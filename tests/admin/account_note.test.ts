// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AccountNote from '../../src/admin/components/AccountNote.svelte';
import { t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';

describe('AccountNote', () => {
  it('submits a moderator note to the note endpoint and clears the field', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(AccountNote, { props: { accountId: 42, onSubmit } });

    const submit = screen.getByRole('button', { name: t('detail.addNote') });
    expect(submit).toBeDisabled();
    const field = screen.getByPlaceholderText(t('detail.addNotePlaceholder'));
    await fireEvent.input(field, { target: { value: 'spoke to player' } });
    expect(submit).not.toBeDisabled();
    await fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      endpoint: '/admin/api/moderation/accounts/42/note',
      body: { reason: 'spoke to player' },
    });
    expect((field as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the note text when submission fails', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => false);
    render(AccountNote, { props: { accountId: 7, onSubmit } });

    const field = screen.getByPlaceholderText(t('detail.addNotePlaceholder'));
    await fireEvent.input(field, { target: { value: 'context worth keeping' } });
    await fireEvent.click(screen.getByRole('button', { name: t('detail.addNote') }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect((field as HTMLTextAreaElement).value).toBe('context worth keeping');
  });
});
