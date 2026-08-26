// The Masterwrought phase 10 Lucent Infusion guard: the one requiresPerfected
// enchant in the table, plus the skill gates the whole Lucent tier introduced.
//
// Since phase 12 the game MINTS ItemInstancePayload.perfected (the Perfecting
// rank walk, src/sim/professions/perfecting.ts; the pre-minting version of
// this file carried a source-scan tripwire against any mint, deleted in the
// same change that minted). The claims this file holds now:
//   - a PLAIN granted copy never reads as Perfected: the whole-catalog sweep
//     drives every merged item id through the real grant path (a bagged copy
//     is really held before the guard is read, so a refusal can never be
//     confused with an absence), and only the hand-stamped control flips it;
//   - the bagged arm is NARROWED to the exact copy an id-only apply would
//     SPEND (baggedEnchantVictim, the remover's own victim order: a plain copy
//     first, then the newest unenchanted instanced copy, or the pinned
//     enchanted copy on a confirmed replace; the phase 12 obligation the
//     phase 10 doc recorded), so one Perfected copy can no longer license
//     spending an ordinary one;
//   - the deny ladder's ORDER, all three pairwise ways (not_perfected before
//     wrong_slot, and each of those before insufficient_skill), at BOTH
//     twins: the resolver and the cast-start admission mirror (a gate present
//     in one and missing in the other is exactly the shape that lets a
//     refused enchant buy a cast bar);
//   - every refusal arm draws zero rng, behind a positive control, so a
//     mis-wired observer cannot make those zeros vacuous.
// The picker mirror (src/ui/enchant_apply_view.ts) is pinned in
// tests/enchant_apply_view.test.ts and deliberately not repeated here.
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import {
  evaluateApplyEnchantAdmission,
  holdsPerfectedTarget,
  isEnchantedInstance,
  resolveApplyEnchant,
} from '../src/sim/professions/enchanting';
import {
  craftForApexItem,
  PERFECTING_ATTEMPT_COST,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
  resolvePerfectingAttempt,
} from '../src/sim/professions/perfecting';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { runApplyEnchant, runDisenchant } from './helpers/enchant_family_cast';
import { EMPTY_TEST_WORLD } from './sim_shared';

const INFUSION = 'enchant_lucent_infusion'; // chest, requiresPerfected, skillReq 125
const APEX_CHEST = 'enchant_chest_lucent_stamina'; // chest, skillReq 100, no marker gate
const CHEST_ITEM = 'sunspun_vestments'; // an epic chest piece: the Infusion's own slot
const BOOTS_ITEM = 'wardspeaker_sabatons'; // an epic feet piece: the wrong_slot decoy
const LUCENT = 'lucent_reagent';
const SHARD = 'arcane_shard';
const ESSENCE = 'arcane_essence';
// A common one-hand weapon whose disenchant draws rng (disenchantYield): the
// positive control for the zero-draw sweep.
const DRAWING_ITEM = 'eastbrook_arming_sword';

function world(seed = 5): { sim: Sim; pid: number; meta: PlayerMeta; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  return {
    sim,
    pid,
    meta: sim.players.get(pid) as PlayerMeta,
    p: sim.entities.get(pid) as Entity,
  };
}

/** A skill-125 enchanter holding more than the Infusion bill, so no arm below
 *  can pass for want of materials or skill instead of the gate under test. */
function apexEnchanter(seed = 5): ReturnType<typeof world> {
  const w = world(seed);
  w.meta.craftSkills.enchanting = 125;
  w.sim.addItem(LUCENT, 5, w.pid);
  w.sim.addItem(SHARD, 4, w.pid);
  w.sim.addItem(ESSENCE, 4, w.pid);
  return w;
}

function enchantResults(sim: Sim): Extract<SimEvent, { type: 'enchantResult' }>[] {
  return (sim.drainEvents() as SimEvent[]).filter(
    (ev): ev is Extract<SimEvent, { type: 'enchantResult' }> => ev.type === 'enchantResult',
  );
}

