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
//     MEASURED ON hud.ts at the 19D review round, because closing that file's
//     by-NAME skip made its by-SPELLING skip the surviving one: 88 private
//     fields there are compared with === or !==, 46 match the name family (the
//     registered set exactly, so the union pin below is honest) and 42 do not.
//     Every one of the 42 was read; none gates localized text (they drive a
//     class toggle, a zoom reset, a repaint call). So the limit costs nothing on
//     this file today, and it is recorded rather than argued away because the
//     ruling's own reasoning is that an unexamined skip on the largest
//     hand-authored file is not acceptable.
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
import { methodBody } from './helpers/method_body';
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
  // The coordinator's OWN signature-gated memos, cleared as one arm. This is
  // what replaced the blanket hud.ts exemption: every memo it clears carries
  // its own row below (masterwrought qr-19-hud-coordinator-fanout-exemption).
  'this.relocalizeCoordinatorMemos|',
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
  // THE COORDINATOR'S OWN MEMOS (masterwrought qr-19-hud-coordinator-fanout-exemption).
  // hud.ts used to carry a single blanket exemption row here; these are the
  // 46 compared repaint memos it hid, classified one by one. Seven of them
  // were real defects and are fixed by the relocalizeCoordinatorMemos arm.
  {
    file: 'hud.ts',
    memos: [
      'lastPlayerFrameHp',
      'lastPlayerFrameMaxHp',
      'lastPlayerFrameResource',
      'lastPlayerFrameMaxResource',
    ],
    answer: 'this.relocalizeCoordinatorMemos',
    why: "the player unit frame's raw hp and resource pair, current and max. All four are bare numbers a locale cannot move, while the health and resource TEXT they gate is built by unitFrameCurrentMaxText, whose digits route through formatNumber against the active language; the arm clears all four to NaN, which no live value can equal, so the next painted frame re-resolves both strings (and the absorb suffix, which is elided on the health text) in the new locale",
  },
  {
    file: 'hud.ts',
    memos: ['lastResting'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: "a single boolean, true for ANY seated state, collapsing sit / eat / drink / eat-and-drink into one flag, while the rest badge's TOOLTIP it gates is t(rest.labelKey) over four different keys. Worse than an ordinary stale string: the static-shell pass re-stamps #pf-rest from its data-i18n-title, so a switch while eating actively replaced the live Eating tooltip with the static Resting one. Cleared to null (the field is boolean or null for exactly this), so the next frame rewrites the right key",
  },
  {
    file: 'hud.ts',
    memos: ['lastAnnouncedTargetId'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: "the id of the last target announced into the #target-live region, tracked apart from the paint cadence so the announcement fires on a real target change. The sentence it gates is a fully localized t('hudChrome.unitFrame.targetAnnounce'), written directly rather than through the elided writer, so a switch left the live region holding the previous locale for as long as that target stayed selected. Cleared to null, which re-announces the current target in the new language. TWO behaviour notes the clear carries, stated rather than found later: it also forfeits the no-target CLEAR EDGE for one frame (that branch is gated on the memo being non-null, so a target lost between the switch and the next update leaves the region holding the pre-switch sentence), and it deliberately RE-ANNOUNCES a target that did not change. Both accepted: the window is one frame, and a browse-mode reader can reach stale region text",
  },
  {
    file: 'hud.ts',
    memos: ['lastCompassFacing', 'lastCompassHeading'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: "the player facing in radians and the nearest rose-point ID. Both are geometry: compass.ts states outright that the id is not display text. They gate the heading readout's t(`hudChrome.compass.${heading}`), and updateCompass early-returns on the facing before it ever reaches that write, so a player standing still kept the old locale's cardinal indefinitely. The arm clears both AND relabels the eight rose spans, which are written once when the pool is built and would otherwise never be rewritten at all",
  },
  {
    file: 'hud.ts',
    memos: ['lastMailUnread'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: 'one integer, the clamped unread letter count. Past it the block writes the badge digits through formatNumber and, more to the point, two localized strings on the envelope button: the aria-label and the title, both t() with the count interpolated. Cleared to -1, the same sentinel the mailArrived and mailResult events already use, which no real count can equal',
  },
  {
    file: 'hud.ts',
    memos: ['lastLootSettingsSig'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: 'the Loot Settings repaint signature: a master-loot boolean, the looter and leader pids, the threshold ID and the member pid:name list. Every one of those is text-independent, and past the gate the whole window is rebuilt from t() (the title, the Loot Method and Roll Threshold labels, the method and threshold options, the read-only member view). Cleared to the empty string, which no real signature can equal because every real one carries separators',
  },
  {
    file: 'hud.ts',
    memos: ['lastPetBarSig'],
    answer: 'this.relocalizeCoordinatorMemos',
    why: "the pet action bar signature: pet id, primary or secondary, owner class, mode id, two cooldown signatures of integer seconds and autocast flags, plus two booleans. Past the gate the bar's DOM is rebuilt from scratch and every button caption and both tooltip halves are fresh t() calls. Cleared to the empty string, which no real signature can equal",
  },
  {
    file: 'hud.ts',
    memos: ['lastCraftingCastSig', 'lastCraftingReagentSig', 'lastCraftingStationSig'],
    answer: 'this.renderCrafting',
    why: "the crafting window's cast, reagent and station signatures: cast ids and integer progress, reagent ids and counts, the station set. All text-independent, and the fan-out already forces one full renderCrafting rebuild on a switch when the window is open, which re-runs every t() including the identity card",
  },
  {
    file: 'hud.ts',
    memos: ['lastCharSheetSig', 'lastProfessionSurfaceSig'],
    answer: 'this.charWindow.renderIfOpen',
    why: "the character sheet's stat signature and the profession surface signature: stat numbers, ids, ranks and counts, none of which a locale moves. Both gate the same window, and the fan-out drives charWindow.renderIfOpen(), which rebuilds it wholesale with fresh t() when it is open",
  },
  {
    file: 'hud.ts',
    memos: ['lastPartySig'],
    answer: 'this.partyFramesPainter.relocalize',
    why: "the party roster signature: member pids, hp and resource numbers and role ids. The localized text on those frames is repainted by the partyFramesPainter.relocalize() arm the fan-out already drives, which clears the painter's own memo rather than relying on this one",
  },
  {
    file: 'hud.ts',
    memos: ['lastTownFocusSig'],
    answer: 'this.renderTownFocus',
    why: "the Town Focus signature: the allocation, the budget and the in-town flag, all text-independent by design. The fan-out's own arm re-renders the panel when it is open, which was added for exactly this reason (the slow-band probe would otherwise leave it in the old locale until the player edited it)",
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
   * The memos the exemption was argued about. Pinned for the same reason the
   * ANSWERED rows are: an exemption is granted about SPECIFIC fields, and a
   * module that later grows a real data signature must not inherit an answer
   * that was given about a different one.
   *
   * There is no longer a whole-file opt-out. hud.ts carried one ('coordinator',
   * skipped BY NAME by both classification arms) until
   * qr-19-hud-coordinator-fanout-exemption closed it: a by-name skip on the
   * largest hand-authored file in the tree could not be argued away by the fact
   * that its fan-out arms are pinned elsewhere, and the audit that replaced it
   * found seven real defects. Rows are MEMO-SCOPED now, and a file may hold
   * several: the arms below require a file's rows to union to exactly its
   * discovered set, with no memo classified twice.
   */
  readonly memos: readonly string[];
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
  // RULED (qr-19-hud-coordinator-fanout-exemption, 2026-09-01, under
  // qr-19-best-for-project): the blanket `{ file: 'hud.ts', memos: 'coordinator' }`
  // row that stood HERE is REPLACED by the per-signature list below and in
  // ANSWERED above. Its stated reason was real (hud.ts's own fan-out arms are
  // pinned by half 1, so listing its unrelated memos meant re-approving every
  // hud.ts edit in two places) and it was still wrong: BOTH classification arms
  // skipped the largest hand-authored file in the tree BY NAME, and this phase
  // produced the proof, targetDiscordSig, a localized surface discovered and
  // classified with no arm able to ask the question.
  //
  // The audit that replaced it classified all 46 compared memos and found SEVEN
  // more of the same defect: the rest badge's tooltip (worse than stale, the
  // static-shell pass actively re-stamped it), the target live region, the
  // compass heading AND its rose labels, the Loot Settings window, the pet
  // action bar, and the mail indicator's aria-label and title. All seven are
  // fixed by the relocalizeCoordinatorMemos arm, which is pinned behaviorally
  // below rather than only registered. The shipped per-memo LANGUAGE_KEYED
  // reach stood until this ruling and is now one classification among many.
  {
    file: 'hud.ts',
    memos: ['lastArenaStatusSig'],
    reason:
      "lastArenaStatusSig is a hybrid whose middle field is vsBlock, the RESOLVED VS markup built on the same tick: t('hud.core.you') and t('hud.arena.vsLine') on the 2v2 arm, t('hud.arena.vsLine') plus t('hud.arena.levelClass') and the tEntity class name on the 1v1 arm. A locale switch therefore changes the freshly built side of the comparison, the banner rewrites itself on the next update, and the timer label (statusCountdown / statusReturning / statusFight), which is deliberately NOT in the signature, rides the same single innerHTML write and relocalizes with it. Write elision on resolved text wearing a signature's name; the genuinely text-independent fields (format, state, the returning countdown seconds) only add motion, they are not what carries the locale. CLOSED at the 19D review round rather than argued: the timer label IS in the signature now. The exemption used to rest on vsBlock's localized bytes alone, which fails in a locale where those two keys are still English-filled while hudChrome.arena.status* are translated (the normal state under the contributors-add-English-only rule): the sig was byte-identical across a switch and the timer line stranded. Note for a future editor: pull vsBlock or the label out of this signature and the banner becomes a stale-language surface needing a fan-out arm",
  },
  {
    file: 'hud.ts',
    memos: ['lastClockText'],
    reason:
      "lastClockText retains the RESOLVED minimap clock readout and is compared against a freshly built formatClockTime(new Date(), this.clock24), which routes through formatDateTime to Intl.DateTimeFormat(languageTag(currentLanguage)), so the hour cycle, the day-period marker and the digit system are re-resolved in the ACTIVE locale on the very next comparison. updateClock() runs unconditionally on the fastHud band of the frame loop, so it needs no data motion at all: a locale switch that changes the string moves the freshly built side within one fastHud tick and the write happens by itself. Write-elision on resolved text, not a data signature; the only other store, the `this.lastClockText = ''` in the clock click handler, is the 12h/24h toggle forcing that same self-repaint.",
  },
  {
    file: 'hud.ts',
    memos: ['lastCoordsText'],
    reason:
      'lastCoordsText retains the RESOLVED coordinate string it last put on #minimap-coords and is compared against a freshly built formatMinimapCoords(x, z), whose two numbers go through formatNumber, so a locale that formats digits or the minus sign differently produces different text and the readout rewrites itself on the very next fast-band tick without any fan-out arm. It is the write-elision shape (the claudium_window / daily_rewards_window class), not a data signature; the only other thing that moves it is the player stepping across a whole yard, and no t() call sits behind the gate.',
  },
  {
    file: 'hud.ts',
    memos: ['lastHoverTooltipId'],
    reason:
      "lastHoverTooltipId is the world-hover tooltip's rebuild key (mob: entity id, level, hostility, the viewer's level and the quest objective counts; player: id, name, level, class id and guild), text-independent by design, and it does gate localized output: the creature-type line t('hudChrome.mobTooltip.familyDemon') / t('guide.family.*.name'), the mob name and class name through tEntity, and the quest title/progress lines, painted as raw innerHTML with no writer elision. What makes it safe is that the surface cannot be on screen when the switch fires. Both language pickers sit inside HUD chrome: the in-game one is an Options sub-view, and main.ts's per-frame updateHoverCursor early-returns into hud.clearHoverTooltip() whenever hud.isModalOpen(), which is true while optionsOpen, so the memo is nulled and #tooltip hidden before woc:languagechange dispatches (the canvas mouseleave that drops input.hoverActive does the same job independently); the other picker is the character-select screen, before any world hover exists. The next hover rebuilds the card through fresh t()/tEntity(), so no arm is owed.",
  },
  {
    file: 'hud.ts',
    memos: ['lastLifetimeXp'],
    reason:
      "lastLifetimeXp retains sim.lifetimeXp, the monotonic lifetime total, a pure number that surfaces only past MAX_LEVEL where the label reads `Lv 20 (+7) · <total> total XP · <pct> to next` from t('game.xp.lv'), t('game.xp.totalXp') and t('game.xp.toNext') (src/ui/xp_bar.ts:83-86). That whole label is rebuilt by the one composite gate in the composite xpBarViewCache gate in updateXpBar, and its last arm compares getLanguage() against lastXpLanguage, so a locale switch alone rebuilds the post-cap line (and the pre-cap one) on the next frame. The memo gates a localized string but cannot strand it, because the gate it sits in is locale-aware by construction.",
  },
  {
    file: 'hud.ts',
    memos: ['lastLootGeomSig'],
    reason:
      "lastLootGeomSig holds the Loot Settings panel's dock key, `${others.length}/${info.raid ? 1 : 0}`: the party row count the painter just synced and the raid-grouping flag. It gates only positionLootSettingsPanel(), which measures #party-frames and writes el.style.left / top / transform on #loot-settings-window, so nothing that carries a character of player text passes through it; every localized string in that window is written by paintLootSettings -> renderLootSettingsWindow behind the separate lastLootSettingsSig gate. A locale switch can change the panel's measured height (a longer label wraps), which leaves the dock a few px off until the roster or the raid flag moves, but that is a coordinate, never a stale language.",
  },
  {
    file: 'hud.ts',
    memos: [
      'lastLowResourceActive',
      'lastLowResourceInput',
      'lastLowResourceLabel',
      'lastLowResourceMax',
      'lastLowResourceOpacity',
      'lastLowResourcePulseSeconds',
      'lastLowResourceType',
    ],
    reason:
      "the low-resource flash's seven non-language memos: the active flag, the input value, the resolved label STRING, the max, the opacity, the pulse seconds and the resource type id. The label is compared as a resolved string, which is write elision and moves by itself on a switch; the other six are numbers, a boolean and a type id that no locale can move, and the surface's language question is answered by lastLowResourceLanguage, its explicit locale latch, verified structurally in LANGUAGE_KEYED below",
  },
  {
    file: 'hud.ts',
    memos: ['lastLowResourceLanguage'],
    reason:
      "the low-resource warning's own language latch: `getLanguage()` is read at updateLowResource, compared as the fourth term of the update gate and stored on the same pass, so a locale switch alone always falls the gate through even when resource, maxResource and resourceType are byte-identical. That is what makes the other three terms of that conjunction safe: they are raw player numbers and the enum, none of which a locale can move, and without this latch the pulse label ('Low Mana' / 'Low Focus' / 'Low Energy', resolved in src/ui/low_resource.ts:71-76) would sit in the previous locale until the player's power happened to change. Note the latch answers the memo family, not refreshLocalizedDynamicUi, which drives no low-resource arm.",
  },
  {
    file: 'hud.ts',
    memos: ['lastMarketCollectPending'],
    reason:
      "lastMarketCollectPending latches one boolean, marketCollectIndicatorView(sim.marketCollectPending).visible, the streamed proceeds-waiting bit, and the entire guarded block is `el.hidden = !view.visible`: a visibility property, not a string. Nothing localized is written under the gate, so there is no text for a switch to strand. Every string on the coin is repainted by a path the memo cannot reach: index.html gives #market-indicator data-i18n-title and data-i18n-aria, which main.ts's translatePage re-stamps on every locale switch whether the badge is hidden or shown, and initMarketIndicator attaches the HUD tooltip as a lazy callback that resolves t('hudChrome.marketIndicator.tip') at hover time. Deliberately unlike its #mail-indicator sibling, whose labels interpolate the unread count and therefore have to be written from inside a count-gated update; if this coin ever grows an interpolated label written past line 9930, it becomes that same hazard and this exemption is void.",
  },
  {
    file: 'hud.ts',
    memos: ['lastPetPresent'],
    reason:
      "lastPetPresent is a plain boolean value-diff over 'a living pet is shown', and it gates exactly one write: document.body.classList.toggle('mobile-pet-active', petPresent), a CSS state class the mobile top-band layout keys on. The class name is a fixed literal and no t()/tPlural()/tEntity() call or view module sits inside the transition, so there is no string for a locale switch to leave stale; the only thing that moves the gate is the pet itself appearing, dying or despawning (including the fall-through to a living Necromancy secondary). The pet bar's localized captions are gated by lastPetBarSig further down the same method, not by this flag",
  },
  {
    file: 'hud.ts',
    memos: ['lastPlayerFrameLevel'],
    reason:
      "lastPlayerFrameLevel retains the player's LEVEL as a bare integer and gates exactly one write, playerFrame.levelText = String(p.level) (the levelText write in updatePlayerFrame). That is a raw number-to-string: unlike the hp and resource texts two blocks above it deliberately does not route through unitFrameCurrentMaxText or formatNumber, so no t() key and no Intl formatter sits behind it and no locale can change the bytes it produces. The painter puts it on screen through the elided writer facet (unit_frame_painter.ts:179, this.writers.setText(this.el.level, view.levelText ?? '')), and the level element carries no label, unit word or aria string written from inside the gate. Only the player levelling moves the memo, which is the only thing that ever needs to move it, so its absence from the memo clears in relocalizeCoordinatorMemos is correct rather than an omission.",
  },
  {
    file: 'hud.ts',
    memos: ['lastRestedXp'],
    reason:
      "lastRestedXp retains sim.restedXp, the inn-rested pool. Most of what it drives is geometry (restedFrac becomes a left/width percentage and the `rested` class, src/ui/xp_bar_painter.ts:48-58), but it also decides the localized tail ` · t('game.xp.rested') +<n>` on the hover label (src/ui/xp_bar.ts:55). It is safe for the same structural reason as its three siblings and for no other: all five XP arms share ONE OR gate, the composite xpBarViewCache gate in updateXpBar, that ends in `xpLanguage !== this.lastXpLanguage`, so a locale switch alone reopens it, re-resolves game.xp.rested and re-groups the +<n> through formatNumber. Remove that language arm and this row becomes a bug, not an exemption.",
  },
  {
    file: 'hud.ts',
    memos: ['lastShowOverflow'],
    reason:
      "lastShowOverflow retains the showOverflowXp OPTION boolean ((settings.get('showOverflowXp') ?? 1) >= 0.5), one clause of the compound OR that guards the xpBarViewCache rebuild. The cached view really is localized (xp_bar.ts builds the hover label and the percent echo from t('game.xp.suffix'), t('game.xp.rested'), t('game.xp.maxLevel'), t('game.xp.totalXp') and formatNumber), but the same guard compares `xpLanguage !== this.lastXpLanguage` with xpLanguage = getLanguage() read one line above the option, so a locale switch always moves the gate, the view is rebuilt on the next frame and XpBarPainter pushes the new label out through the elided writers. The language latch that carries it, lastXpLanguage, is the memo with the LANGUAGE_KEYED row; this boolean rides it, exactly the map_semantic_accessibility_core lastHash shape.",
  },
  {
    file: 'hud.ts',
    memos: ['lastSubzone'],
    reason:
      "lastSubzone retains the nearest POI's raw CONTENT label (nearestSubzone, src/ui/subzone.ts, returns poi.label; it never sees a tEntity() result) and doubles as that helper's hysteresis input, so nothing but the player crossing a POI radius moves it. The one localized string it gates, showSubzone(zonePoiLabel(...)), is a 2600ms landmark announcement that fades itself back to opacity 0: an entry that already fired belongs to the locale it fired in, the same way a chat log line does, and the next crossing announces through a fresh tEntity(). There is no surface left standing in the old locale for a fan-out arm to repaint.",
  },
  {
    file: 'hud.ts',
    memos: ['lastTargetFrameId'],
    reason:
      "lastTargetFrameId is the target frame's cadence id, not a repaint latch. It is never an early return: its one read builds `targetChanged`, the swap-bypass argument to nonSelfRepaintDue(subjectChanged, lastAt, now, targetFrameNonSelfIntervalMs(fxTier)) (src/game/ui_tier_knobs.ts:141-147), whose other arm cadenceDue is unconditionally true when the interval is 0 (every tier but low) and true again 100ms after the last paint on low. So the body it gates re-runs on its own within at most a tenth of a second of a switch and re-resolves every localized face it writes (t('hud.core.dead'), cheaterTagLabel's t(), the titled-name decoration, the formatNumber hp/resource text), and those land through the unit_frame painter's elided writers, which compare the resolved string. The memo holds an entity id; what moves the surface when the locale moves is the cadence, not the id.",
  },
  {
    file: 'hud.ts',
    memos: ['lastTargetTitleSig'],
    reason:
      "the target frame's Book of Deeds titled-name decoration: titledNameDecoration resolves deedTitleText plus t('hudChrome.deeds.titledName') and splits the rendered pattern around the interpolated name, so both halves are pure localized text over a title ID that a locale switch cannot move. The signature is literally `${getLanguage()}|${target.title ?? ''}`, the language leading the identity field in the same shape as targetDiscordSig, so a switch always moves the gate and the decoration is recomposed in the new locale on the target frame's next paint (immediate on every tier but low, within 100ms there). There is nothing for a fan-out arm to repaint: the memo carries the locale itself.",
  },
  {
    file: 'hud.ts',
    memos: ['lastTotFrameId'],
    reason:
      "lastTotFrameId is the target-of-target cadence id, the non-self twin of lastTargetFrameId, and it latches nothing. Its single read builds `totChanged` for nonSelfRepaintDue, so a tot SWAP bypasses the throttle; the cadence arm alone already fires the paint every frame on every tier but low (interval 0 makes cadenceDue unconditionally true) and every 100ms on low. The mini-frame's only localized faces, t('hud.core.dead') and the formatNumber hp text plus the entity display name, are therefore re-resolved on their own within a tenth of a second of a switch and are written through the unit_frame painter's elided writers, which compare the resolved string. The memo holds an entity id; nothing text-shaped is stored and nothing is suppressed past one cadence interval.",
  },
  {
    file: 'hud.ts',
    memos: ['lastXp'],
    reason:
      'lastXp retains sim.xp, the raw current-level XP count that sets the bar fill and the `<xp> / <need>` numbers in the hover label. Those numbers are locale-formatted (formatXp goes through formatNumber, so en "1,000" against de "1.000") and the suffix is t(\'game.xp.suffix\'), which is precisely why the cache gate in the composite xpBarViewCache gate in updateXpBar carries `xpLanguage !== this.lastXpLanguage` as its final arm: a switch moves that arm on the next frame, xpBarView re-resolves and re-groups everything, and the memo\'s own numeric arm never has to move. Nothing here waits on a fan-out arm.',
  },
  {
    file: 'hud.ts',
    memos: ['lastXpLanguage'],
    reason:
      "lastXpLanguage IS the XP bar's language latch: getLanguage() is read at the xpBarViewCache gate in updateXpBar, compared as the last arm of that gate, and stored unchanged on the same pass, which is both accepted forms at once (the memo names the latch and the locale flows straight into the stored value). Because the four data arms beside it (level, xp, lifetimeXp, restedXp) share that single OR gate, the latch alone reopens the cache on a runtime switch and every game.xp.* key plus the formatNumber percent re-resolves on the next frame. That is why the XP bar needs no refreshLocalizedDynamicUi arm, and why deleting this arm would silently strand the hover label in the previous locale until the player next gained XP.",
  },
  {
    file: 'hud.ts',
    memos: ['lastXpLevel'],
    reason:
      "lastXpLevel retains p.level, the integer level xpBarView branched on at the last rebuild (pre-cap level bar versus the MAX LEVEL / overflow labels), so the memo itself is a number and holds no text. It never stands alone: it is one arm of the SINGLE OR gate in the composite xpBarViewCache gate in updateXpBar whose last arm is `xpLanguage !== this.lastXpLanguage`, with xpLanguage read from getLanguage() one line above it, so a locale switch opens the whole gate and rebuilds the cached XpBarView with fresh game.xp.* resolutions on the very next frame (this block sits at method-body level, not on the mediumHud band). Same composite shape as map_semantic_accessibility_core's lastHash sitting beside lastLanguage.",
  },
  {
    file: 'hud.ts',
    memos: ['lastZoneId'],
    reason:
      "lastZoneId retains the committed zone id and is moved only by zoneAt flipping under the player, but everything localized behind it is a one-shot TRANSITION event, not a standing surface: the 2600ms zone banner (zoneDisplayName), the enteringZone chat line and the zone welcome line, all of which are history the moment they fire, exactly like any other chat log row. The persistent zone name is a different write entirely: MinimapPainter puts it on #zone-label through the write-elision facet (writers.setText with localizeZone), which compares the resolved string, so it repaints itself on the next minimap tick. The memo's two remaining reads only pick which ZoneDef's cached terrain raster to blit, which carries no text at all.",
  },
  {
    file: 'hud.ts',
    memos: ['targetDiscordSig'],
    reason:
      "the target frame's flair line (the staff role tag, the Discord rank rung, the dev rung, and the [AI] mark plus its screen-reader label). Every other field in the signature is identity data a locale switch cannot move, so keyed on identity alone the line sat in the PREVIOUS locale until that player's flair happened to change; the rebuild itself was always correct, it just never ran, so the fix is the key rather than a fan-out arm. The value is built by targetFlairSignature (src/ui/target_flair_line_view.ts), with getLanguage() read into TargetFlairLineInput.language at the call site and leading the signature, and its paired suite drives the difference across two locales on byte-identical identity data.",
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
    // PER MEMO, not per file (masterwrought qr-19-hud-coordinator-fanout-exemption).
    // A file may now hold several rows, because hud.ts's 46 memos genuinely split
    // across both classifications: some are repainted by a fan-out arm, some hold
    // no localized text at all. What must never happen is one MEMO carrying two
    // answers, which is how a real gate hides behind an exemption argued about a
    // different field. Strictly stronger than the per-file rule it replaces: that
    // one could not see inside a file at all.
    const seen = new Map<string, string[]>();
    for (const [kind, list] of [
      ['ANSWERED', ANSWERED],
      ['NOT_A_LANGUAGE_GATE', NOT_A_LANGUAGE_GATE],
    ] as const) {
      for (const row of list) {
        for (const memo of row.memos) {
          const key = `${row.file}#${memo}`;
          seen.set(key, [...(seen.get(key) ?? []), kind]);
        }
      }
    }
    const twice = [...seen]
      .filter(([, kinds]) => kinds.length > 1)
      .map(([key, kinds]) => `${key}: ${kinds.join(' and ')}`);
    expect(
      twice,
      'a memo is classified twice: an exemption and an answer cannot both be granted about the same field\n' +
        twice.join('\n'),
    ).toEqual([]);
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
    // UNIONED PER FILE, because a file may now carry several memo-scoped rows.
    // The contract is unchanged in substance and stricter in reach: the union of
    // a file's rows must equal its discovered set EXACTLY, so a new memo is
    // unclassified (not silently absorbed) and a deleted one leaves a stale row.
    const unionByFile = new Map<string, Set<string>>();
    for (const row of classified) {
      const set = unionByFile.get(row.file) ?? new Set<string>();
      for (const memo of row.memos) set.add(memo);
      unionByFile.set(row.file, set);
    }
    for (const [file, memos] of unionByFile) {
      const found = discoveredByFile.get(file);
      if (!found) continue; // reported by the stale-row test above
      const registry = [...memos].sort().join(',');
      if (found.memos.join(',') !== registry) {
        drift.push(`${file}: registry ${registry} vs source ${found.memos.join(',')}`);
      }
    }
    // The exempt rows hold the SAME pin, and now they hold it on their own
    // terms rather than as a whole-file comparison: an exemption is granted
    // about specific fields, so every memo an exemption names must still be a
    // discovered gate. A memo that stops being compared leaves a stale claim
    // behind, which the union above cannot see when another row on the same
    // file still lists it.
    for (const row of NOT_A_LANGUAGE_GATE) {
      const found = discoveredByFile.get(row.file);
      if (!found) continue; // reported by the stale-row test above
      for (const memo of row.memos) {
        if (!found.memos.includes(memo)) {
          drift.push(`${row.file}: exemption names ${memo}, which is no longer a compared memo`);
        }
      }
    }
    expect(
      drift,
      'a classified module gained or lost a repaint memo. A NEW memo is a NEW gate and needs the language question answered about it, not inherited from the answer given about a different field:\n' +
        drift.join('\n'),
    ).toEqual([]);
  });

  it('really clears every memo the coordinator arm claims to answer', () => {
    // THE BEHAVIORAL HALF of the hud.ts rows, and the reason the seven defects
    // this audit found are fixed rather than merely described. Half 1 pins that
    // refreshLocalizedDynamicUi CALLS relocalizeCoordinatorMemos; it cannot see
    // whether that method touches the memos the rows name. Nothing else can
    // either: these are private fields on an 18k-line coordinator no unit test
    // instantiates, which is exactly how they sat unanswered behind a blanket
    // exemption in the first place.
    //
    // A CLEAR IS ONLY A FIX IF ITS VALUE CANNOT BE LIVE DATA, so the sentinel is
    // pinned too. NaN never equals itself, null is outside the boolean and
    // number-or-null field types, -1 is below any count, and the empty string
    // carries none of the separators every real signature has.
    const body = methodBody(strippedHudSource, 'private relocalizeCoordinatorMemos(): void {');
    // PER MEMO, not a global whitelist. The whitelist form ('Number.NaN', 'null',
    // '-1', "''") reads like a proof and is a heuristic: it cannot see any one
    // memo's live domain, so a future `lastFooOffset` legitimately reaching -1,
    // or a `lastBarText` legitimately empty, would be accepted with a clear that
    // is a no-op and the fix would be silently inert. Each row below pairs the
    // memo with the ONE sentinel its own field can never hold, and why.
    const SENTINEL_BY_MEMO: Readonly<Record<string, { value: string; why: string }>> = {
      lastPlayerFrameHp: { value: 'Number.NaN', why: 'hp is a number; NaN never equals itself' },
      lastPlayerFrameMaxHp: { value: 'Number.NaN', why: 'max hp is a number' },
      lastPlayerFrameResource: { value: 'Number.NaN', why: 'resource is a number' },
      lastPlayerFrameMaxResource: { value: 'Number.NaN', why: 'max resource is a number' },
      lastResting: {
        value: 'null',
        why: 'the field is boolean | null purely so null is unreachable',
      },
      lastAnnouncedTargetId: { value: 'null', why: 'a real target id is a number' },
      lastMailUnread: { value: '-1', why: 'mailIndicatorView clamps the count at 0' },
      lastLootSettingsSig: { value: "''", why: 'every real sig carries / separators' },
      lastPetBarSig: { value: "''", why: 'every real sig starts with the pet id and a colon' },
      lastCompassFacing: { value: 'Number.NaN', why: 'facing is a float; NaN never equals itself' },
      lastCompassHeading: { value: "''", why: 'a heading is one of the eight rose ids' },
    };
    const claimed = ANSWERED.filter(
      (row) => row.file === 'hud.ts' && row.answer === 'this.relocalizeCoordinatorMemos',
    ).flatMap((row) => [...row.memos]);
    // Non-vacuity: the arm really has rows to check, and the slice really has a
    // body (methodBody throws on a missing anchor, but an emptied method would
    // slice to a few characters and pass every loop below over nothing).
    expect(claimed.length, 'the coordinator arm answers no memo at all').toBeGreaterThanOrEqual(10);
    expect(body.length, 'the coordinator arm sliced to an empty body').toBeGreaterThan(200);
    const failures: string[] = [];
    for (const memo of claimed) {
      const match = body.match(new RegExp(`this\\.${memo}\\s*=\\s*([^;]+);`));
      if (!match) {
        failures.push(`${memo}: claimed by the coordinator arm but never cleared in it`);
        continue;
      }
      const value = match[1].trim();
      const expected = SENTINEL_BY_MEMO[memo];
      if (!expected) {
        failures.push(`${memo}: claimed by the coordinator arm with no sentinel recorded for it`);
      } else if (value !== expected.value) {
        failures.push(
          `${memo}: cleared to ${value}, not the ${expected.value} its own field needs (${expected.why})`,
        );
      }
    }
    // THE REVERSE SWEEP. Everything above walks CLAIMED memos; a memo cleared in
    // the arm but classified as an exemption elsewhere passes both this and the
    // classified-twice check, and the exemption would then be arguing that a
    // field the coordinator actively repaints holds no text.
    const claimedSet = new Set(claimed);
    for (const [, memo] of body.matchAll(/this\.(\w+)\s*=/g)) {
      if (!claimedSet.has(memo)) {
        failures.push(
          `${memo}: cleared by the coordinator arm but not claimed by any ANSWERED row`,
        );
      }
    }
    // The compass rose labels are the one surface a clear cannot reach: they are
    // written ONCE when the pool is built, so the arm has to rewrite them.
    if (!/relabelCompassMarks\(/.test(body)) {
      failures.push('the compass rose labels are never rewritten by the arm');
    }
    expect(failures, failures.join('\n')).toEqual([]);
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
      // 33 as of masterwrought Phase 19D (qr-19-hud-coordinator-fanout-exemption):
      // the single blanket hud.ts row LEFT and 22 memo-scoped hud.ts rows arrived
      // in its place, covering the 28 of that file's 46 compared memos that hold
      // no localized text (the other 18 are ANSWERED). The jump is the point of
      // the ruling: the by-name skip on the largest hand-authored file in the
      // tree is gone, so its exemptions are argued one at a time like every
      // other module's.
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
    ).toBe(33);
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
