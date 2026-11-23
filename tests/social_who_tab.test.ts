// @vitest-environment happy-dom

// The Social window's Who tab, driven through the real SocialWindow painter over
// happy-dom: the tab asks the server on select (and on a /who chat command),
// paints the delivered roster sorted by the pure core, re-sorts locally on a
// column click, narrows on the class chip, submits the footer search as a new
// request, and whispers from a row. Offline the tab shows the shared "online
// play" empty state and /who falls through to the world.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHO_FILTER_MAX } from '../server/who_roster';
import { SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import type { IWorld, WhoRosterInfo } from '../src/world_api';

interface TestWorld {
  socialInfo: {
    friends: { name: string; cls: string; level: number; online: boolean }[];
    ignores: [];
    blocks: [];
    guild: null;
    myPledge: null;
  } | null;
  entities: Map<number, { id: number; kind: string; name: string }>;
  whoInfo: WhoRosterInfo | null;
  whoRequest: ReturnType<typeof vi.fn>;
  spectating: string | null;
  partyInfo: IWorld['partyInfo'];
}

const ROSTER: WhoRosterInfo = {
  filter: '',
  limit: 200,
  total: 3,
  rows: [
    { name: 'Mira', cls: 'priest', level: 30, zone: 'Ashwood', status: 'online', guild: '' },
    { name: 'Aleron', cls: 'warrior', level: 12, zone: 'Ashwood', status: 'combat', guild: 'Moon' },
    { name: 'Bryn', cls: 'mage', level: 41, zone: 'Ashwood', status: 'afk', guild: 'Pact' },
  ],
};

let world: TestWorld;
let root: HTMLElement;
let whispers: string[];
// Which of the three player menus a row opened (self / unit frame / by name).
type MenuOpen =
  | { menu: 'self'; x: number; y: number }
  | { menu: 'unit'; pid: number; name: string; x: number; y: number }
  | { menu: 'name'; name: string; x: number; y: number };
let menus: MenuOpen[];
let mobile: boolean;

beforeEach(() => {
  document.body.innerHTML = '';
  whispers = [];
  menus = [];
  mobile = false;
  world = {
    socialInfo: { friends: [], ignores: [], blocks: [], guild: null, myPledge: null },
    entities: new Map([[7, { id: 7, kind: 'player', name: 'Aleron' }]]),
    whoInfo: null,
    whoRequest: vi.fn(),
    spectating: null,
    partyInfo: null,
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

function makeWindow(): SocialWindow {
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
        entities: world.entities,
        realm: 'Ashenvale',
        socialInfo: world.socialInfo,
        partyInfo: world.partyInfo,
        whoInfo: world.whoInfo,
        whoRequest: world.whoRequest,
        spectating: world.spectating,
        searchCharacters: async () => [],
      }) as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showPrompt: noop,
    startWhisper: (name) => whispers.push(name),
    openSelfMenu: (x, y) => menus.push({ menu: 'self', x, y }),
    openUnitMenu: (pid, name, x, y) => menus.push({ menu: 'unit', pid, name, x, y }),
    openNameMenu: (name, x, y) => menus.push({ menu: 'name', name, x, y }),
    isMobileLayout: () => mobile,
  };
  return new SocialWindow(deps);
}

function rowNames(): string[] {
  return Array.from(root.querySelectorAll('.soc-who-row:not(.soc-who-header) .who-name')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

function clickTab(id: string): void {
  (root.querySelector(`[data-tab="${id}"]`) as HTMLElement | null)?.click();
}

describe('Who tab: request on select, paint on answer', () => {
  it('asks the server for the unfiltered roster when the tab is selected', () => {
    const win = makeWindow();
    win.toggle();
    expect(world.whoRequest).not.toHaveBeenCalled();
    clickTab('who');
    expect(world.whoRequest).toHaveBeenCalledWith('');
    expect(root.querySelector('.soc-empty')?.textContent).toContain('Asking the realm');
  });

  it('paints the delivered rows in name order once the answer lands', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    expect(rowNames()).toEqual(['Aleron', 'Bryn', 'Mira']);
    expect(root.querySelector('.soc-who-count')?.textContent).toContain('3 online');
    // the viewer's own row is plain text; everyone else is a whisper button
    expect(root.querySelector('.who-name .soc-link[data-whisper="Aleron"]')).toBeNull();
    expect(root.querySelector('.who-name .soc-link[data-whisper="Bryn"]')).not.toBeNull();
    expect(
      Array.from(root.querySelectorAll('.soc-who-row:not(.soc-who-header) .who-guild')).map(
        (el) => el.textContent,
      ),
    ).toEqual(['Moon', 'Pact', '']);
  });

  it('re-sorts locally on a column header click (no new request)', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    world.whoRequest.mockClear();
    (root.querySelector('[data-act="who-sort"][data-key="level"]') as HTMLElement).click();
    expect(rowNames()).toEqual(['Bryn', 'Mira', 'Aleron']);
    expect(root.querySelector('.who-level[role="columnheader"]')?.getAttribute('aria-sort')).toBe(
      'descending',
    );
    (root.querySelector('[data-act="who-sort"][data-key="level"]') as HTMLElement).click();
    expect(rowNames()).toEqual(['Aleron', 'Mira', 'Bryn']);
    expect(world.whoRequest).not.toHaveBeenCalled();
  });

  it('narrows on the class chip locally', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    const select = root.querySelector('select[data-field="who-cls"]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      'mage',
      'priest',
      'warrior',
    ]);
    select.value = 'mage';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowNames()).toEqual(['Bryn']);
    expect(root.querySelector('.soc-who-count')?.textContent).toContain('1 of 3 online');
  });

  it('keeps focus on the re-rendered sort header across the next slow ticks', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    (root.querySelector('[data-act="who-sort"][data-key="level"]') as HTMLElement).click();
    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.key;
    expect(focused()).toBe('level');
    // the handler re-latched the content signature, so these ticks rebuild nothing
    win.refreshIfChanged();
    win.refreshIfChanged();
    expect(focused()).toBe('level');
    expect(rowNames()).toEqual(['Bryn', 'Mira', 'Aleron']);
  });

  it('ignores party hp/resource churn: no rebuild, focus stays on the header and the chip', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    world.partyInfo = {
      raid: false,
      leader: 7,
      members: [{ pid: 9, name: 'Mira', cls: 'priest', level: 30, hp: 900, maxHp: 1000, group: 0 }],
    } as unknown as IWorld['partyInfo'];
    win.refreshIfChanged();
    (root.querySelector('[data-act="who-sort"][data-key="level"]') as HTMLElement).click();
    const list = root.querySelector('.soc-who-list');
    // in combat the party mirror moves every tick; the Who tab paints none of it
    const party = world.partyInfo as unknown as { members: { hp: number }[] };
    party.members[0].hp = 850;
    win.refreshIfChanged();
    party.members[0].hp = 790;
    win.refreshIfChanged();
    expect((document.activeElement as HTMLElement | null)?.dataset.key).toBe('level');
    expect(root.querySelector('.soc-who-list')).toBe(list);
    // a repaint the tab DOES need (a fresh answer) hands focus back to the same header
    world.whoInfo = { ...ROSTER, rows: [...ROSTER.rows] };
    win.refreshIfChanged();
    expect(root.querySelector('.soc-who-list')).not.toBe(list);
    expect((document.activeElement as HTMLElement | null)?.dataset.key).toBe('level');
    // and the class chip survives a repaint the same way
    const select = root.querySelector('select[data-field="who-cls"]') as HTMLSelectElement;
    select.focus();
    world.whoInfo = { ...ROSTER, rows: [...ROSTER.rows] };
    win.refreshIfChanged();
    expect(document.activeElement).toBe(root.querySelector('select[data-field="who-cls"]'));
  });

  it('repaints a fresh answer whose filter, row count, and total match the last one', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = { ...ROSTER, total: 2, rows: ROSTER.rows.slice(0, 2) };
    win.refreshIfChanged();
    expect(rowNames()).toEqual(['Aleron', 'Mira']);
    // re-submit the same (empty) search: someone logged off, someone else logged on
    (root.querySelector('[data-act="who-search"]') as HTMLElement).click();
    world.whoInfo = {
      ...ROSTER,
      total: 2,
      rows: [
        ROSTER.rows[0],
        { name: 'Zed', cls: 'rogue', level: 9, zone: 'Ashwood', status: 'online', guild: '' },
      ],
    };
    win.refreshIfChanged();
    expect(rowNames()).toEqual(['Mira', 'Zed']);
    // the same answer object across later ticks does not repaint again
    const list = root.querySelector('.soc-who-list');
    win.refreshIfChanged();
    win.refreshIfChanged();
    expect(root.querySelector('.soc-who-list')).toBe(list);
  });

  it('re-asks every few slow ticks while the roster is still pending', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    expect(world.whoRequest).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) win.refreshIfChanged();
    expect(world.whoRequest).toHaveBeenCalledTimes(1);
    win.refreshIfChanged();
    expect(world.whoRequest).toHaveBeenCalledTimes(2);
    // an answer stops the retries
    world.whoInfo = ROSTER;
    for (let i = 0; i < 8; i++) win.refreshIfChanged();
    expect(world.whoRequest).toHaveBeenCalledTimes(2);
  });

  it('caps the footer search at the server filter length', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    const input = root.querySelector('input[data-field="who"]') as HTMLInputElement;
    expect(Number(input.getAttribute('maxlength'))).toBe(WHO_FILTER_MAX);
  });

  it('submits the footer search as a new server request', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoRequest.mockClear();
    const input = root.querySelector('input[data-field="who"]') as HTMLInputElement;
    input.value = 'Moon';
    (root.querySelector('[data-act="who-search"]') as HTMLElement).click();
    expect(world.whoRequest).toHaveBeenCalledWith('Moon');
  });

  it('whispers from a row', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    (root.querySelector('.who-name .soc-link[data-whisper="Bryn"]') as HTMLElement).click();
    expect(whispers).toEqual(['Bryn']);
  });

  it('opens the player menu from a right-click anywhere on a row, at the cursor', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    const cell = root.querySelector('[data-player="Bryn"] .who-zone') as HTMLElement;
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    });
    cell.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // Bryn has no entity in view, so there is no frame to mirror: the by-name menu.
    expect(menus).toEqual([{ menu: 'name', name: 'Bryn', x: 120, y: 80 }]);
    expect(whispers).toEqual([]);
  });

  it('keeps the native menu for a right-click outside any player row', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    (root.querySelector('select[data-field="who-cls"]') as HTMLElement).dispatchEvent(ev);
    (root.querySelector('.soc-who-header') as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(menus).toEqual([]);
  });

  it('still opens the player menu after a content refresh swaps the rows', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    world.whoInfo = { ...ROSTER, total: 2, rows: ROSTER.rows.slice(0, 2) };
    win.refreshIfChanged();
    (root.querySelector('[data-player="Mira"]') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }),
    );
    expect(menus).toEqual([{ menu: 'name', name: 'Mira', x: 5, y: 6 }]);
  });

  function rightClick(selector: string, x = 30, y = 40): void {
    (root.querySelector(selector) as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }

  it('opens the unit-frame menu, keyed by pid, for a player in view', () => {
    world.entities.set(12, { id: 12, kind: 'player', name: 'Bryn' });
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    rightClick('[data-player="Bryn"]');
    expect(menus).toEqual([{ menu: 'unit', pid: 12, name: 'Bryn', x: 30, y: 40 }]);
  });

  it('opens your own player-frame menu from your own row', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = ROSTER;
    win.refreshIfChanged();
    rightClick('[data-player="Aleron"]');
    expect(menus).toEqual([{ menu: 'self', x: 30, y: 40 }]);
  });

  it('routes every row to the by-name menu while spectating', () => {
    world.entities.set(12, { id: 12, kind: 'player', name: 'Bryn' });
    world.spectating = 'Aleron';
    const win = makeWindow();
    win.toggle();
    clickTab('raid');
    world.partyInfo = {
      raid: true,
      leader: 7,
      members: [{ pid: 12, name: 'Bryn', cls: 'mage', level: 41, hp: 1, mhp: 1, group: 1 }],
    } as unknown as IWorld['partyInfo'];
    win.refreshIfChanged();
    rightClick('[data-player="Bryn"]');
    expect(menus).toEqual([{ menu: 'name', name: 'Bryn', x: 30, y: 40 }]);
  });

  it('a raid row opens the pid-keyed unit menu even for a member out of view', () => {
    world.partyInfo = {
      raid: true,
      leader: 7,
      members: [
        { pid: 7, name: 'Aleron', cls: 'warrior', level: 12, hp: 1, mhp: 1, group: 1 },
        { pid: 33, name: 'Faraway', cls: 'mage', level: 41, hp: 1, mhp: 1, group: 2 },
      ],
    } as unknown as IWorld['partyInfo'];
    const win = makeWindow();
    win.toggle();
    clickTab('raid');
    rightClick('[data-player="Faraway"] .soc-meta');
    rightClick('[data-player="Aleron"]');
    expect(menus).toEqual([
      { menu: 'unit', pid: 33, name: 'Faraway', x: 30, y: 40 },
      { menu: 'self', x: 30, y: 40 },
    ]);
  });

  it('a friend row (offline, out of view) opens the by-name menu', () => {
    world.socialInfo = {
      friends: [{ name: 'Oldpal', cls: 'rogue', level: 20, online: false }],
      ignores: [],
      blocks: [],
      guild: null,
      myPledge: null,
    };
    const win = makeWindow();
    win.toggle();
    rightClick('[data-player="Oldpal"]');
    expect(menus).toEqual([{ menu: 'name', name: 'Oldpal', x: 30, y: 40 }]);
  });

  it('a touch long-press on a row opens the menu in the mobile layout, and eats the click', () => {
    vi.useFakeTimers();
    try {
      mobile = true;
      const win = makeWindow();
      win.toggle();
      clickTab('who');
      world.whoInfo = ROSTER;
      win.refreshIfChanged();
      const name = root.querySelector('.soc-link[data-whisper="Bryn"]') as HTMLElement;
      name.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          pointerId: 1,
          clientX: 50,
          clientY: 60,
        }),
      );
      vi.advanceTimersByTime(700);
      expect(menus).toEqual([{ menu: 'name', name: 'Bryn', x: 50, y: 60 }]);
      // The lifted finger's click must not also start a whisper.
      name.click();
      expect(whispers).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a touch long-press does nothing outside the mobile layout', () => {
    vi.useFakeTimers();
    try {
      const win = makeWindow();
      win.toggle();
      clickTab('who');
      world.whoInfo = ROSTER;
      win.refreshIfChanged();
      (root.querySelector('[data-player="Bryn"]') as HTMLElement).dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1 }),
      );
      vi.advanceTimersByTime(700);
      expect(menus).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when the server capped the answer', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    world.whoInfo = { ...ROSTER, total: 500 };
    win.refreshIfChanged();
    expect(root.querySelector('.soc-who-capped')?.textContent).toContain('first 3');
  });
});