/** Draw count over one action, through the live stream the sim itself uses. */
function drawsDuring(sim: Sim, run: () => void): number {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws += 1;
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return draws;
}

describe('holdsPerfectedTarget refuses every PLAIN copy (only the Perfecting walk stamps it)', () => {
  it('every merged item id, held as a real bagged copy, reads as not Perfected', () => {
    const { sim, pid, meta } = world();
    let swept = 0;
    for (const id of Object.keys(ITEMS)) {
      sim.addItem(id, 1, pid);
      // The absence-is-not-refusal guard: the copy must really be in the bags
      // when the read happens, or a grant that silently failed would satisfy
      // the refusal below for the wrong reason.
      expect(sim.countItem(id, pid), `${id}: the fixture really holds a copy`).toBeGreaterThan(0);
      expect(holdsPerfectedTarget(meta, id), `${id} must not read as Perfected`).toBe(false);
      sim.removeItem(id, 1, pid);
      swept += 1;
    }
    // Anti-vacuity floor near the real catalog size: an import that resolved to
    // an empty table would otherwise sweep nothing and pass.
    expect(swept, 'the sweep covered the whole catalog').toBeGreaterThanOrEqual(800);

    // The positive control for the sweep: the very same guard, the very same
    // item, answers TRUE the moment a copy carries the marker. Without this the
    // whole-catalog sweep above could all be a dead read.
    sim.addItemInstance(CHEST_ITEM, { perfected: true }, pid, 1);
    expect(holdsPerfectedTarget(meta, CHEST_ITEM), 'a stamped copy is accepted').toBe(true);
  });

  it('the worn arm answers about the copy in the NAMED slot, not any copy held', () => {
    const { sim, pid, meta } = world();
    // The apex chest gates on level 20, so a level-1 fixture would silently
    // keep wearing the starter tunic and the worn arm would read a copy the
    // test never chose.
    sim.setPlayerLevel(20);
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.equipItem(CHEST_ITEM, pid);
    expect(meta.equipment.chest, 'the fixture really equipped it').toBe(CHEST_ITEM);
    expect(holdsPerfectedTarget(meta, CHEST_ITEM, 'chest'), 'an ordinary worn copy').toBe(false);

    meta.equipmentInstance.chest = { ...meta.equipmentInstance.chest, perfected: true };
    expect(holdsPerfectedTarget(meta, CHEST_ITEM, 'chest'), 'the stamped worn copy').toBe(true);
    // Named-slot means named: the same stamped copy does not answer for a
    // different slot, which is what keeps any future Infusion slot move honest.
    expect(holdsPerfectedTarget(meta, CHEST_ITEM, 'feet'), 'a different slot').toBe(false);
  });

  it('the bagged arm answers about the copy the apply would CONSUME, not the holding', () => {
    // The phase 12 narrowing: the guard peeks the exact VICTIM
    // removeEnchantableItem would spend (baggedEnchantVictim: a plain copy
    // before any instanced one, then the newest unenchanted instanced copy),
    // never the holding and never the bare newest copy. Holding a Perfected
    // copy in an OLDER slot with an ordinary instanced copy newer must refuse:
    // accepting would spend the ordinary copy under a licence the stamped one
    // earned.
    const older = apexEnchanter(16);
    older.sim.addItemInstance(CHEST_ITEM, { perfected: true }, older.pid, 1);
    older.sim.addItemInstance(CHEST_ITEM, { signer: 'Crafter' }, older.pid, 1);
    // The premise, proven on the real bag order: the ordinary copy sits in the
    // higher (newer) slot.
    const slots = older.meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(slots).toHaveLength(2);
    expect(slots[0].instance?.perfected).toBe(true);
    expect(slots[1].instance?.perfected).toBeUndefined();
    expect(holdsPerfectedTarget(older.meta, CHEST_ITEM), 'ordinary copy is newest').toBe(false);
    expect(resolveApplyEnchant(older.sim.ctx, older.pid, CHEST_ITEM, INFUSION).reason).toBe(
      'not_perfected',
    );

    // The reverse order accepts: the stamped copy is the newest UNENCHANTED
    // instanced copy, i.e. the one the apply consumes, and the apply really
    // spends it (the enchanted re-mint carries the marker forward).
    const newer = apexEnchanter(17);
    newer.sim.addItemInstance(CHEST_ITEM, { signer: 'Crafter' }, newer.pid, 1);
    newer.sim.addItemInstance(CHEST_ITEM, { perfected: true }, newer.pid, 1);
    expect(holdsPerfectedTarget(newer.meta, CHEST_ITEM), 'stamped copy is newest').toBe(true);
    expect(resolveApplyEnchant(newer.sim.ctx, newer.pid, CHEST_ITEM, INFUSION).ok).toBe(true);
    const spent = newer.meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(spent.map((s) => s.instance?.perfected === true).sort()).toEqual([false, true]);
    expect(spent.find((s) => s.instance?.enchant === INFUSION)?.instance?.perfected).toBe(true);
  });

  it('a copy walked to Perfected by the REAL stage applies the Infusion and keeps its R5 bonus', () => {
    // The interlock end to end: the Perfecting walk merges the R5 delta into
    // bare rolled.stats with no rolled.masterwork, the shape isEnchantedInstance
    // used to read as a LEGACY enchant (refusing the Infusion unconfirmed and
    // wiping the bonus on a confirmed replace). Bagged and worn arms, both
    // unconfirmed, both must APPLY with the bonus and the enchant side by side.
    const walk = (seed: number) => {
      const w = apexEnchanter(seed);
      w.sim.setPlayerLevel(20);
      w.meta.craftSkills[craftForApexItem(CHEST_ITEM) as string] = PERFECTING_SKILL_REQ;
      for (const c of PERFECTING_ATTEMPT_COST) w.sim.addItem(c.itemId, c.count * 8, w.pid);
      w.sim.addItemInstance(CHEST_ITEM, { signer: 'Crafter' }, w.pid, 1);
      const bag = w.meta.inventory.findIndex((s) => s.itemId === CHEST_ITEM);
      // Force every roll to succeed so the walk is exactly PERFECTING_RANKS long.
      (w.sim.ctx.rng as { next: () => number }).next = () => 0;
      for (let i = 0; i < PERFECTING_RANKS; i++) {
        resolvePerfectingAttempt(w.sim.ctx, w.pid, { bag, itemId: CHEST_ITEM });
      }
      const copy = w.meta.inventory[bag];
      expect(copy.itemId).toBe(CHEST_ITEM);
      expect(copy.instance?.perfected).toBe(true);
      expect(copy.instance?.enchant).toBeUndefined();
      const bonus = { ...copy.instance?.rolled?.stats };
      expect(Object.keys(bonus).length, 'the walk really merged an R5 record').toBeGreaterThan(0);
      return { ...w, bag, bonus };
    };
    const infusionBonus = ENCHANTS[INFUSION].statBonus;

    const bagged = walk(21);
    expect(isEnchantedInstance(bagged.meta.inventory[bagged.bag].instance!)).toBe(false);
    const applied = resolveApplyEnchant(bagged.sim.ctx, bagged.pid, CHEST_ITEM, INFUSION);
    expect(applied.ok, `bagged unconfirmed apply: ${applied.reason}`).toBe(true);
    const after = bagged.meta.inventory.find((s) => s.instance?.enchant === INFUSION);
    expect(after?.instance?.perfected).toBe(true);
    for (const [stat, value] of Object.entries(bagged.bonus)) {
      expect(after?.instance?.rolled?.stats?.[stat]).toBe(
        value + (infusionBonus[stat as keyof typeof infusionBonus] ?? 0),
      );
    }
    for (const [stat, value] of Object.entries(infusionBonus)) {
      if (value === undefined) continue;
      expect(after?.instance?.rolled?.stats?.[stat]).toBe((bagged.bonus[stat] ?? 0) + value);
    }

    const worn = walk(22);
    worn.sim.equipItem(CHEST_ITEM, worn.pid);
    expect(worn.meta.equipment.chest).toBe(CHEST_ITEM);
    expect(worn.meta.equipmentInstance.chest?.perfected).toBe(true);
    const wornApplied = resolveApplyEnchant(worn.sim.ctx, worn.pid, CHEST_ITEM, INFUSION, 'chest');
    expect(wornApplied.ok, `worn unconfirmed apply: ${wornApplied.reason}`).toBe(true);
    const wornAfter = worn.meta.equipmentInstance.chest;
    expect(wornAfter?.enchant).toBe(INFUSION);
    expect(wornAfter?.perfected).toBe(true);
    for (const [stat, value] of Object.entries(worn.bonus)) {
      expect(wornAfter?.rolled?.stats?.[stat]).toBe(
        value + (infusionBonus[stat as keyof typeof infusionBonus] ?? 0),
      );
    }
  });

  it('a PLAIN copy shadows a newer Perfected one: the remover spends plain first', () => {
    // The shape the first narrowing cut missed: removeEnchantableItem's first
    // pass takes a plain fungible copy whatever its index, so a Perfected copy
    // that is the NEWEST slot still is not the victim. A newest-copy peek
    // accepted here while the apply spent the plain copy.
    const shadowed = apexEnchanter(18);
    shadowed.sim.addItem(CHEST_ITEM, 1, shadowed.pid);
    shadowed.sim.addItemInstance(CHEST_ITEM, { perfected: true }, shadowed.pid, 1);
    const slots = shadowed.meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(slots).toHaveLength(2);
    expect(slots[0].instance).toBeUndefined();
    expect(slots[1].instance?.perfected).toBe(true);
    expect(holdsPerfectedTarget(shadowed.meta, CHEST_ITEM), 'the plain copy is the victim').toBe(
      false,
    );
    expect(resolveApplyEnchant(shadowed.sim.ctx, shadowed.pid, CHEST_ITEM, INFUSION).reason).toBe(
      'not_perfected',
    );
    // Nothing was spent: the plain copy and the stamped copy both survive.
    expect(shadowed.meta.inventory.filter((s) => s.itemId === CHEST_ITEM)).toHaveLength(2);
  });

  it('an already-ENCHANTED Perfected copy is skipped for an ordinary one, unless the replace is confirmed', () => {
    // The second missed shape: the remover's second pass skips an enchanted
    // instanced copy for an unenchanted one, so [ordinary older, Perfected AND
    // enchanted newer] spends the ordinary copy on a plain apply. The confirmed
    // replace arm pins the enchanted copy instead (replaceVictimIndex), which
    // IS the Perfected one, so the guard follows the arm split exactly.
    const held = apexEnchanter(19);
    held.sim.addItemInstance(CHEST_ITEM, { signer: 'Crafter' }, held.pid, 1);
    held.sim.addItemInstance(
      CHEST_ITEM,
      { perfected: true, enchant: 'enchant_chest_lucent_stamina' },
      held.pid,
      1,
    );
    expect(
      holdsPerfectedTarget(held.meta, CHEST_ITEM),
      'plain apply spends the ordinary copy',
    ).toBe(false);
    expect(resolveApplyEnchant(held.sim.ctx, held.pid, CHEST_ITEM, INFUSION).reason).toBe(
      'not_perfected',
    );
    expect(
      holdsPerfectedTarget(held.meta, CHEST_ITEM, undefined, true),
      'the confirmed replace pins the enchanted, Perfected copy',
    ).toBe(true);
    // Both twins carry the flag: the confirmed apply passes the Perfected gate
    // and proceeds into the replace arm (whatever that arm then answers).
    expect(
      resolveApplyEnchant(held.sim.ctx, held.pid, CHEST_ITEM, INFUSION, undefined, true).reason,
    ).not.toBe('not_perfected');
  });
});

