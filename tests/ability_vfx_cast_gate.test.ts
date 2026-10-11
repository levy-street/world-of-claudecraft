// The painter's cast gate (src/render/ability_vfx/painter.ts, castVfxAdmit):
// while a program of a family the cast draws from is still unlinked the
// painter claims the event and draws nothing, so a first cast never links a
// program cold on a live frame.
// The exceptions are the reads a player ACTS on, which the gate must never
// hold: the terrain-draped area ring, point-anchored and entity-anchored alike
// (the blast area the player steps out of, whose pool is not a cast program),
// a mob's windup clip (a rig animation, no program at all), and the victim's
// hard-CC band, which is re-held right after the per-frame sleep the closed
// gate takes (only a frustum-culled rig, and a corpse, drop it).

import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import { ABILITIES } from '../src/sim/data';

/** An engine that records every method the painter reaches for, in order. */
function recordingFx(): {
  fx: AbilityVfxFx;
  touched: Set<string>;
  calls: { name: string; args: unknown[] }[];
} {
  const touched = new Set<string>();
  const calls: { name: string; args: unknown[] }[] = [];
  const stubs = new Map<string, (...args: unknown[]) => number>();
  const fx = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      const name = String(key);
      touched.add(name);
      let stub = stubs.get(name);
      if (!stub) {
        stub = vi.fn((...args: unknown[]) => {
          calls.push({ name, args });
          return 0;
        });
        stubs.set(name, stub);
      }
      return stub;
    },
  }) as unknown as AbilityVfxFx;
  return { fx, touched, calls };
}

function painterWith(admit: (mask: number) => boolean, ready: (mask: number) => boolean = admit) {
  const { fx, touched, calls } = recordingFx();
  const vfx = {
    projectile: vi.fn(),
    lightningProjectile: vi.fn(),
    burst: vi.fn(),
    nova: vi.fn(),
    tick: vi.fn(),
    shoutwave: vi.fn(),
    buffSwirl: vi.fn(),
    beam: vi.fn(),
  };
  const spawnAoeRing = vi.fn();
  const triggerAttack = vi.fn();
  const painter = new AbilityVfx(
    {
      fx,
      vfx,
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack,
      localPlayerId: () => 1,
      castVfxAdmit: admit,
      castVfxReady: ready,
    },
    () => 0,
  );
  // The constructor's delegate wiring is the one touch a closed gate allows.
  touched.clear();
  calls.length = 0;
  return { painter, touched, calls, vfx, spawnAoeRing, triggerAttack };
}

const frostbolt = {
  sourceId: 1,
  targetId: 2,
  school: 'frost',
  fx: 'heavyBolt',
  ability: 'frostbolt',
};

