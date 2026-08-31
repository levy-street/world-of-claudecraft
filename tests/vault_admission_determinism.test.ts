// The determinism carve-out pin for the vault consumption admission.
//
// src/sim/CLAUDE.md ("Determinism as it bites here") documents a deliberate
// carve-out: SimConfig.vaultConsumptionAdmission is a HOST INPUT the
// determinism contract is parameterized over. A refusing host early-returns
// resolveCraftForRecipe BEFORE the output-side rng draws, so a realm whose
// admission refused draws a shorter stream than an inert-admission replay of
// the same inputs, and no live parity gate wires a refusing admission to see
// it. This suite is the gate for that carve-out: a same-seed twin run (inert
// vs refusing admission) pinning the INTENDED divergence exactly.
//
// The admission is consulted at FOUR sites. The crafting arm above is the
// only one with post-admission draws; the three enchant-apply arms
// (professions/enchanting.ts: the worn apply, the bagged replace, the plain
// bagged apply) sit on zero-draw paths, so a refusal there never shifts the
// stream but still forks persisted character state against the inert
// replay. All four sites are pinned below, each driven at its own resolver
// path (a draw grows onto ONE arm, so no arm may stand in for another).
//
// The pins are direction-sensitive on purpose:
// - Divergence NARROWS (the refusal moves after the draws, the fix the doc
//   names): the refusing run's draw list stops being empty and the
//   catch-up offset stops matching. Retire the doc carve-out together with
//   this suite.
// - Divergence WIDENS (a new post-admission draw lands on the success path):
//   the measured delta stops matching the pinned 1 (2 for a Jack-attuned
//   crafter), or the enchant arm's zero-draw pins flip. Update the doc's
//   named draw counts together with this suite.

import { describe, expect, it } from 'vitest';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { resolveApplyEnchant } from '../src/sim/professions/enchanting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { EquipSlot, VaultConsumptionAdmission, VaultConsumptionTake } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Same scenario shape as tests/vault_consumption_admission.test.ts: the plan
// must span BOTH pools (a carried reagent and a vault draw) so the host
// admission is really consulted (a bags-only plan never calls it).
const RECIPE: ProfessionRecipeRecord = {
  id: 'test_vault_admission_determinism_twin',
  professionId: 'cooking',
  resultItemId: 'tough_jerky',
  resultCount: 1,
  reagents: [
    { itemId: 'smithing_flux', count: 2 },
    { itemId: 'copper_ore', count: 3 },
  ],
  skillReq: 0,
  itemLevelBudget: 5,
  level: 1,
};

function makeSim(admission?: VaultConsumptionAdmission): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
    vaultConsumptionAdmission: admission,
  });
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

function seedAttempt(sim: Sim): void {
  sim.addItem('smithing_flux', 1, sim.playerId);
  const meta = metaOf(sim);
  meta.vault.stock = { smithing_flux: 1, copper_ore: 3 };
  meta.vault.upgrades = 4;
  meta.copper = 777;
}

/** Persisted-character fingerprint, the divergence instrument. What it
 *  actually covers: the serializeCharacter surface (bags, equipment, bank,
 *  vault, copper, skills, quests, deeds), which is everything the refusal
 *  could durably fork; it does NOT see entity-level live state (position,
 *  cast/GCD, auras) or the event queue. That blind spot is sound here:
 *  everything ahead of the reservation is read-only planning (no entity
 *  state moves before the refusal) and the crafting gold fee sits after the
 *  refusal, so a refused attempt has nothing live left to touch. Reads only
 *  sim state (no wall clock), so two untouched same-seed twins serialize
 *  byte-identically and a refused craft must leave the fingerprint
 *  byte-identical to the pre-craft twin. */
function fingerprint(sim: Sim): string {
  const state = sim.serializeCharacter(sim.playerId);
  if (!state) throw new Error('missing character state');
  return JSON.stringify(state);
}

