// @vitest-environment happy-dom
// The shared window hub's prepare() path (menu consolidation step 2): a
// member reached DIRECTLY (a chat deed link, a tracker click, a deep link that
// calls the window's own open) still shows one tab at a time, because every
// member's open path calls hub.prepare(tab) through its closeOthers dep.
import { beforeEach, describe, expect, it } from 'vitest';
import { BOOK_OF_REALM, type BookOfRealmTab } from '../src/ui/hud/hub/book_of_realm_view';
import { WindowHubController, type WindowHubMember } from '../src/ui/hud/hub/window_hub_controller';

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
