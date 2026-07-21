import { describe, expect, it } from 'vitest';
import type { StatEffect, StatTooltipModel } from '../src/ui/stat_tooltip';
import {
  type StatTooltipI18n,
  statBreakdownHeader,
  statCellHtml,
  statEffectText,
  statNameKey,
  statNoteTexts,
  statSourceText,
  statTooltipAria,
  statTooltipHtml,
  statValueText,
} from '../src/ui/stat_tooltip_view';

// Fake i18n: echo the key plus its params so assertions can see exactly which
// catalog key and which formatted values the view chose, without binding the
// runtime i18n table. `fmt` keys off minimumFractionDigits so it reproduces the
// view's int0 (max 0 digits) vs dec1 (min/max 1 digit) split.
const fakeT = (key: string, params?: Record<string, string>): string =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;
const fakeFmt = (v: number, opts?: Intl.NumberFormatOptions): string =>
  v.toFixed(opts?.minimumFractionDigits ?? 0);
const deps: StatTooltipI18n = { t: fakeT, fmt: fakeFmt };

const model = (over: Partial<StatTooltipModel>): StatTooltipModel => ({
  stat: 'str',
  isPrimary: true,
  statValue: 0,
  effects: [],
  minorForClass: false,
  baseChanceNote: false,
  dpsApproxNote: false,
  sources: [],
  ...over,
});

describe('statEffectText number formatting + key selection', () => {
  it('whole-number kinds print as integers', () => {
    for (const kind of [
      'attackPower',
      'rangedAttackPower',
      'armor',
      'maxHealth',
      'maxMana',
      'healthRegen',
      'manaRegen',
    ] as const) {
      expect(statEffectText({ kind, value: 24 }, deps)).toBe(
        `hudChrome.statInfo.effects.${kind}(value=24)`,
      );
    }
  });

  it('chance and dps-contribution kinds keep one decimal', () => {
    for (const kind of ['critPct', 'dodgePct', 'spellCritPct', 'dpsFromAp'] as const) {
      expect(statEffectText({ kind, value: 1.1 }, deps)).toBe(
        `hudChrome.statInfo.effects.${kind}(value=1.1)`,
      );
    }
  });

  it('damage reduction splices both the reference level (integer) and the percent (one decimal)', () => {
    expect(statEffectText({ kind: 'damageReduction', value: 33.3, level: 20 }, deps)).toBe(
      'hudChrome.statInfo.effects.damageReduction(level=20,value=33.3)',
    );
  });
});

describe('statBreakdownHeader', () => {
  it('renders "From your N {stat}" only for a primary stat that has effects', () => {
    expect(
      statBreakdownHeader(
        model({
          stat: 'agi',
          isPrimary: true,
          statValue: 22,
          effects: [{ kind: 'armor', value: 44 }],
        }),
        deps,
      ),
    ).toBe('hudChrome.statInfo.fromYour(value=22,stat=itemUi.stats.agi)');
  });
  it('is empty for a derived stat or a primary with no effects', () => {
    expect(
      statBreakdownHeader(
        model({
          stat: 'armor',
          isPrimary: false,
          effects: [{ kind: 'damageReduction', value: 1, level: 1 }],
        }),
        deps,
      ),
    ).toBe('');
    expect(statBreakdownHeader(model({ stat: 'int', isPrimary: true, effects: [] }), deps)).toBe(
      '',
    );
  });
});

describe('statNameKey', () => {
  it('routes the Warfare label through the HUD-chrome catalog', () => {
    expect(statNameKey('warfare')).toBe('hudChrome.statInfo.names.warfare');
  });
});

describe('statSourceText', () => {
  it('renders base without a sign, other lines with an explicit + / − sign', () => {
    const m = model({ stat: 'sta' });
    expect(statSourceText({ kind: 'base', value: 40 }, m, deps)).toBe(
      'hudChrome.statInfo.sources.base(value=40)',
    );
    expect(statSourceText({ kind: 'gear', value: 85 }, m, deps)).toBe(
      'hudChrome.statInfo.sources.gear(value=+85)',
    );
    expect(statSourceText({ kind: 'talents', value: -20 }, m, deps)).toBe(
      'hudChrome.statInfo.sources.talents(value=−20)',
    );
  });

  it('names the buff and the deriving attribute', () => {
    const m = model({ stat: 'sta' });
    expect(statSourceText({ kind: 'buff', value: 12, name: 'Mark of the Wild' }, m, deps)).toBe(
      'hudChrome.statInfo.sources.buff(name=Mark of the Wild,value=+12)',
    );
    expect(statSourceText({ kind: 'attributes', value: 30, fromStat: 'int' }, m, deps)).toBe(
      'hudChrome.statInfo.sources.fromAttribute(stat=itemUi.stats.int,value=+30)',
    );
    expect(statSourceText({ kind: 'attributes', value: 30 }, m, deps)).toBe(
      'hudChrome.statInfo.sources.attributes(value=+30)',
    );
  });

  it('crit/dodge source values keep one decimal', () => {
    const m = model({ stat: 'critChance' });
    expect(statSourceText({ kind: 'base', value: 5 }, m, deps)).toBe(
      'hudChrome.statInfo.sources.base(value=5.0)',
    );
    expect(statSourceText({ kind: 'attributes', value: 1.1, fromStat: 'agi' }, m, deps)).toBe(
      'hudChrome.statInfo.sources.fromAttribute(stat=itemUi.stats.agi,value=+1.1)',
    );
  });
});

