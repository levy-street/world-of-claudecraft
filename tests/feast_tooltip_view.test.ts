// Shared-feast item tooltip lines: the pure string-builder composed inside
// Hud.itemTooltip beside the well-fed line (the wellfed_tooltip_view.test.ts
// idiom). English copy asserted directly; every number must mirror the live
// records (the def's own feast record for servings and duration, the
// pointed-at dish's wellFed record for the buff, CONSUME_DURATION for the
// meal length), never re-typed copy, and the buff line must state the
// finish-the-meal trigger, because the buff lands only when the 18s
// sit-restore COMPLETES (an interrupted meal forfeits it), the
// important-trigger rule of docs/design/tooltip-writing.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { FoodItemDef, ItemDef, OtherItemDef } from '../src/sim/types';
import { feastTooltipLines } from '../src/ui/feast_tooltip_view';
import {
  ensureLocaleLoaded,
  formatNumber,
  type SupportedLanguage,
  setLanguage,
} from '../src/ui/i18n';
import { stripComments } from './helpers/strip_comments';

// A synthetic feast whose dish is injectable: the dish-resolution branches
// (no wellFed record, an unmapped buff kind, an escaping-hostile aura name)
// are each pinned off-data, since the one shipped feast points at a
// small-number buff_sta dish and exercises exactly one branch.
function feastDef(record: NonNullable<OtherItemDef['feast']>): ItemDef {
  return { ...(ITEMS.harvest_feast as OtherItemDef), feast: record };
}
function dishDef(wellFed: NonNullable<FoodItemDef['wellFed']> | undefined): ItemDef {
  return { ...(ITEMS.evergarden_braised_greens as FoodItemDef), id: 'probe_dish', wellFed };
}

describe('feastTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('the harvest feast states placement, servings, duration, buff, and the meal trigger', () => {
    expect(feastTooltipLines(ITEMS.harvest_feast)).toBe(
      '<div class="tt-desc">Use: Sets out a feast others can eat from, one serving each ' +
        '(10 servings, lasts 3 min).</div>' +
        '<div class="tt-desc">Each serving grants Well Fed: +5 Stamina for 10 min ' +
        'when you finish the 18 sec meal.</div>',
    );
  });

  it('every number is resolved from the live records, never re-typed copy', () => {
    // Move each record field and the rendered line must move with it: this
    // is the armed-vs-unarmed proof that the literals above are RESOLVED
    // (a hardcoded sentence would pass the literal pin and fail here).
    const html = feastTooltipLines(
      feastDef({
        charges: 1250,
        durationTicks: 5400 * 20,
        dishItemId: 'evergarden_braised_greens',
      }),
    );
    expect(html).toContain(
      `(${formatNumber(1250, { maximumFractionDigits: 0 })} servings, lasts ${formatNumber(
        (5400 * 20 * (1 / 20)) / 60,
        { maximumFractionDigits: 1 },
      )} min)`,
    );
    expect(html).toContain('(1,250 servings, lasts 90 min)');
    const retuned = feastTooltipLines(
      feastDef({ charges: 10, durationTicks: 3600, dishItemId: 'probe_dish' }),
      { probe_dish: dishDef({ aura: 'Well Fed', kind: 'buff_sta', value: 24, duration: 450 }) },
    );
    expect(retuned).toContain('+24 Stamina for 7.5 min');
  });

  it('a dish without a wellFed record leaves only the placement line', () => {
    // Positive control first: the live dish DOES add a buff line, so the
    // absence below is the branch, not a vacuous always-one-line builder.
    expect(feastTooltipLines(ITEMS.harvest_feast)).toContain('Each serving grants');
    const html = feastTooltipLines(
      feastDef({ charges: 10, durationTicks: 3600, dishItemId: 'probe_dish' }),
      { probe_dish: dishDef(undefined) },
    );
    expect(html).toBe(
      '<div class="tt-desc">Use: Sets out a feast others can eat from, one serving each ' +
        '(10 servings, lasts 3 min).</div>',
    );
    expect(html).not.toContain('Each serving grants');
  });

  it('an unmapped buff kind falls back to naming the granted aura with the trigger', () => {
    const html = feastTooltipLines(
      feastDef({ charges: 10, durationTicks: 3600, dishItemId: 'probe_dish' }),
      {
        probe_dish: dishDef({ aura: 'Well Fed', kind: 'buff_spellpower', value: 5, duration: 300 }),
      },
    );
    expect(html).toContain(
      '<div class="tt-desc">Each serving grants Well Fed for 5 min ' +
        'when you finish the 18 sec meal.</div>',
    );
    // The mapped branch names the stat; the fallback never does.
    expect(html).not.toContain('Stamina');
  });

  it('escapes the interpolated aura name', () => {
    const html = feastTooltipLines(
      feastDef({ charges: 10, durationTicks: 3600, dishItemId: 'probe_dish' }),
      {
        probe_dish: dishDef({
          aura: "Grandmother's Cooking",
          kind: 'buff_spellpower',
          value: 5,
          duration: 300,
        }),
      },
    );
    expect(html).toContain('Grandmother&#39;s Cooking');
  });

  it('renders nothing for items without a feast record', () => {
    expect(feastTooltipLines(ITEMS.evergarden_braised_greens)).toBe('');
    expect(feastTooltipLines(ITEMS.roasted_boar)).toBe('');
    expect(feastTooltipLines(ITEMS.elixir_of_the_boar)).toBe('');
  });

  it('Hud.itemTooltip composes the feast lines (method-scoped source pin)', () => {
    // The shared order-safe stripper (tests/helpers/strip_comments.ts), and
    // the itemTooltip method slice, both the wellfed pin's reasoning: a
    // commented-out or relocated composition must not pass.
    const hudSrc = stripComments(readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8'));
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(hudSrc.slice(start, end)).toContain('html += feastTooltipLines(item);');
  });
});

