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
// the whole file rests on a claim no assertion makes: one line stamping the
// marker anywhere in the shipped trees would quietly turn every refusal above
// into a statement about a marker the game now mints.
//
// It is an OCCURRENCE ALLOWLIST, not a search for mint shapes, and that is the
// whole design. Enumerating the ways to write a mint is a losing game: the first
// version of this guard matched three shapes and a later count found eight more
// that walked straight past it (a bracket string `inst['perfected']`, a computed
// key `{ [KEY]: true }`, a template literal, Object.defineProperty, a
// comment-prefixed line, a colon that wrapped onto the next line, and so on).
// So the direction is inverted: collect EVERY occurrence of the identifier in
// the corpus and require each one to match a known-legal class. A mint written
// in any spelling, including one nobody has thought of, matches no class and
// fails with its line printed.
//
// PHASE 12 REMOVES THIS TEST, in the same change that mints the marker, and that
// change must also take the eqi wire-visibility decision: the public equipped
// wire deliberately drops `perfected` today (pinned by name in
// tests/snapshots.test.ts), so a worn Perfected copy is invisible to an online
// client and the Apply Enchant picker's worn arm would refuse it while the sim
// accepted it (src/ui/enchant_apply_view.ts copyMeetsPerfectedGate says the
// same). Widen the wire or accept the bags-only limit, deliberately.
describe('every `perfected` occurrence in the shipped trees is a READ, never a mint', () => {
  // The three trees that ship. server/ and headless/ carry no occurrence at all
  // today, and sweeping them anyway is the point: the marker reaching the
  // authoritative host or the RL env is exactly the drift worth catching early.
  const TREES = ['src', 'server', 'headless'] as const;

  // Machine-generated and translator-owned string tables are OUT, stated here
  // rather than silently filtered. They are regenerated from the catalog below
  // them, so no code path can live there, while the English prose word
  // "Perfected" appears in every Latin locale slice: including them would turn
  // this guard into a rename detector that churns on every i18n:gen. The
  // hand-authored catalog itself stays IN, covered by the prose class.
  const EXCLUDED_PREFIXES = ['ui/i18n.resolved.generated/', 'ui/i18n.locales/'];

  /** One legal way the identifier may appear, with the floor proving it was
   *  really seen. A floor of 0 marks a class that may legitimately empty out
   *  (prose gets reworded); every load-bearing class carries a real floor. */
  interface LegalClass {
    name: string;
    floor: number;
    matches: (line: string, file: string) => boolean;
  }

  // Ordered: the first matching class wins, so a line carrying two legal forms
  // is counted once. Every class is a READ, a DECLARATION, or player copy.
  // Nothing here can write the marker onto an instance.
  const LEGAL_CLASSES: LegalClass[] = [
    {
      name: 'the ItemInstancePayload declaration',
      floor: 1,
      matches: (line) => /^perfected\?: true;$/.test(line),
    },
    {
      name: 'the EnchantDef requiresPerfected declaration',
      floor: 1,
      matches: (line) => /^requiresPerfected\?: true;$/.test(line),
    },
    {
      name: 'the authored requiresPerfected def flag',
      floor: 1,
      matches: (line) => /^requiresPerfected: true,$/.test(line),
    },
    {
      name: 'a requiresPerfected def read',
      floor: 1,
      matches: (line) => /\.requiresPerfected\b/.test(line),
    },
    {
      name: 'a guard READ of the marker (=== true)',
      floor: 1,
      matches: (line) => /\?\.perfected === true/.test(line),
    },
    {
      name: 'the guard functions, declared or called',
      floor: 1,
      matches: (line) => /\b(holdsPerfectedTarget|copyMeetsPerfectedGate)\b/.test(line),
    },
    {
      name: "the 'not_perfected' deny reason",
      floor: 1,
      matches: (line) => /'not_perfected'/.test(line),
    },
    {
      name: 'the notPerfected toast key',
      floor: 1,
      matches: (line) => /\bnotPerfected\b/.test(line),
    },
    {
      name: 'player prose in a hand-authored i18n catalog',
      floor: 0,
      matches: (line, file) => file.startsWith('ui/i18n.catalog/') && /Perfected/.test(line),
    },
  ];

  /** Every line of `source` carrying the identifier in any case, comments
   *  stripped, trimmed. A `/* ... *\/` regex is deliberately not used over whole
   *  source trees (it misfires on string and regex literals); a leading `//`,
   *  `*` or `/*` is unambiguous line by line, and a mint is never written on a
   *  line that starts with one. */
  function occurrences(source: string): string[] {
    const hits: string[] = [];
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
      if (/perfected/i.test(line)) hits.push(line);
    }
    return hits;
  }

  /** The legal class for one occurrence, or undefined when nothing covers it. */
  function classify(line: string, file: string): string | undefined {
    return LEGAL_CLASSES.find((c) => c.matches(line, file))?.name;
  }

  it('classifies every occurrence, and an unclassified one is a mint', () => {
    const unclassified: string[] = [];
    const seen = new Map<string, number>();
    let files = 0;
    let sawNestedPath = false;
    for (const tree of TREES) {
      const root = fileURLToPath(new URL(`../${tree}`, import.meta.url));
      for (const { file, full } of tsFilesUnder(root)) {
        if (EXCLUDED_PREFIXES.some((p) => file.startsWith(p))) continue;
        files += 1;
        if (file === 'sim/professions/enchanting.ts') sawNestedPath = true;
        for (const line of occurrences(readFileSync(full, 'utf8'))) {
          const cls = classify(line, file);
          if (!cls) unclassified.push(`${tree}/${file}: ${line}`);
          else seen.set(cls, (seen.get(cls) ?? 0) + 1);
        }
      }
    }
    // The walk really covered the deep trees, not one flat level of each.
    expect(files, 'the three-tree walk found the real corpus').toBeGreaterThanOrEqual(600);
    expect(sawNestedPath, 'the walk recursed into src/sim/professions').toBe(true);

    expect(
      unclassified,
      'an occurrence of `perfected` matches no legal READ class, which is what a MINT looks ' +
        'like. If this is phase 12, delete this whole describe and take the eqi ' +
        'wire-visibility decision with it (tests/snapshots.test.ts pins the exclusion).',
    ).toEqual([]);

    // Per-class floors: the classification above is only meaningful if the scan
    // actually met each class in the live tree. Without these an import that
    // resolved to nothing, or an over-broad class that swallowed everything,
    // would report zero unclassified lines and pass.
    for (const legal of LEGAL_CLASSES) {
      expect(
        seen.get(legal.name) ?? 0,
        `class "${legal.name}" was never seen`,
      ).toBeGreaterThanOrEqual(legal.floor);
    }
  });

  it('an unclassified mint fails in every spelling (positive controls)', () => {
    // Each of these is a real way to stamp the field. None matches a legal
    // class, so each must come back unclassified. The bracket string, the
    // computed key and defineProperty are the three the previous mint-shape
    // version of this guard walked straight past.
    const MINTS = [
      'const payload = { perfected: true };',
      'inst.perfected = true;',
      "inst['perfected'] = true;",
      'const out = { ...inst, perfected };',
      "Object.defineProperty(inst, 'perfected', { value: true });",
      "const KEY = 'perfected';",
      'const out = { [PERFECTED_KEY]: true, perfected: true };',
      'payload.perfected ??= true;',
      'inst[`perfected`] = true;',
    ];
    for (const mint of MINTS) {
      expect(classify(mint, 'sim/professions/perfecting.ts'), mint).toBeUndefined();
      expect(occurrences(mint), mint).toEqual([mint]);
    }
  });

  it('the legal forms really are classified (negative controls)', () => {
    const LEGAL: Array<[string, string]> = [
      ['perfected?: true;', 'sim/types.ts'],
      ['requiresPerfected?: true;', 'sim/content/enchants.ts'],
      ['requiresPerfected: true,', 'sim/content/enchants.ts'],
      ['return !enchant.requiresPerfected || instance?.perfected === true;', 'ui/x.ts'],
      ["return { ok: false, reason: 'not_perfected' };", 'sim/professions/enchanting.ts'],
      ["return { key: 'hudChrome.enchanting.notPerfected', sink: 'error' };", 'ui/x.ts'],
      ['takes hold only on a piece that has been Perfected.', 'ui/i18n.catalog/guide.ts'],
    ];
    for (const [line, file] of LEGAL) expect(classify(line, file), line).toBeDefined();
    // The prose class is PATH-SCOPED: the same sentence in a code file is not
    // covered by it, so a mint cannot hide behind prose-looking text.
    expect(
      classify('takes hold only on a piece that has been Perfected.', 'sim/professions/x.ts'),
    ).toBeUndefined();
    // Comment lines are stripped before classification, so prose about a mint
    // is never itself reported as one.
    expect(occurrences('  // perfected: true would be a mint, and this is not one')).toEqual([]);
    expect(occurrences('   * `perfected`, minted by the phase 12 Perfecting stage')).toEqual([]);
  });

  it('reads the trees only through the shared walker', () => {
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
