// @vitest-environment happy-dom

// The Adventure Journal's page furniture (src/ui/hud/journal/journal_banner_view.ts
// and its markup in journal_page_html.ts): the phase pills, the fact chips an
// opened ability prints, the list's status line, and the Smith's Heart's new
// banner content (the one-line summary and stat chips), resolved per tier
// from the encounters' own tuning.

import { describe, expect, it, vi } from 'vitest';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { ISLE_TUNING } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { COUNCIL_GUARDIAN, COUNCIL_TUNING } from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_PHASES } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_GUARDIAN, HEAT_TUNING } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_TUNING } from '../src/sim/encounters/smith_heart/quench_ids';
import {
  englishTemplate,
  journalMechanicFacts,
  journalNavStatus,
  journalRangeLabel,
} from '../src/ui/hud/journal/journal_banner_view';
import { JOURNAL_INSTANCES, journalInstance } from '../src/ui/hud/journal/journal_catalog';
import {
  bannerHtml,
  boldValuesHtml,
  factsHtml,
  pageValues,
  phaseRangeText,
} from '../src/ui/hud/journal/journal_page_html';
import { type TranslationKey, t } from '../src/ui/i18n';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (_kind: string, id: string) => `mock:${id}`,
}));

const heart = () => journalInstance(SMITH_HEART_DUNGEON)!;
const text = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.textContent ?? '';
};

describe('journal banner core', () => {
  it('shapes a phase pill from the health a phase covers', () => {
    expect(journalRangeLabel(undefined)).toBeNull();
    expect(journalRangeLabel('whole')).toEqual({ kind: 'whole' });
    expect(journalRangeLabel({ from: 1, to: 0.7 })).toEqual({ kind: 'band', from: 1, to: 0.7 });
    expect(journalRangeLabel({ from: 0.4, to: 0 })).toEqual({ kind: 'toEnd', from: 0.4 });
    expect(journalRangeLabel({ at: [0.7, 0.4] })).toEqual({ kind: 'at', at: [0.7, 0.4] });
    expect(journalRangeLabel({ at: [] })).toBeNull();
  });

  it('reads damage and timer facts off the English template, never a swing count', () => {
    const values = { min: 10, max: 20, every: 8 };
    expect(journalMechanicFacts('Every {every} sec, {min} to {max} Fire damage.', values)).toEqual({
      damage: { min: 10, max: 20, school: 'fire' },
      every: 8,
    });
    expect(journalMechanicFacts('It deals {min} to {max} damage.', values).damage?.school).toBe(
      null,
    );
    // A per-second burn is not a hit, and a swing count is not a timer.
    expect(
      journalMechanicFacts('Every {every} swings, {min} to {max} damage a second.', values),
    ).toEqual({ damage: null, every: null });
    // The template names a value the tier did not resolve: no chip.
    expect(journalMechanicFacts('Every {every} sec.', { min: 1 })).toEqual({
      damage: null,
      every: null,
    });
    expect(journalMechanicFacts(null, values)).toEqual({ damage: null, every: null });
  });

  it('resolves a key to its English template', () => {
    expect(englishTemplate('hudChrome.adventureJournal.title')).toBe('Adventure Journal');
    expect(englishTemplate('hudChrome.adventureJournal')).toBeNull();
    expect(englishTemplate('no.such.key')).toBeNull();
  });

  it('says one thing under each boss in the list, the live state first', () => {
    const base = { engaged: false, defeated: false, next: false, rank: 'boss' as const };
    expect(journalNavStatus(base)).toBeNull();
    expect(journalNavStatus({ ...base, rank: 'final' })).toBe('final');
    expect(journalNavStatus({ ...base, rank: 'miniboss' })).toBe('miniboss');
    expect(journalNavStatus({ ...base, next: true, rank: 'final' })).toBe('next');
    expect(journalNavStatus({ ...base, defeated: true, next: true })).toBe('defeated');
    expect(journalNavStatus({ ...base, engaged: true, defeated: true })).toBe('engaged');
  });

  it('prints placeholder values bold and escapes every part', () => {
    expect(
      boldValuesHtml('bossJournal.smithHeart.heat.chipSinks' as TranslationKey, {
        one: '<70%>',
        two: '40%',
      }),
    ).toBe('Sinks at <b>&lt;70%&gt;</b> and <b>40%</b>');
    // A template's own digits and apostrophes (escaped to &#39;) stay text.
    expect(
      boldValuesHtml('bossJournal.smithHeart.heat.chipPhases' as TranslationKey, {
        phases: 3,
        overflows: "2'",
      }),
    ).toBe('<b>3</b> phases and <b>2&#39;</b> overflows');
    expect(
      boldValuesHtml(
        'hudChrome.adventureJournal.mobileCrumb' as TranslationKey,
        {
          group: 'Raids',
          instance: "The Smith's Heart",
        },
        ['group'],
      ),
    ).toBe('Raids / <b>The Smith&#39;s Heart</b>');
  });
});

