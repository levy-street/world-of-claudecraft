import { expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { ABILITIES } from '../src/sim/data';

// The 8 abilities WARRIOR_BLADE_STYLES authors a bespoke blade contact for,
// plus the two non-blade authored strikes (shield_slam, breachmaker). Pinned
// as literals rather than Object.keys(WARRIOR_BLADE_STYLES): deriving the
// case list from the same live table the assertions exercise would let a
// removed or renamed entry silently drop its own coverage instead of failing
// the suite.
const AUTHORED_WARRIOR_CONTACT_IDS = [
  'heroic_strike',
  'hamstring',
  'slam',
  'overpower',
  'mortal_strike',
  'execute',
  'bloodthirst',
  'victory_rush',
  'shield_slam',
  'breachmaker',
] as const;

function fixture(disposed = false, sourceAlive = true, localPlayerId = 1) {
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
  const burst = vi.fn();
  const screenFlash = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: host,
      vfx: { burst },
      anchor: () => ({ x: 4, y: 1, z: 0 }),
      localPlayerId: () => localPlayerId,
      isLivingWarrior: (id: number) => sourceAlive && id === 1,
      isWarrior: (id: number) => id === 1,
      animHold: hold,
      screenFlash,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { painter, host, sequencer, hold, screenFx, burst, screenFlash };
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

it('keeps Warrior bleeding after caster death, with other sources fallback', () => {
  // This path reads deps.isWarrior (class-based: a dead Warrior is still a
  // Warrior), never deps.isLivingWarrior (alive-based). Wiring sourceAlive
  // to false here and still landing the bleed is the proof that the bleed
  // tick does not consult it; there is no "alive" arm of this behavior left
  // to parametrize (isWarrior alone decides it, and it never varies).
  const h = fixture(false, false);
  const tick = { sourceId: 1, targetId: 2, fx: 'tick', school: 'physical' };
  expect(h.painter.handleSpellfx(tick)).toBe(true);
  expect(h.host.burstAt).toHaveBeenCalledWith(4, 1, 0, 0xa9152d, 9, 0.65, 'blood', 0.23);
  expect(h.painter.handleSpellfx({ ...tick, sourceId: 3 })).toBe(false);
  expect(h.painter.handleSpellfx({ ...tick, school: 'fire' })).toBe(false);
  expect(h.host.burstAt).toHaveBeenCalledTimes(1);
});

it.each(AUTHORED_WARRIOR_CONTACT_IDS)(
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

it('still lands one authored contact for a remote caster, without any local-only feedback', () => {
  // localPlayerId 9 watches caster 1's swing land on someone else: painter.ts
  // computes `local` as `localPlayerId() === sourceId`, so it is false here.
  // The crit hitstop/screen-flash/shake closure only ever gets attached when
  // `local` is true, but the authored blade contact itself does not gate on
  // locality and still fires exactly once.
  const h = fixture(false, true, 9);
  expect(h.painter.onDamage({ ...damage('heroic_strike'), crit: true })).toBe(true);
  h.sequencer.update(h.host, 0.151);
  expect(h.host.contact).toHaveBeenCalledTimes(1);
  expect(h.hold).not.toHaveBeenCalled();
  expect(h.screenFlash).not.toHaveBeenCalled();
});

it('keeps the renderer fallback when the Reaver sequence cannot start', () => {
  // renderer.ts gates its OWN generic melee fallback (damageContact +
  // triggerHit + meleeSpark) on `this.abilityVfx.onDamage(ev) === true`.
  // A disposed host cannot start the sequence and this non-crit hit has no
  // immediate feedback closure to fall back on either, so onDamage returns
  // exactly undefined, not merely "not true": that is what actually sends
  // the hit down the renderer's fallback path.
  const h = fixture(true);
  expect(h.painter.onDamage(damage('heroic_strike'))).toBeUndefined();
  h.sequencer.update(h.host, 1);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.screenFx).not.toHaveBeenCalled();
});

it('falls back to the generic burst when the authored sequence is refused at the most degraded tier', () => {
  // Tier 2 is the per-caster window cap (AbilityVfxBudget's CASTER_RING):
  // saturate it directly on the painter's own budget rather than replaying
  // 12 distinct abilities through onDamage, and watch from a REMOTE viewer,
  // because biasFor only ever softens the LOCAL player's own tier by one
  // (localCasterTier), so a genuine tier 2 only ever reaches a remote
  // caster's hits. At tier 2, the authored branch requires tier < 2 and is
  // skipped: the sequence never starts, but the generic
  // `!full.physical || tier >= 2` burst still runs in its place.
  const h = fixture(false, true, 9);
  // Reach into the painter's private cast budget directly (the sanctioned
  // "(sim as any).internal(...)" pattern this suite already uses elsewhere,
  // tests/CLAUDE.md) to saturate it without replaying 12 distinct abilities.
  const budget = (
    h.painter as unknown as { budget: { admit(casterId: number, nowSec: number): 0 | 1 | 2 } }
  ).budget;
  for (let i = 0; i < 12; i++) budget.admit(1, 0);
  expect(h.painter.onDamage(damage('heroic_strike'))).toBeUndefined();
  expect(h.burst).toHaveBeenCalledTimes(1);
  h.sequencer.update(h.host, 1);
  expect(h.host.contact).not.toHaveBeenCalled();
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
