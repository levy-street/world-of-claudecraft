import { describe, expect, it } from 'vitest';
import type { ClientWorld } from '../src/net/online';
import type { TalentModifiers } from '../src/sim/content/talents';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { abilityScalingOf } from '../src/ui/ability_damage';
import { abilityEffectText } from '../src/ui/ability_description';
import { bareClient } from './helpers/bare_client';

function snapshot(client: ClientWorld, extra: Record<string, unknown> = {}): void {
  (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
    t: 'snap',
    tick: 1,
    time: 0,
    ents: [],
    self: {
      id: 1,
      k: 'player',
      tid: 'paladin',
      nm: 'Healer',
      lv: 20,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      res: 100,
      mres: 100,
      rtype: 'mana',
      tal: { alloc: { spec: 'holy', rows: {} }, loadouts: [], activeLoadout: -1 },
      ...extra,
    },
  });
}

describe('online balance resolution uses current snapshot state', () => {
  it('applies a new Fiesta healing augment, retains an omitted delta, and clears on exit', () => {
    const client = bareClient(1, { playerClass: 'paladin' });
    snapshot(client);
    const ordinary = client.resolvedAbility('aegis_first_dawn');
    expect(ordinary?.outputScaling?.healing).toBe(1);
    snapshot(client, { arena: { match: { fiesta: { augments: ['aug_mending'] } } } });
    const augmented = client.resolvedAbility('aegis_first_dawn');
    expect(augmented?.outputScaling?.healing).toBe(1.2);
    expect(augmented?.outputScaling?.primaryHealing).toBe(1.1);
    expect(augmented?.effects).not.toEqual(ordinary?.effects);
    snapshot(client);
    expect(client.resolvedAbility('aegis_first_dawn')).toEqual(augmented);
    snapshot(client, { arena: null });
    expect(client.resolvedAbility('aegis_first_dawn')).toEqual(ordinary);
  });

  it('shows Ascension healing effects and Radiant Resonance cast time identically offline and online', () => {
    const sim = new Sim({
      seed: 842,
      playerClass: 'paladin',
      autoEquip: false,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const client = bareClient(1, { playerClass: 'paladin' });
    const devotion = {
      value: 0,
      ascensionCharges: 3,
      ascensionRemaining: 20,
      outOfCombatTime: 0,
      decayProgress: 0,
      blockIcdRemaining: 0,
    };
    sim.player.paladinDevotion = devotion;
    snapshot(client, { pdev: { value: 0, charges: 3, remaining: 20 } });
    for (const id of ['dawns_embrace', 'radiant_chorus', 'solar_invocation']) {
      const offline = sim.resolvedAbility(id);
      const online = client.resolvedAbility(id);
      expect(offline, id).not.toBeNull();
      expect(online?.effects, id).toEqual(offline?.effects);
      expect(online?.castTime, id).toBe(offline?.castTime);
      expect(online?.outputScaling, id).toEqual(offline?.outputScaling);
    }
    sim.player.paladinDevotion = { ...devotion, ascensionCharges: 0, ascensionRemaining: 0 };
    sim.player.auras.push({
      id: 'radiant_resonance',
      name: 'Radiant Resonance',
      kind: 'paladin_radiant_resonance',
      value: 0.5,
      remaining: 10,
      duration: 10,
      sourceId: sim.player.id,
      school: 'holy',
    });
    snapshot(client, {
      pdev: null,
      auras: [
        {
          id: 'radiant_resonance',
          name: 'Radiant Resonance',
          kind: 'paladin_radiant_resonance',
          value: 0.5,
          rem: 10,
          dur: 10,
          src: 1,
          school: 'holy',
        },
      ],
    });
    const offline = sim.resolvedAbility('dawns_embrace');
    const online = client.resolvedAbility('dawns_embrace');
    if (!offline || !online) throw new Error('Dawn is missing');
    expect(online.castTime).toBe(offline.castTime);
    expect(online.castTime).toBe(1.5);
    const scaling = abilityScalingOf(sim.player);
    expect(abilityEffectText(online, scaling)).toBe(abilityEffectText(offline, scaling));
  });
});

// -----------------------------------------------------------------------
// resolvedAbility cost tail parity: applyAbilityCostTail (draining curse
// cost_tax, the Measured Fury arms discount, Aether Surge's per-charge ramp)
// is shared by Sim and ClientWorld (src/net/online.ts). Both worlds here are
// fed the EXACT SAME mirrored inputs (known list, talent mods, entity/auras),
// so any mismatch would be the display split itself, not a setup difference.
describe('resolvedAbility cost tail parity: Sim (offline) vs ClientWorld (online), same state', () => {
  function makeLeveledSim(cls: PlayerClass, spec: string | null, seed: number): Sim {
    const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
    sim.setPlayerLevel(20);
    if (spec) expect(sim.setSpec(spec)).toBe(true);
    return sim;
  }

  // Mirrors exactly the inputs Sim.resolvedAbility itself reads (known list,
  // talent mods, and the live entity/auras) onto a bareClient, so the two
  // worlds are asked the identical question for the identical character.
  function mirrorClient(sim: Sim, cls: PlayerClass): ClientWorld {
    const pid = sim.player.id;
    const meta: PlayerMeta | undefined = sim.players.get(pid);
    if (!meta) throw new Error('expected a player meta for the primary player');
    const client = bareClient(pid, { playerClass: cls });
    client.known = sim.known;
    client.talents = meta.talents;
    // talentMods is private on ClientWorld (only cmd handlers set it from a
    // server snapshot); this fixture mirrors it the same way bareClient
    // itself stamps private-shaped fields (tests/CLAUDE.md bareClient idiom).
    (client as unknown as { talentMods: TalentModifiers }).talentMods = sim.playerMods(meta);
    client.entities.set(pid, sim.player);
    return client;
  }

  function knownCost(sim: Sim, abilityId: string): number {
    const known = sim.known.find((k) => k.def.id === abilityId);
    if (!known) throw new Error(`expected ${abilityId} to be known`);
    return known.cost;
  }

  function addCostTaxAura(sim: Sim, pct: number): void {
    sim.player.auras.push({
      id: 'test_cost_tax',
      name: 'Draining Curse',
      kind: 'cost_tax',
      remaining: 999,
      duration: 999,
      value: pct,
      sourceId: sim.player.id,
      school: 'shadow',
    });
  }

  function addAetherSurgeCharges(sim: Sim, charges: number): void {
    sim.player.auras.push({
      id: 'arcane_surge',
      name: 'Aether Surge',
      kind: 'arcane_charge',
      remaining: 10,
      duration: 10,
      value: charges,
      stacks: charges,
      sourceId: sim.player.id,
      school: 'arcane',
    });
  }

  it('a draining curse cost_tax aura taxes cost the same offline and online', () => {
    const sim = makeLeveledSim('warrior', 'fury', 601);
    addCostTaxAura(sim, 0.33);
    const client = mirrorClient(sim, 'warrior');
    // Fury's own paid spender: Mortal Strike is Arms-only (signature ability).
    const taxed = Math.ceil(knownCost(sim, 'red_harvest') * 1.33);
    expect(sim.resolvedAbility('red_harvest')?.cost).toBe(taxed);
    expect(client.resolvedAbility('red_harvest')?.cost).toBe(taxed);
  });

  it('the Measured Fury (arms) discount applies the same offline and online', () => {
    const sim = makeLeveledSim('warrior', 'arms', 602);
    const client = mirrorClient(sim, 'warrior');
    const discounted = Math.round(knownCost(sim, 'mortal_strike') * 0.9);
    expect(sim.resolvedAbility('mortal_strike')?.cost).toBe(discounted);
    expect(client.resolvedAbility('mortal_strike')?.cost).toBe(discounted);
  });

  it('control: without the arms passive, offline and online agree on the base cost', () => {
    const sim = makeLeveledSim('warrior', 'fury', 603);
    const client = mirrorClient(sim, 'warrior');
    const base = knownCost(sim, 'red_harvest');
    expect(sim.resolvedAbility('red_harvest')?.cost).toBe(base);
    expect(client.resolvedAbility('red_harvest')?.cost).toBe(base);
  });

  it('Aether Surge charges ramp cost the same offline and online', () => {
    const sim = makeLeveledSim('mage', 'arcane', 604);
    addAetherSurgeCharges(sim, 2);
    const client = mirrorClient(sim, 'mage');
    // (1 + 1.0)^2 charges = 4x the base cost.
    const ramped = Math.round(knownCost(sim, 'arcane_surge') * 2 ** 2);
    expect(sim.resolvedAbility('arcane_surge')?.cost).toBe(ramped);
    expect(client.resolvedAbility('arcane_surge')?.cost).toBe(ramped);
  });

  it('control: a zero-cost ability (Charge) shows zero both offline and online under discount and tax', () => {
    const sim = makeLeveledSim('warrior', 'arms', 605);
    addCostTaxAura(sim, 0.5);
    const client = mirrorClient(sim, 'warrior');
    expect(knownCost(sim, 'charge')).toBe(0);
    expect(sim.resolvedAbility('charge')?.cost).toBe(0);
    expect(client.resolvedAbility('charge')?.cost).toBe(0);
  });

  it('the discount-then-tax order (never tax-then-discount) holds the same online', () => {
    const sim = makeLeveledSim('warrior', 'arms', 606);
    addCostTaxAura(sim, 0.3);
    const client = mirrorClient(sim, 'warrior');
    const base = knownCost(sim, 'mortal_strike');
    const discountThenTax = Math.ceil(Math.round(base * 0.9) * 1.3);
    const taxThenDiscount = Math.round(Math.ceil(base * 1.3) * 0.9);
    // Otherwise this case cannot distinguish the two orders.
    expect(discountThenTax).not.toBe(taxThenDiscount);
    expect(sim.resolvedAbility('mortal_strike')?.cost).toBe(discountThenTax);
    expect(client.resolvedAbility('mortal_strike')?.cost).toBe(discountThenTax);
  });

  it('the tax-then-surge order (never surge-then-tax) holds the same online', () => {
    const sim = makeLeveledSim('mage', 'arcane', 607);
    addCostTaxAura(sim, 0.11);
    addAetherSurgeCharges(sim, 2);
    const client = mirrorClient(sim, 'mage');
    const base = knownCost(sim, 'arcane_surge');
    const taxThenSurge = Math.round(Math.ceil(base * 1.11) * 2 ** 2);
    const surgeThenTax = Math.ceil(Math.round(base * 2 ** 2) * 1.11);
    // Otherwise this case cannot distinguish the two orders.
    expect(taxThenSurge).not.toBe(surgeThenTax);
    expect(sim.resolvedAbility('arcane_surge')?.cost).toBe(taxThenSurge);
    expect(client.resolvedAbility('arcane_surge')?.cost).toBe(taxThenSurge);
  });
});
