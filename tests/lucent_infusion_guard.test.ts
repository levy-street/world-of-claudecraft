// The Masterwrought phase 10 Lucent Infusion guard: the one requiresPerfected
// enchant in the table, plus the skill gates the whole Lucent tier introduced.
//
// The claim this file exists to hold is a REFUSAL over the entire live
// catalog: nothing in the game mints ItemInstancePayload.perfected until phase
// 12, so holdsPerfectedTarget answers false for every copy a player can hold
// today, and the Infusion is therefore unreachable BY CONSTRUCTION rather than
// by being hidden from the picker. The sweep below drives every merged item id
// through the real grant path (a bagged copy is really held before the guard is
// read, so a refusal can never be confused with an absence), and the
// hand-stamped arm is the phase 12 flip direction: stamp the marker and the
// same call goes through, spending exactly the authored bill.
//
// The deny ladder's ORDER is pinned too (not_perfected before wrong_slot,
// insufficient_skill after it), at BOTH twins: the resolver and the cast-start
// admission mirror. Both twins are checked separately, because a gate present
// in one and missing in the other is exactly the shape that lets a refused
// enchant buy a cast bar. Every refusal arm is also checked for zero rng draws
// behind a positive control, so a mis-wired observer cannot make those zeros
// vacuous. The picker mirror (src/ui/enchant_apply_view.ts) is pinned in
// tests/enchant_apply_view.test.ts and deliberately not repeated here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import {
  evaluateApplyEnchantAdmission,
  holdsPerfectedTarget,
  resolveApplyEnchant,
} from '../src/sim/professions/enchanting';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { runApplyEnchant, runDisenchant } from './helpers/enchant_family_cast';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';
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

describe('holdsPerfectedTarget refuses the entire live catalog (nothing mints the marker yet)', () => {
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
    // 893 refusals above could all be a dead read.
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
    // different slot, which is what keeps a phase 12 slot move honest.
    expect(holdsPerfectedTarget(meta, CHEST_ITEM, 'feet'), 'a different slot').toBe(false);
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

  it('a hand-stamped Perfected copy APPLIES, spending exactly the authored bill', () => {
    // The phase 12 flip direction, and the proof that the guard reads the
    // marker and nothing else: the only difference from the refusing arm above
    // is the payload stamp.
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

// The MINT-SIDE tripwire. Every arm above proves the Infusion refuses what a
// player can hold; this proves the premise underneath them, that nothing in
// production can hand a player a Perfected copy in the first place. Without it
// the whole file rests on a claim no assertion makes: a single `perfected: true`
// added anywhere under src/ would quietly turn every refusal above into a
// statement about a marker the game now mints.
//
// PHASE 12 REMOVES THIS TEST, in the same change that mints the marker, and that
// change must also take the eqi wire-visibility decision: the public equipped
// wire deliberately drops `perfected` today (pinned by name in
// tests/snapshots.test.ts), so a worn Perfected copy is invisible to an online
// client and the Apply Enchant picker's worn arm would refuse it while the sim
// accepted it (src/ui/enchant_apply_view.ts copyMeetsPerfectedGate says the
// same). Widen the wire or accept the bags-only limit, deliberately.
describe('nothing in production mints the Perfected marker yet (phase 12 tripwire)', () => {
  // Written as an assignment shape rather than a bare identifier search, so the
  // deny-reason string 'not_perfected' and the def flag `requiresPerfected` (no
  // word boundary before `perfected` in either) are not swept up as mints, and
  // so the TYPE declaration `perfected?: true` in types.ts stays legal: the `?`
  // sits between the name and the colon and no write does.
  const MINT_PATTERNS: Array<[string, RegExp]> = [
    ['object-literal property', /\bperfected\s*:/],
    ['direct assignment', /\.perfected\s*=[^=]/],
    ['shorthand property', /\bperfected\s*[,}]/],
  ];

  /** Every mint-shaped line in one source, comments stripped first. */
  function mintSites(source: string): string[] {
    const hits: string[] = [];
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      // Line comments and doc-comment continuations. A `/* ... */` regex is
      // deliberately not used over a whole source tree: it misfires on string
      // and regex literals (the elixir_tooltip_view.test.ts note), while a
      // leading `*` or `//` is unambiguous line by line.
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
      if (MINT_PATTERNS.some(([, re]) => re.test(line))) hits.push(line);
    }
    return hits;
  }

  it('no src/ path stamps `perfected` on an instance payload', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const files = tsFilesUnder(root);
    // Floor near the real tree, and a nested path by name: src/ is genuinely
    // deep, so both together prove the walk recursed rather than reading one
    // level and passing over a much smaller surface.
    expect(files.length, 'the src walk found the real tree').toBeGreaterThanOrEqual(500);
    expect(files.map((f) => f.file)).toContain('sim/professions/enchanting.ts');

    const mints: string[] = [];
    const readers: string[] = [];
    for (const { file, full } of files) {
      const source = readFileSync(full, 'utf8');
      for (const line of mintSites(source)) mints.push(`${file}: ${line}`);
      if (/\.perfected\s*===/.test(source)) readers.push(file);
    }
    expect(
      mints,
      'a production path now mints ItemInstancePayload.perfected: if this is phase 12, ' +
        'delete this whole describe and take the eqi wire-visibility decision with it',
    ).toEqual([]);
    // Non-vacuity over the REAL corpus: the guard scans a tree that genuinely
    // talks about the marker, so an empty mint list is a refusal rather than a
    // scan that found no `perfected` at all. Both known readers are gates.
    expect(readers.sort()).toEqual(['sim/professions/enchanting.ts', 'ui/enchant_apply_view.ts']);
  });

  it('the detector really fires on a mint (positive control for every pattern)', () => {
    // One synthetic source per shape, so an over-narrowed regex cannot make the
    // sweep above pass by matching nothing at all.
    expect(mintSites('const payload = { perfected: true };')).toHaveLength(1);
    expect(mintSites('inst.perfected = true;')).toHaveLength(1);
    expect(mintSites('const out = { ...inst, perfected };')).toHaveLength(1);
    // And the three shapes that must NOT read as mints: the deny reason, the
    // def flag, the type declaration, and prose about any of them.
    expect(
      mintSites(
        [
          "  return { ok: false, reason: 'not_perfected' };",
          '  if (enchant.requiresPerfected) return false;',
          '  perfected?: true;',
          '  // perfected: true would be a mint, and this comment is not one',
          '   * `perfected`, minted by the phase 12 Perfecting stage',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reads the tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
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
