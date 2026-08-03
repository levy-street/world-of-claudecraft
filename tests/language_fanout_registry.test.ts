// THE LANGUAGE FAN-OUT REGISTRY (#2529).
//
// A runtime language change does not reload the page. `changeLanguage`
// (src/main.ts) re-localizes the static shell and then dispatches
// `woc:languagechange`; `Hud.refreshLocalizedDynamicUi()` is the ONE hand-
// maintained fan-out that repaints the dynamic surfaces, and a surface is
// re-localized only if it appears in that method.
//
// WHY A SURFACE NEEDS TO BE IN IT. Two different elision idioms live in
// `src/ui`, and only one of them is locale-safe:
//   - a WRITE-ELISION facet (`PainterHostWriters`) compares the RESOLVED string
//     it is about to write, so a locale change moves the comparison and the
//     write happens by itself. Nothing to do.
//   - a REPAINT SIGNATURE (`lastSig` and its family) compares a digest of the
//     DATA: ids, counts, positions, booleans. Every one of those is
//     text-independent by design, which is the whole point of the idiom, and it
//     means `setLanguage` alone can never move one. A surface gated that way
//     keeps the previous locale until its data happens to change.
// Four windows had gone missing from the fan-out that way (calendar, mailbox,
// social, card duel), and nothing enumerated the list, which is why they could
// go missing quietly. Sweeping for the second idiom found five more, including
// one, the delve tracker, whose fan-out arm was PRESENT and inert: the arm
// called `update()`, and `update()` early-returned on its own unchanged
// signature.
//
// WHAT THIS FILE HOLDS, in two halves that fail for different reasons:
//   1. The fan-out's own call list, read off the AST and diffed BOTH WAYS
//      against `FANOUT_ARMS`. A new arm fails until it is registered; a deleted
//      arm fails until its row goes; a re-gated one fails because the gate text
//      is part of the key.
//   2. A sweep of `src/ui` for the signature idiom. Every module it finds must
//      be either answered by a named arm from half 1 or carry a written
//      exemption, and each one pins the memo fields it was classified on, so a
//      NEW memo added to an already-classified module re-opens the question
//      instead of inheriting an answer that was given about a different field.
//
// WHERE ITS TEETH STOP, stated rather than implied:
//   - The sweep recognizes the `x === this.lastFoo` comparison shape. A gate
//     written as a predicate call over retained state is invisible to it: the
//     tutorial overlay's `tutorialNeedsRerender(this.step, next, ...)` is the
//     live example, and it is covered instead by half 1 pinning its arm and by
//     the behavioral test in `language_fanout_relocalize.test.ts`.
//   - Half 1 sees `refreshLocalizedDynamicUi()`'s OWN body. An arm that calls a
//     `Hud` method which then fails to repaint is invisible here; the delve
//     tracker was exactly that, and what catches it is the behavioral arm, not
//     a call list.
//   - Neither half says anything about a COLD window (rendered on open, no
//     repaint driver at all). That is a different gap with a different answer
//     and it is not what #2529 is about.
//   - Half 1 registers STATEMENT-position calls. An arm added inside a callback
//     (`queueMicrotask(() => this.foo.relocalize())`) is invisible to it, though
//     deleting a registered arm is still caught.
//   - The memo sweep requires the literal `private` modifier and a `this.`
//     receiver, so a module-scoped `let lastSig` or a `#lastSig` would escape
//     it. There is no such module in `src/ui` today; if one lands, widen
//     MEMO_DECL rather than exempting the file.
//   - The sweep covers `src/ui` only. A signature-gated text surface under
//     `src/render/` would have to be caught in review.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMethodCallSites } from './helpers/method_call_sites';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const uiRoot = fileURLToPath(new URL('../src/ui/', import.meta.url));
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

// Raw source to the parser (a `//` inside one of hud.ts's regex literals or
// template strings truncates a line for a comment stripper, and ts.createSourceFile
// does not throw on the broken tree, it silently loses a call site); stripped
// source only for the text pins further down.
const scan = readMethodCallSites('src/ui/hud.ts', hudSource, 'Hud', 'refreshLocalizedDynamicUi');

