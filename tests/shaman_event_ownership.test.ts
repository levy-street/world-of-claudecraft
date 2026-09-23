import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanCast, shamanDamage, shamanHeal } from '../src/render/ability_vfx/shaman_events';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { shamanVisualVariant } from '../src/render/shaman_vfx_specs';
import { ABILITIES } from '../src/sim/data';

function fixture() {
  const fx = {
    sequenceShamanRelease: vi.fn(),
    sequenceShamanContact: vi.fn(),
    sequenceInstant: vi.fn(),
    healStream: vi.fn(),
    shamanChainLink: vi.fn(),
    anchorOf: vi.fn(),
    burstAt: vi.fn(),
  };
  const host = {
    fx: fx as unknown as AbilityVfxFx,
    variant: (id: string) => id,
    tier: () => 0,
    gesture: vi.fn(),
  };
  return { host, fx };
}

describe('Shaman resolved event ownership', () => {
  it('preserves overload refusal rather than promoting remote impacts into a richer tier', () => {
    const { host, fx } = fixture();
    host.tier = () => 2;
    shamanDamage(host, {
      abilityId: 'lightning_bolt',
      ability: ABILITIES.lightning_bolt.name,
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      amount: 120,
      kind: 'hit',
      crit: false,
    });
    expect(fx.sequenceShamanContact.mock.calls[0][4]).toBe(2);
  });
  it('launches Arc Bolt without predicting damage; the real hit owns one impact', () => {
    const { host, fx } = fixture();
    expect(
      shamanCast(host, {
        ability: 'lightning_bolt',
        sourceId: 1,
        targetId: 2,
        school: 'nature',
        fx: 'lightning',
      }),
    ).toBe(true);
    expect(fx.sequenceShamanRelease).toHaveBeenCalledOnce();
    expect(fx.sequenceShamanContact).not.toHaveBeenCalled();
    expect(
      shamanDamage(host, {
        ability: ABILITIES.lightning_bolt.name,
        sourceId: 1,
        targetId: 2,
        school: 'nature',
        amount: 120,
        kind: 'hit',
        crit: false,
      }),
    ).toBe(true);
    expect(fx.sequenceShamanContact).toHaveBeenCalledOnce();
    expect(fx.sequenceShamanContact.mock.calls[0].slice(2)).toEqual([1, 2, 0, 1]);
  });
  it('retaliates with a real storm contact rather than placing protective charges on the attacker', () => {
    const { host, fx } = fixture();
    expect(
      shamanDamage(host, {
        abilityId: 'lightning_shield',
        ability: ABILITIES.lightning_shield.name,
        sourceId: 1,
        targetId: 2,
        school: 'nature',
        amount: 35,
        kind: 'hit',
        crit: false,
      }),
    ).toBe(true);
    expect(fx.sequenceShamanContact).toHaveBeenCalledExactlyOnceWith(
      'lightning_shield',
      expect.objectContaining({
        shaman: expect.objectContaining({ element: 'storm', action: 'jolt' }),
      }),
      1,
      2,
      0,
      1,
    );
    expect(fx.sequenceInstant).not.toHaveBeenCalled();
    expect(host.gesture).not.toHaveBeenCalled();
  });
  it('draws only real Skybranch hops without animating victims or replaying the caster', () => {
    const { host, fx } = fixture();
    const cue = {
      ability: 'chain_lightning',
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      fx: 'projectile',
    };
    shamanCast(host, cue);
    expect(host.gesture).toHaveBeenCalledExactlyOnceWith(1, 'chain_lightning');
    expect(fx.sequenceShamanRelease).toHaveBeenCalledTimes(1);
    for (let hop = 0; hop < 3; hop++)
      shamanCast(host, { ...cue, sourceId: hop + 1, targetId: hop + 2, level: hop });
    expect(fx.shamanChainLink.mock.calls).toEqual([
      [1, 2, true],
      [2, 3, false],
      [3, 4, false],
    ]);
    expect(host.gesture.mock.invocationCallOrder[0]).toBeLessThan(
      fx.sequenceShamanRelease.mock.invocationCallOrder[0],
    );
    expect(host.gesture).toHaveBeenCalledTimes(1);
    expect(fx.sequenceShamanRelease).toHaveBeenCalledTimes(1);
    expect(fx.sequenceShamanContact).not.toHaveBeenCalled();
  });
  it.each(['miss', 'resist', 'dodge', 'parry'])('never invents a body impact for %s', (kind) => {
    const { host, fx } = fixture();
    shamanDamage(host, {
      ability: 'earth_shock',
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      amount: 0,
      kind,
      crit: false,
    });
    expect(fx.sequenceShamanContact).not.toHaveBeenCalled();
  });
  it('retains absorption as a distinct confirmed outcome', () => {
    const { host, fx } = fixture();
    shamanDamage(host, {
      ability: 'earth_shock',
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      amount: 0,
      absorbed: 120,
      kind: 'hit',
      crit: false,
    });
    expect(fx.sequenceShamanContact.mock.calls[0].at(-1)).toBe(2);
  });
  it.each([
    { amount: 75, absorbed: 0, outcome: 1 },
    { amount: 0, absorbed: 75, outcome: 2 },
    { amount: 0, absorbed: 0, outcome: 0 },
  ])(
    'preserves a blocked strike outcome: $amount damage, $absorbed absorbed',
    ({ amount, absorbed, outcome }) => {
      const { host, fx } = fixture();
      expect(
        shamanDamage(host, {
          ability: ABILITIES.stormstrike.name,
          abilityId: 'stormstrike',
          sourceId: 1,
          targetId: 2,
          school: 'physical',
          kind: 'block',
          amount,
          absorbed,
          crit: false,
        }),
      ).toBe(true);
      if (outcome) {
        expect(fx.sequenceShamanContact).toHaveBeenCalledOnce();
        expect(fx.sequenceShamanContact.mock.calls[0].at(-1)).toBe(outcome);
      } else expect(fx.sequenceShamanContact).not.toHaveBeenCalled();
      expect(host.gesture).not.toHaveBeenCalled();
    },
  );
  it('uses real Chain Heal hops, one caster gesture, and exactly one landing per ally', () => {
    const { host, fx } = fixture();
    shamanCast(host, {
      ability: 'chain_heal',
      sourceId: 1,
      targetId: 2,
      school: 'nature',
      fx: 'selfCast',
    });
    for (const [sourceId, targetId] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ]) {
      shamanCast(host, {
        ability: 'chain_heal',
        sourceId,
        targetId,
        school: 'nature',
        fx: 'chainHeal',
        level: sourceId - 1,
      });
      shamanHeal(host, { ability: ABILITIES.chain_heal.name, sourceId: 1, targetId, amount: 80 });
    }
    expect(host.gesture).toHaveBeenCalledExactlyOnceWith(1, 'chain_heal');
    expect(fx.healStream.mock.calls).toEqual([
      [1, 2, true],
      [2, 3, false],
      [3, 4, false],
    ]);
    expect(fx.sequenceShamanContact.mock.calls.map((c) => c[3])).toEqual([2, 3, 4]);
    expect(fx.sequenceInstant).not.toHaveBeenCalled();
  });
  it('leaves other classes with their current owners', () => {
    const { host, fx } = fixture();
    expect(shamanHeal(host, { ability: 'renew', sourceId: 1, targetId: 2, amount: 20 })).toBe(
      false,
    );
    expect(
      shamanCast(host, {
        ability: 'fireball',
        sourceId: 1,
        targetId: 2,
        school: 'fire',
        fx: 'projectile',
      }),
    ).toBe(false);
    expect(fx.sequenceShamanContact).not.toHaveBeenCalled();
  });
  it('selects active enchant in simulation precedence, independent of aura array order', () => {
    const auras = [
      'lifespring_weapon',
      'rockbiter_weapon',
      'galeheart_weapon',
      'flametongue_weapon',
    ].map((id) => ({ id, remaining: 10 }));
    expect(shamanVisualVariant('unleash_weapon', auras)).toBe('unleash_weapon_fire');
    auras.pop();
    expect(shamanVisualVariant('unleash_weapon', auras)).toBe('unleash_weapon_wind');
    expect(
      shamanVisualVariant('unleash_weapon', [{ id: 'flametongue_weapon', remaining: 0 }, auras[0]]),
    ).toBe('unleash_weapon_water');
    expect(shamanVisualVariant('stormstrike', auras)).toBe('stormstrike');
    expect(shamanVisualVariant('fireball', auras)).toBe('fireball');
  });
});

