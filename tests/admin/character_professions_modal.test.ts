// @vitest-environment jsdom
// jsdom exception (the docs/local-gate-perf/baselines.md exception-list
// class): under happy-dom the restore-slot flow deterministically fails with
// ECONNREFUSED dials to localhost:3000, under jsdom it passes. The exact
// escape path is unconfirmed (this suite mocks src/admin/api, the only fetch
// caller in the modal's import graph), so the observed red, not a mechanism
// claim, is the reason this file stays on jsdom.
import './_setup';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterProfessionsModal from '../../src/admin/components/CharacterProfessionsModal.svelte';
import { fmtNumber } from '../../src/admin/format';
import { DICT, t } from '../../src/admin/i18n';
import { RESTORE_ITEM_MAX_COUNT } from '../../src/admin/professions_restore';
import type { CharacterProfessionsSheet } from '../../src/admin/types';
import { grantPermissions } from './_grant';

const sheet: CharacterProfessionsSheet = {
  characterId: 7,
  name: 'Merlin',
  class: 'mage',
  level: 42,
  accountId: 1,
  username: 'alice',
  live: false,
  updatedAt: '2026-06-01T00:00:00Z',
  preMigration: false,
  archetype: { activeArchetype: 'alchemy', pairedMajor: 'engineering', hobbyCraft: 'cooking' },
  gathering: [
    { professionId: 'mining', proficiency: 42.5 },
    { professionId: 'logging', proficiency: 0 },
    { professionId: 'herbalism', proficiency: 0 },
    { professionId: 'fishing', proficiency: 7 },
  ],
  crafting: [{ craftId: 'alchemy', skill: 30, tier: 1 }],
  knownRecipes: 2,
  slots: [
    {
      professionId: 'mining',
      effectId: 'gatherers_cache',
      durability: 3,
      maxDurability: 16,
      craftedBy: 'Mira',
      confirmMode: 'always',
    },
  ],
  nodeTimers: [
    { nodeId: 'ore_eastbrook_1', zoneId: 'eastbrook_vale', nodeType: 'ore', remainingSeconds: 120 },
  ],
  toolEffectIds: ['gatherers_cache', 'artisans_eye', 'quickening_charm'],
};

let activeSheet: CharacterProfessionsSheet = sheet;
const apiGet = vi.fn(async (path: string) => {
  // Any character id, so a modal re-pointed at another character is servable.
  if (/^\/admin\/api\/characters\/\d+\/professions$/.test(path)) return activeSheet;
  throw new Error(`unexpected path ${path}`);
});
const apiPost = vi.fn(async (_path: string, _body: unknown) => ({}));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (path: string) => apiGet(path),
  apiPost: (path: string, body: unknown) => apiPost(path, body),
  getToken: () => 'tok',
  getAdminName: () => 'alice',
  clearSession: () => {},
}));

// window.alert is the modal's whole error surface (validation refusals and the
// failed-POST path), so it is captured rather than left to jsdom's stub.
const alerts = vi.fn<(message?: string) => void>();

