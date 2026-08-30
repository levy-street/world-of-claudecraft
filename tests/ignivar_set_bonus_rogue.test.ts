// Rogue Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. The three generic rows (the Cinderfang
// 4pc cooldownFlat, the Smolderstrike and Ashveil 2pc dmgPct rows) are
// RESOLVED-ability rewrites asserted off the real resolve path; the
// Smolderstrike 4pc refund is a mods.procs entry driven through the real proc
// engine; the two bespoke bends (the Cinderfang 2pc refund readers, the
// Ashveil 4pc edge-value bake) are proven against the REAL Sim ctx so the
// worn-equipment recompute wiring is exercised end to end. No rogue bonus
// adds, removes, or moves an rng draw for anyone: the refund selection, the
// cooldownFlat and dmgPct rows, the aura-value bake, and the castNth n:1 proc
// (no chance field) are all draw-free, so wearer and non-wearer rng streams
// stay byte-identical. No probed seeds: the one hit-table-adjacent test pins
// the whole stream via an rng spy instead of hunting a seed.
import { describe, expect, it, vi } from 'vitest';
import {
  consumeVeiledEdge,
  GLOAM_ID,
  rogueEngineOnCast,
  rogueGloamDetonation,
  VEILED_EDGE_BONUS,
  VEILED_EDGE_ID,
  VEILSTRIKE_ID,
} from '../src/sim/combat/rogue_engines';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  ASHVEIL_4PC_VEILED_EDGE_BONUS,
  CINDERFANG_2PC_VENOM_STAGE_REFUND,
  SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC,
  setBonusFlag,
} from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  ctx: SimContext;
};

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function rogueMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('rogue', { spec, rows: {} }, 25, equipment);
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

function addTarget(sim: TestSim, distance: number): Entity {
  const target = createMob(
    sim.nextId++,
    MOBS.training_dummy,
    20,
    sim.groundPos(sim.player.pos.x, sim.player.pos.z + distance),
  );
  target.hostile = true;
  target.hp = target.maxHp = 1_000_000;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.moveSpeed = 0;
  sim.addEntity(target);
  return target;
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

function redlineWindow(sourceId: number): Aura {
  return {
    id: 'redline',
    name: 'Redline',
    kind: 'redline',
    remaining: 8,
    duration: 8,
    value: 0.25,
    stacks: 1,
    sourceId,
    school: 'physical',
  } satisfies Aura;
}

function weaponStrikeOf(entry: { effects: { type: string }[] }) {
  return expectDefined(entry.effects.find((e) => e.type === 'weaponStrike')) as unknown as {
    bonus: number;
    weaponMult?: number;
  };
}

describe('rogue Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['cinderfang', 'assassination'],
      ['smolderstrike', 'combat'],
      ['ashveil', 'subtlety'],
    ] as const) {
      const four = rogueMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = rogueMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
      expect(oneShort.selected[setBonusFlag(setId, 4)], setId).toBeUndefined();
    }
  });
});

