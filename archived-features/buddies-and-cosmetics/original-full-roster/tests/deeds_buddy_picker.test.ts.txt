// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDeedStats } from '../src/sim/deeds';
import { DeedsWindow, type DeedsWindowDeps } from '../src/ui/deeds_window';
import { BUDDY_DRAG_ATTR } from '../src/ui/hud/action_bar/buddy_drag';

vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
  itemImageUrl: (id: string) => `/ui/items/${id}.webp`,
}));

interface WorldState {
  owned: string[];
  active: string;
  looks: string[];
  equipped: Record<string, string>;
  /** False models the ONLINE mirror: the command goes out, the local read does
   *  not move until the snapshot echo lands. */
  applyLocally: boolean;
}

function baseState(over: Partial<WorldState> = {}): WorldState {
  return { owned: [], active: '', looks: [], equipped: {}, applyLocally: true, ...over };
}

interface Harness {
  w: DeedsWindow;
  el: HTMLElement;
  summonBuddy: ReturnType<typeof vi.fn>;
  equipBuddyCosmetic: ReturnType<typeof vi.fn>;
}

function makeWindow(state: WorldState): Harness {
  const el = document.createElement('div');
  el.id = 'deeds-window';
  document.body.appendChild(el);
  const stats = freshDeedStats();
  const summonBuddy = vi.fn((key: string) => {
    if (state.applyLocally) state.active = state.active === key ? '' : key;
  });
  const equipBuddyCosmetic = vi.fn((key: string, id: string | null) => {
    if (!state.applyLocally) return;
    if (id === null) delete state.equipped[key];
    else state.equipped[key] = id;
  });
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
        setActiveTitle: () => {},
        setActiveBorder: () => {},
        deedsRarity: async () => null,
        deedsRecent: async () => null,
        ownedBuddies: () => state.owned,
        ownedBuddyCosmetics: () => state.looks,
        equippedBuddyCosmetics: () => state.equipped,
        summonBuddy,
        equipBuddyCosmetic,
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
    setDragAction: () => {},
    clearActionDropTargets: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  const w = new DeedsWindow(deps);
  w.open('titles');
  return { w, el, summonBuddy, equipBuddyCosmetic };
}

const picks = (el: HTMLElement, attr: string): string[] =>
  [...el.querySelectorAll<HTMLElement>(`[${attr}]`)].map((btn) => btn.getAttribute(attr) ?? '');
const pressed = (el: HTMLElement, attr: string): string[] =>
  [...el.querySelectorAll<HTMLElement>(`[${attr}][aria-pressed="true"]`)].map(
    (btn) => btn.getAttribute(attr) ?? '',
  );

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Book of Deeds buddy shelf', () => {
  it('lists only the collected companions behind a None head, catalog order kept', () => {
    const { el } = makeWindow(baseState({ owned: ['ember_fox', 'stag'] }));
    expect(picks(el, 'data-buddy-pick')).toEqual(['', 'ember_fox', 'stag']);
    // Every collected companion carries the drag grip for the action bar.
    expect(picks(el, BUDDY_DRAG_ATTR)).toEqual(['ember_fox', 'stag']);
  });

  it('renders the empty line and only None with nothing collected', () => {
    const { el } = makeWindow(baseState());
    expect(picks(el, 'data-buddy-pick')).toEqual(['']);
    expect(el.querySelector('.deeds-buddies .deeds-empty')).not.toBeNull();
  });

  it('marks the summoned companion pressed and leaves None unpressed', () => {
    const { el } = makeWindow(baseState({ owned: ['ember_fox', 'stag'], active: 'stag' }));
    expect(pressed(el, 'data-buddy-pick')).toEqual(['stag']);
  });

  it('a pick summons that companion; None and the active pick dismiss', () => {
    const state = baseState({ owned: ['ember_fox', 'stag'] });
    const { el, summonBuddy } = makeWindow(state);
    (el.querySelector('[data-buddy-pick="stag"]') as HTMLElement).click();
    expect(summonBuddy).toHaveBeenLastCalledWith('stag');
    expect(pressed(el, 'data-buddy-pick')).toEqual(['stag']);
    (el.querySelector('[data-buddy-pick=""]') as HTMLElement).click();
    // None dismisses whatever is out: the toggle is sent for the active key.
    expect(summonBuddy).toHaveBeenLastCalledWith('stag');
    expect(pressed(el, 'data-buddy-pick')).toEqual(['']);
    summonBuddy.mockClear();
    (el.querySelector('[data-buddy-pick=""]') as HTMLElement).click();
    expect(summonBuddy).not.toHaveBeenCalled();
  });

  it('the looks group follows the summoned companion: its unlocked looks only', () => {
    const state = baseState({
      owned: ['stag', 'frog'],
      active: 'stag',
      looks: ['stag_gilded', 'frog_sapphire'],
    });
    const { el, equipBuddyCosmetic } = makeWindow(state);
    expect(picks(el, 'data-look-pick')).toEqual(['', 'stag_gilded']);
    expect(pressed(el, 'data-look-pick')).toEqual(['']);
    (el.querySelector('[data-look-pick="stag_gilded"]') as HTMLElement).click();
    expect(equipBuddyCosmetic).toHaveBeenLastCalledWith('stag', 'stag_gilded');
    expect(pressed(el, 'data-look-pick')).toEqual(['stag_gilded']);
    (el.querySelector('[data-look-pick=""]') as HTMLElement).click();
    expect(equipBuddyCosmetic).toHaveBeenLastCalledWith('stag', null);
  });

  it('with no companion out the looks group is only its head and says so', () => {
    const { el, equipBuddyCosmetic } = makeWindow(
      baseState({ owned: ['stag'], looks: ['stag_gilded'] }),
    );
    expect(picks(el, 'data-look-pick')).toEqual(['']);
    expect(el.querySelector('.deeds-buddy-looks .deeds-empty')).not.toBeNull();
    (el.querySelector('[data-look-pick=""]') as HTMLElement).click();
    expect(equipBuddyCosmetic).not.toHaveBeenCalled();
  });

  it('writes nothing optimistically: the marks follow the world reads', () => {
    const state = baseState({ owned: ['stag'], applyLocally: false });
    const { el } = makeWindow(state);
    (el.querySelector('[data-buddy-pick="stag"]') as HTMLElement).click();
    expect(pressed(el, 'data-buddy-pick')).toEqual(['']);
  });

  it('the drag grip never counts as a pick', () => {
    const state = baseState({ owned: ['stag'] });
    const { el, summonBuddy } = makeWindow(state);
    (el.querySelector(`[${BUDDY_DRAG_ATTR}="stag"]`) as HTMLElement).click();
    expect(summonBuddy).not.toHaveBeenCalled();
  });
});
