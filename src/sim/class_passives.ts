import type { Aura } from './types';

export const DEMON_HUNTER_LIFESTEAL_AURA_ID = 'demon_hunter_soul_leech';
export const DEMON_HUNTER_LIFESTEAL_NAME = 'Soul Leech';
export const DEMON_HUNTER_LIFESTEAL_PCT = 0.07;

export function demonHunterLifestealAura(sourceId: number): Aura {
  return {
    id: DEMON_HUNTER_LIFESTEAL_AURA_ID,
    name: DEMON_HUNTER_LIFESTEAL_NAME,
    kind: 'buff_lifesteal',
    remaining: Number.POSITIVE_INFINITY,
    duration: Number.POSITIVE_INFINITY,
    value: DEMON_HUNTER_LIFESTEAL_PCT,
    sourceId,
    school: 'chaos',
  };
}
