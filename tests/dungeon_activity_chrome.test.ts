// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupedActivityOptionsHtml, quickMatchHtml } from '../src/ui/dungeon_activity_chrome';
import type { FinderQueuePanelView } from '../src/ui/dungeon_finder_view';
import { DungeonFinderWindow } from '../src/ui/dungeon_finder_window';
import type { IWorld } from '../src/world_api';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

function setup() {
  const root = document.createElement('div');
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
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderSetRoles: vi.fn(),
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
  window.open();
  const button = (selector: string) => {
    const element = root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing button: ${selector}`);
    return element;
  };
  return { root, world, window, button, click: (selector: string) => button(selector).click() };
}

describe('grouped dungeon activities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('groups interleaved variants in first-seen order and never invents absent difficulties', () => {
    const root = document.createElement('div');
    root.innerHTML = groupedActivityOptionsHtml(
      [
        {
          id: 'crypt-h',
          dungeonId: 'hollow_crypt',
          difficulty: 'heroic',
          checked: true,
          disabled: false,
        },
        {
          id: 'sanctum',
          dungeonId: 'gravewyrm_sanctum',
          difficulty: 'normal',
          checked: false,
          disabled: true,
        },
        {
          id: 'crypt-n',
          dungeonId: 'hollow_crypt',
          difficulty: 'normal',
          checked: true,
          disabled: false,
        },
      ],
      'queue',
    );
    const groups = [...root.querySelectorAll('.df-activity-group')];
    expect(groups.map((group) => group.getAttribute('data-dungeon'))).toEqual([
      'hollow_crypt',
      'gravewyrm_sanctum',
    ]);
    expect(
      [...groups[0].querySelectorAll('[data-opt]')].map((button) =>
        button.getAttribute('data-opt'),
      ),
    ).toEqual(['crypt-n', 'crypt-h']);
    expect(groups[0].querySelectorAll('.df-activity-name')).toHaveLength(1);
    expect(groups[1].querySelectorAll('button')).toHaveLength(1);
    expect(root.querySelectorAll('[aria-checked="true"]')).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>('[data-opt="sanctum"]')?.disabled).toBe(true);
    expect(root.querySelector('button button')).toBeNull();
  });

  it('keeps quick-match variants independently selectable and joins with their exact IDs', () => {
    const { root, click, button, world, window } = setup();
    window.open('queue');
    const normal = 'gravewyrm_sanctum_normal';
    const heroic = 'gravewyrm_sanctum_heroic';
    expect(root.querySelectorAll('[data-dungeon="gravewyrm_sanctum"]')).toHaveLength(1);
    click(`[data-opt="${normal}"]`);
    click(`[data-opt="${heroic}"]`);
    expect(button(`[data-opt="${normal}"]`).getAttribute('aria-checked')).toBe('true');
    expect(button(`[data-opt="${heroic}"]`).getAttribute('aria-checked')).toBe('true');
    click('[data-act="join"]');
    expect(world.dungeonFinderQueueJoin).toHaveBeenLastCalledWith([normal, heroic]);
    click(`[data-opt="${normal}"]`);
    click('[data-act="join"]');
    expect(world.dungeonFinderQueueJoin).toHaveBeenLastCalledWith([heroic]);
    expect(button('[data-opt="hollow_crypt_normal"]').disabled).toBe(true);
    click('[data-opt="hollow_crypt_normal"]');
    click('[data-act="join"]');
    expect(world.dungeonFinderQueueJoin).toHaveBeenLastCalledWith([heroic]);
    click('[data-role="healer"]');
    expect(world.dungeonFinderSetRoles).toHaveBeenLastCalledWith([]);
  });

  it('keeps premade creation exclusive across dungeon and difficulty and publishes only the selected variant', () => {
    const { root, click, world } = setup();
    click('[data-start-create]');
    expect(root.querySelectorAll('[data-dungeon="gravewyrm_sanctum"]')).toHaveLength(1);
    click('[data-createopt="gravewyrm_sanctum_normal"]');
    click('[data-createopt="gravewyrm_sanctum_heroic"]');
    const checked = root.querySelectorAll('[data-createopt][aria-checked="true"]');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('data-createopt')).toBe('gravewyrm_sanctum_heroic');
    expect(root.querySelector('[data-createopt="hollow_crypt_normal"]')).toBeNull();
    click('[data-act="create"]');
    expect(world.dungeonFinderListingCreate).toHaveBeenLastCalledWith(
      'gravewyrm_sanctum_heroic',
      [],
    );
  });

  it('locks all activity buttons while queued and preserves leave and cooldown controls', () => {
    const queue: FinderQueuePanelView = {
      roles: [],
      inParty: false,
      isLeader: true,
      queuedActivities: ['crypt'],
      queued: true,
      onCooldown: false,
      canQueue: false,
      proposal: null,
      options: [
        {
          id: 'crypt',
          dungeonId: 'hollow_crypt',
          difficulty: 'normal',
          kind: 'dungeon',
          eligible: true,
          blocked: null,
          checked: true,
        },
      ],
    };
    const root = document.createElement('div');
    root.innerHTML = quickMatchHtml(queue);
    expect(root.querySelector<HTMLButtonElement>('[data-opt]')?.disabled).toBe(true);
    expect(root.querySelector('[data-df-clock="waited"]')).not.toBeNull();
    expect(root.querySelector('[data-act="leavequeue"]')).not.toBeNull();
    expect(root.querySelector('[data-act="join"]')).toBeNull();
    root.innerHTML = quickMatchHtml({ ...queue, queued: false, onCooldown: true });
    expect(root.querySelector('[data-df-clock="cooldown"]')).not.toBeNull();
    expect(root.querySelector('[data-act="join"]')).toBeNull();
  });
});