describe('Cinderfang 2pc: the Venom Ritual refund readers', () => {
  it('both refund readers pay 20 for wearers and 15 for everyone else', () => {
    // The bend rides the REAL ctx (live playerMods over the worn equipment),
    // exercised at both VENOM_STAGE_REFUND readers: the Craven Thrust grant
    // and the Venom Dart grant.
    const wearer = rogueSim('assassination', 5101);
    equipSet(wearer, 'cinderfang', 2);
    wearer.player.resource = 40;
    rogueEngineOnCast(wearer.ctx, wearer.player, 'backstab');
    expect(wearer.player.resource).toBe(40 + CINDERFANG_2PC_VENOM_STAGE_REFUND);
    wearer.player.resource = 40;
    rogueEngineOnCast(wearer.ctx, wearer.player, 'venom_dart');
    expect(wearer.player.resource).toBe(40 + CINDERFANG_2PC_VENOM_STAGE_REFUND);

    const control = rogueSim('assassination', 5101);
    control.player.resource = 40;
    rogueEngineOnCast(control.ctx, control.player, 'backstab');
    expect(control.player.resource).toBe(55); // the base 15
  });

  it('stays per builder CAST, unconditional at the stage cap', () => {
    const wearer = rogueSim('assassination', 5102);
    equipSet(wearer, 'cinderfang', 2);
    for (let cast = 0; cast < 6; cast++) rogueEngineOnCast(wearer.ctx, wearer.player, 'backstab');
    const ritual = expectDefined(wearer.player.auras.find((a) => a.id === 'venom_ritual'));
    expect(ritual.stacks).toBe(6); // the cap
    wearer.player.resource = 40;
    rogueEngineOnCast(wearer.ctx, wearer.player, 'backstab');
    expect(wearer.player.resource).toBe(40 + CINDERFANG_2PC_VENOM_STAGE_REFUND);
  });

  it('the Wicked Slash fallback stays excluded: the anti-self-funding guard is not widened', () => {
    const wearer = rogueSim('assassination', 5103);
    equipSet(wearer, 'cinderfang', 2);
    wearer.player.resource = 40;
    rogueEngineOnCast(wearer.ctx, wearer.player, 'sinister_strike');
    expect(wearer.player.resource).toBe(40); // no refund, even for wearers
    // ...but the fallback still BANKS a stage, exactly as before.
    expect(wearer.player.auras.some((a) => a.id === 'venom_ritual')).toBe(true);
  });

  it('live cast pair: a wearer Venom Dart nets 5 more energy than the control', () => {
    // Cost 25 is billed at cast; the refund lands at cast completion, both
    // synchronous for an instant, so no regen ticks blur the arithmetic.
    function dartRun(pieces: number): number {
      const sim = rogueSim('assassination', 5104);
      if (pieces > 0) equipSet(sim, 'cinderfang', pieces);
      const target = addTarget(sim, 3);
      sim.targetEntity(target.id);
      sim.player.resource = 60;
      sim.castAbility('venom_dart');
      return sim.player.resource;
    }
    expect(dartRun(2)).toBe(60 - 25 + CINDERFANG_2PC_VENOM_STAGE_REFUND); // 55
    expect(dartRun(0)).toBe(60 - 25 + 15); // 50
  });
});

describe('Cinderfang 4pc: the Venom Dart cooldown row', () => {
  it('resolves Venom Dart to a 4 sec cooldown, down from 8 (the -4 flat clamps sanely)', () => {
    // cooldownFlat applies after cooldownPct and clamps at 0 in
    // applyTalentMods (classes.ts), so the -4 lands at exactly 8 - 4 = 4 on
    // the resolved entry the engine's cooldown set AND the printed cooldown
    // line both read.
    const base = abilitiesKnownAt('rogue', 25, rogueMods('assassination', {}));
    const setw = abilitiesKnownAt('rogue', 25, rogueMods('assassination', worn('cinderfang', 4)));
    expect(expectDefined(base.find((k) => k.def.id === 'venom_dart')).cooldown).toBe(8);
    expect(expectDefined(setw.find((k) => k.def.id === 'venom_dart')).cooldown).toBe(4);
  });

  it('the worn cooldown row reaches the live Venom Dart clock', () => {
    const sim = rogueSim('assassination', 5111);
    equipSet(sim, 'cinderfang', 4);
    const target = addTarget(sim, 3);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('venom_dart');
    const clock = sim.player.cooldowns.get('venom_dart') ?? 0;
    expect(clock).toBeGreaterThan(3.5);
    expect(clock).toBeLessThanOrEqual(4);
  });
});

