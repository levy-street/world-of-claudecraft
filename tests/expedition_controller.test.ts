// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpeditionController } from '../src/ui/hud/expeditions';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { IWorld, RaidLockout } from '../src/world_api';
import type { DungeonFinderBoard, DungeonFinderInfo } from '../src/world_api/dungeon_finder';

function setup() {
  const world = {
    playerId: 1,
    player: { inCombat: false, level: 8 },
    partyInfo: null,
    raidLockouts: vi.fn((): RaidLockout[] => []),
    dungeonFinderInfo: {
      roles: ['tank'],
      eligibleRoles: ['tank', 'dps'],
      cooldown: 0,
      queue: null,
      proposal: null,
      myListing: null,
      myApplication: null,
    } as DungeonFinderInfo,
    dungeonFinderBoard: [
      {
        id: 3,
        activityId: 'hollow_crypt_normal',
        leaderName: 'Mira',
        tags: [],
        size: 1,
        capacity: 5,
        needed: { tank: 0, healer: 1, dps: 3 },
        members: [],
      },
    ] as DungeonFinderBoard,
  };
  const deps = {
    world: () => world as unknown as IWorld,
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
    openFinder: vi.fn(),
    notify: vi.fn(),
  };
  const controller = new ExpeditionController(deps);
  controller.render();
  return { world, deps, controller };
}
const badge = () => document.querySelector('[data-badge]');

describe('unified Groups notification bell', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    localStorage.clear();
  });

  it('has one entry button and opens Groups without constructing another finder', () => {
    const { deps, controller } = setup();
    expect(document.querySelectorAll('#expedition-hud button')).toHaveLength(1);
    const bell = document.getElementById('expedition-bell')!;
    expect(bell.getAttribute('aria-controls')).toBe('dungeon-finder-window');
    expect(badge()?.textContent).toBe('1');
    bell.click();
    expect(deps.openFinder).toHaveBeenCalledOnce();
    expect(document.getElementById('expedition-panel')).toBeNull();
    expect(document.querySelector('[data-expedition-notice]')).toBeNull();
    expect(badge()?.textContent).toBe('0');
    controller.toggle('alerts');
    expect(deps.openFinder).toHaveBeenCalledTimes(2);
    expect(controller.close()).toBe(false);
  });

  it('counts new compatible rows, excludes full or level/role-ineligible rows and pending requests', () => {
    const { world, controller } = setup();
    const row = world.dungeonFinderBoard[0];
    world.dungeonFinderBoard.push(
      { ...row, id: 4, size: 5 },
      { ...row, id: 5, activityId: 'wildheart_basin_heroic' },
      { ...row, id: 6, needed: { tank: 0, dps: 0, healer: 1 } },
      { ...row, id: 7 },
    );
    world.dungeonFinderInfo.myApplications = [{ listingId: 7, remaining: 50 }];
    controller.render();
    expect(badge()?.textContent).toBe('1');
    world.player.level = 20;
    controller.render();
    // The normal crypt's finder level band has an upper bound too.
    expect(badge()?.textContent).toBe('1');
    world.dungeonFinderBoard = [row];
    controller.render();
    expect(badge()?.textContent).toBe('0');
    world.player.level = 8;
    controller.toggle();
    world.dungeonFinderBoard.push({ ...row, id: 8 });
    controller.render();
    expect(badge()?.textContent).toBe('1');
    world.dungeonFinderBoard = [];
    controller.render();
    expect(badge()?.textContent).toBe('0');
  });

  it('excludes locked raids including shared rooms, independently for each difficulty', () => {
    const { world, controller } = setup();
    world.player.level = 20;
    const row = world.dungeonFinderBoard[0];
    world.dungeonFinderBoard = [
      { ...row, id: 4, activityId: 'ignivar_raid_arena_normal' },
      { ...row, id: 5, activityId: 'ignivar_raid_arena_heroic' },
    ];
    world.raidLockouts.mockReturnValue([{ id: 'ignivar_inner_crucible', msRemaining: 60_000 }]);
    controller.render();
    expect(badge()?.textContent).toBe('1');
    world.raidLockouts.mockReturnValue([
      { id: 'ignivar_inner_crucible', msRemaining: 60_000 },
      { id: 'ignivar_raid_arena:heroic', msRemaining: 60_000 },
    ]);
    controller.render();
    expect(badge()?.textContent).toBe('0');
    world.raidLockouts.mockReturnValue([
      { id: 'ignivar_inner_crucible', msRemaining: 0 },
      { id: 'ignivar_raid_arena:heroic', msRemaining: 0 },
    ]);
    controller.render();
    expect(badge()?.textContent).toBe('2');
  });

  it('keeps actionable applicants visible until resolved and never opens automatically', () => {
    const { world, controller, deps } = setup();
    world.dungeonFinderInfo.myListing = {
      id: 10,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [
        { pid: 4, name: 'Ana', cls: 'priest', level: 8, roles: ['healer'], remaining: 50 },
        { pid: 5, name: 'Expired', cls: 'priest', level: 8, roles: ['healer'], remaining: 0 },
      ],
    };
    controller.render();
    expect(badge()?.textContent).toBe('1');
    expect(deps.openFinder).not.toHaveBeenCalled();
    controller.toggle();
    expect(badge()?.textContent).toBe('1');
    world.dungeonFinderInfo.myListing.applicants[0].remaining = 0;
    controller.render();
    expect(badge()?.textContent).toBe('0');
  });

  it('defers optional sound in combat and sounds once without showing a popup', () => {
    const { world, controller, deps } = setup();
    localStorage.setItem('woc_expedition_sound', '1');
    world.player.inCombat = true;
    world.dungeonFinderBoard.push({ ...world.dungeonFinderBoard[0], id: 4 });
    controller.render();
    expect(deps.notify).not.toHaveBeenCalled();
    world.player.inCombat = false;
    controller.render();
    controller.render();
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(deps.openFinder).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does no DOM work on unchanged medium polls or countdown-only updates', () => {
    const { controller } = setup();
    const root = document.getElementById('expedition-hud')!;
    const query = vi.spyOn(root, 'querySelector');
    const observer = new MutationObserver(() => {});
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    for (let n = 0; n < 20; n++) controller.render();
    expect(query).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('keeps outside clicks independent and preserves the active Groups focus', () => {
    const { deps, controller } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    controller.render();
    controller.close();
    expect(document.activeElement).toBe(input);
    expect(deps.openFinder).not.toHaveBeenCalled();
  });

  it('replaces prior HUD ownership and resets read state when worlds change', () => {
    const previous = setup();
    const current = setup();
    previous.controller.toggle();
    document.getElementById('expedition-bell')!.click();
    expect(previous.deps.openFinder).not.toHaveBeenCalled();
    expect(current.deps.openFinder).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#expedition-bell')).toHaveLength(1);
    current.deps.world = () => ({ ...current.world }) as unknown as IWorld;
    current.controller.render();
    expect(badge()?.textContent).toBe('1');
  });
});
