// Pure-core tests for src/ui/farming_view.ts: the farmDenied toast key and the
// farm grant-line selectors. Moved here with the selectors themselves when the
// knobs phase extracted farming's own view core (previously these blocks lived
// in tests/gathering_view.test.ts and tests/grant_line_view.test.ts beside the
// modules that hosted the functions by adjacency).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { FARM_HUSKS_PER_COMPOST } from '../src/sim/professions/farming';
import {
  type FarmDeniedReason,
  farmDeniedLineKey,
  farmDeniedToast,
  farmFineLineKey,
  farmHarvestLineKey,
  farmHusksConvertedLineKey,
  farmPlantedTokenId,
  farmSeedBackLineKey,
  farmWitheredLineKey,
} from '../src/ui/farming_view';
import { gatherLineKey, harvestLineKey } from '../src/ui/grant_line_view';
import { setLanguage, t } from '../src/ui/i18n';

describe('farmDeniedLineKey', () => {
  it('gives every refusal reason its own real, distinct line', () => {
    // The reasons are listed literally so this fails loudly if one is renamed;
    // the OTHER direction (a reason ADDED to the sim union with no line) is
    // caught by tsc, since farmDeniedLineKey's template literal has to be
    // assignable to TranslationKey.
    const reasons: FarmDeniedReason[] = [
      'bad_bed',
      'bad_crop',
      'range',
      'bed_taken',
      'skill',
      'no_seed',
      'not_ready',
      'no_plot',
      'no_husks',
      'no_compost',
      'no_fee_produce',
      'no_tonic',
      'tool',
    ];
    const keys = reasons.map((r) => farmDeniedLineKey(r));
    expect(keys).toEqual([
      'hudChrome.farming.denied.bad_bed',
      'hudChrome.farming.denied.bad_crop',
      'hudChrome.farming.denied.range',
      'hudChrome.farming.denied.bed_taken',
      'hudChrome.farming.denied.skill',
      'hudChrome.farming.denied.no_seed',
      'hudChrome.farming.denied.not_ready',
      'hudChrome.farming.denied.no_plot',
      'hudChrome.farming.denied.no_husks',
      'hudChrome.farming.denied.no_compost',
      'hudChrome.farming.denied.no_fee_produce',
      'hudChrome.farming.denied.no_tonic',
      'hudChrome.farming.denied.tool',
    ]);
    // Every key must actually EXIST: t() throws on an untracked key in test,
    // so this is what a leaf missing from the catalog fails on rather than a
    // player seeing a raw dotted path in a toast. The rendered COPY is checked
    // for distinctness too, not just the keys: nine keys pointing at two
    // sentences would pass a key-only pin while telling the player the wrong
    // thing seven times.
    setLanguage('en');
    const copy = keys.map((k) => t(k));
    for (const line of copy) expect(line.length).toBeGreaterThan(0);
    expect(new Set(copy).size).toBe(reasons.length);
  });

  it('keeps the knob deny prose naming the real items, so a rename reds here (the drift pin)', () => {
    // The three knob deny lines restate item names as inline PROSE, a
    // deliberate tradeoff (an error toast reads better as a sentence than a
    // spliced token; the gatherDenied family's convention), which leaves
    // nothing tying the copy to the item defs. This pin is that tie: each
    // line must contain its item's English display name, so a rename makes
    // the stale toast a test failure instead of a shipped lie in six locale
    // variants. The husk-trade line needs no such pin: it splices
    // {husksName}/{name} straight from the defs.
    setLanguage('en');
    for (const [itemId, key] of [
      ['withered_husks', 'hudChrome.farming.denied.no_husks'],
      ['compost', 'hudChrome.farming.denied.no_compost'],
      ['growth_tonic', 'hudChrome.farming.denied.no_tonic'],
    ] as const) {
      const name = ITEMS[itemId]?.name ?? '';
      expect(name, itemId).toBeTruthy();
      expect(t(key).toLowerCase(), key).toContain(name.toLowerCase());
    }
  });
});