describe('Smolderstrike 2pc: the Haymaker damage row through the transform re-bake', () => {
  it('the transformed body_blow carries the wearer row: bonus 14 and weaponMult 1.768', () => {
    // Haymaker (body_blow) is a wholesale def swap (resolveActionReplacement)
    // that never sits in the known-ability list, so the row can only arrive
    // via the transform re-bake in Sim.resolvedAbility (applyTalentMods keyed
    // by the FINAL id). Delivered arithmetic (the additive accumulator in
    // resolveTalentHitMult): the wearer folds dmgPct 0.2 beside Thuggery's
    // 0.16 global, 1.36 vs the control's 1.16, so the DELIVERED lift is
    // 1.36 / 1.16 = +17.2 percent, not +20 (stated by the set doc). On the
    // authored numbers: bonus round(10 x 1.36) = 14 (control round(11.6) =
    // 12) and weaponMult 1.3 x 1.36 (control 1.3 x 1.16).
    function resolvedHaymaker(pieces: number) {
      const sim = rogueSim('combat', 5121);
      if (pieces > 0) equipSet(sim, 'smolderstrike', pieces);
      sim.player.auras.push(redlineWindow(sim.playerId));
      const resolved = expectDefined(sim.resolvedAbility('sinister_strike'));
      expect(resolved.def.id).toBe('body_blow');
      return weaponStrikeOf(resolved);
    }
    const wearer = resolvedHaymaker(2);
    expect(wearer.bonus).toBe(14);
    expect(wearer.weaponMult).toBeCloseTo(1.3 * 1.36, 6);
    const control = resolvedHaymaker(0);
    expect(control.bonus).toBe(12);
    expect(control.weaponMult).toBeCloseTo(1.3 * 1.16, 6);
  });

  it('the row is scoped to body_blow: the untransformed Wicked Slash is untouched', () => {
    const base = abilitiesKnownAt('rogue', 25, rogueMods('combat', {}));
    const setw = abilitiesKnownAt('rogue', 25, rogueMods('combat', worn('smolderstrike', 2)));
    const baseStrike = weaponStrikeOf(
      expectDefined(base.find((k) => k.def.id === 'sinister_strike')),
    );
    const wornStrike = weaponStrikeOf(
      expectDefined(setw.find((k) => k.def.id === 'sinister_strike')),
    );
    expect(wornStrike.bonus).toBe(baseStrike.bonus);
    expect(wornStrike.weaponMult).toBe(baseStrike.weaponMult);
  });
});

