// Pure view core for the Graveyard Shift bar: while the player holds the Morthen
// identity, four slots replace the action bar. Slot 0 toggles auto-attack, slots
// 1 to 3 are the mode-local kit in MORTHEN_KIT order, so the default keys 1 to 4
// drive them. The state array is allocated once and mutated in place each tick
// (the action-bar family's allocation contract); the controller paints it through
// ActionBarPainter.

import { effectivePlayerAttackRange } from '../../../sim/combat/player_attack_reach';
import { MORTHEN_BAR_SLOTS, morthenSlotAbility } from '../../../sim/graveyard_shift/kit';
import { dist2d, GCD, type Vec3 } from '../../../sim/types';
import { abilityRangeLine, resourceDisplayName } from '../../ability_tooltip_lines';
import { esc } from '../../esc';
import {
  graveyardShiftAbilityDescription,
  graveyardShiftAbilityName,
} from '../../graveyard_shift_text_core';
import { formatNumber, getI18nRevision, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';

/** Icon art borrowed from shipped abilities until the kit gets its own. */
const KIT_ICON_KEYS: Readonly<Record<string, string>> = {
  gshift_shadow_pulse: 'psychic_scream',
  gshift_sextons_chain: 'oath_chain',
  gshift_raise_fallen: 'raise_skeletal_warrior',
};
export const MORTHEN_ATTACK_ICON_KEY = 'attack';

// The countdown digits show only while more than a second remains, as on the action bar.
const COOLDOWN_TEXT_THRESHOLD = 1;

/** The player fields one tick reads; a structural subset of the player entity. */
export interface MorthenBarPlayer {
  dead: boolean;
  autoAttack: boolean;
  gcdRemaining: number;
  cooldowns: { get(id: string): number | undefined };
  pos: Vec3;
  /** The Dread bar: a slot whose cost it cannot pay paints unusable. */
  resource: number;
}

/** The current target, or null when there is none. */
export interface MorthenBarTarget {
  dead: boolean;
  kind: string;
  templateId: string;
  pos: Vec3;
}

export function createMorthenActionBarView() {
  const state: ActionBarState = {
    slots: MORTHEN_BAR_SLOTS.map(() => makeSlotState()),
    manySpells: false,
  };
  // The slot labels and the full tooltip prose change only with the language, so
  // they are resolved once per i18n revision, never per frame.
  const ariaLabels: string[] = MORTHEN_BAR_SLOTS.map(() => '');
  const ariaDescriptions: string[] = MORTHEN_BAR_SLOTS.map(() => '');
  let textRevision = -1;
  function refreshText(): void {
    for (let i = 0; i < MORTHEN_BAR_SLOTS.length; i++) {
      const def = MORTHEN_BAR_SLOTS[i];
      ariaLabels[i] = t('abilityUi.actionBar.slotAria', {
        slot: formatNumber(i + 1),
        ability: def
          ? (graveyardShiftAbilityName(def.id) ?? def.id)
          : t('abilityUi.actionBar.attackName'),
      });
      ariaDescriptions[i] = def
        ? (graveyardShiftAbilityDescription(def.id) ?? '')
        : t('abilityUi.actionBar.attackTooltip');
    }
  }
  return {
    tick(
      player: MorthenBarPlayer,
      target: MorthenBarTarget | null,
      keyLabel: (slot: number) => string,
    ): ActionBarState {
      const revision = getI18nRevision();
      if (revision !== textRevision) {
        textRevision = revision;
        refreshText();
      }
      const liveTarget = target && !target.dead ? target : null;
      const distance = liveTarget ? dist2d(player.pos, liveTarget.pos) : null;
      for (let i = 0; i < state.slots.length; i++) {
        const slot = state.slots[i];
        const def = MORTHEN_BAR_SLOTS[i];
        slot.keybindLabel = keyLabel(i);
        slot.ariaLabel = ariaLabels[i];
        slot.ariaDescription = ariaDescriptions[i];
        if (!def) {
          slot.kind = 'attack';
          slot.abilityId = null;
          slot.iconKey = MORTHEN_ATTACK_ICON_KEY;
          slot.cooldownRemaining = 0;
          slot.cooldownTotal = 0;
          slot.cooldownPercent = 0;
          slot.cdText = '';
          slot.usable = !player.dead;
          slot.outOfRange =
            liveTarget !== null &&
            distance !== null &&
            distance > effectivePlayerAttackRange(liveTarget, 0);
          slot.queued = player.autoAttack;
          continue;
        }
        const cooldown = Math.max(0, player.cooldowns.get(def.id) ?? 0);
        const gcd = def.offGcd ? 0 : Math.max(0, player.gcdRemaining);
        const shown = Math.max(cooldown, gcd);
        const total = cooldown > 0 ? def.cooldown : GCD;
        slot.kind = 'ability';
        slot.abilityId = def.id;
        slot.iconKey = KIT_ICON_KEYS[def.id] ?? def.id;
        slot.cooldownRemaining = shown;
        slot.cooldownTotal = total;
        slot.cooldownPercent = shown > 0 ? Math.min(100, (shown / Math.max(0.01, total)) * 100) : 0;
        slot.cdText = cooldown > COOLDOWN_TEXT_THRESHOLD ? formatNumber(Math.ceil(cooldown)) : '';
        slot.usable =
          !player.dead &&
          player.resource >= def.cost &&
          (!def.requiresTarget || liveTarget !== null);
        slot.outOfRange =
          def.requiresTarget &&
          liveTarget !== null &&
          distance !== null &&
          distance > effectivePlayerAttackRange(liveTarget, def.range);
        slot.queued = false;
      }
      return state;
    },
  };
}

function seconds(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/** The slot's tooltip HTML: the name, the Dread cost / range / cast / cooldown line, the prose. */
export function morthenSlotTooltipHtml(slot: number, spellHaste = 0): string {
  const def = morthenSlotAbility(slot);
  if (!def) {
    return `<div class="tt-title">${esc(t('abilityUi.actionBar.attackName'))}</div><div class="tt-sub">${esc(t('abilityUi.actionBar.attackTooltip'))}</div>`;
  }
  const stats: string[] = [];
  if (def.cost > 0) {
    stats.push(
      t('abilityUi.tooltip.cost', {
        cost: formatNumber(def.cost),
        resource: resourceDisplayName('dread'),
      }),
    );
  }
  const range = abilityRangeLine(def);
  if (range) stats.push(range);
  // Spell haste shortens the shown cast exactly as the sim does (abilityCastLine).
  stats.push(
    def.castTime > 0
      ? t('abilityUi.tooltip.castSeconds', {
          seconds: seconds(def.castTime / (1 + Math.max(0, spellHaste))),
        })
      : t('abilityUi.tooltip.instant'),
  );
  if (def.cooldown > 0)
    stats.push(t('abilityUi.tooltip.cooldownSeconds', { seconds: seconds(def.cooldown) }));
  return (
    `<div class="tt-title">${esc(graveyardShiftAbilityName(def.id) ?? def.id)}</div>` +
    `<div class="tt-stat">${stats.map(esc).join(' &nbsp; ')}</div>` +
    `<div class="tt-desc">${esc(graveyardShiftAbilityDescription(def.id) ?? '')}</div>`
  );
}
