// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DungeonFinderWindow } from '../src/ui/dungeon_finder_window';
import { DungeonGroupControls } from '../src/ui/dungeon_group_controls';
import type { IWorld } from '../src/world_api';
import type { DungeonFinderInfo } from '../src/world_api/dungeon_finder';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

function setup() {
  const info: DungeonFinderInfo = {
    roles: ['tank'],
    eligibleRoles: ['tank', 'dps'],
    queue: null,
    cooldown: 0,
    proposal: null,
    myListing: null,
    myApplication: null,
    expedition: {
      exitId: 4,
      activityId: 'hollow_crypt_normal',
      dungeonId: 'hollow_crypt',
      leaderPid: 1,
      isLeader: true,
      isInside: true,
      canTravel: false,
      open: false,
      bossesDefeated: 1,
      bossesTotal: 3,
    },
  };
  const world = {
    playerId: 1,
    player: { inCombat: false },
    partyInfo: null,
    dungeonFinderInfo: info,
    dungeonFinderBoard: [],
    dungeonFinderExpeditionOpen: vi.fn(),
    dungeonFinderExpeditionTravel: vi.fn(),
    dungeonFinderListingClose: vi.fn(),
    dungeonFinderExpeditionConfigure: vi.fn(),
  };
  const controls = new DungeonGroupControls();
  const root = document.createElement('div');
  const repaint = () => {
    const view = controls.sync(world as unknown as IWorld);
    root.innerHTML = controls.ownHtml(view) + controls.toolsHtml(view);
    controls.wire(root, () => world as unknown as IWorld, repaint);
  };
  repaint();
  return { world, info, root, repaint, controls };
}

describe('Groups expedition controls', () => {
  it('keeps progress and authoritative recruitment/travel actions in the sole Groups window', () => {
    const { root, world, info, repaint } = setup();
    expect(root.querySelector('progress')?.value).toBe(1);
    root.querySelector<HTMLButtonElement>('[data-group-action="open"]')!.click();
    expect(world.dungeonFinderExpeditionOpen).toHaveBeenCalledOnce();
    info.expedition!.isInside = false;
    repaint();
    expect(root.querySelector('[data-group-action="open"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-group-action="travel"]')!.disabled).toBe(
      true,
    );
    info.expedition!.canTravel = true;
    repaint();
    root.querySelector<HTMLButtonElement>('[data-group-action="travel"]')!.click();
    expect(world.dungeonFinderExpeditionTravel).toHaveBeenCalledOnce();
    expect(root.querySelector('.expedition-cards')).toBeNull();
  });

  it('does not show leader controls to a member and provides explicit close for open runs', () => {
    const { root, info, world, repaint } = setup();
    info.expedition!.open = true;
    repaint();
    root.querySelector<HTMLButtonElement>('[data-group-action="close-run"]')!.click();
    expect(world.dungeonFinderListingClose).toHaveBeenCalledOnce();
    info.expedition!.isLeader = false;
    repaint();
    expect(root.querySelector('[data-group-action="close-run"]')).toBeNull();
  });

  it('keeps only sound preferences and no helper or reward controls', () => {
    const { root, world } = setup();
    expect(
      root.querySelector('[data-group-disclosure], [data-group-helper-role], [data-reward]'),
    ).toBeNull();
    expect(root.querySelector('[data-group-action="available"]')).toBeNull();
    expect(world.dungeonFinderExpeditionConfigure).not.toHaveBeenCalled();
    const sound = root.querySelector<HTMLInputElement>('[data-group-sound]')!;
    sound.checked = true;
    sound.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('woc_expedition_sound')).toBe('1');
  });

  it('retains a note draft through world updates, safely renders it, and saves only on request', () => {
    const { root, info, world, repaint } = setup();
    info.myListing = {
      id: 7,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [],
      details: { purpose: 'clear', note: '' },
    };
    repaint();
    root.querySelector<HTMLButtonElement>('[data-group-action="edit-details"]')!.click();
    const input = root.querySelector<HTMLInputElement>('[data-group-note]')!;
    input.value = '<img src=x onerror=alert(1)>';
    input.dispatchEvent(new Event('input'));
    info.expedition!.bossesDefeated = 2;
    repaint();
    expect(root.querySelector<HTMLInputElement>('[data-group-note]')!.value).toBe(input.value);
    expect(root.querySelector('[onerror]')).toBeNull();
    expect(world.dungeonFinderExpeditionConfigure).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-group-action="save-details"]')!.click();
    expect(world.dungeonFinderExpeditionConfigure).toHaveBeenCalledWith({
      kind: 'details',
      details: { purpose: 'clear', note: input.value },
    });
  });

  it('keeps countdown changes out of structural signature while progress invalidates', () => {
    const { controls, info, world } = setup();
    info.myApplications = [{ listingId: 3, remaining: 50 }];
    const sig = controls.sync(world as unknown as IWorld).sig;
    info.myApplications[0].remaining = 49;
    expect(controls.sync(world as unknown as IWorld).sig).toBe(sig);
    info.expedition!.bossesDefeated = 2;
    expect(controls.sync(world as unknown as IWorld).sig).not.toBe(sig);
  });

  it('retains cancellation when an applied listing disappears from the board', () => {
    const { root, info, world, repaint } = setup();
    info.myApplications = [{ listingId: 99, remaining: 50, leaderName: '<script>Leader</script>' }];
    repaint();
    expect(root.querySelector('script')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-group-action="cancel-application"]')!.click();
    expect(world.dungeonFinderExpeditionConfigure).toHaveBeenCalledWith({
      kind: 'cancel_application',
      listingId: 99,
    });
  });

  it('does not duplicate the withdrawal action for a visible raid listing', () => {
    const { controls, info, world, root } = setup();
    info.myApplications = [
      { listingId: 99, remaining: 50, activityId: 'ignivar_raid_arena_normal' },
    ];
    const view = controls.sync(world as unknown as IWorld);
    expect(view.groups).toHaveLength(0);
    root.innerHTML = controls.toolsHtml(view, [99]);
    expect(root.querySelector('[data-group-action="cancel-application"]')).toBeNull();
    root.innerHTML = controls.toolsHtml(view, []);
    expect(root.querySelector('[data-group-action="cancel-application"]')).not.toBeNull();
  });

  it('preserves note text and selection when the Groups window updates', () => {
    const { world, info, root } = setup();
    Object.assign(world, {
      cfg: { playerClass: 'paladin' },
      talentRole: 'tank',
      talentSpec: 'protection',
      raidLockouts: () => [],
    });
    Object.assign(world.player, { level: 20 });
    info.myListing = { id: 7, activityId: 'hollow_crypt_normal', tags: [], applicants: [] };
    root.id = 'dungeon-finder-window';
    document.body.append(root);
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
    root.querySelector<HTMLButtonElement>('[data-group-action="edit-details"]')!.click();
    const note = root.querySelector<HTMLInputElement>('[data-group-note]')!;
    note.value = 'Remember the healer';
    note.dispatchEvent(new Event('input'));
    note.focus();
    note.setSelectionRange(3, 7);
    info.expedition!.bossesDefeated = 2;
    window.render();
    const updated = root.querySelector<HTMLInputElement>('[data-group-note]')!;
    expect(updated.value).toBe('Remember the healer');
    expect(document.activeElement).toBe(updated);
    expect([updated.selectionStart, updated.selectionEnd]).toEqual([3, 7]);
    root.remove();
  });
});
