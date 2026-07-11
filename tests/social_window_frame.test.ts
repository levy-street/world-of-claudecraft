// @vitest-environment jsdom
//
// Behavioral guards for the social panel painter AFTER the AAA window-frame
// adoption (the pure row/signature decisions stay in social_view.test.ts). These
// render the real DOM through the shared window-frame builder and assert: the
// frame chrome is stamped on an inner mount with the friends/guild/ignore/raid
// tabs on the frame's TAB RAIL, the #social-window '.open' class visibility
// mechanism is preserved EXACTLY (never style.display), the titlebar is a Hud drag
// handle but the close is not, a frame tab-rail click switches tabs, ArrowRight
// roves between tabs, the delegated body click still routes row actions (unfriend)
// through IWorld, a hostile friend name is escaped, and the close control removes
// '.open' and restores focus.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld, SocialInfo } from '../src/world_api';

function socialInfo(over: Partial<SocialInfo> = {}): SocialInfo {
  return {
    friends: [],
    blocks: [],
    guild: null,
    ...over,
  } as unknown as SocialInfo;
}

function friend(name: string, online = true): unknown {
  return { name, cls: 'warrior', level: 10, online, status: undefined, zone: undefined };
}

function fakeWorld(over: { social?: SocialInfo | null } = {}): IWorld {
  return {
    socialInfo: over.social === undefined ? socialInfo() : over.social,
    partyInfo: null,
    realm: 'Ravenspire',
    player: { name: 'Hero' },
    playerId: 1,
    friendRemove: vi.fn(),
    blockRemove: vi.fn(),
    guildKick: vi.fn(),
    guildPromote: vi.fn(),
    guildDemote: vi.fn(),
    guildTransfer: vi.fn(),
    moveRaidMember: vi.fn(),
    convertPartyToRaid: vi.fn(),
    convertRaidToParty: vi.fn(),
    friendAdd: vi.fn(),
    blockAdd: vi.fn(),
    guildInvite: vi.fn(),
    guildCreate: vi.fn(),
    guildLeave: vi.fn(),
    guildDisband: vi.fn(),
    searchCharacters: vi.fn(async () => []),
  } as unknown as IWorld;
}

function fakeDeps(overrides: Partial<SocialWindowDeps> = {}): SocialWindowDeps {
  const el = document.createElement('div');
  el.id = 'social-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return {
    root: () => el,
    world: () => fakeWorld(),
    closeOthers: () => {},
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showPrompt: () => {},
    startWhisper: () => {},
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('SocialWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with a 4-tab rail', () => {
    const deps = fakeDeps();
    const w = new SocialWindow(deps);
    w.toggle();
    const root = deps.root();
    expect(root.classList.contains('window-frame')).toBe(false);
    expect(root.hasAttribute('role')).toBe(false);
    const frame = root.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The four tabs live on the frame's tab rail (role=tablist / role=tab).
    const rail = frame?.querySelector('.tab-rail[role="tablist"]');
    expect(rail).not.toBeNull();
    const tabs = rail?.querySelectorAll('[role="tab"]');
    expect(tabs?.length).toBe(4);
  });

  it('preserves the .open class visibility mechanism (never style.display)', () => {
    const deps = fakeDeps();
    const w = new SocialWindow(deps);
    expect(w.isOpen).toBe(false);
    w.toggle();
    expect(w.isOpen).toBe(true);
    expect(deps.root().classList.contains('open')).toBe(true);
    // The painter must NOT bake an inline display: visibility is the .open class.
    expect(deps.root().style.display).toBe('');
    w.toggle();
    expect(w.isOpen).toBe(false);
    expect(deps.root().classList.contains('open')).toBe(false);
  });
});

describe('SocialWindow: move / resize / fit parity', () => {
  it('makes the titlebar a Hud drag handle, but never the close control', () => {
    const deps = fakeDeps();
    const w = new SocialWindow(deps);
    w.toggle();
    const root = deps.root();
    const titlebar = root.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = root.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, root)).toBe(true);
    expect(isWindowDragHandle(closeBtn, root)).toBe(false);
  });
});