describe('Who tab: the /who chat command', () => {
  it('opens the window on the Who tab with the filter applied and requests it', () => {
    const win = makeWindow();
    expect(win.isOpen).toBe(false);
    expect(win.openWhoTab('Thornpeak')).toBe(true);
    expect(win.isOpen).toBe(true);
    expect(root.querySelector('.soc-tab.on')?.getAttribute('data-tab')).toBe('who');
    expect(world.whoRequest).toHaveBeenCalledWith('Thornpeak');
    expect((root.querySelector('input[data-field="who"]') as HTMLInputElement).value).toBe(
      'Thornpeak',
    );
  });

  it('switches an open window to the Who tab', () => {
    const win = makeWindow();
    win.toggle();
    clickTab('guild');
    expect(win.openWhoTab('')).toBe(true);
    expect(root.querySelector('.soc-tab.on')?.getAttribute('data-tab')).toBe('who');
  });

  it('declines while spectating (every command but chat is dropped there)', () => {
    world.spectating = 'Bryn';
    const win = makeWindow();
    expect(win.openWhoTab('')).toBe(false);
    expect(world.whoRequest).not.toHaveBeenCalled();
  });

  it('shows the online-only empty state on the tab while spectating, and never asks', () => {
    world.spectating = 'Bryn';
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    for (let i = 0; i < 8; i++) win.refreshIfChanged();
    expect(world.whoRequest).not.toHaveBeenCalled();
    expect(root.querySelector('.soc-empty')).not.toBeNull();
    expect(root.querySelector('.soc-who-list')).toBeNull();
  });

  it('declines offline so the line falls through to the world', () => {
    world.socialInfo = null;
    const win = makeWindow();
    expect(win.openWhoTab('')).toBe(false);
    expect(win.isOpen).toBe(false);
    expect(world.whoRequest).not.toHaveBeenCalled();
  });

  it('shows the shared online-only empty state on the tab offline', () => {
    world.socialInfo = null;
    const win = makeWindow();
    win.toggle();
    clickTab('who');
    expect(world.whoRequest).not.toHaveBeenCalled();
    expect(root.querySelector('.soc-empty')).not.toBeNull();
    expect(root.querySelector('.soc-who-list')).toBeNull();
  });
});
