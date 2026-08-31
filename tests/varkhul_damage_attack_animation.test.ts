import { describe, expect, it, vi } from 'vitest';
import { shouldStartDamageAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { Renderer } from '../src/render/renderer';
import type { Entity, SimEvent } from '../src/sim/types';

describe('Varkhul concurrent cast and melee presentation', () => {
  it('keeps JumpSlam in control when a Warden melee hit lands during Quake', () => {
    const playAttack = vi.fn();
    const startsAttack = shouldStartDamageAttackAnimation({
      sourceKind: 'mob',
      attackAnimationStarted: undefined,
      castingAbility: 'crucible_quake',
      authoredCastOwnsBody: true,
    });
    if (startsAttack) playAttack('Attack');

    expect(startsAttack).toBe(false);
    expect(playAttack).not.toHaveBeenCalled();
  });

  it('wires the real physical-damage event through the authored-cast gate', () => {
    const warden = {
      id: 71,
      kind: 'mob',
      castingAbility: 'crucible_quake',
    } as Entity;
    const jumpSlamVisual = {
      hasAttackClipOverride: vi.fn((ability: string) => ability === 'crucible_quake'),
    };
    const triggerAttack = vi.fn();
    const triggerHit = vi.fn();
    const meleeSpark = vi.fn();
    const onDamage = vi.fn();
    const renderer = {
      sim: { entities: new Map([[warden.id, warden]]) },
      views: new Map([[warden.id, {}]]),
      activeVisual: vi.fn(() => jumpSlamVisual),
      triggerAttack,
      triggerHit,
      vfx: { meleeSpark, drainLifeTick: vi.fn() },
      abilityVfx: { onDamage },
    } as unknown as Renderer;
    const damage: SimEvent = {
      type: 'damage',
      sourceId: warden.id,
      targetId: 1,
      amount: 300,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      kind: 'hit',
    };

    Renderer.prototype.handleEvent.call(renderer, damage);

    expect(jumpSlamVisual.hasAttackClipOverride).toHaveBeenCalledWith('crucible_quake');
    expect(triggerAttack).not.toHaveBeenCalled();
    expect(triggerHit).toHaveBeenCalledWith(1);
    expect(meleeSpark).toHaveBeenCalledWith(1, false);
    expect(onDamage).toHaveBeenCalledWith(damage);

    warden.castingAbility = null;
    Renderer.prototype.handleEvent.call(renderer, damage);
    expect(triggerAttack).toHaveBeenCalledWith(warden.id, undefined);
  });

  it('still animates ordinary mob melee and non-authored casts', () => {
    expect(
      shouldStartDamageAttackAnimation({
        sourceKind: 'mob',
        attackAnimationStarted: undefined,
        castingAbility: null,
        authoredCastOwnsBody: false,
      }),
    ).toBe(true);
    expect(
      shouldStartDamageAttackAnimation({
        sourceKind: 'mob',
        attackAnimationStarted: undefined,
        castingAbility: 'generic_cast',
        authoredCastOwnsBody: false,
      }),
    ).toBe(true);
  });

  it('retains the typed player ranged-impact suppression', () => {
    expect(
      shouldStartDamageAttackAnimation({
        sourceKind: 'player',
        attackAnimationStarted: true,
        castingAbility: null,
        authoredCastOwnsBody: false,
      }),
    ).toBe(false);
  });
});
