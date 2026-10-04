// Who is Morthen during a Graveyard Shift run: one permanent aura on the owner.
// Pure leaf (no SimContext): entity.ts, sim.ts and the action locks key on
// hasMorthenIdentity, so it must never import back into them.

import { isUnbreakableControlAura } from '../combat/cc';
import { isControlAuraKind } from '../combat/ice_block_guard';
import type { PlayerEquipment, PlayerEquipmentInstances } from '../entity';
import type { Aura, Entity } from '../types';

export const MORTHEN_IDENTITY_AURA_ID = 'gshift_morthen_identity';

export function hasMorthenIdentity(e: Pick<Entity, 'auras'> | undefined): boolean {
  // Tolerates partial entities (several suites build bare combat fakes).
  return e?.auras?.some((a) => a.id === MORTHEN_IDENTITY_AURA_ID) ?? false;
}

// The identity's form kind triggers the stat recalc on add and removal (every
// `form*` kind does) but stays out of FORM_AURA_KINDS, so the orphaned-form
// strip never cancels it. Permanent and undispellable: only the run removes it.
export function morthenIdentityAura(ownerId: number): Aura {
  return {
    id: MORTHEN_IDENTITY_AURA_ID,
    name: 'Morthen the Gravecaller',
    kind: 'form_morthen',
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    value: 0,
    sourceId: ownerId,
    school: 'shadow',
  };
}

// While the identity holds, recalcPlayerStats runs its normal pass over no gear
// and no talents, so nothing of the real character leaks into Morthen.
export const MORTHEN_BARE_EQUIPMENT: PlayerEquipment = Object.freeze({});
export const MORTHEN_BARE_EQUIPMENT_INSTANCES: PlayerEquipmentInstances = Object.freeze({});

// Morthen keeps the boss template's immunities (`ccImmune` and `slowImmune` on
// `morthen`): another's control or snare never lands, exactly as Sim.applyAura
// gates a ccImmune mob. Interrupt lockouts are not control, so he stays kickable.
export function morthenBlocksAura(target: Entity, aura: Aura): boolean {
  return (
    hasMorthenIdentity(target) &&
    (isControlAuraKind(aura.kind) || aura.kind === 'slow') &&
    aura.sourceId !== target.id &&
    !isUnbreakableControlAura(aura)
  );
}
