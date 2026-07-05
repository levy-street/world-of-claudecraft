// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../../src/admin/components/ConfirmDialog.svelte';
import { t } from '../../src/admin/i18n';

describe('ConfirmDialog', () => {
  it('renders the title, summary rows, and gates on the confirm button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(ConfirmDialog, {
      title: 'Ban account',
      rows: [{ label: 'Account', value: 'alice' }],
      danger: true,
      onConfirm,
      onCancel,
    });
    expect(screen.getByText('Ban account')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();

    await fireEvent.click(screen.getByText(t('dialog.confirm')));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(ConfirmDialog, { title: 'Ban', onConfirm, onCancel });
    await fireEvent.click(screen.getByText(t('dialog.cancel')));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
