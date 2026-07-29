// The 7-piece set bonus TEXT, end to end.
//
// This exists because the i18n coverage guard could not catch the defect that
// mattered. That guard validates that a REGISTERED field exists and is
// translated; it cannot tell you which field a tier resolves to. Every shipped
// set used 2/3/4 piece tiers, and three separate places hard coded that
// assumption behind a ternary chain ending in 'bonus4' (the entity-i18n
// resolver, the catalog builder, and the hud tooltip), so the WARFARE families'
// 7-piece tier RENDERED THE WRONG TEXT rather than failing. Generalizing the
// field to bonus${pieces} fixed the mechanism; this file is the backstop, so the
// ternary chain cannot grow back.
//
// It deliberately checks the property the coverage guard cannot: not "the bonus7
// key exists and is translated", but "the tier whose pieces are 7 resolves to
// bonus7 and renders text distinct from the 4-piece tier", in a non-Latin locale
// where a silent fallback to English would otherwise be invisible.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { itemSetBonusField, itemSetBonusPieces, tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { itemSetMemberCounts, itemSetTooltipModel } from '../src/ui/item_set_tooltip_view';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const WARFARE_SETS = Object.values(ITEM_SETS).filter((set) => set.id.startsWith('warfare_'));
const NON_LATIN = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

beforeAll(async () => {
  for (const lang of NON_LATIN) await ensureLocaleLoaded(lang);
});

afterAll(() => {
  setLanguage('en');
});

describe('the 7-piece set bonus text', () => {
  it('covers all five WARFARE families, so this file is not vacuous', () => {
    expect(WARFARE_SETS).toHaveLength(5);
    for (const set of WARFARE_SETS) {
      expect(
        set.bonuses.map((b) => b.pieces),
        set.id,
      ).toEqual([2, 4, 7]);
    }
  });

  it('maps a tier piece count to its own field, in both directions', () => {
    // The mechanism the old ternary chain got wrong. Round-trip so neither half
    // can drift: a chain ending in 'bonus4' would send 7 to the wrong field.
    for (const pieces of [2, 4, 7]) {
      expect(itemSetBonusField(pieces)).toBe(`bonus${pieces}`);
      expect(itemSetBonusPieces(`bonus${pieces}`)).toBe(pieces);
    }
    expect(itemSetBonusField(7)).not.toBe(itemSetBonusField(4));
  });

  it('renders each tier its OWN text, so the capstone is never the 4-piece line', () => {
    setLanguage('en');
    for (const set of WARFARE_SETS) {
      const rendered = [2, 4, 7].map((pieces) =>
        tEntity({ kind: 'itemSet', id: set.id, field: itemSetBonusField(pieces) }),
      );
      const [two, four, seven] = rendered;
      expect(new Set(rendered).size, `${set.id}: three tiers, three distinct strings`).toBe(3);
      // The specific regression: the capstone silently painted as the 4-piece line.
      expect(seven, `${set.id} capstone must not be the 4-piece text`).not.toBe(four);
      expect(seven, `${set.id} capstone must not be the 2-piece text`).not.toBe(two);
      // And the capstone must actually be the capstone: it is the only tier that
      // grants both ratings plus a signature.
      expect(seven, `${set.id} capstone text`).toMatch(/80/);
    }
  });

  it('renders the capstone localized in every non-Latin locale, not the English source', () => {
    for (const lang of NON_LATIN) {
      setLanguage(lang);
      for (const set of WARFARE_SETS) {
        const seven = tEntity({ kind: 'itemSet', id: set.id, field: itemSetBonusField(7) });
        const four = tEntity({ kind: 'itemSet', id: set.id, field: itemSetBonusField(4) });
        expect(seven.trim().length, `${lang}.${set.id}.bonus7`).toBeGreaterThan(0);
        // A silent English fallback is exactly what is invisible here, so compare
        // against the authored English rather than only against emptiness.
        const authored = set.bonuses.find((b) => b.pieces === 7)?.text ?? '';
        expect(seven, `${lang}.${set.id}.bonus7 fell back to English`).not.toBe(authored);
        expect(seven, `${lang}.${set.id}: capstone collided with the 4-piece line`).not.toBe(four);
      }
    }
  });

  it('keeps the 7-piece tier REACHABLE in the tooltip model', () => {
    // itemSetMemberCounts counts a set's DISTINCT SLOTS, which is 7 per family, so
    // the capstone is reachable and renders. If a family ever dropped to 6 distinct
    // slots the tier would silently vanish from the tooltip instead of failing.
    const members = itemSetMemberCounts();
    for (const set of WARFARE_SETS) {
      expect(members[set.id], `${set.id} distinct slots`).toBe(7);
      const model = itemSetTooltipModel({
        itemSetId: set.id,
        equippedPieces: 7,
        itemSetMembers: members,
      });
      expect(model?.totalPieces, set.id).toBe(7);
      expect(
        model?.bonusTiers.map((tier) => tier.pieces),
        set.id,
      ).toEqual([2, 4, 7]);
      // At seven worn, every tier including the capstone is live.
      expect(
        model?.bonusTiers.every((tier) => tier.active),
        `${set.id} all tiers active`,
      ).toBe(true);
    }
  });

  it('pins the tooltip call site to the helper, not a rebuilt ternary chain', () => {
    // The three cases above drive itemSetBonusField directly, which proves the
    // HELPER is right but not that the tooltip still calls it. The defect lived at
    // the call site, so pin the call site: a reintroduced 2/3/4 chain in hud.ts
    // would send a 7-piece tier to 'bonus4' and paint the wrong line while every
    // assertion above stayed green.
    const hud = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain('field: itemSetBonusField(tier.pieces)');
    expect(hud, 'a bonus2/3/4 ternary chain came back into the set tooltip').not.toMatch(
      /tier\.pieces === 2 \?/,
    );
    expect(hud, "no literal 'bonus4' should remain in the set tooltip path").not.toContain(
      "? 'bonus3' : 'bonus4'",
    );
  });

  it('leaves the capstone tier dormant below seven pieces', () => {
    const members = itemSetMemberCounts();
    const model = itemSetTooltipModel({
      itemSetId: WARFARE_SETS[0].id,
      equippedPieces: 6,
      itemSetMembers: members,
    });
    const capstone = model?.bonusTiers.find((tier) => tier.pieces === 7);
    expect(capstone, 'the capstone tier still renders at six pieces').toBeDefined();
    expect(capstone?.active, 'the capstone must be dormant at six pieces').toBe(false);
  });
});

