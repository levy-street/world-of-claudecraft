import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { AbilityEffect, Entity } from '../src/sim/types';
import { abilityStartsAutoAttack, hasAutoAttackTarget } from '../src/ui/attack_on_ability';

// Resolve a real ability's rank-1 effects by id, so the test pins behavior against
// the actual content tables (not hand-mocked shapes that could drift).
const effectsOf = (id: string): AbilityEffect[] => {
  const def = ABILITIES[id];
  if (!def) throw new Error(`unknown ability for test: ${id}`);
  return def.effects;
};

describe('abilityStartsAutoAttack', () => {
  it('engages on damaging attacks', () => {
    // weaponStrike / directDamage / finisher / spell damage all count as an attack.
    expect(abilityStartsAutoAttack(effectsOf('sinister_strike'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('mortal_strike'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('fireball'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('eviscerate'))).toBe(true);
  });

  it('does not engage on heals or self/ally buffs', () => {
    expect(abilityStartsAutoAttack(effectsOf('battle_shout'))).toBe(false); // selfBuff
    expect(abilityStartsAutoAttack(effectsOf('mark_of_the_wild'))).toBe(false); // buffTarget (friendly)
  });

  it('does not engage on pure crowd control', () => {
    expect(abilityStartsAutoAttack(effectsOf('polymorph'))).toBe(false); // polymorph only
    expect(abilityStartsAutoAttack(effectsOf('sap'))).toBe(false); // incapacitate only
    expect(abilityStartsAutoAttack(effectsOf('hammer_of_justice'))).toBe(false); // stun, no damage
  });

  it('never engages on damage-breakable CC even when the ability also deals damage', () => {
    // Gouge deals directDamage AND incapacitates; auto-swinging would break the CC.
    const gouge = effectsOf('gouge');
    expect(gouge.some((e) => e.type === 'directDamage')).toBe(true);
    expect(gouge.some((e) => e.type === 'incapacitate')).toBe(true);
    expect(abilityStartsAutoAttack(gouge)).toBe(false);
  });

  it('is order-independent for the break-on-damage CC exclusion', () => {
    const dmg: AbilityEffect = { type: 'directDamage', min: 8, max: 9 };
    const cc: AbilityEffect = { type: 'incapacitate', duration: 4 };
    expect(abilityStartsAutoAttack([dmg, cc])).toBe(false);
    expect(abilityStartsAutoAttack([cc, dmg])).toBe(false);
  });

  it('does not engage on an empty effect list', () => {
    expect(abilityStartsAutoAttack([])).toBe(false);
  });

  it('reports the self/ground AOEs as attacks (so the caller MUST gate on a target)', () => {
    // These deal damage but are requiresTarget:false, so they cast with no hostile
    // target selected. abilityStartsAutoAttack returns true for them, which is exactly
    // why castSlot must additionally gate on hasAutoAttackTarget: an unconditional
    // startAutoAttack here pops a spurious "Invalid attack target." toast (#1063).
    expect(abilityStartsAutoAttack(effectsOf('arcane_explosion'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('frost_nova'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('thunder_clap'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('consecration'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('cleave'))).toBe(true);
  });
});

// Minimal stand-in: hasAutoAttackTarget reads only `dead` and `hostile`. Only mobs
// carry hostile:true (players/NPCs default false), and the server mirrors the flag
// onto the wire, so the same predicate holds offline and online.
const target = (over: Partial<Pick<Entity, 'dead' | 'hostile'>>): Entity =>
  ({ dead: false, hostile: true, ...over }) as unknown as Entity;

describe('hasAutoAttackTarget', () => {
  it('is true for a live hostile target (auto-attack would engage, not error)', () => {
    expect(hasAutoAttackTarget(target({}))).toBe(true);
  });

  it('is false with no target (the targetless-AOE case that errored, #1063)', () => {
    expect(hasAutoAttackTarget(null)).toBe(false);
    expect(hasAutoAttackTarget(undefined)).toBe(false);
  });

  it('is false for a dead target', () => {
    expect(hasAutoAttackTarget(target({ dead: true }))).toBe(false);
  });

  it('is false for a non-hostile target (friendly NPC / player)', () => {
    expect(hasAutoAttackTarget(target({ hostile: false }))).toBe(false);
  });
});
