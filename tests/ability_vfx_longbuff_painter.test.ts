// syncEntity under the long-buff VFX policy: a long-worn buff aura holds NO
// persistent primitive (orbit band, ground disc, barrier shell, sustained
// transformative rim) but keeps a one-shot gain swirl on first sighting,
// keyed per (entity, aura id), replayed if the buff drops and is reapplied or
// after the stale sweep. Short buffs, barriers, morph rims, and victim-worn
// debuff bands are untouched, and silenced buffs stop consuming band/disc
// slots. Drives the real AbilityVfx painter with a stubbed fx engine.
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxDeps, AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { ABILITY_VFX_FULL_SPECS } from '../src/render/ability_vfx_full_specs';
import { holdsBuffVfxWhileWorn } from '../src/render/ability_vfx_longbuff_core';

function makePainter(now: () => number = () => 12.5) {
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
  const deps = {
    vfx,
    fx,
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    spawnAoeRing: vi.fn(),
    triggerAttack: vi.fn(),
  } as unknown as AbilityVfxDeps;
  const painter = new AbilityVfx(deps, now);
  return { painter, fx, vfx };
}

function ent(auras: string[], id = 7, queuedOnSwing: string | null = null): AbilityVfxEntityState {
  return {
    id,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: auras.map((auraId) => ({ id: auraId })),
    queuedOnSwing,
  };
}

