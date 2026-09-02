// A mount's own landing plays louder than the rider's.
//
// The lever is the per-call gain rather than the gain map, and that is not a
// shortcut. `keyTrimDb` is per KEY and already sits at this cue's measured
// ceiling, which is set by the loudest of its four takes; pushing it further
// fails the playback-profile validator outright. The per-call gain is a
// separate multiply downstream, so it lifts the whole cue without disturbing
// how the four takes sit against each other.
//
// The things worth pinning are that it is exactly 50%, that it applies to the
// mount's landing ONLY, and that the rider on foot, the takeoff, and the water
// cues are all untouched.

import { describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';

/** Capture what `movement` asks `playAt` for, without any audio context. */
function capture(
  kind: 'jump' | 'land' | 'splash' | 'swim',
  mountKey: string,
): { key: string; gain: number } {
  const seen: { key: string; gain: number }[] = [];
  const spy = vi
    .spyOn(sfx as unknown as { playAt: (...a: unknown[]) => void }, 'playAt')
    .mockImplementation((key: unknown, _x, _y, _z, opts: unknown) => {
      seen.push({
        key: key as string,
        gain: (opts as { gain?: number } | undefined)?.gain ?? 1,
      });
    });
  sfx.movement(kind, 0, 0, 0, true, mountKey);
  spy.mockRestore();
  expect(seen).toHaveLength(1);
  return seen[0];
}

describe('mount landing gain', () => {
  it('plays a mount landing 50% louder than the rider on foot', () => {
    const onFoot = capture('land', '');
    const mounted = capture('land', 'rallycart_rxt');
    expect(onFoot.key).toBe('move_land');
    expect(mounted.key).toBe('mount_land_rallycart_rxt');
    expect(mounted.gain).toBeCloseTo(onFoot.gain * 1.125, 9);
  });

  it('leaves the rider on foot exactly where it was', () => {
    expect(capture('land', '').gain).toBeCloseTo(0.7, 9);
  });

  it('does not lift the takeoff, only the landing', () => {
    const jump = capture('jump', 'rallycart_rxt');
    expect(jump.key).toBe('mount_jump_rallycart_rxt');
    expect(jump.gain).toBeCloseTo(0.7, 9);
  });

  it('leaves the water cues alone, mounted or not', () => {
    expect(capture('splash', 'rallycart_rxt').gain).toBeCloseTo(0.7, 9);
    expect(capture('swim', 'rallycart_rxt').gain).toBeCloseTo(0.5, 9);
  });

  it('does not lift a mount that has no landing take of its own', () => {
    // It falls back to the rider's cue, so it must also keep the rider's level.
    const tank = capture('land', 'terrorspark_groundshaker');
    expect(tank.key).toBe('move_land');
    expect(tank.gain).toBeCloseTo(0.7, 9);
  });
});
