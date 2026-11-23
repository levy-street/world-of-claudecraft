import type { Transform } from '@gltf-transform/core';

/** One sampler evaluated at time `t` (LINEAR or STEP, rotations by slerp) into out[o..o+n-1]. */
export function evaluateSampler(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  n: number,
  interpolation: string,
  isRotation: boolean,
  t: number,
  out: Float32Array,
  o: number,
): void;

/** ceil(duration x fps) equal intervals ending exactly on the clip's last key. */
export function frameGrid(duration: number, fps: number): Float32Array;

/** Every channel of a clip resampled at every frame of `fps` onto one shared input accessor
 *  (constant channels on a shared two-key input), rotations by slerp, sign-continuous. */
export function uniformTimeline(opts?: { fps?: number }): Transform;

/** The meshopt encoder with the chosen animation filter precision (quaternion and exponential
 *  filter bits); register it on the IO that writes the library. */
export function animEncoder<T extends object>(
  MeshoptEncoder: T,
  quatBits?: number,
  expBits?: number,
): T;

/** Drops JSON members that only restate a glTF default, in place; returns the same object. */
export function leanAnimJson<T extends object>(json: T): T;