describe('long-worn buffs are silent while held', () => {
  it('holds no orbit band, ground disc, or shell for a 30 minute stat buff', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect']));
    painter.syncEntity(ent(['arcane_intellect']));

    expect(fx.orbit).not.toHaveBeenCalled();
    expect(fx.holdGroundAura).not.toHaveBeenCalled();
    // Forward-looking guard: no authored long buff sets barrier today, so this
    // arm can only fail if one ever does and escapes the gate.
    expect(fx.holdShell).not.toHaveBeenCalled();
  });

  it('silences the sustained transformative rim of a long buff, through the aoeAlly suffix path', () => {
    const { painter, fx, vfx } = makePainter();

    // Wildfang Rally: power 1.1 (transformative) at 300s; wearers get the
    // suffixed aura id, which must still resolve to the spec AND stay silent,
    // with the gain swirl recorded under the resolved ability id.
    painter.syncEntity(ent(['aspect_of_the_wild_ap']));
    painter.syncEntity(ent(['aspect_of_the_wild_ap']));

    expect(fx.bodyGlow).not.toHaveBeenCalled();
    expect(fx.holdGroundAura).not.toHaveBeenCalled();
    expect(fx.orbit).not.toHaveBeenCalled();
    expect(vfx.buffSwirl).toHaveBeenCalledTimes(1);
    expect(painter.statsSnapshot().aspect_of_the_wild?.primitives).toBe(1);
  });

  it('pops the gain swirl exactly once, on first sighting', () => {
    const { painter, vfx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect']));
    painter.syncEntity(ent(['arcane_intellect']));
    painter.syncEntity(ent(['arcane_intellect']));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(1);
  });

  it('keys the gain swirl per entity: two wearers each pop one', () => {
    const { painter, vfx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect'], 7));
    painter.syncEntity(ent(['arcane_intellect'], 8));
    painter.syncEntity(ent(['arcane_intellect'], 7));
    painter.syncEntity(ent(['arcane_intellect'], 8));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(2);
  });

  it('keys the gain swirl per aura id: two long buffs on one wearer each pop one', () => {
    const { painter, vfx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect', 'power_word_fortitude']));
    painter.syncEntity(ent(['arcane_intellect', 'power_word_fortitude']));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(2);
  });

  it('records the gain swirl for the dev probe', () => {
    const { painter } = makePainter();

    painter.syncEntity(ent(['arcane_intellect']));

    expect(painter.statsSnapshot().arcane_intellect?.primitives).toBe(1);
  });

  it('replays the gain swirl when the buff drops and is reapplied', () => {
    const { painter, vfx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect']));
    painter.syncEntity(ent([]));
    painter.syncEntity(ent(['arcane_intellect']));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(2);
  });

  it('replays the gain swirl for an entity that left the world mirror and returned', () => {
    const { painter, vfx } = makePainter();

    // Held-semantic state drops an entity not synced between two frames, so a
    // wearer re-entering interest range pops one swirl, like a fresh sighting.
    painter.syncEntity(ent(['arcane_intellect']));
    painter.update(0.016);
    painter.update(0.016);
    painter.syncEntity(ent(['arcane_intellect']));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(2);
  });

  it('keeps sighting state across frames while the entity stays synced', () => {
    const { painter, vfx } = makePainter();

    painter.syncEntity(ent(['arcane_intellect']));
    painter.update(0.016);
    painter.syncEntity(ent(['arcane_intellect']));
    painter.update(0.016);
    painter.syncEntity(ent(['arcane_intellect']));

    expect(vfx.buffSwirl).toHaveBeenCalledTimes(1);
  });

  it('never replays the swirl for an aura latched while presentation-culled', () => {
    const { painter, vfx } = makePainter();

    // Camera-culled sync latches the worn aura without painting; turning the
    // camera back must not read as a fresh acquisition.
    painter.syncEntity(ent(['arcane_intellect']), false);
    painter.syncEntity(ent(['arcane_intellect']));

    expect(vfx.buffSwirl).not.toHaveBeenCalled();
  });
});

describe('everything else keeps its held read', () => {
  it('a short buff keeps its ground disc, orbit band, and gain swirl', () => {
    const { painter, fx, vfx } = makePainter();

    painter.syncEntity(ent(['presence_of_mind']));

    expect(fx.holdGroundAura).toHaveBeenCalledTimes(1);
    expect(fx.orbit).toHaveBeenCalledTimes(1);
    expect(vfx.buffSwirl).toHaveBeenCalledTimes(1);
  });

  it('a short barrier keeps its held shell', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(ent(['ice_barrier']));

    expect(fx.holdShell).toHaveBeenCalledTimes(1);
  });

  it('a morph form keeps its sustained identity rim and never gets a disc', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(ent(['bear_form']));

    expect(fx.bodyGlow).toHaveBeenCalledTimes(1);
    expect(fx.holdGroundAura).not.toHaveBeenCalled();
  });

  it('a victim-worn debuff band still paints (its ability grants no long buff aura)', () => {
    const { painter, fx, vfx } = makePainter();

    // Precondition, so the reader sees the gate is not what this exercises:
    // hamstring grants no >= 300s buff aura, so the policy holds its VFX and
    // the victim-worn band reads through the debuff block as before. No
    // content today authors BOTH a debuff block and a long buff aura.
    expect(holdsBuffVfxWhileWorn('hamstring', ABILITY_VFX_FULL_SPECS.hamstring)).toBe(true);

    painter.syncEntity(ent(['hamstring_slow']));

    expect(fx.orbit).toHaveBeenCalledTimes(1);
    expect(vfx.buffSwirl).not.toHaveBeenCalled();
  });
});

describe('silenced buffs free their band and disc slots', () => {
  it('a short buff under three long buffs paints disc 0 and keeps its band', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent(['arcane_intellect', 'power_word_fortitude', 'mark_of_the_wild', 'presence_of_mind']),
    );

    expect(fx.holdGroundAura).toHaveBeenCalledTimes(1);
    expect(fx.holdGroundAura.mock.calls[0][1]).toBe(0);
    expect(fx.orbit).toHaveBeenCalledTimes(1);
  });

  it('the queued-on-swing tell keeps band headroom under three long buffs', () => {
    const { painter, fx } = makePainter();

    painter.syncEntity(
      ent(['arcane_intellect', 'power_word_fortitude', 'mark_of_the_wild'], 7, 'heroic_strike'),
    );

    expect(fx.orbit).toHaveBeenCalledTimes(1);
  });
});
