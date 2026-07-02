import { beforeAll, describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { TALENTS } from '../src/sim/content/talents';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

const PCT_FIELDS = new Set([
  'crit',
  'dodge',
  'apPct',
  'staPct',
  'armorPct',
  'maxHpPct',
  'strPct',
  'agiPct',
  'intPct',
  'spiPct',
  'meleeDmgPct',
  'spellDmgPct',
  'healPct',
  'threatPct',
  'critVsRooted',
  'dmgPct',
  'costPct',
  'cooldownPct',
  'castPct',
  'buffPct',
]);

function expectedTokens(effect: unknown): string[] {
  const toks: string[] = [];
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'addEffects') continue;
      if (typeof value === 'number') {
        if (value === 0) continue;
        toks.push(
          PCT_FIELDS.has(key)
            ? `${+(Math.abs(value) * 100).toFixed(1)}%`
            : `${+Math.abs(value).toFixed(1)}`,
        );
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  return toks;
}

function legitNumbers(effect: unknown): Set<number> {
  const out = new Set<number>();
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'addEffects') continue;
      if (typeof value === 'number') {
        const n = PCT_FIELDS.has(key) ? Math.round(Math.abs(value) * 100) : Math.abs(value);
        out.add(n);
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  return out;
}

function descriptionNumbers(text: string): { pcts: number[]; bare: number[] } {
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Math.round(parseFloat(m[1])));
  const bare: number[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) {
    const n = parseFloat(m[1]);
    const end = (m.index ?? 0) + m[0].length;
    const after = text.slice(end, end + 8).toLowerCase();
    if (/^\s*%/.test(after)) continue;
    if (/^\s*(sec|second|yard|yd|min|meter|m\b|rank)/.test(after)) continue;
    bare.push(n);
  }
  return { pcts, bare };
}

interface Entry {
  cls: string;
  id: string;
  source: string;
  effect: unknown;
  render: () => string;
}

function allEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: `${spec.id}.mastery`,
        source: spec.mastery.description,
        effect: spec.mastery.effect,
        render: () => tTalent({ kind: 'talentMastery', spec, field: 'description' }),
      });
    }
    for (const row of CHOICE_ROWS[cls as keyof typeof CHOICE_ROWS].rows) {
      for (const option of row.options) {
        entries.push({
          cls,
          id: `${row.level}.${option.id}`,
          source: option.description,
          effect: option.effect,
          render: () => option.description,
        });
      }
    }
  }
  return entries;
}

describe('talent tooltip accuracy (specs and choice rows)', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  const entries = allEntries();

  it('covers every class, spec mastery, and choice row option', () => {
    expect(new Set(entries.map((e) => e.cls)).size).toBe(9);
    expect(entries.length).toBe(27 + 9 * 6 * 3);
  });

  it('every tooltip describes a real effect', () => {
    const blank = entries.filter((e) => e.render().trim() === '');
    expect(blank.map((e) => `${e.cls}:${e.id}`)).toEqual([]);
  });

  it('the rendered English tooltip states numbers when the effect has any', () => {
    const vague = entries
      .filter(
        (e) =>
          legitNumbers(e.effect).size > 0 &&
          !/\d/.test(e.render()) &&
          !/\binstant\b/i.test(e.render()),
      )
      .map((e) => `${e.cls}:${e.id} -> "${e.render()}"`);
    expect(vague).toEqual([]);
  });

  it('the tooltip is complete for every numeric effect magnitude', () => {
    const incomplete: string[] = [];
    for (const e of entries) {
      const text = e.render();
      const missing = expectedTokens(e.effect).filter(
        (t) => !text.includes(t) && !(t === '100%' && /\binstant\b/i.test(text)),
      );
      if (missing.length)
        incomplete.push(`${e.cls}:${e.id} missing ${missing.join(', ')} in "${text}"`);
    }
    expect(incomplete, incomplete.join('\n')).toEqual([]);
  });

  it('no number in the rendered tooltip contradicts the effect data', () => {
    const bad: string[] = [];
    for (const e of entries) {
      const legit = legitNumbers(e.effect);
      if (legit.size === 0) continue;
      const { pcts, bare } = descriptionNumbers(e.render());
      for (const p of pcts)
        if (!legit.has(p)) bad.push(`${e.cls}:${e.id} rendered "${p}%" not in effect`);
      for (const n of bare)
        if (!legit.has(n)) bad.push(`${e.cls}:${e.id} rendered "${n}" not in effect`);
    }
    expect(bad).toEqual([]);
  });
});