describe('CharacterProfessionsModal', () => {
  beforeEach(() => {
    activeSheet = sheet;
    apiGet.mockClear();
    apiPost.mockClear();
    apiPost.mockImplementation(async () => ({}));
    alerts.mockClear();
    window.alert = alerts;
  });

  // Fills the item-restore form and clicks Restore item.
  async function openItemPrompt(itemId: string, count?: string): Promise<void> {
    await fireEvent.input(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder')), {
      target: { value: itemId },
    });
    if (count !== undefined) {
      await fireEvent.input(screen.getByRole('spinbutton'), { target: { value: count } });
    }
    await fireEvent.click(screen.getByRole('button', { name: t('profInspect.restoreItemButton') }));
  }

  async function confirmPrompt(reason: string): Promise<void> {
    await fireEvent.input(screen.getByPlaceholderText(t('detail.notePlaceholder')), {
      target: { value: reason },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));
  }

  it('renders proficiencies, slots, and node timers from the sheet', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    expect((await screen.findAllByText('mining')).length).toBeGreaterThan(0);
    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getAllByText('gatherers_cache').length).toBeGreaterThan(0);
    expect(screen.getByText('Mira')).toBeInTheDocument();
    expect(screen.getByText('ore_eastbrook_1')).toBeInTheDocument();
    // The blob clock is surfaced (this sheet is not live).
    expect(screen.queryByText(t('profInspect.liveBadge'))).not.toBeInTheDocument();
    // A migrated (post-flag) blob shows no rewrite warning.
    expect(screen.queryByText(t('profInspect.preMigrationNote'))).not.toBeInTheDocument();
  });

  it('shows the live badge for a live snapshot (the positive arm)', async () => {
    grantPermissions();
    activeSheet = { ...sheet, live: true, updatedAt: null };
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(screen.getByText(t('profInspect.liveBadge'))).toBeInTheDocument();
  });

  it('warns on a pre-migration blob whose values the next login rewrites', async () => {
    grantPermissions();
    activeSheet = { ...sheet, preMigration: true };
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(screen.getByText(t('profInspect.preMigrationNote'))).toBeInTheDocument();
  });

  it('drives the restore-slot flow through the confirm prompt to the endpoint', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    // Pick profession + effect, open the prompt, give the reason, confirm.
    const selects = screen.getAllByRole('combobox');
    await fireEvent.change(selects[0], { target: { value: 'mining' } });
    await fireEvent.change(selects[1], { target: { value: 'gatherers_cache' } });
    await fireEvent.click(screen.getByRole('button', { name: t('profInspect.restoreSlotButton') }));
    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'row vanished' } });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/moderation/characters/7/restore-slot', {
      professionId: 'mining',
      effectId: 'gatherers_cache',
      reason: 'row vanished',
    });
  });

  it('drives the restore-item flow to the endpoint with the typed id and count', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    const itemInput = screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder'));
    await fireEvent.input(itemInput, { target: { value: 'wolf_fang' } });
    await fireEvent.click(screen.getByRole('button', { name: t('profInspect.restoreItemButton') }));
    const reason = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(reason, { target: { value: 'lost to a bug' } });
    await fireEvent.click(screen.getByRole('button', { name: t('dialog.confirm') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/moderation/characters/7/restore-item', {
      itemId: 'wolf_fang',
      count: 1,
      reason: 'lost to a bug',
    });
  });

  it('hides the GM restore section without the moderation.act permission', async () => {
    grantPermissions(['accounts.read']);
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(screen.queryByText(t('profInspect.restoreHeader'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('profInspect.restoreItemButton') }),
    ).not.toBeInTheDocument();
  });

  it('gives a read-only operator a visible close button that exits the modal', async () => {
    // accounts.read without moderation.act renders no action buttons at all, so
    // the header X is that operator's only way out besides Escape.
    grantPermissions(['accounts.read']);
    let closed = 0;
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => (closed += 1) },
    });
    await screen.findByText('ore_eastbrook_1');
    const buttons = screen.getAllByRole('button', { name: t('profInspect.close') });
    // The backdrop carries the same label; the header X is the one inside the
    // dialog, and it is what the modal auto-focuses.
    const close = buttons.find((el) => el.hasAttribute('data-modal-focus'));
    expect(close, 'header close button with data-modal-focus').toBeDefined();
    await fireEvent.click(close as HTMLElement);
    expect(closed).toBe(1);
  });

  it('localizes the node-timer zone through the id-keyed label, not the raw id', async () => {
    // The sheet sends a snake_case content id; the display-name-keyed zoneLabel
    // fell straight through it, so this fails if that helper comes back.
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(screen.getByText(t('zone.eastbrook_vale'))).toBeInTheDocument();
    expect(screen.queryByText('eastbrook_vale')).not.toBeInTheDocument();
  });

  it('renders the slot fire mode as operator copy, not the raw sim enum', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(screen.getByText(t('profInspect.fireModeAlways'))).toBeInTheDocument();
    expect(screen.queryByText('always')).not.toBeInTheDocument();
  });

  it('labels the empty profession and effect options instead of shipping blanks', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    const [profession, effect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(profession.options[0].value).toBe('');
    expect(profession.options[0].textContent).toBe(t('profInspect.professionOptionNone'));
    expect(effect.options[0].value).toBe('');
    expect(effect.options[0].textContent).toBe(t('profInspect.effectOptionNone'));
  });

  it('joins a paired major through the catalog joiner, not a hardcoded separator', async () => {
    grantPermissions();
    const table = DICT.en as Record<string, string>;
    const original = table['profInspect.archetypePair'];
    // Re-point the catalog value for this render: a separator still hardcoded
    // in the component would keep printing " + " and fail here.
    table['profInspect.archetypePair'] = '{first} and {second}';
    try {
      const { container } = render(CharacterProfessionsModal, {
        props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
      });
      await screen.findByText('ore_eastbrook_1');
      expect(container.textContent).toContain('Majors: alchemy and engineering; hobby: cooking');
    } finally {
      table['profInspect.archetypePair'] = original;
    }
  });

  it('renders the single-major form for a legacy save with no paired major', async () => {
    // The blob shape this inspector exists to read: no dangling separator.
    grantPermissions();
    activeSheet = {
      ...sheet,
      archetype: { activeArchetype: 'alchemy', pairedMajor: null, hobbyCraft: 'cooking' },
    };
    const { container } = render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(container.textContent).toContain('Majors: alchemy; hobby: cooking');
    expect(container.textContent).not.toContain('alchemy +');
  });

  it('renders the confirm summary from the catalog and clamps the count input', async () => {
    grantPermissions();
    const table = DICT.en as Record<string, string>;
    const original = table['profInspect.restoreSummary'];
    // Re-point the catalog value: a hardcoded "x" in either the builder or the
    // component would keep printing the old shape and fail here.
    table['profInspect.restoreSummary'] = '{count} of {id}';
    try {
      render(CharacterProfessionsModal, {
        props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
      });
      await screen.findByText('ore_eastbrook_1');
      // The input clamp is the shared constant, so it cannot drift from the
      // validator and the server.
      expect(screen.getByRole('spinbutton')).toHaveAttribute('max', String(RESTORE_ITEM_MAX_COUNT));
      await openItemPrompt('wolf_fang', '3');
      expect(screen.getByText('3 of wolf_fang')).toBeInTheDocument();
    } finally {
      table['profInspect.restoreSummary'] = original;
    }
  });

  it('refuses an out-of-range count BEFORE the confirm prompt opens', async () => {
    // The prompt must never show a request the builder would then refuse, so
    // this fails if the button stops going through openItemPrompt.
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    await openItemPrompt('wolf_fang', '99');
    expect(screen.queryByRole('button', { name: t('dialog.confirm') })).not.toBeInTheDocument();
    expect(alerts).toHaveBeenCalledWith(
      t('alert.restoreCountRange', { max: fmtNumber(RESTORE_ITEM_MAX_COUNT) }),
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('freezes the restore inputs while the confirm prompt is open', async () => {
    // The summary in the prompt has to still describe the request that is sent.
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    await openItemPrompt('wolf_fang');
    expect(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder'))).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    // The frozen summary is the one the operator is confirming.
    expect(screen.getByText('wolf_fang x1')).toBeInTheDocument();
  });

  it('surfaces the localized server error when the restore POST fails', async () => {
    grantPermissions();
    const serverProse = 'character is not online on this realm';
    apiPost.mockRejectedValueOnce(new Error(serverProse));
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    await openItemPrompt('wolf_fang');
    await confirmPrompt('lost to a bug');
    // The catalog value differs from the wire prose, so surfacing the raw
    // server string instead of the localized one fails here.
    expect(t('error.characterNotOnline')).not.toBe(serverProse);
    await waitFor(() => expect(alerts).toHaveBeenCalledWith(t('error.characterNotOnline')));
    // A failed restore keeps the operator's input so it can be retried.
    expect(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder'))).toHaveValue(
      'wolf_fang',
    );
  });

  it('refetches and clears the form when it is re-pointed at another character', async () => {
    // The sheet and a half-filled restore must never survive the swap: they
    // would describe the previous character.
    grantPermissions();
    const { rerender } = render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    await fireEvent.input(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder')), {
      target: { value: 'wolf_fang' },
    });
    await rerender({ characterId: 8, characterName: 'Alaric', onClose: () => {} });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/admin/api/characters/8/professions'));
    await screen.findByText('ore_eastbrook_1');
    expect(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder'))).toHaveValue('');
  });

  it('refetches the sheet and clears the form after a confirmed restore', async () => {
    grantPermissions();
    render(CharacterProfessionsModal, {
      props: { characterId: 7, characterName: 'Merlin', onClose: () => {} },
    });
    await screen.findByText('ore_eastbrook_1');
    expect(apiGet).toHaveBeenCalledTimes(1);
    await openItemPrompt('wolf_fang', '3');
    await confirmPrompt('lost to a bug');
    // The sheet is re-read, so the operator sees the restored state.
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    // ... and the fields are empty, so a second click cannot silently re-mint
    // the same restore.
    expect(screen.queryByRole('button', { name: t('dialog.confirm') })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(t('profInspect.itemIdPlaceholder'))).toHaveValue('');
    expect(screen.getByRole('spinbutton')).toHaveValue(1);
  });
});