function craftCapturingDraws(sim: Sim): {
  result: ReturnType<typeof resolveCraftForRecipe>;
  draws: number[];
} {
  const draws: number[] = [];
  sim.ctx.rng.setObserver((value) => draws.push(value));
  const result = resolveCraftForRecipe(sim.ctx, sim.playerId, RECIPE);
  sim.ctx.rng.setObserver(null);
  return { result, draws };
}

interface TwinRun {
  inert: Sim;
  refusing: Sim;
  /** A third same-seed twin that never attempts the craft: the reference
   *  world for the post-refusal tick phase, where "the refusal was a no-op"
   *  means "evolves exactly like a world that never tried". */
  control: Sim;
  inertRun: { result: ReturnType<typeof resolveCraftForRecipe>; draws: number[] };
  refusingRun: { result: ReturnType<typeof resolveCraftForRecipe>; draws: number[] };
  admissionTakes: (readonly VaultConsumptionTake[])[];
  preFingerprint: string;
}

function runTwins(prepare?: (sim: Sim) => void): TwinRun {
  const admissionTakes: (readonly VaultConsumptionTake[])[] = [];
  const inert = makeSim(undefined);
  const refusing = makeSim((_pid, takes) => {
    admissionTakes.push(takes);
    return null;
  });
  const control = makeSim(undefined);
  for (const sim of [inert, refusing, control]) {
    seedAttempt(sim);
    prepare?.(sim);
  }

  // Twin positive control: before the craft the worlds are byte-identical
  // (this is also what makes the refusal no-op assertion below non-vacuous).
  const preInert = fingerprint(inert);
  expect(fingerprint(refusing)).toBe(preInert);
  expect(fingerprint(control)).toBe(preInert);

  const inertRun = craftCapturingDraws(inert);
  const refusingRun = craftCapturingDraws(refusing);
  return {
    inert,
    refusing,
    control,
    inertRun,
    refusingRun,
    admissionTakes,
    preFingerprint: preInert,
  };
}

/** The shared twin assertions; `expectedDelta` is the pinned skipped-draw
 *  count for this crafter shape. Proves the code under test really ran on
 *  both arms (the inert twin crafted, the refusing host was consulted with a
 *  non-empty vault plan), then pins the divergence in both directions. */
