// The locale probe that keeps mounted appearance customizers in the player's
// language, and specifically its SUBTLE half: the probe compares RESOLVED
// TEXT, never the language id. The language id is already the player's choice
// at boot; what arrives late is the table behind it, so an id-based probe reads
// "nothing changed" while every label on screen is still English. That is the
// exact bug the module exists for, and this file is its only direct pin.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A controllable i18n: the language id and the resolved table move
// independently, which is the whole point under test.
const i18n = vi.hoisted(() => ({
  language: 'fr_FR',
  table: {} as Record<string, string>,
}));
vi.mock('../src/ui/i18n', () => ({
  getLanguage: () => i18n.language,
  t: (key: string) => i18n.table[key] ?? key,
}));

import {
  appearancePanelIsStale,
  noteAppearancePanelMounted,
  relocalizeAppearancePanels,
  resetAppearancePanelsForTests,
} from '../src/ui/appearance_panel_locale';

beforeEach(() => {
  resetAppearancePanelsForTests();
  i18n.language = 'fr_FR';
  i18n.table = {};
});

describe('appearance panel locale probe', () => {
  it('reads a freshly mounted panel as current, an unknown one as stale', () => {
    noteAppearancePanelMounted('#p', () => {});
    expect(appearancePanelIsStale('#p')).toBe(false);
    expect(appearancePanelIsStale('#never-mounted')).toBe(true);
  });

  it('goes stale when the TABLE resolves differently under an unchanged language', () => {
    // The boot race: the panel mounts before the lazy locale chunk lands, so
    // its labels baked as raw keys. The language id never moves.
    noteAppearancePanelMounted('#p', () => {});
    i18n.table = { 'auth.appearance': 'Apparence', 'auth.earrings': 'Piercings' };
    expect(i18n.language).toBe('fr_FR'); // unchanged, and the probe must not care
    expect(appearancePanelIsStale('#p')).toBe(true);
  });

  it('rebuilds exactly the stale panels, and a rebuild makes them current', () => {
    const rebuilt: string[] = [];
    noteAppearancePanelMounted('#stale', () => {
      rebuilt.push('#stale');
      // A real rebuild re-mounts against the NOW-resolved table.
      noteAppearancePanelMounted('#stale', () => rebuilt.push('#stale'));
    });
    i18n.table = { 'auth.appearance': 'Apparence' };
    noteAppearancePanelMounted('#fresh', () => rebuilt.push('#fresh'));

    relocalizeAppearancePanels();
    expect(rebuilt).toEqual(['#stale']); // the fresh panel never paid a rebuild
    expect(appearancePanelIsStale('#stale')).toBe(false);
  });

  it('a language switch is also caught (the text changes with it)', () => {
    i18n.table = { 'auth.appearance': 'Apparence' };
    noteAppearancePanelMounted('#p', () => {});
    i18n.language = 'de_DE';
    i18n.table = { 'auth.appearance': 'Aussehen' };
    expect(appearancePanelIsStale('#p')).toBe(true);
  });

  it('forgetting a panel keeps a torn-down editor out of the sweep', async () => {
    const { forgetAppearancePanel } = await import('../src/ui/appearance_panel_locale');
    const rebuilt: string[] = [];
    noteAppearancePanelMounted('#closed', () => rebuilt.push('#closed'));
    forgetAppearancePanel('#closed');
    i18n.table = { 'auth.appearance': 'Apparence' };
    relocalizeAppearancePanels();
    expect(rebuilt).toEqual([]); // never rebuilt into a host that left the DOM
  });
});
