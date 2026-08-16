// The shared death/respawn leaf module (src/sim/resurrection.ts): the two level-scaled
// sickness durations (Resurrection Sickness, aka "The Keeper's Toll", and the shorter
// Unstuck Sickness) and the "which auras survive death" predicate, shared by every player
// death/respawn site so the rule cannot drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation';
import {
  aurasSurvivingCleanSlate,
  aurasSurvivingDeath,
  RES_SICKNESS_DURATION,
  RES_SICKNESS_MIN_DURATION,
  RES_SICKNESS_MIN_LEVEL,
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  resSicknessDuration,
  UNSTUCK_SICKNESS_DURATION,
  UNSTUCK_SICKNESS_ID,
  UNSTUCK_SICKNESS_MIN_DURATION,
  UNSTUCK_SICKNESS_MIN_LEVEL,
  UNSTUCK_SICKNESS_STAT_MULT,
  unstuckSicknessDuration,
} from '../src/sim/resurrection';
import { type Aura, MAX_LEVEL } from '../src/sim/types';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// A minimal valid Aura carrying an id; the predicate reads only `id`, the rest satisfies
// the type.
function aura(id: string): Aura {
  return {
    id,
    name: id,
    kind: 'buff_allstats_pct',
    remaining: 10,
    duration: 10,
    value: -0.75,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('resurrection: level-scaled sickness duration', () => {
  it('is zero below the minimum level (classic exemption)', () => {
    expect(resSicknessDuration(1)).toBe(0);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL - 1)).toBe(0);
  });

  it('is exactly the minimum duration at the minimum level', () => {
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL)).toBe(RES_SICKNESS_MIN_DURATION);
  });

  it('is the full duration at max level', () => {
    expect(resSicknessDuration(MAX_LEVEL)).toBe(RES_SICKNESS_DURATION);
  });

  it('scales linearly and monotonically between the bounds', () => {
    const mid = (RES_SICKNESS_MIN_LEVEL + MAX_LEVEL) / 2;
    const expected = Math.round(
      RES_SICKNESS_MIN_DURATION + 0.5 * (RES_SICKNESS_DURATION - RES_SICKNESS_MIN_DURATION),
    );
    expect(resSicknessDuration(mid)).toBe(expected);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL + 1)).toBeGreaterThan(
      RES_SICKNESS_MIN_DURATION,
    );
    expect(resSicknessDuration(MAX_LEVEL - 1)).toBeLessThan(RES_SICKNESS_DURATION);
  });
});

describe('unstuck: level-scaled sickness duration', () => {
  it('is zero below the minimum level (the same classic exemption)', () => {
    expect(unstuckSicknessDuration(1)).toBe(0);
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL - 1)).toBe(0);
  });

  it('is exactly the minimum duration at the minimum level', () => {
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)).toBe(UNSTUCK_SICKNESS_MIN_DURATION);
  });

  it('tops out at five minutes, half the Pale Keeper ceiling', () => {
    expect(UNSTUCK_SICKNESS_DURATION).toBe(300);
    expect(UNSTUCK_SICKNESS_DURATION).toBe(RES_SICKNESS_DURATION / 2);
    expect(unstuckSicknessDuration(MAX_LEVEL)).toBe(UNSTUCK_SICKNESS_DURATION);
  });

  it('scales linearly and monotonically between the bounds', () => {
    const mid = (UNSTUCK_SICKNESS_MIN_LEVEL + MAX_LEVEL) / 2;
    expect(unstuckSicknessDuration(mid)).toBe(
      Math.round(
        UNSTUCK_SICKNESS_MIN_DURATION +
          0.5 * (UNSTUCK_SICKNESS_DURATION - UNSTUCK_SICKNESS_MIN_DURATION),
      ),
    );
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1)).toBeGreaterThan(
      UNSTUCK_SICKNESS_MIN_DURATION,
    );
    expect(unstuckSicknessDuration(MAX_LEVEL - 1)).toBeLessThan(UNSTUCK_SICKNESS_DURATION);
  });

  it('is strictly shorter than The Keeper’s Toll above the minimum level, and weighs the same', () => {
    expect(unstuckSicknessDuration(MAX_LEVEL)).toBeLessThan(resSicknessDuration(MAX_LEVEL));
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1)).toBeLessThan(
      resSicknessDuration(RES_SICKNESS_MIN_LEVEL + 1),
    );
    expect(UNSTUCK_SICKNESS_STAT_MULT).toBe(RES_SICKNESS_STAT_MULT);
    expect(UNSTUCK_SICKNESS_ID).not.toBe(RESURRECTION_SICKNESS_ID);
  });
});