function expectPinnedDivergence(run: TwinRun, expectedDelta: number): void {
  // The inert arm really crafted and really mutated persisted state, so the
  // fingerprint instrument is demonstrably sensitive to a craft.
  expect(run.inertRun.result.ok).toBe(true);
  expect(run.inert.countItem(RECIPE.resultItemId, run.inert.playerId)).toBe(1);
  expect(fingerprint(run.inert)).not.toBe(run.preFingerprint);

  // The refusing arm really exercised the host refusal (not some earlier
  // deterministic denial, which offline replays reproduce identically and
  // which is outside the carve-out).
  expect(run.refusingRun.result).toEqual({ ok: false, recipeId: RECIPE.id, reason: 'busy' });
  expect(run.admissionTakes).toHaveLength(1);
  expect(run.admissionTakes[0].length).toBeGreaterThan(0);

  // The intended divergence, exactly: the refusal draws NOTHING (a refusal
  // moved after the draws lands here first), and the success path spends
  // exactly the documented output-side draws (a new post-admission draw
  // lands here as a widened delta).
  expect(run.refusingRun.draws).toEqual([]);
  expect(run.inertRun.draws).toHaveLength(expectedDelta);

  // Outside the carve-out the refused world is untouched: persisted character
  // state is byte-identical to the pre-craft twin state.
  expect(fingerprint(run.refusing)).toBe(run.preFingerprint);

  // Same stream, offset by exactly the skipped draws: the refusing realm's
  // next values ARE the draws the inert twin spent on the craft, in order,
  // and after catching up the two streams are back in lockstep. This fails
  // on any offset other than exactly `expectedDelta`, and on any divergence
  // source other than the documented skip (e.g. a boot-time draw forking).
  for (const spent of run.inertRun.draws) {
    expect(run.refusing.ctx.rng.next()).toBe(spent);
  }
  expect(run.refusing.ctx.rng.next()).toBe(run.inert.ctx.rng.next());

  // Catch the control twin up to the same stream position: it never crafted,
  // so it owes the skipped draws plus the one probe draw the twins just spent.
  for (let i = 0; i <= expectedDelta; i++) run.control.ctx.rng.next();
  // Premise for the digest below: the control still IS the pre-craft
  // baseline, so the equality really compares "refused" to "never attempted".
  expect(fingerprint(run.control)).toBe(run.preFingerprint);

  // The relock must survive real tick load, not just one probe: a refusal
  // that left latent state behind (a queued delayed event, a deferred write
  // that draws or mutates later) would fork the stream or the world on a
  // later tick. Twenty paired ticks, compared three ways. Events and the
  // digest hold the refused twin against the CONTROL, because the inert
  // twin's evolution legitimately differs downstream of its craft (the
  // profession trend nudge event, deed stats) and idle ticks are not
  // state-neutral (played time accrues, the 1 Hz deeds sweep records
  // visits), so pre-craft-baseline stability alone would prove nothing.
  // Draws hold refused against INERT: tick rng must stay in lockstep across
  // the carve-out itself.
  run.inert.drainEvents();
  run.refusing.drainEvents();
  run.control.drainEvents();
  const inertTickDraws: number[] = [];
  const refusingTickDraws: number[] = [];
  run.inert.ctx.rng.setObserver((value) => inertTickDraws.push(value));
  run.refusing.ctx.rng.setObserver((value) => refusingTickDraws.push(value));
  for (let i = 0; i < 20; i++) {
    run.inert.tick();
    const controlEvents = run.control.tick();
    expect(run.refusing.tick()).toEqual(controlEvents);
  }
  run.inert.ctx.rng.setObserver(null);
  run.refusing.ctx.rng.setObserver(null);
  expect(refusingTickDraws).toEqual(inertTickDraws);
  // The state digest: after real tick load the refused world's persisted
  // state is byte-identical to the never-attempted world's, and the streams
  // are still in lockstep with the inert twin.
  expect(fingerprint(run.refusing)).toBe(fingerprint(run.control));
  expect(run.refusing.ctx.rng.next()).toBe(run.inert.ctx.rng.next());
}

