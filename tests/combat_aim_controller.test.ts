import { describe, expect, it, vi } from 'vitest';
import { createCombatAimController } from '../src/game/combat_aim_controller';

describe('combat aim controller', () => {
  it('uses the real canvas rect for cursor aim and synchronizes the current angle', () => {
    const meta: { combatAimAngle?: number } = {};
    const online = {
      setCombatAimAngle: vi.fn(),
      setMouselookFacing: vi.fn(),
      flushInput: vi.fn(() => true),
    };
    const groundPoint = vi.fn(() => ({ x: 3, z: 4 }));
    const controller = createCombatAimController({
      canvas: {
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect,
      },
      input: {
        camYaw: 0.75,
        combatAimUsesFacing: () => false,
        cursorPoint: () => ({ x: 170, y: 90 }),
      },
      player: () => ({ pos: { x: 0, y: 2, z: 0 }, facing: 0.25 }),
      groundPoint,
      offlineMeta: () => meta,
      online: () => online,
    });

    expect(controller.screenPoint()).toEqual({ x: 170, y: 90 });
    expect(controller.current()).toMatchObject({ source: 'cursor', point: { x: 3, z: 4 } });
    controller.sync();
    expect(groundPoint).toHaveBeenCalledWith(170, 90, 2);
    expect(meta.combatAimAngle).toBeCloseTo(Math.atan2(3, 4));
    expect(online.setCombatAimAngle).toHaveBeenCalledWith(meta.combatAimAngle);
    expect(online.setMouselookFacing).not.toHaveBeenCalled();
    expect(online.flushInput).toHaveBeenCalledTimes(1);
  });

  it('uses the raised action-camera anchor and camera facing while mouselook owns aim', () => {
    const online = {
      setCombatAimAngle: vi.fn(),
      setMouselookFacing: vi.fn(),
      flushInput: vi.fn(() => true),
    };
    const controller = createCombatAimController({
      canvas: {
        getBoundingClientRect: () => ({ left: 40, top: 20, width: 320, height: 180 }) as DOMRect,
      },
      input: {
        camYaw: 1.2,
        combatAimUsesFacing: () => true,
        cursorPoint: () => ({ x: 1, y: 1 }),
      },
      player: () => ({ pos: { x: 2, y: 3, z: 4 }, facing: -0.5 }),
      groundPoint: () => ({ x: 99, z: 99 }),
      offlineMeta: () => null,
      online: () => online,
    });

    expect(controller.screenPoint()).toEqual({ x: 200, y: 95.6 });
    expect(controller.current()).toMatchObject({ source: 'facing', angle: 1.2, point: null });
    controller.sync();
    expect(online.setMouselookFacing).toHaveBeenCalledWith(1.2);
  });
});
