// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { reticleStickDelta } from '../src/game/pad_ground_aim';
import {
  padGroundAimCallbacks,
  syncGroundAimReticleFrame,
} from '../src/game/pad_ground_aim_wiring';
import type { Entity } from '../src/sim/types';

// happy-dom rewrites import.meta.url off the file scheme, so resolve via cwd.
const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');

function section(from: string, to: string): string {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return main
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function mob(id: number, x: number, z: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    hostile: true,
    dead: false,
    pos: { x, y: 0, z },
    ...overrides,
  } as unknown as Entity;
}

function fakeAimHud(range: number | null) {
  return {
    isGroundAimActive: vi.fn(() => range !== null),
    cancelGroundAim: vi.fn(() => true),
    groundAimAbilityRange: vi.fn(() => range),
    nudgeGroundAimPoint: vi.fn(),
    updateGroundAimPoint: vi.fn(),
    commitGroundAimAt: vi.fn(() => true),
    groundAimReticle: vi.fn(
      (): {
        point: { x: number; z: number };
        radius: number;
        school: string;
        dimmed: boolean;
        blocked: boolean;
      } | null => null,
    ),
  };
}

describe('ground aim lifecycle wiring', () => {
  it('uses the canonical attackability and active PvP opponent helpers', () => {
    const options = section('hud.attachOptions({', 'hud.attachDiscordHook(');

    expect(options).toContain(
      'isAttackableEntity(world.entities.get(targetId), world.playerId, activePvpOpponentIds(world))',
    );
  });

  it('cancels after reconnect', () => {
    const reconnect = section('online.onReconnected = () => {', 'hud.attachReporting({');

    expect(reconnect).toContain('priorOnReconnected?.();');
    expect(reconnect).toContain('hud.cancelGroundAim();');
  });

  it('cancels after teleport-scale displacement', () => {
    const movement = section('function resolveMove(', 'lastResolveMovePos = {');

    expect(movement).toContain(
      'if (clickMoveBrokenByTeleport(lastResolveMovePos, playerPos)) hud.cancelGroundAim();',
    );
  });

  it('cancels on the player death transition', () => {
    const death = section(
      'if (shouldClearAutorunOnDeath(playerWasDead, playerDead)) {',
      'playerWasDead = playerDead;',
    );

    expect(death).toContain('hud.cancelGroundAim();');
  });

  it('preserves the smart seed when there is no desktop cursor sample', () => {
    const hud = fakeAimHud(30);
    const setReticle = vi.fn();
    syncGroundAimReticleFrame({
      hud,
      isMobileTouch: () => false,
      cursorPoint: () => null,
      groundPoint: () => ({ x: 5, z: 5 }),
      setReticle,
    });

    expect(hud.updateGroundAimPoint).not.toHaveBeenCalled();
    expect(setReticle).toHaveBeenCalledWith(null);
  });

  it('updates and paints the full reticle from the desktop cursor path', () => {
    document.body.classList.remove('pad-active');
    const hud = fakeAimHud(30);
    const groundPointResult = { x: 5, z: 7 };
    const groundPoint = vi.fn(() => groundPointResult);
    const setReticle = vi.fn();
    hud.groundAimReticle.mockReturnValue({
      point: groundPointResult,
      radius: 8,
      school: 'fire',
      dimmed: true,
      blocked: false,
    });

    syncGroundAimReticleFrame({
      hud,
      isMobileTouch: () => false,
      cursorPoint: () => ({ x: 120, y: 80 }),
      groundPoint,
      setReticle,
    });

    expect(groundPoint).toHaveBeenCalledWith(120, 80);
    expect(hud.updateGroundAimPoint).toHaveBeenCalledWith(groundPointResult);
    expect(setReticle).toHaveBeenCalledWith({
      x: 5,
      z: 7,
      radius: 8,
      school: 'fire',
      dimmed: true,
      blocked: false,
    });
    expect(setReticle).not.toHaveBeenCalledWith(null);
  });

  it('keeps the pad-owned point when the pad was the last active input', () => {
    document.body.classList.add('pad-active');
    try {
      const hud = fakeAimHud(30);
      syncGroundAimReticleFrame({
        hud,
        isMobileTouch: () => false,
        cursorPoint: () => ({ x: 100, y: 100 }),
        groundPoint: () => ({ x: 5, z: 5 }),
        setReticle: vi.fn(),
      });

      expect(hud.updateGroundAimPoint).not.toHaveBeenCalled();
    } finally {
      document.body.classList.remove('pad-active');
    }
  });

  it('wires pad steering through the active range, camera, and live sensitivity', () => {
    const hud = fakeAimHud(30);
    const callbacks = padGroundAimCallbacks({
      hud,
      world: () => ({ player: mob(1, 0, 0), playerId: 1, entities: new Map() }) as never,
      camYaw: () => Math.PI / 2,
      reticleSpeed: () => 1.5,
    });

    callbacks.onGroundAimStick(1, 0, 0.05);
    const expected = reticleStickDelta(1, 0, Math.PI / 2, 0.05, 30, 1.5);
    expect(hud.nudgeGroundAimPoint).toHaveBeenCalledWith(expected.dx, expected.dz);

    hud.groundAimAbilityRange.mockReturnValue(null);
    callbacks.onGroundAimStick(1, 0, 0.05);
    expect(hud.nudgeGroundAimPoint).toHaveBeenCalledTimes(1);
  });

  it('wires pad snapping through attackability, PvP, range, and the current reticle', () => {
    const hud = fakeAimHud(30);
    const player = mob(1, 0, 0, { kind: 'player', hostile: false } as Partial<Entity>);
    const inRange = mob(2, 10, 0);
    const dead = mob(3, 0, -5, { dead: true });
    const outOfRange = mob(4, -500, -300);
    const callbacks = padGroundAimCallbacks({
      hud,
      world: () =>
        ({
          player,
          playerId: 1,
          entities: new Map([
            [player.id, player],
            [inRange.id, inRange],
            [dead.id, dead],
            [outOfRange.id, outOfRange],
          ]),
        }) as never,
      camYaw: () => 0,
      reticleSpeed: () => 1,
    });

    callbacks.onGroundAimSnap(1);
    expect(hud.updateGroundAimPoint).toHaveBeenCalledWith({ x: 10, z: 0 });
  });
});