describe("the Smith's Heart banner content", () => {
  const pages = () => heart().source.bossKeys.map((key) => heart().source.view(key, 'normal'));

  it('gives all five pages a one-line summary and stat chips that resolve cleanly', () => {
    expect(pages()).toHaveLength(5);
    for (const tier of ['normal', 'heroic'] as const) {
      for (const key of heart().source.bossKeys) {
        const view = heart().source.view(key, tier);
        expect(view.tagline, key).toBeTruthy();
        expect(view.chips?.length, key).toBeGreaterThanOrEqual(3);
        const lines = [view.tagline!, ...(view.chips ?? [])].map((entry) =>
          t(entry.key, pageValues(heart(), entry.values, entry.percentValues)),
        );
        for (const line of lines) {
          expect(line, key).not.toMatch(/[{}]|\.chip|\.tagline/);
          expect(line, key).not.toMatch(/[–—]/);
        }
      }
    }
  });

  it('adds the hard enrage chip on Heroic only, with its live minutes', () => {
    const enrage = 'bossJournal.smithHeart.common.chipEnrage';
    for (const key of heart().source.bossKeys) {
      expect(
        heart()
          .source.view(key, 'normal')
          .chips?.some((c) => c.key === enrage),
      ).toBe(false);
      const chip = heart()
        .source.view(key, 'heroic')
        .chips?.find((c) => c.key === enrage);
      expect(chip?.values?.minutes, key).toBeGreaterThan(0);
    }
  });

  it('reads every chip number from the fights tuning', () => {
    const chip = (boss: string, key: string) =>
      heart()
        .source.view(boss, 'normal')
        .chips?.find((c) => c.key === `bossJournal.smithHeart.${key}`);
    expect(chip(HEAT_GUARDIAN, 'heat.chipSinks')?.values).toEqual({
      one: HEAT_TUNING.overflowOneAt,
      two: HEAT_TUNING.overflowTwoAt,
    });
    expect(chip(COUNCIL_GUARDIAN, 'council.chipTogether')?.values).toEqual({
      arrive: COUNCIL_TUNING.furyArrive,
    });
    expect(chip('heart_breath_guardian', 'breath.chipIsles')?.values).toEqual({
      at: ISLE_TUNING.at,
    });
    expect(chip('heart_quench_guardian', 'quench.chipHuddle')?.values).toEqual({
      group: QUENCH_TUNING.warmNeed + 1,
    });
    expect(chip('heart_quench_guardian', 'quench.chipBlades')?.values).toEqual({
      at: QUENCH_TUNING.wakeAt,
    });
    expect(chip('heart_masterless_strength', 'final.chipSplinters')?.values).toEqual({
      first: FINAL_PHASES.intermissionAt[0],
      second: FINAL_PHASES.intermissionAt[1],
    });
    expect(chip('heart_masterless_strength', 'final.chipFinal')?.values).toEqual({
      final: FINAL_PHASES.finalAt,
    });
  });

  it("paints Ignazhar's banner the way the approved mockup reads", () => {
    const view = heart().source.view(HEAT_GUARDIAN, 'normal');
    const html = bannerHtml({
      instance: heart(),
      members: [HEAT_GUARDIAN],
      view,
      state: { defeated: false, engaged: false, tracked: false },
      index: 3,
      total: 5,
      tier: 'normal',
      modelButton: true,
    });
    const words = text(html);
    expect(words).toContain("The Smith's Heart, boss 4 of 5");
    expect(words).toContain('Sunk to its waist in the First Wellspring, it never moves');
    expect(words).toContain('Sinks at 70% and 40%');
    expect(words).toContain('Tank swap fight');
    expect(words).toContain('3 phases and 2 overflows');
    expect(words).toContain('Mythic: coming soon');
    expect(html).toContain('<b>70%</b>');
    expect(html).toContain('data-show-model');
  });

  it('shows no chips and the overview line for a page without banner content', () => {
    const dungeon = JOURNAL_INSTANCES.find((i) => i.kind === 'dungeon')!;
    const view = dungeon.source.view(dungeon.source.bossKeys[0], 'normal');
    expect(view.tagline).toBeUndefined();
    expect(view.chips).toBeUndefined();
    const html = bannerHtml({
      instance: dungeon,
      members: [view.mobId],
      view,
      state: { defeated: false, engaged: false, tracked: false },
      index: 0,
      total: dungeon.source.bossKeys.length,
      tier: 'normal',
      modelButton: false,
    });
    expect(html).not.toContain('aj-stat-chip');
    expect(html).toContain('aj-tagline-overview');
    expect(html).not.toContain('data-show-model');
    // A dungeon offers no Mythic, so no Mythic note either.
    expect(text(html)).not.toContain('Mythic');
  });
});

describe("the Smith's Heart ability furniture", () => {
  const heat = (tier: 'normal' | 'heroic') => heart().source.view(HEAT_GUARDIAN, tier);

  it('labels every Ignazhar phase with its health band', () => {
    const pills = Object.fromEntries(heat('normal').phases.map((p) => [p.id, phaseRangeText(p)]));
    expect(pills).toEqual({
      'every-phase': 'Whole fight',
      'phase-one': '100% to 70%',
      overflows: 'At 70% and 40%',
      'phase-two': '70% to 40%',
      'phase-three': '40% to the end',
    });
    // The pill replaces a summary that only restated the band.
    expect(
      heat('normal')
        .phases.filter((p) => p.rangeOnly)
        .map((p) => p.id),
    ).toEqual(['phase-one', 'phase-two', 'phase-three']);
  });

  it("prints the Wheel's hit and timer for the tier being read", () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const wheel = heat(tier)
        .phases.flatMap((p) => p.mechanics)
        .find((m) => m.id === 'wheel-of-the-hearth')!;
      const words = text(factsHtml(wheel)).replace(/,/g, '');
      expect(words).toContain(`${wheel.values?.min} to ${wheel.values?.max} Fire damage`);
      expect(words).toContain(`Every ${wheel.values?.every} sec`);
    }
  });

  it('prints no timer for a swing-count ability', () => {
    const council = heart().source.view(COUNCIL_GUARDIAN, 'normal');
    const hammerfall = council.phases
      .flatMap((p) => p.mechanics)
      .find((m) => m.id === 'hammerfall');
    expect(hammerfall).toBeTruthy();
    expect(text(factsHtml(hammerfall!))).not.toContain('sec');
  });
});
