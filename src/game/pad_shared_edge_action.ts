import type { InterfaceVisibility } from '../ui/interface_visibility_core';
import { dispatchInterfaceVisibilityAction } from '../ui/interface_visibility_core';
import type { Input } from './input';
import { dispatchPetAction, type PetCommandWorld } from './pet_commands';
import { zoomStepForAction } from './wheel_binds';

export interface PadSharedEdgeActionDeps {
  input: Pick<Input, 'zoomBy'>;
  interfaceVisibility: InterfaceVisibility;
  world: PetCommandWorld;
}

/** Shared controller routing for edge binds handled outside the switch. */
export function dispatchPadSharedEdgeAction(
  action: string,
  deps: PadSharedEdgeActionDeps,
): boolean {
  if (dispatchPetAction(action, deps.world)) return true;
  if (dispatchInterfaceVisibilityAction(action, deps.interfaceVisibility)) return true;
  const zoomStep = zoomStepForAction(action);
  if (zoomStep === null) return false;
  deps.input.zoomBy(zoomStep);
  return true;
}
