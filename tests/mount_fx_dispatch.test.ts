import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { emitMountFx, type MountFxSink } from '../src/render/mount_fx';
import { MOUNT_VISUAL_SPECS, type MountVisualSpec } from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

/** Records which emitter the dispatch reached, so each case is decisive. */
function spy(): MountFxSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    mountSlimeTrail: () => calls.push('slime'),
    mountExhaust: () => calls.push('exhaust'),
    mountGrit: () => calls.push('grit'),
    mountRiftGlow: () => calls.push('riftglow'),
  };
}

const AT = { x: 0, y: 0, z: 0 } as THREE.Vector3;
const specFor = (fx: MountVisualSpec['fx']): MountVisualSpec =>
  ({ ...MOUNT_VISUAL_SPECS.valorsteed, fx }) as MountVisualSpec;

const emit = (sink: MountFxSink, fx: MountVisualSpec['fx'], moving: boolean) =>
  emitMountFx(sink, specFor(fx), AT, 0, 8, 1 / 60, moving);

describe('ambient mount fx dispatch', () => {
  it('routes each kind to its own emitter and nothing else', () => {
    for (const [fx, expected] of [
      ['slime', 'slime'],
      ['exhaust', 'exhaust'],
      ['grit', 'grit'],
      ['riftglow', 'riftglow'],
    ] as const) {
      const sink = spy();
      emit(sink, fx, true);
      expect(sink.calls, `${fx} while moving`).toEqual([expected]);
    }
  });

  it('emits nothing at all for a mount with no effect', () => {
    const sink = spy();
    emit(sink, null, true);
    emit(sink, null, false);
    expect(sink.calls).toEqual([]);
  });

  it('splits the motion-laid effects from the ones that idle on', () => {
    // The load-bearing distinction: slime and grit are laid down BY movement and
    // must stop dead when the rider does, while exhaust and rift glow belong to
    // mounts that float rather than rest, so they keep emitting while parked.
    // Getting this backwards is invisible in a moving screenshot, hence a pin.
    const stopped = spy();
    emit(stopped, 'slime', false);
    emit(stopped, 'grit', false);
    expect(stopped.calls, 'motion-laid effects must be silent when stopped').toEqual([]);

    const idling = spy();
    emit(idling, 'exhaust', false);
    emit(idling, 'riftglow', false);
    expect(idling.calls, 'floating mounts keep their effect while parked').toEqual([
      'exhaust',
      'riftglow',
    ]);
  });

  it('drives every live catalog mount without throwing or double-emitting', () => {
    // Walks the real specs, not synthesised ones, so a mount wired to a kind the
    // dispatch does not handle fails here rather than at runtime.
    for (const key of MOUNT_KEYS) {
      const sink = spy();
      emitMountFx(sink, MOUNT_VISUAL_SPECS[key], AT, 0, 8, 1 / 60, true);
      expect(sink.calls.length, `${key} emits at most one effect`).toBeLessThanOrEqual(1);
      if (MOUNT_VISUAL_SPECS[key].fx === null) {
        expect(sink.calls, `${key} has no effect`).toEqual([]);
      } else {
        expect(sink.calls, `${key} reaches its emitter`).toEqual([MOUNT_VISUAL_SPECS[key].fx]);
      }
    }
  });
});
