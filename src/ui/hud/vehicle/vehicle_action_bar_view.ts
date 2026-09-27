import { CANNON_ACTIONS } from '../../../sim/content/cannon_encounter';
import { TICK_RATE, type VehicleSession } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';
import { vehicleActionDescription } from './vehicle_action_tooltip';
import { VEHICLE_ACTION_SLOTS } from './vehicle_aim_core';

const ICONS = ['fireball', 'multi_shot', 'flamestrike'];
const LABELS = [
  'hudChrome.vehicle.cannonball',
  'hudChrome.vehicle.grapeshot',
  'hudChrome.vehicle.incendiary',
] as const;

export function createVehicleActionBarView() {
  const state: ActionBarState = {
    slots: VEHICLE_ACTION_SLOTS.map(() => makeSlotState()),
    manySpells: false,
  };
  return {
    tick(
      session: VehicleSession,
      aiming: number | null,
      keyLabel: (slot: number) => string,
    ): ActionBarState {
      const encounter = session.encounter;
      for (let i = 0; i < state.slots.length; i++) {
        const slot = state.slots[i];
        const action = VEHICLE_ACTION_SLOTS[i];
        const remaining =
          Math.max(
            0,
            encounter.readyAt[action] - encounter.tick,
            encounter.recoveryUntilTick - encounter.tick,
          ) / TICK_RATE;
        slot.kind = 'ability';
        slot.abilityId = action;
        slot.iconKey = ICONS[i];
        slot.cooldownTotal = CANNON_ACTIONS[action].cooldownTicks / TICK_RATE;
        slot.cooldownRemaining = remaining;
        slot.cooldownPercent = (100 * remaining) / slot.cooldownTotal;
        slot.cdText = remaining > 0 ? formatNumber(Math.ceil(remaining)) : '';
        slot.usable = encounter.phase === 'wave' && remaining === 0;
        slot.aiming = aiming === i;
        slot.ariaLabel = t(LABELS[i]);
        slot.ariaDescription = vehicleActionDescription(action);
        slot.keybindLabel = keyLabel(i);
      }
      return state;
    },
  };
}
