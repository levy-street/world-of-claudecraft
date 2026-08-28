// The one Well Fed tooltip line (unified in Masterwrought 11c): the pure
// string-builder composed inside Hud.itemTooltip (the
// elixir_tooltip_view.test.ts idiom). English copy asserted directly; the
// numbers must mirror each def's own wellFed record, never re-invented copy,
// and every line must state BOTH load-bearing clauses of the surviving key
// pair (ruling 11c-A4-KEYPAIR): the finish-eating trigger, because the buff
// lands only when the 18s sit-restore COMPLETES, and the one-at-a-time rule,
// because the whole food family shares one 'well_fed' aura id. Also guards
// the data side: a buff food without a wellFed record would render no
// well-fed line at all, the silent-tooltip bug class the elixir view fixed,
// and the hud composes exactly ONE well-fed line per tooltip (the 11b merge
// briefly wired two views over the same record).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { AuraKind, FoodItemDef, ItemDef } from '../src/sim/types';
import { elixirTooltipLines } from '../src/ui/hud/professions/elixir_tooltip_view';
import { wellFedTooltipLines } from '../src/ui/hud/professions/wellfed_tooltip_view';
import {
  ensureLocaleLoaded,
  formatNumber,
  type SupportedLanguage,
  setLanguage,
} from '../src/ui/i18n';
import { stripComments } from './helpers/strip_comments';

// Synthetic wellFed variants: one def spread with a replaced record, so the
// mapped-stat rows, the formatter options, and the escaping are each pinned
// off-data (every shipped farming dish is a small-number buff_sta, which
// exercises exactly one map row and no grouping, rounding, or escaping).
function wellFedDef(record: NonNullable<FoodItemDef['wellFed']>): ItemDef {
  return { ...(ITEMS.eastbrook_glazed_carrots as FoodItemDef), wellFed: record };
}

