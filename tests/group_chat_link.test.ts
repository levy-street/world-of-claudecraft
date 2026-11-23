// @vitest-environment happy-dom
//
// The clickable group link a listing advert posts to General
// (src/ui/hud/chat/group_chat_link.ts) and the Groups window landing it drives
// (DungeonFinderWindow.openListing over the pure src/ui/dungeon_board_jump.ts).
// Pins: the label comes from the local activity catalogue (never the wire), an
// unknown activity degrades to "[?]", the a11y wiring (role, tab stop, click and
// Enter/Space), the icon cue that keeps it apart from an item link, and the
// landing: board tab with the content filter cleared, the listed card focused
// and pulsed, or a "no longer listed" note when the listing is gone.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boardJumpTarget } from '../src/ui/dungeon_board_jump';
import { DungeonFinderWindow } from '../src/ui/dungeon_finder_window';
import {
  groupChatLinkEl,
  groupChatLinkLabel,
  groupChatLinkPlainText,
} from '../src/ui/hud/chat/group_chat_link';
import { t } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';
import type { DungeonFinderListingView } from '../src/world_api/dungeon_finder';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

describe('group chat link element', () => {
  it('labels the link from the activity catalogue in the reader language', () => {
    expect(groupChatLinkLabel('nythraxis_boss_arena_heroic')).toBe(
      t('hudChrome.finder.chatLink', {
        dungeon: 'Nythraxis Raid Arena',
        difficulty: t('hudChrome.finder.heroic'),
      }),
    );
    expect(groupChatLinkLabel('nythraxis_boss_arena_heroic')).toBe(
      'LFM: Nythraxis Raid Arena (Heroic)',
    );
    expect(groupChatLinkPlainText('hollow_crypt_normal')).toBe('[LFM: The Hollow Crypt (Normal)]');
  });

  it('degrades an unknown activity to a plain [?] with no link', () => {
    const groups = { openListing: vi.fn() };
    const node = groupChatLinkEl(document, { listingId: 3, activityId: 'no_such' }, groups);
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('[?]');
    expect(groupChatLinkPlainText('no_such')).toBe('[?]');
  });

  it('is a keyboard-operable button that opens the Groups window on its listing', () => {
    const groups = { openListing: vi.fn() };
    const link = groupChatLinkEl(
      document,
      { listingId: 42, activityId: 'hollow_crypt_normal' },
      groups,
    ) as HTMLElement;
    expect(link.className).toBe('chat-group-link');
    expect(link.getAttribute('role')).toBe('button');
    expect(link.tabIndex).toBe(0);
    expect(link.textContent).toBe('[LFM: The Hollow Crypt (Normal)]');
    // The group icon is decorative and is what tells it apart from an item link.
    const icon = link.querySelector('.chat-group-link-icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    link.click();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    link.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    const call = [42, 'hollow_crypt_normal'];
    expect(groups.openListing.mock.calls).toEqual([call, call, call]);
  });

  it('styles the link in the LFG mint, never an item-quality or quest color', () => {
    const css = readFileSync('src/styles/hud.css', 'utf8');
    const rule = css.match(/\.chat-group-link \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color: var(--color-chat-group-link);');
    expect(readFileSync('src/styles/tokens.css', 'utf8')).toContain(
      '--color-chat-group-link: #5cd6a0;',
    );
    for (const taken of ['#1eff00', '#0070dd', '#a335ee', '#ff8000', '#ffc864'])
      expect(rule).not.toContain(taken);
  });
});

describe('boardJumpTarget', () => {
  const board = [
    { id: 4, activityId: 'hollow_crypt_normal' },
    { id: 9, activityId: 'nythraxis_boss_arena_heroic' },
  ];
  const mine = { id: 12, activityId: 'sunken_bastion_normal' };
  it('lands on a listed row or my own listing, and reports a missing id as gone', () => {
    expect(boardJumpTarget(board, null, 9, 'nythraxis_boss_arena_heroic')).toBe('listed');
    expect(boardJumpTarget(board, mine, 12, 'sunken_bastion_normal')).toBe('listed');
    expect(boardJumpTarget(board, mine, 5, 'hollow_crypt_normal')).toBe('gone');
    expect(boardJumpTarget([], null, 4, 'hollow_crypt_normal')).toBe('gone');
  });
  it('never lands on a listing for other content than the link named', () => {
    // A typed token, or a stale link whose id now belongs to another group.
    expect(boardJumpTarget(board, null, 4, 'nythraxis_boss_arena_heroic')).toBe('gone');
    expect(boardJumpTarget(board, mine, 12, 'hollow_crypt_normal')).toBe('gone');
    expect(boardJumpTarget(board, null, 4, 'no_such_activity')).toBe('gone');
  });
  it('still lands after the leader switched the same content to its other difficulty', () => {
    expect(boardJumpTarget(board, null, 4, 'hollow_crypt_heroic')).toBe('listed');
    expect(boardJumpTarget(board, null, 9, 'nythraxis_boss_arena_normal')).toBe('listed');
  });
  it('waits for the first board snapshot instead of calling the group gone', () => {
    expect(boardJumpTarget(null, null, 4, 'hollow_crypt_normal')).toBe('unsynced');
    expect(boardJumpTarget(null, mine, 12, 'sunken_bastion_normal')).toBe('listed');
  });
});

function row(id: number, activityId: string): DungeonFinderListingView {
  return {
    id,
    activityId,
    leaderName: `Leader${id}`,
    tags: [],
    size: 2,
    capacity: 5,
    needed: { tank: 0, healer: 1, dps: 2 },
    members: [
      { cls: 'warrior', level: 20, role: 'tank' },
      { cls: 'mage', level: 20, role: 'dps' },
    ],
  };
}

function setup(board: DungeonFinderListingView[]) {
  const root = document.createElement('div');
  root.id = 'dungeon-finder-window';
  document.body.append(root);
  const world = {
    partyInfo: null,
    player: { level: 20 },
    playerId: 1,
    cfg: { playerClass: 'paladin' },
    talentRole: 'healer',
    talentSpec: 'holy',
    dungeonFinderBoard: board,
    raidLockouts: () => [],
    dungeonFinderInfo: {
      roles: ['healer'],
      eligibleRoles: ['healer'],
      cooldown: 0,
      queue: null,
      proposal: null,
      myListing: null,
      myApplication: null,
    },
  };
  const window = new DungeonFinderWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    hideTooltip: vi.fn(),
    showOnMap: vi.fn(),
    itemIcon: () => '',
    itemTooltip: () => '',
    moneyHtml: () => '',
    attachTooltip: vi.fn(),
  });
  return { root, world, window };
}