describe('Smolderstrike 4pc: the Lights Out refund proc', () => {
  function procHarness(equipment: Partial<Record<string, string>>) {
    const mods = rogueMods('combat', equipment);
    const p = {
      id: 1,
      kind: 'player',
      hp: 400,
      maxHp: 400,
      resource: 100,
      maxResource: 100,
      resourceType: 'energy',
      auras: [] as Entity['auras'],
      cooldowns: new Map<string, number>(),
      dead: false,
    } as unknown as Entity;
    const ctx = {
      players: new Map([[1, { cls: 'rogue' }]]),
      playerMods: () => mods,
      applyAura: () => {},
      applyHeal: () => {},
      emit: () => {},
      entities: new Map([[1, p]]),
    } as unknown as SimContext;
    return { mods, p, ctx };
  }

  it('every Lights Out cast refunds 6 sec of Mirrored Blades', () => {
    const { mods, p, ctx } = procHarness(worn('smolderstrike', 4));
    expect(mods.procs.some((proc) => proc.id === 'set_smolderstrike_4pc')).toBe(true);
    p.cooldowns.set('blade_flurry', 30);
    onCastCompleted(ctx, p, 'knockout_blow');
    expect(p.cooldowns.get('blade_flurry')).toBe(30 - SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC);
    onCastCompleted(ctx, p, 'knockout_blow'); // n:1 pays every cast, no banking
    expect(p.cooldowns.get('blade_flurry')).toBe(18);
  });

  it('a refund landing while Mirrored Blades is OFF cooldown is dropped (the talent_procs guard)', () => {
    const { p, ctx } = procHarness(worn('smolderstrike', 4));
    onCastCompleted(ctx, p, 'knockout_blow');
    expect(p.cooldowns.has('blade_flurry')).toBe(false); // dropped, never banked
  });

  it('a remainder at or under the refund clears the cooldown without going negative', () => {
    const { p, ctx } = procHarness(worn('smolderstrike', 4));
    p.cooldowns.set('blade_flurry', 5);
    onCastCompleted(ctx, p, 'knockout_blow');
    expect(p.cooldowns.has('blade_flurry')).toBe(false);
  });

  it('two pieces carry no 4-piece proc', () => {
    const { mods } = procHarness(worn('smolderstrike', 2));
    expect(mods.procs.some((proc) => proc.id === 'set_smolderstrike_4pc')).toBe(false);
  });

  it('live: the cast funnel reports the TRANSFORMED id, so a real Lights Out pays the refund', () => {
    // Lights Out is the Dirt Nap transform inside Redline (actionReplacement
    // on eviscerate), so this proves castNth actually sees 'knockout_blow'
    // from a real cast. The refund is cast-keyed, not landing-keyed, and the
    // Redline open at the runEffects tail is unconditional at 4+ spent combo,
    // so no hit-table outcome can flake this.
    function lightsOutRun(pieces: number): TestSim {
      const sim = rogueSim('combat', 5131);
      if (pieces > 0) equipSet(sim, 'smolderstrike', pieces);
      const target = addTarget(sim, 2);
      sim.targetEntity(target.id);
      sim.player.hitBonus = 1;
      // Open Redline with a full Dirt Nap...
      sim.player.comboPoints = 5;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('eviscerate');
      expect(sim.player.auras.some((a) => a.id === 'redline')).toBe(true);
      // ...then cash out with Lights Out while Mirrored Blades recovers.
      sim.player.cooldowns.set('blade_flurry', 60);
      sim.player.gcdRemaining = 0;
      sim.player.comboPoints = 5;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('eviscerate');
      // The cash-out consumed the run: proof the cast resolved as Lights Out.
      expect(sim.player.auras.some((a) => a.id === 'redline')).toBe(false);
      return sim;
    }
    const wearer = lightsOutRun(4);
    expect(wearer.player.cooldowns.get('blade_flurry')).toBe(
      60 - SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC,
    );
    const control = lightsOutRun(0);
    expect(control.player.cooldowns.get('blade_flurry')).toBe(60);
  });
});

describe("Ashveil 2pc: the Lurker's Strike damage row", () => {
  it('resolves ambush to bonus 42 and weaponMult 3.725 for wearers (35 and 3.1 base)', () => {
    // Delivered arithmetic (the additive accumulator): the set row 0.25 folds
    // beside the subtlety baseline's 0.16 ambush row and the 0.08 global,
    // 1.49 vs the control's 1.24, so the DELIVERED lift is 1.49 / 1.24 =
    // ~+20 percent, not +25 (stated by the set doc). On the authored numbers:
    // bonus round(28 x 1.49) = 42 (control round(28 x 1.24) = 35) and
    // weaponMult 2.5 x 1.49 (control 2.5 x 1.24); the in-veil Veiled Edge
    // multiplier lands on the scaled weapon component afterward.
    const base = abilitiesKnownAt('rogue', 25, rogueMods('subtlety', {}));
    const setw = abilitiesKnownAt('rogue', 25, rogueMods('subtlety', worn('ashveil', 2)));
    const baseStrike = weaponStrikeOf(expectDefined(base.find((k) => k.def.id === 'ambush')));
    const wornStrike = weaponStrikeOf(expectDefined(setw.find((k) => k.def.id === 'ambush')));
    expect(baseStrike.bonus).toBe(35);
    expect(baseStrike.weaponMult).toBeCloseTo(2.5 * 1.24, 6);
    expect(wornStrike.bonus).toBe(42);
    expect(wornStrike.weaponMult).toBeCloseTo(2.5 * 1.49, 6);
  });
});

