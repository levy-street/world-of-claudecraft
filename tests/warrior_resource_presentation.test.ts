import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { Renderer } from '../src/render/renderer';
import type { Entity, SimEvent } from '../src/sim/types';

function fixture() {
  const sequenceInstant = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceInstant,
    slashArc: vi.fn(),
    burstAt: vi.fn(),
    bodyGlow: vi.fn(),
  };
  const triggerAttack = vi.fn();
  const triggerHit = vi.fn();
  const meleeSpark = vi.fn();
  const player = { id: 3, kind: 'player', castingAbility: null } as Entity;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      localPlayerId: () => 3,
      isMob: () => false,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  const renderer = {
    sim: { entities: new Map([[3, player]]) },
    views: new Map(),
    triggerAttack,
    triggerHit,
    vfx: { meleeSpark, drainLifeTick: vi.fn() },
    abilityVfx: painter,
  } as unknown as Renderer;
  return { painter, renderer, sequenceInstant, triggerAttack, triggerHit, meleeSpark };
}

describe('Warrior resource cost presentation', () => {
  it('does not replay Blood Toll or flinch the warrior for its recorded self cost', () => {
    const f = fixture();
    // The canonical self-cost event deliberately has no abilityId. Its cast
    // ceremony has already been emitted; health and floating text still own it.
    const event: SimEvent = {
      type: 'damage',
      sourceId: 3,
      targetId: 3,
      amount: 80,
      crit: false,
      school: 'physical',
      ability: 'Blood Toll',
      kind: 'hit',
    };
    Renderer.prototype.handleEvent.call(f.renderer, event);
    expect(f.triggerAttack).not.toHaveBeenCalled();
    expect(f.triggerHit).not.toHaveBeenCalled();
    expect(f.meleeSpark).not.toHaveBeenCalled();
    expect(f.sequenceInstant).not.toHaveBeenCalled();
    expect(event.amount).toBe(80);
  });

  it('retains ordinary enemy contact after suppressing the self cost', () => {
    const f = fixture();
    Renderer.prototype.handleEvent.call(f.renderer, {
      type: 'damage',
      sourceId: 7,
      targetId: 3,
      amount: 80,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      kind: 'hit',
    });
    expect(f.triggerAttack).toHaveBeenCalledWith(7, undefined);
    expect(f.triggerHit).toHaveBeenCalledWith(3);
    expect(f.meleeSpark).toHaveBeenCalledWith(3, false);
  });
});
