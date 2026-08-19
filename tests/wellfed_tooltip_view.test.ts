// Well-fed buff-dish tooltip line: the pure string-builder composed inside
// Hud.itemTooltip (the elixir_tooltip_view.test.ts idiom). English copy
// asserted directly; the numbers must mirror each def's own wellfed record,
// never re-invented copy, and every line must state the finish-eating
// trigger, because the buff lands only when the 18s sit-restore COMPLETES
// (an interrupted meal forfeits it), which is exactly the important-trigger
// rule of docs/design/tooltip-writing.md. Also guards the data side: a buff
// dish without a wellfed record would render no well-fed line at all, the
// silent-tooltip bug class the elixir view fixed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { AuraKind, ItemDef } from '../src/sim/types';
import { elixirTooltipLines } from '../src/ui/elixir_tooltip_view';
import { ensureLocaleLoaded, formatNumber, setLanguage } from '../src/ui/i18n';
import { wellfedTooltipLines } from '../src/ui/wellfed_tooltip_view';
import { stripComments } from './helpers/strip_comments';

// Synthetic wellfed variants: one def spread with a replaced record, so the
// mapped-stat rows, the formatter options, and the escaping are each pinned
// off-data (every shipped buff dish is a small-number buff_sta, which
// exercises exactly one map row and no grouping, rounding, or escaping).
function wellfedDef(record: NonNullable<ItemDef['wellfed']>): ItemDef {
  return { ...ITEMS.eastbrook_glazed_carrots, wellfed: record };
}