describe('statNoteTexts', () => {
  it('emits the active notes in display order', () => {
    expect(
      statNoteTexts(
        model({ minorForClass: true, baseChanceNote: true, dpsApproxNote: true }),
        deps,
      ),
    ).toEqual([
      'hudChrome.statInfo.notes.minorForClass',
      'hudChrome.statInfo.notes.baseChance',
      'hudChrome.statInfo.notes.dpsApprox',
    ]);
    expect(statNoteTexts(model({}), deps)).toEqual([]);
  });
});

describe('statTooltipHtml', () => {
  it('renders title, prose body, the breakdown header, gain/neutral effect lines, then notes', () => {
    const html = statTooltipHtml(
      model({
        stat: 'agi',
        isPrimary: true,
        statValue: 22,
        effects: [
          { kind: 'attackPower', value: 22 }, // gain -> tt-green
          { kind: 'critPct', value: 1.1 }, // gain -> tt-green
        ],
      }),
      deps,
    );
    expect(html).toContain('<div class="tt-title">itemUi.stats.agi</div>');
    expect(html).toContain('<div class="tt-body">hudChrome.statInfo.desc.agi</div>');
    expect(html).toContain(
      '<div class="tt-bd-head">hudChrome.statInfo.fromYour(value=22,stat=itemUi.stats.agi)</div>',
    );
    expect(html).toContain(
      '<div class="tt-green">hudChrome.statInfo.effects.attackPower(value=22)</div>',
    );
    expect(html).toContain(
      '<div class="tt-green">hudChrome.statInfo.effects.critPct(value=1.1)</div>',
    );
  });

  it('classifies informational effects (regen / damage reduction / dps) as neutral tt-stat', () => {
    const html = statTooltipHtml(
      model({
        stat: 'sta',
        effects: [
          { kind: 'maxHealth', value: 100 },
          { kind: 'healthRegen', value: 20 },
        ],
      }),
      deps,
    );
    expect(html).toContain(
      '<div class="tt-green">hudChrome.statInfo.effects.maxHealth(value=100)</div>',
    );
    expect(html).toContain(
      '<div class="tt-stat">hudChrome.statInfo.effects.healthRegen(value=20)</div>',
    );
  });

  it('appends note lines as tt-sub and omits the header for a derived cell', () => {
    const html = statTooltipHtml(
      model({ stat: 'critChance', isPrimary: false, statValue: 5.5, baseChanceNote: true }),
      deps,
    );
    expect(html).not.toContain('tt-bd-head');
    expect(html).toContain('<div class="tt-sub">hudChrome.statInfo.notes.baseChance</div>');
  });

  it('escapes every localized string it interpolates (no raw markup leaks through)', () => {
    const xss: StatTooltipI18n = { t: () => `<i>x</i>&'"`, fmt: fakeFmt };
    const html = statTooltipHtml(
      model({ stat: 'agi', effects: [{ kind: 'armor', value: 1 }] }),
      xss,
    );
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;&amp;&#39;&quot;');
  });

  it('colors every effect kind tt-green iff it is a gain, tt-stat otherwise (full 12-kind partition)', () => {
    // The class decision (GAIN_KINDS) is the one piece of logic the view adds over
    // the model, so pin it for ALL kinds, not just a sample. EXPECTED_GREEN states the
    // contract independently of the source set, so moving any kind across the partition
    // (or mis-rendering the two-placeholder damageReduction line) fails here.
    const ALL_KINDS: StatEffect['kind'][] = [
      'attackPower',
      'rangedAttackPower',
      'critPct',
      'dodgePct',
      'armor',
      'maxHealth',
      'maxMana',
      'spellCritPct',
      'healthRegen',
      'manaRegen',
      'damageReduction',
      'dpsFromAp',
    ];
    const EXPECTED_GREEN = new Set<StatEffect['kind']>([
      'attackPower',
      'rangedAttackPower',
      'critPct',
      'dodgePct',
      'armor',
      'maxHealth',
      'maxMana',
      'spellCritPct',
    ]);
    for (const kind of ALL_KINDS) {
      const e: StatEffect =
        kind === 'damageReduction' ? { kind, value: 12.5, level: 20 } : { kind, value: 7 };
      const html = statTooltipHtml(model({ stat: 'agi', effects: [e] }), deps);
      const cls = EXPECTED_GREEN.has(kind) ? 'tt-green' : 'tt-stat';
      expect(html, kind).toContain(`<div class="${cls}">hudChrome.statInfo.effects.${kind}(`);
    }
    // The two-placeholder line renders through the html and aria integration paths.
    const drModel = model({
      stat: 'armor',
      isPrimary: false,
      effects: [{ kind: 'damageReduction', value: 12.5, level: 20 }],
    });
    expect(statTooltipHtml(drModel, deps)).toContain(
      '<div class="tt-stat">hudChrome.statInfo.effects.damageReduction(level=20,value=12.5)</div>',
    );
    expect(statTooltipAria(drModel, deps)).toContain(
      'hudChrome.statInfo.effects.damageReduction(level=20,value=12.5)',
    );
  });
});

