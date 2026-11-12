// The hourly skill event bar: the PURE view (no DOM). The event's kit verbs in
// bar order, then the one class ability the fighter kept, as action bar slot
// states for the shared ActionBarPainter. Verb cooldowns come from the event
// readout; the keepsake's from the fighter's own cooldowns.

import { ABILITIES } from '../../../sim/content/classes';
import type { SkillEventInfo } from '../../../world_api';
import { abilityDisplayName } from '../../ability_display_name';
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
  sweep: 'whirlwind',
  hush: 'prowl',
  pebble: 'sap',
  rite: 'holy_light',
  sever: 'counterspell',
  false_start: 'arcane_missiles',
  shove: 'thunder_clap',
  bolt: 'arcane_missiles',
  brace: 'raised_guard',
  dash: 'blink',
};

/** Each verb's name and its tooltip, as explicit keys (the i18n scanner reads them). */
export const SKILL_EVENT_VERB_LABELS: Readonly<Record<string, TranslationKey>> = {
  lunge: 'hud.skillEvent.verbs.lunge',
  guard: 'hud.skillEvent.verbs.guard',
  feint: 'hud.skillEvent.verbs.feint',
  sidestep: 'hud.skillEvent.verbs.sidestep',
  sweep: 'hud.skillEvent.verbs.sweep',
  hush: 'hud.skillEvent.verbs.hush',
  pebble: 'hud.skillEvent.verbs.pebble',
  rite: 'hud.skillEvent.verbs.rite',
  sever: 'hud.skillEvent.verbs.sever',
  false_start: 'hud.skillEvent.verbs.false_start',
  shove: 'hud.skillEvent.verbs.shove',
  bolt: 'hud.skillEvent.verbs.bolt',
  brace: 'hud.skillEvent.verbs.brace',
  dash: 'hud.skillEvent.verbs.dash',
};
export const SKILL_EVENT_VERB_TIPS: Readonly<Record<string, TranslationKey>> = {
  lunge: 'hud.skillEvent.verbTips.lunge',
  guard: 'hud.skillEvent.verbTips.guard',
  feint: 'hud.skillEvent.verbTips.feint',
  sidestep: 'hud.skillEvent.verbTips.sidestep',
  sweep: 'hud.skillEvent.verbTips.sweep',
  hush: 'hud.skillEvent.verbTips.hush',
  pebble: 'hud.skillEvent.verbTips.pebble',
  rite: 'hud.skillEvent.verbTips.rite',
  sever: 'hud.skillEvent.verbTips.sever',
  false_start: 'hud.skillEvent.verbTips.false_start',
  shove: 'hud.skillEvent.verbTips.shove',
  bolt: 'hud.skillEvent.verbTips.bolt',
  brace: 'hud.skillEvent.verbTips.brace',
  dash: 'hud.skillEvent.verbTips.dash',
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
          // The Common Hand's buttons wear the dealt ability itself.
          const dealt = info.hand?.current[i];
          const dealtDef = dealt ? ABILITIES[dealt] : undefined;
          slot.abilityId = dealtDef ? dealtDef.id : `skill_event_${verb.id}`;
          slot.iconKey = dealtDef
            ? dealtDef.id
            : (SKILL_EVENT_VERB_ICONS[verb.id] ?? 'heroic_strike');
          const label = SKILL_EVENT_VERB_LABELS[verb.id];
          slot.ariaLabel = dealtDef ? abilityDisplayName(dealtDef) : label ? t(label) : '';
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
