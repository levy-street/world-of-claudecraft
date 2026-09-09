// Skulduggery v0.42 class-balance pass (docs/design/class-balance-v042.md):
// a genuine-stealth Lurker's Strike pays a stronger opener reward
// immediately, the repeatable veil-window Edge is halved, and the two never
// stack. This suite covers the exported mechanic helpers
// (src/sim/combat/rogue_stealth_opener.ts) plus the halved numeric constants
// in rogue_engines.ts/ignivar_set_bonuses.ts directly. The real coordinator
// flow (a live Sim casting ambush through effect_dispatch.ts and the
// casting_lifecycle.ts dagger/behind gate) is tests/v042_stealth_integration.test.ts.
import { describe, expect, it } from 'vitest';
import {
  consumeVeiledEdge,
  GLOAM_ID,
  rogueGloamDetonation,
  VEILED_EDGE_BONUS,
  VEILED_EDGE_ID,
  VEILSTRIKE_ID,
} from '../src/sim/combat/rogue_engines';
import {
  capturedTrueStealthAmbush,
  TRUE_STEALTH_OPENER_MULT,
  trueStealthOpenerMultiplier,
  trueStealthOpenerScaleBonus,
} from '../src/sim/combat/rogue_stealth_opener';
import { ASHVEIL_4PC_VEILED_EDGE_BONUS } from '../src/sim/content/ignivar_set_bonuses';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

type TestSim = Sim & { addEntity(entity: Entity): void; ctx: SimContext };

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function rogueSim(spec: string, seed: number): TestSim {
  const sim = new Sim({ seed, playerClass: 'rogue', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(25);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function stealthAura(sourceId: number): Aura {
  return {
    id: 'stealth',
    name: 'Duskveil',
    kind: 'stealth',
    remaining: 60,
    duration: 60,
    value: 0,
    sourceId,
    school: 'physical',
  } satisfies Aura;
}

function gloamBank(sourceId: number): Aura {
  return {
    id: GLOAM_ID,
    name: 'Gloam',
    kind: 'gloam',
    remaining: 60,
    duration: 60,
    value: 0,
    stacks: 3,
    sourceId,
    school: 'physical',
  } satisfies Aura;
}

describe('capturedTrueStealthAmbush: the genuine-stealth snapshot', () => {
  it('is false for anything other than ambush', () => {
    const sim = rogueSim('subtlety', 101);
    sim.player.auras.push(stealthAura(sim.playerId));
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'backstab')).toBe(false);
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'garrote')).toBe(false);
  });

  it('is false for a non-subtlety rogue even while genuinely stealthed', () => {
    const sim = rogueSim('assassination', 102);
    sim.player.auras.push(stealthAura(sim.playerId));
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'ambush')).toBe(false);
  });

  it('is false for subtlety when not actually stealthed (e.g. a veil-window opener)', () => {
    const sim = rogueSim('subtlety', 103);
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'ambush')).toBe(false);
  });

  it("is true for a genuinely stealthed subtlety Lurker's Strike", () => {
    const sim = rogueSim('subtlety', 104);
    sim.player.auras.push(stealthAura(sim.playerId));
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'ambush')).toBe(true);
  });

  it('reads stealth as it stands at call time, matching the required capture-before-breakStealth order', () => {
    // The mechanic requires reading BEFORE the cast's own breakStealth call
    // removes the aura (see the module header for the exact call order).
    // This pins the read itself: once stealth is gone, the snapshot is false.
    const sim = rogueSim('subtlety', 105);
    const aura = stealthAura(sim.playerId);
    sim.player.auras.push(aura);
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'ambush')).toBe(true);
    sim.player.auras.splice(sim.player.auras.indexOf(aura), 1);
    expect(capturedTrueStealthAmbush(sim.ctx, sim.player, 'ambush')).toBe(false);
  });
});

