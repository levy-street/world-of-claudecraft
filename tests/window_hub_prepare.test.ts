// @vitest-environment happy-dom
// The shared window hub's prepare() path (menu consolidation step 2): a
// member reached DIRECTLY (a chat deed link, a tracker click, a deep link that
// calls the window's own open) still shows one tab at a time, because every
// member's open path calls hub.prepare(tab) through its closeOthers dep.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusManager } from '../src/ui/focus_manager';
import { BOOK_OF_REALM, type BookOfRealmTab } from '../src/ui/hud/hub/book_of_realm_view';
import { WindowHubController, type WindowHubMember } from '../src/ui/hud/hub/window_hub_controller';
import { makeWindowFocus } from '../src/ui/window_focus';

interface FakeMember extends WindowHubMember {
  isOpen: boolean;
  readonly el: HTMLElement;
}

let hub: WindowHubController<BookOfRealmTab>;
let members: Record<BookOfRealmTab, FakeMember>;
const log: string[] = [];

function fakeMember(tab: BookOfRealmTab): FakeMember {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const member: FakeMember = {
    isOpen: false,
    el,
    // The member's own open path: closeOthers first (wired to prepare), then
    // show itself, exactly the deeds/reliquary window shape.
    open() {
      hub.prepare(tab);
      log.push(`open:${tab}`);
      member.isOpen = true;
    },
    close() {
      log.push(`close:${tab}`);
      member.isOpen = false;
    },
    rootElement: () => el,
  };
  return member;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  log.length = 0;
  members = {
    deeds: fakeMember('deeds'),
    titles: fakeMember('titles'),
    reliquary: fakeMember('reliquary'),
    reputation: fakeMember('reputation'),
    lootExplorer: fakeMember('lootExplorer'),
    rankings: fakeMember('rankings'),
  };
  hub = new WindowHubController(BOOK_OF_REALM, { members: () => members, touch: () => false });
});

describe('prepare: a direct deep link into a member', () => {
  it('closes the shown member before the linked one opens, and remembers the tab', () => {
    hub.open('deeds');
    log.length = 0;
    // A chat Reliquary link calls the Reliquary window straight away.
    members.reliquary.open();
    expect(log).toEqual(['close:deeds', 'open:reliquary']);
    expect(hub.activeTab()).toBe('reliquary');
    expect(localStorage.getItem('woc.bookOfRealm.tab')).toBe('reliquary');
  });

  it('carries a placed window position onto the linked member', () => {
    hub.open('deeds');
    Object.assign(members.deeds.el.dataset, {
      reqLeft: '40',
      reqTop: '60',
      reqVw: '1600',
      reqVh: '1000',
      windowMoved: '1',
    });
    members.rankings.open();
    expect(members.rankings.el.dataset.reqLeft).toBe('40');
    expect(members.rankings.el.dataset.windowMoved).toBe('1');
  });

  it('is a no-op beyond the memory when nothing else is shown, or the same tab is', () => {
    members.titles.open();
    expect(log).toEqual(['open:titles']);
    hub.prepare('titles');
    expect(log).toEqual(['open:titles']);
    expect(hub.activeTab()).toBe('titles');
  });
});

describe('focus carry across a member rebuild', () => {
  it('keeps keyboard focus on a hub tab when a member rebuilds its markup', () => {
    // A member with NO restore ladder of its own (the Card Duel / Leaderboard
    // shape): it builds its strip markup, swaps innerHTML, then wires.
    const el = members.reputation.el;
    const strip = hub.stripFor('reputation');
    const rebuild = () => {
      el.innerHTML = `<div class="panel-title"></div>${strip.html()}<p>body</p>`;
      strip.wire(el);
    };
    rebuild();
    el.querySelector<HTMLElement>('.realm-hub-tab[data-tab="rankings"]')?.focus();
    rebuild();
    expect(document.activeElement?.getAttribute('data-tab')).toBe('rankings');
    expect(el.contains(document.activeElement)).toBe(true);
  });

  it('never steals focus a member already restored, nor reclaims it when no tab held it', () => {
    const el = members.deeds.el;
    const strip = hub.stripFor('deeds');
    el.innerHTML = `${strip.html()}<button id="close">x</button>`;
    strip.wire(el);
    el.querySelector<HTMLElement>('#close')?.focus();
    el.innerHTML = `${strip.html()}<button id="close">x</button>`;
    strip.wire(el);
    expect(document.activeElement?.getAttribute('data-tab')).toBeNull();
  });
});

