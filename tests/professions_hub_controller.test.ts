// @vitest-environment happy-dom
// The Professions hub's tab group over fake member windows (menu
// consolidation step 1): one member shown at a time, tab switches carry the
// position and focus contract, and the last tab is remembered per device.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ProfessionsHubController,
  type ProfessionsHubMember,
} from '../src/ui/hud/professions/professions_hub_controller';
import {
  PROFESSIONS_HUB_TAB_KEY,
  type ProfessionsHubTab,
} from '../src/ui/hud/professions/professions_hub_view';

interface FakeMember extends ProfessionsHubMember {
  isOpen: boolean;
  readonly el: HTMLElement;
  readonly log: string[];
}

function fakeMember(tab: ProfessionsHubTab, log: string[]): FakeMember {
  const el = document.createElement('div');
  el.id = `fake-${tab}`;
  document.body.appendChild(el);
  const member: FakeMember = {
    isOpen: false,
    el,
    log,
    open() {
      log.push(`open:${tab}`);
      member.isOpen = true;
      // A member paints the shared strip into its own root on open.
      el.innerHTML = hub.stripFor(tab).html();
      hub.stripFor(tab).wire(el);
    },
    close() {
      log.push(`close:${tab}`);
      member.isOpen = false;
    },
    rootElement: () => el,
  };
  return member;
}

let hub: ProfessionsHubController;
let members: Record<ProfessionsHubTab, FakeMember>;
let log: string[];
let touch = false;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  log = [];
  touch = false;
  members = {
    overview: fakeMember('overview', log),
    crafting: fakeMember('crafting', log),
    perfecting: fakeMember('perfecting', log),
    harvest: fakeMember('harvest', log),
  };
  hub = new ProfessionsHubController({ members: () => members, touch: () => touch });
});

const shown = () =>
  (Object.keys(members) as ProfessionsHubTab[]).filter((tab) => members[tab].isOpen);

describe('open and toggle', () => {
  it('opens Overview first, then remembers the last tab per device', () => {
    hub.toggle();
    expect(shown()).toEqual(['overview']);
    hub.open('perfecting');
    expect(shown()).toEqual(['perfecting']);
    expect(localStorage.getItem(PROFESSIONS_HUB_TAB_KEY)).toBe('perfecting');
    hub.toggle();
    expect(shown()).toEqual([]);
    hub.toggle();
    expect(shown()).toEqual(['perfecting']);
  });

  it('closes the shown member BEFORE opening the next, so focus returns to the original opener first', () => {
    hub.open('overview');
    log.length = 0;
    hub.open('harvest');
    expect(log).toEqual(['close:overview', 'open:harvest']);
  });

  it('T over an open Overview switches to Crafting; T over Crafting closes', () => {
    hub.open('overview');
    hub.toggle('crafting');
    expect(shown()).toEqual(['crafting']);
    hub.toggle('crafting');
    expect(shown()).toEqual([]);
  });

  it('re-opening the shown tab re-opens it in place (no close)', () => {
    hub.open('crafting');
    log.length = 0;
    hub.open('crafting');
    expect(log).toEqual(['open:crafting']);
  });

  it('a corrupt stored tab falls back to Overview', () => {
    localStorage.setItem(PROFESSIONS_HUB_TAB_KEY, 'townFocus');
    hub.toggle();
    expect(shown()).toEqual(['overview']);
  });
});

describe('position carry', () => {
  const place = (el: HTMLElement) => {
    Object.assign(el.dataset, {
      reqLeft: '300',
      reqTop: '140',
      reqVw: '1600',
      reqVh: '900',
      windowMoved: '1',
    });
  };

  it('hands the shown window position to the next tab on desktop', () => {
    hub.open('overview');
    place(members.overview.el);
    hub.open('crafting');
    expect(members.crafting.el.dataset.reqLeft).toBe('300');
    expect(members.crafting.el.dataset.reqTop).toBe('140');
    expect(members.crafting.el.dataset.windowMoved).toBe('1');
  });

  it('carries nothing on touch, where every member is a full-screen sheet', () => {
    touch = true;
    hub.open('overview');
    place(members.overview.el);
    hub.open('crafting');
    expect(members.crafting.el.dataset.windowMoved).toBeUndefined();
  });

  it('an unplaced shown window resets the next one, clearing a past drag', () => {
    // Crafting was dragged once in an earlier session...
    place(members.crafting.el);
    members.crafting.el.style.left = '900px';
    members.crafting.el.style.top = '40px';
    members.crafting.el.style.transform = 'none';
    // ...but the hub is open on an Overview the player never moved.
    hub.open('overview');
    hub.open('crafting');
    expect(members.crafting.el.dataset.windowMoved).toBeUndefined();
    expect(members.crafting.el.dataset.reqLeft).toBeUndefined();
    expect(members.crafting.el.style.left).toBe('');
    expect(members.crafting.el.style.top).toBe('');
    expect(members.crafting.el.style.transform).toBe('');
  });
});

describe('the strip a member paints', () => {
  it('marks its own tab selected and switches tabs on click', () => {
    hub.open('overview');
    const tabs = [...members.overview.el.querySelectorAll<HTMLElement>('.prof-hub-tab')];
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    tabs[3].click();
    expect(shown()).toEqual(['harvest']);
    // Clicking the shown tab does nothing.
    log.length = 0;
    members.harvest.el.querySelector<HTMLElement>('.prof-hub-tab[data-tab="harvest"]')?.click();
    expect(log).toEqual([]);
  });

  it('a keyboard arrow switches tab and focus follows onto the new member strip', () => {
    hub.open('crafting');
    const current = members.crafting.el.querySelector<HTMLElement>('[data-tab="crafting"]');
    current?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(shown()).toEqual(['perfecting']);
    expect(document.activeElement).toBe(
      members.perfecting.el.querySelector('.prof-hub-tab[data-tab="perfecting"]'),
    );
  });
});
