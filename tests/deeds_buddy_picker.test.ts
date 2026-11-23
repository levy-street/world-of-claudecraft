// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDeedStats } from '../src/sim/deeds';
import { DeedsWindow, type DeedsWindowDeps } from '../src/ui/deeds_window';

vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
  itemImageUrl: (id: string) => `/ui/items/${id}.webp`,
}));

interface WorldState {
  owned: string[];
  active: string;
}

function baseState(over: Partial<WorldState> = {}): WorldState {
  return { owned: [], active: '', ...over };
}

interface Harness {
  w: DeedsWindow;
  el: HTMLElement;
  summonBuddy: ReturnType<typeof vi.fn>;
  ownedBuddies: ReturnType<typeof vi.fn>;
  setActiveTitle: ReturnType<typeof vi.fn>;
  setActiveBorder: ReturnType<typeof vi.fn>;
}

function makeWindow(state: WorldState): Harness {
  const el = document.createElement('div');
  el.id = 'deeds-window';
  document.body.appendChild(el);
  const stats = freshDeedStats();
  const summonBuddy = vi.fn();
  const ownedBuddies = vi.fn(() => state.owned);
  const setActiveTitle = vi.fn();
  const setActiveBorder = vi.fn();
  const deps: DeedsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        deedsEarned: new Map(),
        // The account-wide Book (release/v0.44.0): no other character on this
        // account has earned anything in the fixture.
        accountDeeds: new Map(),
        deedStats: stats,
        renown: 0,
        activeTitle: null,
        activeBorder: null,
        setActiveTitle,
        setActiveBorder,
        deedsRarity: async () => null,
        deedsRecent: async () => null,
        ownedBuddies,
        summonBuddy,
        playerId: 1,
        get entities() {
          return new Map([[1, { buddyKey: state.active }]]);
        },
        cfg: { playerClass: 'warrior' },
        player: { name: 'Hero' },
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    onWatchChanged: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  const w = new DeedsWindow(deps);
  w.open('titles');
  return { w, el, summonBuddy, ownedBuddies, setActiveTitle, setActiveBorder };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Book of Deeds excludes buddy controls', () => {
  it.each([
    baseState(),
    baseState({ owned: ['horse', 'crystal_lich', 'forgemaw'], active: 'horse' }),
  ])('has no companion shelf or drag controls regardless of collection state', (state) => {
    const { w, el, summonBuddy, ownedBuddies } = makeWindow(state);
    expect(el.querySelector('.deeds-buddies, [data-buddy-pick], [data-buddy-drag]')).toBeNull();
    expect(el.textContent).not.toContain('Buddies');
    state.owned.push('forgemaw');
    state.active = 'forgemaw';
    w.refreshIfChanged();
    expect(ownedBuddies).not.toHaveBeenCalled();
    expect(summonBuddy).not.toHaveBeenCalled();
    expect(el.querySelector('.deeds-buddies, [data-buddy-pick], [data-buddy-drag]')).toBeNull();
  });

  it('retains the independent title and border controls', () => {
    const { el, setActiveTitle, setActiveBorder, summonBuddy } = makeWindow(
      baseState({ owned: ['horse'], active: 'horse' }),
    );
    expect(el.querySelectorAll('.deeds-picker-head')).toHaveLength(2);
    (el.querySelector('[data-title=""]') as HTMLElement).click();
    expect(setActiveTitle).toHaveBeenCalledWith(null);
    expect(setActiveBorder).not.toHaveBeenCalled();
    (el.querySelector('[data-border-pick=""]') as HTMLElement).click();
    expect(setActiveBorder).toHaveBeenCalledWith(null);
    expect(summonBuddy).not.toHaveBeenCalled();
  });
});