describe('SocialWindow: tab rail (friends/guild/ignore/raid)', () => {
  it('clicking the guild tab on the frame rail switches the panel to guild', () => {
    const deps = fakeDeps({ world: () => fakeWorld({ social: socialInfo() }) });
    const w = new SocialWindow(deps);
    w.toggle();
    const guildTab = deps
      .root()
      .querySelector<HTMLElement>('[data-window-tab="guild"]') as HTMLElement;
    expect(guildTab).not.toBeNull();
    guildTab.click();
    // The guild tab is now the selected one and the empty-guild state shows.
    expect(guildTab.getAttribute('aria-selected')).toBe('true');
    expect(deps.root().querySelector('.soc-empty')).not.toBeNull();
  });

  it('ArrowRight roves from the friends tab to the guild tab', () => {
    const deps = fakeDeps();
    const w = new SocialWindow(deps);
    w.toggle();
    const friendsTab = deps
      .root()
      .querySelector<HTMLElement>('[data-window-tab="friends"]') as HTMLElement;
    friendsTab.focus();
    friendsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const guildTab = deps
      .root()
      .querySelector<HTMLElement>('[data-window-tab="guild"]') as HTMLElement;
    expect(guildTab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('SocialWindow: delegated row actions', () => {
  it('routes an unfriend click through IWorld.friendRemove (delegated body listener)', () => {
    const world = fakeWorld({ social: socialInfo({ friends: [friend('Bob')] as never }) });
    const deps = fakeDeps({ world: () => world });
    const w = new SocialWindow(deps);
    w.toggle();
    const removeBtn = deps
      .root()
      .querySelector<HTMLElement>('.soc-body [data-act="unfriend"]') as HTMLElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    expect(world.friendRemove).toHaveBeenCalledWith('Bob');
  });
});

describe('SocialWindow: close + hostile escaping', () => {
  it('routes the frame close control to close(): drops .open and restores focus', () => {
    const restoreFocus = vi.fn();
    const deps = fakeDeps({ restoreFocus });
    const w = new SocialWindow(deps);
    w.toggle();
    deps.root().querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(w.isOpen).toBe(false);
    expect(deps.root().classList.contains('open')).toBe(false);
    expect(restoreFocus).toHaveBeenCalled();
  });

  it('escapes a hostile friend name through esc() (no live img element)', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const world = fakeWorld({ social: socialInfo({ friends: [friend(hostile)] as never }) });
    const deps = fakeDeps({ world: () => world });
    const w = new SocialWindow(deps);
    w.toggle();
    const body = deps.root().querySelector('.soc-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.innerHTML).toContain('&lt;img');
  });

  it('escapes a hostile GUILD name and member name through esc() (guild render path)', () => {
    // The guild tab renders through guildHtml (head + roster rows), a DISTINCT
    // path from the friends rows: the guild name lands in .soc-guild-head and
    // member names in the roster, so both must be pinned separately.
    const hostile = '<img src=x onerror=alert(1)>';
    const member = (name: string, rank: string) => ({
      id: 2,
      name,
      cls: 'warrior',
      level: 10,
      realm: 'Ravenspire',
      online: true,
      rank,
      lastLogin: null,
    });
    const world = fakeWorld({
      social: socialInfo({
        guild: {
          id: 1,
          name: hostile,
          rank: 'leader',
          members: [member('Hero', 'leader'), member(hostile, 'member')],
          events: [],
        } as never,
      }),
    });
    const deps = fakeDeps({ world: () => world });
    const w = new SocialWindow(deps);
    w.toggle();
    (deps.root().querySelector('[data-window-tab="guild"]') as HTMLElement).click();
    const body = deps.root().querySelector('.soc-body') as HTMLElement;
    // The guild head rendered, so the assertions exercise the guild path.
    const head = body.querySelector('.soc-guild-head') as HTMLElement;
    expect(head).not.toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(head.innerHTML).toContain('&lt;img');
    // The hostile member roster row is escaped too (no live element anywhere).
    expect(body.innerHTML).toContain('&lt;img');
  });
});
