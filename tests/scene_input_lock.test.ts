import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SceneInputLockCoordinator } from '../src/game/scene_input_lock';
import type { SimEvent } from '../src/sim/types';

const LOCK_ON = {
  type: 'scene',
  op: { kind: 'inputLock', on: true },
} as SimEvent;

function harness() {
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
  const target = {
    setSceneInputLocked(on: boolean) {
      targetLocked = on;
    },
  };
  const onLockEdge = vi.fn();
  const coordinator = new SceneInputLockCoordinator(source, target, onLockEdge);
  return {
    coordinator,
    targetLocked: () => targetLocked,
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
      online.indexOf('sceneInputLock.handleEvents(drainedEvents)'),
    );
    expect(online.indexOf('sceneInputLock.handleEvents(drainedEvents)')).toBeLessThan(
      online.indexOf('resolveMove('),
    );
    expect(online.indexOf('resolveMove(')).toBeLessThan(online.indexOf('net.flushInput()'));
    expect(main).toContain('const mouselook =\n      intro === null && !sceneInputLocked');
    expect(main).toContain('const netFacing = sceneInputLocked ? null');
    expect(main).toContain('sceneDirector.inputLocked() ? null');
  });
});
