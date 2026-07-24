// Pins the per-copy instance tooltip lines (Professions 2.0): every
// ItemInstancePayload variant renders its exact line set, so a regression in
// any arm (seal, enchanted marker, bonus stats, maker's mark, the legacy
// shapes) fails a decisive assertion. The module is the pure string-builder
// side of hud.itemTooltip's instance composition.
import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import {
  instanceBadgeLines,
  instanceBindingLines,
  instanceBonusStatLines,
  instanceMakersMarkLine,
  isGatheredProvenanceKind,
  itemNumber,
  itemStatName,
  wornTooltipInstance,
} from '../src/ui/item_instance_tooltip';
import { svgIcon } from '../src/ui/ui_icons';

describe('item_instance_tooltip', () => {
  it('masterwork copy gets the gold seal and no enchanted marker', () => {
    const html = instanceBadgeLines({
      signer: 'Anna',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
    expect(html).toContain('Masterwork');
    expect(html).toContain('color:var(--gold)');
    expect(html).toContain('class="tt-masterwork-seal-icon"');
    expect(html).toContain('src="/ui/professions/masterwork_seal.webp"');
    expect(html).toContain('alt="" aria-hidden="true"');
    expect(html).not.toContain('Enchanted');
  });

  it('enchant-marker copy gets the enchanted marker and no seal', () => {
    const html = instanceBadgeLines({ enchant: 'ench_firepower' });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('legacy enchanted copy (bare rolled.stats, no masterwork flag) reads as enchanted', () => {
    const html = instanceBadgeLines({ rolled: { stats: { int: 3 } } });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('masterwork plus enchant renders both badges, seal first', () => {
    const html = instanceBadgeLines({
      enchant: 'ench_firepower',
      rolled: { masterwork: true, stats: { str: 1 } },
    });
    const seal = html.indexOf('Masterwork');
    const ench = html.indexOf('Enchanted');
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(ench).toBeGreaterThan(seal);
  });

  it('legacy signed copy (signer only) renders the mark alone, no badges, no throw', () => {
    expect(instanceBadgeLines({ signer: 'Bob' })).toBe('');
    expect(instanceBonusStatLines({ signer: 'Bob' })).toBe('');
    expect(instanceMakersMarkLine({ signer: 'Bob' })).toContain('Crafted by Bob');
  });

  it('baked bonus stats each render one tt-instance-bonus line', () => {
    const html = instanceBonusStatLines({
      rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
    });
    expect((html.match(/tt-instance-bonus/g) ?? []).length).toBe(2);
    expect(html).toContain(itemStatName('str'));
    expect(html).toContain(itemStatName('sta'));
  });

  it('zero-valued baked stats are skipped', () => {
    expect(instanceBonusStatLines({ rolled: { stats: { str: 0 } } })).toBe('');
  });

  it("maker's mark escapes the signer name", () => {
    const html = instanceMakersMarkLine({ signer: '<b>x</b>' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('undefined instance renders nothing in any line set', () => {
    expect(instanceBadgeLines(undefined)).toBe('');
    expect(instanceBonusStatLines(undefined)).toBe('');
    expect(instanceMakersMarkLine(undefined)).toBe('');
  });

  it('a gathered-kind signed copy reads Gathered by, a crafted-kind keeps Crafted by', () => {
    // Both arms of the kind split, against real defs from each family.
    expect(ITEMS.copper_ore.kind).toBe('junk');
    const gathered = instanceMakersMarkLine({ signer: 'Anna' }, ITEMS.copper_ore.kind);
    expect(gathered).toContain('Gathered by Anna');
    expect(gathered).not.toContain('Crafted by');
    expect(gathered).not.toContain('makers-mark');
    expect(ITEMS.ironedge_longsword.kind).toBe('weapon');
    const crafted = instanceMakersMarkLine({ signer: 'Anna' }, ITEMS.ironedge_longsword.kind);
    expect(crafted).toContain('Crafted by Anna');
    expect(crafted).not.toContain('Gathered by');
    expect(crafted).toContain('tt-makers-mark-icon');
    expect(crafted).toContain('aria-hidden="true"');
    // No kind at all (a caller without the def) stays the crafted wording.
    expect(instanceMakersMarkLine({ signer: 'Anna' })).toContain('Crafted by Anna');
  });

  it("uses the exact project-owned maker's-mark stroke as a decorative currentColor glyph", () => {
    const glyph = svgIcon('makers-mark');
    expect(glyph).toContain('viewBox="0 0 512 512"');
    expect(glyph).toContain(
      'd="M82 390C126 341 151 273 157 204C162 156 213 139 249 168C284 196 274 247 236 262C204 274 177 253 178 220C204 276 258 326 323 340C364 349 397 329 426 296C393 365 315 400 231 382C171 369 122 363 82 390"',
    );
    expect(glyph).toContain('fill="none" stroke="currentColor" stroke-width="46"');
    expect(glyph).toContain('stroke-linecap="round" stroke-linejoin="round"');
    expect(glyph).toContain('aria-hidden="true"');
  });

  it('itemNumber pins fraction digits and itemStatName capitalizes unknown keys', () => {
    expect(itemNumber(3)).toBe('3');
    expect(itemNumber(2.5, 1)).toBe('2.5');
    expect(itemStatName('weird')).toBe('Weird');
  });
});

// The Maker's Bond lines (Professions 2.0): commission tooltip copy
// is scoped to the commission-eligible equipment kinds and renders in the def
// soulbound line's gold. The bound line names NO one (boundTo is an entity
// id, not a stable cross-session identity), so there is no name arm to pin.
describe('instanceBindingLines (commission lines)', () => {
  it('an armed-unbound equipment copy warns it binds to the first recipient', () => {
    const html = instanceBindingLines({ bindOnTrade: true }, 'weapon');
    expect(html).toContain('Commission piece: binds to the first recipient');
    expect(html).toContain('color:var(--gold)');
  });

  it('a bound equipment copy states the lock (and never the unbound warning)', () => {
    for (const kind of ['weapon', 'armor', 'held_offhand'] as const) {
      const html = instanceBindingLines({ bindOnTrade: true, boundTo: 7 }, kind);
      expect(html, kind).toContain('Commission piece: bound to its recipient');
      expect(html, kind).not.toContain('binds to the first recipient');
    }
  });

  it('a bound copy renders the bound line even if the arm is somehow absent (presence is the lock)', () => {
    expect(instanceBindingLines({ boundTo: 7 }, 'armor')).toContain(
      'Commission piece: bound to its recipient',
    );
  });

  it('the bound-reagent shape (junk kind) renders NOTHING: reagent tooltips stay line-free', () => {
    expect(instanceBindingLines({ bindOnTrade: true }, 'junk')).toBe('');
    expect(instanceBindingLines({ bindOnTrade: true, boundTo: 999 }, 'junk')).toBe('');
  });

  it('a plain instance, an undefined instance, and an undefined kind all render nothing', () => {
    expect(instanceBindingLines({ signer: 'Bob' }, 'weapon')).toBe('');
    expect(instanceBindingLines(undefined, 'weapon')).toBe('');
    expect(instanceBindingLines({ bindOnTrade: true }, undefined)).toBe('');
  });
});

// The worn-slot projection: the paperdoll renders exactly the
// public eqi allowlist (signer/enchant/rolled) in BOTH hosts, so the offline
// full payload can never show the bond lines on worn gear that the online
// eqi-trimmed mirror lacks. char_window.ts is pinned to route through it.
describe('wornTooltipInstance (the eqi-mirror worn projection)', () => {
  it('keeps exactly signer/enchant/rolled and drops the bond and charges fields', () => {
    expect(
      wornTooltipInstance({
        signer: 'Aldric',
        enchant: 'ench_x',
        rolled: { masterwork: true, stats: { str: 2 } },
        bindOnTrade: true,
        boundTo: 7,
        charges: { fireball: 2 },
      }),
    ).toEqual({
      signer: 'Aldric',
      enchant: 'ench_x',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
    expect(wornTooltipInstance(undefined)).toBeUndefined();
    // A bond-only payload projects to an EMPTY worn payload: no line renders.
    expect(
      instanceBindingLines(wornTooltipInstance({ bindOnTrade: true, boundTo: 7 }), 'armor'),
    ).toBe('');
  });

  it('char_window routes the paperdoll tooltip through the projection (source pin)', () => {
    const charWindow = readFileSync(new URL('../src/ui/char_window.ts', import.meta.url), 'utf8');
    expect(charWindow).toContain('wornTooltipInstance(');
    // The raw equippedInstances read feeds ONLY the projection, never the
    // tooltip directly.
    const site = charWindow.indexOf('equippedInstances?.[slot]');
    expect(site).toBeGreaterThan(-1);
    const before = charWindow.slice(Math.max(0, site - 220), site);
    expect(before).toContain('wornTooltipInstance(');
  });
});

// The provenance partition: the signed universe splits cleanly on
// item KIND. Every signable gathered item (corpse components, Pristine
// specimens, the zone node materials) is kind 'junk'; every crafted recipe
// output lands on a non-junk kind. If either side ever drifts (a junk-kind
// recipe output, a gathered material moved off 'junk'), the wording of its
// signed copies silently flips, so both sides are pinned against the live
// content tables. Fish are out of scope by construction: they share kind
// 'food' with crafted meals but fishing never signs a catch.
describe('isGatheredProvenanceKind partition over the live content', () => {
  it('every signable gathered item id resolves to a gathered-kind def', () => {
    const gatheredIds = [
      ...Object.values(HARVEST_COMPONENT_ITEMS),
      ...Object.values(HARVEST_COMPONENT_SPECIMENS),
      ...Object.values(NODE_MATERIAL_TABLE).flatMap((byZone) =>
        Object.values(byZone).map((row) => row.itemId),
      ),
    ];
    expect(gatheredIds.length).toBeGreaterThan(0);
    for (const id of gatheredIds) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, `${id} kind`).toBe('junk');
      expect(isGatheredProvenanceKind(def.kind), id).toBe(true);
    }
  });

  it('every crafted recipe output resolves to a crafted-kind def', () => {
    expect(ALL_RECIPES.length).toBeGreaterThan(0);
    for (const recipe of ALL_RECIPES) {
      const def = ITEMS[recipe.resultItemId];
      expect(def, recipe.resultItemId).toBeDefined();
      expect(isGatheredProvenanceKind(def.kind), `${recipe.resultItemId} (${def.kind})`).toBe(
        false,
      );
    }
  });
});

// Composition ORDER inside hud.itemTooltip (the builders are pinned above,
// the composed placement is hud.ts glue): badges under the soulbound line,
// baked bonus stats after the def's own stat lines, the maker's mark near the
// bottom (after the set block, before the sell price).
import { readFileSync } from 'node:fs';

describe('hud.itemTooltip composition order (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
  const badges = hud.indexOf('instanceBadgeLines(instance)');
  const bonus = hud.indexOf('instanceBonusStatLines(instance)');
  // The mark line takes the def's kind too: the gathered-vs-crafted
  // wording split resolves from item.kind at the one composition site.
  const mark = hud.indexOf('instanceMakersMarkLine(instance, item.kind)');
  const soulbound = hud.indexOf("t('hudChrome.itemSoulbound')");
  const setBlock = hud.indexOf('this.itemSetBlock(item)');

  it('composes all three instance line sets exactly once each', () => {
    expect(badges).toBeGreaterThan(-1);
    expect(bonus).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(hud.indexOf('instanceBadgeLines(instance)', badges + 1)).toBe(-1);
    expect(hud.indexOf('instanceBonusStatLines(instance)', bonus + 1)).toBe(-1);
    expect(hud.indexOf('instanceMakersMarkLine(', mark + 1)).toBe(-1);
  });

  it('orders them badge lines, then bonus stats, then the makers mark', () => {
    expect(soulbound).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(soulbound);
    expect(bonus).toBeGreaterThan(badges);
    expect(mark).toBeGreaterThan(bonus);
    expect(mark).toBeGreaterThan(setBlock);
  });

  it('sizes the authored marks at their manifest live sizes and follows tooltip scaling', () => {
    expect(hudCss).toMatch(
      /#tooltip \.tt-masterwork-seal-icon[\s\S]*?width: calc\(20px \* var\(--tooltip-scale, 1\)\)/,
    );
    expect(hudCss).toMatch(
      /#tooltip \.tt-makers-mark-icon[\s\S]*?width: calc\(16px \* var\(--tooltip-scale, 1\)\)/,
    );
  });
});
