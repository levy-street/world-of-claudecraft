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
    'Summon a flying donkey to carry items between your bags and the nearest bank. It flies at 250% of normal running speed. Choose up to 24 stacks per trip. Membership is required to start a new trip.',
};
