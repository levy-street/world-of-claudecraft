// Clique-style mouseover casting (src/ui/mouseover_cast_core.ts): which unit a
// friendly ability pressed over a party/raid frame lands on.
//
// The regression this pins: a raid member who RELEASES waits as a ghost at the
// graveyard, far outside the online client's ~120 yd interest scope, so
// ClientWorld holds no entity for them. The old "entity must be in scope" gate
// dropped the redirect there and the combat resurrection fell through to the
// current target (the boss). Interest scope is a rendering budget, never a
// targeting rule: the party roster is what vouches for the hovered member.

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { mouseoverCastTargetPid } from '../src/ui/mouseover_cast_core';

const RES = ABILITIES.temporal_reversal;
const HEAL = ABILITIES.healing_wave;
const BOLT = ABILITIES.lightning_bolt;

// The two hosts the core has to serve identically: the offline Sim knows every
// entity in the world, ClientWorld only the ones inside the interest scope.
const simLikeEntities = (ids: number[]) => (pid: number) => ids.includes(pid);

describe('mouseoverCastTargetPid', () => {
  it('redirects a friendly cast to the hovered member the client can see', () => {
    expect(
      mouseoverCastTargetPid(7, HEAL, {
        enabled: true,
        hasEntity: simLikeEntities([1, 7]),
        partyMemberPids: () => [1, 7],
      }),
    ).toBe(7);
  });

  it('redirects a combat resurrection to a RELEASED member outside interest scope', () => {
    // The ClientWorld-shaped host: no entity for the ghost at the graveyard, but
    // the party wire still lists them.
    expect(
      mouseoverCastTargetPid(7, RES, {
        enabled: true,
        hasEntity: () => false,
        partyMemberPids: () => [1, 7],
      }),
    ).toBe(7);
    // Same inputs on the Sim-shaped host (entity present) resolve to the same pid.
    expect(
      mouseoverCastTargetPid(7, RES, {
        enabled: true,
        hasEntity: simLikeEntities([1, 7]),
        partyMemberPids: () => [1, 7],
      }),
    ).toBe(7);
  });

  it('refuses a hovered pid that is neither in scope nor on the roster', () => {
    // A stale hover (the member left the group between the mouseenter and the
    // keypress): fall back to the classic current-target-else-self path rather
    // than casting at an ex-member.
    expect(
      mouseoverCastTargetPid(7, HEAL, {
        enabled: true,
        hasEntity: () => false,
        partyMemberPids: () => [1, 2],
      }),
    ).toBeNull();
    expect(
      mouseoverCastTargetPid(7, HEAL, {
        enabled: true,
        hasEntity: () => false,
        partyMemberPids: () => null,
      }),
    ).toBeNull();
  });

  it('never redirects a hostile cast, an untargeted cast, or a disabled option', () => {
    const inScope = {
      enabled: true,
      hasEntity: simLikeEntities([7]),
      partyMemberPids: () => [1, 7],
    };
    expect(mouseoverCastTargetPid(7, BOLT, inScope)).toBeNull();
    expect(mouseoverCastTargetPid(7, ABILITIES.collective_reversal, inScope)).toBeNull();
    expect(mouseoverCastTargetPid(7, undefined, inScope)).toBeNull();
    expect(mouseoverCastTargetPid(null, HEAL, inScope)).toBeNull();
    expect(mouseoverCastTargetPid(7, HEAL, { ...inScope, enabled: false })).toBeNull();
  });

  it('reads the roster only when the entity is out of scope', () => {
    // The offline Sim rebuilds its whole party model on every partyInfo read
    // (aura + aggro sweeps over the world), and this runs on every ability press:
    // the in-scope answer must never pay for it.
    let rosterReads = 0;
    const roster = () => {
      rosterReads++;
      return [1, 7];
    };
    expect(
      mouseoverCastTargetPid(7, HEAL, {
        enabled: true,
        hasEntity: simLikeEntities([7]),
        partyMemberPids: roster,
      }),
    ).toBe(7);
    expect(rosterReads).toBe(0);
    // No hover at all: neither callback is consulted.
    expect(
      mouseoverCastTargetPid(null, HEAL, {
        enabled: true,
        hasEntity: () => {
          throw new Error('entity lookup on an unhovered press');
        },
        partyMemberPids: roster,
      }),
    ).toBeNull();
    expect(rosterReads).toBe(0);
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
        mouseoverCastTargetPid(7, ability, {
          enabled: true,
          hasEntity: () => false,
          partyMemberPids: () => [1, 7],
        }),
      ).toBe(7);
    }
  });
});
