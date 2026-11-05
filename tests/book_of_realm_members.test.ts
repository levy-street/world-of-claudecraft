// @vitest-environment jsdom
// Real Book of the Realm members inside a real hub (menu consolidation step
// 2): the Reputation window (the Character sheet's old tab on its own root)
// and the Book of Deeds in its Titles mode, plus the Deeds rail dropping the
// shelf once the Titles tab exists.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDeedStats } from '../src/sim/deeds';
import { DeedsWindow } from '../src/ui/deeds_window';
import { BOOK_OF_REALM, type BookOfRealmTab } from '../src/ui/hud/hub/book_of_realm_view';
import { WindowHubController, type WindowHubMember } from '../src/ui/hud/hub/window_hub_controller';
import { ReputationWindow } from '../src/ui/hud/reputation/reputation_window';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
}));

const factions: Record<string, number> = { rift_watch: 3_400, church_order: 0, automatons: 0 };
const world = {
  factions,
  player: { level: 20, name: 'Hero' },
  worldQuestLog: new Map(),
  worldQuestExpiresAtMs: 0,
  deedsEarned: new Map(),
  accountDeeds: new Map(),
  deedStats: freshDeedStats(),
  renown: 0,
  activeTitle: null,
  activeBorder: null,
  deedsRarity: async () => null,
  deedsRecent: async () => null,
  entities: new Map(),
  playerId: 1,
  setActiveTitle: () => {},
  setActiveBorder: () => {},
  cfg: { playerClass: 'warrior' },
} as unknown as IWorld;

const root = (id: string): HTMLElement => {
  const el = document.createElement('div');
  el.id = id;
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
};

function idle(): WindowHubMember {
  const el = document.createElement('div');
  const m = { isOpen: false, open: () => {}, close: () => {}, rootElement: () => el };
  return m;
}

let hub: WindowHubController<BookOfRealmTab>;
let repEl: HTMLElement;
let titlesEl: HTMLElement;
let deedsEl: HTMLElement;
let reputation: ReputationWindow;
let titles: DeedsWindow;
let deeds: DeedsWindow;

const deedsDeps = (el: HTMLElement, tab: BookOfRealmTab) => ({
  root: () => el,
  world: () => world,
  closeOthers: () => hub.prepare(tab),
  hideTooltip: () => {},
  consumePeek: () => false,
  captureFocus: () => null,
  restoreFocus: () => {},
  onWatchChanged: () => {},
  itemIcon: () => '',
  moneyHtml: () => '',
  itemTooltip: () => '',
  attachTooltip: () => {},
  hubStrip: hub.stripFor(tab),
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  localStorage.clear();
  repEl = root('reputation-window');
  titlesEl = root('titles-window');
  deedsEl = root('deeds-window');
  hub = new WindowHubController(BOOK_OF_REALM, {
    members: () => ({
      deeds,
      titles,
      reliquary: idle(),
      reputation,
      lootExplorer: idle(),
      rankings: idle(),
    }),
    touch: () => false,
  });
  reputation = new ReputationWindow({
    root: () => repEl,
    world: () => world,
    closeOthers: () => hub.prepare('reputation'),
    captureFocus: () => null,
    restoreFocus: () => {},
    hubStrip: hub.stripFor('reputation'),
  });
  titles = new DeedsWindow({ ...deedsDeps(titlesEl, 'titles'), mode: 'titles' });
  deeds = new DeedsWindow(deedsDeps(deedsEl, 'deeds'));
});

describe('the Reputation window', () => {
  it('paints the faction cards under the Book title, strip and close name', () => {
    hub.open('reputation');
    expect(repEl.style.display).toBe('flex');
    expect(repEl.querySelector('.ui-win-title')?.textContent).toBe('Book of the Realm');
    expect(repEl.querySelector('[data-close]')?.getAttribute('aria-label')).toBe(
      'Close the Book of the Realm',
    );
    expect(
      repEl.querySelector('.realm-hub-tab[data-tab="reputation"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(repEl.querySelectorAll('.char-rep-row')).toHaveLength(3);
  });

  it('repaints on the slow band only when the standings moved', () => {
    hub.open('reputation');
    const before = repEl.querySelector('.reputation-window-body');
    reputation.refreshIfChanged();
    expect(repEl.querySelector('.reputation-window-body')).toBe(before);
    factions.church_order = 1_240;
    reputation.refreshIfChanged();
    expect(repEl.querySelector('.reputation-window-body')).not.toBe(before);
    factions.church_order = 0;
  });

  it('a strip click switches to another tab and hides the reputation root', () => {
    hub.open('reputation');
    repEl.querySelector<HTMLElement>('.realm-hub-tab[data-tab="titles"]')?.click();
    expect(reputation.isOpen).toBe(false);
    expect(repEl.style.display).toBe('none');
    expect(titles.isOpen).toBe(true);
  });
});

describe('the Book of Deeds in the hub', () => {
  it('Titles mode shows only the title and border shelf', () => {
    hub.open('titles');
    expect(titlesEl.querySelector('.deeds-titles')).not.toBeNull();
    expect(titlesEl.querySelector('.deeds-rail')).toBeNull();
    expect(titlesEl.querySelector('.deed-search')).toBeNull();
    expect(titlesEl.querySelector('.deeds-summary')).toBeNull();
  });

  it('the Deeds tab rail drops the shelf row, since Titles is its own tab', () => {
    hub.open('deeds');
    expect(deedsEl.querySelector('.deeds-rail')).not.toBeNull();
    expect(deedsEl.querySelector('[data-cat="titles"]')).toBeNull();
    expect(titles.isOpen).toBe(false);
  });

  it('a deeds open asking for the shelf lands on a real category inside the hub', () => {
    deeds.open('titles');
    expect(deedsEl.querySelector('.deeds-titles')).toBeNull();
    expect(deedsEl.querySelector('.deeds-cat.is-on')?.getAttribute('data-cat')).toBe('progression');
  });
});