describe('the husk-trade line and its plural floor', () => {
  it('may hardcode x{husks} only while a batch stays plural (the UI side of the sim pin)', () => {
    // Both husksConvertedLine variants embed 'x{husks}' unconditionally,
    // which honors the no-x1 rule only because one batch always spends at
    // least two husks. The sim pins the constant's value once; this arm is
    // the UI-side link, so a tuning drop to 1 reds BESIDE the line that
    // would start reading 'Withered Husks x1'.
    expect(FARM_HUSKS_PER_COMPOST).toBeGreaterThan(1);
  });
});

describe('the farm grant-line selectors', () => {
  it('farmPlantedTokenId resolves a crop to the SEED it consumed, not to the crop id', () => {
    // The happy path, pinned to the shipped literal: the plant line must name
    // the seed. `not.toBe(cropId)` is the arm that matters as much as the
    // literal, because the fallback below returns the crop id unchanged, so an
    // implementation that lost the lookup entirely would still satisfy a
    // fallback-only test.
    expect(farmPlantedTokenId('vale_wheat')).toBe('vale_wheat_seed');
    expect(farmPlantedTokenId('vale_wheat')).not.toBe('vale_wheat');
    // And the resolved id is a REAL item, which is what keeps grantItemToken
    // on its link path instead of degrading to a raw id in a player's log.
    expect(ITEMS[farmPlantedTokenId('vale_wheat')]).toBeTruthy();
  });

  it('farmPlantedTokenId falls back to the crop id itself for an unknown crop', () => {
    // Content drift between a client and a newer server. The fallback names
    // SOMETHING rather than splicing an empty string, which is the whole
    // reason it is not `?? ''`. The prototype key is included because
    // farmCropById guards with Object.hasOwn precisely so 'constructor' cannot
    // resolve to a function and pass a truthiness gate.
    expect(farmPlantedTokenId('not_a_crop')).toBe('not_a_crop');
    expect(farmPlantedTokenId('constructor')).toBe('constructor');
    expect(farmPlantedTokenId('')).toBe('');
    // Anti-vacuous: this arm really is the degrade path, i.e. the id it
    // returns is NOT a real item, which is what grantItemToken then renders as
    // plain text instead of a link.
    expect(ITEMS.not_a_crop).toBeFalsy();
  });

  it('the three farming selectors switch families exactly at 2, absent included', () => {
    // Same boundary as every sibling family in grant_line_view. An absent
    // count reads as one unit, which is the arm that would otherwise render a
    // bare "x" from grantQtyText's own default.
    expect(farmHarvestLineKey(undefined)).toBe('hudChrome.farming.harvestLine');
    expect(farmHarvestLineKey(1)).toBe('hudChrome.farming.harvestLine');
    expect(farmHarvestLineKey(2)).toBe('hudChrome.farming.harvestLineQty');
    expect(farmHarvestLineKey(12)).toBe('hudChrome.farming.harvestLineQty');
    expect(farmFineLineKey(undefined)).toBe('hudChrome.farming.harvestFineLine');
    expect(farmFineLineKey(1)).toBe('hudChrome.farming.harvestFineLine');
    expect(farmFineLineKey(2)).toBe('hudChrome.farming.harvestFineLineQty');
    expect(farmWitheredLineKey(1)).toBe('hudChrome.farming.witheredLine');
    expect(farmWitheredLineKey(2)).toBe('hudChrome.farming.witheredLineQty');
    // The seed-back sentence (tier 3/4 harvests, both outcomes): the same
    // boundary, and the shipped payouts sit exactly one on each side of it
    // (1 seed takes the plain line, 2 the quantity sibling).
    expect(farmSeedBackLineKey(undefined)).toBe('hudChrome.farming.seedBackLine');
    expect(farmSeedBackLineKey(1)).toBe('hudChrome.farming.seedBackLine');
    expect(farmSeedBackLineKey(2)).toBe('hudChrome.farming.seedBackLineQty');
    // The husk trade keys on the COMPOST granted, the grant side of the
    // trade, with the same boundary and the same absent-reads-as-one rule.
    expect(farmHusksConvertedLineKey(undefined)).toBe('hudChrome.farming.husksConvertedLine');
    expect(farmHusksConvertedLineKey(1)).toBe('hudChrome.farming.husksConvertedLine');
    expect(farmHusksConvertedLineKey(2)).toBe('hudChrome.farming.husksConvertedLineQty');
    // Both leaves really render (t() throws on an untracked key in test), and
    // the line splices BOTH sides of the trade as ITEM TOKENS: the husks
    // spent ({husksName} x{husks}) and the compost gained ({name} x{qty}), so
    // neither side can drift from its localized item name (the review-round
    // finding: the first draft hardcoded "withered husks" as English prose).
    setLanguage('en');
    const line = t('hudChrome.farming.husksConvertedLineQty', {
      husksName: 'Withered Husks',
      husks: '4',
      name: 'Compost',
      qty: '2',
    });
    expect(line).toContain('Withered Husks x4');
    expect(line).toContain('Compost x2');
    expect(
      t('hudChrome.farming.husksConvertedLine', {
        husksName: 'Withered Husks',
        husks: '2',
        name: 'Compost',
      }),
    ).toContain('Compost');
  });

  it('farming produce, its fine twin, and the husk payout never share a key', () => {
    // Three DIFFERENT items land from one crop cycle, and the whole reason
    // the fine twin and the husks have their own lines is that folding any
    // two together reads as one yield reported twice (or, for the husks, as
    // a reward). A copy/paste that pointed two of these at one family would
    // leave every other pin in this file green.
    const farmKeys = [
      farmHarvestLineKey(1),
      farmHarvestLineKey(2),
      farmFineLineKey(1),
      farmFineLineKey(2),
      farmWitheredLineKey(1),
      farmWitheredLineKey(2),
      farmHusksConvertedLineKey(1),
      farmHusksConvertedLineKey(2),
      farmSeedBackLineKey(1),
      farmSeedBackLineKey(2),
    ];
    expect(new Set(farmKeys).size).toBe(10);
    // And never the gather or corpse-harvest families either: those matchers
    // still own "You gather:" / "You harvest:" for their own surfaces.
    for (const shared of [
      gatherLineKey(1),
      gatherLineKey(2),
      harvestLineKey({ kind: 'plain', qty: 1 }),
      harvestLineKey({ kind: 'specimen', qty: 1 }),
    ]) {
      expect(farmKeys).not.toContain(shared);
    }
  });
});

