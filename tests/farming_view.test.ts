// Pure-core tests for src/ui/farming_view.ts: the farmDenied toast key and the
// farm grant-line selectors. Moved here with the selectors themselves when the
// knobs phase extracted farming's own view core (previously these blocks lived
// in tests/gathering_view.test.ts and tests/grant_line_view.test.ts beside the
// modules that hosted the functions by adjacency).

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  type FarmDeniedReason,
  farmDeniedLineKey,
  farmFineLineKey,
  farmHarvestLineKey,
  farmHusksConvertedLineKey,
  farmPlantedTokenId,
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
    ];
    expect(new Set(farmKeys).size).toBe(8);
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
