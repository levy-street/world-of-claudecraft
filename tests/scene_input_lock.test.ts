import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SceneDirector } from '../src/game/scene_director';
import {
  newSceneFacingInputState,
  resetSceneFacingInputState,
  runOfflineSceneInputTick,
  SceneInputLockCoordinator,
} from '../src/game/scene_input_lock';
import type { SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const LOCK_ON = {
  type: 'scene',
  op: { kind: 'inputLock', on: true },
} as SimEvent;
const LOCK_OFF = {
  type: 'scene',
  op: { kind: 'inputLock', on: false },
} as SimEvent;

function harness(onLockEdge: () => void = vi.fn()) {
  let locked = false;
  const source = {
    handleEvents(events: SimEvent[]) {
      for (const event of events) {
        if (event.type === 'scene' && event.op.kind === 'inputLock') locked = event.op.on;
      }
    },
    inputLocked: () => locked,
  };
  let targetLocked = false;
  const targetTransitions: boolean[] = [];
  const target = {
    setSceneInputLocked(on: boolean) {
      targetLocked = on;
      targetTransitions.push(on);
    },
  };
  const coordinator = new SceneInputLockCoordinator(source, target, onLockEdge);
  return {
    coordinator,
    targetLocked: () => targetLocked,
    targetTransitions,
    onLockEdge,
  };
}

describe('scene input lock frame coordination', () => {
  it('locks the second offline catch-up tick when the first tick emits the lock', () => {
    const { coordinator, onLockEdge } = harness();
    const appliedForward: boolean[] = [];
    let locked = false;

    for (let tick = 0; tick < 2; tick++) {
      const step = runOfflineSceneInputTick(coordinator, locked, (lockedAtTickStart) => {
        appliedForward.push(!lockedAtTickStart);
        return tick === 0 ? [LOCK_ON] : [];
      });
      locked = step.locked;
    }

    expect(appliedForward).toEqual([true, false]);
    expect(onLockEdge).toHaveBeenCalledTimes(1);
  });

  it('applies a queued online lock before the frame flushes input', () => {
    const { coordinator, targetLocked } = harness();
    const queued = [LOCK_ON];
    const flushedForward: boolean[] = [];

    coordinator.handleEvents(queued.splice(0));
    flushedForward.push(!targetLocked());

    expect(flushedForward).toEqual([false]);
  });

  it('preserves a rising edge inside a batch that finishes unlocked', () => {
    const { coordinator, targetLocked, targetTransitions, onLockEdge } = harness();

    coordinator.handleEvents([LOCK_ON, LOCK_OFF]);

    expect(targetLocked()).toBe(false);
    expect(targetTransitions).toEqual([true, false]);
    expect(onLockEdge).toHaveBeenCalledTimes(1);
  });

  it('propagates an independent unlock without firing another lock edge', () => {
    const { coordinator, targetLocked, onLockEdge } = harness();
    coordinator.handleEvents([LOCK_ON]);

    coordinator.handleEvents([LOCK_OFF]);

    expect(targetLocked()).toBe(false);
    expect(onLockEdge).toHaveBeenCalledTimes(1);
  });

  it('converges mirrored events without replaying their receipt-time lock edge', () => {
    const { coordinator, targetLocked, onLockEdge } = harness();
    coordinator.applyPending(true);
    coordinator.applyPending(false);

    coordinator.handleMirroredEvents([LOCK_ON, LOCK_OFF]);

    expect(targetLocked()).toBe(false);
    expect(onLockEdge).toHaveBeenCalledTimes(1);
  });

  it('clears every facing latch on a receipt edge even when the batch finishes unlocked', () => {
    const facing = newSceneFacingInputState();
    facing.cameraDrivenFacing.active = true;
    facing.pendingReleaseFacing = 1.25;
    facing.keyboardTurn.facing = 0.75;
    facing.keyboardTurn.releaseMs = 275;
    facing.keyboardTurn.wireFacing = 0.75;
    facing.keyboardTurn.suppressTurnFlags = true;
    facing.keyboardTurn.wasTurning = true;
    const { coordinator } = harness(() => resetSceneFacingInputState(facing));

    coordinator.applyPending(true);
    coordinator.applyPending(false);
    coordinator.handleMirroredEvents([LOCK_ON, LOCK_OFF]);

    expect(facing).toEqual(newSceneFacingInputState());
  });

  it('keeps another player unlocked after the real director drains their scoped event', () => {
    const world = { playerId: 7, entities: new Map() } as unknown as IWorld;
    const director = new SceneDirector({
      world: () => world,
      nowSec: () => 0,
      musicSilence: vi.fn(),
      reducedMotion: () => false,
    });
    let targetLocked = false;
    const coordinator = new SceneInputLockCoordinator(
      director,
      {
        setSceneInputLocked(locked) {
          targetLocked = locked;
        },
      },
      vi.fn(),
    );

    coordinator.handleMirroredEvents([
      {
        type: 'scene',
        sceneId: 'scn_foreign',
        pid: 11,
        op: { kind: 'inputLock', on: true },
      },
    ]);

    expect(director.inputLocked()).toBe(false);
    expect(targetLocked).toBe(false);
  });

  it('parks stale scene props whenever represented scene state converges', () => {
    const world = { playerId: 7, entities: new Map() } as unknown as IWorld;
    const propCue = vi.fn();
    const propReset = vi.fn();
    const director = new SceneDirector({
      world: () => world,
      nowSec: () => 10,
      musicSilence: vi.fn(),
      propCue,
      propReset,
      reducedMotion: () => false,
    });

    director.handleEvents([
      {
        type: 'scene',
        sceneId: 'scn_old_target',
        pid: 7,
        op: { kind: 'start', duration: 20 },
      },
      {
        type: 'scene',
        sceneId: 'scn_old_target',
        pid: 7,
        op: {
          kind: 'camera',
          shot: {
            kind: 'focus',
            entityId: null,
            x: 0,
            y: 0,
            z: 0,
            dist: 8,
            pitch: 0.3,
            yaw: 0,
            dur: 2,
          },
        },
      },
      {
        type: 'scene',
        sceneId: 'scn_old_target',
        pid: 7,
        op: { kind: 'prop', target: 'harbor_ship_mainland', cue: 'old_voyage' },
      },
    ]);

    expect(propCue).toHaveBeenCalledWith('harbor_ship_mainland', 'old_voyage', 10);
    expect(director.cameraActive()).toBe(true);

    director.handleEvents([
      {
        type: 'sceneSync',
        state: {
          sceneId: 'scn_new_target',
          remainingSeconds: 8,
          inputLocked: true,
          letterbox: true,
          musicSilenced: false,
        },
      },
    ]);

    expect(propReset).toHaveBeenCalledTimes(1);
    expect(director.sceneActive()).toBe(true);
    expect(director.inputLocked()).toBe(true);
    expect(director.cameraActive()).toBe(false);

    director.handleEvents([{ type: 'sceneSync', state: null }]);

    expect(propReset).toHaveBeenCalledTimes(2);
    expect(director.sceneActive()).toBe(false);
    expect(director.inputLocked()).toBe(false);
    expect(director.cameraActive()).toBe(false);
  });

  it('wires both event paths before their next authoritative input boundary', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const offline = main.slice(main.indexOf('while (acc >= DT)'), main.indexOf('const pp ='));
    const online = main.slice(
      main.indexOf('// Scene events must land before this frame derives'),
      main.indexOf('const echoSamples ='),
    );

    expect(offline.indexOf('runOfflineSceneInputTick(')).toBeLessThan(
      offline.indexOf('offlineSim.tick()'),
    );
    expect(offline.indexOf('offlineSim.tick()')).toBeLessThan(offline.indexOf('acc -= DT'));
    expect(online.indexOf('drainMirroredSceneInput(')).toBeLessThan(online.indexOf('resolveMove('));
    expect(online.indexOf('resolveMove(')).toBeLessThan(online.indexOf('net.flushInput()'));
    expect(main).toContain('const mouselook =\n      intro === null && !sceneInputLocked');
    expect(main).toMatch(/const netFacing = sceneInputLocked\s+\? null/);
    expect(main).toContain('resetSceneFacingInputState(sceneFacingInput)');
    expect(main).toContain('bindMirroredSceneInputLock(online, sceneInputLock)');
  });
});