function delayedContactFixture() {
  const sequencer = new ArchetypeSequencer();
  let targetVisible = true;
  let targetX = 12;
  const anchor = (id: number, _fraction: number, out = { x: 0, y: 0, z: 0 }) => {
    if (id === 2 && !targetVisible) return null;
    out.x = id === 2 ? targetX : -9;
    out.y = 1;
    out.z = 4;
    return out;
  };
  // Primitive calls are observed without constructing GPU resources. All anchor
  // reads remain real and mutable across the authored contact delay.
  const host = new Proxy({ anchorOf: anchor, groundYAt: () => 0 } as unknown as SequencerHost, {
    get(target, key) {
      if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
      return Reflect.get(target, key);
    },
  });
  const engine = new Proxy(
    { sequencer, anchor, disposed: false },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : Reflect.get(host, key)) },
  ) as unknown as AbilityVfxFx;
  const start = () => {
    const spec = abilityVfxFullSpec('stormstrike');
    if (!spec) throw new Error('Missing Ancestral Strike composition');
    return AbilityVfxFx.prototype.sequenceShamanContact.call(
      engine,
      'stormstrike',
      spec,
      1,
      2,
      0,
      1,
    );
  };
  return {
    sequencer,
    host,
    engine,
    start,
    visibility: (visible: boolean) => {
      targetVisible = visible;
    },
    move: (x: number) => {
      targetX = x;
    },
  };
}

