// @vitest-environment happy-dom

// Founding a guild rides the metered name_screen WS lane (refill 2/s, burst 5,
// shared with pet_rename and the named perfect_item promotion). A frame the
// lane DROPS sends nothing back at all: no error, no event, no repaint. So a
// player who mashes Found gets silence, and the button reads as dead while the
// server never saw four of the five presses.
//
// The fix is the phase 14 idiom (legendary_naming_controller.ts, same lane):
// hold the submit for one lane beat after each send, re-armed by a one-shot
// timer. The social panel adds a twist the dialog does not have: it repaints on
// the slow-HUD divider, and a structural repaint REBUILDS the footer, so a hold
// stamped on the old button would vanish with it. The hold therefore lives on
// the window and is re-stamped after every render, which is the arm below that
// would fail if someone moved the flag onto the element.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD_CREATE_LOCK_MS, SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import type { IWorld } from '../src/world_api';

interface SocialTestWorld {
  guildCreate: ReturnType<typeof vi.fn>;
  socialInfo: { friends: []; ignores: []; blocks: []; guild: unknown };
  partyInfo: unknown;
}

let world: SocialTestWorld;
let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  world = {
    guildCreate: vi.fn(),
    socialInfo: { friends: [], ignores: [], blocks: [], guild: null },
    partyInfo: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function openWindow(): SocialWindow {
  root = document.createElement('div');
  root.id = 'social-window';
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: SocialWindowDeps = {
    root: () => root,
    world: () =>
      ({
        playerId: 7,
        player: { id: 7, name: 'Aleron' },
        realm: 'Ashenvale',
        socialInfo: world.socialInfo,
        partyInfo: world.partyInfo,
        searchCharacters: async () => [],
        guildCreate: world.guildCreate,
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
  (root.querySelector('[data-tab="guild"]') as HTMLElement | null)?.click();
  return win;
}

function foundButton(): HTMLButtonElement {
  const btn = root.querySelector('.soc-add .btn[data-act="guild-create"]');
  expect(btn, 'the guild-create footer never rendered: every arm below is vacuous').not.toBeNull();
  return btn as HTMLButtonElement;
}

function typeName(name: string): void {
  const input = root.querySelector('input[data-field="gname"]') as HTMLInputElement;
  expect(input, 'the guild name input never rendered').not.toBeNull();
  input.value = name;
}

describe('social window: the Found button holds for one name_screen lane beat', () => {
  it('sends once, holds the button, and re-arms on the one-shot timer', () => {
    const win = openWindow();
    expect(win.isOpen).toBe(true);
    typeName('Ashen Vow');
    foundButton().click();
    expect(world.guildCreate).toHaveBeenCalledTimes(1);
    expect(world.guildCreate).toHaveBeenCalledWith('Ashen Vow');

    // The hold: disabled plus aria-busy, the house busy form (.btn:disabled
    // carries the visuals), so a mash never reads as a dead button while the
    // lane may have dropped the frame.
    expect(foundButton().disabled).toBe(true);
    expect(foundButton().getAttribute('aria-busy')).toBe('true');
    typeName('Ashen Vow');
    foundButton().click();
    expect(world.guildCreate, 'a press inside the hold reached the lane').toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GUILD_CREATE_LOCK_MS);
    expect(foundButton().disabled).toBe(false);
    expect(foundButton().getAttribute('aria-busy')).toBeNull();
    typeName('Ashen Vow');
    foundButton().click();
    expect(world.guildCreate, 'the hold never lifted').toHaveBeenCalledTimes(2);
  });

  it('holds one tick BEFORE the timer would lift it', () => {
    // The boundary, so a lock that lifted immediately (or on the next frame)
    // could not pass the arm above by accident.
    openWindow();
    typeName('Ashen Vow');
    foundButton().click();
    vi.advanceTimersByTime(GUILD_CREATE_LOCK_MS - 1);
    expect(foundButton().disabled).toBe(true);
    typeName('Ashen Vow');
    foundButton().click();
    expect(world.guildCreate).toHaveBeenCalledTimes(1);
  });

  it('re-stamps the hold onto the button a structural repaint rebuilt', () => {
    // THE SOCIAL-SPECIFIC ARM. The panel repaints on the slow-HUD divider, and a
    // structural change (here: a party forms, which moves the struct signature
    // without touching the guild) runs a FULL render that rebuilds the footer.
    // A hold kept on the element would be handed back live by that rebuild.
    const win = openWindow();
    typeName('Ashen Vow');
    foundButton().click();
    const before = foundButton();

    world.partyInfo = { raid: false, leader: 7, members: [{ pid: 7, group: 1 }] };
    win.refreshIfChanged();
    expect(
      foundButton(),
      'the repaint did not rebuild the footer: this arm proves nothing',
    ).not.toBe(before);
    expect(foundButton().disabled).toBe(true);
    expect(foundButton().getAttribute('aria-busy')).toBe('true');
    typeName('Ashen Vow');
    foundButton().click();
    expect(world.guildCreate).toHaveBeenCalledTimes(1);

    // And the rebuilt button still re-arms on the original one-shot timer.
    vi.advanceTimersByTime(GUILD_CREATE_LOCK_MS);
    expect(foundButton().disabled).toBe(false);
  });

  it('holds the Enter-to-submit path too, not just the click', () => {
    openWindow();
    typeName('Ashen Vow');
    const input = root.querySelector('input[data-field="gname"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(world.guildCreate).toHaveBeenCalledTimes(1);
    expect(foundButton().disabled).toBe(true);
    typeName('Ashen Vow');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(world.guildCreate, 'Enter walked around the hold').toHaveBeenCalledTimes(1);
  });

  it('an empty name never takes the hold', () => {
    // Nothing was sent, so nothing may be held: the player has to be able to
    // type a name and press Found immediately.
    openWindow();
    foundButton().click();
    expect(world.guildCreate).not.toHaveBeenCalled();
    expect(foundButton().disabled).toBe(false);
    expect(foundButton().getAttribute('aria-busy')).toBeNull();
  });

  it('the landed guild retires the create row, so the hold can never strand it', () => {
    // The other way the hold ends: the result arrives. A created guild swaps the
    // footer for the invite/leave rows, so there is no Found button left to hold.
    const win = openWindow();
    typeName('Ashen Vow');
    foundButton().click();
    world.socialInfo = {
      friends: [],
      ignores: [],
      blocks: [],
      guild: {
        id: 4,
        name: 'Ashen Vow',
        rank: 'leader',
        members: [{ name: 'Aleron', cls: 'warrior', level: 60, online: true, rank: 'leader' }],
        motd: '',
        events: [],
      },
    };
    win.refreshIfChanged();
    expect(root.querySelector('.soc-add .btn[data-act="guild-create"]')).toBeNull();
    expect(root.querySelector('input[data-field="gname"]')).toBeNull();
  });
});