describe('farmDeniedToast: the tool refusal names the crop tier when it can', () => {
  it('resolves a known cropId to the tierRequired.farming line with THAT crop tier', () => {
    // Node-path parity: the same statement a vein's hover line makes about
    // its pick, delivered as the refusal toast because farming has no node to
    // hover. The tier comes from the crop record, so a tier-3 refusal names 3.
    expect(farmDeniedToast('tool', 'highland_barley')).toEqual({
      key: 'hudChrome.gathering.tierRequired.farming',
      params: { tier: 3 },
    });
    // A tier-1 crop resolves too: the arm keys on the id resolving, never on
    // the tier being high, and a wrong-tier regression reds on the 1 here
    // beside the 3 above.
    expect(farmDeniedToast('tool', 'vale_wheat')).toEqual({
      key: 'hudChrome.gathering.tierRequired.farming',
      params: { tier: 1 },
    });
    // The line itself renders and names the tier (t() throws on an untracked
    // key in test, so this also proves the catalog leaf is live again).
    setLanguage('en');
    expect(t('hudChrome.gathering.tierRequired.farming', { tier: 3 })).toBe(
      'Requires a tier 3 farming hoe',
    );
  });

  it('falls back to the flat denied.tool line for an unknown or absent cropId', () => {
    // Content drift between a client and a newer server (the
    // farmPlantedTokenId degrade case): a cropId the catalog cannot resolve
    // must not render a tierless template, so the flat line is the honest
    // fallback. The prototype key rides along because farmCropById guards
    // with Object.hasOwn.
    expect(farmDeniedToast('tool', 'not_a_crop')).toEqual({ key: 'hudChrome.farming.denied.tool' });
    expect(farmDeniedToast('tool', undefined)).toEqual({ key: 'hudChrome.farming.denied.tool' });
    expect(farmDeniedToast('tool', 'constructor')).toEqual({
      key: 'hudChrome.farming.denied.tool',
    });
    // Every non-tool reason passes through farmDeniedLineKey unchanged, a
    // resolvable cropId beside it or not: the tier line is the tool arm's alone.
    expect(farmDeniedToast('no_seed', 'highland_barley')).toEqual({
      key: 'hudChrome.farming.denied.no_seed',
    });
    expect(farmDeniedToast('skill', undefined)).toEqual({ key: 'hudChrome.farming.denied.skill' });
  });
});