describe('Shaman delayed recipient contact', () => {
  it('drops a confirmed strike when its recipient disappears during anticipation, without a caster blast or late replay', () => {
    const h = delayedContactFixture();
    expect(h.start()).toBe(true);
    h.sequencer.update(h.host, 0.1);
    expect(h.host.burstAt).not.toHaveBeenCalled();
    h.visibility(false);
    h.sequencer.update(h.host, 0.06);
    expect(h.host.burstAt).not.toHaveBeenCalled();
    expect(h.host.pathRibbon).not.toHaveBeenCalled();
    expect(h.host.contact).not.toHaveBeenCalled();
    expect(h.host.abilityAudio).not.toHaveBeenCalled();
    expect(h.host.pulseLight).not.toHaveBeenCalled();
    h.visibility(true);
    h.sequencer.update(h.host, 0.3);
    expect(h.host.burstAt).not.toHaveBeenCalled();
  });

  it('keeps the full confirmed contact on the moving recipient at the authored frame', () => {
    const h = delayedContactFixture();
    expect(h.start()).toBe(true);
    h.sequencer.update(h.host, 0.1);
    expect(h.host.contact).not.toHaveBeenCalled();
    h.move(38);
    h.sequencer.update(h.host, 0.06);
    expect(h.host.burstAt).toHaveBeenCalled();
    expect(vi.mocked(h.host.burstAt).mock.calls[0].slice(0, 3)).toEqual([38, 1, 4]);
    expect(h.host.contact).toHaveBeenCalledOnce();
    expect(h.host.abilityAudio).toHaveBeenCalledWith(
      'impact',
      expect.any(String),
      expect.any(Number),
      38,
      1,
      4,
      expect.any(Object),
    );
  });

  it('preserves legacy caster fallback for a non-Shaman targeted sequence', () => {
    const h = delayedContactFixture();
    const original = abilityVfxFullSpec('stormstrike');
    if (!original) throw new Error('Missing test composition');
    // Same targeted archetype and recipient-only flag, without Shaman ownership.
    const legacy = { ...original, shaman: undefined };
    h.sequencer.start(
      h.host,
      'legacy-strike',
      legacy,
      1,
      2,
      0xffffff,
      0,
      false,
      0,
      undefined,
      1,
      true,
    );
    if (!h.host.abilityAudio) throw new Error('Missing fixture audio callback');
    vi.mocked(h.host.abilityAudio).mockClear();
    h.visibility(false);
    h.sequencer.update(h.host, 0.16);
    expect(h.host.abilityAudio).toHaveBeenCalledWith(
      'impact',
      expect.any(String),
      expect.any(Number),
      -9,
      1,
      4,
      expect.any(Object),
    );
  });
});

