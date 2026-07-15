// Shared class inventory for standalone Node tooling. Keep this plain ESM so
// scripts can consume it without importing the TypeScript simulation directly.
// tests/playable_class_tooling.test.ts guards parity with sim/types.ALL_CLASSES.
export const PLAYABLE_CLASSES = Object.freeze([
  'warrior',
  'swordmaster',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);

// One always-known offensive cast per class for combat load generation. These
// are intentionally baseline abilities so fresh or level-adjusted bots can use
// them without spec state.
export const LOAD_ATTACK_ABILITIES = Object.freeze({
  warrior: 'heroic_strike',
  swordmaster: 'twin_slash',
  paladin: 'judgement',
  hunter: 'arcane_shot',
  rogue: 'sinister_strike',
  priest: 'smite',
  shaman: 'lightning_bolt',
  mage: 'fireball',
  warlock: 'shadow_bolt',
  druid: 'wrath',
});