// The sibling half of the same defect class: the tier TEXT resolving correctly is
// worth nothing if the proc it names renders untranslated the moment it fires.
// Thornguard shipped that way. Its three siblings were registered in sim_i18n's
// AURA_NAME_KEY and it was not, and nothing caught it: localizeSimAuraName returns
// null for an unregistered name, every caller falls back to the raw English, and
// the only round-trip guard in localization_fixes.test.ts sweeps elixirs.
//
// Derived from the live catalog rather than a list of four names, so a sixth
// family's signature is covered the day it is authored.
describe('the WARFARE capstone proc names', () => {
  const CAPSTONE_PROC_NAMES = [
    ...new Set(
      WARFARE_SETS.flatMap((set) => set.bonuses.map((tier) => tier.effect.proc?.name)).filter(
        (name): name is string => !!name,
      ),
    ),
  ].sort();

  it('sweeps every signature the families actually declare', () => {
    // Four, not five: the two caster families deliberately share Emberward.
    expect(CAPSTONE_PROC_NAMES).toEqual(['Ashen Step', 'Emberward', 'Thornguard', 'Unbroken Oath']);
  });

  it('every one of them round-trips through the sim aura matcher', () => {
    setLanguage('en');
    for (const name of CAPSTONE_PROC_NAMES) {
      // Not null is the load-bearing half: an unregistered name renders raw
      // English in the buff frame, buff tooltip, combat log and death recap.
      expect(
        localizeSimAuraName(name),
        `set proc "${name}" is not registered in sim_i18n AURA_NAME_KEY`,
      ).toBe(name);
    }
  });
});