describe('the Infusion refuses every reachable copy, at both twins', () => {
  it('RESOLVE: not_perfected on a correct-slot epic chest with the bill in hand', () => {
    const { sim, pid } = apexEnchanter();
    sim.addItem(CHEST_ITEM, 1, pid);
    // The premise, stated: the slot matches and the reagents are present, so
    // the refusal below is the marker gate and nothing else. (The accept arm
    // further down proves this same fixture DOES apply once stamped.)
    expect(ITEMS[CHEST_ITEM].slot).toBe(ENCHANTS[INFUSION].itemSlot);
    expect(ENCHANTS[INFUSION].reagents).toEqual([
      { itemId: LUCENT, count: 3 },
      { itemId: SHARD, count: 2 },
    ]);

    const res = resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, INFUSION);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_perfected');
    // Side-effect free: the reagents and the target copy are all still there,
    // and the copy is still ENCHANTABLE (nothing was minted onto it).
    expect(sim.countItem(LUCENT, pid)).toBe(5);
    expect(sim.countItem(SHARD, pid)).toBe(4);
    expect(sim.countItem(CHEST_ITEM, pid)).toBe(1);
    expect(sim.countEnchantableItem(CHEST_ITEM, pid)).toBe(1);
  });

  it('CAST START: the admission mirror refuses too, so the cast bar is never bought', () => {
    const { sim, pid, p } = apexEnchanter(6);
    sim.addItem(CHEST_ITEM, 1, pid);

    const admission = evaluateApplyEnchantAdmission(sim.ctx, pid, CHEST_ITEM, INFUSION);
    expect(admission?.ok).toBe(false);
    expect(admission?.reason).toBe('not_perfected');

    // The same refusal through the real command surface: one enchantResult
    // carrying the reason, no cast running, nothing consumed.
    sim.drainEvents();
    runApplyEnchant(sim, CHEST_ITEM, INFUSION, undefined, undefined, pid);
    const results = enchantResults(sim);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe('not_perfected');
    expect(results[0].pid).toBe(pid);
    expect(p.castingAbility, 'no cast was started').toBeNull();
    expect(sim.countItem(LUCENT, pid)).toBe(5);
    expect(sim.countItem(SHARD, pid)).toBe(4);
    expect(sim.countItem(CHEST_ITEM, pid)).toBe(1);
  });

  it('not_perfected answers BEFORE wrong_slot: a boots target still reads not_perfected', () => {
    const { sim, pid } = apexEnchanter(7);
    sim.addItem(BOOTS_ITEM, 1, pid);
    // The premise the order pin needs: the two slots really do disagree, so a
    // ladder that answered wrong_slot first would say so here.
    expect(ITEMS[BOOTS_ITEM].slot).toBe('feet');
    expect(ENCHANTS[INFUSION].itemSlot).toBe('chest');

    expect(resolveApplyEnchant(sim.ctx, pid, BOOTS_ITEM, INFUSION).reason).toBe('not_perfected');
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, BOOTS_ITEM, INFUSION)?.reason).toBe(
      'not_perfected',
    );

    // The control that keeps the pin from passing over a dead gate: the SAME
    // boots copy against a chest enchant with no marker requirement really is
    // refused wrong_slot, on both twins.
    expect(resolveApplyEnchant(sim.ctx, pid, BOOTS_ITEM, APEX_CHEST).reason).toBe('wrong_slot');
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, BOOTS_ITEM, APEX_CHEST)?.reason).toBe(
      'wrong_slot',
    );
  });

  it('both earlier rungs answer BEFORE insufficient_skill, at both twins', () => {
    // The third pairwise ordering the ladder claims (docs on resolveApplyEnchant:
    // not_perfected, then wrong_slot, then insufficient_skill). The arm above
    // pins not_perfected against wrong_slot; this pins each of them against the
    // skill rung, which is armed here and answers in neither case.
    const { sim, pid, meta } = apexEnchanter(15);
    meta.craftSkills.enchanting = 99;
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.addItem(BOOTS_ITEM, 1, pid);
    // The premise both pins rest on: 99 really is under BOTH Lucent rungs, so a
    // ladder that answered the skill first would say insufficient_skill twice
    // below. (That 99 denies on skill alone is the next describe's arm.)
    expect(ENCHANTS[INFUSION].skillReq).toBe(125);
    expect(ENCHANTS[APEX_CHEST].skillReq).toBe(100);

    // An ORDINARY copy in the Infusion's own slot: the marker gate answers.
    expect(holdsPerfectedTarget(meta, CHEST_ITEM), 'an unstamped copy').toBe(false);
    expect(resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, INFUSION).reason).toBe('not_perfected');
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, CHEST_ITEM, INFUSION)?.reason).toBe(
      'not_perfected',
    );

    // A boots copy against the apex CHEST enchant: the slot gate answers.
    expect(resolveApplyEnchant(sim.ctx, pid, BOOTS_ITEM, APEX_CHEST).reason).toBe('wrong_slot');
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, BOOTS_ITEM, APEX_CHEST)?.reason).toBe(
      'wrong_slot',
    );

    // The control that keeps both of those from passing over a dead skill gate:
    // the same skill-99 fixture, aiming the apex chest enchant at a CHEST copy,
    // really is refused insufficient_skill.
    expect(resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, APEX_CHEST).reason).toBe(
      'insufficient_skill',
    );
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, CHEST_ITEM, APEX_CHEST)?.reason).toBe(
      'insufficient_skill',
    );
  });

  it('a hand-stamped Perfected copy APPLIES, spending exactly the authored bill', () => {
    // The accept direction (live since phase 12's Perfecting walk started
    // minting the stamp), and the proof that the guard reads the marker and
    // nothing else: the only difference from the refusing arm above is the
    // payload stamp.
    const { sim, pid, meta } = apexEnchanter(8);
    sim.addItemInstance(CHEST_ITEM, { perfected: true }, pid, 1);
    expect(holdsPerfectedTarget(meta, CHEST_ITEM)).toBe(true);

    sim.drainEvents();
    runApplyEnchant(sim, CHEST_ITEM, INFUSION, undefined, undefined, pid);

    const results = enchantResults(sim);
    expect(results).toHaveLength(1);
    expect(results[0].ok, 'the stamped copy is accepted').toBe(true);
    expect(results[0].enchantId).toBe(INFUSION);
    // EXACTLY the bill: three lucent reagents and two shards, leaving the
    // surplus untouched (the essence the fixture also carries is not part of
    // this enchant's bill and must not be taken).
    expect(sim.countItem(LUCENT, pid)).toBe(2);
    expect(sim.countItem(SHARD, pid)).toBe(2);
    expect(sim.countItem(ESSENCE, pid)).toBe(4);
    // The re-minted copy carries the enchant AND keeps its Perfected marker.
    const slot = meta.inventory.find((s) => s.itemId === CHEST_ITEM);
    expect(slot?.instance?.enchant).toBe(INFUSION);
    expect(slot?.instance?.perfected).toBe(true);
    expect(slot?.instance?.rolled?.stats).toEqual(ENCHANTS[INFUSION].statBonus);
    // ...and the same thing against a LOCAL literal, because the compare above
    // reads both sides from the same table: it proves the mint copied the def,
    // never what the def says. A retune of the Infusion's stat line has to be
    // deliberate enough to update this number too.
    expect(slot?.instance?.rolled?.stats).toEqual({ sta: 13 });
  });
});

