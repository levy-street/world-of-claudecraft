// Brutok's Skull Smash ground-slam VFX (src/render/brutok_vfx_specs.ts).
//
// The sim stamps the ability id onto the pulse's own nova spellfx, so the
// ability-VFX painter stages the slam read; the windup cue (same id) is
// claimed by the painter's windup arm, whose whole job is triggerAttack, so
// the authored Slam clip keeps playing. Two integrity pins matter beyond the
// routing:
//  - the spec's nova radius must EQUAL the live template's aoePulse radius,
//    because the shock ring is the danger-zone telegraph and a ring that lies
//    about the yards would train players wrong;
//  - the spec must carry NO cc read (no star band): the slam hits hard but
//    does not stun, and a stun read on a non-stun is the same lie.
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  BRUTOK_SKULL_SMASH_VFX_FULL_SPEC,
  BRUTOK_SKULL_SMASH_VFX_SPEC,
} from '../src/render/brutok_vfx_specs';
import { MOBS } from '../src/sim/data';

const SLAM = 'brutok_skull_smash';

function harness() {
  const sequenceInstant = vi.fn();
  const triggerAttack = vi.fn();
  const nova = vi.fn();
  const spawnAoeRing = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt: vi.fn(),
    sequenceInstant,
    beamRibbon: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
  } as unknown as AbilityVfxFx;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: vi.fn(),
        lightningProjectile: vi.fn(),
        burst: vi.fn(),
        nova,
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack,
      isMob: () => true,
      castingAbilityOf: () => null,
      isMidOneShot: () => false,
      localPlayerId: () => 99,
    },
    () => 0,
  );
  return { painter, sequenceInstant, triggerAttack, nova, spawnAoeRing };
}

describe('Brutok Skull Smash slam VFX', () => {
  it('resolves through the bespoke registry seam', () => {
    expect(abilityVfxSpec(SLAM)).toBe(BRUTOK_SKULL_SMASH_VFX_SPEC);
    expect(abilityVfxFullSpec(SLAM)).toBe(BRUTOK_SKULL_SMASH_VFX_FULL_SPEC);
    expect(BRUTOK_SKULL_SMASH_VFX_FULL_SPEC).toMatchObject({
      archetype: 'nova',
      palette: 'physical',
      windup: 1.08,
      windupStyle: 'stance',
      motifs: ['fissure'],
      decal: 'crack',
      impact: { ring: 1.8, vRing: true, debris: true, smoke: true },
    });
  });

  it('sizes the shock ring to the mechanic it telegraphs, and reads no stun', () => {
    const pulse = MOBS.brutok_skullsmasher.aoePulse;
    if (!pulse) throw new Error('brutok should author an aoePulse');
    expect(pulse.ability, 'the sim stamps this id onto the pulse nova').toBe(SLAM);
    expect(BRUTOK_SKULL_SMASH_VFX_FULL_SPEC.nova?.radius).toBe(pulse.radius);
    // the slam does not stun (no stun/concuss field on the pulse), so the read
    // must not wear a cc band claiming it does (widened to the full-spec type:
    // the literal's `satisfies` narrowing has no cc key at all, which is the
    // point)
    const full: AbilityVfxFullSpec = BRUTOK_SKULL_SMASH_VFX_FULL_SPEC;
    expect(full.cc).toBeUndefined();
  });

  it('claims the pulse nova as the slam GFX without re-triggering the rig', () => {
    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 7,
        targetId: 7,
        school: 'physical',
        fx: 'nova',
        ability: SLAM,
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledWith(
      SLAM,
      BRUTOK_SKULL_SMASH_VFX_FULL_SPEC,
      7,
      7,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    // the boom is staged 1.08s out, to the Slam clip's maul impact: the mob
    // arm must honor the authored windup UNCAPPED (the player caps would
    // clamp it to 0.5 and the crack would fire mid-heave again)
    const delay = h.sequenceInstant.mock.calls[0][6];
    expect(delay).toBeCloseTo(1.08, 5);
    // with a staged release the pooled nova rides the sequence, not the cue
    expect(h.nova).not.toHaveBeenCalled();
    expect(h.spawnAoeRing).toHaveBeenCalled();
    // playerGestureRelease early-returns for mob sources: the nova is GFX
    // only, or the clip would restart twice in one drain
    expect(h.triggerAttack).not.toHaveBeenCalled();
  });

  it('keeps the authored Slam clip alive through the windup arm', () => {
    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 7,
        targetId: 7,
        school: 'physical',
        fx: 'windup',
        ability: SLAM,
      }),
    ).toBe(true);
    // the painter claims the cue INSTEAD of the renderer's raw windup branch,
    // so the clip trigger must come from here or the slam animation regresses
    expect(h.triggerAttack).toHaveBeenCalledWith(7, SLAM);
  });
});
