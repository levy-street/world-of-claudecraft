import { expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
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
// Literal expected contact heights (src/render/melee_impact_core.ts
// MELEE_IMPACTS[id].height), one per authored id. meleeContactHeight(profile,
// 0) always resolves to profile.height unchanged (beat 0 zeroes out both the
// 'reap' and 'cross' style offsets), so these are the exact receiving-sprite
// heights this suite expects; comparing the recorded call against a second
// call to meleeContactHeight built from the SAME profile it is meant to
// check would only ever equal itself.
const EXPECTED_CONTACT_HEIGHT: Record<(typeof abilities)[number], number> = {
  slam: 0.56,
  overpower: 0.57,
  shield_slam: 0.55,
  mortal_strike: 0.63,
  execute: 0.7,
  bloodthirst: 0.56,
  victory_rush: 0.61,
  breachmaker: 0.57,
};
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
      outcome === 'hit' ? 1 : 0,
    );
    // Hits sit on the receiving surface toward the attacker, not the body
    // centre. This fixture faces +X and has a two-unit-tall receiving body.
    // Bloodletting's authored bite replaced its generic hit flipbook.
    const hit = outcome === 'hit';
    const bite = hit && id === 'bloodthirst';
    const surfaceOffset = hit ? (bite ? 0.4 : id === 'shield_slam' || secondary ? 0.28 : 0.24) : 0;
    const sprites = bite
      ? vi
          .mocked(host.bakedAt!)
          .mock.calls.filter((call) => call[0] === 'harvest_impact')
          .map((call) => call.slice(1))
      : vi.mocked(host.flipbookAt).mock.calls;
    const receivingSprites = sprites.filter((call) => call[0] === 4 - surfaceOffset);
    expect(receivingSprites).toHaveLength(collision ? 1 : 0);
    if (secondary) {
      // Only the first target owns the caster performance and camera accent.
      expect(vi.mocked(host.contact!).mock.calls.filter((call) => call[1] === 3)).toHaveLength(1);
      expect(host.shakeAt).toHaveBeenCalledTimes(1);
    }
    for (const call of receivingSprites) {
      expect(call[1]).toBe(EXPECTED_CONTACT_HEIGHT[id] * 2);
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