describe('statTooltipAria', () => {
  it('is a plain-text join (description, header, effects, notes) with no markup', () => {
    const aria = statTooltipAria(
      model({
        stat: 'agi',
        isPrimary: true,
        statValue: 22,
        effects: [
          { kind: 'attackPower', value: 22 },
          { kind: 'armor', value: 44 },
        ],
        baseChanceNote: false,
      }),
      deps,
    );
    expect(aria).not.toContain('<');
    expect(aria).toBe(
      [
        'hudChrome.statInfo.desc.agi',
        'hudChrome.statInfo.fromYour(value=22,stat=itemUi.stats.agi)',
        'hudChrome.statInfo.effects.attackPower(value=22)',
        'hudChrome.statInfo.effects.armor(value=44)',
      ].join(' '),
    );
  });

  it('starts with the description and omits the stat name (the cell already names it)', () => {
    const aria = statTooltipAria(model({ stat: 'spi', effects: [], minorForClass: true }), deps);
    expect(aria.startsWith('hudChrome.statInfo.desc.spi')).toBe(true);
    expect(aria).not.toContain('itemUi.stats.spi');
  });
});

describe('statValueText', () => {
  it('shows one-decimal percents for crit and dodge and both Warfare effects', () => {
    expect(statValueText(model({ stat: 'critChance', statValue: 5.5 }), deps)).toBe('5.5%');
    expect(statValueText(model({ stat: 'dodge', statValue: 5 }), deps)).toBe('5.0%');
    expect(
      statValueText(
        model({
          stat: 'warfare',
          statValue: 20,
          warfareDamageIncrease: 20,
          warfareDamageReduction: 13.7,
        }),
        deps,
      ),
    ).toBe('hudChrome.statInfo.warfareValue(increase=20.0,reduction=13.7)');
  });
  it('shows a one-decimal number for the dps estimate and a whole number otherwise', () => {
    expect(statValueText(model({ stat: 'dps', statValue: 12.34 }), deps)).toBe('12.3');
    expect(statValueText(model({ stat: 'str', statValue: 22 }), deps)).toBe('22');
    expect(statValueText(model({ stat: 'armor', statValue: 100 }), deps)).toBe('100');
  });
});

describe('statCellHtml', () => {
  it('builds a focusable, aria-described cell whose value matches the model and whose hidden text is the aria breakdown', () => {
    const m = model({ stat: 'agi', statValue: 22, effects: [{ kind: 'armor', value: 44 }] });
    const html = statCellHtml(m, deps);
    expect(html).toContain(
      'class="stat-cell" data-stat="agi" tabindex="0" aria-describedby="statdesc-agi"',
    );
    expect(html).toContain('itemUi.stats.agi: <b>22</b>');
    expect(html).toContain('<span id="statdesc-agi" class="visually-hidden">');
    // The hidden node carries exactly the aria breakdown string.
    expect(html).toContain(statTooltipAria(m, deps));
  });

  it('escapes the stat name and aria text but leaves the formatted value bare', () => {
    const xss: StatTooltipI18n = { t: () => `A&B`, fmt: fakeFmt };
    const html = statCellHtml(model({ stat: 'str', statValue: 7 }), xss);
    expect(html).toContain('A&amp;B: <b>7</b>');
    expect(html).not.toContain('A&B:');
  });

  it('uses one Warfare name and describes both live PvP effects in accessible output', () => {
    const m = model({
      stat: 'warfare',
      isPrimary: false,
      statValue: 20,
      warfareDamageIncrease: 20,
      warfareDamageReduction: 13.7,
    });
    const html = statCellHtml(m, deps);
    expect(html).toContain(
      'hudChrome.statInfo.names.warfare: <b>hudChrome.statInfo.warfareValue(increase=20.0,reduction=13.7)</b>',
    );
    expect(statTooltipAria(m, deps)).toBe(
      'hudChrome.statInfo.desc.warfare(increase=20.0,reduction=13.7)',
    );
  });
});
