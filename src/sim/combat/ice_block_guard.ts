// Ice Block's crowd-control guard, moved out of the Sim coordinator: which aura
// kinds the stasis shrugs off, and whether a target is inside it. Pure leaf: no
// SimContext, no rng; Sim.applyAura and knockback (through ctx) consult it.

import type { AuraKind, Entity } from '../types';

export function isControlAuraKind(kind: AuraKind): boolean {
  return kind === 'stun' || kind === 'root' || kind === 'incapacitate' || kind === 'polymorph';
}

export function isIceBlockCrowdControlAura(kind: AuraKind): boolean {
  return (
    isControlAuraKind(kind) ||
    kind === 'silence' ||
    kind === 'blind' ||
    kind === 'disarm' ||
    kind === 'slow' ||
    kind === 'lockout' ||
    kind === 'tongues'
  );
}

export function isIceBlocked(target: Entity): boolean {
  return target.auras.some((existing) => existing.id === 'ice_block' && existing.kind === 'stasis');
}
