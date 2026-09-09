// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  harvestBodyEntryHtml,
  harvestJournalEntryHtml,
  wireHarvestEntries,
} from '../src/ui/hud/professions/professions_harvest_entry_controller';

describe('harvest entry controls', () => {
  it('opens the chosen destination without invoking the other entry', () => {
    const root = document.createElement('div');
    root.innerHTML = harvestBodyEntryHtml(true) + harvestJournalEntryHtml('farming', true);
    const harvestBody = vi.fn();
    const openHarvestJournal = vi.fn();
    wireHarvestEntries(root, { harvestBody, openHarvestJournal });
    root.querySelector<HTMLButtonElement>('[data-harvest-body]')!.click();
    expect(harvestBody).toHaveBeenCalledTimes(1);
    expect(openHarvestJournal).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-harvest-journal]')!.click();
    expect(openHarvestJournal).toHaveBeenCalledTimes(1);
    expect(harvestBody).toHaveBeenCalledTimes(1);
  });

  it('omits unavailable entries and offers the journal only on the farming row', () => {
    expect(harvestBodyEntryHtml(false)).toBe('');
    expect(harvestJournalEntryHtml('farming', false)).toBe('');
    expect(harvestJournalEntryHtml('mining', true)).toBe('');
  });
});