describe('the cast gate', () => {
  it('claims a spec-driven cast and draws nothing while a program is unlinked', () => {
    const { painter, touched, vfx } = painterWith(() => false);
    expect(painter.handleSpellfx(frostbolt)).toBe(true);
    expect(
      painter.handleSpellfxAt({ x: 0, z: 0, school: 'frost', fx: 'nova', ability: 'frost_nova' }),
    ).toBe(true);
    painter.onDamage({
      sourceId: 1,
      targetId: 2,
      school: 'frost',
      ability: 'frostbolt',
      kind: 'hit',
      crit: true,
      amount: 40,
    });
    expect(touched).toEqual(new Set());
    for (const spawn of Object.values(vfx)) expect(spawn).not.toHaveBeenCalled();
  });

  it('still draws the ENTITY-anchored area ring while closed', () => {
    // Same telegraph as the point-anchored one below, anchored on the caster
    // instead of a point: a self-centred AoE radius the player steps out of.
    // ability_vfx_core states the rule the gate was breaking, "NO tier drops
    // the ring, the area telegraph", so a held gate must not drop it either.
    const { painter, vfx, spawnAoeRing } = painterWith(() => false);
    const roar = {
      sourceId: 1,
      targetId: 1,
      school: 'shadow',
      fx: 'shout',
      ability: 'demoralizing_roar',
    };
    expect(painter.handleSpellfx(roar)).toBe(true);
    // Drawn as the ring and nothing else: no shoutwave, no sequence.
    expect(vfx.shoutwave).not.toHaveBeenCalled();
    expect(spawnAoeRing).toHaveBeenCalledTimes(1);
    // Anchored on the caster, at the spec's ring scale, in the plan's colour.
    expect(spawnAoeRing).toHaveBeenCalledWith(0, 0, 12, 'shadow', 0x7d6b9e);
  });

  it('still plays a windup clip while closed: an animation is not a program', () => {
    // The authored boss read (the dragonkin brood's Cleave/Stun rides
    // attackByAbility off this cue). The painter claims the event, so the
    // renderer's own windup arm never sees it: dropping it here drops it.
    const { painter, triggerAttack, vfx } = painterWith(() => false);
    const windup = {
      sourceId: 4,
      targetId: 2,
      school: 'frost',
      fx: 'windup',
      ability: 'frostbolt',
    };
    expect(painter.handleSpellfx(windup)).toBe(true);
    expect(triggerAttack).toHaveBeenCalledWith(4, 'frostbolt');
    expect(vfx.projectile).not.toHaveBeenCalled();
  });

  it('gives the refused point ring the same colour the admitted one gets', () => {
    // The same cast must not read one colour on a held gate and another on an
    // open one.
    const aimedAt = {
      x: 3,
      z: -4,
      radius: 8,
      school: 'frost',
      fx: 'nova',
      ability: 'frost_nova',
    };
    const closed = painterWith(() => false);
    expect(closed.painter.handleSpellfxAt(aimedAt)).toBe(true);
    const open = painterWith(() => true);
    expect(open.painter.handleSpellfxAt(aimedAt)).toBe(true);
    expect(closed.spawnAoeRing.mock.calls[0]).toEqual(open.spawnAoeRing.mock.calls[0]);
  });

  it('still draws the area ring while closed: the telegraph is not a cast program', () => {
    const { painter, touched, vfx, spawnAoeRing } = painterWith(() => false);
    const aimed = { x: 3, z: -4, school: 'frost', fx: 'nova', ability: 'frost_nova' };
    // No radius, no ring: nothing to telegraph.
    expect(painter.handleSpellfxAt(aimed)).toBe(true);
    expect(spawnAoeRing).not.toHaveBeenCalled();
    // A radius-carrying landing flashes the blast area at once, and only that.
    expect(painter.handleSpellfxAt({ ...aimed, radius: 8 })).toBe(true);
    expect(spawnAoeRing).toHaveBeenCalledTimes(1);
    expect(spawnAoeRing).toHaveBeenCalledWith(3, -4, 8, 'frost', 0x7fd4ff);
    expect(touched).toEqual(new Set());
    for (const spawn of Object.values(vfx)) expect(spawn).not.toHaveBeenCalled();
  });

  it('still declines what it never claimed, so the generic arm keeps its own rule', () => {
    const { painter } = painterWith(() => false);
    expect(painter.handleSpellfx({ ...frostbolt, ability: 'no_such_ability_for_the_gate' })).toBe(
      false,
    );
  });

  it('draws again the moment the gate admits', () => {
    let admitted = false;
    const { painter, touched } = painterWith(() => admitted);
    expect(painter.handleSpellfx(frostbolt)).toBe(true);
    expect(touched.size).toBe(0);
    admitted = true;
    expect(painter.handleSpellfx(frostbolt)).toBe(true);
    expect(touched.size).toBeGreaterThan(0);
  });

  it('keeps the per-entity held state in sync without drawing while closed', () => {
    // The per-frame consult is the uncounted read: a counted refusal is a
    // cast, so the cast bar counts once, on the frame the cast is first seen,
    // and never again however many frames it is held.
    // This entity wears no hard-CC aura, so the band exception below never
    // applies to it and the closed gate really does draw nothing.
    const admit = vi.fn((_mask: number) => false);
    const { painter, touched } = painterWith(admit, () => false);
    for (let frame = 0; frame < 3; frame++)
      painter.syncEntity({
        id: 7,
        castingAbility: 'frostbolt',
        castRemaining: 1 - frame * 0.1,
        castTotal: 2,
        auras: [{ id: 'frost_armor' }],
      });
    // The exact set, the way the closed-gate cases above assert it: a denylist
    // over `touched` is non-vacuous only because sleepEntity happens to land in
    // it, and would keep passing if the sleep itself disappeared. The sleep is
    // the whole per-frame contract here (it is what releases the held entity's
    // cosmetic pools), so it is named, and every other engine call is excluded
    // by the equality rather than by a pattern.
    expect(touched).toEqual(new Set(['sleepEntity']));
    expect(admit.mock.calls).toEqual([[CAST_VFX_ENGINE]]);
  });

  it('asks each cast for its own families: a Warrior cast waits on the kit, a Mage cast never does', () => {
    const asked: number[] = [];
    const { painter, touched } = painterWith((mask) => {
      asked.push(mask);
      return (mask & ~CAST_VFX_ENGINE) === 0;
    });
    expect(
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'physical',
        fx: 'selfCast',
        ability: 'shield_slam',
      }),
    ).toBe(true);
    expect(touched.size).toBe(0);
    expect(painter.handleSpellfx(frostbolt)).toBe(true);
    expect(touched.size).toBeGreaterThan(0);
    expect(asked).toEqual([CAST_VFX_ENGINE | CAST_VFX_KIT, CAST_VFX_ENGINE]);
  });
});