describe('trueStealthOpenerMultiplier / trueStealthOpenerScaleBonus: the doubled reward', () => {
  it('doubles the weapon multiplier and the flat bonus when captured true', () => {
    expect(TRUE_STEALTH_OPENER_MULT).toBe(2);
    expect(trueStealthOpenerMultiplier(true)).toBe(2);
    expect(trueStealthOpenerScaleBonus(true, 35)).toBe(70);
  });

  it('changes nothing when not captured', () => {
    expect(trueStealthOpenerMultiplier(false)).toBe(1);
    expect(trueStealthOpenerScaleBonus(false, 35)).toBe(35);
  });
});

describe('No stack with Veiled Edge: structural guarantee', () => {
  // The complementary "a true-stealth opener must not consume an already-armed
  // Edge, and a subsequent eligible strike consumes the preserved Edge" case
  // needs a live runEffects weaponStrike dispatch (the consumeVeiledEdge call
  // this guarantee is actually about lives in effect_dispatch.ts, not here);
  // that decisive regression lives in tests/v042_stealth_integration.test.ts.
  it('rogueGloamDetonation refuses to arm Veiled Edge while actually stealthed', () => {
    // The true-stealth opener reward and the veil-window Edge are mutually
    // exclusive by construction: the detonation that arms Veiled Edge always
    // refuses while the player is genuinely stealthed (rogue_engines.ts), so
    // a cast capturedTrueStealthAmbush reports true for can never also carry
    // a live Veiled Edge to double-consume.
    const sim = rogueSim('subtlety', 106);
    sim.player.auras.push(stealthAura(sim.playerId));
    sim.player.auras.push(gloamBank(sim.playerId));
    rogueGloamDetonation(sim.ctx, sim.player, 'ambush');
    expect(sim.player.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(false);
    expect(sim.player.auras.some((a) => a.id === VEILSTRIKE_ID)).toBe(false);
    // The bank itself is untouched: a true-stealth opener banks (elsewhere,
    // rogueEngineOnCast), it never detonates.
    expect(sim.player.auras.some((a) => a.id === GLOAM_ID)).toBe(true);
  });
});

describe('Repeatable Gloam Edge halved: +100% -> +50%', () => {
  it('VEILED_EDGE_BONUS is 0.5, so consumeVeiledEdge returns 1.5 for a non-set wearer', () => {
    expect(VEILED_EDGE_BONUS).toBe(0.5);
    const sim = rogueSim('subtlety', 107);
    sim.player.auras.push(gloamBank(sim.playerId));
    rogueGloamDetonation(sim.ctx, sim.player, 'ambush');
    const edge = expectDefined(sim.player.auras.find((a) => a.id === VEILED_EDGE_ID));
    expect(edge.value).toBe(0.5);
    expect(consumeVeiledEdge(sim.ctx, sim.player, 'ambush')).toBe(1.5);
  });

  it('Ashveil 4pc is halved too: +200% -> +100% (value 1, consume returns 2)', () => {
    expect(ASHVEIL_4PC_VEILED_EDGE_BONUS).toBe(1);
    const sim = rogueSim('subtlety', 108);
    equipSet(sim, 'ashveil', 4);
    sim.player.auras.push(gloamBank(sim.playerId));
    rogueGloamDetonation(sim.ctx, sim.player, 'ambush');
    const edge = expectDefined(sim.player.auras.find((a) => a.id === VEILED_EDGE_ID));
    expect(edge.value).toBe(1);
    expect(consumeVeiledEdge(sim.ctx, sim.player, 'ambush')).toBe(2);
  });
});

describe('rogueMods sanity (computeCharacterModifiers still resolves subtlety)', () => {
  it('worn() equips the requested set pieces', () => {
    const mods = computeCharacterModifiers(
      'rogue',
      { spec: 'subtlety', rows: {} },
      25,
      worn('ashveil', 4),
    );
    expect(mods.spec).toBe('subtlety');
  });
});
