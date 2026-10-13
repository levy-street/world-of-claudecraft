// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DungeonFinderWindow } from '../src/ui/dungeon_finder_window';
import type { IWorld } from '../src/world_api';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

function control<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function setup() {
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
    dungeonFinderBoard: [],
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
    dungeonFinderQueueJoin: vi.fn(),
    dungeonFinderQueueLeave: vi.fn(),
    dungeonFinderRespond: vi.fn(),
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderSetRoles: vi.fn(),
  };
  const showOnMap = vi.fn();
  const window = new DungeonFinderWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    hideTooltip: vi.fn(),
    showOnMap,
    itemIcon: () => '',
    itemTooltip: () => '',
    moneyHtml: () => '',
    attachTooltip: vi.fn(),
  });
  window.open();
  const click = (selector: string) => control<HTMLButtonElement>(root, selector).click();
  return { root, world, window, showOnMap, click };
}

describe('simplified group navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens groups without tabs or a creation form and returns from its secondary guide', () => {
    const { root, window, click } = setup();
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Groups');
    expect(root.querySelector('.df-tabs')).toBeNull();
    expect(root.querySelector('[data-tab="catalogue"]')).toBeNull();
    expect(root.querySelector('[data-createopt]')).toBeNull();
    expect(root.querySelector('[data-tab="queue"]')).toBeNull();
    window.open('catalogue');
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Dungeon Guide');
    expect(root.querySelector('[data-row]')).not.toBeNull();
    click('[data-tab="board"]');
    expect(root.querySelector('[data-start-create]')).not.toBeNull();
    window.open('catalogue');
    window.close();
    window.open();
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Groups');
  });

  it('creates only on publish and cancels back to browsing with keyboard focus restored', () => {
    const { root, world, click } = setup();
    click('[data-start-create]');
    expect(root.querySelector('.df-board-listings')).toBeNull();
    expect(root.querySelector('.df-create-heading [data-act="create"]')).not.toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector('[data-createopt][aria-checked="true"]'),
    );
    click('[data-createopt="gravewyrm_sanctum_heroic"]');
    expect(world.dungeonFinderListingCreate).not.toHaveBeenCalled();
    click('[data-cancel-create]');
    expect(root.querySelector('[data-createopt]')).toBeNull();
    expect(root.querySelector('.df-board-listings')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-start-create]'));
    click('[data-start-create]');
    click('[data-act="create"]');
    expect(world.dungeonFinderListingCreate).toHaveBeenCalledWith('gravewyrm_sanctum_heroic', []);
    expect(world.dungeonFinderSetRoles).toHaveBeenCalledWith(['healer']);
  });

  it('browses from the guide and remembers its difficulty if the player chooses to create', () => {
    const { root, world, window, click } = setup();
    window.open('catalogue');
    click('[data-row="gravewyrm_sanctum_heroic"]');
    click('[data-guide-group]');
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Groups');
    expect(root.querySelector('.df-create')).toBeNull();
    click('[data-start-create]');
    expect(
      root
        .querySelector('[data-createopt="gravewyrm_sanctum_heroic"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    click('[data-act="create"]');
    expect(world.dungeonFinderListingCreate).toHaveBeenCalledWith('gravewyrm_sanctum_heroic', []);
    expect(world.dungeonFinderSetRoles).toHaveBeenCalledWith(['healer']);
    expect(world.dungeonFinderQueueJoin).not.toHaveBeenCalled();
  });

  it('shows the joined group when membership arrives while creating a different group', () => {
    const { root, world, window, click } = setup();
    click('[data-start-create]');
    click('[data-createopt="gravewyrm_sanctum_heroic"]');
    Object.assign(world, {
      partyInfo: {
        leader: 2,
        members: [
          { pid: 2, name: 'RaidLeader', cls: 'warrior', level: 20, role: 'tank' },
          { pid: 1, name: 'Applicant', cls: 'paladin', level: 20, role: 'healer' },
        ],
      },
    });
    window.render();
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Groups');
    expect(root.querySelector('.df-create')).toBeNull();
    expect(root.querySelector('.df-current-group')?.textContent).toContain('RaidLeader');
    expect(root.querySelector('[data-start-create]')).toBeNull();
    expect(world.dungeonFinderListingCreate).not.toHaveBeenCalled();
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
    Object.assign(world, { partyInfo: null });
    window.render();
    expect(root.querySelector('.df-create')).toBeNull();
    expect(root.querySelector('[data-start-create]')).not.toBeNull();
  });

  it('keeps a valid creation draft when the player becomes the party leader', () => {
    const { root, world, window, click } = setup();
    click('[data-start-create]');
    click('[data-createopt="gravewyrm_sanctum_heroic"]');
    Object.assign(world, {
      partyInfo: {
        leader: 1,
        members: [{ pid: 1, name: 'Leader', cls: 'paladin', level: 20, role: 'healer' }],
      },
    });
    window.render();
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Create Group');
    expect(root.querySelector('[data-cancel-create]')).not.toBeNull();
    click('[data-act="create"]');
    expect(world.dungeonFinderListingCreate).toHaveBeenCalledWith('gravewyrm_sanctum_heroic', []);
  });

  it('keeps a running queue reachable so the player can leave from the groups screen', () => {
    const { root, world, window, click } = setup();
    Object.assign(world.dungeonFinderInfo, {
      queue: { activities: ['gravewyrm_sanctum_normal'], waited: 5 },
    });
    window.render();
    click('[data-tab="queue"]');
    click('[data-act="leavequeue"]');
    expect(world.dungeonFinderQueueLeave).toHaveBeenCalledOnce();
    click('[data-tab="board"]');
    expect(root.querySelector('[data-start-create]')).not.toBeNull();
  });
  it('browses groups without substituting another dungeon when the guide activity is unavailable', () => {
    const { root, world, window, click } = setup();
    window.open('catalogue');
    click('[data-row="hollow_crypt_normal"]');
    click('[data-guide-group]');
    expect(root.querySelector('.df-board-shell')).not.toBeNull();
    expect(root.querySelector('.df-create')).toBeNull();
    expect(world.dungeonFinderListingCreate).not.toHaveBeenCalled();
    expect(world.dungeonFinderQueueJoin).not.toHaveBeenCalled();
  });
  it('keeps a pending match actionable while browsing groups and the guide', () => {
    const { root, world, window, click } = setup();
    Object.assign(world.dungeonFinderInfo, {
      proposal: {
        id: 3,
        activityId: 'gravewyrm_sanctum_normal',
        role: 'healer',
        size: 5,
        accepted: 2,
        acceptedByRole: { tank: 1, healer: 0, dps: 1 },
        myResponse: 'pending',
        remaining: 21,
      },
    });
    window.render();
    expect(root.querySelector('.df-proposal')).not.toBeNull();
    click('[data-act="accept"]');
    expect(world.dungeonFinderRespond).toHaveBeenLastCalledWith(true);
    window.open('catalogue');
    click('[data-act="decline"]');
    expect(world.dungeonFinderRespond).toHaveBeenLastCalledWith(false);
  });
  it('filters raids, stages a single role and sends that role before the selected listing', () => {
    const { root, world, click } = setup();
    click('[data-start-create]');
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Create Group');
    expect(root.querySelector('.df-navigation')).toBeNull();
    expect(root.querySelectorAll('[data-create-role]')).toHaveLength(3);
    expect(control<HTMLButtonElement>(root, '[data-create-role="tank"]').disabled).toBe(false);
    click('[data-create-role="dps"]');
    expect(root.querySelectorAll('[data-create-role][aria-pressed="true"]')).toHaveLength(1);
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
    const kind = control<HTMLSelectElement>(root, '[data-create-kind]');
    kind.value = 'raid';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('[data-createopt="gravewyrm_sanctum_normal"]')).toBeNull();
    const selected = control<HTMLElement>(root, '[data-createopt][aria-checked="true"]').dataset
      .createopt;
    click('[data-act="create"]');
    expect(world.dungeonFinderSetRoles).toHaveBeenCalledWith(['dps']);
    expect(world.dungeonFinderListingCreate).toHaveBeenCalledWith(selected, []);
    expect(world.dungeonFinderSetRoles.mock.invocationCallOrder[0]).toBeLessThan(
      world.dungeonFinderListingCreate.mock.invocationCallOrder[0],
    );
  });
  it('does not mutate role on cancel and rejects a pending match that arrives before publish', () => {
    const { root, world, click } = setup();
    click('[data-start-create]');
    click('[data-create-role="dps"]');
    click('[data-cancel-create]');
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
    click('[data-start-create]');
    Object.assign(world.dungeonFinderInfo, {
      queue: { activities: ['gravewyrm_sanctum_normal'], waited: 0 },
    });
    click('[data-act="create"]');
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
    expect(world.dungeonFinderListingCreate).not.toHaveBeenCalled();
    expect(control<HTMLButtonElement>(root, '[data-act="create"]').disabled).toBe(true);
  });
  it('keeps unsupported class roles visible and disabled', () => {
    const { root, world, window, click } = setup();
    world.cfg.playerClass = 'warrior';
    world.talentRole = 'tank';
    world.talentSpec = 'protection';
    world.dungeonFinderInfo.roles = ['tank'];
    window.render();
    click('[data-start-create]');
    expect(root.querySelectorAll('[data-create-role]')).toHaveLength(3);
    expect(control<HTMLButtonElement>(root, '[data-create-role="healer"]').disabled).toBe(true);
    expect(
      control<HTMLButtonElement>(root, '[data-create-role="tank"]').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