describe('the Warrior follow-through the renderer routes to the painter', () => {
  const kitClosed = (mask: number) => (mask & CAST_VFX_KIT) === 0;

  it('claims a control mark and draws nothing while the kit is not ready', () => {
    const { painter, touched } = painterWith(kitClosed);
    const sunder = {
      type: 'aura' as const,
      targetId: 2,
      sourceId: 1,
      name: 'Sunder Armor',
      gained: true,
      abilityId: 'sunder_armor',
      auraKind: 'sunder' as const,
    };
    expect(painter.onWarriorControlAura(sunder)).toBe(true);
    expect(touched).toEqual(new Set());
    // Any other aura is not the painter's, gate or not.
    expect(painter.onWarriorControlAura({ ...sunder, abilityId: 'frost_armor' })).toBe(false);
    // The same mark, kit ready, queues its authored peel.
    const open = painterWith(() => true);
    expect(open.painter.onWarriorControlAura(sunder)).toBe(true);
    expect(open.touched).toEqual(new Set(['queueWarriorControl']));
  });

  it('claims Bloodletting and suppresses the generic bloom while the kit is not ready', () => {
    const { painter, touched } = painterWith(kitClosed);
    const heal = {
      type: 'heal2' as const,
      sourceId: 1,
      targetId: 1,
      amount: 40,
      crit: false,
      ability: 'Bloodthirst',
      abilityId: 'bloodthirst',
    };
    expect(painter.warriorRecovery(heal, 400)).toBe(true);
    expect(touched).toEqual(new Set());
    // A heal that is no Warrior recovery reaches the engine's own answer.
    painter.warriorRecovery({ ...heal, abilityId: 'flash_heal', ability: 'Flash Heal' }, 400);
    expect(touched).toEqual(new Set(['warriorRecovery']));
    // The same recovery, kit ready, reaches the engine's bloom.
    const open = painterWith(() => true);
    open.painter.warriorRecovery(heal, 400);
    expect(open.calls.map((call) => call.name)).toEqual(['warriorRecovery']);
    expect(open.calls[0].args[0]).toBe(heal);
  });
});