describe('the Lucent skill gates bind at their exact rungs', () => {
  it('the Infusion: 124 refuses insufficient_skill, 125 applies (same Perfected copy)', () => {
    const under = apexEnchanter(9);
    under.meta.craftSkills.enchanting = 124;
    under.sim.addItemInstance(CHEST_ITEM, { perfected: true }, under.pid, 1);
    // The marker gate is already satisfied, which is what makes the SKILL the
    // thing under test here rather than a second not_perfected.
    expect(holdsPerfectedTarget(under.meta, CHEST_ITEM)).toBe(true);
    const denied = resolveApplyEnchant(under.sim.ctx, under.pid, CHEST_ITEM, INFUSION);
    expect(denied.reason).toBe('insufficient_skill');
    expect(
      evaluateApplyEnchantAdmission(under.sim.ctx, under.pid, CHEST_ITEM, INFUSION)?.reason,
    ).toBe('insufficient_skill');
    expect(under.sim.countItem(LUCENT, under.pid), 'a denial spends nothing').toBe(5);

    // One point higher, everything else identical: it goes through.
    const at = apexEnchanter(10);
    at.meta.craftSkills.enchanting = 125;
    at.sim.addItemInstance(CHEST_ITEM, { perfected: true }, at.pid, 1);
    expect(resolveApplyEnchant(at.sim.ctx, at.pid, CHEST_ITEM, INFUSION).ok).toBe(true);
    expect(ENCHANTS[INFUSION].skillReq).toBe(125);
  });

  it('the apex trio: 99 refuses insufficient_skill, 100 applies (no marker needed)', () => {
    const under = apexEnchanter(11);
    under.meta.craftSkills.enchanting = 99;
    under.sim.addItem(CHEST_ITEM, 1, under.pid);
    const denied = resolveApplyEnchant(under.sim.ctx, under.pid, CHEST_ITEM, APEX_CHEST);
    expect(denied.reason).toBe('insufficient_skill');
    expect(
      evaluateApplyEnchantAdmission(under.sim.ctx, under.pid, CHEST_ITEM, APEX_CHEST)?.reason,
    ).toBe('insufficient_skill');
    expect(under.sim.countItem(LUCENT, under.pid), 'a denial spends nothing').toBe(5);

    const at = apexEnchanter(12);
    at.meta.craftSkills.enchanting = 100;
    at.sim.addItem(CHEST_ITEM, 1, at.pid);
    // An ORDINARY copy: the apex trio carries no requiresPerfected, so the one
    // rung that matters for them is the skill.
    expect(holdsPerfectedTarget(at.meta, CHEST_ITEM)).toBe(false);
    expect(resolveApplyEnchant(at.sim.ctx, at.pid, CHEST_ITEM, APEX_CHEST).ok).toBe(true);
    expect(ENCHANTS[APEX_CHEST].skillReq).toBe(100);
  });
});

