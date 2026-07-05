// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import AntibotConfig from '../../src/admin/pages/AntibotConfig.svelte';

const catalog = {
  fields: [
    {
      id: 'gate.timeout',
      group: 'Gate',
      label: 'Timeout',
      type: 'number' as const,
      defaultValue: 1000,
      value: 1800,
      min: 100,
      max: 2000,
      unit: 'ms',
    },
    {
      id: 'enforcement.enabled',
      group: 'Enforcement',
      label: 'Active responses',
      type: 'boolean' as const,
      defaultValue: false,
      value: false,
    },
    {
      id: 'enforcement.tags',
      group: 'Enforcement',
      label: 'Example tags',
      type: 'multi_select' as const,
      defaultValue: ['alpha'],
      value: ['alpha'],
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    },
  ],
  updatedAt: '2026-07-04T08:00:00.000Z',
};

const history = {
  entries: [
    {
      id: 1,
      beforeData: {},
      afterData: { 'gate.timeout': 1800 },
      note: 'Tune after calibration',
      createdAt: '2026-07-04T08:00:00.000Z',
      adminAccountId: 7,
      adminUsername: 'admin',
    },
    {
      id: 0,
      beforeData: { 'gate.timeout': 1200 },
      afterData: {},
      note: 'Previous version',
      createdAt: '2026-07-03T08:00:00.000Z',
      adminAccountId: 8,
      adminUsername: 'previous-admin',
    },
  ],
};

function detailsFor(fieldLabel: string): HTMLDetailsElement {
  const fieldName = screen
    .getAllByText(fieldLabel)
    .find((element) => element.classList.contains('ac-field-name'));
  const details = fieldName?.closest('details');
  if (!(details instanceof HTMLDetailsElement)) throw new Error(`No details for ${fieldLabel}`);
  return details;
}

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) =>
    path.endsWith('/history') ? history : catalog,
  );
  mocks.apiPost.mockResolvedValue(catalog);
});

