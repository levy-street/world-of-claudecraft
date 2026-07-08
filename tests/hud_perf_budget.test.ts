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
//   ARM 1 - STATIC SOURCE-SCAN (Node, runs in every `npm test`): the raw-write
//     rejection. Every FACET-ROUTED HUD painter must route ALL per-frame writes through the
//     PainterHost elided writers (setText/setDisplay/setTransform/setWidth +
//     setStyleProp/toggleClass/setAttr); no raw .style/.textContent/.classList/
//     .className/.setAttribute/.setProperty/.innerHTML beyond a DOCUMENTED build-time
//     exception. This is the same per-painter check the per-frame painters
//     used, consolidated; the canvas painters (cadence + cached tokens) and the
//     render-cadence nameplate painter are NOT facet-routed and are excluded. A completeness
//     check pairs the scanned list with the canvas-exclusion list so a NEW src/ui painter
//     must be classified, never silently escaping the scan.
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
//     and asserts (a) frameP95 <= the baseline (same-machine; see the baseline file, frameP95
//     is NOT portable, so an operator on other hardware overrides the reference with a fresh
//     re-run via HUD_PERF_BUDGET_TOUR_FRAME_BASELINE), (b) the elision-bypass write COUNT
//     `hudHotDomWrites` <= the baseline anchor, EVERY viewport (the run-length-independent
//     collapse signal; the skip RATIO is frame-count-dependent so it stays in the console for
//     context, not a hard gate), and (c) the FCT pool stays at/under FCT_POOL_CAP under
//     the scripted AoE burst (fctBurstBoundedNodes). SKIPPED when the env flag is unset so
//     bare `npm test` stays fast and portable.
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
import {
  type ActionBarPaintDescriptor,
  ActionBarPainter,
  type ActionBarSlotElements,
} from '../src/ui/action_bar_painter';
import {
  type ActionBarDeps,
  type ActionBarState,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/action_bar_view';
import { type AuraInput, type AurasDeps, createAurasView } from '../src/ui/auras_view';
import {
  type CastBarElements,
  type CastBarOptions,
  CastBarPainter,
  type CastBarPaintInput,
} from '../src/ui/cast_bar_painter';
import { FCT_POOL_CAP } from '../src/ui/fct_painter';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import type { SwingTimerState } from '../src/ui/swing_timer';
import { SwingTimerPainter } from '../src/ui/swing_timer_painter';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import { type UnitFrameElements, UnitFramePainter } from '../src/ui/unit_frame_painter';
import type { XpBarView } from '../src/ui/xp_bar';
import { XpBarPainter } from '../src/ui/xp_bar_painter';
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
// frame count, so it is the same on desktop, mobile, and every re-run (the baseline pins it
// at 153, the post-extraction steady state, byte-identical across profiles). A collapse
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

// frameP95 is SAME-MACHINE-RELATIVE only (software-WebGL ms, not portable). ARM 3 reads
// it as the reference, but an operator on other hardware overrides it with a fresh
// same-machine re-run (HUD_PERF_BUDGET_TOUR_FRAME_BASELINE).
function readBaselineFrameP95(): number {
  const line = baselineMd.split('\n').find((l) => l.includes('frameP95') && /\d+\s*ms/.test(l));
  const match = line?.match(/(\d+)\s*ms/);
  if (!match) {
    throw new Error('hud_perf_budget.baseline.md: the frameP95 baseline (`NNN ms`) is missing.');
  }
  return Number(match[1]);
}

const SKIP_RATE_FLOOR = readBaselineSkipRateFloor();
const BYPASS_ANCHOR = readBaselineBypassCount();

// --------------------------------------------------------------------------
// ARM 1 - static raw-write rejection over every hot-path painter.
// --------------------------------------------------------------------------

// The raw-DOM-write vocabulary the per-frame painters reject. Every per-frame write must
// go through a facet writer, so any of these on a painter's hot path is a facet-routing
// break. Each painter pins its DOCUMENTED build-time exceptions by COUNT (the same
// allowances the per-painter tests pin): a pooled node's class is set once in its
// builder, not per frame.
const RAW_WRITE_TOKENS = [
  '.style',
  '.textContent',
  '.classList',
  '.className',
  '.setAttribute',
  '.removeAttribute',
  '.setProperty',
  '.innerHTML',
  '.dataset',
] as const;

// Forced-reflow READ tokens: a per-frame layout read (offsetWidth, getBoundingClientRect,
// getComputedStyle, ...) flushes pending style/layout and is the classic per-frame
// browser-perf killer (layout thrash). A facet-routed HUD painter must make NONE on its hot
// path; the only allowed read is fct_painter's single documented offsetWidth (the CSS-
// animation-restart reflow flush on a recycled pooled node, not a per-frame measure). The
// canvas painters (excluded) DO read getComputedStyle once per redraw to resolve tokens, and
// that cadence is guarded by their own *_painter.test.ts, so they stay out here.
// Tokens are leading-dot member accesses so countToken's `\${token}\b` regex escapes cleanly
// (a dotless token's leading `\r` would be read as a carriage return and match nothing).
const FORCED_REFLOW_READ_TOKENS = [
  '.offsetWidth',
  '.offsetHeight',
  '.offsetTop',
  '.offsetLeft',
  '.clientWidth',
  '.clientHeight',
  '.scrollWidth',
  '.scrollHeight',
  '.getBoundingClientRect',
  '.getClientRects',
  '.getComputedStyle',
] as const;

// Allowed counts: anything not listed must be ZERO. auras builds its pooled node + the
// .dur / .stacks children once in createNode (3 className writes); fct sets the base
// class once and aria-hidden once per pooled node, both at build; fct also forces ONE
// documented offsetWidth reflow to restart the float animation on a recycled node.
const HOT_PAINTERS: ReadonlyArray<{
  file: string;
  allow: Partial<Record<string, number>>;
  reflowAllow: Partial<Record<string, number>>;
}> = [
  { file: 'xp_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'swing_timer_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'cast_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'unit_frame_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'action_bar_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'mobile_action_ring_painter.ts', allow: {}, reflowAllow: {} },
  { file: 'party_frames_painter.ts', allow: {}, reflowAllow: {} },
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
];

// The OTHER src/ui/*_painter.ts modules, NOT facet-routed, so deliberately not in the
// raw-write scan above: they draw to a 2D/Three canvas under the cadence +
// cached-token regime (resolve --color-* tokens once per redraw, never per-marker), where
// canvas drawing and one-time element sizing are not "raw per-frame DOM writes". The
// completeness check below pairs with HOT_PAINTERS so a NEW src/ui/*_painter.ts must be
// consciously classified (facet-routed -> add to HOT_PAINTERS; canvas -> add here) instead
// of silently escaping the scan. (Render-resident painters under src/render, e.g. the
// cadence-throttled nameplate_painter, are intentionally outside this HUD-painter file.)
const CANVAS_PAINTERS: ReadonlyArray<string> = [
  'delve_map_painter.ts',
  'map_window_painter.ts',
  'minimap_painter.ts',
  'perf_graph_painter.ts',
  'unit_portrait_painter.ts',
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function countToken(code: string, token: string): number {
  // Word-boundary match like the per-painter guards, so `.style` does not match a
  // `.styleProp` member and `.setAttribute` is the method, not a substring.
  const re = new RegExp(`\\${token}\\b`, 'g');
  return (code.match(re) ?? []).length;
}

describe('hud_perf_budget ARM 1: hot painters make no raw DOM write (Node, npm test)', () => {
  for (const { file, allow, reflowAllow } of HOT_PAINTERS) {
    it(`${file} routes every per-frame write through the elided writers`, () => {
      const src = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
      const code = stripComments(src);
      for (const token of RAW_WRITE_TOKENS) {
        const expected = allow[token] ?? 0;
        const actual = countToken(code, token);
        expect(
          actual,
          `${file}: ${token} appears ${actual}x, expected ${expected} (per-frame writes must go through the PainterHost facet; only a DOCUMENTED build-time exception is allowed)`,
        ).toBe(expected);
      }
    });

    it(`${file} makes no per-frame forced-reflow layout read`, () => {
      const src = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
      const code = stripComments(src);
      for (const token of FORCED_REFLOW_READ_TOKENS) {
        const expected = reflowAllow[token] ?? 0;
        const actual = countToken(code, token);
        expect(
          actual,
          `${file}: ${token} appears ${actual}x, expected ${expected} (a per-frame layout read flushes pending layout = thrash; only a DOCUMENTED reflow flush is allowed)`,
        ).toBe(expected);
      }
    });
  }

  // Completeness (mirrors the core sweep): every on-disk src/ui/*_painter.ts is
  // either facet-routed (scanned above) or a documented canvas exclusion, so a NEW painter
  // cannot silently escape the raw-write scan by being forgotten from HOT_PAINTERS.
  it('classifies every src/ui/*_painter.ts as facet-routed or a documented canvas exclusion', () => {
    const dir = fileURLToPath(new URL('../src/ui', import.meta.url));
    const onDisk = readdirSync(dir).filter((name) => name.endsWith('_painter.ts'));
    const classified = new Set<string>([...HOT_PAINTERS.map((p) => p.file), ...CANVAS_PAINTERS]);
    const unclassified = onDisk.filter((name) => !classified.has(name));
    expect(
      unclassified,
      `unclassified src/ui painter(s): add a facet-routed painter to HOT_PAINTERS (it must make no raw per-frame write) or a canvas painter to CANVAS_PAINTERS:\n${unclassified.join('\n')}`,
    ).toEqual([]);
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
          usable: true,
          outOfRange: false,
          queued: false,
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
            isAttack: false,
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
    const frameRef = process.env.HUD_PERF_BUDGET_TOUR_FRAME_BASELINE
      ? Number(process.env.HUD_PERF_BUDGET_TOUR_FRAME_BASELINE)
      : readBaselineFrameP95();

    function loadArtifact(): {
      summary: Record<
        string,
        { frameP95: number; hudHotDomSkipRate: number; hudHotDomWrites: number }
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

    it(`frameP95 stays within the same-machine baseline (${viewport})`, () => {
      const summary = loadArtifact().summary[viewport];
      expect(summary, `perf_tour artifact has no ${viewport} summary`).toBeDefined();
      expect(
        summary.frameP95,
        `${viewport} frameP95 ${summary.frameP95}ms exceeds the baseline ${frameRef}ms (same-machine; on other hardware set HUD_PERF_BUDGET_TOUR_FRAME_BASELINE to a fresh re-run).`,
      ).toBeLessThanOrEqual(frameRef);
    });

    // ELISION-COLLAPSE GATE (every viewport). The regression signal is the elision-BYPASS
    // COUNT (`hudHotDomWrites`): the writes that bypassed the cache. It is run-length-
    // INDEPENDENT - a longer tour adds only SKIPS, never new bypass writes once state is
    // steady - so it is the same on desktop, mobile, and every re-run (the baseline pins it
    // at 153). The skip RATIO (skipped / total) is a DERIVED quantity whose denominator is
    // the total frame count, which jitters with software-WebGL fps + machine load: a clean
    // re-run measured desktop 0.959 vs the recorded 0.962 with hudHotDomWrites IDENTICALLY
    // 152 (elision intact, pure ratio noise), so the ratio is NOT a safe cross-run hard gate.
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
