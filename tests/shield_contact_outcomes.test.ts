import { expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { ABILITIES } from '../src/sim/data';

it.each(['hit', 'absorbed', 'miss', 'dodge', 'parry'] as const)(
  'routes a real Shieldcrack %s result without inventing a body wound',
  (outcome) => {
    const host = new Proxy(
      {
        anchorOf: (id: number, fraction: number, out = { x: 0, y: 0, z: 0 }) =>
          Object.assign(out, { x: id === 1 ? 0 : 2, y: fraction * 2, z: 0 }),
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
      ) =>
        sequencer.start(
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
        ),
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
    painter.onDamage({
      abilityId: 'shield_slam',
      ability: ABILITIES.shield_slam.name,
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
    expect(sequence).toHaveBeenCalledTimes(collision ? 1 : 0);
    expect(host.crestAt).toHaveBeenCalledTimes(collision ? 1 : 0);
    expect(host.contact).toHaveBeenCalledTimes(outcome === 'hit' ? 1 : 0);
    expect(host.flipbookAt).toHaveBeenCalledTimes(collision ? 1 : 0);
    if (outcome !== 'hit') {
      expect(host.burstAt).not.toHaveBeenCalled();
      expect(host.fragmentsAt).not.toHaveBeenCalled();
    }
    if (outcome === 'absorbed') expect(sequence.mock.calls[0][7]).toBe(2);
  },
);
