import { describe, expect, it } from 'vitest';
import {
  OWNED_CLASS_PBE_TALENTS,
  runOwnedHealerProbe,
  runWarspiritOfftankProbe,
} from '../scripts/owned_class_balance_probe';
import { Sim } from '../src/sim/sim';

// Part of the owned-class level 20 balance family (docs/qa-gate.md, "The
// long-sims lanes"). This file reads no diet flag: its probes run the same
// configuration at PR time and nightly.
describe('owned-class level 20 balance harness (healer probes)', () => {
  it.each(['spiritmend', 'doctrine', 'benison', 'groveheart'] as const)(
    'records the fixed one-ally and three-ally %s healing profiles',
    (spec) => {
      for (const allies of [1, 3] as const) {
        const result = runOwnedHealerProbe(spec, allies, 29_910, 'test-head');
        expect(result.head).toBe('test-head');
        expect(result.effectiveHealing).toBeGreaterThan(0);
        expect(result.hps).toBe(result.effectiveHealing / result.seconds);
        expect(result.overhealing).toBeGreaterThanOrEqual(0);
        expect(result.overhealPct).toBeGreaterThanOrEqual(0);
        expect(result.overhealPct).toBeLessThanOrEqual(1);
        expect(result.emergencyRecoverySeconds).not.toBeNull();
        expect(result.resource.end).toBeGreaterThanOrEqual(0);
        expect(Object.keys(result.castsByAbility).length).toBeGreaterThan(0);
        expect(Object.keys(result.equipment).length).toBeGreaterThan(0);
        expect(result.talents).toEqual(OWNED_CLASS_PBE_TALENTS[spec]);
      }
    },
    // Was 30_000 when this case ran sixth in the warm pre-split file; it now
    // runs FIRST in its own file and absorbs cold-start (measured cold 8.24s
    // local vs 6.9s warm; the family sizes budgets at ~2.5x local for the
    // fast-runner margin, and lane contention at workers=2 can roughly double
    // that, which put 30s within reach of a spurious bound-kill on a REQUIRED
    // lane).
    60_000,
  );

  it('runs Priest healer pressure through shields and Seraphic Vigil', () => {
    const doctrine = runOwnedHealerProbe('doctrine', 3, 29_912);
    const benison = runOwnedHealerProbe('benison', 3, 29_912);

    expect(doctrine.absorbedDamage).toBeGreaterThan(0);
    // The pressure run must still WEAVE the Vigil into the rotation; whether
    // it fires is the party's health, asserted deterministically below (a
    // live benison healer keeps the probe party above the 35% trigger for
    // whole runs, so a triggered-heal assertion here was flaky-by-design).
    expect(benison.castsByAbility['Seraphic Vigil'] ?? 0).toBeGreaterThan(0);

    // The trigger contract, exercised directly: ward an ally, drop them below
    // the 35% threshold with one hit, and the consumed Vigil pays its heal as
    // an attributable Seraphic Vigil healing event.
    const sim = new Sim({ seed: 29_912, playerClass: 'priest', autoEquip: true }) as Sim & {
      drainEvents(): { type: string; ability?: string; amount?: number }[];
      ctx: {
        dealDamage(
          source: unknown,
          target: unknown,
          amount: number,
          direct: boolean,
          school: string,
          ability: string,
          outcome: string,
        ): void;
      };
    };
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const priest = sim.player;
    priest.resource = priest.maxResource;
    sim.targetEntity(priest.id);
    sim.castAbility('seraphic_vigil');
    sim.tick();
    expect(priest.auras.some((aura) => aura.id === 'seraphic_vigil')).toBe(true);
    priest.hp = Math.floor(priest.maxHp * 0.4);
    sim.drainEvents();
    sim.ctx.dealDamage(
      null,
      priest,
      Math.floor(priest.maxHp * 0.1),
      false,
      'physical',
      'Vigil Probe',
      'hit',
    );
    const vigilHeal = sim
      .drainEvents()
      .filter((event): event is Extract<typeof event, { type: 'heal2' }> => event.type === 'heal2')
      .find((event) => event.ability === 'Seraphic Vigil');
    expect(vigilHeal?.amount ?? 0).toBeGreaterThan(0);
    expect(priest.auras.some((aura) => aura.id === 'seraphic_vigil')).toBe(false);
  }, 120_000);

  it('keeps role probes deterministic at the same fixed seed', () => {
    expect(runOwnedHealerProbe('spiritmend', 3, 29_911)).toEqual(
      runOwnedHealerProbe('spiritmend', 3, 29_911),
    );
    expect(runWarspiritOfftankProbe(29_921)).toEqual(runWarspiritOfftankProbe(29_921));
  }, 120_000);
});