describe('every Lucent denial is draw-free', () => {
  it('zero rng draws on each refusal, behind a positive control that really counts', () => {
    // The positive control FIRST, through the identical observer wiring: a
    // disenchant draws its yield, so a broken observer would fail here instead
    // of quietly reporting zero for everything below.
    const control = apexEnchanter(13);
    control.sim.addItem(DRAWING_ITEM, 1, control.pid);
    const controlDraws = drawsDuring(control.sim, () => {
      runDisenchant(control.sim, DRAWING_ITEM, control.pid);
    });
    expect(controlDraws, 'the observer sees a drawing path').toBeGreaterThan(0);

    const { sim, pid, meta } = apexEnchanter(14);
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.addItem(BOOTS_ITEM, 1, pid);
    const arms: [string, () => void][] = [
      ['not_perfected (resolve)', () => resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, INFUSION)],
      [
        'not_perfected (admission)',
        () => evaluateApplyEnchantAdmission(sim.ctx, pid, CHEST_ITEM, INFUSION),
      ],
      [
        'not_perfected over wrong_slot',
        () => resolveApplyEnchant(sim.ctx, pid, BOOTS_ITEM, INFUSION),
      ],
      ['wrong_slot', () => resolveApplyEnchant(sim.ctx, pid, BOOTS_ITEM, APEX_CHEST)],
      [
        'insufficient_skill',
        () => {
          meta.craftSkills.enchanting = 99;
          resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, APEX_CHEST);
          meta.craftSkills.enchanting = 125;
        },
      ],
      [
        'not_perfected (whole command)',
        () => runApplyEnchant(sim, CHEST_ITEM, INFUSION, undefined, undefined, pid),
      ],
    ];
    for (const [name, run] of arms) {
      expect(drawsDuring(sim, run), `${name} draws nothing`).toBe(0);
    }
  });
});
