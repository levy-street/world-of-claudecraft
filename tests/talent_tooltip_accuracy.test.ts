import { beforeAll, describe, expect, it } from 'vitest';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

// English row prose is authored alongside the canonical effect; localized tooltips are
// generated from that effect. Grant rows expand to the granted ability's localized behavior
// and planning metadata instead of ending at a dead-end "Grants X" sentence.

interface Entry {
  kind: 'row' | 'mastery';
  cls: string;
  id: string;
  name: string;
  source: string;
  render: () => string;
}

function allEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const row of ROW_TREES[ct.class]) {
      for (const choice of row.options) {
        entries.push({
          cls,
          kind: 'row',
          id: choice.id,
          name: choice.name,
          source: choice.description,
          render: () => tTalent({ kind: 'talentChoice', choice, field: 'description' }),
        });
      }
    }
    for (const spec of ct.specs) {
      entries.push({
        cls,
        kind: 'mastery',
        id: `${spec.id}.mastery`,
        name: spec.mastery.name,
        source: spec.mastery.description,
        render: () => tTalent({ kind: 'talentMastery', spec, field: 'description' }),
      });
    }
  }
  return entries;
}

const NO_EFFECT = 'Provides a specialization benefit.';

describe('talent tooltip accuracy (all 9 classes x 3 specs)', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  const entries = allEntries();

  it('covers every class, all 162 row options, and all 27 masteries', () => {
    expect(new Set(entries.map((e) => e.cls)).size).toBe(9);
    expect(entries).toHaveLength(189);
  });

  it('every talent describes a real effect (none fall back to the generic blurb)', () => {
    const blank = entries.filter(
      (e) => e.render().trim() === NO_EFFECT || e.render().trim() === '',
    );
    expect(blank.map((e) => `${e.cls}:${e.id}`)).toEqual([]);
  });

  it('keeps non-grant English row tooltips byte-equal to the authored source', () => {
    for (const [cls, rows] of Object.entries(ROW_TREES)) {
      for (const row of rows) {
        for (const option of row.options) {
          if (option.effect.grant) continue;
          expect(
            tTalent({ kind: 'talentChoice', choice: option, field: 'description' }),
            `${cls}:${option.id}`,
          ).toBe(option.description);
        }
      }
    }
  });

  it('expands resolvable grant rows beyond a bare grant sentence', () => {
    for (const [cls, rows] of Object.entries(ROW_TREES)) {
      for (const row of rows) {
        for (const option of row.options) {
          const grantId = option.effect.grant?.ability;
          if (!grantId) continue;
          const rendered = tTalent({ kind: 'talentChoice', choice: option, field: 'description' });
          expect(rendered.trim().length, `${cls}:${option.id}`).toBeGreaterThan(0);
          expect(rendered, `${cls}:${option.id}`).not.toMatch(/^Grants\s+[^.]+\.?$/);
        }
      }
    }
  });

  it('ships no unresolved ability placeholders in canonical source prose', () => {
    const unresolved = entries.filter((entry) =>
      /\$[A-Za-z0-9_]+|\{[A-Za-z0-9_]+\}/.test(entry.source),
    );
    expect(unresolved.map((entry) => `${entry.cls}:${entry.id}`)).toEqual([]);
  });

  it('keeps Shadow mechanic conditions explicit in a non-Latin locale', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      const renderChoice = (id: string): string => {
        const choice = Object.values(ROW_TREES)
          .flat()
          .flatMap((row) => row.options)
          .find((option) => option.id === id);
        if (!choice) throw new Error(`missing talent choice ${id}`);
        return tTalent({ kind: 'talentChoice', choice, field: 'description' });
      };

      expect(renderChoice('pri_r17_ninefold_litany')).toContain('/ 9x');
      expect(renderChoice('pri_r17_woes_crescendo')).toContain('3/3 -> AoE 36');
      expect(renderChoice('pri_r14_deathless_dirge')).toContain('↻ 18');
      expect(renderChoice('pri_r14_plague_chorus')).toContain('-> AoE (r=8)');
    } finally {
      setLanguage('en');
    }
  });

  it('regression locks: vague tooltips now read real numbers; egregious effects honor their promise', () => {
    setLanguage('en');
    const render = (cls: string, finder: (e: Entry) => boolean) => {
      const entry = entries.find((e) => e.cls === cls && finder(e));
      if (!entry) throw new Error(`no talent entry matched for ${cls}`);
      return entry.render();
    };
    const oathsDue = render('paladin', (e) => e.id === 'pal_r14_swift_verdicts');
    expect(oathsDue).toContain('Verdict');
    expect(oathsDue).toContain('Crusader Strike');
    expect(oathsDue).toContain('50%');
    expect(oathsDue).toContain('7');

    const reprise = render('shaman', (e) => e.id === 'sha_r20_elemental_fury');
    expect(reprise).toContain('20%');
    expect(reprise).toContain('Ancestral Strike');
    expect(reprise).toContain('cooldown');

    const sniper = render('hunter', (e) => e.id === 'hun_r14_sniper_training');
    expect(sniper).toContain('30%');
    expect(sniper).toContain('15%');

    const fulmination = render('shaman', (e) => e.id === 'sha_r11_fulmination');
    expect(fulmination).toContain('up to 9');
    expect(fulmination).toContain('5% Overload chance');
    expect(fulmination).toContain('chains to one nearby enemy');
    expect(fulmination).toContain('8 Nature damage each');
    expect(fulmination).toContain('nearby enemies');

    const mastery = render('warrior', (e) => e.id === 'war_row_blood_offering');
    expect(mastery).toContain('ability criticals deal 15% more damage');
    expect(mastery).toContain('auto-attacks are 5% faster');
    expect(mastery).toContain('at least 20%');
  });
});
