// mouseover_cast_core.ts: the Clique-style redirect rule shared by party /
// raid rows, focus frames and the target-of-target frame. Every gate gets a
// negative case, because the rule is as much about what it refuses to redirect:
// an offensive press must never be stolen off the current target by a cursor
// resting on a friendly frame.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import {
  type MouseoverCastAbility,
  mouseoverCastTarget,
  mouseoverCastTargetPid,
} from '../src/ui/mouseover_cast_core';

const HEAL: MouseoverCastAbility = { requiresTarget: true, targetType: 'friendly' };
const alive = (id: number) => id === 7;
const simLikeEntities = (ids: readonly number[]) => (pid: number) => ids.includes(pid);

describe('mouseoverCastTarget', () => {
  it('redirects a friendly targeted ability onto the hovered unit', () => {
    expect(mouseoverCastTarget(7, { enabled: true, ability: HEAL, exists: alive })).toBe(7);
  });

  it('does not redirect when nothing is hovered', () => {
    expect(mouseoverCastTarget(null, { enabled: true, ability: HEAL, exists: alive })).toBeNull();
  });

  it('does not redirect while the mouseoverCast option is off', () => {
    expect(mouseoverCastTarget(7, { enabled: false, ability: HEAL, exists: alive })).toBeNull();
  });

  it('does not redirect an offensive ability, so a hovered frame never steals a nuke', () => {
    const nuke: MouseoverCastAbility = { requiresTarget: true, targetType: 'enemy' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: nuke, exists: alive })).toBeNull();
  });

  it("does not redirect an 'any' ability with no heal effect", () => {
    const either: MouseoverCastAbility = { requiresTarget: true, targetType: 'any' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: either, exists: alive })).toBeNull();
  });

  it('does not redirect an ability with no targetType at all', () => {
    const untyped: MouseoverCastAbility = { requiresTarget: true };
    expect(mouseoverCastTarget(7, { enabled: true, ability: untyped, exists: alive })).toBeNull();
  });

  it('does not redirect a targetless ability', () => {
    const aoe: MouseoverCastAbility = { requiresTarget: false, targetType: 'friendly' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: aoe, exists: alive })).toBeNull();
  });

  it('falls back to the normal cast when a non-party hovered unit went stale', () => {
    expect(mouseoverCastTarget(99, { enabled: true, ability: HEAL, exists: alive })).toBeNull();
  });

  it('redirects a combat resurrection to a party member outside interest scope', () => {
    // The ClientWorld-shaped host can lose the released ghost's entity at the
    // graveyard, but the party wire still vouches for the member.
    expect(
      mouseoverCastTarget(7, {
        enabled: true,
        ability: ABILITIES.temporal_reversal,
        exists: () => false,
        partyMemberPids: () => [1, 7],
      }),
    ).toBe(7);
  });

  it('reads the roster only when the entity is out of scope', () => {
    let rosterReads = 0;
    const roster = () => {
      rosterReads++;
      return [1, 7];
    };
    expect(
      mouseoverCastTarget(7, {
        enabled: true,
        ability: HEAL,
        exists: alive,
        partyMemberPids: roster,
      }),
    ).toBe(7);
    expect(rosterReads).toBe(0);
  });

  it('redirects a dual-purpose heal like a friendly one', () => {
    // Solar Invocation (the paladin's instant heal) and Scouring Mercy are
    // targetType 'any': heal a friend or strike a foe. Leaving them off the
    // redirect meant a raid-frame mouseover fell through to the current target
    // and answered "You have no target." with nothing selected.
    const inScope = {
      enabled: true,
      hasEntity: simLikeEntities([7]),
      partyMemberPids: () => [1, 7],
    };
    for (const id of ['solar_invocation', 'scouring_mercy'] as const) {
      expect(ABILITIES[id].targetType, id).toBe('any');
      expect(mouseoverCastTargetPid(7, ABILITIES[id], inScope), id).toBe(7);
    }
    // A live member outside interest scope rides the roster, as for a friendly heal.
    expect(
      mouseoverCastTargetPid(7, ABILITIES.solar_invocation, {
        enabled: true,
        hasEntity: () => false,
        partyMemberPids: () => [1, 7],
      }),
    ).toBe(7);
    expect(
      mouseoverCastTargetPid(7, ABILITIES.solar_invocation, { ...inScope, enabled: false }),
    ).toBeNull();
  });

  it('never redirects a dual-purpose ability that cannot heal', () => {
    // Shadeslip and the two dispel-steals also cast on either side, but a press
    // meant for the enemy must not jump to whichever frame the cursor rests on.
    const inScope = {
      enabled: true,
      hasEntity: simLikeEntities([7]),
      partyMemberPids: () => [1, 7],
    };
    for (const id of ['shadowstep', 'spellsteal', 'voidfeast'] as const) {
      expect(ABILITIES[id].targetType, id).toBe('any');
      expect(mouseoverCastTargetPid(7, ABILITIES[id], inScope), id).toBeNull();
    }
  });

  it('keeps the two resurrections on the friendly-targeted path the redirect covers', () => {
    // Pinned against the real ability table: a combat res authored as anything
    // other than a friendly targeted cast would silently leave this redirect.
    for (const id of ['temporal_reversal', 'recall_the_fallen'] as const) {
      const ability = ABILITIES[id];
      expect(ability.targetsDead).toBe(true);
      expect(ability.requiresTarget).toBe(true);
      expect(ability.targetType).toBe('friendly');
      expect(
        mouseoverCastTarget(7, {
          enabled: true,
          ability,
          exists: () => false,
          partyMemberPids: () => [1, 7],
        }),
      ).toBe(7);
    }
  });
});

describe('mouseoverCastTargetPid', () => {
  it('keeps the existing focus-target controller wrapper behavior', () => {
    expect(
      mouseoverCastTargetPid(7, HEAL, {
        enabled: true,
        hasEntity: alive,
        partyMemberPids: () => null,
      }),
    ).toBe(7);
  });
});
