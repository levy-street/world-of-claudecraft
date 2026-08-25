import { describe, expect, it, vi } from 'vitest';
import { dispatchGamepadAction, type GamepadActionDeps } from '../src/game/gamepad_action_dispatch';

function deps(): GamepadActionDeps {
  const hud = new Proxy(
    {
      cancelGroundAim: vi.fn(() => false),
      closeAll: vi.fn(() => false),
      toggleMap: vi.fn(),
    },
    { get: (target, key) => Reflect.get(target, key) ?? vi.fn() },
  );
  const world = new Proxy(
    { player: { castingAbility: null, weaponStowed: false }, inventory: [] },
    { get: (target, key) => Reflect.get(target, key) ?? vi.fn() },
  );
  return {
    world: world as unknown as GamepadActionDeps['world'],
    hud: hud as unknown as GamepadActionDeps['hud'],
    renderer: { showNameplates: true },
    audio: { weaponSheathe: vi.fn(), weaponUnsheathe: vi.fn() },
    dismissCameraPrompt: vi.fn(() => false),
    canUseGameKeys: vi.fn(() => true),
    clearTarget: vi.fn(),
    cycleHudFocus: vi.fn(),
    targetNpc: vi.fn(),
    interact: vi.fn(),
    openTargetSubcommands: vi.fn(() => false),
    battlegroundFlag: vi.fn(),
    toggleDiscord: vi.fn(),
    openChat: vi.fn(),
    toggleActionCamera: vi.fn(),
  };
}

describe('dispatchGamepadAction', () => {
  it('routes the optional Action Camera binding through its host callback', () => {
    const d = deps();
    dispatchGamepadAction('toggleActionCamera', d);
    expect(d.toggleActionCamera).toHaveBeenCalledTimes(1);
    expect(d.hud.cancelGroundAim).toHaveBeenCalledTimes(1);
  });

  it('lets Escape dismiss the camera prompt before opening a menu', () => {
    const d = deps();
    vi.mocked(d.dismissCameraPrompt).mockReturnValue(true);
    dispatchGamepadAction('escape', d);
    expect(d.hud.cancelGroundAim).not.toHaveBeenCalled();
    expect(d.hud.toggleOptionsMenu).not.toHaveBeenCalled();
  });

  it('preserves the v0.40 controller focus and NPC targeting actions', () => {
    const d = deps();
    dispatchGamepadAction('cycleHud', d);
    dispatchGamepadAction('targetNpcNext', d);
    dispatchGamepadAction('targetNpcPrev', d);
    dispatchGamepadAction('subcommands', d);
    expect(d.cycleHudFocus).toHaveBeenCalledOnce();
    expect(d.targetNpc).toHaveBeenNthCalledWith(1, 1);
    expect(d.targetNpc).toHaveBeenNthCalledWith(2, -1);
    expect(d.openTargetSubcommands).toHaveBeenCalledOnce();
    expect(d.hud.toggleMap).toHaveBeenCalledOnce();
  });
});