describe('Stoneward protected recipient', () => {
  it.each([
    { target: 2, visible: true, x: 12, label: 'ally' },
    { target: 1, visible: true, x: -9, label: 'self' },
    { target: 2, visible: false, x: 12, label: 'missing ally' },
  ])('casts from the Shaman and lands only on the $label', ({ target, visible, x }) => {
    const draw = delayedContactFixture();
    draw.visibility(visible);
    const { host, fx } = fixture();
    fx.sequenceShamanRelease.mockImplementation(
      (...args: Parameters<AbilityVfxFx['sequenceShamanRelease']>) =>
        AbilityVfxFx.prototype.sequenceShamanRelease.apply(draw.engine, args),
    );
    fx.sequenceShamanContact.mockImplementation(
      (...args: Parameters<AbilityVfxFx['sequenceShamanContact']>) =>
        AbilityVfxFx.prototype.sequenceShamanContact.apply(draw.engine, args),
    );
    expect(
      shamanCast(host, {
        ability: 'stoneward',
        sourceId: 1,
        targetId: target,
        school: 'nature',
        fx: 'selfCast',
      }),
    ).toBe(true);
    expect(host.gesture).toHaveBeenCalledExactlyOnceWith(1, 'stoneward');
    expect(fx.sequenceShamanRelease).toHaveBeenCalledExactlyOnceWith(
      'stoneward',
      expect.objectContaining({ shaman: expect.objectContaining({ action: 'ward' }) }),
      1,
      target,
      0,
    );
    expect(fx.sequenceShamanContact).toHaveBeenCalledExactlyOnceWith(
      'stoneward',
      expect.objectContaining({ shaman: expect.objectContaining({ action: 'ward' }) }),
      1,
      target,
      0,
    );
    expect(fx.sequenceInstant).not.toHaveBeenCalled();
    expect(draw.host.abilityAudio).toHaveBeenCalledWith(
      'release',
      expect.any(String),
      expect.any(Number),
      -9,
      0.04,
      4,
      expect.any(Object),
    );
    const audio = draw.host.abilityAudio;
    if (!audio) throw new Error('Missing fixture audio callback');
    const impacts = vi.mocked(audio).mock.calls.filter((call) => call[0] === 'impact');
    if (visible) {
      expect(impacts).toHaveLength(1);
      expect(impacts[0].slice(3, 6)).toEqual([x, 1, 4]);
      expect(draw.host.pulseLight).toHaveBeenCalledWith(
        target,
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
      expect(draw.host.fragmentsAt).toHaveBeenCalledTimes(2);
      const fragments = draw.host.fragmentsAt;
      if (!fragments) throw new Error('Missing fixture fragment callback');
      for (const call of vi.mocked(fragments).mock.calls)
        expect(Math.abs(call[1] - x)).toBeLessThan(1);
    } else {
      expect(impacts).toHaveLength(0);
      expect(draw.host.fragmentsAt).not.toHaveBeenCalled();
      expect(draw.host.pulseLight).not.toHaveBeenCalled();
    }
    expect(draw.host.contact).not.toHaveBeenCalled();
    expect(draw.host.shakeAt).not.toHaveBeenCalled();
  });
});
