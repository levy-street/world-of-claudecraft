import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { HunterPetContact } from '../src/render/ability_vfx/hunter_pet_contact';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { runUnleashBeast } from '../src/sim/combat/hunter_packlord';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function setup() {
  const sim = new Sim({ seed: 2911, playerClass: 'hunter', autoEquip: true }) as Sim & {
    addEntity(e: Entity): void;
    nextId: number;
  };
  sim.setPlayerLevel(20);
  sim.setSpec('beast_mastery');
  const add = (offset: number, pet = false) => {
    const e = createMob(sim.nextId++, pet ? MOBS.forest_wolf : MOBS.training_dummy, 20, {
      ...sim.player.pos,
      z: sim.player.pos.z + offset,
    });
    e.hostile = !pet;
    if (pet) e.ownerId = sim.playerId;
    e.hp = e.maxHp = 100000;
    sim.addEntity(e);
    return e;
  };
  const pet = add(2, true),
    primary = add(3),
    secondary = add(5);
  const paths: THREE.Vector3[][] = [];
  const fx = new Proxy(
    {
      groundYAt: () => 0,
      facingAt: () => 0,
      anchorOf: (id: number, frac: number, out: THREE.Vector3) => {
        const e = sim.entities.get(id);
        if (!e) return null;
        out.x = e.pos.x;
        out.y = frac;
        out.z = e.pos.z;
        return out;
      },
      pathRibbon: vi.fn((_color, _width, _life, fill) => {
        const pts = Array.from({ length: 12 }, () => new THREE.Vector3());
        fill(pts);
        paths.push(pts);
        return true;
      }),
    } as Record<string, unknown>,
    {
      get(t, k: string) {
        t[k] ??= vi.fn();
        return t[k];
      },
    },
  );
  const vfx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      t[k] ??= vi.fn();
      return t[k];
    },
  });
  const paint = new AbilityVfx(
    {
      fx,
      vfx,
      anchor: () => null,
      localPlayerId: () => sim.playerId,
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      isInstantAbility: () => true,
    } as unknown as AbilityVfxDeps,
    () => 1,
  );
  return { sim, pet, primary, secondary, fx, paint, paths };
}

describe('real Hunter pet damage presentation', () => {
  it('does not count rejected decorative paths as visible primitives', () => {
    const { fx, pet, secondary } = setup();
    vi.mocked(fx.pathRibbon as (...args: unknown[]) => boolean).mockReturnValue(false);
    const count = new HunterPetContact().draw(
      fx as unknown as AbilityVfxFx,
      'cleave',
      pet.id,
      secondary.id,
      70,
      false,
      0,
    );
    expect(count).toBe(1);
    expect(fx.flipbookAt).toHaveBeenCalledOnce();
  });
  it('draws one pet-centered clap and separate contacts for the real simulation victims', () => {
    const { sim, pet, primary, fx, paint, paths } = setup();
    const events: SimEvent[] = [];
    vi.spyOn(sim.ctx, 'emit').mockImplementation((e) => events.push(e));
    const effect = ABILITIES.unleash_beast.effects.find((e) => e.type === 'unleashBeast');
    if (effect?.type !== 'unleashBeast') throw new Error('Canonical pet effect missing');
    runUnleashBeast(sim.ctx, sim.player, primary, effect, ABILITIES.unleash_beast.name);
    const hits = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage',
    );
    const claps = hits.filter((e) => e.ability?.endsWith(' Clap'));
    expect(claps.length).toBeGreaterThanOrEqual(2);
    for (const e of claps) {
      expect(e.sourceId).toBe(pet.id);
      paint.onDamage(e);
      expect(damageEventStartsAttackAnimation(pet, null, e.attackAnimationStarted, e.ability)).toBe(
        false,
      );
    }
    expect(fx.shakeAt).toHaveBeenCalledOnce();
    expect(fx.flipbookAt).toHaveBeenCalledTimes(claps.length);
    expect(fx.sequenceInstant).not.toHaveBeenCalled();
    for (const points of paths)
      for (const p of points)
        expect(Math.hypot(p.x - pet.pos.x, p.z - pet.pos.z)).toBeLessThanOrEqual(6);
    expect(damageEventStartsAttackAnimation(pet, null, true, ABILITIES.unleash_beast.name)).toBe(
      true,
    );
  });
  it('keeps frenzy cuts on the victim when the pet is distant and ignores misses', () => {
    const { pet, secondary, paint, paths, fx } = setup();
    pet.pos.x += 50;
    const hit = {
      sourceId: pet.id,
      targetId: secondary.id,
      ability: 'Frenzy Cleave',
      amount: 70,
      school: 'physical',
      kind: 'hit' as const,
      crit: false,
    };
    paint.onDamage({ ...hit, amount: 0 });
    paint.onDamage({ ...hit, kind: 'miss' });
    expect(fx.flipbookAt).not.toHaveBeenCalled();
    paint.onDamage(hit);
    expect(fx.flipbookAt).toHaveBeenCalledOnce();
    expect(fx.shakeAt).not.toHaveBeenCalled();
    expect(paths).toHaveLength(2);
    for (const points of paths)
      for (const p of points)
        expect(Math.hypot(p.x - secondary.pos.x, p.z - secondary.pos.z)).toBeLessThan(1);
  });
});