describe('wellFedTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('glazed carrots state the buff, the trigger, and the one-at-a-time rule', () => {
    expect(wellFedTooltipLines(ITEMS.eastbrook_glazed_carrots)).toBe(
      '<div class="tt-desc">Well Fed: Increases your Stamina by 2 for 10 min once you finish ' +
        'eating. Only one Well Fed effect at a time: a newer meal replaces it.</div>',
    );
  });

  it('an apex role plate states the dominant rung: value 6 for 15 min', () => {
    // The 11c ladder's apex row (6 / 900): the duration is the elixir
    // ladder's next step above the entry rung, so the plate strictly
    // dominates every farming dish on both axes and the tooltip says so in
    // resolved numbers.
    expect(wellFedTooltipLines(ITEMS.stonepot_stew)).toBe(
      '<div class="tt-desc">Well Fed: Increases your Stamina by 6 for 15 min once you finish ' +
        'eating. Only one Well Fed effect at a time: a newer meal replaces it.</div>',
    );
  });

  it('every buff food in the game data renders one line carrying its own numbers', () => {
    const foods = Object.values(ITEMS).filter(
      (def): def is FoodItemDef & { wellFed: NonNullable<FoodItemDef['wellFed']> } =>
        def.kind === 'food' && def.wellFed !== undefined,
    );
    // The whole unified family: four farm dishes plus three apex role plates.
    expect(foods.length).toBeGreaterThanOrEqual(7);
    for (const def of foods) {
      const html = wellFedTooltipLines(def);
      expect(html, `${def.id} must render a well-fed line`).toContain('Well Fed');
      // EXACTLY ONE line from the VIEW per food. The hud-composition half of
      // the two-views hazard (a second wired call) is pinned by the
      // method-scoped source pin below and by the composed-output arm in
      // tests/wellfed_tooltip_composition.test.ts, since this view-level
      // count cannot see a second call site.
      expect(html.split('<div class="tt-desc">').length - 1, `${def.id} renders one line`).toBe(1);
      // Expected fragments built with the same formatter the view uses; the
      // formatter OPTIONS themselves are pinned off-data below.
      expect(html).toContain(
        `by ${formatNumber(def.wellFed.value, { maximumFractionDigits: 0 })} `,
      );
      expect(html).toContain(
        `for ${formatNumber(def.wellFed.duration / 60, { maximumFractionDigits: 1 })} min`,
      );
      // Both clauses are load-bearing copy: the buff is granted at the END
      // of the sit-restore, and the family is one-at-a-time under one id.
      expect(html).toContain('once you finish eating');
      expect(html).toContain('Only one Well Fed effect at a time');
    }
  });

  it('pins the formatter options off-data: grouped value, fractional minutes', () => {
    const html = wellFedTooltipLines(
      wellFedDef({ aura: 'Probe', kind: 'buff_sta', value: 1234, duration: 450 }),
    );
    expect(html).toBe(
      '<div class="tt-desc">Well Fed: Increases your Stamina by 1,234 for 7.5 min once you ' +
        'finish eating. Only one Well Fed effect at a time: a newer meal replaces it.</div>',
    );
  });

  it('maps every stat-buff kind to its own stat label', () => {
    const cases: Array<[NonNullable<FoodItemDef['wellFed']>['kind'], string]> = [
      ['buff_int', 'Intellect'],
      ['buff_agi', 'Agility'],
      ['buff_armor', 'Armor'],
      ['buff_ap', 'Attack Power'],
    ];
    for (const [kind, label] of cases) {
      const html = wellFedTooltipLines(
        wellFedDef({ aura: 'Probe', kind, value: 8, duration: 600 }),
      );
      expect(html, `${kind} must read as ${label}`).toContain(`your ${label} by 8 for 10 min`);
    }
  });

  it('renders nothing for items without a wellFed record, or for any non-food kind', () => {
    expect(wellFedTooltipLines(ITEMS.roasted_boar)).toBe('');
    expect(wellFedTooltipLines(ITEMS.vale_hearth_loaf)).toBe('');
    // The sibling payload families never answer for this view: elixir,
    // flask (elixir payload plus the flask marker), scroll, potion, drink.
    expect(wellFedTooltipLines(ITEMS.elixir_of_the_boar)).toBe('');
    expect(wellFedTooltipLines(ITEMS.ironhusk_flask)).toBe('');
    expect(wellFedTooltipLines(ITEMS.silverleaf_scroll)).toBe('');
    expect(wellFedTooltipLines(ITEMS.healing_potion)).toBe('');
    expect(wellFedTooltipLines(ITEMS.spring_water)).toBe('');
    // The KIND gate itself, which the shipped catalog can no longer reach
    // (only FoodItemDef can spell the field): a drink-shaped record that
    // smuggles a payload past the type still renders nothing.
    const smuggled = {
      id: 'probe_drink',
      name: 'Probe Drink',
      kind: 'drink',
      sellValue: 1,
      drinkMana: 10,
      wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 5, duration: 600 },
    } as unknown as ItemDef;
    expect(wellFedTooltipLines(smuggled)).toBe('');
  });

  it('an unmapped buff kind falls back to naming the granted aura with both clauses', () => {
    const def = wellFedDef({
      aura: 'Well Fed',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellFedTooltipLines(def)).toBe(
      '<div class="tt-desc">Well Fed: Grants Well Fed for 5 min once you finish eating. ' +
        'Only one Well Fed effect at a time: a newer meal replaces it.</div>',
    );
  });

  it('the aura fallback localizes through the buff-bar matcher', () => {
    // Only the aura fragment is pinned: the aura name rides the
    // AURA_NAME_KEY matcher (the elixir fixture, whose de_DE row predates
    // this suite), whatever the surrounding sentence's fill state.
    const def = wellFedDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    setLanguage('de_DE');
    expect(wellFedTooltipLines(def)).toContain('Macht des Ebers');
  });

  it('escapes the interpolated aura name', () => {
    const def = wellFedDef({
      aura: "Grandmother's Cooking",
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellFedTooltipLines(def)).toContain('Grandmother&#39;s Cooking');
  });

  it('Hud.itemTooltip composes EXACTLY ONE well-fed line (method-scoped source pin)', () => {
    // Comments are stripped through the SHARED order-safe stripper (both
    // line and block classes in one pass, tests/helpers/strip_comments.ts),
    // so neither prose form can satisfy the pin. Scoped to the itemTooltip
    // method body so the call cannot drift into some other surface and
    // still pass. The exact-count arm is the unification's own hazard: the
    // 11b merge left BOTH packets' views wired at different lines, silent
    // under tsc, and the moment the field unified every buff dish would
    // have rendered the sentence twice in two wordings.
    const hudSrc = stripComments(readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8'));
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSrc.slice(start, end);
    expect(body).toContain('html += wellFedTooltipLines(item);');
    // Any composition call whose builder name says well-fed, in either
    // retired or surviving spelling, counted case-insensitively and with ANY
    // argument list (a re-wiring that passes a second argument still
    // counts): one.
    const wellFedCalls = body.match(/html \+= well[Ff]ed\w*\(/g) ?? [];
    expect(wellFedCalls, 'exactly one well-fed composition call').toHaveLength(1);
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
    // WELLFED_STAT_KEYS lives in its own pure leaf (Phase 14, C10: the
    // wiki's effect prose consumes it too and the guide bundle may not
    // reach this view's sim_i18n graph); the source read follows it there.
    const wellfedKeys = readMapKeys(
      '../src/ui/hud/professions/wellfed_stat_keys.ts',
      'WELLFED_STAT_KEYS',
    );
    const elixirKeys = readMapKeys(
      '../src/ui/hud/professions/elixir_tooltip_view.ts',
      'ELIXIR_STAT_KEYS',
    );
    expect(wellfedKeys).toEqual(elixirKeys);
    expect(wellfedKeys.length).toBeGreaterThanOrEqual(5);
    for (const kind of wellfedKeys) {
      const record = { aura: 'Probe', kind: kind as AuraKind, value: 5, duration: 300 };
      expect(wellFedTooltipLines(wellFedDef(record)), `wellfed maps ${kind}`).not.toContain(
        'Grants',
      );
      expect(
        // A deliberately synthetic food-plus-elixir probe (FoodItemDef bars
        // `elixir` since the 11b union port, so the hybrid needs the cast);
        // the view under test only reads the elixir payload.
        elixirTooltipLines({
          ...ITEMS.eastbrook_glazed_carrots,
          elixir: record,
        } as unknown as ItemDef),
        `elixir maps ${kind}`,
      ).not.toContain('Grants');
    }
    const offMap = { aura: 'Probe', kind: 'buff_spellpower' as AuraKind, value: 5, duration: 300 };
    expect(wellFedTooltipLines(wellFedDef(offMap))).toContain('Grants');
    expect(
      elixirTooltipLines({
        ...ITEMS.eastbrook_glazed_carrots,
        elixir: offMap,
      } as unknown as ItemDef),
    ).toContain('Grants');
  });
});

describe('the five non-Latin fills render end to end (frozen literals, the M16 staleness pin)', () => {
  afterEach(() => setLanguage('en'));

  // Frozen renders of the SURVIVING key pair through the REAL sink (locale
  // chunk awaited first, the app's own order, then t() + the AURA_NAME_KEY
  // matcher): a stale or clobbered fill, a broken {aura} interpolation, or a
  // lost matcher row reds the exact literal. A reviewed reword of a fill
  // re-points its row here deliberately, the localization_fixes idiom. The
  // mapped sentence carries NO aura token (the surviving key's placeholder
  // set is {stat}/{value}/{minutes}); the aura interpolates only in the
  // fallback, where the matcher serves the kept aura.wellFed terms.
  const MAPPED: [SupportedLanguage, string][] = [
    [
      'zh_CN',
      '<div class="tt-desc">精神饱满：吃完后使你的耐力提高 2 点，持续 10 分钟。同时只能有一种精神饱满效果：更新的一餐会顶替它。</div>',
    ],
    [
      'zh_TW',
      '<div class="tt-desc">精神飽滿：吃完後使你的耐力提高 2 點，持續 10 分鐘。同時只能有一種精神飽滿效果：較新的餐點會頂替它。</div>',
    ],
    [
      'ko_KR',
      '<div class="tt-desc">잘 먹음: 식사를 마치면 체력이(가) 2 증가하며 10분 동안 지속됩니다. 잘 먹음 효과는 한 번에 하나만 유지되며, 새로 먹은 음식이 이전 효과를 대체합니다.</div>',
    ],
    [
      'ja_JP',
      '<div class="tt-desc">満腹：食べ終えるとスタミナが 2 上昇し、10 分間持続します。満腹の効果は同時に一つだけで、新しい食事が古いものを置き換えます。</div>',
    ],
    [
      'ru_RU',
      '<div class="tt-desc">Сытость: по окончании трапезы повышает Выносливость на 2 в течение 10 мин. Одновременно действует только один эффект сытости: более свежая трапеза заменяет прежний.</div>',
    ],
  ];
  const FALLBACK: [SupportedLanguage, string][] = [
    [
      'zh_CN',
      '<div class="tt-desc">精神饱满：吃完后获得精神饱满效果，持续 5 分钟。同时只能有一种精神饱满效果：更新的一餐会顶替它。</div>',
    ],
    [
      'zh_TW',
      '<div class="tt-desc">精神飽滿：吃完後獲得精神飽滿效果，持續 5 分鐘。同時只能有一種精神飽滿效果：較新的餐點會頂替它。</div>',
    ],
    [
      'ko_KR',
      '<div class="tt-desc">잘 먹음: 식사를 마치면 잘 먹음 효과를 얻어 5분 동안 지속됩니다. 잘 먹음 효과는 한 번에 하나만 유지되며, 새로 먹은 음식이 이전 효과를 대체합니다.</div>',
    ],
    [
      'ja_JP',
      '<div class="tt-desc">満腹：食べ終えると満腹を得て、5 分間持続します。満腹の効果は同時に一つだけで、新しい食事が古いものを置き換えます。</div>',
    ],
    [
      'ru_RU',
      '<div class="tt-desc">Сытость: по окончании трапезы дает эффект &quot;Сытость&quot; на 5 мин. Одновременно действует только один эффект сытости: более свежая трапеза заменяет прежний.</div>',
    ],
  ];

  it.each(MAPPED)('%s: the wellFed sentence with the dish numbers', async (loc, want) => {
    await ensureLocaleLoaded(loc);
    setLanguage(loc);
    expect(wellFedTooltipLines(ITEMS.eastbrook_glazed_carrots)).toBe(want);
  });

  it.each(FALLBACK)(
    '%s: the wellFedAura sentence and interpolated aura name',
    async (loc, want) => {
      await ensureLocaleLoaded(loc);
      setLanguage(loc);
      expect(
        wellFedTooltipLines(
          wellFedDef({
            aura: 'Well Fed',
            kind: 'buff_spellpower' as AuraKind,
            value: 5,
            duration: 300,
          }),
        ),
      ).toBe(want);
    },
  );
});
