// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import GeneralChatRateLimitControls from '../../src/admin/components/GeneralChatRateLimitControls.svelte';
import { setAdminLanguage, t } from '../../src/admin/i18n';
import type { PendingAction } from '../../src/admin/moderation_actions';

describe('GeneralChatRateLimitControls', () => {
  it('shows the General-only unlimited state and cancels editing without saving', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: null },
        onSubmit,
      },
    });

    expect(screen.getByText(t('generalChatRateLimit.scope'))).toBeInTheDocument();
    expect(screen.getByText(t('generalChatRateLimit.unlimited'))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.edit') }));
    expect(screen.getByLabelText(t('generalChatRateLimit.messagesLabel'))).toHaveFocus();
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.cancel') }));

    expect(
      screen.queryByLabelText(t('generalChatRateLimit.messagesLabel')),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('generalChatRateLimit.edit') })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports localized field errors for non-positive integers and a missing reason', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: null },
        onSubmit,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.edit') }));
    const messages = screen.getByLabelText(t('generalChatRateLimit.messagesLabel'));
    const windowMinutes = screen.getByLabelText(t('generalChatRateLimit.windowMinutesLabel'));
    await fireEvent.input(messages, { target: { value: '0' } });
    await fireEvent.input(windowMinutes, { target: { value: '1.5' } });
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.save') }));

    expect(messages).toHaveAttribute('aria-invalid', 'true');
    expect(windowMinutes).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(t('generalChatRateLimit.messagesError', { min: '1', max: '1,000' })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t('generalChatRateLimit.windowMinutesError', { min: '1', max: '1,440' })),
    ).toBeInTheDocument();
    expect(screen.getByText(t('generalChatRateLimit.reasonRequired'))).toBeInTheDocument();
    expect(messages).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses locale-formatted numeric bounds in validation copy', async () => {
    setAdminLanguage('de_DE');
    render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: null },
        onSubmit: vi.fn(async () => true),
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.edit') }));
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.save') }));
    expect(screen.getByText(/1\.000/)).toBeInTheDocument();
    expect(screen.getByText(/1\.440/)).toBeInTheDocument();
    setAdminLanguage('en');
  });

  it('discards an edit draft when the same target is refetched with a new policy', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    const view = render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: { messages: 5, windowMinutes: 2 } },
        onSubmit,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.edit') }));
    await fireEvent.input(screen.getByLabelText(t('generalChatRateLimit.messagesLabel')), {
      target: { value: '99' },
    });

    await view.rerender({
      target: { id: 42, generalChatRateLimit: { messages: 8, windowMinutes: 3 } },
      onSubmit,
    });

    expect(
      screen.queryByLabelText(t('generalChatRateLimit.messagesLabel')),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(t('generalChatRateLimit.current', { messages: '8', minutes: '3' })),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edits and saves the current General chat limit', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: { messages: 5, windowMinutes: 2 } },
        onSubmit,
      },
    });

    expect(
      screen.getByText(t('generalChatRateLimit.current', { messages: 5, minutes: 2 })),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.edit') }));

    const messages = screen.getByLabelText(t('generalChatRateLimit.messagesLabel'));
    const windowMinutes = screen.getByLabelText(t('generalChatRateLimit.windowMinutesLabel'));
    expect(messages).toHaveValue(5);
    expect(windowMinutes).toHaveValue(2);
    await fireEvent.input(messages, { target: { value: '3' } });
    await fireEvent.input(windowMinutes, { target: { value: '4' } });
    await fireEvent.input(screen.getByLabelText(t('dialog.reason')), {
      target: { value: 'slow mode for raid spam' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.save') }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/admin/api/accounts/42/general-chat-rate-limit',
        body: {
          rateLimit: { messages: 3, windowMinutes: 4 },
          reason: 'slow mode for raid spam',
        },
      }),
    );
    expect(
      screen.queryByLabelText(t('generalChatRateLimit.messagesLabel')),
    ).not.toBeInTheDocument();
  });

  it('requires a reason and then removes the configured limit', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: { messages: 5, windowMinutes: 2 } },
        onSubmit,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.remove') }));
    expect(screen.getByLabelText(t('dialog.reason'))).toHaveFocus();
    await fireEvent.click(
      screen.getByRole('button', { name: t('generalChatRateLimit.confirmRemove') }),
    );
    expect(screen.getByText(t('generalChatRateLimit.reasonRequired'))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByLabelText(t('dialog.reason')), {
      target: { value: 'restriction expired' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: t('generalChatRateLimit.confirmRemove') }),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/admin/api/accounts/42/general-chat-rate-limit',
        body: { rateLimit: null, reason: 'restriction expired' },
      }),
    );
    expect(screen.queryByLabelText(t('dialog.reason'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('generalChatRateLimit.remove') })).toHaveFocus();
  });

  it('moves focus to Edit when an async successful removal refetches as Unlimited', async () => {
    const onSubmit = vi.fn(async (_pending: PendingAction) => true);
    const view = render(GeneralChatRateLimitControls, {
      props: {
        target: { id: 42, generalChatRateLimit: { messages: 5, windowMinutes: 2 } },
        onSubmit,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('generalChatRateLimit.remove') }));
    await fireEvent.input(screen.getByLabelText(t('dialog.reason')), {
      target: { value: 'restriction expired' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: t('generalChatRateLimit.confirmRemove') }),
    );
    expect(screen.getByRole('button', { name: t('generalChatRateLimit.remove') })).toHaveFocus();

    await view.rerender({
      target: { id: 42, generalChatRateLimit: null },
      onSubmit,
    });

    expect(screen.queryByRole('button', { name: t('generalChatRateLimit.remove') })).toBeNull();
    expect(screen.getByRole('button', { name: t('generalChatRateLimit.edit') })).toHaveFocus();
  });
});
