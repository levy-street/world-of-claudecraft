import type { AbilityDef } from '../types';

export const COURIER_ABILITY: AbilityDef = {
  id: 'courier',
  name: 'Courier',
  class: 'warrior',
  learnLevel: 1,
  cost: 0,
  castTime: 0,
  cooldown: 0,
  range: 0,
  school: 'nature',
  requiresTarget: false,
  effects: [],
  description:
    'Summon a flying donkey to carry items between your bags and the nearest bank. Each journey takes up to 15 seconds to the bank and up to 15 seconds back, flying faster on longer routes. Choose up to 24 stacks per trip. Returned items overflow full bags, then the courier vanishes until summoned again. Return travel pauses while you are dead or inside an instance. Membership is required to start a new trip.',
};
