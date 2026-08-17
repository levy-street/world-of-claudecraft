// three r185 still assigns KeyframeTrack.createInterpolant at construction
// (setInterpolation binds one of the InterpolantFactoryMethod* members to it;
// see node_modules/three/src/animation/KeyframeTrack.js), but @types/three
// 0.185 dropped the member declaration that 0.165 carried. The paladin clip
// modules and their tests sample tracks through it, so declare the dispatch
// member the runtime provides. Remove if a future @types/three restores it.
// The top-level import keeps this file a module, so the declare block below
// AUGMENTS the three typings instead of replacing them.
import type { TypedArray } from 'three/src/core/BufferAttribute.js';

declare module 'three' {
  interface KeyframeTrack {
    createInterpolant(result?: TypedArray): Interpolant;
  }
}