describe('AntibotConfig', () => {
  it('starts groups collapsed and shows live override counts in their titles', async () => {
    render(AntibotConfig);

    await screen.findAllByText('Timeout');
    const gate = detailsFor('Timeout');
    const enforcement = detailsFor('Active responses');
    expect(gate).not.toHaveAttribute('open');
    expect(enforcement).not.toHaveAttribute('open');
    expect(gate.querySelector('summary')).toHaveTextContent('Gate (1)');
    expect(enforcement.querySelector('summary')).toHaveTextContent('Enforcement');
    expect(gate.querySelector('.collapsible-caret')).not.toHaveClass('collapsible-caret-open');

    await fireEvent.click(gate.querySelector('summary') as HTMLElement);
    expect(gate).toHaveAttribute('open');
    await waitFor(() => {
      expect(gate.querySelector('.collapsible-caret')).toHaveClass('collapsible-caret-open');
    });
  });

  it('distinguishes saved overrides from dirty form state and renders units once', async () => {
    render(AntibotConfig);

    await screen.findAllByText('Timeout');
    const save = screen.getByRole('button', { name: t('antibot.save') });
    const resetAll = screen.getByRole('button', { name: t('antibot.resetAll') });
    const note = screen.getByLabelText(t('antibot.changeNoteLabel'));
    expect(save).toBeDisabled();
    expect(resetAll).toBeEnabled();
    expect(note.closest('.ac-change-note')).not.toHaveClass('ac-change-note-dirty');
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(screen.getByText('Default: 1000 ms')).toBeInTheDocument();

    await fireEvent.click(resetAll);
    expect(save).toBeEnabled();
    expect(save).toHaveClass('ac-save-dirty');
    expect(note.closest('.ac-change-note')).toHaveClass('ac-change-note-dirty');
    expect(detailsFor('Timeout').querySelector('summary')).toHaveTextContent('Gate');
  });

  it('highlights boolean and multi-select options whose state differs from the default', async () => {
    render(AntibotConfig);

    const offLabel = (await screen.findByText(t('antibot.valueOff'))).closest('label');
    const betaLabel = screen.getByText('Beta').closest('label');
    expect(offLabel).not.toHaveClass('ac-option-changed');
    expect(betaLabel).not.toHaveClass('ac-option-changed');

    await fireEvent.click(offLabel?.querySelector('input') as HTMLInputElement);
    await fireEvent.click(betaLabel?.querySelector('input') as HTMLInputElement);

    expect(screen.getByText(t('antibot.valueOn')).closest('label')).toHaveClass(
      'ac-option-changed',
    );
    expect(betaLabel).toHaveClass('ac-option-changed');
  });

  it('opens a collapsed group when one of its fields fails validation', async () => {
    render(AntibotConfig);

    const fieldNames = await screen.findAllByText('Timeout');
    const input = fieldNames
      .find((element) => element.classList.contains('ac-field-name'))
      ?.closest('.ac-field')
      ?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('Timeout input not found');
    await fireEvent.input(input, { target: { value: '3000' } });

    const gate = detailsFor('Timeout');
    expect(gate).not.toHaveAttribute('open');
    await fireEvent.click(screen.getByRole('button', { name: t('antibot.save') }));

    expect(gate).toHaveAttribute('open');
    expect(screen.getByText(t('antibot.invalidFields'))).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('submits an optional note and renders the audited configuration history', async () => {
    render(AntibotConfig);

    await screen.findAllByText('Timeout');
    const save = screen.getByRole('button', { name: t('antibot.save') });
    const resetAll = screen.getByRole('button', { name: t('antibot.resetAll') });
    const note = screen.getByLabelText(t('antibot.changeNoteLabel'));
    expect(note.closest('.ac-save-flow')).toContainElement(save);
    expect(note.closest('.ac-save-flow')).not.toContainElement(resetAll);
    expect(note.closest('.ac-toolbar')).toContainElement(resetAll);

    const historySummary = await screen.findByText('Changed by admin');
    await fireEvent.click(historySummary.closest('summary') as HTMLElement);
    expect(screen.getByText('Tune after calibration')).toBeInTheDocument();
    expect(screen.getAllByText('Default')).not.toHaveLength(0);

    await fireEvent.click(resetAll);
    await fireEvent.input(note, { target: { value: 'Return to defaults' } });
    await fireEvent.click(save);

    expect(mocks.apiPost).toHaveBeenCalledWith('/admin/api/antibot-config', {
      overrides: {},
      note: 'Return to defaults',
    });
    expect(note).toHaveValue('');
  });

  it('loads a historical version into the editor without applying it', async () => {
    render(AntibotConfig);

    await screen.findAllByText('Timeout');
    expect(screen.getByText(t('antibot.historyCurrent'))).toBeInTheDocument();

    const previousSummary = await screen.findByText('Changed by previous-admin');
    await fireEvent.click(previousSummary.closest('summary') as HTMLElement);
    await fireEvent.click(screen.getByRole('button', { name: t('antibot.historyLoadVersion') }));

    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(screen.getByText(t('antibot.historyLoaded'))).toBeInTheDocument();
    const save = screen.getByRole('button', { name: t('antibot.save') });
    const note = screen.getByLabelText(t('antibot.changeNoteLabel'));
    expect(save).toBeEnabled();
    expect(note.closest('label')).toHaveClass('ac-change-note-dirty');
    expect(detailsFor('Timeout')).toHaveAttribute('open');

    await fireEvent.input(note, { target: { value: 'Reviewing this version' } });
    expect(screen.queryByText(t('antibot.historyLoaded'))).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('antibot.restoreApplied') }));
    expect(save).toBeDisabled();
    expect(note).toHaveValue('');
    expect(note.closest('label')).not.toHaveClass('ac-change-note-dirty');
  });
});
