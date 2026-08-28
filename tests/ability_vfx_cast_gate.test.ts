// The painter's cast gate (src/render/ability_vfx/painter.ts, castVfxAdmit):
// while a cast program is still unlinked the painter claims the event and
// draws nothing, so a first cast never links a program cold on a live frame.
// The one exception is the terrain-draped area ring: an actionable telegraph
// (the blast area the player steps out of) whose pool is not a cast program,
// so it draws even while the gate is closed.

import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';

/** An engine that records every method the painter reaches for. */
function recordingFx(): { fx: AbilityVfxFx; touched: Set<string> } {
  const touched = new Set<string>();
  const fx = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      touched.add(String(key));
      return vi.fn(() => 0);
    },
  }) as unknown as AbilityVfxFx;
  return { fx, touched };
}

function painterWith(admit: () => boolean, ready: () => boolean = admit) {
  const { fx, touched } = recordingFx();
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
  const painter = new AbilityVfx(
    {
      fx,
      vfx,
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
      castVfxAdmit: admit,
      castVfxReady: ready,
    },
    () => 0,
  );
  // The constructor's delegate wiring is the one touch a closed gate allows.
  touched.clear();
  return { painter, touched, vfx, spawnAoeRing };
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

  it('still draws the area ring while closed: the telegraph is not a cast program', () => {
    const { painter, touched, vfx, spawnAoeRing } = painterWith(() => false);
    const aimed = { x: 3, z: -4, school: 'frost', fx: 'nova', ability: 'frost_nova' };
    // No radius, no ring: nothing to telegraph.
    expect(painter.handleSpellfxAt(aimed)).toBe(true);
    expect(spawnAoeRing).not.toHaveBeenCalled();
    // A radius-carrying landing flashes the blast area at once, and only that.
    expect(painter.handleSpellfxAt({ ...aimed, radius: 8 })).toBe(true);
    expect(spawnAoeRing).toHaveBeenCalledTimes(1);
    expect(spawnAoeRing).toHaveBeenCalledWith(3, -4, 8, 'frost');
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
    // The per-frame consult is the uncounted read: a counted refusal is a cast.
    const admit = vi.fn(() => false);
    const { painter, touched } = painterWith(admit, () => false);
    painter.syncEntity({
      id: 7,
      castingAbility: 'frostbolt',
      castRemaining: 1,
      castTotal: 2,
      auras: [{ id: 'frost_armor' }],
    });
    // The aura and cast reads are what would spawn; a closed gate reaches
    // none of the engine's spawn methods.
    for (const key of touched) expect(key).not.toMatch(/spawn|flash|hold|windup|orbit/i);
    expect(admit).not.toHaveBeenCalled();
  });
});
