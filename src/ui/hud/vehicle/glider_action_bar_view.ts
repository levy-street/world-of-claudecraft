import {
  GLIDER_BOOST_COOLDOWN_SECONDS,
  GLIDER_BOOST_SPEED,
} from '../../../sim/minigames/glider_boost';
import { GLIDER_MAX_SPEED } from '../../../sim/minigames/glider_energy';
import { TICK_RATE } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';

export function gliderBoostDescription(): string {
  return t('questUi.worldQuest.glider.boostTip', {
    speed: formatNumber(GLIDER_BOOST_SPEED),
    seconds: formatNumber(GLIDER_BOOST_COOLDOWN_SECONDS),
    maximum: formatNumber(GLIDER_MAX_SPEED),
  });
}

/** Slot 1 climbs, slot 2 dives: hold the button (or tap it for a nudge). */
const PITCH_SLOTS = [
  {
    abilityId: 'glider_climb',
    iconKey: 'aspect_of_the_hawk',
    label: 'questUi.worldQuest.glider.climb',
    tip: 'questUi.worldQuest.glider.climbTip',
  },
  {
    abilityId: 'glider_dive',
    iconKey: 'wing_clip',
    label: 'questUi.worldQuest.glider.dive',
    tip: 'questUi.worldQuest.glider.diveTip',
  },
] as const;

export function createGliderActionBarView() {
  const state: ActionBarState = {
    slots: [makeSlotState(), makeSlotState(), makeSlotState()],
    manySpells: false,
  };
  return {
    tick(
      glider: { tick: number; phase: string; boostReadyTick?: number },
      keyLabel: (slot: number) => string,
    ): ActionBarState {
      const slot = state.slots[0];
      const remaining = Math.max(0, (glider.boostReadyTick ?? 0) - glider.tick) / TICK_RATE;
      slot.kind = 'ability';
      slot.abilityId = 'glider_boost';
      slot.iconKey = 'sprint';
      slot.cooldownTotal = GLIDER_BOOST_COOLDOWN_SECONDS;
      slot.cooldownRemaining = remaining;
      slot.cooldownPercent = Math.min(100, (100 * remaining) / slot.cooldownTotal);
      slot.cdText = remaining > 0 ? formatNumber(Math.ceil(remaining)) : '';
      slot.usable = glider.phase === 'flying' && remaining === 0;
      slot.ariaLabel = t('questUi.worldQuest.glider.boost');
      slot.ariaDescription = gliderBoostDescription();
      slot.keybindLabel = keyLabel(0);
      for (const [offset, def] of PITCH_SLOTS.entries()) {
        const pitch = state.slots[offset + 1];
        pitch.kind = 'ability';
        pitch.abilityId = def.abilityId;
        pitch.iconKey = def.iconKey;
        pitch.cooldownTotal = 1;
        pitch.cooldownRemaining = 0;
        pitch.cooldownPercent = 0;
        pitch.cdText = '';
        pitch.usable = glider.phase === 'flying';
        pitch.ariaLabel = t(def.label);
        pitch.ariaDescription = t(def.tip);
        pitch.keybindLabel = keyLabel(offset + 1);
      }
      return state;
    },
  };
}
