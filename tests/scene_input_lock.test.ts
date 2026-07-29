import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  newSceneFacingInputState,
  resetSceneFacingInputState,
  SceneInputLockCoordinator,
} from '../src/game/scene_input_lock';
import type { SimEvent } from '../src/sim/types';

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
    const { coordinator, targetLocked, onLockEdge } = harness();
    const appliedForward: boolean[] = [];

    for (let tick = 0; tick < 2; tick++) {
      appliedForward.push(!targetLocked());
      coordinator.handleEvents(tick === 0 ? [LOCK_ON] : []);
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

  it('wires both event paths before their next authoritative input boundary', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const offline = main.slice(main.indexOf('while (acc >= DT)'), main.indexOf('const pp ='));
    const online = main.slice(
      main.indexOf('// Scene events must land before this frame derives'),
      main.indexOf('const echoSamples ='),
    );

    expect(offline.indexOf('offlineSim.tick()')).toBeLessThan(
      offline.indexOf('sceneInputLock.handleEvents(events)'),
    );
    expect(offline.indexOf('sceneInputLock.handleEvents(events)')).toBeLessThan(
      offline.indexOf('acc -= DT'),
    );
    expect(online.indexOf('online.drainEvents()')).toBeLessThan(
      online.indexOf('sceneInputLock.handleMirroredEvents(drainedEvents)'),
    );
    expect(online.indexOf('sceneInputLock.handleMirroredEvents(drainedEvents)')).toBeLessThan(
      online.indexOf('resolveMove('),
    );
    expect(online.indexOf('resolveMove(')).toBeLessThan(online.indexOf('net.flushInput()'));
    expect(main).toContain('const mouselook =\n      intro === null && !sceneInputLocked');
    expect(main).toMatch(/const netFacing = sceneInputLocked\s+\? null/);
    expect(main).toContain('sceneDirector.inputLocked() ? null');
    expect(main).toContain('resetSceneFacingInputState(sceneFacingInput)');
    expect(main).toContain('online.onSceneInputLockChanged = (locked) =>');
  });
});
