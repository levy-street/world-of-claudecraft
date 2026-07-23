import { describe, expect, it } from 'vitest';
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

function dealDamage(sim: Sim, target: Entity, amount: number): void {
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
        ): void;
      };
    }
  ).ctx.dealDamage(null, target, amount, false, 'physical', null, 'hit');
}

describe('Icebind damage break', () => {
  it('tells players the exact cumulative damage budget', async () => {
    const description =
      "Freezes all nearby enemies in place for up to 8 sec, dealing $d Frost damage. The root breaks after cumulative damage equal to 15% of the target's maximum health, with a minimum of 20 and a maximum of 60 damage.";

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
        'Congela a todos los enemigos cercanos en el sitio durante hasta 8 s e inflige 6 a 7 de daño de Escarcha. El enraizamiento se rompe tras recibir daño acumulado equivalente al 15 % de la salud máxima del objetivo, con un mínimo de 20 y un máximo de 60 de daño.',
      );
    } finally {
      setLanguage('en');
    }
  });

  it('breaks after cumulative damage equal to 15% max health', () => {
    const { sim, target } = icebindRig(152);
    const root = icebindRoot(target);

    expect(root?.breaksOnDamage).toBe(true);
    expect(root?.breakThreshold).toBe(23);
    expect(target.hp).toBeLessThan(target.maxHp);

    dealDamage(sim, target, 22);
    expect(icebindRoot(target)?.breakThreshold).toBe(1);

    dealDamage(sim, target, 1);
    expect(icebindRoot(target)).toBeUndefined();
  });

  it('clamps the damage budget between 20 and 60', () => {
    expect(icebindRoot(icebindRig(100).target)?.breakThreshold).toBe(20);
    expect(icebindRoot(icebindRig(1_000).target)?.breakThreshold).toBe(60);
  });

  it('retains the same break rule on rank 2', () => {
    expect(icebindRoot(icebindRig(152, 16).target)?.breakThreshold).toBe(23);
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