describe('the five non-Latin fills render end to end (frozen literals, the M16 staleness pin)', () => {
  afterEach(() => setLanguage('en'));

  // Frozen renders of the three new catalog keys through the REAL sink
  // (locale chunk awaited first, then t() + the AURA_NAME_KEY matcher for
  // the buff term): a stale or clobbered fill, a broken interpolation, or a
  // lost matcher row reds the exact literal. A reviewed reword of a fill
  // re-points its row here deliberately, the localization_fixes idiom.
  // MAPPED drives the live item (useFeast + useFeastBuff); FALLBACK drives
  // the aura-only sentence (useFeastBuffAura) through an off-map probe dish.
  const MAPPED: [SupportedLanguage, string][] = [
    [
      'zh_CN',
      '<div class="tt-desc">使用：摆出一桌他人也能享用的盛宴，每人限享一份（10 份，持续 3 分钟）。</div>' +
        '<div class="tt-desc">每份：吃完 18 秒的一餐后获得精神饱满效果，使你的耐力提高 5 点，持续 10 分钟。</div>',
    ],
    [
      'zh_TW',
      '<div class="tt-desc">使用：擺出一桌他人也能享用的盛宴，每人限享一份（10 份，持續 3 分鐘）。</div>' +
        '<div class="tt-desc">每份：吃完 18 秒的一餐後獲得精神飽滿效果，使你的耐力提高 5 點，持續 10 分鐘。</div>',
    ],
    [
      'ja_JP',
      '<div class="tt-desc">使用: 他のプレイヤーも食べられる宴を広げる。1人1食まで（10人前、3分間持続）。</div>' +
        '<div class="tt-desc">1人前につき、18秒の食事を終えると満腹の効果を得て、スタミナが5上昇し、10分間持続します。</div>',
    ],
    [
      'ko_KR',
      '<div class="tt-desc">사용: 다른 플레이어도 먹을 수 있는 잔치를 차립니다. 1인당 1인분입니다(10인분, 3분간 지속).</div>' +
        '<div class="tt-desc">한 접시를 18초 동안 다 먹으면 잘 먹음 효과를 얻어 체력이(가) 5 증가하며 10분 동안 지속됩니다.</div>',
    ],
    [
      'ru_RU',
      '<div class="tt-desc">Использование: накрывает пир, с которого могут поесть и другие, ' +
        'по одной порции каждому (10 порций, действует 3 мин).</div>' +
        '<div class="tt-desc">Каждая порция дает эффект &quot;Сытость&quot;: Выносливость +5 ' +
        'на 10 мин после 18 сек еды.</div>',
    ],
  ];
  const FALLBACK: [SupportedLanguage, string][] = [
    ['zh_CN', '<div class="tt-desc">每份：吃完 18 秒的一餐后获得精神饱满效果，持续 5 分钟。</div>'],
    ['zh_TW', '<div class="tt-desc">每份：吃完 18 秒的一餐後獲得精神飽滿效果，持續 5 分鐘。</div>'],
    [
      'ja_JP',
      '<div class="tt-desc">1人前につき、18秒の食事を終えると満腹の効果を得て、5分間持続します。</div>',
    ],
    [
      'ko_KR',
      '<div class="tt-desc">한 접시를 18초 동안 다 먹으면 잘 먹음 효과를 얻어 5분 동안 지속됩니다.</div>',
    ],
    [
      'ru_RU',
      '<div class="tt-desc">Каждая порция дает эффект &quot;Сытость&quot; на 5 мин после 18 сек еды.</div>',
    ],
  ];

  it.each(MAPPED)('%s: the useFeast and useFeastBuff sentences', async (loc, want) => {
    await ensureLocaleLoaded(loc);
    setLanguage(loc);
    expect(feastTooltipLines(ITEMS.harvest_feast)).toBe(want);
  });

  it.each(FALLBACK)('%s: the useFeastBuffAura sentence', async (loc, want) => {
    await ensureLocaleLoaded(loc);
    setLanguage(loc);
    const html = feastTooltipLines(
      feastDef({ charges: 10, durationTicks: 3600, dishItemId: 'probe_dish' }),
      {
        probe_dish: dishDef({ aura: 'Well Fed', kind: 'buff_spellpower', value: 5, duration: 300 }),
      },
    );
    expect(html.slice(html.indexOf('</div>') + '</div>'.length)).toBe(want);
  });
});
