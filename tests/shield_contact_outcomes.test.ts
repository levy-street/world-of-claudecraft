import { expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { meleeContactHeight, meleeImpactProfile } from '../src/render/melee_impact_core';
import { ABILITIES } from '../src/sim/data';

const abilities = [
  'slam',
  'overpower',
  'shield_slam',
  'mortal_strike',
  'execute',
  'bloodthirst',
  'victory_rush',
  'breachmaker',
] as const;
const outcomes = ['hit', 'absorbed', 'miss', 'dodge', 'parry'] as const;
it.each(
  abilities.flatMap((id) =>
    outcomes.flatMap((outcome) => [false, true].map((secondary) => ({ id, outcome, secondary }))),
  ),
)(
  'routes $id $outcome secondary=$secondary without inventing a body wound',
  ({ id, outcome, secondary }) => {
    const host = new Proxy(
      {
        anchorOf: (id: number, fraction: number, out = { x: 0, y: 0, z: 0 }) =>
          Object.assign(out, { x: id === 1 ? 0 : id * 2, y: fraction * 2, z: 0 }),
        groundYAt: () => 0,
      } as unknown as SequencerHost,
      {
        get(target, key) {
          if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
          return Reflect.get(target, key);
        },
      },
    );
    const sequencer = new ArchetypeSequencer();
    const sequence = vi.fn(
      (
        id: string,
        spec: AbilityVfxFullSpec,
        source: number,
        target: number,
        color: number,
        tier: number,
        delay = 0,
        result?: 0 | 1 | 2,
        contactFeedback?: () => void,
      ) => {
        const slot = sequencer.start(
          host,
          id,
          spec,
          source,
          target,
          color,
          tier,
          false,
          delay,
          undefined,
          result,
        );
        if (!slot) return false;
        slot.contactFeedback = contactFeedback;
        return true;
      },
    );
    const painter = new AbilityVfx(
      {
        fx: { setDelegates: vi.fn(), sequenceInstant: sequence },
        vfx: {},
        anchor: () => ({ x: 2, y: 1, z: 0 }),
        localPlayerId: () => 1,
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    if (secondary)
      painter.onDamage({
        abilityId: id,
        ability: ABILITIES[id].name,
        sourceId: 1,
        targetId: 3,
        school: 'physical',
        crit: false,
        amount: 150,
        kind: 'hit',
      });
    painter.onDamage({
      abilityId: id,
      ability: ABILITIES[id].name,
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      crit: false,
      amount: outcome === 'hit' ? 150 : 0,
      absorbed: outcome === 'absorbed' ? 150 : 0,
      kind: outcome === 'absorbed' ? 'hit' : outcome,
    });
    for (let i = 0; i < 40; i++) sequencer.update(host, 0.025);
    const collision = outcome === 'hit' || outcome === 'absorbed';
    expect(sequence).toHaveBeenCalledTimes((collision ? 1 : 0) + (secondary ? 1 : 0));
    const recipientCalls = (fn: unknown) =>
      vi.mocked(fn as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0] === 4);
    expect(host.crestAt).toHaveBeenCalledTimes(
      secondary || outcome === 'hit' || (outcome === 'absorbed' && id === 'shield_slam') ? 1 : 0,
    );
    expect(vi.mocked(host.contact!).mock.calls.filter((call) => call[1] === 2)).toHaveLength(
      !secondary && outcome === 'hit' ? 1 : 0,
    );
    // Hits sit on the receiving surface toward the attacker, not the body
    // centre. This fixture faces +X and has a two-unit-tall receiving body.
    // Bloodletting's authored bite replaced its generic hit flipbook.
    const primaryHit = !secondary && outcome === 'hit';
    const bite = primaryHit && id === 'bloodthirst';
    const surfaceOffset = primaryHit ? (bite ? 0.4 : id === 'shield_slam' ? 0.28 : 0.24) : 0;
    const sprites = bite
      ? vi
          .mocked(host.bakedAt!)
          .mock.calls.filter((call) => call[0] === 'warrior_bite')
          .map((call) => call.slice(1))
      : vi.mocked(host.flipbookAt).mock.calls;
    const receivingSprites = sprites.filter((call) => call[0] === 4 - surfaceOffset);
    expect(receivingSprites).toHaveLength((secondary ? outcome === 'absorbed' : collision) ? 1 : 0);
    const profile = meleeImpactProfile(id);
    if (!profile) throw new Error(`Missing tested contact profile: ${id}`);
    for (const call of receivingSprites) {
      expect(call[1]).toBe(meleeContactHeight(profile, 0) * 2);
      // sin(pi/2) gives the exact X offset; cos(pi/2) leaves only roundoff in Z.
      expect(call[2]).toBeCloseTo(0, 12);
    }
    if (outcome !== 'hit') {
      expect(recipientCalls(host.burstAt)).toHaveLength(0);
      expect(vi.mocked(host.fragmentsAt!).mock.calls.filter((call) => call[1] === 4)).toHaveLength(
        0,
      );
    }
    if (outcome === 'absorbed') expect(sequence.mock.calls.at(-1)![7]).toBe(2);
  },
);
