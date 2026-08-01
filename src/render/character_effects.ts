import type { Entity } from '../sim/types';
import {
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SANGUINE,
  CHARACTER_EFFECT_SOUL_REND,
  characterEffectFlags,
  hasCharacterEffect,
} from './character_effects_core';

export function characterSoulRendActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_SOUL_REND);
}

export function characterSanguineAuraActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_SANGUINE);
}

export function characterRecklessnessActive(e: Entity): boolean {
  return hasCharacterEffect(characterEffectFlags(e.auras), CHARACTER_EFFECT_RECKLESSNESS);
}
