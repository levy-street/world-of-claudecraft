// The hourly skill event bar: the PURE view (no DOM). The event's kit verbs in
// bar order, then the one class ability the fighter kept, as action bar slot
// states for the shared ActionBarPainter. Verb cooldowns come from the event
// readout; the keepsake's from the fighter's own cooldowns.

import type { SkillEventInfo } from '../../../world_api';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import {
  type ActionBarSlotState,
  type ActionBarState,
  makeSlotState,
} from '../action_bar/action_bar_view';

/** Existing ability art for each verb (the kit has no AbilityDefs of its own). */
export const SKILL_EVENT_VERB_ICONS: Readonly<Record<string, string>> = {
  lunge: 'heroic_strike',
  guard: 'raised_guard',
  feint: 'evasion',
  sidestep: 'blink',
};

/** Each verb's name and its tooltip, as explicit keys (the i18n scanner reads them). */
export const SKILL_EVENT_VERB_LABELS: Readonly<Record<string, TranslationKey>> = {
  lunge: 'hud.skillEvent.verbs.lunge',
  guard: 'hud.skillEvent.verbs.guard',
  feint: 'hud.skillEvent.verbs.feint',
  sidestep: 'hud.skillEvent.verbs.sidestep',
};
export const SKILL_EVENT_VERB_TIPS: Readonly<Record<string, TranslationKey>> = {
  lunge: 'hud.skillEvent.verbTips.lunge',
  guard: 'hud.skillEvent.verbTips.guard',
  feint: 'hud.skillEvent.verbTips.feint',
  sidestep: 'hud.skillEvent.verbTips.sidestep',
};

/** Most slots any kit shows: four verbs and the keepsake. */
export const SKILL_EVENT_BAR_SLOTS = 5;

function fillCooldown(slot: ActionBarSlotState, remaining: number): void {
  slot.cooldownRemaining = remaining;
  slot.cooldownTotal = Math.max(1, remaining);
  slot.cooldownPercent = remaining > 0 ? 100 : 0;
  slot.cdText = remaining > 0 ? String(Math.ceil(remaining)) : '';
}

export function createSkillEventBarView() {
  const state: ActionBarState = {
    slots: Array.from({ length: SKILL_EVENT_BAR_SLOTS }, makeSlotState),
    manySpells: false,
  };
  return {
    tick(
      info: SkillEventInfo,
      keepsakeCooldown: number,
      keyLabel: (slot: number) => string,
    ): ActionBarState {
      const kit = info.kit;
      const verbs = kit?.verbs ?? [];
      for (let i = 0; i < SKILL_EVENT_BAR_SLOTS; i++) {
        const slot = state.slots[i];
        const verb = verbs[i];
        if (verb) {
          slot.kind = 'ability';
          slot.abilityId = `skill_event_${verb.id}`;
          slot.iconKey = SKILL_EVENT_VERB_ICONS[verb.id] ?? 'heroic_strike';
          const label = SKILL_EVENT_VERB_LABELS[verb.id];
          slot.ariaLabel = label ? t(label) : '';
          slot.keybindLabel = keyLabel(i);
          fillCooldown(slot, verb.readyIn);
          slot.usable = verb.readyIn <= 0;
          continue;
        }
        if (i === verbs.length && kit?.keepsake) {
          slot.kind = 'ability';
          slot.abilityId = kit.keepsake;
          slot.iconKey = kit.keepsake;
          slot.ariaLabel = t('hud.skillEvent.keepsake');
          slot.keybindLabel = keyLabel(i);
          fillCooldown(slot, keepsakeCooldown);
          slot.usable = keepsakeCooldown <= 0;
          continue;
        }
        Object.assign(slot, makeSlotState());
      }
      return state;
    },
  };
}
