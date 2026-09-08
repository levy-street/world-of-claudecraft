import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ABILITIES } from '../src/sim/data';

function painter() {
  const fx = new Proxy({ groundYAt: () => 0 } as Record<string, unknown>, {
    get(t, k: string) {
      t[k] ??= vi.fn();
      return t[k];
    },
  });
  const vfx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      t[k] ??= vi.fn();
      return t[k];
    },
  });
  let time = 0;
  const deps = {
    fx,
    vfx,
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    spawnAoeRing: vi.fn(),
    triggerAttack: vi.fn(),
    hasGestureClip: () => true,
    localPlayerId: () => 1,
    isInstantAbility: () => true,
    visualVariantOf: (id: string) => (id === 'unleash_weapon' ? 'unleash_weapon_lifespring' : id),
  } as unknown as AbilityVfxDeps;
  return {
    paint: new AbilityVfx(deps, () => time),
    deps,
    fx,
    next: () => {
      time += 1.05;
    },
  };
}
describe('owned physical and ritual event routing', () => {
  it('keeps Aether Darts in its channel pose on every projectile, including the final tick', () => {
    const { paint, deps, next } = painter();
    for (let tick = 0; tick < 3; tick++) {
      paint.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'arcane',
        ability: 'arcane_missiles',
        fx: 'projectile',
      });
      next();
    }
    expect(deps.triggerAttack).not.toHaveBeenCalled();
  });
  it('holds Aetherwell while actual mana pulses arrive without restarting its action', () => {
    const {paint,deps,next}=painter();
    for(let tick=0;tick<6;tick++){
      paint.handleSpellfx({sourceId:1,targetId:1,school:'arcane',ability:'evocation',fx:'selfCast'});next();
    }
    expect(deps.triggerAttack).not.toHaveBeenCalled();
  });
  it('draws victim blood on a final bleed tick without replaying the original ability', () => {
    const { paint, fx } = painter();
    paint.onDamage({
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      ability: ABILITIES.garrote.name,
      kind: 'hit',
      amount: 15,
      crit: false,
    });
    expect(fx.burstAt).toHaveBeenCalledWith(0, 0, 0, 0x9e1526, 7, 0.5, 'blood', 0.23);
    expect(fx.sequenceInstant).not.toHaveBeenCalled();
  });
  it('preserves Volley’s real radius while its decorative shock circles are removed', () => {
    const { paint, deps } = painter();
    paint.handleSpellfxAt({
      sourceId: 1,
      ability: 'volley',
      school: 'physical',
      fx: 'nova',
      x: 4,
      z: 9,
      radius: 8,
    });
    expect(deps.spawnAoeRing).toHaveBeenCalledWith(4, 9, 8, 'physical', expect.any(Number));
  });
  it('starts one hook from the real pending charge and cancels it when that state ends', () => {
    const { paint, fx } = painter();
    const entity = {
      id: 1,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'bloodhook_pending', value: 2 }],
    };
    paint.syncEntity(entity);
    paint.syncEntity(entity);
    expect(fx.sequenceInstant).toHaveBeenCalledOnce();
    expect(
      vi.mocked(fx.sequenceInstant as (...args: unknown[]) => void).mock.calls[0].slice(0, 4),
    ).toEqual(['bloodhook', expect.any(Object), 1, 2]);
    paint.syncEntity({ ...entity, auras: [] });
    expect(fx.cancelSequence).toHaveBeenCalledWith(1, 'bloodhook');
    expect(fx.crestAt).not.toHaveBeenCalled();
    const arrival = {
      sourceId: 1,
      targetId: 2,
      ability: 'bloodhook',
      school: 'physical' as const,
      fx: 'dotApply' as const,
    };
    paint.handleSpellfx(arrival);
    expect(fx.crestAt).toHaveBeenCalledOnce();
    expect(fx.flipbookAt).toHaveBeenCalledOnce();
    // Existing bleed snapshots and ordinary Woundrend timer refresh never
    // stand in for a successful arrival while another hook is pending.
    paint.syncEntity(entity);
    paint.syncEntity({
      ...entity,
      id: 2,
      auras: [{ id: 'bloodhook_bleed', sourceId: 1, remaining: 12 }],
    });
    expect(fx.crestAt).toHaveBeenCalledOnce();
    paint.handleSpellfx(arrival);
    expect(fx.crestAt).toHaveBeenCalledTimes(2);
    // The authoritative completion works even when a short dash starts and
    // finishes entirely between two render snapshots.
    const unseen = painter();
    unseen.paint.handleSpellfx(arrival);
    expect(unseen.fx.crestAt).toHaveBeenCalledOnce();
    expect(unseen.deps.triggerAttack).not.toHaveBeenCalled();
  });
  it('keeps Ward charges separate from Mastery when both defenses are worn', () => {
    const { paint, fx } = painter();
    for (const charges of [3, 2, 1]) {
      paint.syncEntity({
        id: 1,
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        auras: [{ id: 'lightning_shield', charges }, { id: 'elemental_mastery' }],
      });
    }
    const calls = vi.mocked(fx.orbit as (...args: unknown[]) => void).mock.calls;
    expect(
      calls.filter((c) => c[1] === 'wardCharges').map((c) => (c[3] as { n: number }).n),
    ).toEqual([3, 2, 1]);
    expect(calls.filter((c) => c[1] === 'conduction')).toHaveLength(3);
    expect(fx.holdGroundAura).not.toHaveBeenCalled();
  });
  it('preserves the material detail of a physical channel caster', () => {
    const { paint, fx } = painter();
    paint.syncEntity({
      id: 1,
      castingAbility: 'bladestorm',
      castRemaining: 3,
      castTotal: 4,
      auras: [],
    });
    expect(fx.bodyGlow).not.toHaveBeenCalled();
  });
  it('plays each physical channel pulse without the old circular telegraph or three-second suppression', () => {
    const { paint, deps, fx, next } = painter();
    for (let i = 0; i < 4; i++) {
      paint.handleSpellfxAt({
        sourceId: 1,
        ability: 'bladestorm',
        school: 'physical',
        fx: 'nova',
        x: 0,
        z: 0,
        radius: 8,
      });
      next();
    }
    expect(deps.spawnAoeRing).not.toHaveBeenCalled();
    expect(fx.sequenceInstantAt).toHaveBeenCalledTimes(4);
  });
  it('normalizes the real guard and blood-aura cues into one owned cast', () => {
    for (const [id, cue] of [
      ['raised_guard', 'flourish'],
      ['sanguine_aura', 'weaponAura'],
    ] as const) {
      const { paint, fx } = painter();
      expect(
        paint.handleSpellfx({
          sourceId: 1,
          targetId: 1,
          ability: id,
          school: 'physical',
          fx: cue,
        }),
      ).toBe(true);
      expect(fx.sequenceInstant).toHaveBeenCalledOnce();
    }
  });
  it('routes instant Mercy damage but leaves Litany and travelling poison contact to their existing owner', () => {
    for (const [id, expected] of [
      ['mercy_lance', 1],
      ['scorch', 1],
      ['arcane_surge', 1],
      ['litany_of_guilt', 0],
      ['venom_dart', 0],
    ] as const) {
      const { paint, fx } = painter();
      paint.onDamage({
        sourceId: 1,
        targetId: 2,
        school: ABILITIES[id].school,
        ability: ABILITIES[id].name,
        crit: false,
        kind: 'hit',
        amount: 50,
      });
      expect(fx.sequenceInstant).toHaveBeenCalledTimes(expected);
    }
  });
  it('accepts the healing Unleash variant before the self-cast archetype gate', () => {
    const { paint, fx } = painter();
    expect(
      paint.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        ability: 'unleash_weapon',
        school: 'nature',
        fx: 'selfCast',
      }),
    ).toBe(true);
    expect(fx.sequenceInstant).toHaveBeenCalledOnce();
  });
});
