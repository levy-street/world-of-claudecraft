import { describe, expect, it, vi } from 'vitest';
import {
  createGamepadActionDispatcher,
  type GamepadActionDispatcherDeps,
} from '../src/game/gamepad_action_dispatcher';
import { GAMEPAD_CANCEL, GAMEPAD_CYCLE_HUD, GAMEPAD_SUBCOMMANDS } from '../src/game/gamepad_map';

function setup(overrides: Partial<GamepadActionDispatcherDeps> = {}) {
  const world = {
    entities: new Map(),
    player: { pos: { x: 0, y: 0, z: 0 }, targetId: null, weaponStowed: false },
    tabTarget: vi.fn(),
    tabTargetPrev: vi.fn(),
    targetNearestFriendly: vi.fn(),
    friendlyTabTarget: vi.fn(),
    targetEntity: vi.fn(),
    toggleMounted: vi.fn(),
    setPetMode: vi.fn(),
    petTaunt: vi.fn(),
    petAttack: vi.fn(),
    toggleWeaponStow: vi.fn(),
  };
  const hud = {
    cancelGroundAim: vi.fn(() => false),
    closeAll: vi.fn(() => false),
    toggleOptionsMenu: vi.fn(),
    pressSlot: vi.fn(),
    toggleBags: vi.fn(),
    toggleChar: vi.fn(),
    toggleSpellbook: vi.fn(),
    toggleQuestLog: vi.fn(),
    toggleMap: vi.fn(),
    toggleTalents: vi.fn(),
    toggleMeters: vi.fn(),
    toggleTargetAuras: vi.fn(),
    toggleSocial: vi.fn(),
    toggleArena: vi.fn(),
    toggleLeaderboard: vi.fn(),
    toggleCalendar: vi.fn(),
    toggleDeeds: vi.fn(),
    toggleProfessions: vi.fn(),
    toggleReliquary: vi.fn(),
    toggleCrafting: vi.fn(),
    targetOwnPet: vi.fn(),
    toggleDungeonFinder: vi.fn(),
  };
  const deps = {
    world,
    hud,
    canUseGameKeys: vi.fn(() => true),
    dismissCameraPrompt: vi.fn(() => false),
    cycleHudFocus: vi.fn(() => true),
    interact: vi.fn(),
    openTargetSubcommands: vi.fn(() => false),
    toggleNameplates: vi.fn(),
    bgFlag: vi.fn(),
    toggleDiscord: vi.fn(),
    openChat: vi.fn(),
    weaponSheathe: vi.fn(),
    weaponUnsheathe: vi.fn(),
    ...overrides,
  } as unknown as GamepadActionDispatcherDeps;
  return { deps, dispatch: createGamepadActionDispatcher(deps), hud, world };
}

describe('gamepad action dispatcher', () => {
  it('keeps Cancel and Cycle Interface available while gameplay input is blocked', () => {
    const { deps, dispatch, world } = setup({ canUseGameKeys: () => false });

    dispatch(GAMEPAD_CANCEL);
    dispatch(GAMEPAD_CYCLE_HUD);
    dispatch('interact');

    expect(world.targetEntity).toHaveBeenCalledWith(null);
    expect(deps.cycleHudFocus).toHaveBeenCalledOnce();
    expect(deps.interact).not.toHaveBeenCalled();
  });

  it('preserves slot, interaction, and subcommands fallback behavior', () => {
    const { deps, dispatch, hud } = setup();

    dispatch('slot7');
    dispatch('interact');
    dispatch(GAMEPAD_SUBCOMMANDS);

    expect(hud.pressSlot).toHaveBeenCalledWith(7);
    expect(deps.interact).toHaveBeenCalledOnce();
    expect(deps.openTargetSubcommands).toHaveBeenCalledOnce();
    expect(hud.toggleMap).toHaveBeenCalledOnce();
  });

  it('does not open the map when target subcommands handled the action', () => {
    const { dispatch, hud } = setup({ openTargetSubcommands: () => true });

    dispatch(GAMEPAD_SUBCOMMANDS);

    expect(hud.toggleMap).not.toHaveBeenCalled();
  });

  it.each([
    ['target', 'world', 'tabTarget'],
    ['targetPrev', 'world', 'tabTargetPrev'],
    ['targetFriendly', 'world', 'targetNearestFriendly'],
    ['targetFriendlyNext', 'world', 'friendlyTabTarget'],
    ['bags', 'hud', 'toggleBags'],
    ['char', 'hud', 'toggleChar'],
    ['spellbook', 'hud', 'toggleSpellbook'],
    ['questlog', 'hud', 'toggleQuestLog'],
    ['map', 'hud', 'toggleMap'],
    ['nameplates', 'deps', 'toggleNameplates'],
    ['talents', 'hud', 'toggleTalents'],
    ['meters', 'hud', 'toggleMeters'],
    ['targetAuras', 'hud', 'toggleTargetAuras'],
    ['social', 'hud', 'toggleSocial'],
    ['arena', 'hud', 'toggleArena'],
    ['bgFlag', 'deps', 'bgFlag'],
    ['mount', 'world', 'toggleMounted'],
    ['leaderboard', 'hud', 'toggleLeaderboard'],
    ['calendar', 'hud', 'toggleCalendar'],
    ['discord', 'deps', 'toggleDiscord'],
    ['deeds', 'hud', 'toggleDeeds'],
    ['professions', 'hud', 'toggleProfessions'],
    ['reliquary', 'hud', 'toggleReliquary'],
    ['crafting', 'hud', 'toggleCrafting'],
    ['petTaunt', 'world', 'petTaunt'],
    ['petAttack', 'world', 'petAttack'],
    ['targetPet', 'hud', 'targetOwnPet'],
    ['dungeonFinder', 'hud', 'toggleDungeonFinder'],
    ['chat', 'deps', 'openChat'],
  ] as const)('routes %s to its gameplay callback', (action, owner, callback) => {
    const setupResult = setup();
    setupResult.dispatch(action);

    const callbackOwner = setupResult[owner] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(callbackOwner[callback]).toHaveBeenCalledOnce();
  });

  it.each([
    ['petStop', 'passive'],
    ['petDefensive', 'defensive'],
    ['petAggressive', 'aggressive'],
  ] as const)('routes %s to the expected pet mode', (action, mode) => {
    const { dispatch, world } = setup();

    dispatch(action);

    expect(world.setPetMode).toHaveBeenCalledWith(mode);
  });
});
