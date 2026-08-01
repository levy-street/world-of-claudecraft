// THE STANDING per-frame perf-budget floor (v0.16.0).
//
// Every per-frame painter proved its write-elision + allocation budget ONCE
// at its own perf gate; those gates were one-shot. This file makes them permanent, so
// a future change that collapses the write-elision cache, reallocates a per-frame core,
// or unbounds a pool fails here instead of silently regressing. It is grounded in the
// COMMITTED baseline (hud_perf_budget.baseline.md): the
// durable anchor hudHotDomSkipRate >= 0.962 is READ from that file (never defaulted to
// 0), so a missing baseline fails the budget rather than passing a hollow gate.
//
// THE ASSERTIONS ARE SPLIT BY HOST so each runs where it can actually be measured:
//
//   ARM 1 - STATIC SOURCE-SCAN (Node, runs in every `npm test`): the raw-write and
//     layout-read rejection, over every src/ui painter under BOTH names src/ui/CLAUDE.md
//     sanctions (`*_painter.ts` and `*_window.ts`). Every FACET-ROUTED HUD painter must
//     route ALL per-frame writes through the PainterHost elided writers
//     (setText/setDisplay/setTransform/setWidth + setStyleProp/toggleClass/setAttr); no raw
//     .style/.textContent/.classList/.className/.setAttribute/.setProperty/.innerHTML
//     beyond a DOCUMENTED build-time exception. This is the same per-painter check the
//     per-frame painters used, consolidated. The canvas painters (cadence + cached tokens)
//     are not facet-routed and take the scan with their own counted exceptions plus an
//     identity proof; the cold window painters are not per-frame at all and take the two
//     halves of the contract that do not depend on cadence (no forced-reflow layout read,
//     no repeating driver of their own). Completeness checks pair the buckets with what is
//     on disk so a NEW painter under EITHER SANCTIONED NAME cannot silently escape. That
//     scope is the honest one and is narrower than "every per-frame src/ui module": a
//     module under a third name is out of reach here, and several are driven from
//     Hud.update() today (dungeon_finder_proposal_popup and the five vale_cup surfaces), held
//     only by the module sweep in tests/architecture.test.ts. (Render-resident painters
//     under src/render, e.g. the cadence-throttled nameplate painter, are intentionally
//     outside this HUD-painter file.)
//
//   ARM 2 - FAKE-DOM RUNTIME (Node, runs in every `npm test`): the skip-rate budget and
//     the allocation budget. The repo has NO jsdom (the tiny-dependency invariant), so
//     DOM-touching wiring is exercised with a hand-rolled fake DOM in the node env, the
//     same idiom tests/focus_manager.test.ts uses. The skip-rate loop drives the
//     non-pooled per-frame painters through a steady-state update loop over a REAL
//     makeWriterFacet and asserts (a) per painter: a cold-cache establishing frame writes
//     real DOM (non-vacuous) and a repeated identical frame writes NOTHING (perfect elision,
//     the Top-risk-1 collapse detector), and (b) aggregate: a derived skip-rate sanity bound.
//     It runs for BOTH a Sim-shaped and a ClientWorld-mirror-shaped input; in
//     the skip-rate loop the only MATERIAL divergence is unit_frame's offline-only absorb
//     shield (the other four painters get byte-identical input in both shapes). The
//     allocation proxy is the reference-stability probe (tests/util/alloc_probe): the
//     action-bar and auras view cores must return a REUSED container AND a REUSED .slots
//     array every tick; that arm feeds auras_view both the Sim aura value and the online-
//     zeroed value (the other axis).
//
//   ARM 3 - PERF_TOUR-DELEGATED (env HUD_PERF_BUDGET_TOUR=1, runs in the perf row, NOT
//     bare `npm test`): the wall-clock + elision + macro-pool budget. It reads a perf_tour
//     artifact (a real-browser run of scripts/perf_tour.mjs) and the same committed baseline,
//     and asserts (a) the tour rendered at least `tourMinFrames` real frames AND kept the
//     long-frame count `frameLong50` at or under the committed anchor (both captured under
//     PERF_GPU=1 on the owner's machine, so same-machine; on other hardware override the
//     long-frame anchor with a fresh same-machine capture via
//     HUD_PERF_BUDGET_TOUR_LONG50_BASELINE. The retired frameP95 gate was mathematically
//     unfailable: its 250 ms threshold EQUALED the sample clamp, so a saturated
//     catastrophically-slow run still passed; the frames floor kills that inverted-saturation
//     hole and the long-frame count actually moves when the frame path regresses),
//     (b) the elision-bypass write COUNT
//     `hudHotDomWrites` <= the baseline anchor, EVERY viewport (the run-length-independent
//     collapse signal; the skip RATIO is frame-count-dependent so it stays in the console for
//     context, not a hard gate), and (c) the FCT pool stays at/under FCT_POOL_CAP under
//     the scripted AoE burst (fctBurstBoundedNodes). SKIPPED when the env flag is unset so
//     bare `npm test` stays fast and portable (the baseline rows are still READ at
//     collection time, so a deleted row fails loudly even in bare `npm test`).
//
// COVERAGE NOTE (not a silent cap): the ARM 2 skip-rate loop drives the five non-pooled
// per-frame painters (xp_bar, swing_timer, cast_bar, unit_frame, action_bar), which
// together exercise all seven elided writers. The keyed-pool painters (auras, party,
// fct) build + reconcile real DOM nodes; their steady-state *_painter.test.ts
// tests prove no per-frame node CHURN plus targeted expensive-write gates (icon-url, crest
// class), while facet-level DOM write-elision is guaranteed by makeWriterFacet and proven
// with write/skip counters in tests/painter_host.test.ts; their bypass count rides ARM 3.
// ARM 1 still scans all eight painters (incl. the pooled ones) for raw writes + forced reflow.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CastBarState } from '../src/render/cast_bar';
import type { AbilityDef, Aura } from '../src/sim/types';
import { type AuraInput, type AurasDeps, createAurasView } from '../src/ui/auras_view';
import {
  type CastBarElements,
  type CastBarOptions,
  CastBarPainter,
  type CastBarPaintInput,
} from '../src/ui/cast_bar_painter';
import { FCT_POOL_CAP } from '../src/ui/fct_painter';
import {
  type ActionBarPaintDescriptor,
  ActionBarPainter,
  type ActionBarSlotElements,
} from '../src/ui/hud/action_bar/action_bar_painter';
import {
  type ActionBarDeps,
  type ActionBarState,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import type { SwingTimerState } from '../src/ui/swing_timer';
import { SwingTimerPainter } from '../src/ui/swing_timer_painter';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import { type UnitFrameElements, UnitFramePainter } from '../src/ui/unit_frame_painter';
import type { XpBarView } from '../src/ui/xp_bar';
import { XpBarPainter } from '../src/ui/xp_bar_painter';
import { readDriverCallbacks } from './helpers/driver_callback_bodies';
import { assertAllocationStable } from './util/alloc_probe';

// --------------------------------------------------------------------------
// The committed baseline (read, never defaulted).
// --------------------------------------------------------------------------

const BASELINE_FILE = './hud_perf_budget.baseline.md';
const baselineMd = readFileSync(new URL(BASELINE_FILE, import.meta.url), 'utf8');

// The skip-rate floor for ARM 2's DETERMINISTIC fake-DOM loop (a fixed write/skip count, so
// the ratio is stable there). The baseline records it as a markdown table row
// (`| **hudHotDomSkipRate** | **0.962** ... |`) for desktop and again as 0.961 for mobile.
// Take the STRICTEST (max) committed ratio rather than the first match, so a future doc
// reorder that floats the lower mobile row up cannot silently weaken the floor. Throw if no
// row exists so a deleted / unregenerated baseline fails the budget instead of defaulting.
function readBaselineSkipRateFloor(): number {
  const values = baselineMd
    .split('\n')
    .filter((l) => l.includes('hudHotDomSkipRate') && /\b0\.\d+/.test(l))
    .map((l) => Number(l.match(/\b(0\.\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  if (!values.length) {
    throw new Error(
      'hud_perf_budget.baseline.md: the hudHotDomSkipRate floor is missing. The committed baseline is absent or the key was removed; the skip-rate budget cannot be grounded. Regenerate + commit the perf baseline before relying on this gate.',
    );
  }
  return Math.max(...values);
}

// The DURABLE, RUN-LENGTH-INDEPENDENT anchor: the elision-bypass write COUNT
// (`hudHotDomWrites`). Unlike the skip RATIO (skipped / total), this does not move with the
// frame count. The establishing-write floor differs by viewport (the touch HUD builds more
// per-frame elements) and jitters by a write or two run to run, so the committed anchor is a
// single canonical row covering the WORST viewport plus that jitter as headroom. A collapse
// of write-elision makes it BALLOON toward the frame count; a healthy run holds it. This is the
// signal ARM 3 gates on instead of the frame-count-dependent ratio. The baseline records it as
// the canonical table row `| hudHotDomWrites | <count> | ...`; this parses THAT row specifically
// (not the first prose mention) so doc prose order or a historical figure in the narrative can
// never silently move the anchor. Throw if absent. A DELIBERATE future hot-write change (a new
// per-frame element) updates the table row in the baseline, like any golden value.
function readBaselineBypassCount(): number {
  const line = baselineMd
    .split('\n')
    .find((l) => /\|\s*hudHotDomWrites\s*\|\s*\d{2,}\s*\|/.test(l));
  const match = line?.match(/\|\s*hudHotDomWrites\s*\|\s*(\d{2,})\s*\|/);
  if (!match) {
    throw new Error(
      'hud_perf_budget.baseline.md: the canonical hudHotDomWrites anchor row (`| hudHotDomWrites | <count> |`) is missing. The committed baseline is absent or the key was removed; the bypass-count budget cannot be grounded.',
    );
  }
  return Number(match[1]);
}

// ARM 3's long-frame anchor: the COUNT of frames at or over 50 ms in the tour's sample
// window (`frameMs.long50`). Unlike the RETIRED frameP95 gate, whose 250 ms threshold
// EQUALED the PerfMonitor sample clamp and so could never fail (every catastrophic frame
// saturated INTO the passing value), the long-frame count grows with every hitch and
// cannot saturate into a pass. Same-machine-relative (captured under PERF_GPU=1, real
// GPU, on the owner's machine; see the baseline file): an operator on other hardware
// overrides it with a fresh same-machine capture via HUD_PERF_BUDGET_TOUR_LONG50_BASELINE.
// Parses ONLY the canonical table row `| frameLong50 | <count> | ...` (never a loose
// prose mention), throws if absent.
function readBaselineLongFrames(): number {
  const line = baselineMd.split('\n').find((l) => /\|\s*frameLong50\s*\|\s*\d+\s*\|/.test(l));
  const match = line?.match(/\|\s*frameLong50\s*\|\s*(\d+)\s*\|/);
  if (!match) {
    throw new Error(
      'hud_perf_budget.baseline.md: the canonical frameLong50 anchor row (`| frameLong50 | <count> |`) is missing. The committed baseline is absent or the key was removed; the long-frame budget cannot be grounded.',
    );
  }
  return Number(match[1]);
}

// ARM 3's saturation floor: the tour must have rendered at least this many real frames
// (`summary.frames`, the PerfMonitor frame counter). This is the other half of killing
// the inverted-saturation hole: a run so slow that every sample clamps also renders
// almost NO frames, so a frames floor fails it where the old p95 ceiling passed it.
// Parses ONLY the canonical table row `| tourMinFrames | <count> | ...`, throws if absent.
function readBaselineTourMinFrames(): number {
  const line = baselineMd.split('\n').find((l) => /\|\s*tourMinFrames\s*\|\s*\d+\s*\|/.test(l));
  const match = line?.match(/\|\s*tourMinFrames\s*\|\s*(\d+)\s*\|/);
  if (!match) {
    throw new Error(
      'hud_perf_budget.baseline.md: the canonical tourMinFrames floor row (`| tourMinFrames | <count> |`) is missing. The committed baseline is absent or the key was removed; the tour frame floor cannot be grounded.',
    );
  }
  return Number(match[1]);
}

const SKIP_RATE_FLOOR = readBaselineSkipRateFloor();
const BYPASS_ANCHOR = readBaselineBypassCount();
// Read at collection time (not inside the env-gated describe) so a deleted or
// unregenerated baseline row fails bare `npm test` loudly instead of silently
// skipping with the ARM 3 gate.
const LONG50_ANCHOR = readBaselineLongFrames();
const TOUR_MIN_FRAMES = readBaselineTourMinFrames();

// --------------------------------------------------------------------------
// ARM 1 - static write + layout-read rejection over every src/ui painter.
// --------------------------------------------------------------------------

// WHAT COUNTS AS A PAINTER HERE. src/ui/CLAUDE.md sanctions TWO painter filenames and this
// gate sweeps both: `<name>_painter.ts` and `<name>_window.ts`. Matching only the first is
// what left 35 window painters holding no raw-write contract and no forced-reflow contract
// at all.
//
// `_controller` is the THIRD name, and it is here for a reason worth naming: widening this
// gate to windows made renaming a window to a controller the cheapest way out of it, which is
// the CANVAS_PAINTERS parking hole one filename over. src/ui/hud/CLAUDE.md already lists
// "controllers, windows, or painters" as the three DOM adapters of an extracted HUD domain,
// so a controller holds the same cold contract a window does, and three of the fourteen
// already make real layout reads. Closing it cost three allowance entries.
const PAINTER_FILE_RE = /_(?:painter|window|controller)\.ts$/;

// Every matcher below is a LABEL plus its own regex rather than a bare token string. The
// label is what an allowance map is keyed by and what a failure names; the regex is what
// actually counts. The pairing is not cosmetic: the token list this replaced built
// `new RegExp('\\' + token + '\\b')`, which only escapes cleanly for a LEADING-DOT member
// token (a dotless `removeAttribute` would have become a `\r` carriage return and matched
// nothing), and that constraint is exactly what made the getComputedStyle arm dead below.

// The raw-DOM-write vocabulary the per-frame painters reject. Every per-frame write must
// go through a facet writer, so any of these on a painter's hot path is a facet-routing
// break. Each painter pins its DOCUMENTED build-time exceptions by COUNT (the same
// allowances the per-painter tests pin): a pooled node's class is set once in its
// builder, not per frame.
// The last arm closes the obvious way around the other nine: the same members reached by
// computed access (`el['textContent'] = x`) instead of by dot. Zero everywhere today, and
// biome flags none of it, so nothing but this would have caught it. What a source scan still
// cannot see is a destructured binding (`const { style } = el; style.display = ...`); that
// one is a documented limit, not a covered case.
const RAW_WRITES: ReadonlyArray<readonly [string, RegExp]> = [
  ['.style', /\.style\b/g],
  ['.textContent', /\.textContent\b/g],
  ['.classList', /\.classList\b/g],
  ['.className', /\.className\b/g],
  ['.setAttribute', /\.setAttribute\b/g],
  ['.removeAttribute', /\.removeAttribute\b/g],
  ['.setProperty', /\.setProperty\b/g],
  ['.innerHTML', /\.innerHTML\b/g],
  ['.dataset', /\.dataset\b/g],
  // The same class as .innerHTML / .setAttribute, all zero across the scanned buckets today,
  // which is exactly when to add them: each is a raw mutation the nine above do not name, so
  // reaching for one was free until now.
  ['.outerHTML', /\.outerHTML\b/g],
  ['.insertAdjacentHTML', /\.insertAdjacentHTML\b/g],
  ['.insertAdjacentText', /\.insertAdjacentText\b/g],
  ['.cssText', /\.cssText\b/g],
  ['.toggleAttribute', /\.toggleAttribute\b/g],
  ['.setAttributeNS', /\.setAttributeNS\b/g],
  [
    "['computed']",
    /\[\s*['"](?:style|textContent|classList|className|setAttribute|removeAttribute|setProperty|innerHTML|dataset|outerHTML|insertAdjacentHTML|insertAdjacentText|cssText|toggleAttribute|setAttributeNS)['"]\s*\]/g,
  ],
];

// Forced-reflow READ matchers: a layout read (offsetWidth, getBoundingClientRect,
// getComputedStyle, ...) flushes pending style/layout and is the classic browser-perf
// killer (layout thrash). Unlike write-elision this contract does NOT depend on cadence,
// which is why it is the half of the painter contract every bucket below holds: a window
// that measures a rect per row while building two hundred rows thrashes layout exactly
// like a per-frame painter does. Only a DOCUMENTED, counted read is allowed.
//
// THE getComputedStyle ARM IS THE POINT OF THE PAIR FORM. It used to be spelled
// `.getComputedStyle`, a member access, and `grep -rn '\.getComputedStyle' src/` returns
// ZERO hits repo-wide: this tree always calls the global BARE
// (`getComputedStyle(document.documentElement)` in minimap_painter, map_window_painter,
// delve_map_painter, talents_window, market_window, ui_scale, hud). So the single most
// expensive read in the vocabulary was counted on no painter at all, hot ones included.
// The matcher below sees the bare call AND the `window.getComputedStyle(...)` member form,
// and refuses an unrelated identifier that merely ENDS in the same word.
// `.scrollTop` / `.scrollLeft` are in the vocabulary because reading either forces layout
// exactly like `.offsetTop` does, and the cold bucket is where they live: the windows
// preserve scroll position across a rebuild by reading it and writing it back. That pair is
// legitimate and stable, so it is granted per file rather than banned, and the allowance is
// what makes a THIRD access in the same file (the shape that turns a rebuild loop into
// thrash) a conscious act. Read the granted numbers as ACCESSES, not as layout reads: the
// matcher cannot tell `const t = el.scrollTop` from `el.scrollTop = t`, so roughly half of
// each allowance is the harmless write-back. It works as a change detector either way, which
// is what the budget is for. `.offsetParent` and `.innerText` are here too and are zero
// everywhere today, which is the point of adding them before someone reaches for one.
const FORCED_REFLOW_READS: ReadonlyArray<readonly [string, RegExp]> = [
  ['.offsetWidth', /\.offsetWidth\b/g],
  ['.offsetHeight', /\.offsetHeight\b/g],
  ['.offsetTop', /\.offsetTop\b/g],
  ['.offsetLeft', /\.offsetLeft\b/g],
  ['.offsetParent', /\.offsetParent\b/g],
  ['.clientWidth', /\.clientWidth\b/g],
  ['.clientHeight', /\.clientHeight\b/g],
  ['.scrollWidth', /\.scrollWidth\b/g],
  ['.scrollHeight', /\.scrollHeight\b/g],
  ['.scrollTop', /\.scrollTop\b/g],
  ['.scrollLeft', /\.scrollLeft\b/g],
  ['.innerText', /\.innerText\b/g],
  ['.getBoundingClientRect', /\.getBoundingClientRect\b/g],
  ['.getClientRects', /\.getClientRects\b/g],
  ['getComputedStyle', /(?<![\w$])getComputedStyle\b/g],
  // A PROXY token, and the only honest answer to this scan being per-file. It counts every
  // REFERENCE rather than only a call, so the `import { getUiScale }` line counts too. That
  // over-counts by exactly one per importing file, which is the safe direction and is what
  // closes the aliasing escape (`const f = getUiScale; f()`), the same one the
  // getComputedStyle arm had. `getUiScale`
  // (src/ui/ui_scale.ts) pays a getComputedStyle one hop away, which no per-file count can
  // see: party_below_target's comment already concedes the hop, and talents_window has the
  // same one undocumented. Counting the CALL puts both under the same budget as a direct
  // read. It generalizes: any shared helper later found to force layout is added here rather
  // than left invisible. It does not make the scan transitive, and nothing here claims it
  // does; a read moved into a NEW un-named helper is still out of reach.
  ['getUiScale', /(?<![\w$])getUiScale\b/g],
];

// The repeating DRIVERS a painter must not own without saying so. Every bucket takes this
// scan, not just the cold one: a facet-routed painter is already driven by Hud.update() and
// has no business owning a second clock, and a window PROMOTED into HOT_PAINTERS would
// otherwise drop the driver contract on the way in. It is free today, since no hot or canvas
// painter owns any of these.
//
// `requestAnimationFrame` and `requestIdleCallback` are per-frame drivers literally (zero
// painters own one today, so the allowance is a hard zero); `setInterval` is the same shape
// at a chosen cadence, so it is counted rather than banned and each documented allowance
// records the interval it was granted for. Every arm counts the NAME, not only a call, so
// reached bare, off `window`, or bound to a local first (`const raf = requestAnimationFrame`)
// all count; `clearInterval` / `cancelAnimationFrame` deliberately do not, being teardown.
//
// DELIBERATELY OUT, so the absence is a decision: a self-rescheduling `setTimeout`, which is
// a repeating driver in every way that matters here. Every `setTimeout` in the tree today is
// a one-shot or a debounce, so an arm would be pure noise; if a window ever grows a
// `setTimeout` that re-arms itself, this list is where it belongs.
const FRAME_DRIVERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['requestAnimationFrame', /(?<![\w$])requestAnimationFrame\b/g],
  ['requestIdleCallback', /(?<![\w$])requestIdleCallback\b/g],
  ['setInterval', /(?<![\w$])setInterval\b/g],
];

// The element RE-QUERY vocabulary, the third matcher family and the one the tables above
// lacked entirely. A re-query is neither a write nor a layout read, so `querySelector` was in
// none of the three families and the gate could not see it at any cadence: `lockpick_window`
// walked the panel subtree three times per 100ms tick until #2498 and nothing said a word.
// A repeated query is a subtree walk whose result the module already had, which is the
// canonical src/ui/CLAUDE.md violation ("resolve element refs ONCE into a field").
//
// Every arm is the MEMBER form, which is the deliberate difference from the bare-global arms
// in FORCED_REFLOW_READS. None of these is a global (`querySelector` is always reached off a
// node or off `document`), so there is no bare call to miss, and the member form still closes
// the aliasing escape the getComputedStyle arm had, because an alias has to be MADE through a
// member access (`const q = el.querySelector.bind(el)` counts on the line that makes it).
// `.closest` is the arm that would have gone the other way: matching the NAME would count a
// `const closest = nearestTarget(...)` in a game codebase, and this tree already declares a
// `closest(selector)` member in src/game/touch_router.ts. `.matches` is DELIBERATELY out for
// the same reason and a worse one: `matchMedia(...).matches` and `regex.matches` are both
// live here, so the arm would count noise in every direction.
// `.getElementsByClassName` / `.getElementsByTagName` match nothing in src/ui today, which is
// exactly when to add an arm rather than after someone reaches for one; both are fixtured
// below, since a count of zero cannot notice an arm that went dead.
const ELEMENT_QUERIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['.querySelector', /\.querySelector\b/g],
  ['.querySelectorAll', /\.querySelectorAll\b/g],
  ['.getElementById', /\.getElementById\b/g],
  ['.getElementsByClassName', /\.getElementsByClassName\b/g],
  ['.getElementsByTagName', /\.getElementsByTagName\b/g],
  ['.getElementsByTagNameNS', /\.getElementsByTagNameNS\b/g],
  ['.getElementsByName', /\.getElementsByName\b/g],
  ['.closest', /\.closest\b/g],
  [
    "['computed' query]",
    /\[\s*['"](?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName|getElementsByTagNameNS|getElementsByName|closest)['"]\s*\]/g,
  ],
];

// The IDL-PROPERTY write vocabulary: a DOM mutation that goes through a typed property
// instead of through `style` / `classList` / an attribute, so RAW_WRITES cannot see it.
// `btn.disabled = true` is a real per-tick write one property over from `.setAttribute`.
//
// THIS FAMILY IS SCANNED ONLY INSIDE A DRIVER CALLBACK, and the reason is measured rather
// than assumed. #2518 asked whether these belong in RAW_WRITES itself; over the whole tree
// they do not, and the two halves of the answer are worth writing down.
//   - RAW_WRITES runs over WHOLE FILES in the hot + canvas buckets, and a bare member-name
//     matcher over a whole file counts ordinary data fields: `.value` matches the `els.value`
//     countdown node in lockpick_window and the `o.value` of a view model, `.src` matches a
//     manifest record, `.selected`/`.checked` match view-model booleans by the dozen in
//     dungeon_finder_window. `.value` and `.src` are OUT of the list below for that reason,
//     even inside a callback: an allowance that reads "this driver writes .value once" when
//     the hit is a field named `value` documents a fiction.
//   - Adding `.disabled` to RAW_WRITES would ALSO not have caught the case #2518 cites.
//     `spellbook_window` is a COLD painter, and cold takes no raw-write scan at all, so the
//     arm would have been added to a scan that never runs over the module in question. That
//     one was #2519's, and it needed the cadence answer, not a new token. #2519 has since
//     landed and confirmed it from the other side: the per-row `.disabled` write it was
//     about is gone because the whole per-frame fall-through is gated now, the module STAYS
//     cold (promoting it would pin that file's whole raw-write vocabulary at exact counts,
//     mostly build-time writes in its three row builders, which is the churn the cold bucket
//     already argued against, and the count still could not tell those from the repaint
//     writes beside them), and what holds the contract is a behavioral test that drives the
//     open window across repeated identical frames, tests/spellbook_tick_repaint.test.ts.
//     A token in a per-file count was never the instrument for a per-frame question.
// Inside a driver callback the corpus is a few hundred characters and hand-checkable, which
// is the condition #2518 named, so the collision-prone middle of the list stays out and the
// rest is counted exactly, like every other allowance here.
const IDL_WRITES: ReadonlyArray<readonly [string, RegExp]> = [
  ['.disabled', /\.disabled\b/g],
  ['.hidden', /\.hidden\b/g],
  ['.checked', /\.checked\b/g],
  ['.selected', /\.selected\b/g],
  ['.readOnly', /\.readOnly\b/g],
  ['.indeterminate', /\.indeterminate\b/g],
  ['.srcset', /\.srcset\b/g],
  // The two a11y-carrying IDL writes, in for a reason the collision argument above does not
  // cover: a per-tick `ariaLabel` or `tabIndex` write is the shape that most deserves counting,
  // since it churns the accessibility tree rather than just a pixel. `.title`, `.alt` and
  // `.placeholder` stay OUT with `.value` and `.src`: all three are ordinary record field names
  // in this tree (yumi_match_painter alone writes `.title` three times as data).
  ['.ariaLabel', /\.ariaLabel\b/g],
  ['.tabIndex', /\.tabIndex\b/g],
  [
    "['computed' idl]",
    /\[\s*['"](?:disabled|hidden|checked|selected|readOnly|indeterminate|srcset|ariaLabel|tabIndex)['"]\s*\]/g,
  ],
];

// The CANVAS_PAINTERS identity proof, which is what stops that list from being a
// no-contract parking space for a module that would otherwise answer to the src/ui module
// sweep in tests/architecture.test.ts. A registered canvas painter must BOTH name a 2D
// context type and actually issue a 2D drawing call.
//
// Both halves are load-bearing. The type reference alone is trivially gameable, since
// `CanvasRenderingContext2D` is a lib.dom global with no import line to grep and any module
// can annotate an unused parameter with it. The drawing vocabulary is behavioral and
// survives type erasure; it is a CLOSED list of methods that exist only on a 2D context, so
// an ordinary `rows.fill(0)` or `list.stroke` cannot match (`.fill(` and `.stroke(` are
// deliberately absent for exactly that reason). The binding case is unit_portrait_painter,
// the least canvas-heavy of the five, with one clearRect and two drawImage calls.
//
// A LIMIT worth stating rather than implying: most of these arms are used by no registered
// canvas painter today, so a typo inside the alternation would be pinned faithfully and stay
// dead. The disjunction is what makes that survivable, since any ONE live arm proves the
// module draws, but it is the same class of hole the raw-write table had and it is not closed
// here, only bounded.
const CANVAS_CONTEXT_RE = /\b(?:Offscreen)?CanvasRenderingContext2D\b/;
const CANVAS_DRAW_RE =
  /\.(?:beginPath|closePath|moveTo|lineTo|arcTo|ellipse|quadraticCurveTo|bezierCurveTo|fillRect|strokeRect|clearRect|fillText|strokeText|drawImage|createLinearGradient|createRadialGradient|createPattern|putImageData|getImageData|createImageData|measureText|setLineDash|roundRect)\s*\(/;

// Both arms drive ONE assertion site, from this table, so the proof cannot be halved by
// pointing the second assertion at the first regex. Two canvas matchers both read right at
// a glance, so the teeth test below discriminates them by fixture rather than by name.
const CANVAS_IDENTITY: ReadonlyArray<readonly [string, RegExp, string]> = [
  [
    'names a 2D context type',
    CANVAS_CONTEXT_RE,
    'a CANVAS_PAINTERS entry must name a 2D context type (CanvasRenderingContext2D), whether it mints the context or takes one injected',
  ],
  [
    'draws on a 2D context',
    CANVAS_DRAW_RE,
    "a CANVAS_PAINTERS entry must actually draw on a 2D context (fillText / drawImage / beginPath / ...). A module that only ANNOTATES a context is a DOM module wearing a painter's name: move it to UI_DOM_MODULES in tests/architecture.test.ts and rename it off *_painter.ts",
  ],
];

// The two fixtures that tell the arms apart: source that names the type and draws nothing,
// and source that draws and names no type. Each arm accepts exactly one of them.
const CANVAS_TYPE_ONLY = 'export function paint(ctx: CanvasRenderingContext2D): void { return; }';
const CANVAS_DRAW_ONLY = 'c.clearRect(0, 0, w, h); c.drawImage(sprite, x, y);';

// One allowance map per matcher list, keyed by the labels above. Anything not listed must
// be ZERO, and the count is EXACT in both directions, which is what keeps an allowance from
// rotting: a granted read that is later deleted fails until the number comes back down.
type TokenAllowance = Readonly<Partial<Record<string, number>>>;

// WHAT A GRANTED DRIVER ALLOWANCE COSTS, which until #2518 was nothing at all.
//
// A `driverAllow: { setInterval: 1 }` entry recorded that a module repaints on a cadence and
// then implied NOTHING about what runs on that cadence: whatever the callback did was held to
// no write rule and no query rule, at any speed. lockpick_window is the proof. Its granted
// interval was documented right here as "the fastest module-owned driver in the bucket", and
// inside that 100ms callback it re-resolved three element refs with `querySelector` and made
// an unelided `classList.toggle` on every tick for the whole length of an attempt. Neither
// was visible to anything: `querySelector` was in none of the three matcher families, and the
// raw-write scan is waived for cold by design, because a COUNT over a whole window file
// cannot tell a build-time write from a repeated one.
//
// Inside a driver callback it CAN, and that is the whole idea. The corpus is not a file, it
// is the code one tick executes, so every write in it repeats at the cadence beside it and a
// count means something. One entry per driver CALL SITE, in source order.
interface DriverCallbackAllowance {
  /** Which FRAME_DRIVERS matcher this call site arms. */
  readonly driver: string;
  /**
   * The cadence, in ms, PINNED against the literal in the source (null for a driver that
   * takes no delay, or a delay that is not a literal). This is what makes the number
   * load-bearing instead of a comment that drifts: re-tuning a 100ms clock to 16ms fails
   * here until the entry says so, which is the point at which someone re-reads the counts
   * below and asks whether they are still cheap enough.
   */
  readonly everyMs: number | null;
  /** What the driver is for, and what its per-tick work is allowed to be. */
  readonly why: string;
  /**
   * Same-module method names where the reachability walk STOPS, each mapped to its reason.
   *
   * The knob exists because one shape needs it: a poll whose callback calls the module's
   * ordinary full-render entry point reaches the entire module, and counting that would
   * re-run the argument the cold bucket already settled, where a count over a render path
   * churns on every ordinary edit while the hazard it is meant to catch moves no count at
   * all. Cutting there leaves the tick's OWN work, which is what the driver is responsible
   * for. A cut is a conscious diff line with a stated reason, like every allowance here, and
   * a cut that turns out to be unreachable fails as dead.
   */
  readonly stopsAt?: Readonly<Record<string, string>>;
  /** Counted RAW_WRITES allowance over everything the tick reaches. */
  readonly writeAllow: TokenAllowance;
  /** Counted ELEMENT_QUERIES allowance over everything the tick reaches. */
  readonly queryAllow: TokenAllowance;
  /** Counted IDL_WRITES allowance over everything the tick reaches. */
  readonly idlAllow: TokenAllowance;
  /**
   * Counted FORCED_REFLOW_READS allowance over everything the tick reaches. Separate from the
   * per-FILE reflowAllow beside it, and not redundant with it: that one says the module makes N
   * layout reads, this one says how many of them happen on a tick.
   */
  readonly reflowAllow: TokenAllowance;
}

interface ScannedPainter {
  file: string;
  allow: TokenAllowance;
  reflowAllow: TokenAllowance;
  driverAllow?: TokenAllowance;
  drivers?: ReadonlyArray<DriverCallbackAllowance>;
}

// BUCKET 1 of 3, the strictest: the painters held to the full write contract. Mostly
// per-frame and facet-routed, but membership is the CONTRACT, not the cadence: tab_strip
// is cold chrome wiring that holds it anyway, and a cold `*_painter.ts` has nowhere else to
// go, since the completeness check below forces every `*_painter.ts` into this bucket or the
// canvas one. Allowed counts: anything not listed must be ZERO. auras builds its pooled node
// + the .dur / .stacks children once
// in createNode (3 className writes); fct sets the base class once and aria-hidden once per
// pooled node, both at build; fct also forces ONE documented offsetWidth reflow to restart
// the float animation on a recycled node.
const HOT_PAINTERS: ReadonlyArray<ScannedPainter> = [
  { file: 'xp_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'swing_timer_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'proc_overlay_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'aura_overlay_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'cast_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'unit_frame_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'hud/action_bar/action_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'hud/action_bar/mobile_action_ring_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'party_frames_painter.ts', allow: {}, reflowAllow: {} },
  // party_below_target measures the target frame, its #tf-debuffs strip, the
  // party container, and (on mobile) the rows wrapper + move zone (five rect
  // reads) ONLY when its cheap invalidation key changes (target/buff-count/
  // layout change), never steady-state per frame; every property write routes
  // through the elided setStyleProp facet. The same gated measure also pays
  // getComputedStyle via the shared getUiScale helper (ui_scale.ts), which
  // this per-file scan cannot see; it is behind the same key, so steady state
  // stays layout-read-free.
  {
    file: 'party_below_target_painter.ts',
    allow: {},
    reflowAllow: { '.getBoundingClientRect': 5, getUiScale: 3 },
  },
  // cold-path chrome wiring (click/roving-keyboard listeners), fired once per full
  // window render like the hand-rolled listeners it replaces, not a per-frame painter.
  // It makes no raw DOM writes; the 3 `.dataset` hits are reads of `tab.dataset.tab`
  // (one in the click handler, one in the roving-key branch, one in the Enter/Space
  // branch), never a per-frame write.
  { file: 'tab_strip_painter.ts', allow: { '.dataset': 3 }, reflowAllow: {} },
  // yumi builds its whole strip + respawn overlay once in ensureEls (14 class
  // assignments + the two role attributes + the toggle's type); every
  // per-frame write is facet-routed.
  {
    file: 'yumi_match_painter.ts',
    allow: { '.className': 14, '.setAttribute': 3 },
    reflowAllow: {},
  },
  { file: 'auras_painter.ts', allow: { '.className': 3 }, reflowAllow: {} },
  {
    file: 'fct_painter.ts',
    allow: { '.className': 1, '.setAttribute': 1 },
    reflowAllow: { '.offsetWidth': 1 },
  },
  // deed_tracker builds its whole static skeleton (header + pooled lines) in
  // ONE constructor innerHTML write; every refresh write is facet-routed. The
  // three setAttribute/removeAttribute pairs run ONLY on a chip-mode
  // transition (compact-touch tier flip, guarded by lastChip): the elided
  // setAttr facet caches per (element, attr) and would go stale across a raw
  // removeAttribute, so the transition swap must be direct. Never per-frame.
  {
    file: 'deed_tracker_painter.ts',
    allow: { '.innerHTML': 1, '.setAttribute': 3, '.removeAttribute': 3 },
    reflowAllow: {},
  },
];

// BUCKET 2 of 3: the src/ui painters that are NOT facet-routed because they draw to a 2D
// canvas under the cadence + cached-token regime (resolve --color-* tokens once, never
// per-marker), where canvas drawing and one-time element sizing are not "raw per-frame DOM
// writes". They are still SCANNED, with their own counted exceptions.
//
// This list used to be a bare five-line exemption with no scan behind it, which made
// "name your DOM-touching module <thing>_painter.ts and add one line here" the cheapest way
// for a src/ui module to hold no contract at all: the module sweep in
// tests/architecture.test.ts carves every *_painter.ts out of its own domain and hands it
// here. Three things now stand behind the list instead: the same raw-write scan, the same
// forced-reflow scan, and the CANVAS_* identity proof above. The scans are the real
// protection, and the stronger claim of the three: a parked DOM module now has to survive
// them at exact counts. The identity proof is a source-text check and should not be read as
// more than it is, since two lines of dead but syntactically real canvas code satisfy it.
// (Render-resident painters under src/render, e.g. the cadence-throttled nameplate_painter,
// are intentionally outside this HUD-painter file.)
//
// The counted reads are the token resolves this file's prose used to merely assert: each of
// the three map-family painters holds ONE getComputedStyle pass over the document element,
// reading its whole --color-* group in one go. Their cadences differ and the old flat "once
// per redraw" hid it: minimap caches the resolve for the session, while map and delve
// re-resolve on every redraw. unit_portrait keys its decode-race guard off
// canvas.dataset.portrait, 4 accesses around one async image decode, two of them writes at
// the start of a decode and two of them reads that abandon a decode whose unit changed;
// perf_graph is handed both its context and its color and reaches for neither.
const CANVAS_PAINTERS: ReadonlyArray<ScannedPainter> = [
  { file: 'continent_map_painter.ts', allow: {}, reflowAllow: { getComputedStyle: 1 } },
  { file: 'hud/delve/delve_map_painter.ts', allow: {}, reflowAllow: { getComputedStyle: 1 } },
  { file: 'map_window_painter.ts', allow: {}, reflowAllow: { getComputedStyle: 1 } },
  { file: 'minimap_painter.ts', allow: {}, reflowAllow: { getComputedStyle: 1 } },
  { file: 'perf_graph_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'unit_portrait_painter.ts', allow: { '.dataset': 4 }, reflowAllow: {} },
];

// BUCKET 3 of 3: cold painters, the DEFAULT for a `*_window.ts`.
//
// FIRST, WHAT "COLD" DOES NOT MEAN, because the obvious reading is wrong and this gate must
// not repeat it. It does NOT mean nothing calls the window repeatedly. Hud.update() polls
// roughly half of them: spellbook_window's tickOpen() runs EVERY FRAME while the window is
// open and says so in its own comments; arena, dungeon_finder, vale_cup and card_duel are
// render()ed on the 250ms medium band behind only a display check; social, market, mailbox,
// bank, bags, deeds, professions and calendar get refreshIfChanged() on the 500ms band; and
// crafting, loot_settings and town_focus are repainted behind invalidation signatures. The
// repo's INTENDED window pattern is POLL CHEAPLY, REBUILD ON A SIGNATURE CHANGE, and the guard
// lives where no per-file scan can see it: inside the window module, or on the Hud method that
// polls it. town_focus was the standing proof that this is a convention rather than something
// anything enforces, and it held that role until #2500 gave it a signature; the enforcement is
// now tests/hud_update_drive.test.ts, which requires a guard per driven window row by name.
//
// So this bucket claims nothing about cadence. What it does is hold the two contracts that
// are true whatever the cadence turns out to be, at the same exact counts every other bucket
// uses:
//   - no forced-reflow layout read (layout thrash is expensive per REDRAW, not per frame),
//   - no repeating DRIVER of its own (see FRAME_DRIVERS above).
//
// AND WHY THE RAW-WRITE SCAN IS DELIBERATELY NOT ONE OF THEM. Not because windows are cold,
// which the paragraph above just refuted, but because a COUNT is the wrong instrument for
// this question at any cadence: it cannot tell a build-time write from a per-frame one, so
// it fails on the ordinary window edits that make up a large share of src/ui commits while
// the hazard it is meant to catch, an existing write starting to repeat, moves no count at
// all. (The measurement that settled it, taken when this bucket was added rather than pinned
// anywhere: the heaviest window carried well over two hundred build-time writes and was the
// single most-edited module in the family.) The instrument that WOULD answer it is a
// contract on Hud.update()'s call graph, naming which windows it drives and on which band,
// so a window polled per frame is held to write-elision and a signature-guarded one is not.
// That is a different gate in a different file, with its own blast radius: a source walk
// over a coordinator this size leans entirely on its own anti-vacuity pins. Filed as a
// follow-up rather than half-built here, because a declaration naming a handful of windows
// when roughly half the family qualifies would read as a complete classification and would
// not be one.
//
// Cold needs NO registration, which is what makes it safe as a default: every window painter
// not listed below is held to zero on every matcher, so a new window is covered the day it
// lands rather than the day someone remembers it. The asymmetry with `*_painter.ts`, which
// must be consciously placed in HOT_PAINTERS or CANVAS_PAINTERS or fail the completeness
// check, is on purpose: that name asserts the strict write contract or canvas, so a
// forgotten one is a real mistake, while a window starts here until someone shows otherwise.
interface ColdPainter {
  file: string;
  reflowAllow: TokenAllowance;
  driverAllow: TokenAllowance;
  drivers?: ReadonlyArray<DriverCallbackAllowance>;
}

const COLD_PAINTER_ALLOWANCES: ReadonlyArray<ColdPainter> = [
  // One app-viewport rect when the player starts dragging an aura in setup mode. The cached
  // rect converts pointer moves to persisted normalized X/Y values; the controller owns no
  // clock and performs no layout read during ordinary combat painting.
  {
    file: 'aura_overlay_controller.ts',
    reflowAllow: { '.getBoundingClientRect': 1 },
    driverAllow: {},
  },
  // The scroll pair is the shape repeated across the windows: read the position before a
  // rebuild, write it back after, so the list does not jump under the player. Legitimate and
  // stable, granted per file, and the count is what makes a THIRD read in the same file (the
  // shape that turns a rebuild loop into thrash) a conscious act.
  {
    file: 'bags_window.ts',
    reflowAllow: { '.getBoundingClientRect': 1, '.scrollTop': 4 },
    driverAllow: {},
  },
  { file: 'bank_window.ts', reflowAllow: { '.scrollTop': 4 }, driverAllow: {} },
  // The scroll pair and the rAF both belonged to the mount picker's
  // scroll-the-selected-card-into-view path, which went away when reins became
  // usable items and the picker was deleted. The sheet now reads nothing and
  // arms nothing.
  { file: 'char_window.ts', reflowAllow: {}, driverAllow: {} },
  {
    file: 'crafting_window.ts',
    reflowAllow: { '.scrollTop': 2, '.scrollLeft': 2 },
    driverAllow: {},
  },
  // Two polls that repaint an OPEN window only: a 15s refresh of the reward state and a 30s
  // countdown tick. Page cadence rather than frame cadence, and both no-op while closed.
  {
    file: 'daily_rewards_window.ts',
    reflowAllow: {},
    driverAllow: { setInterval: 2 },
    drivers: [
      {
        driver: 'setInterval',
        everyMs: 15_000,
        why: 'the reward-state refresh: re-fetch status + history and repaint the open window. Its per-tick body is the `isOpen` guard and a call into renderCurrent, the SAME entry point an open or a tab switch takes, so the DOM cost below is the guard only.',
        stopsAt: {
          renderCurrent:
            "the window's ordinary full re-render, shared with toggle() / openStore() / a tab click. Counting a render path per driver would re-run the argument the cold bucket settled (a count over a render churns on every edit and never moves when the real hazard lands); what this entry holds is that the 15s tick does nothing EXTRA on its way there.",
        },
        // The one `.style` is the `isOpen` getter reading `root().style.display`, not a write:
        // this matcher counts ACCESSES, the same way the granted `.scrollTop` reads elsewhere
        // in this file are half write-backs. It works as a change detector either way.
        writeAllow: { '.style': 1 },
        queryAllow: {},
        idlAllow: {},
        reflowAllow: {},
      },
      {
        driver: 'setInterval',
        everyMs: 30_000,
        why: 'the countdown tick: rewrite the "ends in" labels so the open window does not show a stale time. Reaches the `isOpen` guard plus paintCountdowns and its remainingText formatter.',
        // `.style` is the isOpen guard again; `.textContent` is the countdown label, which
        // genuinely differs every tick, so it is an unelided write ON PURPOSE at 30s cadence;
        // `.dataset` is the read of the reset timestamp off each node.
        writeAllow: { '.style': 1, '.textContent': 1, '.dataset': 1 },
        // ONE subtree walk per tick to find the countdown nodes. It is a re-query rather than
        // a cached ref because the nodes are replaced by every repaint of the window; at 30s
        // that is cheap, and the count is what makes a second one a conscious act.
        queryAllow: { '.querySelectorAll': 1 },
        idlAllow: {},
        reflowAllow: {},
      },
    ],
  },
  { file: 'deeds_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  { file: 'dungeon_finder_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  // The lockpick clock: a 100ms tick that repaints the remaining-time bar for the duration
  // of one attempt, generation-guarded and cleared on stop. The fastest module-owned driver
  // in the bucket, and the reason setInterval is counted rather than banned.
  {
    file: 'hud/delve/lockpick_window.ts',
    reflowAllow: {},
    driverAllow: { setInterval: 1 },
    drivers: [
      {
        driver: 'setInterval',
        everyMs: 100,
        why: 'the per-step countdown: repaint the remaining-time bar 10x a second for the length of one attempt, generation-guarded so a superseded clock no-ops. The fastest module-owned driver in the bucket, so it is the one whose per-tick work is worth counting most.',
        // The three writes paintTimer makes, and each is here because it MOVES every tick or
        // is latched so it does not. Width and label are the countdown by definition; the
        // urgent class flips at most once per attempt and rides `lastUrgent` rather than a
        // blind per-tick toggle. Anything beyond these three repeats 10x a second.
        writeAllow: { '.style': 1, '.textContent': 1, '.classList': 1 },
        // ZERO, and this is the entry the whole gate is for. Before #2498 this tick walked the
        // panel subtree four times (three querySelector + the getElementById behind panel())
        // to re-find nodes it already had, ten times a second. The refs are now resolved once
        // per board rebuild, at the one innerHTML site that destroys them.
        queryAllow: {},
        idlAllow: {},
        // Zero, and worth stating: the countdown writes a width but never READS one back. A
        // layout read here would flush pending layout ten times a second, the same thrash the
        // per-file scan bans on a redraw, only faster.
        reflowAllow: {},
      },
    ],
  },
  // The three controllers with real layout reads. chat_geometry measures the chat box to
  // clamp a drag or resize; chat_window fits the input and keeps the log pinned to the
  // bottom; fiesta forces one reflow to restart a CSS animation, the same documented trick
  // fct_painter uses.
  {
    file: 'hud/chat/chat_geometry_controller.ts',
    reflowAllow: { '.getBoundingClientRect': 5 },
    driverAllow: {},
  },
  {
    file: 'hud/chat/chat_window_controller.ts',
    reflowAllow: {
      '.clientWidth': 1,
      '.scrollWidth': 1,
      '.scrollHeight': 1,
      '.scrollTop': 1,
      '.scrollLeft': 1,
      '.getBoundingClientRect': 1,
    },
    driverAllow: {},
  },
  { file: 'hud/fiesta/fiesta_controller.ts', reflowAllow: { '.offsetWidth': 1 }, driverAllow: {} },
  { file: 'hud/vendor/heroic_vendor_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  { file: 'hud/vendor/train_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  { file: 'hud/vendor/unbind_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  { file: 'hud/vendor/vendor_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  // A body/wrap rect pair, read once when the mail body is laid out to fit.
  { file: 'mailbox_window.ts', reflowAllow: { '.getBoundingClientRect': 2 }, driverAllow: {} },
  // The trigger + popover rect pair that positions a filter popover, plus the two border
  // widths its height clamp needs. Per open, not per row.
  {
    file: 'market_window.ts',
    reflowAllow: { '.getBoundingClientRect': 2, getComputedStyle: 2, '.scrollTop': 2 },
    driverAllow: {},
  },
  // The bug-report submit path schedules its screenshot capture off the critical
  // path. ONE call, guarded by a feature check with a setTimeout fallback; the
  // count is 3 because the optional-API type declaration names it twice more.
  { file: 'options_window.ts', reflowAllow: {}, driverAllow: { requestIdleCallback: 3 } },
  { file: 'professions_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  { file: 'spellbook_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
  // The root, trigger, and popover rects position the target-aura configurator inside the
  // viewport. They run only when the player opens or changes that configurator, or when an
  // open configurator receives a viewport resize event, never from the aura paint cadence.
  {
    file: 'target_auras_window.ts',
    reflowAllow: { '.getBoundingClientRect': 3 },
    driverAllow: {},
  },
  // The tree height-cap fit: the root's max-height (read through the shared getUiScale
  // helper as well, which is why the proxy token is granted here), then the body and root
  // tops and the footer height, then one scrollHeight to decide whether the body scrolls.
  // One pass per layout, not per talent node.
  {
    file: 'talents_window.ts',
    reflowAllow: {
      '.getBoundingClientRect': 3,
      '.scrollHeight': 1,
      getComputedStyle: 1,
      getUiScale: 2,
    },
    driverAllow: {},
  },
  { file: 'town_focus_window.ts', reflowAllow: { '.scrollTop': 2 }, driverAllow: {} },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// `String.prototype.match` with a /g regex is stateless (it resets lastIndex itself), so
// the shared matcher objects above can be counted against many files without leaking a
// cursor between them. Never call .test() on one of those; the identity regexes that ARE
// tested carry no /g flag.
function countMatches(code: string, re: RegExp): number {
  return (code.match(re) ?? []).length;
}

function painterRawSource(file: string): string {
  return readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
}

function painterSource(file: string): string {
  return stripComments(painterRawSource(file));
}

// The painter half of the src/ui classification: these two suffixes are what make a module
// a painter. The OTHER half is the module-classification sweep in
// tests/architecture.test.ts, whose literal SWEPT_BY_NAME_RE carves *_painter.ts out of its
// own domain and hands it here, and keeps *_window.ts. The two are coupled by shared
// suffixes, not by a shared symbol, so the dangerous edit is widening THAT one: adding
// _window to SWEPT_BY_NAME_RE would drop every window painter out of its module sweep, and
// it must not, because the two gates cover different things. A window painter is
// DOUBLE-COVERED on purpose: the module sweep pins that it owns browser state (UI_DOM_MODULES
// for the 29 that reach a host), and this gate pins its layout-read and frame-driver
// contract. Change them together.
function findUiPainters(dir: string, prefix = ''): string[] {
  const painters: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      painters.push(...findUiPainters(`${dir}/${entry.name}`, relative));
    } else if (entry.isFile() && PAINTER_FILE_RE.test(entry.name)) {
      painters.push(relative);
    }
  }
  return painters.sort();
}

const UI_DIR = fileURLToPath(new URL('../src/ui', import.meta.url));
const ON_DISK_PAINTERS = findUiPainters(UI_DIR);
const SCANNED_PAINTERS: ReadonlyArray<ScannedPainter> = [...HOT_PAINTERS, ...CANVAS_PAINTERS];
const SCANNED_FILES = new Set(SCANNED_PAINTERS.map((p) => p.file));
// Cold is scoped to the window name so an UNCLASSIFIED *_painter.ts does not quietly fall
// into the loosest bucket: it fails the completeness check below with the message that
// tells you to classify it, which is the property this gate already had.
const COLD_PAINTERS = ON_DISK_PAINTERS.filter(
  (f) => (f.endsWith('_window.ts') || f.endsWith('_controller.ts')) && !SCANNED_FILES.has(f),
);

interface SweepResult {
  violations: string[];
  scanned: string[];
  observed: number;
  checked: string[];
}

// The bucket sweep, extracted so the VERDICT PATH itself can be exercised. Collecting into
// `violations` and asserting the collection is empty puts a comparator between the counts and
// the assertion, and nothing about a green run proves that comparator still works: flip the
// `!==` to `<` and every count still matches, every file is still visited, and the test still
// passes while both cold contracts are silently off. The teeth test below runs this same
// function over a synthetic source map with a planted violation, which is what makes the
// comparator load-bearing rather than decorative.
function sweepBucket(
  files: readonly string[],
  matchers: ReadonlyArray<readonly [string, RegExp]>,
  allowanceFor: (file: string) => TokenAllowance,
  read: (file: string) => string,
): SweepResult {
  const violations: string[] = [];
  const scanned: string[] = [];
  const checked = new Set<string>();
  let observed = 0;
  for (const file of files) {
    const code = read(file);
    const allow = allowanceFor(file);
    scanned.push(file);
    for (const [token, re] of matchers) {
      const expected = allow[token] ?? 0;
      const actual = countMatches(code, re);
      checked.add(token);
      observed += actual;
      if (actual !== expected) {
        violations.push(`${file}: ${token} appears ${actual}x, expected ${expected}`);
      }
    }
  }
  return { violations, scanned, observed, checked: [...checked] };
}

// What one tick of a granted driver is allowed to do. The sweep is extracted for the same
// reason sweepBucket is: everything else about it asserts that a list is empty, which a
// broken comparator satisfies trivially, so the positive control below drives THIS function
// over synthetic sources with a planted violation.
interface DriverBodySweep {
  violations: string[];
  /** `file#index` per callback actually scanned, in order. */
  scanned: string[];
  /** How many driver call sites were resolved out of real source. */
  resolved: number;
  /** Total matches counted, across every family. Zero means the scan read nothing. */
  observed: number;
  /** The matcher labels walked, so a truncated family cannot pass by asserting nothing. */
  checked: string[];
  /** `file: name` for every declared cut the walk actually ran into. */
  cuts: string[];
}

interface DriverHost {
  readonly file: string;
  readonly drivers?: ReadonlyArray<DriverCallbackAllowance>;
}

// All FOUR families, and the reflow one is here for the same reason the whole gate is. A
// granted per-file `reflowAllow` says a module makes N layout reads and, exactly like a granted
// driver before #2518, implies nothing about WHEN: a read granted for a rebuild can migrate
// into a 100ms tick and move no count anywhere. It is free today, because no entry has both a
// non-empty reflowAllow and a non-empty driverAllow, which is precisely when to add it rather
// than after the first module that has both.
const DRIVER_BODY_FAMILIES = [
  ['writeAllow', RAW_WRITES],
  ['queryAllow', ELEMENT_QUERIES],
  ['idlAllow', IDL_WRITES],
  ['reflowAllow', FORCED_REFLOW_READS],
] as const;

function sweepDriverBodies(
  hosts: ReadonlyArray<DriverHost>,
  read: (file: string) => string,
): DriverBodySweep {
  const violations: string[] = [];
  const scanned: string[] = [];
  const checked = new Set<string>();
  const cuts: string[] = [];
  let resolved = 0;
  let observed = 0;
  const driverNames = labelsOf(FRAME_DRIVERS);

  for (const { file, drivers } of hosts) {
    if (!drivers || drivers.length === 0) continue;
    const source = read(file);
    let countMismatch = false;
    drivers.forEach((grant, index) => {
      if (countMismatch) return;
      // Resolved once PER ENTRY with only that entry's cuts, so one grant's declared stop
      // cannot silently shrink a sibling grant's closure in the same module. Pinned by the
      // two-driver synthetic in the positive control, where entry #0 cuts a method entry #1
      // must still be scanned through.
      //
      // The source handed in is RAW, never comment-stripped: stripComments is a regex whose
      // `//` arm would truncate a line at a `//` inside a string or a template literal, and
      // ts.createSourceFile does not throw on the broken tree that results, it just silently
      // loses a call site. The parse gets real source; only the RESOLVED tick corpus is
      // stripped, below.
      const found = readDriverCallbacks(
        file,
        source,
        driverNames,
        Object.keys(grant.stopsAt ?? {}),
      );
      if (found.length !== drivers.length) {
        violations.push(
          `${file}: ${drivers.length} driver allowance entr(ies) declared, ${found.length} driver call site(s) in the source`,
        );
        countMismatch = true;
        return;
      }
      const callback = found[index] as (typeof found)[number];
      resolved += 1;
      scanned.push(`${file}#${index}`);
      const at = `${file}#${index} (${callback.driver} every ${callback.delayMs}ms, line ${callback.line})`;
      if (callback.driver !== grant.driver) {
        violations.push(
          `${file}#${index}: the source arms ${callback.driver}, the allowance declares ${grant.driver}`,
        );
      }
      if (callback.delayMs !== grant.everyMs) {
        violations.push(
          `${file}#${index}: ${callback.driver} is armed every ${callback.delayMs}ms, the allowance declares ${grant.everyMs}ms`,
        );
      }
      for (const name of Object.keys(grant.stopsAt ?? {})) {
        if (callback.stopped.includes(name)) cuts.push(`${file}: ${name}`);
        else {
          violations.push(
            `${file}#${index}: stopsAt names "${name}", which this callback never reaches, so the cut is dead and hides nothing`,
          );
        }
      }
      const code = stripComments(callback.code);
      for (const [kind, matchers] of DRIVER_BODY_FAMILIES) {
        const allow = grant[kind];
        for (const [token, re] of matchers) {
          const expected = allow[token] ?? 0;
          const actual = countMatches(code, re);
          checked.add(token);
          observed += actual;
          if (actual !== expected) {
            violations.push(`${at}: ${token} appears ${actual}x on the tick, expected ${expected}`);
          }
        }
      }
    });
  }
  return { violations, scanned, resolved, observed, checked: [...checked], cuts };
}

const coldReflowAllowance = new Map(COLD_PAINTER_ALLOWANCES.map((c) => [c.file, c.reflowAllow]));
const coldDriverAllowance = new Map(COLD_PAINTER_ALLOWANCES.map((c) => [c.file, c.driverAllow]));
// Every bucket, since a driver allowance is grantable in any of them and the hot/canvas ones
// hold a hard zero today. Ordered so the pinned scan list below reads in bucket order.
// The documented exception this file's own #2518 join says to write when a module
// MENTIONS a driver name more often than it CALLS it. driverAllow counts name
// occurrences (FRAME_DRIVERS); sweepDriverBodies resolves call sites; a module
// that feature-detects a driver behind a typed cast names it three times and
// calls it once, so no single grant can satisfy both halves.
//
// This is deliberately NOT a loosening of either counter. Both numbers are
// recorded here and both are asserted exactly, so the day the source changes in
// either direction (a second call site appears, or the feature-detect goes) this
// entry stops matching and the module comes back for a fresh decision instead of
// silently absorbing it.
interface DriverNameOnlyException {
  readonly file: string;
  readonly driver: string;
  /** How many times the NAME appears (what driverAllow must grant). */
  readonly names: number;
  /** How many of those the BODY SWEEP can resolve to a call it can walk. Zero
   *  when the driver is invoked through a local of a widened type rather than
   *  off the global, which is what a feature-detect looks like. */
  readonly sweepResolvable: number;
  /** How many of them arm something REPEATING, i.e. owe a per-tick callback
   *  contract. A one-shot deferral arms nothing and owes none. */
  readonly repeating: number;
  readonly why: string;
}
const DRIVER_NAME_ONLY: readonly DriverNameOnlyException[] = [
  {
    file: 'options_window.ts',
    driver: 'requestIdleCallback',
    names: 3,
    sweepResolvable: 0,
    repeating: 0,
    why: 'the bug-report screenshot capture defers itself off the interaction frame once, with a setTimeout(0) fallback. requestIdleCallback is not universally available, so the module names it three times to use it once: the optional member on the widened window type, the feature-detect guard, and the call. The call goes through that widened local rather than off the global, so the body sweep resolves none of the three. It arms nothing repeating, so there is no per-tick contract to declare either.',
  },
];
const driverNameOnlyByFile = new Map(DRIVER_NAME_ONLY.map((e) => [e.file, e]));
/** Name occurrences an exception accounts for but the body sweep cannot resolve. */
const DRIVER_NAME_ONLY_UNRESOLVABLE = DRIVER_NAME_ONLY.reduce(
  (total, e) => total + (e.names - e.sweepResolvable),
  0,
);

const DRIVER_HOSTS: ReadonlyArray<DriverHost> = [
  ...HOT_PAINTERS,
  ...CANVAS_PAINTERS,
  ...COLD_PAINTER_ALLOWANCES,
];

// The per-file scan for one matcher family. It RETURNS the labels it checked so the caller
// can assert the whole family was walked: every count in the scanned buckets is expected 0
// except a handful of documented allowances, so truncating the matcher loop to nothing
// asserts nothing and passes. Non-vacuity here has to be about the matchers, not the counts.
function checkTokenCounts(
  file: string,
  code: string,
  matchers: ReadonlyArray<readonly [string, RegExp]>,
  allow: TokenAllowance,
  why: string,
): string[] {
  const checked: string[] = [];
  for (const [token, re] of matchers) {
    const expected = allow[token] ?? 0;
    const actual = countMatches(code, re);
    checked.push(token);
    expect(actual, `${file}: ${token} appears ${actual}x, expected ${expected} (${why})`).toBe(
      expected,
    );
  }
  return checked;
}

const labelsOf = (matchers: ReadonlyArray<readonly [string, RegExp]>): string[] =>
  matchers.map(([label]) => label);

describe('hud_perf_budget ARM 1: every src/ui painter holds its bucket contract (Node, npm test)', () => {
  for (const { file, allow, reflowAllow, driverAllow } of SCANNED_PAINTERS) {
    it(`${file} owns no repeating driver of its own`, () => {
      const checked = checkTokenCounts(
        file,
        painterSource(file),
        FRAME_DRIVERS,
        driverAllow ?? {},
        'a painter driven by Hud.update() has no business owning a second clock; this scan covers every bucket so a window PROMOTED into HOT_PAINTERS keeps its driver contract instead of shedding it on the way in',
      );
      expect(checked).toEqual(labelsOf(FRAME_DRIVERS));
    });

    it(`${file} routes every per-frame write through the elided writers`, () => {
      const checked = checkTokenCounts(
        file,
        painterSource(file),
        RAW_WRITES,
        allow,
        'per-frame writes must go through the PainterHost facet; only a DOCUMENTED build-time exception is allowed',
      );
      expect(checked).toEqual(labelsOf(RAW_WRITES));
    });

    it(`${file} makes no per-frame forced-reflow layout read`, () => {
      const checked = checkTokenCounts(
        file,
        painterSource(file),
        FORCED_REFLOW_READS,
        reflowAllow,
        'a per-frame layout read flushes pending layout = thrash; only a DOCUMENTED reflow flush is allowed',
      );
      expect(checked).toEqual(labelsOf(FORCED_REFLOW_READS));
    });
  }

  // The identity proof behind CANVAS_PAINTERS. Without it the list is a place to park a
  // DOM module: the src/ui module sweep in tests/architecture.test.ts hands every
  // *_painter.ts here, so a one-line addition would otherwise buy a total exemption from
  // both gates.
  for (const { file } of CANVAS_PAINTERS) {
    it(`${file} really is a canvas painter (the CANVAS_PAINTERS entry is earned)`, () => {
      const code = painterSource(file);
      for (const [what, re, why] of CANVAS_IDENTITY) {
        expect(re.test(code), `${file}: ${what}: ${why}`).toBe(true);
      }
    });
  }

  // Completeness, half 1: every on-disk src/ui/**/*_painter.ts is either facet-routed or a
  // documented canvas painter, so a NEW painter cannot silently escape the raw-write scan
  // by being forgotten from HOT_PAINTERS.
  it('classifies every src/ui *_painter.ts as facet-routed or a documented canvas painter', () => {
    const unclassified = ON_DISK_PAINTERS.filter(
      (name) => name.endsWith('_painter.ts') && !SCANNED_FILES.has(name),
    );
    expect(
      unclassified,
      `unclassified src/ui painter(s): add a facet-routed painter to HOT_PAINTERS (it must make no raw per-frame write) or a canvas painter to CANVAS_PAINTERS (it must pass the canvas identity proof):\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  // Completeness, half 2, and the anti-vacuity pin for the widened matcher: the OTHER
  // sanctioned painter name is swept too. If PAINTER_FILE_RE were narrowed back to
  // *_painter.ts the cold sweep below would silently run over an empty set and every one of
  // its assertions would pass while covering nothing.
  it('sweeps the other two DOM-adapter names too (*_window.ts and *_controller.ts)', () => {
    const windows = ON_DISK_PAINTERS.filter((f) => f.endsWith('_window.ts'));
    expect(windows.length, 'the window painters vanished from the sweep').toBeGreaterThan(30);
    expect(windows).toContain('hud/vendor/vendor_window.ts');
    expect(windows).toContain('options_window.ts');
    expect(COLD_PAINTERS.length).toBeGreaterThan(30);
    // WHERE representative painters land, pinned by name. "every window is cold or scanned"
    // would be true by construction (COLD_PAINTERS is defined as the windows the scanned
    // buckets do not claim), so it could never fail and would prove nothing; these can.
    // map_window_painter is the one to watch: it carries `window` in its name but ends in
    // _painter, so it is the CANVAS branch and must not be mistaken for a window.
    expect(COLD_PAINTERS).toContain('hud/vendor/vendor_window.ts');
    expect(COLD_PAINTERS).toContain('options_window.ts');
    expect(windows).not.toContain('map_window_painter.ts');
    expect(SCANNED_FILES.has('map_window_painter.ts')).toBe(true);
    // The third adapter name is swept too, which is what stops a rename from shedding the
    // cold contract. Without this the widening would be unpinned: PAINTER_FILE_RE could drop
    // `controller` and every assertion in the cold sweeps would still pass over the windows.
    const controllers = ON_DISK_PAINTERS.filter((f) => f.endsWith('_controller.ts'));
    expect(controllers.length, 'the HUD controllers vanished from the sweep').toBeGreaterThan(10);
    expect(controllers).toContain('hud/chat/chat_geometry_controller.ts');
    expect(COLD_PAINTERS).toContain('hud/fiesta/fiesta_controller.ts');
  });

  // The cold contract. Swept as ONE test per matcher family over the whole bucket rather
  // than 70 near-identical cases, collecting every violation so a failure names all of them
  // at once (the idiom tests/architecture.test.ts uses for its own sweeps).
  it('cold window painters make no forced-reflow layout read beyond a documented allowance', () => {
    const { violations, scanned, observed, checked } = sweepBucket(
      COLD_PAINTERS,
      FORCED_REFLOW_READS,
      (f) => coldReflowAllowance.get(f) ?? {},
      painterSource,
    );
    expect(checked, 'the cold reflow sweep skipped part of the vocabulary').toEqual(
      labelsOf(FORCED_REFLOW_READS),
    );
    // Non-vacuity for the sweep itself, not just for its bucket: a loop narrowed to an empty
    // slice, or a painterSource() that silently returned nothing, would report zero
    // violations over zero files and read as a clean bill of health.
    expect(scanned, 'the cold reflow sweep visited a different set than the cold bucket').toEqual(
      COLD_PAINTERS,
    );
    expect(scanned).toContain('talents_window.ts');
    expect(
      observed,
      'the cold reflow sweep matched nothing at all: it read no real source',
    ).toBeGreaterThan(0);
    expect(
      violations,
      `a layout read flushes pending style + layout every time it runs, so it is thrash on a window REDRAW just as much as on a frame. Hoist the read out of the loop, cache it behind the same invalidation key the redraw uses, or add a documented, counted entry to COLD_PAINTER_ALLOWANCES saying when it runs:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('cold window painters own no repeating driver beyond a documented allowance', () => {
    const { violations, scanned, observed, checked } = sweepBucket(
      COLD_PAINTERS,
      FRAME_DRIVERS,
      (f) => coldDriverAllowance.get(f) ?? {},
      painterSource,
    );
    expect(checked, 'the cold driver sweep skipped part of the vocabulary').toEqual(
      labelsOf(FRAME_DRIVERS),
    );
    // Same non-vacuity guard as the reflow sweep: zero violations over zero files is not a
    // pass. The positive control is the lockpick clock, the one module-owned repaint driver
    // the bucket grants, so a matcher that stopped seeing `window.setInterval(` fails here.
    expect(scanned, 'the cold driver sweep visited a different set than the cold bucket').toEqual(
      COLD_PAINTERS,
    );
    expect(scanned).toContain('hud/delve/lockpick_window.ts');
    expect(
      observed,
      'the cold driver sweep matched nothing at all: it read no real source, or the driver matchers went blind',
    ).toBeGreaterThan(0);
    expect(
      violations,
      `a module that arms its own repeating callback repaints on a cadence of its own choosing, whatever it is named, so every write inside that callback repeats with it. Document the cadence with a counted COLD_PAINTER_ALLOWANCES entry, or route the repaint through the PainterHost facet and move the module to HOT_PAINTERS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // #2518: a granted driver allowance now costs something. The sweep above says a module
  // repaints on a cadence; this one says what it is allowed to DO on that cadence.
  // The exception table above is hand-authored, so its three numbers could drift
  // from the source they describe. `names` is already cross-checked by the cold
  // driver sweep (it must equal driverAllow, which that sweep counts off real
  // text). These two assertions computationally check the OTHER two claims, which
  // are the ones a re-balancing edit could otherwise quietly falsify:
  //   sweepResolvable - the call must NOT be reachable off the global, which is
  //                     what makes the body sweep unable to walk it
  //   repeating       - the call must not sit inside anything that re-arms
  // Without this, someone could make the callback genuinely recurring, adjust the
  // table to keep the arithmetic green, and lose the contract silently: exactly
  // the quiet loosening this exception exists to avoid.
  it('every DRIVER_NAME_ONLY claim is checked against the real source, not just the table', () => {
    expect(DRIVER_NAME_ONLY.length, 'the exception table is non-empty').toBeGreaterThan(0);
    for (const entry of DRIVER_NAME_ONLY) {
      const src = stripComments(painterRawSource(entry.file));
      const occurrences = src.split(entry.driver).length - 1;
      expect(
        occurrences,
        `${entry.file}: DRIVER_NAME_ONLY.names says ${entry.names} but the source names ${entry.driver} ${occurrences}x`,
      ).toBe(entry.names);

      // sweepResolvable: a call the body sweep can walk is one made straight off
      // the global. Reaching it through a widened local (the feature-detect shape)
      // is what makes it unresolvable, and it is why the count is 0.
      const globalCalls = (src.match(new RegExp(`(?<![.\\w])${entry.driver}\\s*\\(`, 'g')) ?? [])
        .length;
      expect(
        globalCalls,
        `${entry.file}: ${entry.driver} is called off the global ${globalCalls}x, so the body sweep CAN resolve it and sweepResolvable: ${entry.sweepResolvable} is wrong`,
      ).toBe(entry.sweepResolvable);

      // repeating: count real CALL expressions, not name mentions. A cadence needs
      // the driver invoked more than once (or re-armed from inside its own
      // callback, which would itself be a second call expression), so exactly one
      // call is the shape of a one-shot deferral and cannot be a repeating driver.
      // Counting calls rather than names is what keeps the feature-detect guard
      // (`if (x.requestIdleCallback)`) and the type declaration out of the total.
      const callExpressions = (src.match(new RegExp(`${entry.driver}\\s*\\(`, 'g')) ?? []).length;
      if (entry.repeating === 0) {
        expect(
          callExpressions,
          `${entry.file}: ${entry.driver} has ${callExpressions} call expressions, so repeating: 0 (a one-shot deferral) is wrong`,
        ).toBe(1);
      } else {
        expect(callExpressions).toBeGreaterThanOrEqual(entry.repeating);
      }
    }
  });

  it('a granted repeating driver does only its documented work on each tick', () => {
    const sweep = sweepDriverBodies(DRIVER_HOSTS, painterRawSource);
    expect(sweep.checked, 'the driver-body sweep skipped part of the vocabulary').toEqual([
      ...labelsOf(RAW_WRITES),
      ...labelsOf(ELEMENT_QUERIES),
      ...labelsOf(IDL_WRITES),
      ...labelsOf(FORCED_REFLOW_READS),
    ]);
    // ...and the family table itself is pinned, so the loop above cannot be satisfied by a
    // table that quietly lost the family it was supposed to walk.
    expect(DRIVER_BODY_FAMILIES.map(([kind]) => kind)).toEqual([
      'writeAllow',
      'queryAllow',
      'idlAllow',
      'reflowAllow',
    ]);
    // NON-VACUITY, and it needs three separate pins because each covers a different way this
    // sweep could scan nothing while reporting a clean bill of health.
    //
    // FIRST, the call sites resolved must match the DRIVER NAMES the other sweep counted.
    // That is the join between the two gates: FRAME_DRIVERS counts a name, this resolves a
    // call, and a name that is not a resolvable call (an alias, a driver armed through a
    // helper) fails here instead of quietly scanning one fewer callback.
    // A CONSTRAINT THIS JOIN IMPOSES, stated so it is a decision rather than a trap: driverAllow
    // counts NAME occurrences while this counts CALL SITES, so a module that mentions a driver
    // name without calling it (`typeof requestAnimationFrame === 'function'`) would need more
    // granted names than it has call sites and could not satisfy both halves. No such module
    // exists in src/ui, and the strictness is what makes an unresolvable driver loud; the day
    // one does, this is the join that gets a documented exception rather than a quiet loosening.
    const grantedDrivers = DRIVER_HOSTS.reduce(
      (total, host) =>
        total +
        Object.values((host as { driverAllow?: TokenAllowance }).driverAllow ?? {}).reduce<number>(
          (n, granted) => n + (granted ?? 0),
          0,
        ),
      0,
    );
    expect(
      sweep.resolved + DRIVER_NAME_ONLY_UNRESOLVABLE,
      'a granted driver did not resolve to a real call site (and no DRIVER_NAME_ONLY entry accounts for it)',
    ).toBe(grantedDrivers);
    expect(sweep.resolved, 'the driver-body sweep resolved nothing at all').toBeGreaterThan(0);
    // SECOND, exactly which callbacks were walked, both ways. A host list narrowed to an
    // empty slice, or a `drivers` list quietly deleted from an entry, reports zero violations
    // over zero callbacks and reads as a pass.
    expect(sweep.scanned).toEqual([
      'daily_rewards_window.ts#0',
      'daily_rewards_window.ts#1',
      'hud/delve/lockpick_window.ts#0',
    ]);
    // THIRD, the matchers must have seen real source. The positive control is the lockpick
    // clock, whose three per-tick writes are the reason this gate exists.
    expect(
      sweep.observed,
      'the driver-body sweep matched nothing at all: it read no real source, or the matchers went blind',
    ).toBeGreaterThan(0);
    // The hot and canvas buckets contribute ZERO callbacks today, so narrowing DRIVER_HOSTS to
    // the cold bucket alone would keep every other assertion here green while a future
    // hot-bucket driver grant went unscanned. Pinned by length, both ways.
    expect(DRIVER_HOSTS.length).toBe(
      HOT_PAINTERS.length + CANVAS_PAINTERS.length + COLD_PAINTER_ALLOWANCES.length,
    );
    expect(DRIVER_HOSTS.map((h) => h.file)).toContain('xp_bar_painter.ts');
    expect(DRIVER_HOSTS.map((h) => h.file)).toContain('minimap_painter.ts');
    // THE CUT REGISTRY, and it is doing more work than it looks. `stopsAt` is the one knob here
    // that could re-open #2518 a level up (name the method that does the work, zero the budget),
    // and this exact-list pin is what stops it being cheap: a cut added anywhere in any bucket
    // shows up as a new row and fails until it is argued for in the diff.
    expect(sweep.cuts, 'the one declared reachability cut stopped reaching anything').toEqual([
      'daily_rewards_window.ts: renderCurrent',
    ]);
    expect(
      sweep.violations,
      `a repeating driver's callback runs its whole reachable body at the cadence beside it, so every write and every element re-query in there repeats with it. Cache the ref where the subtree that owns it is REBUILT, latch a class that changes at most once, or add a documented, counted entry to the module's \`drivers\` list saying what the tick does and why that is cheap enough:\n${sweep.violations.join('\n')}`,
    ).toEqual([]);
  });

  // THE POSITIVE CONTROL for the driver-body sweep. Same reasoning as the bucket sweep's:
  // the real-tree assertions above are all "this list is empty", so the comparator, the
  // family loop, the cadence pin and the dead-cut check are each exercised here over
  // synthetic sources instead.
  it('the driver-body sweep reports each kind of per-tick violation', () => {
    // The shape the gate exists for, and it is the shape lockpick_window actually had: the
    // callback body itself is clean, and the query lives one call away in a method.
    const leaky = `
      export class W {
        private arm(): void {
          this.iv = window.setInterval(() => {
            this.paint();
          }, 100);
        }
        private paint(): void {
          const bar = this.root.querySelector('.bar');
          if (bar) bar.style.width = '50%';
        }
      }`;
    const host = (drivers: DriverCallbackAllowance[]): DriverHost[] => [
      { file: 'leaky_window.ts', drivers },
    ];
    const grant = (over: Partial<DriverCallbackAllowance> = {}): DriverCallbackAllowance => ({
      driver: 'setInterval',
      everyMs: 100,
      why: 'synthetic',
      writeAllow: {},
      queryAllow: {},
      idlAllow: {},
      reflowAllow: {},
      ...over,
    });
    const read = () => leaky;

    // A BODY-ONLY scan would report nothing here, which is exactly why this gate walks the
    // callees: both hits are inside `paint()`, not inside the callback.
    const unbudgeted = sweepDriverBodies(host([grant()]), read);
    expect(unbudgeted.violations).toEqual([
      'leaky_window.ts#0 (setInterval every 100ms, line 4): .style appears 1x on the tick, expected 0',
      'leaky_window.ts#0 (setInterval every 100ms, line 4): .querySelector appears 1x on the tick, expected 0',
    ]);
    expect(unbudgeted.resolved).toBe(1);
    expect(unbudgeted.observed).toBe(2);

    // A granted allowance silences exactly those two and nothing else...
    expect(
      sweepDriverBodies(
        host([grant({ writeAllow: { '.style': 1 }, queryAllow: { '.querySelector': 1 } })]),
        read,
      ).violations,
    ).toEqual([]);

    // ...and the count is EXACT in both directions, so a grant for a query that is later
    // deleted fails until the number comes back down rather than rotting into a free pass.
    expect(
      sweepDriverBodies(
        host([grant({ writeAllow: { '.style': 1 }, queryAllow: { '.querySelector': 2 } })]),
        read,
      ).violations,
    ).toEqual([
      'leaky_window.ts#0 (setInterval every 100ms, line 4): .querySelector appears 1x on the tick, expected 2',
    ]);

    // The declared cadence is pinned against the literal in the source, so re-tuning a clock
    // fails until the entry that documents why the counts are cheap enough says so.
    expect(sweepDriverBodies(host([grant({ everyMs: 1000 })]), read).violations).toContain(
      'leaky_window.ts#0: setInterval is armed every 100ms, the allowance declares 1000ms',
    );
    // ...and so is WHICH driver the site arms.
    expect(
      sweepDriverBodies(host([grant({ driver: 'requestAnimationFrame' })]), read).violations,
    ).toContain(
      'leaky_window.ts#0: the source arms setInterval, the allowance declares requestAnimationFrame',
    );

    // A cut silences the method it names...
    const cut = sweepDriverBodies(host([grant({ stopsAt: { paint: 'synthetic reason' } })]), read);
    expect(cut.violations).toEqual([]);
    expect(cut.cuts).toEqual(['leaky_window.ts: paint']);
    // ...but a cut the callback never reaches is DEAD, and a dead cut is how a stale entry
    // would sit in the table looking like it was doing something.
    expect(
      sweepDriverBodies(host([grant({ stopsAt: { gone: 'synthetic reason' } })]), read).violations,
    ).toContain(
      'leaky_window.ts#0: stopsAt names "gone", which this callback never reaches, so the cut is dead and hides nothing',
    );

    // A declaration that does not match the number of call sites in the source fails before
    // any count is compared, in BOTH directions.
    expect(sweepDriverBodies(host([grant(), grant()]), read).violations).toEqual([
      'leaky_window.ts: 2 driver allowance entr(ies) declared, 1 driver call site(s) in the source',
    ]);
    expect(
      sweepDriverBodies(host([grant()]), () => `${leaky}\nsetInterval(() => {}, 5);`).violations,
    ).toEqual([
      'leaky_window.ts: 1 driver allowance entr(ies) declared, 2 driver call site(s) in the source',
    ]);

    // An IDL write is seen too, which is the half RAW_WRITES cannot name.
    expect(
      sweepDriverBodies(host([grant()]), () => 'setInterval(() => { btn.disabled = true; }, 100);')
        .violations,
    ).toEqual([
      'leaky_window.ts#0 (setInterval every 100ms, line 1): .disabled appears 1x on the tick, expected 0',
    ]);

    // A driver whose callback cannot be resolved REFUSES rather than scanning nothing. That
    // is the standing anti-vacuity rule: a resolver that shrugged would hand this gate an
    // empty, passing scan the day someone hides the callback behind a factory.
    expect(() =>
      sweepDriverBodies(host([grant()]), () => 'setInterval(makeTick(this), 100);'),
    ).toThrow(/does not resolve to a function in this module/);

    // A layout read on a tick is reported too. On the real tree that family counts zero for
    // every granted driver, so nothing else here would notice it going dead.
    expect(
      sweepDriverBodies(
        host([grant()]),
        () => 'setInterval(() => { void el.getBoundingClientRect(); }, 100);',
      ).violations,
    ).toEqual([
      'leaky_window.ts#0 (setInterval every 100ms, line 1): .getBoundingClientRect appears 1x on the tick, expected 0',
    ]);

    // A COMMENT inside the tick is not source. The corpus is stripped before counting, so
    // prose about a `querySelector` the module no longer makes cannot fail the budget, and a
    // banned call cannot be smuggled past a reviewer's eye in a commented-out line either.
    expect(
      sweepDriverBodies(
        host([grant()]),
        () => 'setInterval(() => { /* querySelector */ void 0; }, 100);',
      ).violations,
    ).toEqual([]);

    // ONE GRANT'S CUT MUST NOT SHRINK ITS SIBLING'S CLOSURE. Two call sites in one module,
    // both reaching the same method: entry #0 cuts it, entry #1 does not, so the query inside
    // it must still be reported against entry #1. Resolving once with the UNION of every
    // entry's cuts would silence it, and on the real tree that shortcut is invisible because
    // the 30s poll happens not to reach what the 15s poll cuts.
    const twoDrivers = `
      export class W {
        private arm(): void {
          setInterval(() => this.paint(), 100);
          setInterval(() => this.paint(), 200);
        }
        private paint(): void { void this.root.querySelector('.bar'); }
      }`;
    const siblings = sweepDriverBodies(
      [
        {
          file: 'two_window.ts',
          drivers: [
            grant({ stopsAt: { paint: 'synthetic reason' } }),
            grant({ everyMs: 200, queryAllow: {} }),
          ],
        },
      ],
      () => twoDrivers,
    );
    expect(siblings.violations).toEqual([
      'two_window.ts#1 (setInterval every 200ms, line 5): .querySelector appears 1x on the tick, expected 0',
    ]);
    expect(siblings.cuts).toEqual(['two_window.ts: paint']);

    // The `everyMs: null` arm of the cadence comparator, which no live entry exercises: a
    // driver with no delay argument matches null, and a null against a number reports.
    const rafSource = 'requestAnimationFrame(() => { void el.querySelector("x"); });';
    expect(
      sweepDriverBodies(
        host([
          grant({
            driver: 'requestAnimationFrame',
            everyMs: null,
            queryAllow: { '.querySelector': 1 },
          }),
        ]),
        () => rafSource,
      ).violations,
    ).toEqual([]);
    expect(
      sweepDriverBodies(
        host([
          grant({
            driver: 'requestAnimationFrame',
            everyMs: 16,
            queryAllow: { '.querySelector': 1 },
          }),
        ]),
        () => rafSource,
      ).violations,
    ).toEqual([
      'leaky_window.ts#0: requestAnimationFrame is armed every nullms, the allowance declares 16ms',
    ]);

    // A host with no `drivers` list contributes nothing, which is what makes the real-tree
    // `scanned` pin above load-bearing rather than incidental.
    expect(sweepDriverBodies([{ file: 'quiet_window.ts' }], read).resolved).toBe(0);
  });

  // THE POSITIVE CONTROL for both sweeps above. Everything else about them is an assertion
  // that a list is empty, which a broken comparator satisfies trivially; this drives the same
  // function over synthetic sources and requires it to REPORT.
  it('the bucket sweep actually reports a violation when there is one', () => {
    const clean = 'export function paint(el: HTMLElement): void { el.replaceChildren(); }';
    const dirty =
      'export function paint(el: HTMLElement): void { void el.getBoundingClientRect(); }';
    const files = ['clean_window.ts', 'dirty_window.ts'];
    const read = (f: string) => (f === 'dirty_window.ts' ? dirty : clean);

    const unbudgeted = sweepBucket(files, FORCED_REFLOW_READS, () => ({}), read);
    expect(unbudgeted.violations).toEqual([
      'dirty_window.ts: .getBoundingClientRect appears 1x, expected 0',
    ]);
    expect(unbudgeted.scanned).toEqual(files);
    expect(unbudgeted.observed).toBe(1);

    // A granted allowance silences exactly that file and nothing else...
    const budgeted = sweepBucket(
      files,
      FORCED_REFLOW_READS,
      (f) => (f === 'dirty_window.ts' ? { '.getBoundingClientRect': 1 } : {}),
      read,
    );
    expect(budgeted.violations).toEqual([]);

    // ...and the count is EXACT in both directions, so an allowance for a read that is later
    // deleted fails until the number comes back down, rather than rotting into a free pass.
    const stale = sweepBucket(
      files,
      FORCED_REFLOW_READS,
      () => ({ '.getBoundingClientRect': 1 }),
      read,
    );
    expect(stale.violations).toEqual([
      'clean_window.ts: .getBoundingClientRect appears 0x, expected 1',
    ]);

    // The driver matchers report through the same path.
    const drivers = sweepBucket(
      ['loop_window.ts'],
      FRAME_DRIVERS,
      () => ({}),
      () => 'const id = window.setInterval(tick, 16); requestAnimationFrame(step);',
    );
    expect(drivers.violations).toEqual([
      'loop_window.ts: requestAnimationFrame appears 1x, expected 0',
      'loop_window.ts: setInterval appears 1x, expected 0',
    ]);
  });

  // Both-direction pins on the three lists, so none of them can rot into a blanket opt-out.
  // (The counted allowances need no separate staleness pin: they are matched EXACTLY, so a
  // granted read that is later deleted fails until the number comes back down.)
  it('registers each classified painter once, on disk, in exactly one bucket', () => {
    const problems = registrationProblems(
      new Set(ON_DISK_PAINTERS),
      new Set(COLD_PAINTERS),
      HOT_PAINTERS,
      CANVAS_PAINTERS,
      COLD_PAINTER_ALLOWANCES,
    );
    expect(
      problems,
      `each classified src/ui painter must exist and belong to exactly one bucket:\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  // The positive control for the four predicates above, which all report zero on the real
  // tree, so gutting any one of them keeps the suite green. Synthetic input, one planted
  // violation per predicate.
  it('the registration check reports each kind of bad entry', () => {
    const onDisk = new Set(['a_window.ts', 'b_painter.ts', 'c_painter.ts', 'live_window.ts']);
    const cold = new Set(['a_window.ts', 'live_window.ts']);
    const problems = registrationProblems(
      onDisk,
      cold,
      // A bad allowance key on a SCANNED entry too, so BOTH halves of the key check are
      // driven rather than only the cold one. The scanned entry ALSO grants a driver with no
      // callback allowance behind it, which is the #2518 shape: a cadence granted and the
      // per-tick contract skipped.
      [
        {
          file: 'b_painter.ts',
          allow: { offsetWidth: 1 },
          reflowAllow: {},
          driverAllow: { setInterval: 1 },
        },
        { file: 'gone_painter.ts', allow: {}, reflowAllow: {}, driverAllow: {} },
      ],
      [{ file: 'b_painter.ts', allow: {}, reflowAllow: {}, driverAllow: {} }],
      [
        { file: 'c_painter.ts', reflowAllow: {}, driverAllow: {} },
        {
          file: 'live_window.ts',
          reflowAllow: { notAToken: 1 },
          driverAllow: {},
          // Every predicate on a callback allowance, planted at once: an entry with no driver
          // granted behind it, a driver name that is not a matcher label, an empty reason, a
          // cut with no reason, and a bad allowance key.
          drivers: [
            {
              driver: 'setTimeout',
              everyMs: null,
              why: '  ',
              stopsAt: { render: '' },
              writeAllow: { nope: 1 },
              queryAllow: {},
              idlAllow: {},
              reflowAllow: {},
            },
            // A setInterval grant that declares no cadence, so the counts beside it would be
            // per nothing.
            {
              driver: 'setInterval',
              everyMs: null,
              why: 'synthetic',
              writeAllow: {},
              queryAllow: {},
              idlAllow: {},
              reflowAllow: {},
            },
          ],
        },
      ],
    );
    expect(problems).toEqual([
      'gone_painter.ts (HOT_PAINTERS: not an on-disk src/ui painter)',
      'b_painter.ts (CANVAS_PAINTERS: classified twice)',
      'c_painter.ts (COLD_PAINTER_ALLOWANCES: not a cold painter, so nothing reads it)',
      'b_painter.ts (drivers: 1 contractable driver(s) of 1 granted by driverAllow, 0 callback allowance(s) declared)',
      'live_window.ts (drivers: 0 contractable driver(s) of 0 granted by driverAllow, 2 callback allowance(s) declared)',
      'live_window.ts#0 (drivers: "setTimeout" is not a driver label)',
      'live_window.ts#0 (drivers: the granted cadence says what it is for)',
      'live_window.ts#0 (stopsAt: "render" cuts the walk with no reason)',
      'live_window.ts#1 (drivers: a setInterval grant must declare its cadence; hoist the delay to a literal or a module-level const so it can be pinned)',
      'b_painter.ts (allow: "offsetWidth" is not a matcher label, so nothing reads it)',
      'live_window.ts (reflowAllow: "notAToken" is not a matcher label, so nothing reads it)',
      'live_window.ts#0 (writeAllow: "nope" is not a matcher label, so nothing reads it)',
    ]);
    // ...and it stays silent on a well-formed set, so it is not simply always noisy. The
    // well-formed driver entry keys all THREE new allowance maps with real labels, which is
    // what keeps each of the four label sets load-bearing: point `queryAllow` at the
    // raw-write labels and this arm goes red.
    expect(
      registrationProblems(
        onDisk,
        cold,
        [{ file: 'b_painter.ts', allow: { '.style': 1 }, reflowAllow: {}, driverAllow: {} }],
        [{ file: 'c_painter.ts', allow: {}, reflowAllow: {}, driverAllow: {} }],
        [
          {
            file: 'a_window.ts',
            reflowAllow: { '.scrollTop': 2 },
            driverAllow: { setInterval: 1 },
            drivers: [
              {
                driver: 'setInterval',
                everyMs: 1000,
                why: 'synthetic',
                stopsAt: { render: 'synthetic' },
                writeAllow: { '.style': 1 },
                queryAllow: { '.querySelector': 1 },
                idlAllow: { '.disabled': 1 },
                reflowAllow: { '.scrollTop': 1 },
              },
            ],
          },
        ],
      ),
    ).toEqual([]);
  });
});

// Takes every bucket as a PARAMETER, module constants included, so the positive control drives
// the same code the real run does. Resolving the scanned allowances from the module constants
// instead would leave the hot/canvas half of the key check unproven: a synthetic entry would
// miss the lookup and contribute nothing, which is the same shape as the hole the extraction
// closed, one branch over.
function registrationProblems(
  onDisk: ReadonlySet<string>,
  cold: ReadonlySet<string>,
  hot: ReadonlyArray<ScannedPainter>,
  canvas: ReadonlyArray<ScannedPainter>,
  coldAllowances: ReadonlyArray<ColdPainter>,
): string[] {
  const problems: string[] = [];
  {
    const seen = new Set<string>();
    for (const [name, files] of [
      ['HOT_PAINTERS', hot.map((p) => p.file)],
      ['CANVAS_PAINTERS', canvas.map((p) => p.file)],
      ['COLD_PAINTER_ALLOWANCES', coldAllowances.map((c) => c.file)],
    ] as const) {
      for (const file of files) {
        if (!onDisk.has(file)) problems.push(`${file} (${name}: not an on-disk src/ui painter)`);
        if (seen.has(file)) problems.push(`${file} (${name}: classified twice)`);
        seen.add(file);
      }
    }
    // A cold allowance for a file that is not cold would be an allowance for nothing: the
    // scanned buckets never consult driverAllow, so the entry would silently do nothing.
    for (const { file } of coldAllowances) {
      if (onDisk.has(file) && !cold.has(file)) {
        problems.push(`${file} (COLD_PAINTER_ALLOWANCES: not a cold painter, so nothing reads it)`);
      }
    }
    // Every allowance KEY must be a real matcher label. The maps are keyed by `string`, so a
    // typo (`offsetWidth` without the leading dot, `getComputedStyle(` with the paren) type-
    // checks, is looked up, misses, and silently degrades that token back to an expected 0.
    // Today that fails loudly only by luck, because the real count then mismatches; a typo on
    // a token the file happens not to use would be invisible.
    // #2518: a granted driver must ALSO declare what its callback does, one entry per call
    // site. Without this the new scan would be opt-in: `driverAllow: { setInterval: 1 }` with
    // no `drivers` list would grant the cadence and skip the per-tick contract entirely,
    // which is precisely the permission-slip-with-no-contract shape the issue is about. The
    // count is exact in both directions, so a deleted entry and a leftover one both fail.
    const driverHosts: ReadonlyArray<DriverHost & { driverAllow?: TokenAllowance }> = [
      ...hot,
      ...canvas,
      ...coldAllowances,
    ];
    const driverLabels = new Set(FRAME_DRIVERS.map(([label]) => label));
    for (const host of driverHosts) {
      const granted = Object.values(host.driverAllow ?? {}).reduce<number>(
        (total, n) => total + (n ?? 0),
        0,
      );
      const declaredCallbacks = host.drivers?.length ?? 0;
      // A name-only exception grants names it never calls, so those need no
      // per-tick callback contract: only the resolvable call sites do.
      const nameOnly = driverNameOnlyByFile.get(host.file);
      const contractable = granted - (nameOnly ? nameOnly.names - nameOnly.repeating : 0);
      if (contractable !== declaredCallbacks) {
        problems.push(
          `${host.file} (drivers: ${contractable} contractable driver(s) of ${granted} granted by driverAllow, ${declaredCallbacks} callback allowance(s) declared)`,
        );
      }
      for (const [index, grant] of (host.drivers ?? []).entries()) {
        if (!driverLabels.has(grant.driver)) {
          problems.push(`${host.file}#${index} (drivers: "${grant.driver}" is not a driver label)`);
        }
        if (!grant.why.trim()) {
          problems.push(`${host.file}#${index} (drivers: the granted cadence says what it is for)`);
        }
        // A `setInterval` grant must name a cadence, because the counts beside it are per tick
        // and a `null` would make them per nothing. `delayOf` resolves a literal OR a
        // module-level const, so the honest way to reach null here is a delay computed at run
        // time; that is the point at which a reviewer should be asked, not waved through.
        // requestAnimationFrame / requestIdleCallback take no delay and are legitimately null.
        if (grant.driver === 'setInterval' && grant.everyMs === null) {
          problems.push(
            `${host.file}#${index} (drivers: a setInterval grant must declare its cadence; hoist the delay to a literal or a module-level const so it can be pinned)`,
          );
        }
        for (const [name, reason] of Object.entries(grant.stopsAt ?? {})) {
          if (!reason.trim()) {
            problems.push(
              `${host.file}#${index} (stopsAt: "${name}" cuts the walk with no reason)`,
            );
          }
        }
      }
    }
    const known = {
      allow: new Set(RAW_WRITES.map(([label]) => label)),
      reflowAllow: new Set(FORCED_REFLOW_READS.map(([label]) => label)),
      driverAllow: new Set(FRAME_DRIVERS.map(([label]) => label)),
      writeAllow: new Set(RAW_WRITES.map(([label]) => label)),
      queryAllow: new Set(ELEMENT_QUERIES.map(([label]) => label)),
      idlAllow: new Set(IDL_WRITES.map(([label]) => label)),
    };
    const declared: ReadonlyArray<readonly [string, string, TokenAllowance]> = [
      ...[...hot, ...canvas].flatMap((p) => [
        ['allow', p.file, p.allow] as const,
        ['reflowAllow', p.file, p.reflowAllow] as const,
        ['driverAllow', p.file, p.driverAllow ?? {}] as const,
      ]),
      ...coldAllowances.flatMap((c) => [
        ['reflowAllow', c.file, c.reflowAllow] as const,
        ['driverAllow', c.file, c.driverAllow] as const,
      ]),
      ...driverHosts.flatMap((host) =>
        (host.drivers ?? []).flatMap((grant, index) => [
          ['writeAllow', `${host.file}#${index}`, grant.writeAllow] as const,
          ['queryAllow', `${host.file}#${index}`, grant.queryAllow] as const,
          ['idlAllow', `${host.file}#${index}`, grant.idlAllow] as const,
          ['reflowAllow', `${host.file}#${index}`, grant.reflowAllow] as const,
        ]),
      ),
    ];
    for (const [kind, file, allowance] of declared) {
      const labels = known[kind as keyof typeof known];
      for (const key of Object.keys(allowance)) {
        if (!labels.has(key)) {
          problems.push(`${file} (${kind}: "${key}" is not a matcher label, so nothing reads it)`);
        }
      }
    }
    return problems;
  }
}

describe('hud_perf_budget ARM 1 (cont.): the matchers themselves', () => {
  // Teeth for the matchers this gate is built on. Every list is pinned BY IDENTITY as well
  // as by behavior, because a label-only pin lets an arm be swapped for a dead regex with
  // the whole suite green, and this gate shipped exactly that bug: `.getComputedStyle`
  // matched nothing in src/ for as long as the arm existed.
  it('the painter-gate matchers keep their teeth', () => {
    expect(PAINTER_FILE_RE.test('vendor_window.ts')).toBe(true);
    expect(PAINTER_FILE_RE.test('xp_bar_painter.ts')).toBe(true);
    expect(PAINTER_FILE_RE.test('unit_frame.ts')).toBe(false);
    expect(PAINTER_FILE_RE.test('options_view.ts')).toBe(false);
    expect(PAINTER_FILE_RE.test('map_window_painter.ts')).toBe(true);
    expect(PAINTER_FILE_RE.test('chat_geometry_controller.ts')).toBe(true);
    expect(PAINTER_FILE_RE.test('loot_roll_control.ts')).toBe(false);

    const reflow = new Map(FORCED_REFLOW_READS);
    const gcs = reflow.get('getComputedStyle');
    expect(gcs, 'the getComputedStyle arm must exist').toBeDefined();
    if (!gcs) return;
    // The BARE form is the one this tree actually writes and the one the retired
    // `.getComputedStyle` token could not see; the member form must still count.
    expect(countMatches('const cs = getComputedStyle(document.documentElement);', gcs)).toBe(1);
    expect(countMatches('window.getComputedStyle(el).display', gcs)).toBe(1);
    expect(countMatches('getComputedStyle (el)', gcs)).toBe(1);
    // ...but an unrelated identifier that merely ends in the same word must not.
    expect(countMatches('cachedGetComputedStyle(el)', gcs)).toBe(0);
    expect(countMatches('const getComputedStyleCache = new Map();', gcs)).toBe(0);
    // NON-VACUITY against the live tree, which is what a source-shape pin alone would miss:
    // minimap_painter's token resolve is a real bare call, so a re-narrowed arm counts 0
    // here and fails instead of passing quietly.
    expect(countMatches(painterSource('minimap_painter.ts'), gcs)).toBe(1);
    const rect = reflow.get('.getBoundingClientRect');
    expect(rect && countMatches('el.getBoundingClientRect().top', rect)).toBe(1);
    expect(rect && countMatches('const getBoundingClientRect = 1;', rect)).toBe(0);

    // Every driver arm in BOTH the bare and the member form, because the comment above
    // claims both count and the live tree only ever uses one of them per arm. The two
    // negatives are the calls that TEAR DOWN a driver, which must never be mistaken for one.
    // Every FORCED_REFLOW arm too. Nine of the sixteen match nothing anywhere in the tree, so
    // the counts cannot notice a dead one either; two of those nine (.offsetParent,
    // .innerText) were added with no live use at all, which is precisely when an arm authored
    // wrong on day one would be pinned faithfully and stay dead forever.
    const reads = new Map(FORCED_REFLOW_READS);
    const reflowFixtures: ReadonlyArray<readonly [string, string, string]> = [
      ['.offsetWidth', 'const w = el.offsetWidth;', 'const w = el.offsetWidthCache;'],
      ['.offsetHeight', 'const h = el.offsetHeight;', 'const h = box.offsetHeightOf;'],
      ['.offsetTop', 'const t = el.offsetTop;', 'const t = box.offsetTopping;'],
      ['.offsetLeft', 'const l = el.offsetLeft;', 'const l = box.offsetLeftish;'],
      ['.offsetParent', 'const p = el.offsetParent;', 'const p = el.offsetParentNode;'],
      ['.clientWidth', 'const w = el.clientWidth;', 'const w = el.clientWidths;'],
      ['.clientHeight', 'const h = el.clientHeight;', 'const h = el.clientHeights;'],
      ['.scrollWidth', 'const w = el.scrollWidth;', 'const w = el.scrollWidthOf;'],
      ['.scrollHeight', 'const h = el.scrollHeight;', 'const h = el.scrollHeightOf;'],
      ['.scrollTop', 'const t = el.scrollTop;', 'const t = el.scrollTopMost;'],
      ['.scrollLeft', 'const l = el.scrollLeft;', 'const l = el.scrollLeftMost;'],
      ['.innerText', 'const s = el.innerText;', 'const s = el.innerTextOf;'],
      ['.getBoundingClientRect', 'el.getBoundingClientRect().top', 'el.getBoundingClientRects()'],
      ['.getClientRects', 'el.getClientRects()[0]', 'el.getClientRectsOf()'],
      ['getComputedStyle', 'getComputedStyle(root).width', 'cachedGetComputedStyle(root)'],
      ['getUiScale', 'const s = getUiScale();', 'const s = getUiScaleFactor;'],
    ];
    for (const [label, positive, negative] of reflowFixtures) {
      const re = reads.get(label);
      expect(re, `the ${label} arm must exist`).toBeDefined();
      if (!re) continue;
      expect(countMatches(positive, re), `${label} must count: ${positive}`).toBe(1);
      expect(countMatches(negative, re), `${label} must not count: ${negative}`).toBe(0);
    }

    const drivers = new Map(FRAME_DRIVERS);
    const driverFixtures: ReadonlyArray<readonly [string, string, string, string]> = [
      [
        'requestAnimationFrame',
        'requestAnimationFrame(step);',
        'window.requestAnimationFrame(step);',
        'cancelAnimationFrame(handle);',
      ],
      [
        'requestIdleCallback',
        'requestIdleCallback(slice);',
        'window.requestIdleCallback(slice);',
        'cancelIdleCallback(handle);',
      ],
      [
        'setInterval',
        'const id = setInterval(tick, 100);',
        'this.poll = window.setInterval(fn, 15_000);',
        'clearInterval(this.poll);',
      ],
    ];
    for (const [label, bare, member, negative] of driverFixtures) {
      const re = drivers.get(label);
      expect(re, `the ${label} arm must exist`).toBeDefined();
      if (!re) continue;
      expect(countMatches(bare, re), `${label} bare: ${bare}`).toBe(1);
      expect(countMatches(member, re), `${label} member: ${member}`).toBe(1);
      expect(countMatches(negative, re), `${label} teardown: ${negative}`).toBe(0);
    }
    // The proxy token counts the CALL, not a definition or an import of the same name.
    // The proxy token counts every REFERENCE, deliberately: an aliased call
    // (`const f = getUiScale; f()`) is the same layout read as a direct one, and no
    // call-shaped matcher can see it. The import line counting too is the price, one per
    // importing file, paid in the allowance rather than in coverage.
    const uiScale = new Map(FORCED_REFLOW_READS).get('getUiScale');
    expect(uiScale, 'the getUiScale proxy arm must exist').toBeDefined();
    expect(uiScale && countMatches('const s = getUiScale();', uiScale)).toBe(1);
    expect(uiScale && countMatches('const f = getUiScale;', uiScale)).toBe(1);
    expect(uiScale && countMatches('import { getUiScale } from "./ui_scale";', uiScale)).toBe(1);
    expect(uiScale && countMatches('const cachedGetUiScale = memo(f);', uiScale)).toBe(0);
    expect(uiScale && countMatches('const getUiScaleFactor = 2;', uiScale)).toBe(0);

    // The canvas identity proof: true of a real canvas painter, false of a real DOM module.
    // Each arm is fetched BY LABEL from the table the assertion loop reads, and checked
    // against the fixture only THAT arm may accept. Both arms are canvas matchers and both
    // read right at a glance, so pointing the draw assertion at the type regex would halve
    // the proof with everything green; here it flips two cases.
    const identity = new Map(CANVAS_IDENTITY.map(([what, re]) => [what, re]));
    const names = identity.get('names a 2D context type');
    const draws = identity.get('draws on a 2D context');
    expect(names && names.test(CANVAS_TYPE_ONLY)).toBe(true);
    expect(draws && draws.test(CANVAS_TYPE_ONLY)).toBe(false);
    expect(names && names.test(CANVAS_DRAW_ONLY)).toBe(false);
    expect(draws && draws.test(CANVAS_DRAW_ONLY)).toBe(true);
    expect(CANVAS_CONTEXT_RE.test('const ctx = new AudioContext();')).toBe(false);
    expect(CANVAS_DRAW_RE.test('ctx.fillText(label, 0, 0);')).toBe(true);
    // `.fill(` and `.stroke(` are deliberately OUT of the vocabulary: they collide with
    // Array.prototype.fill and with ordinary field names, both of which are live in this tree
    // (`this.fill` in xp_bar_painter, `mine.fill` in yumi_match_painter, `els.fill` in
    // deed_tracker_painter). Every arm is a CALL, so a property read of the same name is not a
    // draw either.
    expect(CANVAS_DRAW_RE.test('rows.fill(0);')).toBe(false);
    expect(CANVAS_DRAW_RE.test('this.bar.stroke();')).toBe(false);
    expect(CANVAS_DRAW_RE.test('const p = marker.moveTo;')).toBe(false);
    // The vocabulary itself is pinned, not just sampled. Fixtures alone would let it be
    // trimmed to a couple of arms and still pass, since a canvas painter that draws at all
    // usually draws several ways; only perf_graph_painter, which has neither fillText nor
    // drawImage, would notice, and one file is too thin a thread to hang the proof on.
    // Pinned as OBJECTS, not by .source: these two are consumed with `re.test(code)` in a loop
    // over five files, so a stray /g flag would make every other call return false from a
    // leftover lastIndex. That direction fails loudly rather than passing quietly, but a pin
    // that cannot see flags is not pinning the thing that decides behavior.
    expect(CANVAS_DRAW_RE).toEqual(
      /\.(?:beginPath|closePath|moveTo|lineTo|arcTo|ellipse|quadraticCurveTo|bezierCurveTo|fillRect|strokeRect|clearRect|fillText|strokeText|drawImage|createLinearGradient|createRadialGradient|createPattern|putImageData|getImageData|createImageData|measureText|setLineDash|roundRect)\s*\(/,
    );
    expect(CANVAS_DRAW_RE.flags, 'a /g flag here would make re.test() stateful').toBe('');
    expect(CANVAS_CONTEXT_RE).toEqual(/\b(?:Offscreen)?CanvasRenderingContext2D\b/);
    expect(CANVAS_CONTEXT_RE.flags).toBe('');
    // bags_window is the control on purpose, since it is exactly the shape of module that
    // would be parked in CANVAS_PAINTERS to escape both gates.
    const control = painterSource('bags_window.ts');
    expect(CANVAS_CONTEXT_RE.test(control)).toBe(false);
    expect(CANVAS_DRAW_RE.test(control)).toBe(false);

    // Every raw-write arm, exercised against source it must count and source it must not.
    // Four of these (.style, .textContent, .classList, .setProperty) match ZERO times across
    // every scanned painter, which is the whole point of the bucket, and also means the
    // per-file scans cannot notice if one of them goes dead: expected 0, actual 0, green.
    // Nothing but a fixture covers them.
    const writes = new Map(RAW_WRITES);
    const writeFixtures: ReadonlyArray<readonly [string, string, string]> = [
      ['.style', 'el.style.display = "none";', 'const styles = theme.styleSheet;'],
      ['.textContent', 'row.textContent = name;', 'const t = node.textContentCache;'],
      ['.classList', "btn.classList.toggle('on', x);", 'const c = el.classListName;'],
      ['.className', "wrap.className = 'row';", 'const n = el.classNames;'],
      ['.setAttribute', "el.setAttribute('aria-label', s);", 'el.setAttributeIfChanged(a, b);'],
      ['.removeAttribute', "el.removeAttribute('hidden');", 'el.removeAttributeNode(a);'],
      ['.setProperty', "el.style.setProperty('--x', v);", 'bag.setPropertyBag(x);'],
      ['.innerHTML', "el.innerHTML = '';", 'const h = el.innerHTMLCache;'],
      ['.dataset', 'canvas.dataset.portrait = url;', 'const d = row.datasetKey;'],
      ['.outerHTML', "el.outerHTML = '<b></b>';", 'const s = node.outerHTMLCache;'],
      ['.insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', h);", 'el.insertAdjacent(h);'],
      ['.insertAdjacentText', "el.insertAdjacentText('beforeend', t);", 'el.insertAdjacent(t);'],
      ['.cssText', "el.style.cssText = 'width:1px';", 'const c = sheet.cssTextOf;'],
      ['.toggleAttribute', "el.toggleAttribute('hidden', on);", 'el.toggleAttributeShim(a);'],
      ['.setAttributeNS', "el.setAttributeNS(ns, 'x', v);", 'el.setAttributeNSShim(a);'],
      ["['computed']", "el['textContent'] = name;", 'const k = map["textContentish"];'],
      // The computed alternation must cover EVERY dot arm above, not most of them: two were
      // missing and both counted zero, which is the same shape of hole as a dead arm.
      ["['computed']", "el['setAttributeNS'](ns, 'x', v);", "el['setAttributeNSish']();"],
      ["['computed']", "el['insertAdjacentText']('beforeend', t);", "el['insertAdjacent']();"],
    ];
    for (const [label, positive, negative] of writeFixtures) {
      const re = writes.get(label);
      expect(re, `the ${label} arm must exist`).toBeDefined();
      if (!re) continue;
      expect(countMatches(positive, re), `${label} must count: ${positive}`).toBe(1);
      expect(countMatches(negative, re), `${label} must not count: ${negative}`).toBe(0);
    }

    // The two families #2518 added, both scanned ONLY inside a driver callback, so on the
    // real tree every arm but two counts zero and the counts can notice nothing. Fixtures
    // are the whole cover here, and the negatives are the point of each arm: the query arms
    // must not fire on a longer identifier, and `.closest` must not fire on the bare word,
    // which is why it is the one query arm matched as a MEMBER only.
    const queries = new Map(ELEMENT_QUERIES);
    const queryFixtures: ReadonlyArray<readonly [string, string, string]> = [
      ['.querySelector', "root.querySelector('.bar')", 'el.querySelectorish(x)'],
      ['.querySelectorAll', "root.querySelectorAll('[data-x]')", 'el.querySelectorAllish(x)'],
      ['.getElementById', "document.getElementById('lockpick-panel')", 'doc.getElementByIdish(x)'],
      ['.getElementsByClassName', "root.getElementsByClassName('lp')", 'el.getElementsByClass(x)'],
      ['.getElementsByTagName', "root.getElementsByTagName('li')", 'el.getElementsByTag(x)'],
      [
        '.getElementsByTagNameNS',
        "root.getElementsByTagNameNS(ns, 'g')",
        'el.getElementsByTagNS(x)',
      ],
      ['.getElementsByName', "document.getElementsByName('q')", 'doc.getElementsByNamed(x)'],
      ['.closest', "target.closest('.window.panel')", 'const closest = nearestTarget(p);'],
      ["['computed' query]", "el['querySelector']('.bar')", "el['querySelectorish']()"],
    ];
    for (const [label, positive, negative] of queryFixtures) {
      const re = queries.get(label);
      expect(re, `the ${label} arm must exist`).toBeDefined();
      if (!re) continue;
      expect(countMatches(positive, re), `${label} must count: ${positive}`).toBe(1);
      expect(countMatches(negative, re), `${label} must not count: ${negative}`).toBe(0);
    }
    // `.querySelector` must not double-count a `querySelectorAll`, since the two arms are
    // budgeted separately and one swallowing the other would make both numbers fiction.
    const qs = queries.get('.querySelector');
    expect(qs && countMatches("root.querySelectorAll('[data-x]')", qs)).toBe(0);
    // The computed arm must cover EVERY dot arm above, the hole the raw-write computed arm
    // shipped with twice.
    const computedQuery = queries.get("['computed' query]");
    for (const [label] of queryFixtures.filter(([l]) => l !== "['computed' query]")) {
      const member = label.slice(1);
      expect(
        computedQuery && countMatches(`el['${member}']()`, computedQuery),
        `the computed query arm must cover ${label}`,
      ).toBe(1);
    }
    // NON-VACUITY against the live tree for the arm that motivated the family: the
    // pre-#2498 lockpick clock re-queried its refs three times per tick, and
    // daily_rewards' countdown poll still walks the subtree once per tick today. If the
    // querySelectorAll arm were re-narrowed it would count 0 here and pass quietly.
    const qsa = queries.get('.querySelectorAll');
    expect(qsa && countMatches(painterSource('daily_rewards_window.ts'), qsa)).toBeGreaterThan(0);

    const idl = new Map(IDL_WRITES);
    const idlFixtures: ReadonlyArray<readonly [string, string, string]> = [
      ['.disabled', 'btn.disabled = true;', 'const d = row.disabledAt;'],
      ['.hidden', 'el.hidden = !visible;', 'const h = view.hiddenRows;'],
      ['.checked', 'input.checked = on;', 'const c = opt.checkedAt;'],
      ['.selected', 'opt.selected = true;', 'const s = view.selectedIndex;'],
      ['.readOnly', 'input.readOnly = true;', 'const r = opts.readOnlyish;'],
      ['.indeterminate', 'box.indeterminate = true;', 'const i = x.indeterminateish;'],
      ['.srcset', 'img.srcset = urls;', 'const s = img.srcsetOf;'],
      ['.ariaLabel', 'btn.ariaLabel = label;', 'const a = row.ariaLabelKey;'],
      ['.tabIndex', 'el.tabIndex = -1;', 'const t = row.tabIndexOf;'],
      ["['computed' idl]", "btn['disabled'] = true;", "btn['disabledAt'] = 1;"],
    ];
    for (const [label, positive, negative] of idlFixtures) {
      const re = idl.get(label);
      expect(re, `the ${label} arm must exist`).toBeDefined();
      if (!re) continue;
      expect(countMatches(positive, re), `${label} must count: ${positive}`).toBe(1);
      expect(countMatches(negative, re), `${label} must not count: ${negative}`).toBe(0);
    }
    const computedIdl = idl.get("['computed' idl]");
    for (const [label] of idlFixtures.filter(([l]) => l !== "['computed' idl]")) {
      expect(
        computedIdl && countMatches(`el['${label.slice(1)}'] = x;`, computedIdl),
        `the computed idl arm must cover ${label}`,
      ).toBe(1);
    }
    // The two properties DELIBERATELY out of IDL_WRITES, pinned as absent rather than left
    // to a reader to notice. Both collide with ordinary field names in this very tree
    // (`els.value` is the lockpick countdown node), so an allowance counting them would
    // document a fiction. If a future case needs them, this is the assertion to argue with.
    for (const excluded of ['.value', '.src', '.title', '.alt', '.placeholder']) {
      expect(labelsOf(IDL_WRITES), `${excluded} is excluded by decision`).not.toContain(excluded);
    }
    // `.matches` is out of the query family for the same reason, and worse: `matchMedia().matches`
    // and a regex `.matches` are both live here.
    expect(labelsOf(ELEMENT_QUERIES)).not.toContain('.matches');

    // COVERAGE OF THE FIXTURE TABLES THEMSELVES, which is the hole all three loops share:
    // each walks the FIXTURE list and looks the regex up by label, so an arm added to a family
    // without a fixture is never visited and nothing says so. The identity pins below would
    // still faithfully pin an arm that was authored wrong on day one and matched nothing ever.
    // Pinning fixture labels against matcher labels is what makes "every arm is exercised"
    // true rather than aspirational.
    expect(writeFixtures.map(([label]) => label).filter((l) => l !== "['computed']")).toEqual(
      labelsOf(RAW_WRITES).filter((l) => l !== "['computed']"),
    );
    expect(new Set(writeFixtures.map(([label]) => label))).toEqual(new Set(labelsOf(RAW_WRITES)));
    expect(reflowFixtures.map(([label]) => label)).toEqual(labelsOf(FORCED_REFLOW_READS));
    expect(driverFixtures.map(([label]) => label)).toEqual(labelsOf(FRAME_DRIVERS));
    expect(queryFixtures.map(([label]) => label)).toEqual(labelsOf(ELEMENT_QUERIES));
    expect(idlFixtures.map(([label]) => label)).toEqual(labelsOf(IDL_WRITES));

    // Identity pins. Each arm is wired in by the regex OBJECT, not by its label, so a
    // weakened or dead arm cannot be swapped in behind a label that still reads right. The
    // raw-write pin used to be label-only, which left exactly the four zero-count arms above
    // free to be replaced by dead regexes with the whole suite green: the same bug class this
    // file exists to catch, shipped inside the catcher.
    expect(RAW_WRITES).toEqual([
      ['.style', /\.style\b/g],
      ['.textContent', /\.textContent\b/g],
      ['.classList', /\.classList\b/g],
      ['.className', /\.className\b/g],
      ['.setAttribute', /\.setAttribute\b/g],
      ['.removeAttribute', /\.removeAttribute\b/g],
      ['.setProperty', /\.setProperty\b/g],
      ['.innerHTML', /\.innerHTML\b/g],
      ['.dataset', /\.dataset\b/g],
      ['.outerHTML', /\.outerHTML\b/g],
      ['.insertAdjacentHTML', /\.insertAdjacentHTML\b/g],
      ['.insertAdjacentText', /\.insertAdjacentText\b/g],
      ['.cssText', /\.cssText\b/g],
      ['.toggleAttribute', /\.toggleAttribute\b/g],
      ['.setAttributeNS', /\.setAttributeNS\b/g],
      [
        "['computed']",
        /\[\s*['"](?:style|textContent|classList|className|setAttribute|removeAttribute|setProperty|innerHTML|dataset|outerHTML|insertAdjacentHTML|insertAdjacentText|cssText|toggleAttribute|setAttributeNS)['"]\s*\]/g,
      ],
    ]);
    expect(FORCED_REFLOW_READS).toEqual([
      ['.offsetWidth', /\.offsetWidth\b/g],
      ['.offsetHeight', /\.offsetHeight\b/g],
      ['.offsetTop', /\.offsetTop\b/g],
      ['.offsetLeft', /\.offsetLeft\b/g],
      ['.offsetParent', /\.offsetParent\b/g],
      ['.clientWidth', /\.clientWidth\b/g],
      ['.clientHeight', /\.clientHeight\b/g],
      ['.scrollWidth', /\.scrollWidth\b/g],
      ['.scrollHeight', /\.scrollHeight\b/g],
      ['.scrollTop', /\.scrollTop\b/g],
      ['.scrollLeft', /\.scrollLeft\b/g],
      ['.innerText', /\.innerText\b/g],
      ['.getBoundingClientRect', /\.getBoundingClientRect\b/g],
      ['.getClientRects', /\.getClientRects\b/g],
      ['getComputedStyle', /(?<![\w$])getComputedStyle\b/g],
      ['getUiScale', /(?<![\w$])getUiScale\b/g],
    ]);
    expect(FRAME_DRIVERS).toEqual([
      ['requestAnimationFrame', /(?<![\w$])requestAnimationFrame\b/g],
      ['requestIdleCallback', /(?<![\w$])requestIdleCallback\b/g],
      ['setInterval', /(?<![\w$])setInterval\b/g],
    ]);
    // The two #2518 families take the same identity pin, and they need it MORE than the
    // others: they are scanned over driver callbacks only, so all but two of their arms
    // count zero on the real tree and a dead arm swapped in behind a label that still reads
    // right would be invisible to every count in the file.
    expect(ELEMENT_QUERIES).toEqual([
      ['.querySelector', /\.querySelector\b/g],
      ['.querySelectorAll', /\.querySelectorAll\b/g],
      ['.getElementById', /\.getElementById\b/g],
      ['.getElementsByClassName', /\.getElementsByClassName\b/g],
      ['.getElementsByTagName', /\.getElementsByTagName\b/g],
      ['.getElementsByTagNameNS', /\.getElementsByTagNameNS\b/g],
      ['.getElementsByName', /\.getElementsByName\b/g],
      ['.closest', /\.closest\b/g],
      [
        "['computed' query]",
        /\[\s*['"](?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName|getElementsByTagNameNS|getElementsByName|closest)['"]\s*\]/g,
      ],
    ]);
    expect(IDL_WRITES).toEqual([
      ['.disabled', /\.disabled\b/g],
      ['.hidden', /\.hidden\b/g],
      ['.checked', /\.checked\b/g],
      ['.selected', /\.selected\b/g],
      ['.readOnly', /\.readOnly\b/g],
      ['.indeterminate', /\.indeterminate\b/g],
      ['.srcset', /\.srcset\b/g],
      ['.ariaLabel', /\.ariaLabel\b/g],
      ['.tabIndex', /\.tabIndex\b/g],
      [
        "['computed' idl]",
        /\[\s*['"](?:disabled|hidden|checked|selected|readOnly|indeterminate|srcset|ariaLabel|tabIndex)['"]\s*\]/g,
      ],
    ]);
  });
});

// --------------------------------------------------------------------------
// ARM 2 - fake-DOM runtime: skip-rate budget + allocation budget.
// --------------------------------------------------------------------------

// A fake element supporting exactly the write surface makeWriterFacet.apply() touches.
// It is only a Map key for the elision cache + a no-throw write sink; the facet never
// READS it back (the cache stores the value it last wrote), so nothing is recorded.
function fakeEl(): HTMLElement {
  return {
    textContent: '',
    style: {
      display: '',
      width: '',
      transform: '',
      setProperty(): void {},
    },
    classList: {
      toggle(): void {},
    },
    setAttribute(): void {},
  } as unknown as HTMLElement;
}

// One real write-elision facet over fresh caches + a single write/skip counter pair, so
// every painter driven through it shares ONE aggregate skip-rate (exactly how the Hud
// builds its facet over its own caches/counters).
function countingFacet(): { facet: PainterHostWriters; counts: { writes: number; skips: number } } {
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { facet, counts };
}

type WorldShape = 'sim' | 'clientworld';

interface PainterHarness {
  name: string;
  drive: () => void;
}

// Build each non-pooled per-frame painter once, with fresh fake elements, plus a drive()
// closure that paints a STEADY view. `shape` selects the offline-only / online-zeroed
// fields: the values are byte-identical across drives within a shape, so a
// correctly-eliding painter writes only on the first drive.
function buildHarnesses(shape: WorldShape, facet: PainterHostWriters): PainterHarness[] {
  const harnesses: PainterHarness[] = [];

  // xp_bar: setWidth + setStyleProp (--xp-fill on bar + frame, rested geometry) + setText + toggleClass.
  {
    const bar = fakeEl();
    const fill = fakeEl();
    const rested = fakeEl();
    const label = fakeEl();
    const playerFrame = fakeEl();
    const painter = new XpBarPainter(facet, bar, fill, rested, label, playerFrame);
    const view: XpBarView = { fillFrac: 0.5, restedFrac: 0.1, label: 'XP 1 / 2', postCap: false };
    harnesses.push({ name: 'xp_bar', drive: () => painter.paint(view) });
  }

  // swing_timer: setDisplay + setWidth + toggleClass + setText.
  {
    const painter = new SwingTimerPainter(facet, fakeEl(), fakeEl(), fakeEl());
    const state: SwingTimerState = {
      visible: true,
      frac: 0.5,
      ready: false,
      labelKind: 'seconds',
      seconds: 1.4,
      nextPeriod: 2,
      nextTimer: 1,
    };
    harnesses.push({ name: 'swing_timer', drive: () => painter.paint(state) });
  }

  // cast_bar: setDisplay + toggleClass + setWidth + setText x2 + setAttr (aria-valuenow).
  {
    const els: CastBarElements = {
      bar: fakeEl(),
      fill: fakeEl(),
      label: fakeEl(),
      timer: fakeEl(),
    };
    const opts: CastBarOptions = { resolveCastLabel: (s) => s.label };
    const painter = new CastBarPainter(facet, els, opts);
    const cast: CastBarState = {
      visible: true,
      channel: false,
      fill: 0.8,
      label: 'fireball',
      fishing: false,
    };
    const input: CastBarPaintInput = { cast, castRemaining: 0.5 };
    harnesses.push({ name: 'cast_bar', drive: () => painter.paint(input) });
  }

  // unit_frame: setText + setTransform (hp, absorb, resource) + toggleClass (overshield,
  // resource type). The absorb shield is offline-only - present in the Sim
  // shape, zeroed in the ClientWorld mirror - so the painter sees both shapes.
  {
    const els: UnitFrameElements = {
      frame: fakeEl(),
      level: fakeEl(),
      hpFill: fakeEl(),
      hpText: fakeEl(),
      absorb: fakeEl(),
      resource: { container: fakeEl(), fill: fakeEl(), text: fakeEl() },
    };
    const painter = new UnitFramePainter(facet, els);
    const absorb =
      shape === 'sim'
        ? { hp: 300, maxHp: 600, auras: [{ kind: 'absorb', value: 100 } as unknown as Aura] }
        : { hp: 300, maxHp: 600, auras: [] as Aura[] };
    const desc: UnitFrameDescriptor = {
      present: true,
      hpFrac: 0.5,
      hpText: '300 / 600',
      resourceKind: 'mana',
      resFrac: 0.8,
      resText: '80 / 100',
      levelText: '60',
      name: 'Aerwynn',
      portraitKey: 'player',
      absorb,
      dead: false,
      outOfRange: false,
    };
    harnesses.push({ name: 'unit_frame', drive: () => painter.paint(unitFrameView(desc)) });
  }

  // action_bar: container many-spells toggle + per-slot writers + setAttr (aria-label).
  {
    const slot: ActionBarSlotElements = {
      btn: fakeEl(),
      label: fakeEl(),
      countEl: fakeEl(),
      keybindEl: fakeEl(),
      cdOverlay: fakeEl(),
      cdText: fakeEl(),
      rechargeOverlay: fakeEl(),
    };
    const descriptor: ActionBarPaintDescriptor = { container: fakeEl(), slots: [slot] };
    const painter = new ActionBarPainter(facet, descriptor, (key) => `URL(${key})`);
    const state: ActionBarState = {
      manySpells: false,
      slots: [
        {
          kind: 'ability',
          abilityId: 'x',
          itemId: null,
          iconKey: 'ability:x',
          cooldownRemaining: 0,
          cooldownTotal: 0,
          cooldownPercent: 0,
          cdText: '',
          count: '',
          isCharges: false,
          rechargePercent: 0,
          usable: true,
          outOfRange: false,
          queued: false,
          procGlow: false,
          empowered: false,
          ariaLabel: 'A',
          keybindLabel: 'K',
        },
      ],
    };
    harnesses.push({ name: 'action_bar', drive: () => painter.paint(state) });
  }

  return harnesses;
}

// Drive every painter once to establish, then REPEATS identical frames. A correctly
// eliding painter writes nothing on the repeats; a non-byte-identical cache key (risk 1)
// writes every frame and fails the per-painter `extra === 0` assertion immediately - that
// per-painter check is the REAL collapse detector. The aggregate skip-rate returned here is
// a derived structural sanity bound (with all painters eliding, it is deterministically
// ~64/65, comfortably above the floor); the production real-browser ratio is ARM 3's domain.
const REPEATS = 64;

function runSkipRateLoop(shape: WorldShape): number {
  const { facet, counts } = countingFacet();
  for (const harness of buildHarnesses(shape, facet)) {
    const beforeEstablish = counts.writes;
    harness.drive();
    // PER-PAINTER establishing-write proof (not just the aggregate): a cold cache must
    // produce real writes, so an inert harness that drives nothing can never pass vacuously.
    const established = counts.writes - beforeEstablish;
    expect(
      established,
      `${harness.name} (${shape}): the establishing (cold-cache) frame must perform real writes; got ${established}.`,
    ).toBeGreaterThan(0);
    const writesBefore = counts.writes;
    for (let frame = 0; frame < REPEATS; frame++) harness.drive();
    const extra = counts.writes - writesBefore;
    expect(
      extra,
      `${harness.name} (${shape}): a repeated identical frame must elide every write (got ${extra} new writes across ${REPEATS} steady frames). A non-byte-identical cache key collapses the skip-rate (Top risk 1).`,
    ).toBe(0);
  }
  const total = counts.writes + counts.skips;
  return counts.skips / total;
}

describe('hud_perf_budget ARM 2: write-elision skip-rate budget (Node fake-DOM, npm test)', () => {
  for (const shape of ['sim', 'clientworld'] as const) {
    it(`steady-state per-frame painting stays >= the skip-rate floor (${shape} shape)`, () => {
      const skipRate = runSkipRateLoop(shape);
      expect(
        skipRate,
        `${shape}: aggregate hot-DOM skip-rate ${skipRate.toFixed(4)} dropped below the committed floor ${SKIP_RATE_FLOOR}; the write-elision cache collapsed.`,
      ).toBeGreaterThanOrEqual(SKIP_RATE_FLOOR);
    });
  }
});

// --------------------------------------------------------------------------
// ARM 2 (cont.) - allocation budget: the per-frame view cores reuse their container.
// --------------------------------------------------------------------------

function actionBarDeps(): ActionBarDeps {
  return {
    t: (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    abilityName: (def) => def.id,
    itemName: (item) => item.id,
    slotLabel: (slotIndex) => `${slotIndex + 1}`,
    formatCount: (n) => String(n),
  };
}

function idleWorld(): ActionBarWorldInput {
  return {
    player: {
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      stealthed: false,
      auras: [],
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
  };
}

function aurasDeps(): AurasDeps {
  return {
    iconId: (a) => a.id,
    auraName: (a) => a.name,
    formatStacks: (n) => String(n),
    isOwn: () => false,
    durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
    auraEffectHtml: () => '',
  };
}

describe('hud_perf_budget ARM 2: per-frame allocation budget (Node, npm test)', () => {
  it('action_bar_view reuses its state container every tick (no per-frame garbage)', () => {
    const view = createActionBarView(
      {
        slots: [
          {
            slotIndex: 0,
            isAttack: () => false,
            hasAction: () => true,
            ability: () => ({
              def: {
                id: 'fireball',
                offGcd: false,
                cooldown: 6,
                requiresTarget: false,
                range: 0,
              } as unknown as AbilityDef,
              cost: 0,
            }),
            item: () => null,
            keybindLabel: () => '1',
          },
        ],
      },
      actionBarDeps(),
    );
    const world = idleWorld();
    expect(() => {
      // Both the wrapper AND the .slots array must be the SAME reference every tick (the
      // per-slot reference-stability property, not just "the wrapper is reused").
      assertAllocationStable(() => view.tick(world), 64, 'action_bar_view container');
      assertAllocationStable(() => view.tick(world).slots, 64, 'action_bar_view slots');
    }).not.toThrow();
  });

  // Drive auras_view with both the Sim aura (a positive value) and the
  // ClientWorld mirror (value zeroed online); both must tick into a reused container.
  for (const shape of ['sim', 'clientworld'] as const) {
    it(`auras_view reuses its state container every tick (${shape} shape)`, () => {
      const view = createAurasView('all', aurasDeps());
      const auras: AuraInput[] = [
        {
          id: 'a',
          name: 'A',
          kind: 'buff_ap',
          remaining: 600,
          value: shape === 'sim' ? 50 : 0,
        },
      ];
      expect(() => {
        assertAllocationStable(() => view.tick({ auras }), 64, `auras_view (${shape}) container`);
        assertAllocationStable(() => view.tick({ auras }).slots, 64, `auras_view (${shape}) slots`);
      }).not.toThrow();
    });
  }
});

// --------------------------------------------------------------------------
// ARM 3 - perf_tour-delegated (env-gated, perf row).
// --------------------------------------------------------------------------

const TOUR_ENABLED = process.env.HUD_PERF_BUDGET_TOUR === '1';
const tourDescribe = TOUR_ENABLED ? describe : describe.skip;

tourDescribe(
  'hud_perf_budget ARM 3: perf_tour-delegated frame + pool budget (HUD_PERF_BUDGET_TOUR=1)',
  () => {
    // The operator runs `PERF_VIEWPORT=<vp> PERF_OUT=<path> node scripts/perf_tour.mjs`
    // (a real browser over `npm run dev`), then points this arm at the artifact. It reuses
    // the perf_tour measurement path, never a new one.
    const viewport = process.env.HUD_PERF_BUDGET_TOUR_VIEWPORT ?? 'desktop';
    const resultPath = process.env.HUD_PERF_BUDGET_TOUR_RESULT ?? 'tmp/perf-tour-desktop.json';
    const long50Ref = process.env.HUD_PERF_BUDGET_TOUR_LONG50_BASELINE
      ? Number(process.env.HUD_PERF_BUDGET_TOUR_LONG50_BASELINE)
      : LONG50_ANCHOR;

    function loadArtifact(): {
      summary: Record<
        string,
        {
          frames: number;
          frameLong50: number;
          hudHotDomSkipRate: number;
          hudHotDomWrites: number;
        }
      >;
      results: Array<{
        viewport: string;
        fctBurst?: { spawnPerWave: number; max: number; min: number; drove: boolean };
      }>;
    } {
      const abs = resultPath.startsWith('/')
        ? resultPath
        : fileURLToPath(new URL(`../${resultPath}`, import.meta.url));
      return JSON.parse(readFileSync(abs, 'utf8'));
    }

    // The frames floor is what makes the frame gate FAILABLE: the retired frameP95
    // ceiling equaled the 250 ms sample clamp, so a catastrophically slow run
    // saturated every sample into a pass. A run that slow renders almost no frames,
    // so it dies here instead.
    it(`the tour renders at least tourMinFrames real frames on ${viewport}`, () => {
      const summary = loadArtifact().summary[viewport];
      expect(summary, `perf_tour artifact has no ${viewport} summary`).toBeDefined();
      expect(
        summary.frames,
        `${viewport} rendered ${summary.frames} frames, below the committed tourMinFrames floor ${TOUR_MIN_FRAMES}; the tour did not actually exercise the frame path (or the frame counter regressed). The floor is a PERF_GPU=1 same-machine value; see hud_perf_budget.baseline.md.`,
      ).toBeGreaterThanOrEqual(TOUR_MIN_FRAMES);
    });

    it(`long frames stay at or under the frameLong50 anchor on ${viewport}`, () => {
      const summary = loadArtifact().summary[viewport];
      expect(summary, `perf_tour artifact has no ${viewport} summary`).toBeDefined();
      expect(
        summary.frameLong50,
        `${viewport} produced ${summary.frameLong50} frames at or over 50 ms, above the anchor ${long50Ref} (same-machine PERF_GPU=1 value; on other hardware set HUD_PERF_BUDGET_TOUR_LONG50_BASELINE to a fresh same-machine capture).`,
      ).toBeLessThanOrEqual(long50Ref);
    });

    // ELISION-COLLAPSE GATE (every viewport). The regression signal is the elision-BYPASS
    // COUNT (`hudHotDomWrites`): the writes that bypassed the cache. It is run-length-
    // INDEPENDENT - a longer tour adds only SKIPS, never new bypass writes once state is
    // steady - so the committed anchor is a single canonical row covering the WORST viewport
    // (the touch HUD establishes more elements than desktop) plus a write or two of run
    // jitter; a collapse balloons the count toward the frame count, far past that headroom.
    // The skip RATIO (skipped / total) is a DERIVED quantity whose denominator is
    // the total frame count, which jitters with fps + machine load run to run, so the
    // ratio is NOT a safe cross-run hard gate.
    // We gate the COUNT (closes the mobile gap the old desktop-only ratio gate left open);
    // the ratio stays in the perf_tour console for human context. ARM 2's ratio floor is
    // safe because its fake-DOM loop has a FIXED denominator.
    it(`keeps the elision-bypass write count at or below the anchor (${viewport})`, () => {
      const summary = loadArtifact().summary[viewport];
      expect(summary, `perf_tour artifact has no ${viewport} summary`).toBeDefined();
      expect(
        summary.hudHotDomWrites,
        `${viewport} elision-bypass writes ${summary.hudHotDomWrites} exceed the anchor ${BYPASS_ANCHOR}; the write-elision cache collapsed (a real, run-length-independent per-frame regression). If this is a DELIBERATE new per-frame element, update the anchor in hud_perf_budget.baseline.md.`,
      ).toBeLessThanOrEqual(BYPASS_ANCHOR);
    });

    it(`the FCT pool stays cap-bounded under the scripted AoE burst (${viewport})`, () => {
      const burst = loadArtifact().results.find((r) => r.viewport === viewport)?.fctBurst;
      expect(burst, `perf_tour artifact has no fctBurst for ${viewport}`).toBeDefined();
      if (!burst) return;
      expect(burst.drove).toBe(true);
      expect(burst.min, 'the burst must actually spawn floaters').toBeGreaterThan(0);
      // Gate on the ACTUAL max-concurrent (FCT_POOL_CAP), imported from the painter, so a
      // silently-RAISED cap fails here; keep `< spawnPerWave` as the secondary unbounded-pool
      // tripwire (a per-event createElement regression climbs toward the spawn count).
      expect(
        burst.max,
        `FCT live nodes ${burst.max} exceed the pool cap ${FCT_POOL_CAP}; the bound was raised or removed.`,
      ).toBeLessThanOrEqual(FCT_POOL_CAP);
      expect(
        burst.max,
        `FCT live nodes ${burst.max} reached the spawn count ${burst.spawnPerWave}; the pool is not bounded.`,
      ).toBeLessThan(burst.spawnPerWave);
      expect(burst.max, 'the bounded pool must re-saturate to the same count each wave').toBe(
        burst.min,
      );
    });
  },
);