describe('admission call-site census', () => {
  it('exactly the four pinned sites consult reservePlannedVaultConsumption', async () => {
    // The header above claims completeness over ALL admission sites, and the
    // src/sim/CLAUDE.md carve-out doc names this suite as their gate; a
    // fifth call site added later would silently inherit an untested
    // carve-out while both claims stayed frozen. Comment-stripped census
    // over the whole sim tree (the shared recursive walk, so a module move
    // cannot exit the scan), attributed per file so a new site names
    // itself: crafting's one arm plus enchanting's three (plain bagged,
    // worn, bagged replace). The subtraction excludes the definition in
    // sim_context.ts; import lists carry no call parenthesis and never
    // count.
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('./helpers/strip_comments');
    const { tsFilesUnder } = await import('./helpers/ts_files_under');
    const root = new URL('../src/sim', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const counts: Record<string, number> = {};
    for (const { file, full } of tsFilesUnder(fileURLToPath(root))) {
      const src = stripComments(readFileSync(full, 'utf8'));
      const calls =
        (src.match(/reservePlannedVaultConsumption\(/g) ?? []).length -
        (src.match(/function reservePlannedVaultConsumption\(/g) ?? []).length;
      if (calls > 0) counts[file] = calls;
    }
    expect(counts).toEqual({
      'professions/crafting.ts': 1,
      'professions/enchanting.ts': 3,
    });
  });
});

describe('vault admission determinism carve-out (same-seed twin run)', () => {
  it('a refusing admission skips exactly the one output-side draw (masterwork proc)', () => {
    expectPinnedDivergence(runTwins(), 1);
  });

  it('a Jack-attuned refusal skips exactly two draws (variance roll + masterwork proc)', () => {
    const run = runTwins((sim) => {
      metaOf(sim).archetype.isJackOfAllTrades = true;
    });
    expectPinnedDivergence(run, 2);
  });
});

describe('enchant-apply admission (the zero-draw arms, same-seed twin run)', () => {
  const SWORD = 'eastbrook_arming_sword';
  const MIGHT = 'enchant_weapon_might';
  const PRIOR = 'enchant_weapon_intellect';

  // The three enchant-apply admission sites (professions/enchanting.ts: the
  // plain bagged apply, the worn apply, the bagged replace) sit on paths with
  // no post-admission rng draws at all (enchanting's only draws are on the
  // disenchant path), so a refusal there never shifts the stream; the
  // carve-out each still opens is the persisted-state fork these twins pin.
  // Each arm is driven at ITS OWN resolver path, not one standing in for the
  // others: they share reservePlannedVaultConsumption and the 'busy' refusal
  // shape, but a draw grows onto ONE arm's success path, so only a per-arm
  // twin reds when it does. pinFixture is the routing precondition (a
  // mis-seeded target would silently fall through to a DIFFERENT arm and
  // leave this one's claim untested); assertApplied proves the intended
  // arm's own mint, not just "some apply succeeded".
  interface EnchantApplyArm {
    /** Seed the target copy this arm consumes (reagents are shared). */
    seedTarget(sim: Sim): void;
    /** The pre-attempt routing precondition, pinned on the inert twin (the
     *  byte-identical positive control extends it to the refusing twin). */
    pinFixture(sim: Sim): void;
    /** The arm-specific success proof on the inert twin. */
    assertApplied(sim: Sim): void;
    slot?: EquipSlot;
    confirmReplace?: boolean;
  }

  function runEnchantArmTwins(arm: EnchantApplyArm): void {
    const admissionTakes: (readonly VaultConsumptionTake[])[] = [];
    const inert = makeSim(undefined);
    const refusing = makeSim((_pid, takes) => {
      admissionTakes.push(takes);
      return null;
    });
    for (const sim of [inert, refusing]) {
      // The plan must span BOTH pools (2 carried dust, 3 from the vault of
      // the 5 the enchant needs) so the host admission is really consulted.
      sim.addItem('arcane_dust', 2, sim.playerId);
      const meta = metaOf(sim);
      meta.vault.stock = { arcane_dust: 3 };
      meta.vault.upgrades = 4;
      arm.seedTarget(sim);
    }
    arm.pinFixture(inert);
    // Twin positive control: byte-identical before the attempt.
    const pre = fingerprint(inert);
    expect(fingerprint(refusing)).toBe(pre);

    const inertDraws: number[] = [];
    const refusingDraws: number[] = [];
    inert.ctx.rng.setObserver((value) => inertDraws.push(value));
    const inertResult = resolveApplyEnchant(
      inert.ctx,
      inert.playerId,
      SWORD,
      MIGHT,
      arm.slot,
      arm.confirmReplace,
    );
    inert.ctx.rng.setObserver(null);
    refusing.ctx.rng.setObserver((value) => refusingDraws.push(value));
    const refusingResult = resolveApplyEnchant(
      refusing.ctx,
      refusing.playerId,
      SWORD,
      MIGHT,
      arm.slot,
      arm.confirmReplace,
    );
    refusing.ctx.rng.setObserver(null);

    // The inert twin really applied THROUGH THIS ARM and really forked
    // persisted state, so the fingerprint instrument is demonstrably
    // sensitive to this arm's apply.
    expect(inertResult.ok).toBe(true);
    arm.assertApplied(inert);
    expect(fingerprint(inert)).not.toBe(pre);
    // The refusing host was really consulted, with a non-empty vault plan.
    expect(refusingResult).toEqual({
      ok: false,
      itemId: SWORD,
      enchantId: MIGHT,
      reason: 'busy',
    });
    expect(admissionTakes).toHaveLength(1);
    expect(admissionTakes[0].length).toBeGreaterThan(0);
    // ZERO draws on BOTH arms: the streams never diverge (a draw growing
    // onto this arm's apply path lands here first, and moves the arm into
    // the crafting-style skipped-draw accounting)...
    expect(inertDraws).toEqual([]);
    expect(refusingDraws).toEqual([]);
    expect(refusing.ctx.rng.next()).toBe(inert.ctx.rng.next());
    // ...so the whole divergence is the persisted-state fork above, and the
    // refused character stays byte-identical to its pre-enchant self.
    expect(fingerprint(refusing)).toBe(pre);
  }

  it('the plain bagged apply: a refusal skips zero draws and forks persisted state only', () => {
    runEnchantArmTwins({
      seedTarget(sim) {
        sim.addItem(SWORD, 1, sim.playerId);
      },
      pinFixture(sim) {
        const slot = metaOf(sim).inventory.find((s) => s.itemId === SWORD);
        expect(slot).toBeDefined();
        expect(slot?.instance).toBeUndefined();
      },
      assertApplied(sim) {
        const slot = metaOf(sim).inventory.find((s) => s.itemId === SWORD);
        expect(slot?.instance?.enchant).toBe(MIGHT);
      },
    });
  });

  it('the WORN apply: a refusal skips zero draws and forks persisted state only', () => {
    runEnchantArmTwins({
      seedTarget(sim) {
        sim.addItem(SWORD, 1, sim.playerId);
        sim.equipItem(SWORD, sim.playerId);
      },
      // The routing precondition: the named slot is really wearing the sword
      // (an empty slot would deny not_held and never reach the reservation).
      pinFixture(sim) {
        expect(metaOf(sim).equipment.mainhand).toBe(SWORD);
        expect(metaOf(sim).equipmentInstance?.mainhand).toBeUndefined();
      },
      // The worn arm's own mint: the enchant landed on the WORN copy in
      // place, never on a bagged one.
      assertApplied(sim) {
        expect(metaOf(sim).equipmentInstance?.mainhand?.enchant).toBe(MIGHT);
        expect(metaOf(sim).inventory.some((s) => s.itemId === SWORD)).toBe(false);
      },
      slot: 'mainhand',
    });
  });

  it('the bagged REPLACE: a confirmed refusal skips zero draws and forks persisted state only', () => {
    runEnchantArmTwins({
      seedTarget(sim) {
        sim.addItem(SWORD, 1, sim.playerId);
        const slot = metaOf(sim).inventory.find((s) => s.itemId === SWORD);
        if (!slot) throw new Error('missing seeded sword');
        slot.instance = { enchant: PRIOR, rolled: { stats: { int: 2 } } };
      },
      // The routing precondition: the held copy is ALREADY enchanted, so the
      // confirmed command reaches resolveReplaceEnchantBagged (an unenchanted
      // copy would make the inert confirmReplace flag route to the plain arm
      // and quietly leave the replace arm's claim untested).
      pinFixture(sim) {
        const slot = metaOf(sim).inventory.find((s) => s.itemId === SWORD);
        expect(slot?.instance?.enchant).toBe(PRIOR);
      },
      // The replace arm's own mint: the old enchant peeled off exactly (the
      // int bonus pruned), the new one applied on the same copy.
      assertApplied(sim) {
        const slot = metaOf(sim).inventory.find((s) => s.itemId === SWORD);
        expect(slot?.instance).toEqual({ enchant: MIGHT, rolled: { stats: { str: 2 } } });
      },
      confirmReplace: true,
    });
  });
});