describe('resurrection: aurasSurvivingDeath predicate', () => {
  it('keeps only Resurrection Sickness and drops every other aura', () => {
    const auras = [aura('rejuvenation'), aura(RESURRECTION_SICKNESS_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(RESURRECTION_SICKNESS_ID);
  });

  it('keeps Unstuck Sickness too, so dying cannot shed it', () => {
    const auras = [aura('rejuvenation'), aura(UNSTUCK_SICKNESS_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(UNSTUCK_SICKNESS_ID);
  });

  it('keeps encounter-owned unbreakable control until its script releases it', () => {
    const scriptedStun = { ...aura('scripted_stun'), unbreakableControl: true } as const;

    expect(aurasSurvivingDeath([aura('rejuvenation'), scriptedStun])).toEqual([scriptedStun]);
  });

  it('keeps a FLASK-marked aura, the fourth surviving class', () => {
    // Masterwrought phase 10. The predicate has four classes, not three, and
    // this one is keyed on Aura.flask rather than on an id or a kind: a flask
    // is bought to survive a wipe. The decoy is the point: the SAME id and kind
    // without the marker dies, so the filter cannot be reading the family.
    const marked = { ...aura('elixir_buff_sta'), flask: true } as const;
    const unmarked = aura('elixir_buff_sta');

    expect(aurasSurvivingDeath([aura('rejuvenation'), marked, unmarked])).toEqual([marked]);
  });

  it('returns an empty list when nothing survives', () => {
    expect(aurasSurvivingDeath([aura('rejuvenation')])).toEqual([]);
    expect(aurasSurvivingDeath([])).toEqual([]);
  });

  it('does not mutate the input array (immutable filter)', () => {
    const auras = [aura(RESURRECTION_SICKNESS_ID), aura('rejuvenation')];
    aurasSurvivingDeath(auras);
    expect(auras).toHaveLength(2);
  });

  it('keeps the operator-applied Cheater mark, so dying cannot serve a sanction', () => {
    // The mark's aura IS its played-seconds countdown, so dropping it here would
    // both end the sanction early and hand a marked player a one-keypress way out.
    const auras = [aura('rejuvenation'), aura(CHEATER_MARK_AURA_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(CHEATER_MARK_AURA_ID);
  });
});

describe('resurrection: aurasSurvivingCleanSlate predicate', () => {
  it('keeps ONLY the Cheater mark, sicknesses and flasks included in the wipe', () => {
    // Arena entry and a Fiesta down strip more than a death does: a normalized
    // bout is decided by play, so even The Keeper's Toll goes. The sanction is
    // not something the fighter walked in carrying, so it stays. The flask
    // decoy pins the composed rule minted at the v0.38.0 merge: a flask
    // survives DEATH (the arm above) but never a clean-slate wipe, so nothing
    // carried in from the world rides into a ranked bout.
    const flask = { ...aura('elixir_buff_sta'), flask: true } as const;
    const auras = [
      aura(RESURRECTION_SICKNESS_ID),
      aura(UNSTUCK_SICKNESS_ID),
      aura('rejuvenation'),
      flask,
      aura(CHEATER_MARK_AURA_ID),
    ];
    const survivors = aurasSurvivingCleanSlate(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(CHEATER_MARK_AURA_ID);
  });

  it('drops encounter-owned unbreakable control too (a clean slate is cleaner)', () => {
    const scriptedStun = { ...aura('scripted_stun'), unbreakableControl: true } as const;
    expect(aurasSurvivingCleanSlate([scriptedStun])).toEqual([]);
  });

  it('returns an empty list when nothing survives', () => {
    expect(aurasSurvivingCleanSlate([aura('rejuvenation')])).toEqual([]);
    expect(aurasSurvivingCleanSlate([])).toEqual([]);
  });

  it('does not mutate the input array (immutable filter)', () => {
    const auras = [aura(CHEATER_MARK_AURA_ID), aura('rejuvenation')];
    aurasSurvivingCleanSlate(auras);
    expect(auras).toHaveLength(2);
  });
});

// The PvP half of the flask decision, which until now lived only in the
// resurrection.ts header comment, pinned as WHICH modules reach the clean slate,
// by all THREE routes: the direct call (exactly two: the clearPrep arm of
// readyArenaFighter in src/sim/social/arena.ts, which IS the clean slate, and
// a Fiesta down, fiestaDownEntity in social/fiesta.ts, which a Protect Yumi
// down runs too); readyArenaFighter called with clearPrep: true; and
// resetForArena, the one-line wrapper around that call, which arena.ts runs
// itself and hands out through the SimContext seam (ctx.resetForArena) to
// call sites that never spell readyArenaFighter (the Vale Cup's two, the Yumi
// match seat). The phase 10 QA found this record wrong four times: on the
// readyArenaFighter route (every Yumi and Fiesta revive re-seats with
// clearPrep: true; Thornhollow Fields seats, starts, ends, and drops a leaver
// with clearPrep: true; ONLY its wave respawn, clearPrep: false, keeps a
// flask, the classic-era battleground-death rule the ledger records), on the
// resetForArena route (the Yumi match seat and the Vale Cup's kit-swap seat
// and teardown wipe through it, and the first cut of THIS scan was blind to a
// new ctx.resetForArena site anywhere), and twice on the SPELLING the scan
// could see (a bare-identifier regex let `ctx.resetForArena(e as Entity)`
// through; its widened successor still let a depth-two nested argument and an
// optional call through, and its readyArenaFighter sibling could not cross a
// `)` at all). So the scan no longer pattern-matches arguments: it walks each
// call's balanced parentheses (strings skipped) and reads the argument text,
// and every readyArenaFighter site must spell its clearPrep literal or be the
// one pinned seam passthrough, or the case reds. The accounting a flask lives
// under is therefore: overworld and PvE deaths keep it, a battleground or
// arena death keeps it on the corpse, every instanced match's seat and end
// (and each Fiesta or Yumi down and revive) clears it; each mode's behavior is
// pinned in its own suite (arena, battleground, yumi_match, fiesta,
// vale_cup_match). Absences cannot be asserted by driving the predicates, so
// the three caller sets are pinned literally here.
describe('resurrection: which sim modules wipe through aurasSurvivingCleanSlate', () => {
  const SIM_ROOT = fileURLToPath(new URL('../src/sim', import.meta.url));
  const CLEAN_SLATE_FN = 'aurasSurvivingCleanSlate';
  const CLEAN_SLATE_CALL = `${CLEAN_SLATE_FN}(`;
  // Comments stripped first, so prose naming the helper (resurrection.ts and the
  // sim/moderation notes both do) cannot mint a call site that does not exist.
  // The line-comment arm keeps a `://` in a URL from eating the rest of its
  // line, the stripper bug this repo has already shipped once (#2499).
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const codeOf = (full: string): string => stripComments(readFileSync(full, 'utf8'));

  // Every CALL of `name` in a stripped source: the name as a whole identifier
  // (a `[\w$]` just before it is a longer identifier, `_resetForArena(`; a
  // suffix, `readyArenaFighterAll(` or `readyArenaFighter$(`, is rejected by
  // the requirement that the name be followed by `(` or `?.(` and nothing
  // else), then a walk to its balanced `)`. Plain, double, and template string
  // literals are skipped (with backslash escapes), so a paren inside a message
  // cannot end the walk early; balanced backticks toggle correctly, so an
  // ordinary nested template parses too. The model stops at anything a real
  // lexer would treat differently INSIDE a call's own argument list: a regex
  // literal (`/[)]/`, or one holding a lone quote, `/['"]/`, which poisons the
  // quote arm instead), or a nested template whose inner literal is
  // paren-unbalanced. There an unmatched `(` runs the walk on until some later
  // surplus `)` closes it, or off the end (a THROW), and an unmatched `)` ends
  // the walk early; both misread the argument text, and the net is the tables,
  // not the throw: a planted site is a new count in some bucket, and an
  // existing site rewritten that way changes bucket (a truncated wipe reads as
  // a passthrough and is REPORTED; a swallowed span reads as whatever literal
  // it holds), so a table reds either way. The one blind combination is a
  // swallowed span that hides a SECOND call of the same name; no such spelling
  // exists in the sim tree. Quote state is reset at each call's `(`, so a lone
  // quote elsewhere in a file cannot poison a later call (the top-level
  // character class `/^[A-Za-z][A-Za-z '-]{1,15}$/` in pet/pet_commands.ts is
  // the per-file hazard that reset exists for). Any argument spelling is seen
  // the same way: a bare identifier, a member, an index, a cast, a ternary,
  // calls nested to any depth, a call wrapped over lines. What is NOT a call:
  // a bind (`x.resetForArena.bind`), a property or type slot (`resetForArena:
  // ...`, `resetForArena;`), an alias (`const f = ctx.resetForArena`); none
  // opens a paren on the name. The DECLARATIONS do open one, so
  // `isDeclaration` reads what follows the close: a `: void` return
  // annotation ending the signature (`export function resetForArena(...): void
  // {`, the Sim delegate `private resetForArena(...): void {`, the seam's
  // `resetForArena(...): void;`); the `[;{]` tail keeps a CALL in a ternary's
  // true arm (`cond ? ctx.resetForArena(e) : void 0`) a call. A declaration in
  // any other FORM that still opens a paren on the name is COUNTED (the table
  // reds and a person looks: the safe direction): a changed return type (`:
  // boolean`, `: Promise<void>`, `: void | undefined`), a type-literal member
  // ending in a comma or a brace (`): void,`, which biome rewrites to `;`
  // anyway, `): void }`). An arrow-property form (`resetForArena = (e) => {`,
  // `resetForArena: (e) => void`) never opens a paren on the name and is
  // simply not seen; none exists for these three functions, and the seam's
  // bind line is pinned as a non-call below. Residues, all recorded: the
  // aliased call (`const f = ctx.resetForArena; f(e)`) is invisible to any
  // source scan and the bracketed one (`ctx['resetForArena'](e)`) to this one,
  // the same class of blind spot the Lucent tripwire documents; a
  // space or a wrapping paren between the name and `(` (`ctx.resetForArena
  // (e)`, `(ctx.resetForArena)(e)`) is invisible here but biome's formatter
  // rewrites both and the format gate fails a changed file that keeps them;
  // and the classification below reads the whole balanced argument text, so a
  // nested call carrying its own `clearPrep:` literal would win (the tables
  // would still count the site). None of these spellings exists in the sim
  // tree, and the per-mode behavioral arms are the net under this scan for any
  // site that matters.
  interface CallSite {
    args: string;
    after: string;
  }
  function callSites(code: string, name: string): CallSite[] {
    const out: CallSite[] = [];
    let from = 0;
    for (;;) {
      const at = code.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;
      if (at > 0 && /[\w$]/.test(code[at - 1])) continue;
      let open = from;
      if (code.startsWith('?.', open)) open += 2;
      if (code[open] !== '(') continue;
      let depth = 0;
      let quote: string | null = null;
      let j = open;
      for (; j < code.length; j++) {
        const c = code[j];
        if (quote) {
          if (c === '\\') j++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new Error(`unbalanced parentheses after ${name} at ${at}`);
      out.push({ args: code.slice(open + 1, j), after: code.slice(j + 1, j + 24) });
      from = j + 1;
    }
    return out;
  }
  const isDeclaration = (site: CallSite): boolean => /^\s*:\s*void\s*[;{]/.test(site.after);
  const callsOf = (code: string, name: string): CallSite[] =>
    callSites(code, name).filter((s) => !isDeclaration(s));
  // A readyArenaFighter site is classified by the clearPrep literal in its own
  // argument text; a site that spells neither (a hoisted options object, a
  // passthrough) is reported, so the only legal passthrough is pinned below.
  const clearPrepOf = (site: CallSite): 'true' | 'false' | 'passthrough' =>
    /\bclearPrep:\s*true\b/.test(site.args)
      ? 'true'
      : /\bclearPrep:\s*false\b/.test(site.args)
        ? 'false'
        : 'passthrough';

  it('is called ONCE from arena.ts and ONCE from fiesta.ts, and from nowhere else in src/sim outside its own module', () => {
    const files = tsFilesUnder(SIM_ROOT);
    // Vacuity floor near the real count: a walk that collapsed to the top level
    // (or to nothing) would find no caller at all and pass the table assertion
    // below by accident, since both real callers live one directory down.
    expect(files.length, 'the src/sim walk found the real tree').toBeGreaterThan(400);
    expect(
      files.some((f) => f.file === 'social/arena.ts'),
      'the walk reaches subdirectories',
    ).toBe(true);

    // Counted per file through the same call walk as the two indirect routes
    // (the record says "in exactly two places", so the COUNT is the claim: a
    // second direct wipe added inside arena.ts or fiesta.ts changes this table
    // on purpose). The predicate's own module is excluded, since its
    // definition returns `Aura[]`, not `void`, and would read as a call; the
    // exclusion also hides a direct call added INSIDE resurrection.ts itself
    // (only the definition is there today), which no scan here would see and
    // the per-mode behavioral arms would.
    const direct = new Map<string, number>();
    for (const f of files) {
      if (f.file === 'resurrection.ts') continue;
      const n = callsOf(codeOf(f.full), CLEAN_SLATE_FN).length;
      if (n > 0) direct.set(f.file, n);
    }
    expect([...direct.entries()].sort()).toEqual([
      ['social/arena.ts', 1],
      ['social/fiesta.ts', 1],
    ]);
    // And the predicate is defined in THIS module. A rename already reds the
    // table above (the walk finds nothing), and a move to another file UNDER
    // src/sim reds it too (the moved definition returns `Aura[]`, so it is
    // counted as a third row); what this pin adds is the predicate leaving the
    // sim tree entirely, its callers importing it from outside src/sim with
    // the table still [arena 1, fiesta 1].
    expect(codeOf(fileURLToPath(new URL('../src/sim/resurrection.ts', import.meta.url)))).toContain(
      `export function ${CLEAN_SLATE_CALL}`,
    );
  });

  it('reaches the clean slate INDIRECTLY (readyArenaFighter clearPrep: true) from exactly the recorded sites', () => {
    // The route the first cut of this scan missed: clearPrep: true runs
    // aurasSurvivingCleanSlate inside readyArenaFighter, so a module that never
    // names the predicate still wipes. Counted per file (call sites, not
    // lines that mention it), and pinned as the literal table so a new seat or
    // revive that wipes, or one that stops wiping, changes this record on
    // purpose. battleground.ts: the seat (placeInBg, which is also the form-up
    // set-back), the countdown end, the leaver reset, and the match end; its
    // WAVE respawn passes clearPrep: false and is in the second table instead.
    // yumi.ts: the revive. fiesta.ts: the revive. arena.ts: the body of
    // resetForArena (the wrapper the next case counts the callers of) and,
    // with clearPrep: false, the countdown-end top-off that keeps a fighter's
    // targets. sim.ts: the seam delegate passes its opts through, the one
    // legal passthrough; any other site that spells neither literal (a hoisted
    // options object, a truncated argument text) is reported here.
    // Per-file counts cannot see two sites in ONE file swapping their
    // literals; that is closed elsewhere: battleground.ts has one keep (the
    // wave) and tests/battleground.test.ts pins it behaviorally, and arena.ts's
    // one wipe is resetForArena's body, pinned literally by the wrapper case.
    const files = tsFilesUnder(SIM_ROOT);
    const wipes = new Map<string, number>();
    const keeps = new Map<string, number>();
    const passthroughs: string[] = [];
    for (const f of files) {
      for (const site of callsOf(codeOf(f.full), 'readyArenaFighter')) {
        const kind = clearPrepOf(site);
        if (kind === 'true') wipes.set(f.file, (wipes.get(f.file) ?? 0) + 1);
        else if (kind === 'false') keeps.set(f.file, (keeps.get(f.file) ?? 0) + 1);
        else passthroughs.push(`${f.file}: readyArenaFighter(${site.args.trim()})`);
      }
    }
    expect([...wipes.entries()].sort()).toEqual([
      ['social/arena.ts', 1],
      ['social/battleground.ts', 4],
      ['social/fiesta.ts', 1],
      ['social/yumi.ts', 1],
    ]);
    // The respawns that KEEP a flask: the battleground wave (the classic-era
    // rule the whole accounting is built around) and the arena countdown-end
    // top-off. Pinned as the literal table too, so a keep that starts wiping,
    // or a new keep, changes this record on purpose.
    expect([...keeps.entries()].sort()).toEqual([
      ['social/arena.ts', 1],
      ['social/battleground.ts', 1],
    ]);
    expect(passthroughs).toEqual(['sim.ts: readyArenaFighter(this.ctx, e, opts)']);
  });

  it('reaches the clean slate through the resetForArena WRAPPER from exactly the recorded sites', () => {
    // The third route, and the one an earlier cut of this scan was blind to
    // (a planted ctx.resetForArena in an unrelated module stayed green): the
    // wrapper's callers need not spell readyArenaFighter or clearPrep. Counted
    // per file. arena.ts: its own seat (startArenaMatch, every arena-family
    // format including Fiesta and Protect Yumi), the match end (endArenaMatch,
    // the undefeated), and the send-home (returnFromArena, everyone still
    // present). yumi.ts: the match seat. vale_cup.ts: the kit-swap seat
    // (valeCupStandardize) and the teardown. sim.ts: the BODY of the Sim
    // delegate (`private resetForArena` forwarding to arenaMod.resetForArena),
    // so a module reaching it as ctx.resetForArena is counted at its own site
    // above and the seam's plumbing once here; the delegate's declaration line
    // and its bind line in buildSimContext are not calls and are not counted.
    const files = tsFilesUnder(SIM_ROOT);
    const wrapper = new Map<string, number>();
    for (const f of files) {
      const n = callsOf(codeOf(f.full), 'resetForArena').length;
      if (n > 0) wrapper.set(f.file, n);
    }
    expect([...wrapper.entries()].sort()).toEqual([
      ['sim.ts', 1],
      ['social/arena.ts', 3],
      ['social/vale_cup.ts', 2],
      ['social/yumi.ts', 1],
    ]);
    // The wrapper really is the clean slate and nothing softer: its body is the
    // one clearPrep: true call the indirect table counts for arena.ts.
    const arena = codeOf(fileURLToPath(new URL('../src/sim/social/arena.ts', import.meta.url)));
    expect(arena).toMatch(
      /export function resetForArena\(ctx: SimContext, e: Entity\): void \{\s*readyArenaFighter\(ctx, e, \{ clearPrep: true \}\);\s*\}/,
    );
  });

  it('the call walk sees every call spelling and no declaration (its own case, so a table red cannot hide it)', () => {
    // The spellings the tree uses today, then the ones a new site could
    // plausibly be written in, including each one an earlier regex let
    // through: `e as Entity` (round 3), a depth-two nested argument and an
    // optional call (round 4), plus a member, an index, a ternary argument, a
    // call inside a ternary, deeper nesting, a differently named context, a
    // call wrapped over lines, and a string argument holding a paren.
    for (const call of [
      'ctx.resetForArena(e);',
      'for (const e of entities) resetForArena(ctx, e!);',
      'arenaMod.resetForArena(this.ctx, e);',
      'ctx.resetForArena(match.e);',
      'ctx.resetForArena(entities[i]);',
      'ctx.resetForArena(e as Entity);',
      'resetForArena(ctx, this.e);',
      'resetForArena(simCtx, e);',
      'ctx.resetForArena(cond ? a : b);',
      'ctx.resetForArena(ctx.entities.get(pid)!);',
      'resetForArena(ctx, must(e));',
      'ctx.resetForArena(pickOne(lookUp(pid)));',
      'ctx.resetForArena(f(g(h(x))));',
      'ctx.resetForArena?.(e);',
      "ctx.resetForArena(must(e, 'no fighter :)'));",
      'ctx.resetForArena(\n  e,\n);',
      'ctx.resetForArena( e )',
    ]) {
      expect(callsOf(stripComments(call), 'resetForArena').length, call).toBe(1);
    }
    expect(
      callsOf(stripComments('cond ? ctx.resetForArena(a) : ctx.resetForArena(b);'), 'resetForArena')
        .length,
    ).toBe(2);
    // A call in a ternary's true arm whose else is `void 0` is a CALL: the
    // declaration test wants the `: void` to END a signature (`;` or `{`),
    // which is what keeps this spelling counted (a round-5 probe planted it
    // and the earlier `\bvoid\b` test swallowed it).
    expect(
      callsOf(stripComments('cond ? ctx.resetForArena(e) : void 0;'), 'resetForArena').length,
    ).toBe(1);
    // The string skip is load-bearing, not decoration: an UNBALANCED paren
    // inside a string argument must not end the walk early (the argument text
    // comes back whole), or a wipe whose options object follows such a string
    // would read as a passthrough.
    expect(
      callsOf(stripComments("ctx.resetForArena(must(e, 'no fighter :)'));"), 'resetForArena')[0]
        .args,
    ).toBe("must(e, 'no fighter :)')");
    expect(
      callsOf(
        stripComments("ctx.readyArenaFighter(must(e, ':)'), { clearPrep: true });"),
        'readyArenaFighter',
      ).map(clearPrepOf),
    ).toEqual(['true']);
    // The declaration spellings, single-line and wrapped, the seam's bind
    // line, an alias, and the identifier neighbors on either side (the prefix
    // exercises the identifier guard; the suffix, the `(` requirement): none
    // is a call of THIS name.
    for (const decl of [
      'export function resetForArena(ctx: SimContext, e: Entity): void {',
      'export function resetForArena(\n  ctx: SimContext,\n  e: Entity,\n): void {',
      'private resetForArena(e: Entity): void {',
      'resetForArena(e: Entity): void;',
      'resetForArena: sim.resetForArena.bind(sim),',
      'const f = ctx.resetForArena;',
      '_resetForArena(ctx, e);',
      'ctx.resetForArenaAll(e);',
    ]) {
      expect(callsOf(stripComments(decl), 'resetForArena'), decl).toEqual([]);
    }
    // The readyArenaFighter side, with the classification: the nested-argument
    // spelling the tree already uses two lines above its real call sites
    // (`ctx.entities.get(pid)!`) is a wipe, the wave's literal is a keep, a
    // hoisted options object is a passthrough (reported, never silently
    // counted either way), and the wrapped declaration is not a call.
    const wipe = callsOf(
      stripComments('ctx.readyArenaFighter(ctx.entities.get(pid)!, { clearPrep: true });'),
      'readyArenaFighter',
    );
    expect(wipe.map(clearPrepOf)).toEqual(['true']);
    expect(
      callsOf(
        stripComments(
          'readyArenaFighter(ctx, e, {\n  clearPrep: false,\n  keepValidTargetPids: ids,\n});',
        ),
        'readyArenaFighter',
      ).map(clearPrepOf),
    ).toEqual(['false']);
    expect(
      callsOf(
        stripComments('const opts = { clearPrep: true };\nctx.readyArenaFighter(e, opts);'),
        'readyArenaFighter',
      ).map(clearPrepOf),
    ).toEqual(['passthrough']);
    // The quiet half of the regex-literal edge, pinned as REPORTED rather than
    // passed: an unmatched `)` inside a regex argument truncates the argument
    // text, and the truncated wipe classifies as a passthrough.
    expect(
      callsOf(
        stripComments('ctx.readyArenaFighter(/[)]/.test(x) ? e : f, { clearPrep: true });'),
        'readyArenaFighter',
      ).map(clearPrepOf),
    ).toEqual(['passthrough']);
    for (const decl of [
      'export function readyArenaFighter(\n  ctx: SimContext,\n  e: Entity,\n  opts: { clearPrep: boolean; keepValidTargetPids?: readonly number[] },\n): void {',
      'readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void;',
      'private readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void {',
      'readyArenaFighter: sim.readyArenaFighter.bind(sim),',
      'ctx.readyArenaFighterAll(e, { clearPrep: true });',
    ]) {
      expect(callsOf(stripComments(decl), 'readyArenaFighter'), decl).toEqual([]);
    }
  });

  it('reads the sim tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