describe('Ashveil 4pc: the Veiled Edge value bake and dynamic consume', () => {
  it('the detonation bakes 2 into the edge aura for wearers, 1 for everyone else', () => {
    // The REAL ctx (live worn mods): rogueGloamDetonation arms the veil from
    // a synthetic full bank, and the aura VALUE carries the wearer bake.
    // consumeVeiledEdge returns 1 + value, the dynamic read the set doc
    // verifies: 3 for wearers, the base 2 for everyone else.
    function detonate(pieces: number): TestSim {
      const sim = rogueSim('subtlety', 5141);
      if (pieces > 0) equipSet(sim, 'ashveil', pieces);
      sim.player.auras.push(gloamBank(sim.playerId));
      rogueGloamDetonation(sim.ctx, sim.player, 'ambush');
      return sim;
    }
    const wearer = detonate(4);
    const wearerEdge = expectDefined(wearer.player.auras.find((a) => a.id === VEILED_EDGE_ID));
    expect(wearerEdge.value).toBe(ASHVEIL_4PC_VEILED_EDGE_BONUS);
    expect(consumeVeiledEdge(wearer.ctx, wearer.player, 'ambush')).toBe(
      1 + ASHVEIL_4PC_VEILED_EDGE_BONUS,
    );
    expect(wearer.player.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(false);

    const control = detonate(0);
    const controlEdge = expectDefined(control.player.auras.find((a) => a.id === VEILED_EDGE_ID));
    expect(controlEdge.value).toBe(VEILED_EDGE_BONUS);
    expect(consumeVeiledEdge(control.ctx, control.player, 'ambush')).toBe(1 + VEILED_EDGE_BONUS);
  });

  it('live cast pair: the wearer edge strikes past DOUBLE, the control double stays under it', () => {
    // The set doc's same-change note "the :407 threshold rises": the base
    // (non-wearer) pin in tests/rogue_engines.test.ts:407 holds its edged
    // strike above 1.3x the plain one; the wearer-scoped mirror here holds
    // the tripled strike above 2x, a bar the control's double can NEVER
    // reach (the flat bonus term keeps (2mW + b) / (mW + b) strictly under
    // 2). The whole stream is pinned via an rng spy (hit-table roll 0.5
    // lands past the 5 percent dodge slot, crit 0.5 < critChance fails, and
    // the weapon roll sits at its midpoint), so both runs are deterministic
    // with byte-identical draw handling: no probed seed to re-mint.
    const isHit = (e: SimEvent): e is SimEvent & { amount: number; ability: string | null } =>
      e.type === 'damage' &&
      (e as { kind?: string }).kind === 'hit' &&
      !(e as { crit?: boolean }).crit;

    function veilRun(pieces: number): { edged: number; plain: number } {
      const sim = rogueSim('subtlety', 5151);
      if (pieces > 0) equipSet(sim, 'ashveil', pieces);
      const target = addTarget(sim, 2);
      target.facing = Math.PI; // face to face: the armed bank waives behind
      sim.targetEntity(target.id);
      sim.player.hitBonus = 1;
      sim.player.auras.push(gloamBank(sim.playerId));
      const spy = vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.5);
      sim.events.length = 0;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('ambush'); // detonates; the strike rides its own veil
      const edged = expectDefined(
        sim.events.filter(isHit).find((e) => e.ability === "Lurker's Strike"),
      ).amount;
      expect(sim.player.auras.some((a) => a.id === VEILSTRIKE_ID)).toBe(true);
      expect(sim.player.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(false); // consumed
      sim.events.length = 0;
      sim.player.gcdRemaining = 0;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('ambush'); // still in-veil, edge spent: full price, 1x
      const plain = expectDefined(
        sim.events.filter(isHit).find((e) => e.ability === "Lurker's Strike"),
      ).amount;
      spy.mockRestore();
      return { edged, plain };
    }

    const wearer = veilRun(4);
    expect(wearer.edged).toBeGreaterThan(wearer.plain * 2);
    const control = veilRun(0);
    expect(control.edged).toBeGreaterThan(control.plain * 1.3);
    expect(control.edged).toBeLessThan(control.plain * 2);
  });
});
