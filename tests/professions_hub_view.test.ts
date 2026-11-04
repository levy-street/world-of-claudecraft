// The Professions hub's pure tab model (menu consolidation step 1).
import { describe, expect, it } from 'vitest';
import {
  PROFESSIONS_HUB_DEFAULT_TAB,
  PROFESSIONS_HUB_POSITION_FIELDS,
  PROFESSIONS_HUB_TABS,
  parseProfessionsHubTab,
  professionsHubPositionCarry,
  professionsHubStripHtml,
  professionsHubStripModel,
  professionsHubToggle,
  resolveProfessionsHubTab,
} from '../src/ui/hud/professions/professions_hub_view';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

describe('the tab set', () => {
  it('is Overview, Crafting, Perfecting, Harvest Journal, in that order', () => {
    expect(PROFESSIONS_HUB_TABS.map((tab) => tab.id)).toEqual([
      'overview',
      'crafting',
      'perfecting',
      'harvest',
    ]);
    expect(PROFESSIONS_HUB_DEFAULT_TAB).toBe('overview');
  });

  it('labels the absorbed windows with their own former titles; Overview is the one new key', () => {
    expect(PROFESSIONS_HUB_TABS.map((tab) => tab.labelKey)).toEqual([
      'hudChrome.professionsHub.tabOverview',
      'hudChrome.crafting.title',
      'hudChrome.perfecting.title',
      'hudChrome.harvestJournal.title',
    ]);
    expect(hudChromeStrings.professionsHub.tabOverview).toBe('Overview');
  });
});

describe('last-tab memory', () => {
  it('trusts only a stored value that names a live tab', () => {
    expect(parseProfessionsHubTab('crafting')).toBe('crafting');
    expect(parseProfessionsHubTab('harvest')).toBe('harvest');
    expect(parseProfessionsHubTab(null)).toBeNull();
    expect(parseProfessionsHubTab(undefined)).toBeNull();
    expect(parseProfessionsHubTab('')).toBeNull();
    expect(parseProfessionsHubTab('townFocus')).toBeNull();
    expect(parseProfessionsHubTab('"crafting"')).toBeNull();
  });

  it('an open lands on the requested tab, else the saved one, else Overview', () => {
    expect(resolveProfessionsHubTab('perfecting', 'crafting')).toBe('perfecting');
    expect(resolveProfessionsHubTab(undefined, 'crafting')).toBe('crafting');
    expect(resolveProfessionsHubTab(undefined, null)).toBe('overview');
  });
});

describe('launcher toggle', () => {
  it('a plain press opens the saved tab when closed and closes whatever tab is shown', () => {
    expect(professionsHubToggle(null, undefined, 'harvest')).toEqual({
      kind: 'open',
      tab: 'harvest',
    });
    expect(professionsHubToggle(null, undefined, null)).toEqual({ kind: 'open', tab: 'overview' });
    for (const active of ['overview', 'crafting', 'perfecting', 'harvest'] as const) {
      expect(professionsHubToggle(active, undefined, null), active).toEqual({ kind: 'close' });
    }
  });

  it('a tab press closes only its own shown tab and otherwise switches to it', () => {
    expect(professionsHubToggle('crafting', 'crafting', null)).toEqual({ kind: 'close' });
    expect(professionsHubToggle('overview', 'crafting', null)).toEqual({
      kind: 'open',
      tab: 'crafting',
    });
    expect(professionsHubToggle(null, 'crafting', 'harvest')).toEqual({
      kind: 'open',
      tab: 'crafting',
    });
  });
});

describe('the shared strip', () => {
  it('is a WAI-ARIA tablist on the ui-tabs primitives with exactly one selected tab', () => {
    const model = professionsHubStripModel('perfecting');
    expect(model.stripClass).toBe('prof-hub-tabs ui-tabs');
    expect(model.tabClass).toBe('prof-hub-tab ui-tab');
    expect(model.ariaLabel).toBe('Professions');
    expect(model.tabs.map((tab) => [tab.id, tab.label, tab.selected])).toEqual([
      ['overview', 'Overview', false],
      ['crafting', 'Crafting', false],
      ['perfecting', 'Perfecting', true],
      ['harvest', 'Harvest Journal', false],
    ]);
    const html = professionsHubStripHtml('perfecting');
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-tab="perfecting" role="tab" aria-selected="true" tabindex="0"/);
  });
});

describe('position carry across a tab switch', () => {
  const placed = {
    reqLeft: '120',
    reqTop: '80',
    reqVw: '1920',
    reqVh: '1080',
    windowMoved: '1',
  };

  it('carries exactly the remembered-position fields of a placed window', () => {
    const carry = professionsHubPositionCarry(placed, false);
    expect(carry).toEqual({ kind: 'set', fields: placed });
    expect(Object.keys(carry?.kind === 'set' ? carry.fields : {}).sort()).toEqual(
      [...PROFESSIONS_HUB_POSITION_FIELDS].sort(),
    );
  });

  it('resets the next window to the default spot when the shown one was never placed', () => {
    expect(professionsHubPositionCarry({ ...placed, windowMoved: undefined }, false)).toEqual({
      kind: 'reset',
    });
    expect(professionsHubPositionCarry({ ...placed, reqVh: undefined }, false)).toEqual({
      kind: 'reset',
    });
    expect(professionsHubPositionCarry({}, false)).toEqual({ kind: 'reset' });
  });

  it('carries nothing on touch, where every member is a full-screen sheet', () => {
    expect(professionsHubPositionCarry(placed, true)).toBeNull();
    expect(professionsHubPositionCarry({}, true)).toBeNull();
  });
});
