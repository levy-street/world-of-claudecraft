import { expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { WARRIOR_BLADE_STYLES } from '../src/render/ability_vfx/warrior_blades';
import { ABILITIES } from '../src/sim/data';

function fixture(disposed = false, sourceAlive = true) {
  const sequencer = new ArchetypeSequencer();
  const screenFx = vi.fn();
  const host = new Proxy(
    {
      disposed,
      sequencer,
      scheduleScreenFx: screenFx,
      anchorOf: (id: number, height: number, out = { x: 0, y: 0, z: 0 }) =>
        Object.assign(out, { x: id * 2, y: height * 2, z: 0 }),
      groundYAt: () => 0,
    } as unknown as SequencerHost & AbilityVfxFx,
    {
      get(target, key) {
        if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
        return Reflect.get(target, key);
      },
    },
  );
  host.sequenceInstant = AbilityVfxFx.prototype.sequenceInstant.bind(host);
  const hold = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: host,
      vfx: { burst: vi.fn() },
      anchor: () => ({ x: 4, y: 1, z: 0 }),
      localPlayerId: () => 1,
      isLivingWarrior: (id: number) => sourceAlive && id === 1,
      isWarrior: (id: number) => id === 1,
      animHold: hold,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { painter, host, sequencer, hold, screenFx };
}

function damage(id: string) {
  return {
    abilityId: id,
    ability: ABILITIES[id].name,
    sourceId: 1,
    targetId: 2,
    school: 'physical' as const,
    kind: 'hit' as const,
    amount: 80,
    crit: false,
  };
}

it('gives Gaping Wounds its recipient incision without another physical strike', () => {
  const h = fixture();
  expect(h.painter.onDamage({ ...damage('deep_wounds'), abilityId: null })).toBe(true);
  expect(h.host.contact).toHaveBeenCalledWith(1, 2, 'physical-blood', 0.8, 'deep_wounds', 0);
  expect(h.hold).not.toHaveBeenCalled();
  expect(h.host.burstAt).not.toHaveBeenCalled();
  h.sequencer.update(h.host, 0.2);
  expect(h.host.contact).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  'keeps Warrior bleeding after caster death (alive=%s), with other sources fallback',
  (alive) => {
    const h = fixture(false, alive);
    const tick = { sourceId: 1, targetId: 2, fx: 'tick', school: 'physical' };
    expect(h.painter.handleSpellfx(tick)).toBe(true);
    expect(h.host.burstAt).toHaveBeenCalledWith(4, 1, 0, 0xa9152d, 9, 0.65, 'blood', 0.23);
    expect(h.painter.handleSpellfx({ ...tick, sourceId: 3 })).toBe(false);
    expect(h.painter.handleSpellfx({ ...tick, school: 'fire' })).toBe(false);
    expect(h.host.burstAt).toHaveBeenCalledTimes(1);
  },
);

it.each([...Object.keys(WARRIOR_BLADE_STYLES), 'shield_slam', 'breachmaker'])(
  '%s suppresses the immediate generic hit and lands one authored contact',
  (id) => {
    const h = fixture();
    expect(h.painter.onDamage(damage(id))).toBe(true);
    expect(h.hold).not.toHaveBeenCalled();
    expect(h.host.contact).not.toHaveBeenCalled();
    h.sequencer.update(h.host, 0.149);
    expect(h.host.contact).not.toHaveBeenCalled();
    h.sequencer.update(h.host, 0.002);
    expect(h.host.contact).toHaveBeenCalledTimes(1);
    h.sequencer.update(h.host, 1);
    expect(h.host.contact).toHaveBeenCalledTimes(1);
  },
);

it('keeps the renderer fallback when the Reaver sequence cannot start', () => {
  const h = fixture(true);
  expect(h.painter.onDamage(damage('heroic_strike'))).not.toBe(true);
  h.sequencer.update(h.host, 1);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.screenFx).not.toHaveBeenCalled();
});

it('retains critical-hit feedback at the authored contact time', () => {
  const h = fixture();
  expect(h.painter.onDamage({ ...damage('heroic_strike'), crit: true })).toBe(true);
  expect(h.hold).not.toHaveBeenCalled();
  h.sequencer.update(h.host, 0.149);
  expect(h.hold).not.toHaveBeenCalled();
  h.sequencer.update(h.host, 0.002);
  expect(h.hold).toHaveBeenCalledWith(2, 0.1, 0.14);
  expect(h.host.shakeAt).toHaveBeenCalledWith(4, 1, 0, 0.12);
  h.sequencer.update(h.host, 1);
  expect(h.hold).toHaveBeenCalledTimes(1);
});

it('retains immediate critical-hit feedback when admission fails', () => {
  const h = fixture(true);
  expect(h.painter.onDamage({ ...damage('heroic_strike'), crit: true })).not.toBe(true);
  expect(h.hold).toHaveBeenCalledWith(2, 0.1, 0.14);
});

it.each(['cancel', 'clear'] as const)(
  '%s cannot leak a critical beat into the next strike',
  (mode) => {
    const h = fixture();
    h.painter.onDamage({ ...damage('heroic_strike'), crit: true });
    if (mode === 'cancel') h.sequencer.cancelOwned(1, 'heroic_strike');
    else h.sequencer.clear();
    expect(h.painter.onDamage(damage('heroic_strike'))).toBe(true);
    h.sequencer.update(h.host, 0.16);
    expect(h.host.contact).toHaveBeenCalledTimes(1);
    expect(h.hold).not.toHaveBeenCalled();
  },
);
