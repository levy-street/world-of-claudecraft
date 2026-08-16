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
// The deny ladder's ORDER is pinned too, all three pairwise ways
// (not_perfected before wrong_slot, and each of those before
// insufficient_skill), at BOTH twins: the resolver and the cast-start
// admission mirror. Both twins are checked separately, because a gate present
// in one and missing in the other is exactly the shape that lets a refused
// enchant buy a cast bar. Every refusal arm is also checked for zero rng draws
// behind a positive control, so a mis-wired observer cannot make those zeros
// vacuous. The picker mirror (src/ui/enchant_apply_view.ts) is pinned in
// tests/enchant_apply_view.test.ts and deliberately not repeated here.
import { readFileSync } from 'node:fs';
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
// in any spelling THAT NAMES THE FIELD (or brackets a key spelled from an
// identifier that starts with it) matches no class and fails with its line
// printed. What it cannot see, and says so: a key assembled at runtime from
// string parts, or a key literal that lives outside the scanned trees (a JSON
// asset, a tests/ fixture); those are the boundary of any source-text guard.
//
// PHASE 12 REMOVES THIS TEST, in the same change that mints the marker, and that
// change must also take the eqi wire-visibility decision: the public equipped
// wire deliberately drops `perfected` today (pinned by name in
// tests/snapshots.test.ts), so a worn Perfected copy is invisible on that wire.
// The Apply Enchant picker's worn arm reads exactly that mirror right now
// (src/ui/bag_item_action_menu.ts hands it Entity.equippedInstances), so online
// it would hide a worn Perfected copy the sim accepts.
//
// That is a choice of THREE, not the two copyMeetsPerfectedGate names: the
// picker's worn arm can instead read IWorld.equipmentInstances, which carries
// meta.equipmentInstance WHOLE in both hosts (the offline Sim getter, and the
// self `einst` key online, server/game.ts). Only an INSPECTING viewer rides the
// trimmed eqi peer mirror, so the picker can see the marker without eqi moving
// at all, and what eqi actually decides is what a viewer may learn about
// SOMEONE ELSE'S Perfected state.
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
      // The FIELD is exactly `perfected`; an identifier that merely begins with
      // the word (perfectedMet, perfectedCandidateExists, perfectedOnly on the
      // picker and the guide) is a different name, the same argument the two
      // capital-P families rest on. Safe as a shape rather than a name list
      // because nothing here decides a line on its own: a write still vetoes
      // first, and the residue rule below still demands that every EXACT
      // `perfected` token on the line be a legal read. Floor 0: it describes a
      // naming shape, and the identifiers that populate it today belong to the
      // picker's view core, which may rename them without touching this guard.
      name: 'an identifier that only begins with the word (not the field)',
      floor: 0,
      matches: (line) => /(?:^|[^\w])perfected[\w$]+/.test(line),
    },
    {
      name: 'player prose in a hand-authored i18n catalog',
      floor: 0,
      matches: (line, file) => file.startsWith('ui/i18n.catalog/') && /Perfected/.test(line),
    },
  ];

  /** The CODE half of one line: a trailing `//` comment cut off, and any
   *  block comment (`/*` through its terminator) removed, so nothing a comment
   *  says can decide a classification. Quote-aware, because a `//` inside a
   *  string literal is code and truncating there would hide the rest of the
   *  line.
   *
   *  Both halves matter, and each was a live escape. Comment text that
   *  PARTICIPATES lends a mint a legal token to be classified by
   *  (`inst.perfected = true; // notPerfected` read as the toast key), and a
   *  line DROPPED for opening a block comment takes its code with it
   *  (`/* phase 12 *\/ inst.perfected = true;` never reached the classifier at
   *  all). Line by line and quote-aware is the honest middle: a `/* ... *\/`
   *  regex over a whole source tree misfires on string and regex literals. */
  function codeOf(raw: string): string {
    let out = '';
    let quote: string | null = null;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quote) {
        out += ch;
        if (ch === '\\') {
          out += raw[i + 1] ?? '';
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        out += ch;
        continue;
      }
      if (ch === '/' && raw[i + 1] === '/') break;
      if (ch === '/' && raw[i + 1] === '*') {
        const end = raw.indexOf('*/', i + 2);
        // An opener with no terminator on this line: everything after it is
        // comment, and a continuation line is dropped whole by occurrences.
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      out += ch;
    }
    return out.trim();
  }

  /** Every line of `source` whose CODE half carries the identifier in any case,
   *  trimmed. A block-comment CONTINUATION (a line starting with `*`) is the one
   *  line shape that carries no code at all, so it is dropped whole; every other
   *  line goes through codeOf, which strips whatever comment it does carry. */
  function occurrences(source: string): string[] {
    const hits: string[] = [];
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      // Cheap pre-filter: stripping comments only ever REMOVES the identifier,
      // never introduces one, so a line without it needs no character scan.
      if (!/perfected/i.test(line)) continue;
      if (line.startsWith('*')) continue;
      const code = codeOf(line);
      if (/perfected/i.test(code)) hits.push(code);
    }
    return hits;
  }

  /** A WRITE of the marker field, in any spelling, anywhere on the line.
   *
   *  This runs BEFORE class matching and vetoes it, because classification is
   *  per LINE and first-match-wins: without the veto a mint that SHARES a line
   *  with a legal read is classified by the read and passes. That is not
   *  hypothetical, it is how the previous version of this guard was defeated:
   *  `if (enchant.requiresPerfected) inst.perfected = true;` matched the
   *  def-read class and went green.
   *
   *  The arms are STRUCTURAL, not a list of spellings: the field bound by a
   *  colon to ANY value, the field on the left of ANY assignment (plain or
   *  compound), the shorthand property forms, and the one write that names the
   *  field only as an argument. Enumerating values (`: true` alone) or
   *  operators (`=` and `??=` alone) is the losing game this file's header
   *  describes: `perfected: flag`, `||=` and `&&=` all walked past that.
   *
   *  Case-SENSITIVE on the lowercase field name, which is what makes the two
   *  declaration families legal WITHOUT a path-scoped carve-out:
   *   - `requiresPerfected?: true` / `requiresPerfected: true` spell a capital
   *     P, so they are a different identifier and never match here at all;
   *   - `perfected?: true` (the payload declaration) puts a `?` between the
   *     name and the colon, which none of the write shapes admit.
   *  Deriving the exemption structurally rather than by file path is the
   *  stronger option: a real mint added INSIDE types.ts or enchants.ts is still
   *  caught, where a path carve-out would have waved it through.
   *
   *  `=(?!=)` is what keeps the guard READ (`?.perfected === true`) legal while
   *  catching the assignment; the preceding `[^\w]` keeps `not_perfected` from
   *  reading as a write to the field. */
  const WRITE_SHAPES: RegExp[] = [
    // A colon binding of ANY value: `{ perfected: true }`, `{ perfected: flag }`,
    // `{ 'perfected': x }`. Never the `perfected?:` declaration (the `?`).
    /(?:^|[^\w])perfected["'`\]]*\s*:/,
    // Assignment, plain or compound: `=`, `||=`, `&&=`, `??=`, including the
    // bracket-string and template spellings. `==` / `===` stay reads.
    /(?:^|[^\w])perfected["'`\]]*\s*(?:\|\||&&|\?\?)?=(?!=)/,
    // Shorthand property: `{ perfected }`, `{ perfected,`, `, perfected }`,
    // `, perfected,`, and the same token alone on its own wrapped line.
    /(?:^|[{,])\s*perfected\s*(?:[,}]|$)/,
    // A COMPUTED key spelled from an identifier that starts with the field
    // (`inst[perfectedKey] = true`, `{ [perfectedKey]: true }`): the prefixed-
    // identifier legal class exists for the picker's `perfectedMet` family, and
    // a bracketed one is how that class would otherwise become a hiding place.
    // The key's own definition line (`const perfectedKey = 'perfected'`) is a
    // residue hit as well, while it lives in a scanned tree. This arm vetoes
    // ON PURPOSE a legitimate bracketed key spelled from any perfected-prefixed
    // identifier, UI code included (`cache[perfectedMetKey] = row.perfectedMet`
    // reads as a mint here): the remedy is to name such a key from a different
    // stem, never to teach this guard a new legal class.
    /\[\s*perfected[\w$]*\s*\]\s*(?:\|\||&&|\?\?)?=(?!=)/,
    /\[\s*perfected[\w$]*\s*\]\s*:/,
    // The one write that names the field only as an argument.
    /defineProperty\([^)]*["'`]perfected["'`]/,
  ];

  function writesTheMarker(line: string): boolean {
    return WRITE_SHAPES.some((re) => re.test(line));
  }

  /** Every legal READ spelling, each one the thing some LEGAL_CLASSES entry is
   *  about, removed from a line before the residue check below. */
  const LEGAL_READS: RegExp[] = [
    /\??\.perfected\s*===\s*true/g,
    /perfected\?:\s*true;?/g,
    /not_perfected/g,
    /notPerfected/g,
    /requiresPerfected/g,
    /holdsPerfectedTarget|copyMeetsPerfectedGate/g,
  ];

  /** Is there still a `perfected` token on the line once every legal read is
   *  removed? That residue is the general case the veto arms above are only
   *  the named instances of: a line may match a legal class on one token and
   *  carry a SECOND, unexplained one (`if (enchant.requiresPerfected)
   *  stamp(inst, perfected);` classified as a def read), and no list of write
   *  shapes can be relied on to have foreseen the spelling.
   *
   *  Case-sensitive on the lowercase field, so the capitalized prose noun
   *  ("a piece that has been Perfected") is not residue. The English catalog
   *  spells the game term that way throughout; a reword to a lowercase
   *  `perfected` fails here on purpose, with the line printed, rather than
   *  quietly widening what this guard lets past. */
  function residualMarkerToken(line: string): boolean {
    let rest = line;
    for (const re of LEGAL_READS) rest = rest.replace(re, ' ');
    // Token-EXACT on both sides: `perfectedMet` and `perfectedCandidateExists`
    // are other identifiers (see the class above), and only a bare `perfected`
    // can be the field a mint writes.
    return /(?:^|[^\w])perfected(?![\w$])/.test(rest);
  }

  /** The legal class for one occurrence, or undefined when nothing covers it,
   *  INCLUDING when a write shares the line with something that would, and
   *  when a class matched but the line carries a marker token that class does
   *  not account for. */
  function classify(line: string, file: string): string | undefined {
    if (writesTheMarker(line)) return undefined;
    const cls = LEGAL_CLASSES.find((c) => c.matches(line, file))?.name;
    if (!cls) return undefined;
    if (residualMarkerToken(line)) return undefined;
    return cls;
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
        'wire-visibility decision with it (tests/snapshots.test.ts pins the exclusion). ' +
        'If it is a bracketed key spelled from a perfected-prefixed identifier ' +
        '(`cache[perfectedMetKey] = ...`), the veto is deliberate: rename the key from ' +
        'a different stem rather than widening a legal class.',
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

  it('an unclassified mint fails in every spelling that names the field (positive controls)', () => {
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
      // The SHARED-LINE family, one entry per veto arm: a mint riding along
      // with something that classifies as legal. Every one of these went green
      // against a guard that enumerated write SHAPES (`=`, `??=`, `: true`)
      // and stopped at the first legal class the line matched.
      // Assignment, plain and in each compound spelling:
      'if (enchant.requiresPerfected) inst.perfected = true;',
      'if (holdsPerfectedTarget(meta, itemId)) inst.perfected = true;',
      'if (enchant.requiresPerfected) inst.perfected ||= true;',
      'if (enchant.requiresPerfected) inst.perfected &&= true;',
      'if (enchant.requiresPerfected) inst.perfected ??= true;',
      // A colon binding whose VALUE is anything but the literal true:
      'const next = { ...inst, perfected: enchant.requiresPerfected };',
      'if (holdsPerfectedTarget(meta, id)) slot.instance = { ...inst, perfected: flag };',
      "const next = { ...inst, perfected: flag && !!'not_perfected' };",
      // The shorthand property, beside a legal call:
      'if (holdsPerfectedTarget(meta, id)) Object.assign(inst, { perfected });',
      // defineProperty, beside a legal def read:
      "if (enchant.requiresPerfected) Object.defineProperty(inst, 'perfected', { value: true });",
      // Beside a `perfected`-prefixed identifier, so the newest legal class is
      // no more a hiding place than the older ones:
      'if (row.perfectedOnly) inst.perfected = true;',
      'const out = { perfectedMet, perfected };',
      // The RESIDUE arm: no write shape matches this line at all and it does
      // match a legal class, but it carries a SECOND marker token nothing legal
      // explains. The named shapes above are only instances of that.
      'if (enchant.requiresPerfected) stamp(inst, perfected);',
      // A key spelled from a `perfected`-prefixed identifier and bracketed in:
      // the newest legal class must not license the write it names.
      'inst[perfectedKey] = true;',
      'inst[perfectedField] ??= true;',
      'Object.assign(inst, { [perfectedKey]: true });',
      "const perfectedKey = 'perfected';",
    ];
    for (const mint of MINTS) {
      expect(classify(mint, 'sim/professions/perfecting.ts'), mint).toBeUndefined();
      expect(occurrences(mint), mint).toEqual([mint]);
    }
  });

  it('each veto ARM is pinned on its own, apart from the residue rule', () => {
    // Pinned directly, not only through classify, and in its OWN case: the
    // residue rule catches every line below on its own, so without this block
    // an arm could be deleted with the whole file still green, and the guard
    // would be one general net where it reads as two layers. Its own it() so a
    // red here is never hidden behind the positive-controls loop above.
    for (const write of [
      'inst.perfected = true;',
      'inst.perfected ||= true;',
      'inst.perfected &&= true;',
      'inst.perfected ??= true;',
      "inst['perfected'] = flag;",
      'const next = { ...inst, perfected: flag };',
      "const next = { ...inst, 'perfected': flag };",
      'Object.assign(inst, { perfected });',
      'const out = { ...inst, perfected };',
      'const out = { ...inst, perfected, enchant };',
      'perfected,',
      "Object.defineProperty(inst, 'perfected', { value: true });",
      'inst[perfectedKey] = true;',
      'inst[perfectedField] ??= true;',
      'const out = { [perfectedKey]: true };',
    ]) {
      expect(writesTheMarker(write), `${write} is a write of the marker`).toBe(true);
    }

    // ...and the residue arm really is the residue rule doing the work: no
    // write shape fires on it, and a legal class DOES match it, so without the
    // residue check it would have classified as a requiresPerfected def read.
    const residueOnly = 'if (enchant.requiresPerfected) stamp(inst, perfected);';
    expect(writesTheMarker(residueOnly), 'no write shape matches the residue arm').toBe(false);
    expect(
      LEGAL_CLASSES.some((c) => c.matches(residueOnly, 'sim/professions/perfecting.ts')),
      'the residue arm matches a legal class, and is a mint anyway',
    ).toBe(true);

    // The COMMENT-HIDDEN family: classification reads the CODE half, so a mint
    // can neither borrow a legal token from a trailing comment nor vanish
    // because a block comment opened its line (both were live escapes: the
    // trailing text participated, and a `/* ... */` opener dropped the whole
    // line). Each pair is the source line and the code half it must reduce to.
    const HIDDEN: Array<[string, string]> = [
      ['inst.perfected = true; // notPerfected, unlike this line', 'inst.perfected = true;'],
      ["inst.perfected = true; // the 'not_perfected' deny", 'inst.perfected = true;'],
      ['/* phase 12 */ inst.perfected = true;', 'inst.perfected = true;'],
      [
        'if (holdsPerfectedTarget(meta, id)) inst.perfected = flag; // requiresPerfected',
        'if (holdsPerfectedTarget(meta, id)) inst.perfected = flag;',
      ],
    ];
    for (const [raw, code] of HIDDEN) {
      expect(occurrences(raw), raw).toEqual([code]);
      expect(classify(code, 'sim/professions/perfecting.ts'), raw).toBeUndefined();
    }
  });

  it('the legal forms really are classified (negative controls)', () => {
    const LEGAL: Array<[string, string]> = [
      ['perfected?: true;', 'sim/types.ts'],
      ['requiresPerfected?: true;', 'sim/content/enchants.ts'],
      ['requiresPerfected: true,', 'sim/content/enchants.ts'],
      ['return !enchant.requiresPerfected || instance?.perfected === true;', 'ui/x.ts'],
      [
        'return meta.equipment[slot] === itemId && meta.equipmentInstance?.[slot]?.perfected === true;',
        'sim/professions/enchanting.ts',
      ],
      ["return { ok: false, reason: 'not_perfected' };", 'sim/professions/enchanting.ts'],
      ["return { key: 'hudChrome.enchanting.notPerfected', sink: 'error' };", 'ui/x.ts'],
      ['takes hold only on a piece that has been Perfected.', 'ui/i18n.catalog/guide.ts'],
      ['perfectedMet: boolean;', 'ui/enchant_apply_view.ts'],
      [
        'perfectedMet: perfectedCandidateExists(enchant, inventory, viewer),',
        'ui/enchant_apply_view.ts',
      ],
      ['function perfectedCandidateExists(', 'ui/enchant_apply_view.ts'],
      ['row.perfectedOnly', 'guide/pages/professions_craft.ts'],
    ];
    for (const [line, file] of LEGAL) expect(classify(line, file), line).toBeDefined();
    // The write veto must not swallow the two DECLARATION families, which is
    // what lets it run without a path-scoped carve-out. Asserted against the
    // veto directly, not just through classify, so a future widening of the
    // write shapes fails here rather than silently reclassifying a declaration.
    for (const decl of [
      'perfected?: true;',
      'requiresPerfected?: true;',
      'requiresPerfected: true,',
    ]) {
      expect(writesTheMarker(decl), `${decl} is a declaration, not a write`).toBe(false);
    }
    // ...and the guard READ stays a read: `===` must not read as `=`.
    expect(writesTheMarker('return instance?.perfected === true;')).toBe(false);
    // The deny reason is not a write to the field either (the `[^\w]` guard).
    expect(writesTheMarker("return { ok: false, reason: 'not_perfected' };")).toBe(false);
    // The prose class is PATH-SCOPED: the same sentence in a code file is not
    // covered by it, so a mint cannot hide behind prose-looking text.
    expect(
      classify('takes hold only on a piece that has been Perfected.', 'sim/professions/x.ts'),
    ).toBeUndefined();
    // Comment text is stripped before classification, so prose about a mint is
    // never itself reported as one, whichever comment shape carries it.
    expect(occurrences('  // perfected: true would be a mint, and this is not one')).toEqual([]);
    expect(occurrences('   * `perfected`, minted by the phase 12 Perfecting stage')).toEqual([]);
    expect(occurrences('const ok = true; // perfected: true would be a mint')).toEqual([]);
    expect(occurrences('/* perfected: true would be a mint */')).toEqual([]);
    // ...and the strip is quote-aware, so a `//` inside a string literal is
    // code: truncating there would hide whatever the rest of the line does.
    expect(occurrences("const doc = 'https://example.test/perfected';")).toEqual([
      "const doc = 'https://example.test/perfected';",
    ]);
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
