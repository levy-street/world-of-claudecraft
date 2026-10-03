// Pure view core for the Graveyard Shift bar: while the player holds the Morthen
// identity, five slots replace the action bar. Slot 0 toggles auto-attack, slots
// 1 to 4 are the mode-local kit in MORTHEN_KIT order, so the default keys 1 to 5
// drive them. The state array is allocated once and mutated in place each tick
// (the action-bar family's allocation contract); the controller paints it through
// ActionBarPainter.

import { effectivePlayerAttackRange } from '../../../sim/combat/player_attack_reach';
import { MORTHEN_KIT } from '../../../sim/graveyard_shift/kit';
import { type AbilityDef, dist2d, GCD, type Vec3 } from '../../../sim/types';
import { abilityRangeLine, resourceDisplayName } from '../../ability_tooltip_lines';
import { esc } from '../../esc';
import {
  graveyardShiftAbilityDescription,
  graveyardShiftAbilityName,
} from '../../graveyard_shift_text_core';
import { formatNumber, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';

export const MORTHEN_ATTACK_SLOT = 0;

/** The bar layout: null is the Attack toggle, then the kit in order. */
export const MORTHEN_BAR_SLOTS: readonly (AbilityDef | null)[] = [null, ...MORTHEN_KIT];

/** The kit ability a slot casts, or null for the Attack slot and any slot past the bar. */
export function morthenSlotAbility(slot: number): AbilityDef | null {
  return MORTHEN_BAR_SLOTS[slot] ?? null;
}

/** Icon art borrowed from shipped abilities until the kit gets its own. */
const KIT_ICON_KEYS: Readonly<Record<string, string>> = {
  gshift_gravecall: 'shadow_bolt',
  gshift_shadow_pulse: 'psychic_scream',
  gshift_sextons_chain: 'oath_chain',
  gshift_barrow_shroud: 'shellskin',
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
  return {
    tick(
      player: MorthenBarPlayer,
      target: MorthenBarTarget | null,
      keyLabel: (slot: number) => string,
    ): ActionBarState {
      const liveTarget = target && !target.dead ? target : null;
      const distance = liveTarget ? dist2d(player.pos, liveTarget.pos) : null;
      for (let i = 0; i < state.slots.length; i++) {
        const slot = state.slots[i];
        const def = MORTHEN_BAR_SLOTS[i];
        slot.keybindLabel = keyLabel(i);
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
          slot.ariaLabel = t('abilityUi.actionBar.slotAria', {
            slot: formatNumber(i + 1),
            ability: t('abilityUi.actionBar.attackName'),
          });
          slot.ariaDescription = t('abilityUi.actionBar.attackTooltip');
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
        slot.ariaLabel = t('abilityUi.actionBar.slotAria', {
          slot: formatNumber(i + 1),
          ability: graveyardShiftAbilityName(def.id) ?? def.id,
        });
        slot.ariaDescription = graveyardShiftAbilityDescription(def.id) ?? '';
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
