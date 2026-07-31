import type { Entity } from '../sim/types';

export function characterSoulRendActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'nythraxis_soul_rend');
}

export function characterSanguineAuraActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'sanguine_aura');
}

export function characterRecklessnessActive(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'buff_reckless');
}

import {
  BATTLE_RUNE_AURA_ID,
  RUNE_VISUALS,
  SPRINT_RUNE_AURA_ID,
  WARD_RUNE_AURA_ID,
} from '../sim/social/battleground';

/** The whole-body tint color for an active Thornhollow Fields rune buff (null = none). */
export function characterRuneTintColor(e: Entity): number | null {
  for (const a of e.auras) {
    if (a.id === SPRINT_RUNE_AURA_ID) return RUNE_VISUALS.sprint.color;
    if (a.id === BATTLE_RUNE_AURA_ID) return RUNE_VISUALS.damage.color;
    if (a.id === WARD_RUNE_AURA_ID) return RUNE_VISUALS.defense.color;
  }
  return null;
}
