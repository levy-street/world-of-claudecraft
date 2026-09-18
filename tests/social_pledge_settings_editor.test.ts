// @vitest-environment happy-dom

// The Pledges tab's recruiting editor (src/ui/social_window.ts savePledgeSettings):
// the four fields, the new-player-friendly opt-in included, reach IWorld as ONE
// settings object. Pinned at the DOM on purpose: the save bails when any field
// is missing from the markup, so a regression that dropped the opt-in box would
// silently disable saving EVERY pledge setting, and only a real click catches it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import type { IWorld } from '../src/world_api';

let root: HTMLElement;
let setGuildPledgeSettings: ReturnType<typeof vi.fn>;

function guildMasterView(newPlayerFriendly: boolean): unknown {
  return {
    id: 1,
    name: 'Lanternmere Wardens',
    rank: 'leader',
    motd: '',
    motdSetBy: '',
    members: [],
    events: [],
    pledgeSettings: { enabled: true, minLevel: 5, note: 'we help you gear', newPlayerFriendly },
    pledges: [],
    tier: 1,
  };
}

function openPledgesTab(newPlayerFriendly: boolean): SocialWindow {
  root = document.createElement('div');
  root.id = 'social-window';
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: SocialWindowDeps = {
    root: () => root,
    world: () =>
      ({
        playerId: 7,
        player: { id: 7, name: 'Aleron', level: 60 },
        realm: 'Ashenvale',
        socialInfo: {
          friends: [],
          ignores: [],
          blocks: [],
          guild: guildMasterView(newPlayerFriendly),
          myPledge: null,
        },
        partyInfo: null,
        searchCharacters: async () => [],
        setGuildPledgeSettings,
      }) as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showPrompt: noop,
    startWhisper: noop,
  };
  const win = new SocialWindow(deps);
  win.toggle();
  const tab = root.querySelector('[data-tab="pledges"]') as HTMLElement | null;
  expect(tab, 'the Pledges tab never rendered (officer-plus only)').not.toBeNull();
  tab?.click();
  return win;
}

function field(name: string): HTMLInputElement {
  const input = root.querySelector(`input[data-field="${name}"]`) as HTMLInputElement | null;
  expect(input, `the ${name} field never rendered`).not.toBeNull();
  return input as HTMLInputElement;
}

function clickSave(): void {
  const save = root.querySelector('[data-act="pledge-settings-save"]') as HTMLButtonElement | null;
  expect(save, 'the save button never rendered').not.toBeNull();
  save?.click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  setGuildPledgeSettings = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('social window: the Pledges tab recruiting editor', () => {
  it('renders the stored opt-in and saves all four fields as one settings object', () => {
    openPledgesTab(false);
    expect(field('pnewbie').checked).toBe(false);
    expect(field('popen').checked).toBe(true);
    expect(field('pminlvl').value).toBe('5');
    expect(field('pnote').value).toBe('we help you gear');

    field('pnewbie').checked = true;
    field('pminlvl').value = '12';
    field('pnote').value = 'New to ClaudeCraft? Start here.';
    clickSave();

    expect(setGuildPledgeSettings).toHaveBeenCalledTimes(1);
    expect(setGuildPledgeSettings).toHaveBeenCalledWith({
      enabled: true,
      minLevel: 12,
      note: 'New to ClaudeCraft? Start here.',
      newPlayerFriendly: true,
    });
  });

  it('sends an explicit false when the opt-in is unticked, never an absent field', () => {
    // Absent means "keep the stored flag" on the wire (an older client's
    // write); a current client that unticks the box must clear it.
    openPledgesTab(true);
    expect(field('pnewbie').checked).toBe(true);
    field('pnewbie').checked = false;
    clickSave();

    expect(setGuildPledgeSettings).toHaveBeenCalledWith({
      enabled: true,
      minLevel: 5,
      note: 'we help you gear',
      newPlayerFriendly: false,
    });
  });
});
