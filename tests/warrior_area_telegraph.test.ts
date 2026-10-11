import { expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  AbilityVfx,
  type AbilityVfxDeps,
  type AbilityVfxSpellfxAtEvent,
} from '../src/render/ability_vfx/painter';

// The terrain-draped area ring is the blast area a player steps out of, so it
// is ACTIONABLE information: no spec flag, degrade tier, quality dial, cold
// pool or closed cast gate may drop it (src/render/ability_vfx_core.ts's own
// words, "NO tier drops the ring, the area telegraph", plus the
// refusedTelegraphs contract in painter.ts and
// docs/design/graphics-settings-fairness.md).
//
// Warrior abilities are the regression risk: every one of them carries a
// `physical` choreography and warrior_vfx_specs.ts hardcodes impact.ring
// false, so a spec-shaped gate on the ring silently removes it for the whole
// class while leaving every other class intact.

// The authored spec colours: warrior_vfx_specs.ts derives them from the
// choreography material (steel for Thunder Clap, blood for Whirlwind).
const STEEL = 0xc2d3da;
const BLOOD = 0xa93232;
// GLOBAL_RING in ability_vfx_core.ts (ABILITY_VFX_GLOBAL_CAP * 2): one cast
// past it and AbilityVfxBudget.admit hands out the most degraded tier.
const CASTS_TO_SATURATE_THE_BUDGET = 40;
const LOCAL_PLAYER_ID = -777; // never a caster below, so no local-player bias

function autoMock<T extends object>(seed: Partial<T> = {}): T {
  return new Proxy(seed as T, {
    get(target, key) {
      if (!(key in target)) (target as Record<PropertyKey, unknown>)[key] = vi.fn();
      return Reflect.get(target, key);
    },
  });
}

function harness(castGateOpen = true) {
  const spawnAoeRing = vi.fn();
  const fx = autoMock<AbilityVfxFx>({ groundYAt: () => 0 } as Partial<AbilityVfxFx>);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: autoMock<AbilityVfxDeps['vfx']>(),
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => LOCAL_PLAYER_ID,
      castVfxAdmit: () => castGateOpen,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { painter, fx, spawnAoeRing };
}

function pointCast(ability: string, radius: number, sourceId = 1): AbilityVfxSpellfxAtEvent {
  return { x: 12, z: -30, school: 'physical', fx: 'nova', ability, radius, sourceId };
}

const CASES: [string, number, number][] = [
  ['thunder_clap', 8, STEEL],
  ['whirlwind', 6.5, BLOOD],
];

it.each(CASES)('%s draws its area ring once at full fidelity', (ability, radius, color) => {
  const h = harness();

  expect(h.painter.handleSpellfxAt(pointCast(ability, radius))).toBe(true);

  expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(12, -30, radius, 'physical', color);
  // tier 0 also runs the authored point sequence, so the ring is an addition
  // to the read, never a substitute for it
  expect(h.fx.sequenceInstantAt).toHaveBeenCalledTimes(1);
});

it.each(CASES)('%s keeps its area ring at the most degraded tier', (ability, radius, color) => {
  const h = harness();
  h.painter.setQuality(0);
  // Saturate the shared cast window so the next cast plans at tier 2.
  for (let caster = 0; caster < CASTS_TO_SATURATE_THE_BUDGET; caster++) {
    h.painter.handleSpellfxAt({
      x: 0,
      z: 0,
      school: 'physical',
      fx: 'nova',
      ability,
      sourceId: 100 + caster,
    });
  }
  expect(h.spawnAoeRing).not.toHaveBeenCalled(); // no radius, no telegraph
  h.fx.sequenceInstantAt = vi.fn();

  expect(h.painter.handleSpellfxAt(pointCast(ability, radius, 999))).toBe(true);

  expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(12, -30, radius, 'physical', color);
  // proof the cast really planned at tier 2: the archetype sequence is shed
  // there and only the minimal fallback burst survives beside the ring
  expect(h.fx.sequenceInstantAt).not.toHaveBeenCalled();
});

it.each(CASES)('%s keeps its area ring with the cast gate closed', (ability, radius, color) => {
  const h = harness(false);

  expect(h.painter.handleSpellfxAt(pointCast(ability, radius))).toBe(true);

  expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(12, -30, radius, 'physical', color);
  // a refused cast owes the telegraph and nothing else: no cast program is
  // linked for it
  expect(h.fx.sequenceInstantAt).not.toHaveBeenCalled();
});

it('gives Heroic Leap its landing telegraph beside the authored fracture', () => {
  const h = harness();

  expect(h.painter.handleSpellfxAt(pointCast('heroic_leap', 6))).toBe(true);

  expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(12, -30, 6, 'physical', 0xb39c77);
  expect(h.fx.decalXZ).toHaveBeenCalled();
});

// The self-centred AoEs and shouts (the sim emits an entity-anchored nova or
// shout for them, not a point event) take their ring from the spec's ring
// scale: RING_RADIUS_PER_SCALE (4) times the generated gallery `rg`. The
// authored warrior kit must add to that read, never zero it out.
const SELF_CASES: [string, 'nova' | 'shout', number, number][] = [
  ['thunder_clap', 'nova', 5.2, STEEL],
  ['whirlwind', 'nova', 6.4, BLOOD],
  ['battle_shout', 'shout', 8, STEEL],
];

function selfCast(ability: string, fx: 'nova' | 'shout', sourceId = 1) {
  return { sourceId, targetId: sourceId, school: 'physical', fx, ability };
}

it.each(SELF_CASES)(
  '%s (self-anchored %s) draws its ring at full fidelity',
  (ability, fx, radius, color) => {
    const h = harness();

    expect(h.painter.handleSpellfx(selfCast(ability, fx))).toBe(true);

    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(0, 0, radius, 'physical', color);
  },
);

it.each(SELF_CASES)(
  '%s (self-anchored %s) keeps its ring with the cast gate closed',
  (ability, fx, radius, color) => {
    const h = harness(false);

    expect(h.painter.handleSpellfx(selfCast(ability, fx))).toBe(true);

    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(0, 0, radius, 'physical', color);
    expect(h.fx.sequenceInstant).not.toHaveBeenCalled();
  },
);

it('never draws the area ring for a point event that carries no radius', () => {
  const h = harness();

  expect(
    h.painter.handleSpellfxAt({
      x: 3,
      z: 4,
      school: 'physical',
      fx: 'nova',
      ability: 'thunder_clap',
      sourceId: 1,
    }),
  ).toBe(true);

  expect(h.spawnAoeRing).not.toHaveBeenCalled();
});
