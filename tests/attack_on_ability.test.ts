import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { AbilityEffect, Entity } from '../src/sim/types';
import {
  abilityStartsAutoAttack,
  deferAutoAttackUntilCastEnd,
  hasAutoAttackTarget,
  isPvpHostileTarget,
} from '../src/ui/hud/action_bar/attack_on_ability';
import type { ArenaInfo, DuelInfo } from '../src/world_api/duel_arena';

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

    // Icebind deals its own damage before applying its damage-breakable root.
    // That initial packet stays, but a follow-up white swing must not shatter it.
    const icebind = effectsOf('frost_nova');
    expect(
      icebind.some(
        (e) =>
          e.type === 'aoeRoot' && e.breakOnDamage !== undefined && (e.min !== 0 || e.max !== 0),
      ),
    ).toBe(true);
    expect(abilityStartsAutoAttack(icebind)).toBe(false);
  });

  it('is order-independent for the break-on-damage CC exclusion', () => {
    const dmg: AbilityEffect = { type: 'directDamage', min: 8, max: 9 };
    const cc: AbilityEffect = { type: 'incapacitate', duration: 4 };
    expect(abilityStartsAutoAttack([dmg, cc])).toBe(false);
    expect(abilityStartsAutoAttack([cc, dmg])).toBe(false);
  });

  it('treats area fear as break-on-damage CC', () => {
    const dmg: AbilityEffect = { type: 'directDamage', min: 8, max: 9 };
    const fear: AbilityEffect = { type: 'aoeFear', duration: 4, radius: 8 };
    expect(abilityStartsAutoAttack([dmg, fear])).toBe(false);
    expect(abilityStartsAutoAttack([fear, dmg])).toBe(false);
  });

  it('still engages on a damaging area root that does not break on damage', () => {
    const root: AbilityEffect = {
      type: 'aoeRoot',
      duration: 4,
      radius: 8,
      min: 6,
      max: 7,
    };
    expect(abilityStartsAutoAttack([root])).toBe(true);
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
    expect(abilityStartsAutoAttack(effectsOf('thunder_clap'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('consecration'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('cleave'))).toBe(true);
    expect(abilityStartsAutoAttack(effectsOf('heroic_leap'))).toBe(true);
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

  // #2451: casting a damaging ability on a duel/arena opponent never engaged
  // auto-attack, because the player target's `hostile` flag is always false (this
  // game has no open-world FFA PvP). hasAutoAttackTarget must also honor an
  // explicit pvpHostile verdict (computed by the caller via isPvpHostileTarget),
  // while staying additive: an omitted/false pvpHostile keeps the original
  // PvE-only behavior for a non-hostile target.
  it('is true for a live, non-hostile player target when pvpHostile is true (#2451)', () => {
    expect(hasAutoAttackTarget(target({ hostile: false }), true)).toBe(true);
  });

  it('stays false for the same target when pvpHostile is false', () => {
    expect(hasAutoAttackTarget(target({ hostile: false }), false)).toBe(false);
    expect(hasAutoAttackTarget(target({ hostile: false }))).toBe(false);
  });

  it('is still false for a dead target even when pvpHostile is true', () => {
    expect(hasAutoAttackTarget(target({ dead: true, hostile: false }), true)).toBe(false);
  });

  it('is still false with no target even when pvpHostile is true', () => {
    expect(hasAutoAttackTarget(null, true)).toBe(false);
    expect(hasAutoAttackTarget(undefined, true)).toBe(false);
  });
});

describe('isPvpHostileTarget (the duel/arena PvP gate, #2451)', () => {
  const OTHER_PID = 42;

  it('is false with no target id', () => {
    expect(isPvpHostileTarget(null, null, null)).toBe(false);
    expect(isPvpHostileTarget(undefined, null, null)).toBe(false);
  });

  it('is true when an active duel targets this exact pid', () => {
    const duel: DuelInfo = { otherPid: OTHER_PID, otherName: 'Rival', state: 'active' };
    expect(isPvpHostileTarget(OTHER_PID, duel, null)).toBe(true);
  });

  it('is false while the duel is still counting down', () => {
    const duel: DuelInfo = { otherPid: OTHER_PID, otherName: 'Rival', state: 'countdown' };
    expect(isPvpHostileTarget(OTHER_PID, duel, null)).toBe(false);
  });

  it('is false when the active duel targets a different pid', () => {
    const duel: DuelInfo = { otherPid: OTHER_PID, otherName: 'Rival', state: 'active' };
    expect(isPvpHostileTarget(999, duel, null)).toBe(false);
  });

  const baseMatch: NonNullable<ArenaInfo['match']> = {
    format: '2v2',
    state: 'active',
    oppName: 'Opp',
    oppClass: 'warrior',
    oppLevel: 20,
    oppPid: OTHER_PID,
    allies: [],
    enemies: [],
  };

  it('is true when the active arena match opponent is this exact pid', () => {
    const arena: ArenaInfo = arenaInfoWith(baseMatch);
    expect(isPvpHostileTarget(OTHER_PID, null, arena)).toBe(true);
  });

  it('is true when the pid appears in the arena enemies list (a teammate target)', () => {
    const enemyPid = 7;
    const arena: ArenaInfo = arenaInfoWith({
      ...baseMatch,
      oppPid: OTHER_PID,
      enemies: [{ pid: enemyPid, name: 'Foe', cls: 'mage', level: 20 }],
    });
    expect(isPvpHostileTarget(enemyPid, null, arena)).toBe(true);
  });

  it('is false when the arena match is not active (countdown/over)', () => {
    const arena: ArenaInfo = arenaInfoWith({ ...baseMatch, state: 'countdown' });
    expect(isPvpHostileTarget(OTHER_PID, null, arena)).toBe(false);
  });

  it('is false when there is no arena match at all', () => {
    const arena: ArenaInfo = arenaInfoWith(null);
    expect(isPvpHostileTarget(OTHER_PID, null, arena)).toBe(false);
  });
});

function arenaInfoWith(match: ArenaInfo['match']): ArenaInfo {
  return {
    rating: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    standings: {} as ArenaInfo['standings'],
    format: null,
    queued: false,
    queueSize: 0,
    match,
    ladder: [],
    ladders: {} as ArenaInfo['ladders'],
  };
}

describe('deferAutoAttackUntilCastEnd (the aggro-before-damage bug)', () => {
  it('defers for a timed cast so starting a Smite cannot pull the mob early', () => {
    // any positive cast time waits for the successful castStop
    expect(deferAutoAttackUntilCastEnd(2.5)).toBe(true);
    expect(deferAutoAttackUntilCastEnd(0.1)).toBe(true);
    // a real timed spell from content: the priest's smite carries a cast time
    const smite = ABILITIES.smite;
    if (smite) expect(deferAutoAttackUntilCastEnd(smite.castTime)).toBe(true);
  });

  it('engages immediately for instants (their damage lands the same tick)', () => {
    expect(deferAutoAttackUntilCastEnd(0)).toBe(false);
  });
});
