import { describe, expect, it } from 'vitest';
import { armShatterPass, disarmShatterPass } from '../src/sim/combat/cc';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

function icebindRig(targetMaxHp: number, level = 7): { sim: Sim; target: Entity } {
  const sim = new Sim({ seed: 811, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('frost')).toBe(true);
  sim.player.resource = sim.player.maxResource;

  const target = createMob(98_811, MOBS.forest_wolf, level, {
    x: sim.player.pos.x + 3,
    y: sim.player.pos.y,
    z: sim.player.pos.z,
  });
  target.hostile = true;
  target.aiState = 'idle';
  target.maxHp = target.hp = targetMaxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);

  sim.castAbility('frost_nova');
  return { sim, target };
}

function icebindRoot(target: Entity): Aura | undefined {
  return target.auras.find((aura) => aura.id === 'frost_nova_root' && aura.kind === 'root');
}

function dealDamage(
  sim: Sim,
  target: Entity,
  amount: number,
  opts: { source?: Entity | null; direct?: boolean } = {},
): void {
  (
    sim as unknown as {
      ctx: {
        dealDamage(
          source: Entity | null,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string | null,
          kind: string,
          noRage?: boolean,
          threatOpts?: undefined,
          direct?: boolean,
        ): void;
      };
    }
  ).ctx.dealDamage(
    opts.source ?? null,
    target,
    amount,
    false,
    'physical',
    null,
    'hit',
    false,
    undefined,
    opts.direct ?? true,
  );
}

describe('Icebind damage break', () => {
  it('tells players the exact cumulative damage budget', async () => {
    const description =
      "Freezes all nearby enemies in place for up to 8 sec, dealing $d Frost damage. The root breaks after cumulative damage equal to 10% of the target's maximum health. Damage over time, pet attacks and the first Brittle Ruin hit do not count.";

    expect(ABILITIES.frost_nova.description).toBe(description);
    expect(
      tEntity({
        kind: 'ability',
        id: 'frost_nova',
        field: 'description',
        values: { damage: '6 to 7' },
      }),
    ).toBe(description.replace('$d', '6 to 7'));

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      expect(
        tEntity({
          kind: 'ability',
          id: 'frost_nova',
          field: 'description',
          values: { damage: '6 a 7' },
        }),
      ).toBe(
        'Congela a todos los enemigos cercanos en el sitio durante hasta 8 s e inflige 6 a 7 de daño de Escarcha. El enraizamiento se rompe tras recibir daño acumulado equivalente al 10 % de la salud máxima del objetivo. El daño periódico, los ataques de mascotas y el primer golpe de Ruina Quebradiza no cuentan.',
      );
    } finally {
      setLanguage('en');
    }
  });

  it('breaks after cumulative damage equal to 10% max health', () => {
    const { sim, target } = icebindRig(230);
    const root = icebindRoot(target);

    expect(root?.breaksOnDamage).toBe(true);
    expect(root?.breakThreshold).toBe(23);
    expect(target.hp).toBeLessThan(target.maxHp);

    dealDamage(sim, target, 22);
    expect(icebindRoot(target)?.breakThreshold).toBe(1);

    dealDamage(sim, target, 1);
    expect(icebindRoot(target)).toBeUndefined();
  });

  it('keeps scaling with max health, with no damage cap', () => {
    expect(icebindRoot(icebindRig(1_000).target)?.breakThreshold).toBe(100);
    expect(icebindRoot(icebindRig(5_000).target)?.breakThreshold).toBe(500);
  });

  it('retains the same break rule on rank 2', () => {
    const root = icebindRoot(icebindRig(230, 16).target);
    expect(root?.breakThreshold).toBe(23);
    expect(root?.breakIgnoresIncidental).toBe(true);
    expect(root?.shatterPass).toBe('ready');
  });

  it('ignores damage over time ticks and other non-direct damage', () => {
    const { sim, target } = icebindRig(230);

    dealDamage(sim, target, 200, { direct: false });
    expect(icebindRoot(target)?.breakThreshold).toBe(23);

    dealDamage(sim, target, 23);
    expect(icebindRoot(target)).toBeUndefined();
  });

  it('ignores damage from pets and other owned summons', () => {
    const { sim, target } = icebindRig(230);
    const pet = createMob(98_812, MOBS.forest_wolf, 7, { ...sim.player.pos });
    pet.ownerId = sim.player.id;

    dealDamage(sim, target, 200, { source: pet });
    expect(icebindRoot(target)?.breakThreshold).toBe(23);

    dealDamage(sim, target, 23);
    expect(icebindRoot(target)).toBeUndefined();
  });

  it('lets the first Shatter hit through, then counts the next one', () => {
    const { sim, target } = icebindRig(230);

    const armed = armShatterPass(target);
    expect(armed).toBe(icebindRoot(target));
    dealDamage(sim, target, 200);
    disarmShatterPass(armed);
    const root = icebindRoot(target);
    expect(root?.breakThreshold).toBe(23);
    expect(root?.shatterPass).toBeUndefined();

    // The pass is spent: a second Shatter hit spends the budget like any hit.
    expect(armShatterPass(target)).toBeNull();
    dealDamage(sim, target, 23);
    expect(icebindRoot(target)).toBeUndefined();
  });

  it('hands the Shatter pass back when the hit never reached the root', () => {
    const { target } = icebindRig(230);

    const armed = armShatterPass(target);
    disarmShatterPass(armed);
    expect(icebindRoot(target)?.shatterPass).toBe('ready');
  });

  it('does not make other roots break on damage', () => {
    const { sim, target } = icebindRig(152);
    target.auras = [];
    (
      sim as unknown as {
        ctx: {
          applyRootAura(
            source: Entity,
            target: Entity,
            name: string,
            id: string,
            duration: number,
            school: 'nature',
          ): void;
        };
      }
    ).ctx.applyRootAura(
      sim.player,
      target,
      'Gripping Roots',
      'entangling_roots_root',
      12,
      'nature',
    );
    const root = target.auras.find((aura) => aura.kind === 'root');

    expect(root).toBeDefined();
    expect(root?.breaksOnDamage).not.toBe(true);

    dealDamage(sim, target, 60);
    expect(target.auras).toContain(root);
  });
});
