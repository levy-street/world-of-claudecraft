import { beforeAll, describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

// Talent descriptions are GENERATED from each node's `effect` data (in every locale,
// English included; see tTalent). These guards make sure the displayed tooltip never
// disagrees with what the talent actually does, and that the hand-written `description`
// strings (still the translation-manifest source) stay numerically honest. Together they
// stop the two drifts this suite was written for: vague text that hides the numbers, and
// text that states a number the effect does not produce.

// Pct-style fields are stored as fractions (0.10 = 10%); everything else is a flat value.
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
  'meleeHastePct',
  'spellDmgPct',
  'healPct',
  'threatPct',
  'critDmgSpellPct',
  'critDmgPhysPct',
  'critDmgHealPct',
  'dotDmgPct',
  'hotHealPct',
  'absorbPct',
  'critVsRooted',
  'spellHastePct',
  'petDmgPct',
  'petDmgSharePct',
  'dmgPct',
  'costPct',
  'cooldownPct',
  'castPct',
  'buffPct',
]);

// Each effect magnitude as the exact token the tooltip should contain: pcts as "N%",
// flats as "N" (per-rank value; the description says "... per rank").
function expectedTokens(effect: unknown, maxRank: number): string[] {
  void maxRank;
  const toks: string[] = [];
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (value === 0) continue;
        // A +50% spell or heal crit-damage mastery lifts the 1.5x base to 2.0x, which the
        // hand-written descriptions phrase as "double" rather than "50%".
        if ((key === 'critDmgSpellPct' || key === 'critDmgHealPct') && value === 0.5) {
          toks.push('double');
          continue;
        }
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

// The set of numbers the effect legitimately produces: each magnitude as a per-rank value
// and as a maxRank total, with pct fields scaled to whole percents.
function legitNumbers(effect: unknown, maxRank: number): Set<number> {
  const out = new Set<number>();
  const add = (value: number, isPct: boolean) => {
    const per = isPct ? Math.round(Math.abs(value) * 100) : Math.abs(value);
    out.add(per);
    out.add(per * maxRank);
  };
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') add(value, PCT_FIELDS.has(key));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  return out;
}

function hasNumericEffect(effect: unknown, maxRank: number): boolean {
  return legitNumbers(effect, maxRank).size > 0;
}

// Numbers a human wrote in a description, excluding durations/ranges the effect never
// carries (e.g. "for 4 sec", "within 8 yards") which are legitimately effect-external.
function descriptionNumbers(text: string): { pcts: number[]; bare: number[] } {
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Math.round(parseFloat(m[1])));
  const bare: number[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) {
    const n = parseFloat(m[1]);
    const end = (m.index ?? 0) + m[0].length;
    const after = text.slice(end, end + 8).toLowerCase();
    if (/^\s*%/.test(after)) continue; // already counted as a percent
    if (/^\s*(sec|second|yard|yd|min|meter|m\b)/.test(after)) continue; // duration/range
    bare.push(n);
  }
  return { pcts, bare };
}

interface Entry {
  cls: string;
  id: string;
  name: string;
  source: string;
  effect: unknown;
  maxRank: number;
  render: () => string;
}

function allEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const node of ct.nodes) {
      if (node.kind === 'choice') {
        for (const choice of node.choices ?? []) {
          entries.push({
            cls,
            id: `${node.id}.${choice.id}`,
            name: choice.name,
            source: choice.description,
            effect: choice.effect,
            maxRank: 1,
            render: () => tTalent({ kind: 'talentChoice', choice, field: 'description' }),
          });
        }
        continue;
      }
      entries.push({
        cls,
        id: node.id,
        name: node.name,
        source: node.description,
        effect: node.effect,
        maxRank: node.maxRank,
        render: () => tTalent({ kind: 'talentNode', node, field: 'description' }),
      });
    }
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: `${spec.id}.mastery`,
        name: spec.mastery.name,
        source: spec.mastery.description,
        effect: spec.mastery.effect,
        maxRank: 1,
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

  it('covers every class and a meaningful number of nodes', () => {
    expect(new Set(entries.map((e) => e.cls)).size).toBe(9);
    expect(entries.length).toBeGreaterThan(250);
  });

  it('every talent describes a real effect (none fall back to the generic blurb)', () => {
    const blank = entries.filter(
      (e) => e.render().trim() === NO_EFFECT || e.render().trim() === '',
    );
    expect(blank.map((e) => `${e.cls}:${e.id}`)).toEqual([]);
  });

  it('the rendered English tooltip states the numbers when the effect has any (no vague text)', () => {
    const vague = entries
      .filter(
        (e) =>
          hasNumericEffect(e.effect, e.maxRank) &&
          !/\d/.test(e.render()) &&
          !expectedTokens(e.effect, e.maxRank).every((t) => e.render().includes(t)),
      )
      .map((e) => `${e.cls}:${e.id} -> "${e.render()}"`);
    expect(vague).toEqual([]);
  });

  it('the tooltip is COMPLETE: every number the effect produces appears in the text', () => {
    const incomplete: string[] = [];
    for (const e of entries) {
      const text = e.render();
      const missing = expectedTokens(e.effect, e.maxRank).filter((t) => !text.includes(t));
      if (missing.length)
        incomplete.push(`${e.cls}:${e.id} missing ${missing.join(', ')} in "${text}"`);
    }
    expect(incomplete, incomplete.join('\n')).toEqual([]);
  });

  it('no number in the rendered tooltip contradicts the effect data', () => {
    const bad: string[] = [];
    for (const e of entries) {
      const legit = legitNumbers(e.effect, e.maxRank);
      const { pcts, bare } = descriptionNumbers(e.render());
      for (const p of pcts)
        if (!legit.has(p)) bad.push(`${e.cls}:${e.id} rendered "${p}%" not in effect`);
      for (const n of bare)
        if (!legit.has(n)) bad.push(`${e.cls}:${e.id} rendered "${n}" not in effect`);
    }
    expect(bad).toEqual([]);
  });

  it('the hand-written source description never states a number the effect does not produce', () => {
    const bad: string[] = [];
    for (const e of entries) {
      const legit = legitNumbers(e.effect, e.maxRank);
      const { pcts, bare } = descriptionNumbers(e.source);
      for (const p of pcts)
        if (!legit.has(p)) bad.push(`${e.cls}:${e.id} source "${p}%" not in effect`);
      for (const n of bare)
        if (!legit.has(n)) bad.push(`${e.cls}:${e.id} source "${n}" not in effect`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('regression locks: vague tooltips now read real numbers; egregious effects honor their promise', () => {
    setLanguage('en');
    const render = (cls: string, finder: (e: Entry) => boolean) => {
      const entry = entries.find((e) => e.cls === cls && finder(e));
      if (!entry) throw new Error(`no talent entry matched for ${cls}`);
      return entry.render();
    };
    // Barrage was "Improves instant shots per rank." (vague) -> now the real per-rank
    // numbers. Concussive Shot is a utility slow, so the talent cuts its cooldown (more
    // frequent slows) rather than buffing its negligible damage.
    const barrage = render('hunter', (e) => e.id === 'mm_barrage');
    expect(barrage).toContain('Fell Shot');
    expect(barrage).toContain('Rattling Shot');
    expect(barrage).toContain('cooldown');
    expect(barrage).toContain('10%');
    expect(barrage).not.toContain('15%');
    // Emberstorm promised "+10% Fire damage"; the 12% effect was bent down to honor it.
    const ember = render('warlock', (e) => e.id === 'dest_choice.dest_choice_emberstorm');
    expect(ember).toContain('10%');
    expect(ember).not.toContain('12%');
    // Arcane Mind promised "+8% Intellect"; the effect now grants intPct 0.08.
    const arcane = render('mage', (e) => e.id === 'mag_school_focus.mag_school_arcane');
    expect(arcane).toContain('Intellect');
    expect(arcane).toContain('8%');
    // Survival mastery grants 15% Agility and 15% physical ability damage.
    const lr = render('hunter', (e) => e.id === 'survival.mastery');
    expect(lr).toContain('Agility');
    expect(lr).toContain('15%');
    expect(lr).toContain('physical ability damage');
  });
});
