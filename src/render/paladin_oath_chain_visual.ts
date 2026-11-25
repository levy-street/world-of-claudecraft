import type * as THREE from 'three';

// Oath Chain's chain is drawn by the Paladin kit (ability_vfx/oath_chain.ts),
// which follows the throw, the pull and the shatter from the cast and the
// pull's aura. The renderer's per-entity hook below is kept because
// renderer.ts is at its line cap; it now draws nothing and only lets go of a
// chain left over from before.
//
// Detail: core = none; secondary = none; accents = none. This hook draws
// nothing on any tier; the chain's tiers are the kit's (ability_vfx/oath_chain.ts).

export interface PaladinOathChainEndpoint {
  x: number;
  y: number;
  z: number;
}

export interface PaladinOathChainVisual {
  dispose(): void;
}

export function syncPaladinOathChainVisual(
  current: PaladinOathChainVisual | null,
  _parent: THREE.Object3D,
  _sourcePos: PaladinOathChainEndpoint | null,
  _targetPos: PaladinOathChainEndpoint,
  _sourceHeight: number,
  _targetHeight: number,
  _active: boolean,
  _dt: number,
  _reducedMotion: boolean,
): PaladinOathChainVisual | null {
  current?.dispose();
  return null;
}
