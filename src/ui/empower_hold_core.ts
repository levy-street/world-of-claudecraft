// The hold-to-charge state for empowered abilities (empowerStages), shared by the
// keyboard press/release cycle, the pointer hold, and the pad's press/release edges,
// so every input family drives the ONE charge through identical rules.

type CrossHotbarAction = { type: 'ability' | 'item'; id: string };
type HotbarAction = CrossHotbarAction | null;

export interface EmpowerHoldWorld {
  castAbility(abilityId: string): void;
  releaseEmpoweredAbility(abilityId: string): void;
}

interface EmpowerCharge {
  slot: number;
  abilityId: string;
}

// Matched against the EFFECTIVE action of each slot, never the raw array: with the
// Attack button on, slot 0 IS Attack and whatever the array holds at index 0 is not
// reachable there. barSlot 0 is that Attack seat and 1..actionCount are the
// configurable slots, so the last one is actionCount itself, not actionCount - 1.
export function crossHotbarActionSlot(
  action: CrossHotbarAction,
  actionCount: number,
  actionForSlot: (slot: number) => HotbarAction,
): number {
  for (let slot = 0; slot <= actionCount; slot++) {
    const onBar = actionForSlot(slot);
    if (onBar?.type === action.type && onBar.id === action.id) return slot;
  }
  return -1;
}

export class EmpowerHold {
  private charge: EmpowerCharge | null = null;

  get active(): boolean {
    return this.charge !== null;
  }

  press(slot: number, abilityId: string | null, world: EmpowerHoldWorld): boolean {
    if (abilityId === null) return false;
    if (this.charge !== null) return true;
    this.charge = { slot, abilityId };
    world.castAbility(abilityId);
    return true;
  }

  releaseSlot(slot: number, world: EmpowerHoldWorld, flash: (slot: number) => void): void {
    if (this.charge?.slot === slot) this.release(world, flash);
  }

  releaseAction(
    action: CrossHotbarAction,
    world: EmpowerHoldWorld,
    flash: (slot: number) => void,
  ): void {
    if (action.type === 'ability' && this.charge?.abilityId === action.id) {
      this.release(world, flash);
    }
  }

  private release(world: EmpowerHoldWorld, flash: (slot: number) => void): void {
    const charge = this.charge;
    if (charge === null) return;
    this.charge = null;
    world.releaseEmpoweredAbility(charge.abilityId);
    if (charge.slot >= 0) flash(charge.slot);
  }
}