describe('events that name their cast loosely', () => {
  const kitClosed = (mask: number) => (mask & CAST_VFX_KIT) === 0;

  it('asks a contact for the families of the ability its name draws, not only its own id', () => {
    // The draws below the gate resolve the id off the display name, so a
    // proc id beside a Warrior name must wait on the kit too.
    const { painter, touched } = painterWith(kitClosed);
    painter.onDamage({
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      ability: ABILITIES.shield_slam.name,
      abilityId: 'no_such_proc_for_the_gate',
      kind: 'hit',
      crit: false,
      amount: 40,
    });
    expect(touched).toEqual(new Set());
    // The same contact, kit ready, draws its authored strike.
    const open = painterWith(() => true);
    open.painter.onDamage({
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      ability: ABILITIES.shield_slam.name,
      abilityId: 'no_such_proc_for_the_gate',
      kind: 'hit',
      crit: false,
      amount: 40,
    });
    expect(open.calls.map((call) => call.name)).toEqual(['sequenceInstant']);
    expect(open.calls[0].args[0]).toBe('shield_slam');
  });

  it('decides a point landing that names no caster on its own, with no latch to share', () => {
    let open = false;
    const { painter, touched } = painterWith(() => open);
    const landing = { x: 0, z: 0, school: 'frost', fx: 'nova', ability: 'frost_nova' };
    expect(painter.handleSpellfxAt(landing)).toBe(true);
    expect(touched).toEqual(new Set());
    open = true;
    expect(painter.handleSpellfxAt(landing)).toBe(true);
    expect(touched.size).toBeGreaterThan(0);
  });
});

describe('the hard-CC band under a closed gate', () => {
  // The band is what says a victim is stunned, feared or rooted: actionable
  // information, which docs/design/graphics-settings-fairness.md keeps at every
  // tier. The closed gate sleeps the entity (that is how it releases the
  // cosmetic pools, and sleepEntity deletes the band), so the band has to be
  // re-held right after, on the entity that is still on screen.
  const stunned = (over: Partial<AbilityVfxEntityState> = {}): AbilityVfxEntityState => ({
    id: 7,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [{ id: 'war_stomp_stun', kind: 'stun', remaining: 2.5 }],
    ...over,
  });

  it('holds the worn band while closed, and reaches nothing else', () => {
    const { painter, touched, calls } = painterWith(() => false);
    painter.syncEntity(stunned());
    expect(touched).toEqual(new Set(['sleepEntity', 'holdCcBand']));
    expect(calls.map((c) => c.name)).toEqual(['sleepEntity', 'holdCcBand']);
    // The sleep is asked to KEEP the band (no entry re-minted per frame), and
    // the hold that follows refreshes it in place.
    expect(calls[0].args).toEqual([7, true]);
    expect(calls[1].args).toEqual([7, 'stun', 2.5]);
  });

  it('drops the band for a frustum-culled rig, gate open or closed', () => {
    // The pre-existing skip: a rig the renderer culled shows nothing at all,
    // so there is no read to keep, and the sleep is a full one.
    for (const gate of [false, true]) {
      const { painter, touched, calls } = painterWith(() => gate);
      painter.syncEntity(stunned(), false);
      expect(calls.map((c) => c.name)).toEqual(['sleepEntity']);
      expect(calls[0].args).toEqual([7, false]);
      expect(touched.has('holdCcBand')).toBe(false);
    }
  });

  it('drops the band for a dead body under a closed gate', () => {
    // A corpse must not wear a frozen band; deadness is the renderer's own
    // isVisuallyDead rule, exactly as on the drawing path.
    const { painter, touched } = painterWith(() => false);
    painter.syncEntity(stunned({ dead: true, hp: 0 }));
    expect(touched.has('holdCcBand')).toBe(false);
  });

  it('holds the same band once the gate opens', () => {
    const { painter, calls } = painterWith(() => true);
    painter.syncEntity(stunned());
    const held = calls.filter((c) => c.name === 'holdCcBand');
    expect(held).toHaveLength(1);
    expect(held[0].args).toEqual([7, 'stun', 2.5]);
  });
});
