// Player projectile/lightning/nova ability casts never called triggerAttack
// at release, only selfCast's ceremony arm consulted hasGestureClip (review
// #2961 on PR #2961, "three of the five bespoke clips never reach
// playAttack"): a player's lightning_bolt/shock/earthquake played its VFX
// but never played the rig's authored Cast_Bolt/Cast_Shock/Cast_Quake swing.
// Drives handleSpellfx/handleSpellfxAt with a real AbilityVfxDeps stub and
// asserts triggerAttack is called with the ability id, gated on
// hasGestureClip so an ability with no authored clip is unaffected.
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { AbilityVfx } from '../src/render/ability_vfx/painter';

const SOURCE_ID = 3;
const TARGET_ID = 9;

function makePainter(hasGestureClip: (id: number, ability: string) => boolean, isMob = false) {
  const fx = {
    setDelegates: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    windup: vi.fn().mockReturnValue(false),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn().mockReturnValue(true),
    orbit: vi.fn().mockReturnValue(true),
    bodyGlow: vi.fn(),
    sleepEntity: vi.fn(),
    update: vi.fn(),
    jaggedBolt: vi.fn(),
    sequenceInstant: vi.fn(),
    sequenceInstantAt: vi.fn(),
    sequenceBolt: vi.fn(),
    sequenceBoltAt: vi.fn(),
    beginBallisticSequence: vi.fn(),
    finishBallisticSequence: vi.fn(),
    groundYAt: vi.fn().mockReturnValue(0),
  };
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
  const triggerAttack = vi.fn();
  const deps = {
    vfx,
    fx,
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    spawnAoeRing: vi.fn(),
    triggerAttack,
    isMob: () => isMob,
    hasGestureClip,
    localPlayerId: () => -1,
  } as unknown as AbilityVfxDeps;
  const painter = new AbilityVfx(deps, () => 0);
  return { painter, triggerAttack, fx, vfx };
}

describe('player gesture release on cast fx (review #2961)', () => {
  it('plays the authored clip for a target-born impact whose ability has a gesture', () => {
    const { painter, triggerAttack } = makePainter((_id, ability) => ability === 'flame_shock');
    painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'fire',
      fx: 'impact',
      ability: 'flame_shock',
    });
    expect(triggerAttack).toHaveBeenCalledWith(SOURCE_ID, 'flame_shock');
  });

  it('plays the authored clip for a player lightning cast with a gesture (lightning_bolt)', () => {
    const { painter, triggerAttack } = makePainter((_id, ability) => ability === 'lightning_bolt');
    painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'nature',
      fx: 'lightning',
      ability: 'lightning_bolt',
    });
    expect(triggerAttack).toHaveBeenCalledWith(SOURCE_ID, 'lightning_bolt');
  });

  it('carries Arc Bolt authored lightning DNA into a straight ballistic launch', () => {
    const { painter, fx } = makePainter(() => false);
    const appearance = painter.handleBallisticLaunch({
      trajectoryId: '3:4:0',
      sourceId: SOURCE_ID,
      ability: 'lightning_bolt',
    });

    expect(appearance).toEqual(
      expect.objectContaining({
        jagged: true,
        coils: true,
      }),
    );
    expect(appearance?.color).not.toBe(0x86e86a);
    expect(fx.beginBallisticSequence).toHaveBeenCalledWith(
      '3:4:0',
      'lightning_bolt',
      expect.objectContaining({ archetype: 'bolt', palette: 'storm' }),
      SOURCE_ID,
      appearance?.color,
      expect.any(Number),
    );
  });

  it('ends Fireball authored impact anatomy at the server contact event', () => {
    const { painter, fx } = makePainter(() => false);
    painter.handleBallisticLaunch({
      trajectoryId: '3:5:0',
      sourceId: SOURCE_ID,
      ability: 'fireball',
    });
    painter.handleBallisticImpact({
      trajectoryId: '3:5:0',
      x: 11,
      z: 14,
      targetId: TARGET_ID,
      reason: 'entity',
    });

    expect(fx.finishBallisticSequence).toHaveBeenCalledWith('3:5:0', 11, 14, TARGET_ID, 'entity');
  });

  it('lands a target-born DoT with its authored contact sequence and no projectile', () => {
    const { painter, fx, vfx } = makePainter(() => false);
    const claimed = painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'fire',
      fx: 'impact',
      ability: 'flame_shock',
    });

    expect(claimed).toBe(true);
    expect(fx.sequenceInstant).toHaveBeenCalledWith(
      'flame_shock',
      expect.objectContaining({ archetype: 'dot', palette: 'fire' }),
      SOURCE_ID,
      TARGET_ID,
      expect.any(Number),
      expect.any(Number),
    );
    expect(vfx.projectile).not.toHaveBeenCalled();
  });

  it('plays the authored clip for a player nova cast with a gesture (thunder_clap)', () => {
    const { painter, triggerAttack } = makePainter((_id, ability) => ability === 'thunder_clap');
    painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'storm',
      fx: 'nova',
      ability: 'thunder_clap',
    });
    expect(triggerAttack).toHaveBeenCalledWith(SOURCE_ID, 'thunder_clap');
  });

  it('plays the authored clip for a player ground-nova AoE cast with a gesture (earthquake)', () => {
    const { painter, triggerAttack } = makePainter((_id, ability) => ability === 'earthquake');
    painter.handleSpellfxAt({
      x: 0,
      z: 0,
      school: 'physical',
      fx: 'nova',
      ability: 'earthquake',
      radius: 8,
      sourceId: SOURCE_ID,
    });
    expect(triggerAttack).toHaveBeenCalledWith(SOURCE_ID, 'earthquake');
  });

  it('does not play a swing for an ability with no authored gesture clip', () => {
    const { painter, triggerAttack } = makePainter(() => false);
    painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'fire',
      fx: 'impact',
      ability: 'flame_shock',
    });
    expect(triggerAttack).not.toHaveBeenCalled();
  });

  it('never plays the player gesture path for a mob (mobThrowFallback owns that read)', () => {
    const { painter, triggerAttack } = makePainter(
      (_id, ability) => ability === 'earth_shock',
      true,
    );
    painter.handleSpellfx({
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      school: 'fire',
      fx: 'impact',
      ability: 'flame_shock',
    });
    // A mob source is skipped by playerGestureRelease and by mobThrowFallback
    // (deps.isMob is stubbed true but castingAbilityOf/isMidOneShot are
    // undefined, so mobThrowFallback would call triggerAttack(sourceId) with
    // NO ability id if it ran); assert no call ever carries the ability id
    // from the player gesture path specifically.
    for (const call of triggerAttack.mock.calls) {
      expect(call[1]).not.toBe('flame_shock');
    }
  });
});