// The review-round regression: members wired through the REAL FocusManager.
// A member's close returns focus through FocusManager.restore, which defers a
// tick outside a handoff. Before the handoff, a tab switch from a keyboard
// opener (a) left the next member recording no opener, so Escape returned
// focus nowhere, and (b) fired the old member's late return a tick later,
// pulling the keyboard out of the tab just opened.
describe('a tab switch between members wired through the FocusManager', () => {
  // happy-dom lays nothing out: an element is rendered here when it is
  // connected and no ancestor is display:none, the manager's own visibility test.
  const rendered = function (this: HTMLElement): DOMRectList {
    let shown = this.isConnected;
    for (let n: HTMLElement | null = this; n && shown; n = n.parentElement)
      if (n.style.display === 'none') shown = false;
    return (shown ? [{}] : []) as unknown as DOMRectList;
  };

  function focusWired(order: 'capture-first' | 'prepare-first') {
    const fm = new FocusManager();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const wired = {} as Record<BookOfRealmTab, WindowHubMember & { tab: HTMLButtonElement }>;
    const focusHub = new WindowHubController(BOOK_OF_REALM, {
      members: () => wired,
      touch: () => false,
    });
    for (const { id } of BOOK_OF_REALM.tabs) {
      const root = document.createElement('div');
      root.style.display = 'none';
      const tab = document.createElement('button');
      root.appendChild(tab);
      document.body.appendChild(root);
      const focus = makeWindowFocus(fm, () => root);
      let openerFocus: HTMLElement | null = null;
      wired[id] = {
        tab,
        get isOpen() {
          return root.style.display !== 'none';
        },
        // Both member shapes ship: the leaderboard records its opener before
        // closing siblings, the deeds window after.
        open() {
          if (order === 'capture-first') openerFocus = focus.captureFocus();
          focusHub.prepare(id);
          if (order === 'prepare-first') openerFocus = focus.captureFocus();
          root.style.display = 'block';
        },
        close() {
          root.style.display = 'none';
          focus.restoreFocus(openerFocus);
          openerFocus = null;
        },
        rootElement: () => root,
      };
    }
    return { focusHub, wired, opener };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(rendered);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['capture-first', 'prepare-first'] as const)(
    'keeps focus in the new tab and returns Escape to the original opener (%s members)',
    (order) => {
      const { focusHub, wired, opener } = focusWired(order);
      opener.focus();
      focusHub.open('deeds');
      // The player is on the Deeds tab strip and presses the Titles tab.
      wired.deeds.tab.focus();
      focusHub.open('titles');
      wired.titles.tab.focus();
      // No late return from the closed Deeds tab pulls focus back out.
      vi.runAllTimers();
      expect(document.activeElement).toBe(wired.titles.tab);
      expect(focusHub.activeTab()).toBe('titles');
      // A second hop, then Escape: focus lands where the player started.
      focusHub.open('rankings');
      wired.rankings.tab.focus();
      vi.runAllTimers();
      expect(document.activeElement).toBe(wired.rankings.tab);
      focusHub.close();
      vi.runAllTimers();
      expect(document.activeElement).toBe(opener);
    },
  );

  it('still defers the return on a plain close, outside a handoff', () => {
    const { focusHub, wired, opener } = focusWired('prepare-first');
    opener.focus();
    focusHub.open('deeds');
    wired.deeds.tab.focus();
    focusHub.close();
    expect(document.activeElement).not.toBe(opener);
    vi.runAllTimers();
    expect(document.activeElement).toBe(opener);
  });
});
