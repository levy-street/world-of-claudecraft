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
//   - The sweep recognizes the `x === this.lastFoo` comparison shape, including
//     one taken through a MEMBER of the memo (`this.searchEcho?.typed === x`).
//     A gate written as a predicate call over retained state is still invisible
//     to it: the tutorial overlay's `tutorialNeedsRerender(this.step, next,
//     ...)` is the live example, and it is covered instead by half 1 pinning its
//     arm and by the behavioral test in `language_fanout_relocalize.test.ts`.
//   - The memo is found by a NAME family (see MEMO_DECL), which is a spelling
//     convention this file cannot enforce. A gated memo named after neither the
//     prefix nor the suffix vocabulary escapes, and the measured alternative
//     (matching every private field) is 308 discoveries against 106, a registry
//     nobody could keep green. Name a new memo out of that vocabulary and it is
//     invisible here; that limit is real and is the price of the sweep existing.
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMethodCallSites } from './helpers/method_call_sites';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const uiRoot = fileURLToPath(new URL('../src/ui/', import.meta.url));
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const strippedHudSource = stripComments(hudSource);
const uiTsFiles = [...tsFilesUnder(uiRoot)];
const uiSources = uiTsFiles.map(({ file, full }) => ({
  file,
  full,
  source: stripComments(readFileSync(full, 'utf8')),
}));
const hudFieldsByClass = new Map<string, string[]>();
for (const [, field, constructed] of strippedHudSource.matchAll(/(\w+)\s*=\s*new (\w+)\(/g)) {
  const fields = hudFieldsByClass.get(constructed) ?? [];
  fields.push(field);
  hudFieldsByClass.set(constructed, fields);
}

// Raw source to the parser (a `//` inside one of hud.ts's regex literals or
// template strings truncates a line for a comment stripper, and ts.createSourceFile
// does not throw on the broken tree, it silently loses a call site); stripped
// source only for the text pins further down.
const scan = readMethodCallSites('src/ui/hud.ts', hudSource, 'Hud', 'refreshLocalizedDynamicUi');

// Comment stripping goes through the shared single-pass helper
// (tests/helpers/strip_comments.ts): line comments strip in the same pass as
// block comments, so a bare /* inside a line comment cannot open a phantom
// block that hides a gated module from the discovery sweep (the src/main.ts
// hazard class), and the `(^|[^:])` guard keeps `://` URLs intact (#2499).

// --- half 1: the fan-out's arms -------------------------------------------

/** `call|gate`, the same key `hud_update_drive.test.ts` uses. */
const FANOUT_ARMS: readonly string[] = [
  'this.bgScoreboard.relocalize|',
  'this.syncDailyRewardsSurfaceLabels|',
  'this.wocMarketWindow.relocalize|',
  'this.storePromoCard.relocalize|',
  'this.refreshKeybindLabels|',
  'this.questTracker.relocalize|',
  'this.delveTracker.relocalize|',
  'this.riftTracker.relocalize|',
  'this.partyFramesPainter.relocalize|',
  'this.raidBossGuideWindow.relocalize|',
  'this.mapPainter.relocalize|',
  'this.delvePainter.relocalize|',
  'this.riftPainter.relocalize|',
  // One arm for every MovableFrame in the HUD: the three unit frames and the
  // frames the "Unlock interface" option governs all register with the same
  // coordinator, which forwards relocalize() to each of them (superseding the
  // three per-mover arms the pre-merge release listed).
  'this.interfaceUnlock.relocalize|',
  'this.targetAurasWindow.relocalize|',
  'this.doomMeter.relocalize|',
  // The chat box's geometry chrome (the tab strip's move label, the resize
  // grip's name, the arrange-mode name chip, the mobile handle) is written
  // once at init by ChatGeometryController; its relocalize() rewrites them.
  'this.chatGeometry.relocalize|',
  'this.questlogWindow.render|this.questlogWindow.isOpen',
  "this.renderBags|$('#bags').style.display !== 'none'",
  // The four service windows (copper vendor, heroic quartermaster, train,
  // unbind) repaint through the shared helper; its per-window open-plus-shown
  // guards are pinned by tests/train_window_hud.test.ts, since this half only
  // sees refreshLocalizedDynamicUi's OWN statement-position calls.
  'this.repaintOpenServiceWindows|',
  'this.renderTownFocus|this.townFocusOpen',
  'this.marketWindow.render|this.marketWindow.isOpen',
  'this.bankWindow.render|this.bankWindow.isOpen',
  'this.deedsWindow.render|this.deedsWindow.isOpen',
  'this.professionsWindow.render|this.professionsWindow.isOpen',
  // The journal's relocalize gates itself (isOpen inside) and additionally
  // clears the standing ready announcement, whose text was minted in the OLD
  // locale and no flip would re-mint (Phase 14).
  'this.harvestJournalWindow.relocalize|',
  // The plant sheet's relocalize gates itself (paint only while open), so the
  // arm carries no guard of its own.
  'this.plantSheetWindow.relocalize|',
  // The Perfecting window's relocalize gates itself the same way; its repaint
  // signature is ids/ranks/counts (text-independent), so the arm forces the
  // one rebuild (Masterwrought phase 14).
  'this.perfectingWindow.relocalize|',
  // The Reliquary cold window is signature-gated (lastSig); language switch
  // must force render while open so curator rank chrome and shelf labels re-t().
  'this.reliquaryWindow.render|this.reliquaryWindow.isOpen',
  // The crafting window's repaint memos are all text-independent (station
  // set, reagent sig, profession surface sig), so an open window kept the
  // previous locale until data moved; the forced rebuild re-runs every t(),
  // identity card included (the phase 22 QA arm).
  "this.renderCrafting|$('#crafting-window').style.display === 'flex'",
  'this.updateDeedTracker|',
  // The Reliquary tracker is the same always-on strip: its header label, hints,
  // and per-row page names all resolve at paint, so one forced repaint here
  // keeps the strip from showing the previous language for up to a slow tick.
  'this.updateReliquaryTracker|',
  'this.charWindow.renderIfOpen|',
  'this.arenaWindow.relocalize|',
  'this.dungeonFinderWindow.relocalize|',
  'this.dungeonFinderProposalPopup.relocalize|',
  'this.bgProposalPopup.relocalize|',
  'this.questDialog.relocalize|',
  'this.calendarWindow.relocalize|',
  'this.mailboxWindow.relocalize|',
  'this.socialWindow.relocalize|',
  'this.cardDuelWindow.relocalize|',
  'this.spellbookWindow.relocalize|',
  'this.barEditorWindow.relocalize|',
  'this.lockpickController.relocalize|',
  'this.tutorial.relocalize|',
  'this.bootcamp.relocalize|',
  'this.noticeboardPopup.relocalize|',
  'this.guildBoardWindow.relocalize|',
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
 *
 * The vocabulary is matched as a PREFIX **or** a SUFFIX, which is the widening
 * the Masterwrought localized-search unit paid for. The prefix-only form read as
 * a shape rule and was really a spelling rule: `market_window.ts`'s
 * `searchEcho` cached a search string resolved from LOCALIZED item names, was
 * compared before an early return exactly like every row below, and was never
 * asked the question, purely because its memo word sits at the end of the name.
 * After a language switch it served the previous locale's substitution, which
 * for that surface is worse than the empty result it exists to avoid.
 *
 * Measured over the whole `src/ui` tree, the suffix half adds exactly ONE
 * discovery beyond the prefix family (`hud.ts`'s `targetDiscordSig`, a real
 * signature this guard could not see before), so the false-positive cost of the
 * widening is nil. What it cannot do is catch a memo named after neither: that
 * is a naming convention this file cannot enforce, and the honest limit is
 * written in the limits block at the top rather than papered over by matching
 * every private field (measured: 308 gated private fields tree-wide against 106
 * here, i.e. a registry nobody could keep green).
 */
const MEMO_DECL =
  /\bprivate\s+(?:readonly\s+)?((?:(?:last|prev|known|painted)[A-Z]\w*)|(?:\w*(?:Echo|Memo|Cache|Cached|Sig|Signature)))\b/g;

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
  for (const { file, source } of uiSources) {
    if (!EMITS_TEXT.test(source)) continue;
    const declared = [...source.matchAll(MEMO_DECL)].map((m) => m[1]);
    // A memo is only a REPAINT gate when the module compares it. A retained
    // value that is merely written and read back (a cached ref, a latch the
    // painter re-reads) suppresses nothing on its own.
    // The comparison may go THROUGH a member of the memo, which is the other
    // half of the hole the localized-search unit found: `searchEcho` is a
    // record, and its gate reads `this.searchEcho?.typed === ...` plus
    // `this.searchEcho.lang === lang`, so a matcher demanding the field be
    // compared WHOLE missed it on shape even before the name family did. A
    // multi-field memo is the normal way to key a cache on more than one thing,
    // so this is the shape a widened name family most needs to see.
    const gating = [
      ...new Set(
        declared.filter((memo) =>
          new RegExp(`[!=]==\\s*this\\.${memo}\\b[?.\\w]*|this\\.${memo}[?.\\w]*\\s*[!=]==`).test(
            source,
          ),
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
    file: 'hud/battleground/battleground_scoreboard_painter.ts',
    memos: ['lastSig'],
    answer: 'this.bgScoreboard.relocalize',
    why: 'one signature over the whole match strip (score, timer, roster), so every localized label on it would sit in the old locale until the next score or tick moved the signature',
  },
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
    file: 'bootcamp.ts',
    memos: ['lastCounts', 'lastFocus'],
    answer: 'this.bootcamp.relocalize',
    why: 'the gauntlet flag tally that keys the ferryman guide reactions; the locale never moves a flag count, and relocalize() repaints the card and clears the interact bubble memo so every localized string re-renders. lastFocus is the retained CoachFocus (quest and step IDS, no text), surfaced by the member-compared gate widening because it is read as `this.lastFocus?.questId === DEATH_LESSON_QUEST_ID`, which is an ordinary conditional on an id rather than a repaint signature; the localized prompt is gated by promptContentKey, which is exactly what relocalize() clears',
  },
  {
    file: 'arena_window.ts',
    memos: ['lastSig'],
    answer: 'this.arenaWindow.relocalize',
    why: 'the offline sentinel or a JSON of bracket ids and scores',
  },
  {
    file: 'bank_window.ts',
    // RE-POINTED at Bank Storage phase 18, and the two that left are worth the
    // sentence. lastRenderedTab and lastRenderedGuildView are still FIELDS here
    // and still scope the scroll restore, but this module no longer COMPARES
    // them: the comparison moved into src/ui/bank_chrome_layout_core.ts, which
    // the sweep does not reach (it declares no memo of its own and emits no
    // text). By this file's own rule a memo is a repaint gate only where it is
    // compared, so they correctly leave the classification. Nothing about the
    // language answer moves with them, because the row's own reasoning already
    // called them text-INDEPENDENT: they gate a scroll offset, never a string.
    // The full gate is what noticed; no targeted suite, source pin or mutation
    // battery in the phase could see it.
    memos: ['lastSig'],
    answer: 'this.bankWindow.render',
    why: 'capacity, purchased and bonus slot counts, the next expansion cost, the stored slots (both panes ride ONE sig, the guild arm and the activity log key appended). render() carries no self-gate, so the arm rebuilds',
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
    file: 'reliquary_window.ts',
    memos: ['lastAnnounced', 'lastSig'],
    answer: 'this.reliquaryWindow.render',
    why: 'catalog progress, Curator rank labels, shelf page lists, and grid chrome; lastAnnounced holds the LOCALIZED live-region line, but the fan-out render is argument-less (the player-driven arm), which recomputes and rewrites the region unconditionally, so the memo cannot pin stale-language text past a switch',
  },
  {
    file: 'dungeon_finder_proposal_popup.ts',
    memos: ['lastRemainingText', 'lastSig'],
    answer: 'this.dungeonFinderProposalPopup.relocalize',
    why: 'the proposal id and roles, plus a countdown string latch',
  },
  {
    file: 'hud/battleground/battleground_proposal_popup.ts',
    memos: ['lastRemainingText', 'lastSig'],
    answer: 'this.bgProposalPopup.relocalize',
    why: 'the offer id, my response and the accept tally, plus a countdown string latch',
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
    memos: ['lastSig', 'lastSellPriceRefSig', 'searchEcho'],
    answer: 'this.marketWindow.render',
    why: 'the listing ids, prices and the active tab; render() carries no self-gate. lastSellPriceRefSig (issue 3043) is the Sell tab price reference: render() rebuilds it via renderSell -> sellPriceRefHtml with the CURRENT language, the same full-rebuild path that already answers lastSig. searchEcho is answered DIFFERENTLY and deliberately: it memoizes the typed-to-sent Browse search translation, whose resolution reads localized item names, so it keys the active language into the memo itself (LANGUAGE_KEYED below verifies that structurally) rather than riding this arm. A repaint cannot fix it: the stale value is the string the client SENDS to the server, so it has to be re-resolved rather than re-painted',
  },
  {
    file: 'woc_market_window.ts',
    memos: ['lastSig', 'paintedWalletSig'],
    answer: 'this.wocMarketWindow.relocalize',
    why: "the Exchange listing rows, statuses and countdowns digest into lastSig; relocalize() self-gates on isOpen, rebuilds once, and render() re-latches the signature. paintedWalletSig is the Solana wallet card's locale-free connection and balance state that gates onWalletChanged(); the same render() repaints the card in the current language and re-latches the signature, so the one relocalize() arm answers both memos",
  },
  {
    file: 'hud/professions/professions_window.ts',
    memos: ['lastSig'],
    answer: 'this.professionsWindow.render',
    why: 'the known professions and their skill numbers; render() carries no self-gate',
  },
  {
    file: 'hud/professions/perfecting_window.ts',
    memos: ['lastSelectedSig', 'lastSig'],
    answer: 'this.perfectingWindow.relocalize',
    why:
      'the candidate rows (rank/Perfected/Legendary state text, the Worn ' +
      'chip), the detail pane (rank label, bind warning, materials heading ' +
      'and counts, the skill line, the action button label) and the empty ' +
      'state; both signatures digest ids, ranks and counts only, so a locale ' +
      'flip alone never moves them, and relocalize() forces the one repaint ' +
      'that re-latches both',
  },
  {
    file: 'hud/professions/harvest_journal_window.ts',
    memos: ['paintedSignature'],
    answer: 'this.harvestJournalWindow.relocalize',
    why:
      'every plot row (crop and bed names, stage and status labels, countdown ' +
      'sentence) plus both empty states; the signature is ids and numbers only, ' +
      'so a locale flip alone never moves it, and relocalize() clears the ' +
      'stale-locale ready announcement then forces the whole repaint that ' +
      're-latches it',
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
    file: 'movable_frame.ts',
    memos: ['lastBottom', 'lastHoverCursor', 'lastHoverEdge'],
    reason:
      'lastHoverCursor elides the inline resize-cursor write on edge hover. Its values are CSS cursor values (the game-styled var(--cursor-resize-*) tokens with their keyword fallbacks), which are never localized. lastHoverEdge is the FrameEdge id that cursor was set for (opposite edges share a cursor, so the elision compares both); an edge id is never text. lastBottom retains the frame bottom edge in visual px for reanchorBottom, a pure coordinate. Every MovableFrame label already rides the interface_unlock relocalize() fan-out arm; no memo holds text.',
  },
  {
    file: 'map_semantic_accessibility_core.ts',
    memos: ['lastHash', 'lastLanguage'],
    reason:
      'lastHash retains the text-independent marker summary signature, while lastLanguage is compared against getLanguage() in the same early-return guard. A locale switch always moves lastLanguage and rebuilds every localized label on the next map paint, so the gate is explicitly locale-aware rather than a stale-language hazard.',
  },
  {
    file: 'hud/quest/quest_tracker_controller.ts',
    memos: ['lastHtml'],
    reason:
      'lastHtml retains the last BUILT html (the repaint memo compares against it rather than the live innerHTML, so the island coach decorating painted rows in place no longer forces a rewrite-and-strobe every update). The built html embeds every localized string through t(), so a locale switch changes the freshly built side of the comparison and the tracker repaints by itself. Write-elision, not a data signature.',
  },
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
    file: 'guild_bank_window.ts',
    memos: ['prevReadOnly'],
    reason:
      'prevReadOnly gates nothing that is drawn: it is the demotion-edge detector deciding only whether the read-only note carries live-region semantics on THIS paint (a mid-view rank loss is voiced once; steady read-only repaints stay silent, the guild_bank_log_window lastAnnounced shape). The note text and every other string are rebuilt unconditionally on each paint, and the pane is repainted wholesale by BankWindow.render(), which the language fan-out already drives, so a locale switch relocalizes the whole Guild tab by itself. The edge cannot fire from a locale switch either: readOnly derives from the snapshot canEdit flag, not from any text.',
  },
  {
    file: 'bags_window.ts',
    memos: ['lastSortBaseline', 'ordinalCache'],
    reason:
      'ordinalCache (surfaced by the member-compared gate widening: it is read as `this.ordinalCache?.inv !== inventory`, so the whole-field matcher never saw it) holds no text of any kind. It is `{ inv, map }`, keyed on the inventory ARRAY IDENTITY and mapping each slot object to its ordinal NUMBER, rebuilt whenever the array reference changes; a locale switch neither moves the key nor changes a value, and nothing localized is stored. lastSortBaseline gates nothing that is drawn: it decides only whether the one-shot sort settle ANIMATION plays on this paint (armed by the Sort button, compared against the press-time INVENTORY signature because online the tidied inventory arrives with the heavy self snapshot, not the press repaint). fillGrid rebuilds every cell unconditionally on every paint, and the bags fan-out arm (this.renderBags) already drives a wholesale repaint on a locale switch, so the window relocalizes by itself; the signature reads no text at all (item ids, counts, cell hints), so a locale switch cannot even move it.',
  },
  {
    file: 'deed_tracker_painter.ts',
    memos: ['lastChip'],
    reason:
      'lastChip gates only the header ARIA presence swap (aria-expanded / aria-controls / aria-haspopup), which carries no player-visible text. Every string in this painter goes through the elided writer facet, which compares resolved text, and the fan-out drives it through this.updateDeedTracker.',
  },
  {
    file: 'reliquary_tracker_painter.ts',
    memos: ['lastChip'],
    reason:
      'lastChip gates only the header ARIA presence swap (aria-expanded / aria-controls / aria-haspopup), which carries no player-visible text. Every string in this painter goes through the elided writer facet, which compares resolved text, and the fan-out drives it through this.updateReliquaryTracker.',
  },
  {
    file: 'hud/woc_trade/woc_trade_controller.ts',
    memos: ['lastTradeSig'],
    reason:
      'the trade window repaint signature: it reads no text at all (offer structs, staged items and copper, acceptance flags, partner, the staged quote and consent structural state), so a locale switch cannot move it, and there is deliberately no fan-out arm, exactly as when the method lived on hud.ts. A live trade re-renders in the new locale on the next data motion (either offer, stake, or acceptance change; the standing-offer poll adoption; the 2s poll makes an ACTIVE deal converge within a beat). RE-JUDGED TWICE by the UX-honesty pass, which added the consent row and the quote review to this arm: both of those faces are deliberately STATIC (the staged quote waits for a human and polls keep, the consent row keeps the price outside the signature), so each can sit indefinitely in a stale locale, including a player who switches language to READ the terms and then accepts a label rendered in the language they left. The posture still stands, on narrower grounds: the consent SEND carries a boolean judged by the server, never the label text, and the surface is the short-lived two-player trade window. The polish pass owns the real fix, a self-gated relocalize() with form_draft.ts carrying the price field, if the stale-idle residue is judged worth the behavior change.',
  },
  {
    file: 'hud.ts',
    memos: 'coordinator',
    reason:
      'the coordinator itself. Its own signature-gated arms are individually answered inside refreshLocalizedDynamicUi, which half 1 above pins EXACTLY, so pinning its two dozen unrelated memos here as well would only mean every hud.ts edit had to be re-approved in two places.',
  },
];

/**
 * Memos whose answer to the language question is that they KEY THE LOCALE
 * THEMSELVES, rather than being repainted by a fan-out arm. A repaint answers a
 * memo whose staleness is on screen; it cannot answer one whose stale value has
 * already left the client (a search string sent to the server), so that shape
 * has to re-resolve instead, and the way it does that is by putting the active
 * language in its own cache key.
 *
 * Listed here so the claim is CHECKED rather than asserted in prose: the arm
 * below reads the real source and requires both halves (the module reads the
 * active language, and the memo's own key or gate carries it). Without that, "it
 * keys the language" is exactly the sort of sentence that stays in a row's `why`
 * long after the key stopped including it.
 *
 * THE THIRD FORM, added by the Masterwrought target-flair unit. The two shapes
 * above both put the language on the READ side (a member compared off the memo, or
 * the memo BEING the latch). The commonest shape puts it on the WRITE side instead:
 * a scalar signature string with the locale built INTO it, which no comparison-site
 * matcher can see. `memoValueSources` below covers that by resolving what actually
 * flows into the memo's value. It is what `hud.ts`'s `targetDiscordSig` needed, and
 * that memo is the reason this list is no longer only about `src/ui` windows: it
 * sits inside the coordinator, whose blanket 'coordinator' opt-out in
 * NOT_A_LANGUAGE_GATE is skipped BY NAME, so the classification arms could not
 * report it. A row here is checked whatever the file, which is the narrow way to
 * hold one memo inside that file without pinning two dozen unrelated ones.
 */
const LANGUAGE_KEYED: ReadonlyArray<{
  readonly file: string;
  readonly memo: string;
  readonly why: string;
}> = [
  {
    file: 'hud.ts',
    memo: 'targetDiscordSig',
    why: "the target frame's flair line (the role tag, the Discord rank rung, the dev rung, and the [AI] mark plus its screen-reader label). Every other field in the signature is identity data a locale switch cannot move, so keyed on identity alone the line sat in the PREVIOUS locale until that player's flair happened to change; the rebuild itself was always correct, it just never ran, so the fix is the key rather than a fan-out arm. The value is built by targetFlairSignature (src/ui/target_flair_line_view.ts), whose paired suite drives the difference across two locales on byte-identical identity data",
  },
  {
    file: 'market_window.ts',
    memo: 'searchEcho',
    why: 'the typed-to-sent Browse search translation: the resolution reads localized item names, so the same typed string resolves to a different search per locale. Keyed on the text alone it served the previous locale substitution after a switch, which for this surface is a WRONG result set rather than the empty one the untranslated path gives',
  },
  {
    file: 'map_semantic_accessibility_core.ts',
    memo: 'lastLanguage',
    why: 'the marker summary is gated on a text-independent hash plus this explicit language latch, compared against getLanguage() in the same early-return guard, so a locale switch always moves the gate and the labels rebuild on the next map paint',
  },
];

const require_ = createRequire(import.meta.url);
// The TypeScript 6 JS API wrapper (CONTRIBUTING.md, "TypeScript toolchain"): the
// `tsc` binary is the TS7 native one and exposes no createSourceFile.
// biome-ignore lint/suspicious/noExplicitAny: the JS API ships no types at this entry.
const ts = require_('typescript') as any;

/**
 * Everything that flows into a value assigned to `this.<memo>`: the assigned
 * expression, plus the initializer of every same-method local it transitively
 * names, as source text.
 *
 * AST, NOT A REGEX, and the reason is the real shape it has to see. `hud.ts`
 * writes `this.targetDiscordSig = sig`, where `sig` is `targetFlairSignature(flair)`
 * and `flair` is the object literal holding `language: getLanguage()`. That is TWO
 * hops through locals, in a method 60 lines long, inside an 18k-line file: a text
 * scan for "getLanguage near the memo" answers on proximity, which is not the
 * question. Resolving the chain answers the question that matters, which is whether
 * the locale can reach the stored value at all.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not follow the chain out of the method
 * (a language read inside `targetFlairSignature` itself would be invisible here,
 * and correctly so, since that is the callee's contract and its own suite's job),
 * and it over-collects rather than under-collects inside the method (locals are
 * gathered from the whole function body, nested closures included, so a shadowed
 * name contributes both initializers). Over-collecting can only make a row PASS
 * that a narrower read would fail; the fixture arms below pin the failing
 * direction, which is the one a guard is for.
 */
function memoValueSources(file: string, source: string, memo: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: untyped TS AST nodes.
  const enclosingFunction = (node: any): any => {
    // biome-ignore lint/suspicious/noExplicitAny: untyped TS AST nodes.
    let n: any = node.parent;
    while (
      n &&
      !ts.isMethodDeclaration(n) &&
      !ts.isConstructorDeclaration(n) &&
      !ts.isFunctionDeclaration(n) &&
      !ts.isFunctionExpression(n) &&
      !ts.isArrowFunction(n)
    ) {
      n = n.parent;
    }
    return n ?? sf;
  };
  // biome-ignore lint/suspicious/noExplicitAny: untyped TS AST nodes.
  const visit = (node: any): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.left.name.text === memo
    ) {
      const fn = enclosingFunction(node);
      const locals = new Map<string, string>();
      // biome-ignore lint/suspicious/noExplicitAny: untyped TS AST nodes.
      const collect = (n: any): void => {
        if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
          locals.set(n.name.text as string, n.initializer.getText(sf) as string);
        }
        ts.forEachChild(n, collect);
      };
      collect(fn);
      let text = node.right.getText(sf) as string;
      const pulled = new Set<string>();
      // Bounded: each local is pulled in at most once, so the loop terminates
      // even on a circular pair of declarations.
      for (let hop = 0; hop < 8; hop++) {
        let grew = false;
        for (const [name, init] of locals) {
          if (pulled.has(name)) continue;
          if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
          pulled.add(name);
          text += `\n${init}`;
          grew = true;
        }
        if (!grew) break;
      }
      out.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Whether the locale can reach the value stored in `this.<memo>`. */
function memoValueReadsLanguage(file: string, source: string, memo: string): boolean {
  return memoValueSources(file, source, memo).some((s) => /\bgetLanguage\(/.test(s));
}

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

  it('loads all three locale-chunk families before it flips the language', () => {
    // This registry is about REPAINT, and a repaint cannot show bytes that are
    // not resident: `changeLanguage` must await the catalog chunk AND every
    // content channel (deed names, reliquary page names) before setLanguage,
    // or the fan-out repaints the picked locale with the previous one's page
    // and deed names. Nothing in half 1 or half 2 covers chunk loading, so a
    // dropped loader would leave every other pin here green. The content
    // channels ride CONTENT_LOCALE_CHANNEL_ENSURERS; the membership pin below
    // holds that list, and this regex holds the await shape. Matched by regex
    // over the function body so a reflow cannot break it.
    const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    const start = main.indexOf('async function changeLanguage(');
    expect(start, 'changeLanguage was renamed or removed').toBeGreaterThan(-1);
    const end = main.indexOf('\n}\n', start);
    expect(end, 'changeLanguage body did not close').toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /await Promise\.all\(\[\s*ensureLocaleLoaded\(selected\),\s*\.\.\.CONTENT_LOCALE_CHANNEL_ENSURERS\.map\(\s*\(ensure\)\s*=>\s*ensure\(selected\),?\s*\),?\s*\]\);/,
    );
    // The await must PRECEDE the flip: hoisting setLanguage above it would
    // repaint the picked locale with the previous locale's resident chunks.
    // indexOf on a missing flip returns -1, which fails the comparison loudly.
    expect(body.indexOf('await Promise.all([')).toBeLessThan(body.indexOf('setLanguage(selected)'));
  });

  it('registers both content channels in CONTENT_LOCALE_CHANNEL_ENSURERS, by identity', async () => {
    // The await-shape regex above proves main.ts drains the registry; this pin
    // proves the registry actually CONTAINS every content channel, so removing
    // one from the list (which would quietly stop its chunk loading at all
    // three main.ts sites) reds here. Identity, not name: a re-export of the
    // wrong function would pass a name check.
    const [{ CONTENT_LOCALE_CHANNEL_ENSURERS }, { ensureDeedLocalesLoaded }, reliquary] =
      await Promise.all([
        import('../src/ui/locale_channels'),
        import('../src/ui/deed_i18n'),
        import('../src/ui/reliquary_i18n'),
      ]);
    expect(CONTENT_LOCALE_CHANNEL_ENSURERS).toContain(ensureDeedLocalesLoaded);
    expect(CONTENT_LOCALE_CHANNEL_ENSURERS).toContain(reliquary.ensureReliquaryLocalesLoaded);
    // Distinctness: a channel re-exporting the other's ensure would satisfy
    // both toContain rows and the length while loading only one table.
    expect(ensureDeedLocalesLoaded).not.toBe(reliquary.ensureReliquaryLocalesLoaded);
    // Snug: exactly the two shipped channels today, so an accidental duplicate
    // (double fetch per flip) or a silent drop both fail.
    expect(CONTENT_LOCALE_CHANNEL_ENSURERS).toHaveLength(2);
  });

  it('wires the fan-out to the woc:languagechange event exactly once', () => {
    const wiring = strippedHudSource.match(/document\.addEventListener\('woc:languagechange'/g);
    expect(wiring, 'hud.ts no longer listens for woc:languagechange').toHaveLength(1);
    expect(strippedHudSource).toContain(
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
      // The SUFFIX half. The first is the exact declaration that escaped this
      // matcher and shipped the stale-locale search (its post-fix form is the
      // second, which must still be DISCOVERED: what makes it safe is the
      // language in its key, verified by LANGUAGE_KEYED, never a rename).
      '  private searchEcho: { typed: string; sent: string } | null = null;',
      '  private searchEcho: { typed: string; lang: string; sent: string } | null = null;',
      '  private targetDiscordSig = 1;',
      '  private walletMemo = 1;',
      '  private rowCache = new Map();',
      '  private readonly bodySignature = 1;',
    ]) {
      expect(new RegExp(MEMO_DECL.source).test(decl), `MEMO_DECL missed ${decl}`).toBe(true);
    }
    for (const decl of [
      '  private lastsig = 1;',
      '  lastSig = 1;',
      '  private sig = 1;',
      // The suffix half is capitalized on purpose: a bare lowercase word is an
      // ordinary field name, not a memo spelling, and matching it would drag in
      // most of the tree (measured: 308 gated private fields against 106 here).
      '  private echo = 1;',
      '  private cache = new Map();',
      '  searchEcho = 1;',
    ]) {
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
    const corpus = uiTsFiles;
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
    // BOTH classifications, which is the whole point of the row type's contract
    // above: an exemption is granted about SPECIFIC fields. Running this over
    // ANSWERED alone left the cheaper classification unchecked, so an EXEMPT
    // module could grow a real data signature and inherit an exemption argued
    // about two write-elision memos, with no red anywhere. Found in Bank Storage
    // phase 15 QA, where daily_rewards_window.ts had grown exactly that.
    // 'coordinator' is hud.ts's deliberate opt-out and is skipped by name.
    const classified: ReadonlyArray<{ file: string; memos: readonly string[] | 'coordinator' }> = [
      ...ANSWERED,
      ...NOT_A_LANGUAGE_GATE,
    ];
    for (const row of classified) {
      if (row.memos === 'coordinator') continue;
      const found = discoveredByFile.get(row.file);
      if (!found) continue; // reported by the stale-row test above
      if (found.memos.join(',') !== [...row.memos].sort().join(',')) {
        drift.push(
          `${row.file}: registry ${row.memos.join(',')} vs source ${found.memos.join(',')}`,
        );
      }
    }
    // The exempt rows hold the SAME pin: their own doc says the exemption was
    // granted about specific fields, so a module that grows a second compared
    // memo must not inherit an answer given about a different one. Without
    // this arm the new gate would be absorbed silently ('coordinator' rows
    // are the one shape with no field list to compare).
    for (const row of NOT_A_LANGUAGE_GATE) {
      if (row.memos === 'coordinator') continue;
      const found = discoveredByFile.get(row.file);
      if (!found) continue; // reported by the stale-row test above
      if (found.memos.join(',') !== [...row.memos].sort().join(',')) {
        drift.push(
          `${row.file}: exemption ${row.memos.join(',')} vs source ${found.memos.join(',')}`,
        );
      }
    }
    expect(
      drift,
      'a classified module gained or lost a repaint memo. A NEW memo is a NEW gate and needs the language question answered about it, not inherited from the answer given about a different field:\n' +
        drift.join('\n'),
    ).toEqual([]);
  });

  it('verifies every LANGUAGE_KEYED claim against the real source', () => {
    // Two halves, because either alone is satisfiable by accident: the module
    // must READ the active language, and the memo's own key or gate must CARRY
    // it. A memo that reads getLanguage() somewhere else in the file and keys
    // only its text is precisely the bug this list exists to say has been fixed,
    // and the third form's fixture arms below pin that that reading is refused.
    const failures: string[] = [];
    for (const row of LANGUAGE_KEYED) {
      const found = uiSources.find((s) => s.file === row.file);
      if (!found) {
        failures.push(`${row.file}: not in the src/ui walk`);
        continue;
      }
      const discoveredMemos = discoveredByFile.get(row.file)?.memos ?? [];
      if (!discoveredMemos.includes(row.memo)) {
        failures.push(`${row.file}: ${row.memo} is no longer a discovered repaint memo`);
      }
      if (!/\bgetLanguage\(/.test(found.source)) {
        failures.push(`${row.file}: never reads getLanguage()`);
      }
      // Three accepted forms, two on the READ side and one on the WRITE side.
      // The gate compares a language-named member OFF the memo
      // (`this.searchEcho.lang === lang`); or the memo IS the language latch
      // (`=== this.lastLanguage`); or the locale is built INTO the value the memo
      // stores, which is what a scalar signature string does and what no
      // comparison-site matcher can see. Anything else is a text-only key.
      const keyedOffMemo = new RegExp(
        `this\\.${row.memo}[?.\\w]*\\.lang\\w*\\s*[!=]==|[!=]==\\s*this\\.${row.memo}[?.\\w]*\\.lang\\w*`,
      ).test(found.source);
      const memoIsTheLatch = /lang/i.test(row.memo);
      const keyedInTheValue = memoValueReadsLanguage(row.file, found.source, row.memo);
      if (!keyedOffMemo && !memoIsTheLatch && !keyedInTheValue) {
        failures.push(`${row.file}: ${row.memo} neither compares a language value nor stores one`);
      }
      expect(row.why.length, `LANGUAGE_KEYED ${row.file} needs a written reason`).toBeGreaterThan(
        80,
      );
    }
    expect(
      failures,
      'a LANGUAGE_KEYED row no longer describes the source it names:\n' + failures.join('\n'),
    ).toEqual([]);
  });

  // The third form's own proofs, driven over fixture SOURCE rather than the tree.
  // Over the real tree every LANGUAGE_KEYED row passes today, so no assertion there
  // can tell a working detector from one that returns true unconditionally. These
  // four cases are the shapes it has to separate, and the first is the exact
  // pre-fix and post-fix pair of the defect that motivated the form.
  describe('memoValueSources: the WRITE-side language key', () => {
    const wrap = (body: string): string =>
      [
        'class X {',
        '  private targetDiscordSig = "";',
        `  m(target: T): void {`,
        body,
        '  }',
        '}',
      ].join('\n');
    const reads = (body: string): boolean =>
      memoValueReadsLanguage('fixture.ts', wrap(body), 'targetDiscordSig');

    it('CATCHES the shipped pre-fix signature: identity fields only', () => {
      // Exactly what hud.ts stored before the fix. Nothing renders wrong from
      // this, which is why no behavior test anywhere failed on it; the line just
      // never re-ran after a language switch.
      expect(
        reads(
          [
            '    const tier = target.discordTier ?? 0;',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source quoting a real template literal, not a template.
            '    const sig = `${tier}|${target.discordName ?? ""}|${target.aiAccount ? 1 : 0}`;',
            '    if (sig === this.targetDiscordSig) return;',
            '    this.targetDiscordSig = sig;',
          ].join('\n'),
        ),
      ).toBe(false);
    });

    it('PASSES the post-fix shape, through TWO hops of same-method locals', () => {
      // The real chain: memo <- sig <- targetFlairSignature(flair) <- flair's
      // object literal <- getLanguage(). A one-hop resolver reports this as
      // unkeyed, so the hop count is load-bearing, not incidental.
      expect(
        reads(
          [
            '    const flair = { language: getLanguage(), tier: target.discordTier ?? 0 };',
            '    const sig = targetFlairSignature(flair);',
            '    if (sig === this.targetDiscordSig) return;',
            '    this.targetDiscordSig = sig;',
          ].join('\n'),
        ),
      ).toBe(true);
    });

    it('CATCHES a method that reads the language for something else entirely', () => {
      // The decisiveness arm, and the one that separates this form from the cheap
      // version of itself. "The enclosing method mentions getLanguage()" is true
      // here, and hud.ts is a file where it would be true almost anywhere; the
      // question is whether the locale reaches the STORED VALUE. It does not: the
      // banner is painted and dropped, and the signature never sees it.
      expect(
        reads(
          [
            '    const banner = t("x", { lang: getLanguage() });',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source quoting a real template literal, not a template.
            '    const sig = `${target.discordTier ?? 0}`;',
            '    this.bannerEl.textContent = banner;',
            '    this.targetDiscordSig = sig;',
          ].join('\n'),
        ),
      ).toBe(false);
    });

    it('CATCHES a rename: the field name carries no evidence at all', () => {
      // A signature renamed `targetDiscordLangSig` would satisfy the memoIsTheLatch
      // form on its NAME. This form reads only the value, so it stays false.
      const renamed = [
        'class X {',
        '  private targetDiscordLangSig = "";',
        '  m(target: T): void {',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source quoting a real template literal, not a template.
        '    const sig = `${target.discordTier ?? 0}`;',
        '    this.targetDiscordLangSig = sig;',
        '  }',
        '}',
      ].join('\n');
      expect(memoValueReadsLanguage('fixture.ts', renamed, 'targetDiscordLangSig')).toBe(false);
    });

    it('reports every assignment site, so a reset to "" cannot mask a keyed write', () => {
      // hud.ts assigns the memo twice (the empty reset on the hidden branch, and
      // the real signature). The check is a some(), so the reset contributes a
      // site with no language and the keyed one still answers.
      const sources = memoValueSources(
        'fixture.ts',
        wrap(
          [
            '    if (target.kind !== "player") { this.targetDiscordSig = ""; return; }',
            '    const flair = { language: getLanguage() };',
            '    this.targetDiscordSig = targetFlairSignature(flair);',
          ].join('\n'),
        ),
        'targetDiscordSig',
      );
      expect(sources).toHaveLength(2);
      expect(sources.filter((s) => /getLanguage\(/.test(s))).toHaveLength(1);
    });
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
      // 6 as of the guild bank member read-only view: guild_bank_window's
      // `prevReadOnly` is the same announcement-only shape (it decides whether
      // the read-only note is a live region on the demotion-edge paint, never
      // what is drawn; BankWindow.render repaints the pane wholesale and the
      // fan-out already drives it).
      // 7 as of the Reliquary HUD tracker: reliquary_tracker_painter carries the
      // deed tracker's `lastChip` memo verbatim (the header ARIA presence swap,
      // no player text), and the fan-out drives it through
      // this.updateReliquaryTracker.
      // 8 as of the bags Sort button: bags_window's `lastSortBaseline`
      // gates only whether the one-shot settle ANIMATION plays (which draws
      // no text); fillGrid rebuilds every cell unconditionally and the
      // existing bags fan-out arm repaints the window wholesale on a locale
      // switch.
      // 9 as of the woc_trade extraction: the trade window's `lastTradeSig`
      // moved verbatim off the coordinator (where the blanket hud.ts row
      // covered it) into hud/woc_trade/woc_trade_controller.ts, carrying the
      // coordinator-era posture unchanged; the row states the reasoning and
      // the deferred relocalize call.
      // 10 as of the v0.38.0 sync merge, which brought in map semantic
      // accessibility: lastHash is paired with lastLanguage in the same
      // guard, so getLanguage() changing explicitly invalidates the
      // localized summary without a separate fan-out arm. Each side of the
      // merge had added one row (woc_trade above, the map core here), so the
      // merged list carries both.
      // 11 as of the quest tracker's lastHtml repaint memo (the island coach
      // glow strobe fix): the memo holds the freshly BUILT html, which
      // embeds every t() string, so a locale switch moves the comparison
      // itself and the tracker repaints with no fan-out arm.
      // 12 as of the v0.41.0 sync merge, which folded in the edge-resize
      // hover row: movable_frame's `lastHoverCursor` elides an inline CSS
      // cursor-keyword write and can never hold text; the frame's t() labels
      // already ride the interface_unlock relocalize() arm.
    ).toBe(12);
  });

  it('gives every relocalize() in src/ui a caller in the fan-out', () => {
    // The bug that started #2529: card_duel_window.ts already HAD a correct
    // relocalize() and nothing in the repo ever called it. A relocalize with no
    // caller is dead code that reads like a working feature.
    const armCalls = new Set(scan.sites.map((s) => s.call));
    const uncalled: string[] = [];
    const scanned: string[] = [];
    const ownedRelocalizeClasses = relocalizeOwnedClasses(armCalls);
    for (const { file, source } of uiSources) {
      if (!/^\s{2}relocalize\(/m.test(source)) continue;
      scanned.push(file);
      const cls = /export class (\w+)/.exec(source)?.[1] ?? '';
      // Map the class back to the Hud field that holds it, then look for an arm
      // on that field. A module whose relocalize is reached through a wrapper
      // (LockpickWindow via LockpickController) is credited by the wrapper's arm.
      const fields = hudFieldsByClass.get(cls) ?? [];
      const credited =
        fields.some((f) => armCalls.has(`this.${f}.relocalize`)) || ownedRelocalizeClasses.has(cls);
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
/** The other way a Hud field gets filled: a BUILDER in a sibling module
 *  constructs the painter and hands it back, which is how the mobile action ring
 *  is composed now that its construction lives behind the action_bar seam. Chase
 *  the same chain the coordinator does (field <- builder result <- builder
 *  function <- the module that news the class) so the credit stays a proof, not
 *  an exemption. */
function relocalizeOwnedClasses(armCalls: ReadonlySet<string>): Set<string> {
  const owned = new Set<string>();
  for (const armCall of armCalls) {
    if (!armCall.endsWith('.relocalize')) continue;
    for (const cls of builderOwnedClasses(armCall)) owned.add(cls);
    for (const cls of wrapperOwnedClasses(armCall)) owned.add(cls);
  }
  return owned;
}

function builderOwnedClasses(armCall: string): Set<string> {
  const owned = new Set<string>();
  const field = armCall.slice('this.'.length, -'.relocalize'.length);
  const hud = strippedHudSource;
  const assigned = new RegExp(`\\b${field}\\s*=\\s*(\\w+)\\.\\w+;`).exec(hud);
  if (!assigned) return owned;
  const built = new RegExp(`\\b${assigned[1]}\\s*=\\s*(\\w+)\\(`).exec(hud);
  if (!built) return owned;
  for (const { source } of uiSources) {
    if (!new RegExp(`export function ${built[1]}\\b`).test(source)) continue;
    for (const [, cls] of source.matchAll(/\bnew (\w+)\(/g)) owned.add(cls);
    return owned;
  }
  return owned;
}

function wrapperOwnedClasses(armCall: string): Set<string> {
  const owned = new Set<string>();
  const field = armCall.slice('this.'.length, -'.relocalize'.length);
  const constructed = new RegExp(`\\b${field}\\s*=\\s*new (\\w+)\\(`).exec(strippedHudSource);
  if (!constructed) return owned;
  for (const { source } of uiSources) {
    if (!new RegExp(`export class ${constructed[1]}\\b`).test(source)) continue;
    // The wrapper must both hold one of these and forward to it.
    if (!/\.relocalize\(\)/.test(source)) return owned;
    if (/:\s*\b/.test(source)) owned.add('');
    for (const match of source.matchAll(/:\s*(\w+)\b|\bnew (\w+)\(/g)) {
      const cls = match[1] ?? match[2];
      if (cls) owned.add(cls);
    }
    return owned;
  }
  return owned;
}