describe('DungeonFinderWindow.openListing (the chat link landing)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the board on the linked listing, focused and pulsed, other rows untouched', () => {
    const { root, window } = setup([
      row(4, 'hollow_crypt_normal'),
      row(9, 'sunken_bastion_normal'),
    ]);
    window.openListing(9, 'sunken_bastion_normal');
    expect(window.isOpen).toBe(true);
    const card = root.querySelector<HTMLElement>('[data-listing-id="9"]');
    expect(card?.classList.contains('df-listing-flash')).toBe(true);
    expect(document.activeElement).toBe(card);
    expect(
      root.querySelector('[data-listing-id="4"]')?.classList.contains('df-listing-flash'),
    ).toBe(false);
    expect(root.querySelector('.df-jump-gone')).toBeNull();
    // The row the player lands on carries the real Apply control.
    expect(card?.querySelector('[data-apply="9"]')).not.toBeNull();
  });

  it('clears a content filter that would hide the linked row', () => {
    const { root, window } = setup([row(4, 'hollow_crypt_normal')]);
    window.open('board');
    const filter = root.querySelector<HTMLSelectElement>('[data-board-filter]');
    expect(filter).not.toBeNull();
    if (filter) {
      filter.value = 'raid';
      filter.dispatchEvent(new Event('change'));
    }
    expect(root.querySelector('[data-listing-id="4"]')).toBeNull();
    window.openListing(4, 'hollow_crypt_normal');
    expect(
      root.querySelector('[data-listing-id="4"]')?.classList.contains('df-listing-flash'),
    ).toBe(true);
  });

  it('says the group is no longer listed when the listing has closed or filled', () => {
    const { root, window } = setup([row(4, 'hollow_crypt_normal')]);
    window.openListing(77, 'hollow_crypt_normal');
    expect(window.isOpen).toBe(true);
    const note = root.querySelector('.df-jump-gone');
    expect(note?.textContent).toBe(t('hudChrome.finder.listingGone'));
    expect(note?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.df-listing-flash')).toBeNull();
  });

  it('treats a link that names other content than the listing as gone', () => {
    const { root, window } = setup([row(4, 'hollow_crypt_normal')]);
    window.openListing(4, 'nythraxis_boss_arena_heroic');
    expect(root.querySelector('.df-jump-gone')?.textContent).toBe(
      t('hudChrome.finder.listingGone'),
    );
    expect(root.querySelector('.df-listing-flash')).toBeNull();
  });

  it('says so when the board hides the listing from me (my own party leader posted it)', () => {
    const { root, world, window } = setup([row(9, 'hollow_crypt_normal')]);
    // A party member clicking their own leader's advert: the browse column
    // skips the group I am already in, so there is no card to land on.
    (world as { partyInfo: unknown }).partyInfo = {
      leader: 2,
      members: [
        { pid: 1, name: 'Me', cls: 'paladin', level: 20 },
        { pid: 2, name: 'Leader9', cls: 'warrior', level: 20 },
      ],
    };
    window.openListing(9, 'hollow_crypt_normal');
    expect(root.querySelector('[data-listing-id="9"]')).toBeNull();
    expect(root.querySelector('.df-jump-gone')?.textContent).toBe(
      t('hudChrome.finder.listingHidden'),
    );
  });
});