describe('the hud seed-back render arms (source pin)', () => {
  // The two seed-back arms live in the hud.ts coordinator's farmHarvested and
  // farmWithered case bodies, which no jsdom suite drives, so this pins the
  // source directly (the 'hud composition source pin' precedent in
  // tests/gather_tool_tooltip.test.ts): each arm calls farmSeedBackLineKey
  // exactly once, INSIDE a positive seedBackCount guard, in its own case
  // body. Assertions run on extracted case slices and a brace-matched guard
  // block, never on whole-file proximity regex; whole-line comments are
  // stripped first so a commented-out call cannot satisfy the pin.
  const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
    /^\s*\/\/.*$/gm,
    '',
  );

  /** The case arm's slice: from its own label to the next case label, with
   *  both anchors demanded unique so the slice cannot silently widen. */
  function caseSlice(label: string, nextLabel: string): string {
    const open = `case '${label}': {`;
    const close = `case '${nextLabel}': {`;
    const start = hudSrc.indexOf(open);
    const end = hudSrc.indexOf(close);
    expect(start, `case '${label}' exists`).toBeGreaterThan(-1);
    expect(hudSrc.indexOf(open, start + 1), `case '${label}' appears once`).toBe(-1);
    expect(end, `case '${nextLabel}' bounds the slice`).toBeGreaterThan(start);
    return hudSrc.slice(start, end);
  }

  /** The brace-matched block of the arm's one positive seed-back guard. */
  function guardBlock(slice: string): string {
    const guard = 'if (ev.seedBackCount !== undefined && ev.seedBackCount > 0) {';
    const at = slice.indexOf(guard);
    expect(at, 'the positive guard exists').toBeGreaterThan(-1);
    expect(slice.indexOf(guard, at + 1), 'exactly one guard per arm').toBe(-1);
    let depth = 0;
    for (let i = slice.indexOf('{', at); i < slice.length; i++) {
      if (slice[i] === '{') depth += 1;
      else if (slice[i] === '}') {
        depth -= 1;
        if (depth === 0) return slice.slice(at, i + 1);
      }
    }
    throw new Error('unbalanced guard block');
  }

  it('farmHarvested renders the seed-back line exactly once, under the positive guard', () => {
    const arm = caseSlice('farmHarvested', 'farmWithered');
    expect(arm.split('farmSeedBackLineKey(ev.seedBackCount)').length - 1).toBe(1);
    expect(guardBlock(arm)).toContain('farmSeedBackLineKey(ev.seedBackCount)');
  });

  it('farmWithered renders the seed-back line exactly once, under the positive guard', () => {
    const arm = caseSlice('farmWithered', 'farmDenied');
    expect(arm.split('farmSeedBackLineKey(ev.seedBackCount)').length - 1).toBe(1);
    expect(guardBlock(arm)).toContain('farmSeedBackLineKey(ev.seedBackCount)');
  });
});