describe('wellfedTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('glazed carrots state the buff, duration, and the finish-eating trigger', () => {
    expect(wellfedTooltipLines(ITEMS.eastbrook_glazed_carrots)).toBe(
      '<div class="tt-desc">Well Fed: +3 Stamina for 10 min, granted when you finish eating.</div>',
    );
  });

  it('every buff dish in the game data renders a line carrying its own numbers', () => {
    const dishes = Object.values(ITEMS).filter(
      (def): def is ItemDef & { wellfed: NonNullable<ItemDef['wellfed']> } =>
        def.wellfed !== undefined,
    );
    // carrots, pudding, porridge, greens: one buff dish per crop tier.
    expect(dishes.length).toBeGreaterThanOrEqual(4);
    for (const def of dishes) {
      const html = wellfedTooltipLines(def);
      expect(html, `${def.id} must render a well-fed line`).toContain('Well Fed');
      // Expected fragments built with the same formatter the view uses; the
      // formatter OPTIONS themselves are pinned off-data below.
      expect(html).toContain(`+${formatNumber(def.wellfed.value, { maximumFractionDigits: 0 })} `);
      expect(html).toContain(
        `for ${formatNumber(def.wellfed.duration / 60, { maximumFractionDigits: 1 })} min`,
      );
      // The completion trigger is load-bearing copy: the buff is granted at
      // the END of the sit-restore, never on the first bite.
      expect(html).toContain('when you finish eating');
    }
  });

  it('pins the formatter options off-data: grouped value, fractional minutes', () => {
    const html = wellfedTooltipLines(
      wellfedDef({ aura: 'Probe', kind: 'buff_sta', value: 1234, duration: 450 }),
    );
    expect(html).toBe(
      '<div class="tt-desc">Probe: +1,234 Stamina for 7.5 min, granted when you finish eating.</div>',
    );
  });

  it('maps every stat-buff kind to its own stat label', () => {
    const cases: Array<[NonNullable<ItemDef['wellfed']>['kind'], string]> = [
      ['buff_int', 'Intellect'],
      ['buff_agi', 'Agility'],
      ['buff_armor', 'Armor'],
      ['buff_ap', 'Attack Power'],
    ];
    for (const [kind, label] of cases) {
      const html = wellfedTooltipLines(
        wellfedDef({ aura: 'Probe', kind, value: 8, duration: 600 }),
      );
      expect(html, `${kind} must read as ${label}`).toContain(`+8 ${label} for 10 min`);
    }
  });

  it('renders nothing for items without a wellfed record', () => {
    expect(wellfedTooltipLines(ITEMS.roasted_boar)).toBe('');
    expect(wellfedTooltipLines(ITEMS.vale_hearth_loaf)).toBe('');
    expect(wellfedTooltipLines(ITEMS.elixir_of_the_boar)).toBe('');
  });

  it('an unmapped buff kind falls back to naming the granted aura with the trigger', () => {
    const def = wellfedDef({
      aura: 'Well Fed',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellfedTooltipLines(def)).toBe(
      '<div class="tt-desc">Grants Well Fed for 5 min when you finish eating.</div>',
    );
  });

  it('the aura fallback localizes through the buff-bar matcher', () => {
    // Only the aura fragment is pinned: the surrounding sentence is a new
    // catalog key, English-pending in de_DE until the release fill, while
    // the aura name rides the AURA_NAME_KEY matcher (the elixir fixture,
    // whose de_DE row predates this suite).
    const def = wellfedDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    setLanguage('de_DE');
    expect(wellfedTooltipLines(def)).toContain('Macht des Ebers');
  });

  it('escapes the interpolated aura name', () => {
    const def = wellfedDef({
      aura: "Grandmother's Cooking",
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellfedTooltipLines(def)).toContain('Grandmother&#39;s Cooking');
  });

  it('Hud.itemTooltip composes the well-fed line (method-scoped source pin)', () => {
    // Comments are stripped through the SHARED order-safe stripper (both
    // line and block classes in one pass, tests/helpers/strip_comments.ts),
    // so neither prose form can satisfy the pin: the original line-only
    // strip left a block-commented `html += wellfedTooltipLines(item);`
    // able to pass. Scoped to the itemTooltip method body so the call
    // cannot drift into some other surface and still pass.
    const hudSrc = stripComments(readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8'));
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(hudSrc.slice(start, end)).toContain('html += wellfedTooltipLines(item);');
  });
});

describe('the wellfed and elixir stat maps stay in step', () => {
  // The two sibling views deliberately keep separate 5-row stat maps (two
  // copies sits below the extraction rule of three); this pin is what makes
  // a one-sided edit (adding a stat kind to one map only) FAIL instead of
  // silently rendering the aura fallback in the other view. The key sets
  // are extracted from both sources (const-name anchored, sliced to the
  // map's closing brace, comments stripped), compared for equality, and
  // then every extracted kind is driven through BOTH views to prove it
  // really takes the mapped branch (the fallback sentence says 'Grants',
  // the mapped one never does; the off-map probe below proves that
  // discriminator is live in both views).
  function readMapKeys(file: string, constName: string): string[] {
    const src = stripComments(readFileSync(path.join(__dirname, file), 'utf8'));
    const start = src.indexOf(`const ${constName}`);
    expect(start, `${constName} found in ${file}`).toBeGreaterThan(-1);
    const end = src.indexOf('};', start);
    expect(end).toBeGreaterThan(start);
    return [...src.slice(start, end).matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  }

  it('identical key sets, every key mapped in both views, off-map falls back in both', () => {
    const wellfedKeys = readMapKeys('../src/ui/wellfed_tooltip_view.ts', 'WELLFED_STAT_KEYS');
    const elixirKeys = readMapKeys('../src/ui/elixir_tooltip_view.ts', 'ELIXIR_STAT_KEYS');
    expect(wellfedKeys).toEqual(elixirKeys);
    expect(wellfedKeys.length).toBeGreaterThanOrEqual(5);
    for (const kind of wellfedKeys) {
      const record = { aura: 'Probe', kind: kind as AuraKind, value: 5, duration: 300 };
      expect(wellfedTooltipLines(wellfedDef(record)), `wellfed maps ${kind}`).not.toContain(
        'Grants',
      );
      expect(
        elixirTooltipLines({ ...ITEMS.eastbrook_glazed_carrots, elixir: record }),
        `elixir maps ${kind}`,
      ).not.toContain('Grants');
    }
    const offMap = { aura: 'Probe', kind: 'buff_spellpower' as AuraKind, value: 5, duration: 300 };
    expect(wellfedTooltipLines(wellfedDef(offMap))).toContain('Grants');
    expect(elixirTooltipLines({ ...ITEMS.eastbrook_glazed_carrots, elixir: offMap })).toContain(
      'Grants',
    );
  });
});

describe('the five non-Latin fills render end to end (frozen literals, the M16 staleness pin)', () => {
  // Frozen renders of the two new catalog keys through the REAL sink
  // (locale chunk awaited first, the app's own order, then t() + the
  // AURA_NAME_KEY matcher): a stale or clobbered fill, a broken {aura}
  // interpolation, or a lost matcher row reds the exact literal. A reviewed
  // reword of a fill re-points its row here deliberately, the
  // localization_fixes idiom.
  const MAPPED: [string, string][] = [
    ['zh_CN', '<div class="tt-desc">吃完后获得饱足效果，使你的耐力提高 3 点，持续 10 分钟。</div>'],
    ['zh_TW', '<div class="tt-desc">吃完後獲得飽足效果，使你的耐力提高 3 點，持續 10 分鐘。</div>'],
    [
      'ko_KR',
      '<div class="tt-desc">다 먹으면 포만감 효과를 얻어 체력이(가) 3 증가하며 10분 동안 지속됩니다.</div>',
    ],
    [
      'ja_JP',
      '<div class="tt-desc">食べ終えると満腹の効果を得て、スタミナが3上昇し、10分間持続します。</div>',
    ],
    [
      'ru_RU',
      '<div class="tt-desc">Эффект &quot;Сытость&quot;: Выносливость +3 на 10 мин. Дается, когда вы доедаете.</div>',
    ],
  ];
  const FALLBACK: [string, string][] = [
    ['zh_CN', '<div class="tt-desc">吃完后获得饱足效果，持续 5 分钟。</div>'],
    ['zh_TW', '<div class="tt-desc">吃完後獲得飽足效果，持續 5 分鐘。</div>'],
    ['ko_KR', '<div class="tt-desc">다 먹으면 포만감 효과를 얻어 5분 동안 지속됩니다.</div>'],
    ['ja_JP', '<div class="tt-desc">食べ終えると満腹の効果を得て、5分間持続します。</div>'],
    [
      'ru_RU',
      '<div class="tt-desc">Дает эффект &quot;Сытость&quot; на 5 мин, когда вы доедаете.</div>',
    ],
  ];

  it.each(MAPPED)('%s: the useWellfed sentence and interpolated aura name', async (loc, want) => {
    await ensureLocaleLoaded(loc as never);
    setLanguage(loc as never);
    expect(wellfedTooltipLines(ITEMS.eastbrook_glazed_carrots)).toBe(want);
  });

  it.each(FALLBACK)('%s: the useWellfedAura sentence', async (loc, want) => {
    await ensureLocaleLoaded(loc as never);
    setLanguage(loc as never);
    expect(
      wellfedTooltipLines(
        wellfedDef({
          aura: 'Well Fed',
          kind: 'buff_spellpower' as AuraKind,
          value: 5,
          duration: 300,
        }),
      ),
    ).toBe(want);
  });
});