function stripComments(source: string): string {
  // The `(^|[^:])` capture keeps a `://` in a URL from eating the rest of its
  // line, the stripper bug this repo already shipped once (#2499).
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// --- half 1: the fan-out's arms -------------------------------------------

/** `call|gate`, the same key `hud_update_drive.test.ts` uses. */
const FANOUT_ARMS: readonly string[] = [
  'this.syncDailyRewardsSurfaceLabels|',
  'this.storePromoCard.relocalize|',
  'this.refreshKeybindLabels|',
  'this.updateQuestTracker|',
  'this.delveTracker.relocalize|',
  'this.riftTracker.relocalize|',
  'this.partyFramesPainter.relocalize|',
  'this.mapPainter.relocalize|',
  'this.targetFrameMover.relocalize|',
  'this.playerFrameMover.relocalize|',
  'this.partyFrameMover.relocalize|',
  'this.targetAurasWindow.relocalize|',
  'this.questlogWindow.render|this.questlogWindow.isOpen',
  "this.renderBags|$('#bags').style.display !== 'none'",
  "this.renderVendor|this.openVendorNpcId !== null && $('#vendor-window').style.display === 'block'",
  "this.renderHeroicVendor|this.openHeroicVendorNpcId !== null && $('#vendor-window').style.display === 'block'",
  "this.renderTrain|this.openTrainNpcId !== null && $('#train-window').style.display === 'block'",
  "this.renderUnbind|this.openUnbindNpcId !== null && $('#unbind-window').style.display === 'block'",
  'this.renderTownFocus|this.townFocusOpen',
  'this.marketWindow.render|this.marketWindow.isOpen',
  'this.bankWindow.render|this.bankWindow.isOpen',
  'this.deedsWindow.render|this.deedsWindow.isOpen',
  'this.professionsWindow.render|this.professionsWindow.isOpen',
  // The crafting window's repaint memos are all text-independent (station
  // set, reagent sig, profession surface sig), so an open window kept the
  // previous locale until data moved; the forced rebuild re-runs every t(),
  // identity card included (the phase 22 QA arm).
  "this.renderCrafting|$('#crafting-window').style.display === 'flex'",
  'this.updateDeedTracker|',
  'this.charWindow.renderIfOpen|',
  'this.arenaWindow.relocalize|',
  'this.dungeonFinderWindow.relocalize|',
  'this.dungeonFinderProposalPopup.relocalize|',
  'this.valeCupWindow.relocalize|',
  'this.vcupBetting.relocalize|',
  'this.vcupIndicator.relocalize|',
  'this.vcupMatchHud.relocalize|',
  'this.vcupBriefing.relocalize|',
  'this.vcupCharge.relocalize|',
  'this.questDialog.relocalize|',
  'this.calendarWindow.relocalize|',
  'this.mailboxWindow.relocalize|',
  'this.socialWindow.relocalize|',
  'this.cardDuelWindow.relocalize|',
  'this.spellbookWindow.relocalize|',
  'this.lockpickController.relocalize|',
  'this.tutorial.relocalize|',
  'this.mobileActionRingPainter.relocalize|',
  'this.mountRaceStrip.relocalize|',
  'this.mountRaceControls.relocalize|',
];

const observedArms = scan.sites.map((s) => `${s.call}|${s.conditions.join(' && ')}`);

// --- half 2: every signature-gated, text-bearing src/ui module -------------

/**
 * A memo field name shaped like a repaint signature. Deliberately a NAME
 * family rather than a type: what makes one of these a language hazard is that
 * it retains a digest of the previous paint's INPUTS, and this repo spells that
 * `lastX` / `prevX` / `knownX` / `paintedX` everywhere it does it.
 */
const MEMO_DECL = /\bprivate\s+(?:readonly\s+)?((?:last|prev|known|painted)[A-Z]\w*)\b/g;

/** Any call that puts player-visible text on screen. */
const EMITS_TEXT = /\bt\(|\btPlural\(|\btEntity\(/;

interface GatedModule {
  /** Path under `src/ui/`. */
  readonly file: string;
  /** The memo fields the classification below was made about, sorted. */
  readonly memos: readonly string[];
}

function discoverGatedModules(): GatedModule[] {
  const out: GatedModule[] = [];
  for (const { file, full } of tsFilesUnder(uiRoot)) {
    const source = stripComments(readFileSync(full, 'utf8'));
    if (!EMITS_TEXT.test(source)) continue;
    const declared = [...source.matchAll(MEMO_DECL)].map((m) => m[1]);
    // A memo is only a REPAINT gate when the module compares it. A retained
    // value that is merely written and read back (a cached ref, a latch the
    // painter re-reads) suppresses nothing on its own.
    const gating = [
      ...new Set(
        declared.filter((memo) =>
          new RegExp(`[!=]==\\s*this\\.${memo}\\b|this\\.${memo}\\s*[!=]==`).test(source),
        ),
      ),
    ].sort();
    if (gating.length > 0) out.push({ file, memos: gating });
  }
  return out;
}

const discovered = discoverGatedModules();
const discoveredByFile = new Map(discovered.map((m) => [m.file, m]));

interface AnsweredSurface extends GatedModule {
  /** The `call` key in FANOUT_ARMS that re-localizes this module. */
  readonly answer: string;
  /** What the memo digests, and therefore why the locale cannot move it. */
  readonly why: string;
}

const ANSWERED: readonly AnsweredSurface[] = [
  {
    file: 'mount_race_controls.ts',
    memos: ['lastButtonVisible', 'lastCountdownMode', 'lastCountdownNumber'],
    answer: 'this.mountRaceControls.relocalize',
    why: 'a visibility flag, the countdown mode and the countdown NUMBER, so the Start/Cancel label and the GO text never move with the locale',
  },
  {
    file: 'mount_race_strip.ts',
    memos: ['lastRaceId', 'lastPhase', 'lastSecond'],
    answer: 'this.mountRaceStrip.relocalize',
    why: 'the race id, the phase and the whole second remaining, so the time-left line never moves with the locale',
  },
  {
    file: 'arena_window.ts',
    memos: ['lastSig'],
    answer: 'this.arenaWindow.relocalize',
    why: 'the offline sentinel or a JSON of bracket ids and scores',
  },
  {
    file: 'bank_window.ts',
    memos: ['lastRenderedGuildView', 'lastRenderedTab', 'lastSig'],
    answer: 'this.bankWindow.render',
    why: 'capacity, purchased and bonus slot counts, the next expansion cost, the stored slots (both panes ride ONE sig, the guild arm and the activity log key appended), plus lastRenderedTab and lastRenderedGuildView, two text-independent pane latches that only scope the scroll restore. render() carries no self-gate, so the arm rebuilds',
  },
  {
    file: 'calendar_window.ts',
    memos: ['lastSig'],
    answer: 'this.calendarWindow.relocalize',
    why: 'the visible month, the selected day and the guild-event mirror (#2529)',
  },
  {
    file: 'card_duel_window.ts',
    memos: ['lastSig'],
    answer: 'this.cardDuelWindow.relocalize',
    why: 'the duel view model: state, card values, round counts (#2529)',
  },
  {
    file: 'deeds_window.ts',
    memos: ['lastSig'],
    answer: 'this.deedsWindow.render',
    why: 'the earned/watched deed ids and their counters',
  },
  {
    file: 'dungeon_finder_proposal_popup.ts',
    memos: ['lastRemainingText', 'lastSig'],
    answer: 'this.dungeonFinderProposalPopup.relocalize',
    why: 'the proposal id and roles, plus a countdown string latch',
  },
  {
    file: 'dungeon_finder_window.ts',
    memos: ['lastSig'],
    answer: 'this.dungeonFinderWindow.relocalize',
    why: 'the view core signature (queue state, role counts and party ids) joined with the open pane name',
  },
  {
    file: 'hud/action_bar/mobile_action_ring_painter.ts',
    memos: ['lastPage', 'lastPageCount'],
    answer: 'this.mobileActionRingPainter.relocalize',
    why: 'two integers gating the page indicator text and the toggle name (#2529)',
  },
  {
    file: 'hud/delve/delve_tracker_controller.ts',
    memos: ['lastSignature'],
    answer: 'this.delveTracker.relocalize',
    why: 'delve/tier/module ids, objective counts, affixes and marks. The arm used to call update(), which this same signature swallowed (#2529)',
  },
  {
    file: 'hud/delve/lockpick_window.ts',
    memos: ['lastSig', 'lastTimerKey', 'lastUrgent'],
    answer: 'this.lockpickController.relocalize',
    why: 'the board geometry and pick position; the other two are the countdown clock key and its urgent latch (#2529)',
  },
  {
    file: 'hud/quest/quest_dialog_controller.ts',
    memos: ['lastGossipRowSig', 'lastIntroHintVisible'],
    answer: 'this.questDialog.relocalize',
    why: 'the profession intro hint visibility latch, and the offerable-row signature (quest ids and marker kinds, text-independent by design; the phase 23 cadence-lapse watch)',
  },
  {
    file: 'hud/rift/rift_floor_tracker_controller.ts',
    memos: ['lastSignature'],
    answer: 'this.riftTracker.relocalize',
    why: 'the floor index, floor count and whole-second countdown, all numbers, so the Floor and Closes in lines never move with the locale (#2655)',
  },
  {
    file: 'mailbox_window.ts',
    memos: ['lastSig'],
    answer: 'this.mailboxWindow.relocalize',
    why: 'the tab, the open letter id and the mail mirror (#2529)',
  },
  {
    file: 'market_window.ts',
    memos: ['lastSig'],
    answer: 'this.marketWindow.render',
    why: 'the listing ids, prices and the active tab; render() carries no self-gate',
  },
  {
    file: 'professions_window.ts',
    memos: ['lastSig'],
    answer: 'this.professionsWindow.render',
    why: 'the known professions and their skill numbers; render() carries no self-gate',
  },
  {
    file: 'social_window.ts',
    memos: ['lastContent', 'lastStruct'],
    answer: 'this.socialWindow.relocalize',
    why: 'the tab plus the friend/guild/raid rosters, split structural and content (#2529)',
  },
  {
    file: 'spellbook_window.ts',
    memos: ['knownIds', 'knownNums', 'lastAttackOnBar', 'lastHasFree', 'lastSlotIds'],
    answer: 'this.spellbookWindow.relocalize',
    why: 'the resolved ability ids and their rank/cost/cast/cooldown numbers, plus the hotbar toggle state (#2529)',
  },
  {
    file: 'vale_cup_betting.ts',
    memos: ['lastSig'],
    answer: 'this.vcupBetting.relocalize',
    why: 'the match id, the two nation ids, the away-palette flag and a skeleton of each team roster',
  },
  {
    file: 'vale_cup_briefing.ts',
    memos: ['lastSig'],
    answer: 'this.vcupBriefing.relocalize',
    why: 'the two nation ids, the away-palette flag, the local team and role, the format and a skeleton of each roster',
  },
  {
    file: 'vale_cup_hud.ts',
    memos: ['lastSig'],
    answer: 'this.vcupMatchHud.relocalize',
    why: 'the match id, the two nation ids, the away-palette flag and the local team, pipe-joined',
  },
  {
    file: 'vale_cup_indicator.ts',
    memos: ['lastSig'],
    answer: 'this.vcupIndicator.relocalize',
    why: 'a hidden sentinel or the bracket, queue position and waiting count. The clock is deliberately out of it and rides the elided setText instead',
  },
  {
    file: 'vale_cup_window.ts',
    memos: ['lastSig'],
    answer: 'this.valeCupWindow.relocalize',
    why: 'standing, queue state, bracket, position, queue sizes, the deserter timer, nation, role and the live match scores',
  },
];

/**
 * A memo the sweep finds that is NOT a language hazard, with the reason.
 *
 * The bar is high on purpose: an exemption is the cheapest way to make this
 * guard green without fixing anything, so each one names the memo's contents
 * and says what moves it when the locale moves.
 */
const NOT_A_LANGUAGE_GATE: ReadonlyArray<{
  readonly file: string;
  /**
   * The memos the exemption was argued about, or 'coordinator' for hud.ts. Pinned
   * for the same reason the ANSWERED rows are: an exemption is granted about
   * SPECIFIC fields, and a module that later grows a real data signature must
   * not inherit an answer that was given about a different one.
   */
  readonly memos: readonly string[] | 'coordinator';
  readonly reason: string;
}> = [
  {
    file: 'claudium_window.ts',
    memos: ['paintedWalletMarkup'],
    reason:
      'paintedWalletMarkup retains the RESOLVED wallet markup and is compared against a freshly built walletConnectionHtml(), so a locale change moves both sides of the comparison and the repaint happens by itself. It is a write-elision memo, not a data signature.',
  },
  {
    file: 'daily_rewards_window.ts',
    memos: ['paintedStoreBody', 'paintedStoreMarkup'],
    reason:
      'paintedStoreBody / paintedStoreMarkup retain the RESOLVED store markup and the element it was written into, compared against freshly built markup in replaceStoreBody, so a locale change produces different markup and repaints. Same write-elision shape as claudium_window.',
  },
  {
    file: 'guild_bank_log_window.ts',
    memos: ['lastAnnounced'],
    reason:
      'lastAnnounced gates nothing that is drawn: it decides only whether the refusal line RE-ANNOUNCES to assistive tech (a live region inserted already-populated is not announced, so the pane re-writes the same text one task later). The visible text is rebuilt unconditionally on every paint, and the pane is repainted wholesale by BankWindow.render(), which the language fan-out already drives. A locale switch therefore relocalizes the log by itself; at worst the refusal is not re-announced in the new locale, which is the correct behaviour anyway (the refusal did not change).',
  },
  {
    file: 'deed_tracker_painter.ts',
    memos: ['lastChip'],
    reason:
      'lastChip gates only the header ARIA presence swap (aria-expanded / aria-controls / aria-haspopup), which carries no player-visible text. Every string in this painter goes through the elided writer facet, which compares resolved text, and the fan-out drives it through this.updateDeedTracker.',
  },
  {
    file: 'hud.ts',
    memos: 'coordinator',
    reason:
      'the coordinator itself. Its own signature-gated arms are individually answered inside refreshLocalizedDynamicUi, which half 1 above pins EXACTLY, so pinning its two dozen unrelated memos here as well would only mean every hud.ts edit had to be re-approved in two places.',
  },
];

// ---------------------------------------------------------------------------

describe('language fan-out: half 1, the arms of refreshLocalizedDynamicUi', () => {
  it('read a whole, real fan-out before asserting anything about it', () => {
    // readMethodCallSites throws on a renamed class or method, so a rename is
    // red rather than a quiet empty scan. These floors cover the other way to
    // come back short: a walk that stopped parsing part way down the body.
    expect(scan.classMembers, 'the Hud class shrank past recognition').toBeGreaterThan(600);
    expect(observedArms.length, 'the fan-out walk came back short').toBeGreaterThan(30);
  });

  it('still has a producer for the event the whole fan-out hangs off', () => {
    // Nothing else pins this, and the entire feature is dead without it: the
    // listener below would be green while no switch ever reached it.
    const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    expect(main).toContain("document.dispatchEvent(new CustomEvent('woc:languagechange'");
    expect(main).toContain('async function changeLanguage(');
  });

  it('wires the fan-out to the woc:languagechange event exactly once', () => {
    const wiring = stripComments(hudSource).match(
      /document\.addEventListener\('woc:languagechange'/g,
    );
    expect(wiring, 'hud.ts no longer listens for woc:languagechange').toHaveLength(1);
    expect(stripComments(hudSource)).toContain(
      "document.addEventListener('woc:languagechange', () => this.refreshLocalizedDynamicUi());",
    );
  });

  it('registers every arm the fan-out drives, and nothing it does not', () => {
    const missing = observedArms.filter((k) => !FANOUT_ARMS.includes(k));
    const stale = FANOUT_ARMS.filter((k) => !observedArms.includes(k));
    expect(
      { missing, stale },
      'refreshLocalizedDynamicUi and this registry disagree. A NEW arm needs a row here saying what it re-localizes; a REMOVED one needs its row deleted; a RE-GATED one needs its gate text updated. That is the point of the table: a surface cannot leave the fan-out without a diff line here.',
    ).toEqual({ missing: [], stale: [] });
    expect(observedArms).toHaveLength(FANOUT_ARMS.length);
  });

  it('finds the call shapes a narrowed walk would lose', () => {
    // One unconditional arm, one behind an isOpen gate, one behind a raw DOM
    // display check, and one optional-chained call: a walk that dropped any of
    // those families would still leave the other three healthy.
    expect(observedArms).toContain('this.cardDuelWindow.relocalize|');
    expect(observedArms).toContain('this.bankWindow.render|this.bankWindow.isOpen');
    expect(observedArms).toContain("this.renderBags|$('#bags').style.display !== 'none'");
    expect(observedArms).toContain('this.mobileActionRingPainter.relocalize|');
  });
});

describe('language fan-out: half 2, every signature-gated src/ui surface is classified', () => {
  it('scans src/ui only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  // The corpus does not currently exercise every alternate in the two matchers
  // (no discovered module is found ONLY by `prev`, `tPlural(` or `tEntity(`), so
  // a narrowing that dropped one would pass every corpus assertion. Pin the
  // matchers' own contract directly instead of pretending the tree covers it.
  it('keeps every alternate in both matchers live', () => {
    for (const decl of [
      '  private lastSig = 1;',
      '  private prevSkills = 1;',
      '  private knownIds = [];',
      '  private paintedMarkup = 1;',
      '  private readonly lastKey = 1;',
    ]) {
      expect(new RegExp(MEMO_DECL.source).test(decl), `MEMO_DECL missed ${decl}`).toBe(true);
    }
    for (const decl of ['  private lastsig = 1;', '  lastSig = 1;', '  private sig = 1;']) {
      expect(new RegExp(MEMO_DECL.source).test(decl), `MEMO_DECL over-matched ${decl}`).toBe(false);
    }
    for (const call of ["t('a.b')", "tPlural('a.b', 2)", "tEntity({ kind: 'x' })"]) {
      expect(EMITS_TEXT.test(call), `EMITS_TEXT missed ${call}`).toBe(true);
    }
    // A word ending in `t` before a paren is the over-match to stay clear of.
    for (const call of ['arr.at(3)', 'print(x)', 'format(x)']) {
      expect(EMITS_TEXT.test(call), `EMITS_TEXT over-matched ${call}`).toBe(false);
    }
  });

  it('swept a real corpus (non-vacuity)', () => {
    // src/ui is the one DEEP scan root in this repo, so the floor has to sit
    // above what a NON-recursive read returns (about 300 top-level files today)
    // or it cannot detect the failure its own message names.
    const corpus = tsFilesUnder(uiRoot);
    expect(corpus.length, 'the src/ui walk came back short').toBeGreaterThan(400);
    expect(
      corpus.filter((f) => f.file.includes('/')).length,
      'the src/ui walk returned only top-level files: it stopped recursing',
    ).toBeGreaterThan(50);
    expect(
      discovered.length,
      'the signature sweep found almost nothing: its memo or text matcher stopped matching',
    ).toBeGreaterThan(20);
    // Both halves of the predicate must be load-bearing, or the sweep is really
    // just "every module in src/ui" or "every module with a memo".
    expect(
      discoveredByFile.has('talents_window.ts'),
      'talents_window.ts has t() and no repaint memo: the memo half of the predicate stopped filtering',
    ).toBe(false);
    expect(
      discoveredByFile.has('party_below_target_painter.ts'),
      'party_below_target_painter.ts has a memo and no t(): the text half of the predicate stopped filtering',
    ).toBe(false);
  });

  it('finds every surface #2529 named, plus the ones the sweep itself turned up', () => {
    for (const file of [
      'calendar_window.ts',
      'mailbox_window.ts',
      'social_window.ts',
      'card_duel_window.ts',
      'spellbook_window.ts',
      'hud/delve/delve_tracker_controller.ts',
      'hud/delve/lockpick_window.ts',
      'hud/action_bar/mobile_action_ring_painter.ts',
    ]) {
      expect(discoveredByFile.has(file), `the sweep no longer finds ${file}`).toBe(true);
    }
  });

  it('classifies every discovered module exactly once', () => {
    const answered = new Set(ANSWERED.map((s) => s.file));
    const exempt = new Set(NOT_A_LANGUAGE_GATE.map((r) => r.file));
    const unclassified = discovered
      .map((m) => m.file)
      .filter((f) => !answered.has(f) && !exempt.has(f));
    expect(
      unclassified,
      'unclassified signature-gated src/ui module(s). Each one repaints only when its OWN data signature moves, so a language switch leaves it in the old locale. Either give it a relocalize(), call it from Hud.refreshLocalizedDynamicUi and add an ANSWERED row, or add a NOT_A_LANGUAGE_GATE entry naming the memo and saying what moves it when the locale moves:\n' +
        unclassified.join('\n'),
    ).toEqual([]);
    const both = [...answered].filter((f) => exempt.has(f));
    expect(both, 'a module is both answered and exempt: pick one').toEqual([]);
  });

  it('keeps no stale rows for modules the sweep no longer finds', () => {
    const rows = [...ANSWERED.map((s) => s.file), ...NOT_A_LANGUAGE_GATE.map((r) => r.file)];
    const stale = rows.filter((f) => !discoveredByFile.has(f));
    expect(
      stale,
      'registry row(s) naming a module that no longer has a compared repaint memo. If the gate really went, delete the row (and, for an ANSWERED one, decide whether its fan-out arm is still needed):\n' +
        stale.join('\n'),
    ).toEqual([]);
  });

  it('pins each classification to the memo fields it was made about', () => {
    const drift: string[] = [];
    for (const row of ANSWERED) {
      const found = discoveredByFile.get(row.file);
      if (!found) continue; // reported by the stale-row test above
      if (found.memos.join(',') !== [...row.memos].sort().join(',')) {
        drift.push(
          `${row.file}: registry ${row.memos.join(',')} vs source ${found.memos.join(',')}`,
        );
      }
    }
    expect(
      drift,
      'a classified module gained or lost a repaint memo. A NEW memo is a NEW gate and needs the language question answered about it, not inherited from the answer given about a different field:\n' +
        drift.join('\n'),
    ).toEqual([]);
  });

  it('answers each surface with an arm the fan-out really drives', () => {
    const calls = new Set(scan.sites.map((s) => s.call));
    const orphans = ANSWERED.filter((s) => !calls.has(s.answer));
    expect(
      orphans.map((s) => `${s.file} -> ${s.answer}`),
      'an ANSWERED row names a call refreshLocalizedDynamicUi does not make:\n' +
        orphans.map((s) => `${s.file} -> ${s.answer}`).join('\n'),
    ).toEqual([]);
  });

  it('holds every row to a written reason', () => {
    const thin: string[] = [];
    for (const row of ANSWERED) if (row.why.length < 40) thin.push(`ANSWERED ${row.file}`);
    for (const row of NOT_A_LANGUAGE_GATE) {
      // The exemption is the cheap way out, so it costs more prose than an answer.
      if (row.reason.length < 120) thin.push(`NOT_A_LANGUAGE_GATE ${row.file}`);
    }
    expect(thin, `row(s) with no real reason written:\n${thin.join('\n')}`).toEqual([]);
    expect(
      NOT_A_LANGUAGE_GATE.length,
      'the exemption list grew. Every entry is a memo this repo has decided cannot hold player text; adding one should be argued in review, not absorbed by a floor.',
      // 5 as of the guild bank activity log: its `lastAnnounced` memo gates an
      // assistive-tech RE-ANNOUNCEMENT and nothing that is drawn (argued in the
      // frontend-seam review of that slice; the row states the reasoning).
    ).toBe(5);
  });

  it('gives every relocalize() in src/ui a caller in the fan-out', () => {
    // The bug that started #2529: card_duel_window.ts already HAD a correct
    // relocalize() and nothing in the repo ever called it. A relocalize with no
    // caller is dead code that reads like a working feature.
    const armCalls = new Set(scan.sites.map((s) => s.call));
    const uncalled: string[] = [];
    const scanned: string[] = [];
    for (const { file, full } of tsFilesUnder(uiRoot)) {
      const source = stripComments(readFileSync(full, 'utf8'));
      if (!/^\s{2}relocalize\(/m.test(source)) continue;
      scanned.push(file);
      const cls = /export class (\w+)/.exec(source)?.[1] ?? '';
      // Map the class back to the Hud field that holds it, then look for an arm
      // on that field. A module whose relocalize is reached through a wrapper
      // (LockpickWindow via LockpickController) is credited by the wrapper's arm.
      const fields = [...stripComments(hudSource).matchAll(/(\w+)\s*=\s*new (\w+)\(/g)]
        .filter(([, , constructed]) => constructed === cls)
        .map(([, field]) => field);
      const credited =
        fields.some((f) => armCalls.has(`this.${f}.relocalize`)) ||
        [...armCalls].some((c) => c.endsWith('.relocalize') && wrapperOwns(c, cls));
      if (!credited) uncalled.push(`${file} (${cls || 'unnamed class'})`);
    }
    // The filter above is the whole test: an empty `uncalled` proves nothing if
    // the relocalize matcher stopped matching (a reformat, an `async`, a
    // `public`), so floor the set it actually walked.
    expect(
      scanned.length,
      'the relocalize sweep matched almost nothing: its declaration matcher stopped matching',
    ).toBeGreaterThan(20);
    expect(scanned).toContain('card_duel_window.ts');
    expect(scanned).toContain('hud/delve/lockpick_window.ts');
    expect(
      uncalled,
      'src/ui module(s) exposing a relocalize() that Hud.refreshLocalizedDynamicUi never calls. Wire it into the fan-out, or delete it: an uncalled relocalize is what let four windows look answered while they were not:\n' +
        uncalled.join('\n'),
    ).toEqual([]);
  });
});

/**
 * Whether the Hud field behind `armCall` is a controller that forwards
 * relocalize() to `cls`. Reads the wrapper's own source rather than trusting a
 * name, so renaming LockpickController to something else keeps working and
 * gutting its forwarding call does not.
 */
function wrapperOwns(armCall: string, cls: string): boolean {
  const field = armCall.slice('this.'.length, -'.relocalize'.length);
  const constructed = new RegExp(`\\b${field}\\s*=\\s*new (\\w+)\\(`).exec(
    stripComments(hudSource),
  );
  if (!constructed) return false;
  for (const { full } of tsFilesUnder(uiRoot)) {
    const source = stripComments(readFileSync(full, 'utf8'));
    if (!new RegExp(`export class ${constructed[1]}\\b`).test(source)) continue;
    // The wrapper must both hold one of these and forward to it.
    return (
      new RegExp(`:\\s*${cls}\\b|new ${cls}\\(`).test(source) && /\.relocalize\(\)/.test(source)
    );
  }
  return false;
}
