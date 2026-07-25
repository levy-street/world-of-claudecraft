import { beforeAll, describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES } from '../src/sim/content/classes';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';
import {
  STANCE_MASTERY_BATTLE_CRIT_DMG,
  STANCE_MASTERY_BERSERKER_HASTE,
  STANCE_MASTERY_GUARDED_CUT,
  STANCE_MASTERY_GUARDED_HP_PCT,
} from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { grantAbilityValues, tTalent } from '../src/ui/talent_i18n';

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

  it('regression locks: vague tooltips now read real numbers; egregious effects honor their promise', () => {
    setLanguage('en');
    const render = (cls: string, finder: (e: Entry) => boolean) => {
      const entry = entries.find((e) => e.cls === cls && finder(e));
      if (!entry) throw new Error(`no talent entry matched for ${cls}`);
      return entry.render();
    };
    // Balance pass: Swift Verdicts is a cooldown cut now, not banked charges.
    const swift = render('paladin', (e) => e.id === 'pal_r14_swift_verdicts');
    expect(swift).toContain('cooldown is reduced by 20%');

    // Balance pass: the option is now Steady Draw, a plain cast-speed talent.
    const sniper = render('hunter', (e) => e.id === 'hun_r14_sniper_training');
    expect(sniper).toContain('cast time is reduced by 20%');

    const attunement = render('shaman', (e) => e.id === 'sha_r11_elemental_attunement');
    expect(attunement).toContain('critical strikes');
    expect(attunement).toContain('instant');

    const mastery = render('warrior', (e) => e.id === 'war_row_blood_offering');
    expect(mastery).toContain('ability criticals deal 15% more damage');
    expect(mastery).toContain('auto-attacks are 5% faster');
    expect(mastery).toContain('at least 20%');
  });

  it('renders Warded source-health scaling in non-English tooltips', async () => {
    const warded = CHOICE_ROWS.mage.rows
      .flatMap((row) => [...row.options])
      .find((choice) => choice.id === 'mag_r8_warded');
    if (!warded) throw new Error('missing mag_r8_warded');

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      const rendered = tTalent({
        kind: 'talentChoice',
        choice: warded,
        field: 'description',
      });
      expect(rendered).toContain('+10\u00a0% salud máxima');
      expect(rendered).not.toContain('+0 Sanación');
    } finally {
      setLanguage('en');
    }
  });
});

// Talent descriptions are generated from effect data outside English. English remains
// authored source text, so this suite keeps it numerically honest against the effect
// records that power specs, masteries, and the choice rows.

const PCT_FIELDS = new Set([
  'leechPct',
  'hpFrac',
  'belowFrac',
  'dmgPctVsDotted',
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
  'secondWindPctPerSec',
  'fearBreakPct',
  'onKillSpeedPct',
  'autoRagePct',
  'abilityRagePct',
  'bloodbathPct',
  'bloodbathMaxPct',
  'dmgPct',
  'costPct',
  'cooldownPct',
  'castPct',
  'buffPct',
  // Balance pass: ability-scoped crit chance (Redhanded, shown as "30%") and
  // proc trigger fire chance (Venom Dividend, shown as "20% chance").
  'critPct',
  'chance',
  // Phase-2 defensive pass: pct-of-max-health proc responses.
  'amountPctMaxHp',
  'amountPctSourceMaxHp',
  'healPctMaxHp',
  // Thuggery mastery: the Sword Specialization extra-attack chance.
  'extraAttackPct',
  // Nature's Fury: the moonwing party spell-crit fraction.
  'moonwingPartyCritPct',
  // Serpent's Venom (hunter choice row): the added dot totals a fraction of the
  // direct hit (effect_dispatch resolves total = lastDirectDamage * directPct),
  // shown as "50% of its damage".
  'directPct',
  // Recompense (warrior prot mastery): armor granted as a fraction of Strength
  // (entity.ts folds s.str * armorFromStrPct), shown as "70% of your Strength".
  'armorFromStrPct',
  // Master Armorer (warrior arms mastery): fraction of extra damage while wielding
  // a two-handed weapon, applied at runtime in combat/damage.ts, shown as "10%".
  'masteryTwoHandDmgPct',
  // Warded (mage choice row): fraction less damage while the barrier is up,
  // applied at runtime in combat/damage.ts, shown as "15%".
  'barrierDrPct',
  // Ignition (fire mage mastery): the burn fraction, shown as "40%".
  'ignitionPct',
  // Chronoweave (arcane mage mastery): the mana cushion + regen, applied in
  // entity.ts / auras.ts, shown as "5%" and "20%" in the hand-written description.
  'manaPct',
  'manaRegenPct',
]);

function expectedTokens(effect: unknown): string[] {
  const toks: string[] = [];
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    // Aura proc responses with multiplier-shaped kinds (buff_speed 1.4 =
    // "+40% movement"): the delta is the stated number, not the raw 1.4.
    const shapedAura = obj as {
      kind?: string;
      auraKind?: string;
      value?: number;
      duration?: number;
    };
    if (
      shapedAura.kind === 'aura' &&
      (shapedAura.auraKind === 'buff_speed' || shapedAura.auraKind === 'buff_haste')
    ) {
      toks.push(`${+(((shapedAura.value ?? 1) - 1) * 100).toFixed(1)}%`);
      if (shapedAura.duration) toks.push(`${+shapedAura.duration.toFixed(1)}`);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (value === 0) continue;
        if (key === 'battleRhythm') continue;
        // Blink While Casting / Elemental Convergence (mage choice rows) are
        // picked/not-picked flags like battleRhythm; their timings are stated
        // as durations, not this 1.
        if (key === 'blinkCast' || key === 'convergence') continue;
        // A +50% spell or heal crit-damage mastery lifts the 1.5x base to 2.0x, which the
        // hand-written descriptions phrase as "double" rather than "50%".
        if ((key === 'critDmgSpellPct' || key === 'critDmgHealPct') && value === 0.5) {
          toks.push('double');
          continue;
        }
        // A slow `mult` is stated as the percentage slowed (mult 0.5 = 50% slower).
        if (key === 'mult' && value > 0 && value < 1) {
          toks.push(`${+((1 - value) * 100).toFixed(1)}%`);
          continue;
        }
        // castPct -1 means the cast becomes instant; tooltips say "instant".
        if (key === 'castPct' && value === -1) {
          toks.push('instant');
          continue;
        }
        // A proc firing on EVERY matching cast (n: 1) reads as "every cast";
        // no numeral is required in the copy.
        if (key === 'n' && value === 1) continue;
        if (key === 'bonusCharges') {
          toks.push(`${value + 1}`);
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

function legitNumbers(effect: unknown): Set<number> {
  const out = new Set<number>();
  const add = (value: number, isPct: boolean) => {
    out.add(isPct ? Math.round(Math.abs(value) * 100) : Math.abs(value));
  };
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    // Aura proc responses with multiplier-shaped kinds (buff_speed 1.4 =
    // "+40% movement"): the delta is the stated number, not the raw 1.4.
    const shapedAura = obj as {
      kind?: string;
      auraKind?: string;
      value?: number;
      duration?: number;
    };
    if (
      shapedAura.kind === 'aura' &&
      (shapedAura.auraKind === 'buff_speed' || shapedAura.auraKind === 'buff_haste')
    ) {
      add((shapedAura.value ?? 1) - 1, true);
      if (shapedAura.duration) add(shapedAura.duration, false);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (key === 'battleRhythm') {
          // Battle Rhythm is a picked/not-picked flag; the every-third-cast
          // empowerment value lives in effect_dispatch.ts (buff_rage_gen 0.2),
          // so the stated 20% is intrinsic.
          out.add(20);
          continue;
        }
        add(value, PCT_FIELDS.has(key));
        // Cheat death leaves the player at 1 health: the floor is intrinsic to
        // the mechanic, so copy may state the 1.
        if (key === 'cheatDeathIcd') out.add(1);
        if (key === 'bonusCharges') out.add(value + 1);
        // A slow mult also legitimizes the stated slow percentage (mult 0.5 = 50%).
        if (key === 'mult' && value > 0 && value < 1) out.add(Math.round((1 - value) * 100));
        // Second Wind regenerates only below the SECOND_WIND_THRESHOLD floor
        // (0.35 in combat/auras.ts): the 35% gate is intrinsic to the mechanic.
        if (key === 'secondWindPctPerSec') out.add(35);
        // Combat Mastery is a flag; the per-stance riders are the exported
        // STANCE_MASTERY_* constants the sim applies at runtime.
        if (key === 'stanceMastery') {
          out.add(Math.round(STANCE_MASTERY_BATTLE_CRIT_DMG * 100));
          out.add(Math.round(STANCE_MASTERY_BERSERKER_HASTE * 100));
          out.add(Math.round(STANCE_MASTERY_GUARDED_HP_PCT * 100));
          out.add(Math.round(STANCE_MASTERY_GUARDED_CUT * 100));
        }
        // Bloodbath stacks up to BLOODBATH_MAX_STACKS (5 in combat/damage.ts),
        // so the stated cap is the per-kill value times five.
        if (key === 'bloodbathPct') out.add(Math.round(Math.abs(value) * 100 * 5));
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  // Authored English may state the player-facing result of a modifier rather
  // than only its storage representation. Keep those derived values legitimate:
  // a 66% cost cut on a 10-rage spell is a 3-rage spell, and a 50% increase to
  // a 5% party buff is 7.5% (rounded to 8 by descriptionNumbers).
  const shaped = effect as {
    ability?: Array<{ ability: string; costPct?: number; buffPct?: number }>;
    proc?: {
      trigger?: { on?: string; abilities?: string[] };
      responses?: Array<{ kind?: string; amount?: number }>;
    };
  };
  for (const mod of shaped.ability ?? []) {
    const def = ABILITIES[mod.ability];
    if (!def) continue;
    if (mod.costPct !== undefined) {
      const resolved = def.cost * (1 + mod.costPct);
      out.add(Math.round(resolved));
      out.add(Math.ceil(resolved));
    }
    if (mod.buffPct !== undefined) {
      for (const abilityEffect of def.effects) {
        if (
          (abilityEffect.type === 'selfBuff' || abilityEffect.type === 'buffTarget') &&
          typeof abilityEffect.value === 'number'
        ) {
          out.add(Math.round(Math.abs(abilityEffect.value)));
          out.add(Math.round(Math.abs(abilityEffect.value * (1 + mod.buffPct))));
        }
      }
    }
  }
  // A resource-refund proc may be described against its trigger ability's cost
  // (Bruin Rebound: "restores 15 rage, refunding its 10 rage cost plus 5"), so
  // the trigger's cost and the refund-minus-cost remainder are legitimate.
  const triggerAbility = shaped.proc?.trigger?.abilities?.[0];
  const triggerCost = triggerAbility ? ABILITIES[triggerAbility]?.cost : undefined;
  if (triggerCost !== undefined) {
    for (const response of shaped.proc?.responses ?? []) {
      if (response.kind !== 'resource' || response.amount === undefined) continue;
      out.add(triggerCost);
      out.add(Math.abs(response.amount - triggerCost));
    }
  }
  // A grant option's tooltip appends the granted ability's own description with
  // its base (rank-1) values resolved, so every number the granted ability
  // produces (damage min/max, buff, duration, absorb amount, dot total) is
  // legitimate, not a contradiction. Walk the granted ability's effects too.
  const grantId = (effect as { grant?: { ability?: string } })?.grant?.ability;
  if (grantId && ABILITIES[grantId]) {
    // The tooltip also appends the granted ability's planning metadata line
    // (cost, cast or channel, range, cooldown), so those numbers are real too.
    const def = ABILITIES[grantId];
    for (const value of [
      def.cost,
      def.castTime,
      def.cooldown,
      def.range,
      def.minRange,
      def.channel?.duration,
    ]) {
      if (value !== undefined && value !== 0) out.add(Math.abs(value));
    }
    // Render the granted ability description exactly as the tooltip does (base
    // values), so every number it actually shows counts as legitimate.
    const { pcts, bare } = descriptionNumbers(
      tEntity({
        kind: 'ability',
        id: grantId,
        field: 'description',
        values: grantAbilityValues(grantId),
      }),
    );
    for (const n of pcts) out.add(n);
    for (const n of bare) out.add(n);
  }
  return out;
}

function hasNumericEffect(effect: unknown): boolean {
  return legitNumbers(effect).size > 0;
}

function descriptionNumbers(text: string): { pcts: number[]; bare: number[] } {
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Math.round(parseFloat(m[1])));
  const bare: number[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) {
    const n = parseFloat(m[1]);
    const end = (m.index ?? 0) + m[0].length;
    const after = text.slice(end, end + 8).toLowerCase();
    if (/^\s*%/.test(after)) continue;
    if (/^\s*(sec|second|yard|yd|min|meter|m\b)/.test(after)) continue;
    bare.push(n);
  }
  return { pcts, bare };
}

interface EffectEntry {
  cls: string;
  id: string;
  name: string;
  source: string;
  effect: unknown;
  render: () => string;
}

interface SpecEntry {
  cls: string;
  id: string;
  abilityName: string;
  render: () => string;
}

function effectEntries(): EffectEntry[] {
  const entries: EffectEntry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: `${spec.id}.mastery`,
        name: spec.mastery.name,
        source: spec.mastery.description,
        effect: spec.mastery.effect,
        render: () => tTalent({ kind: 'talentMastery', spec, field: 'description' }),
      });
    }
    for (const row of CHOICE_ROWS[cls].rows) {
      for (const choice of row.options) {
        entries.push({
          cls,
          id: `${row.level}.${choice.id}`,
          name: choice.name,
          source: choice.description,
          effect: choice.effect,
          render: () => tTalent({ kind: 'talentChoice', choice, field: 'description' }),
        });
      }
    }
  }
  return entries;
}

function specEntries(): SpecEntry[] {
  const entries: SpecEntry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: spec.id,
        abilityName: ABILITIES[spec.signature]?.name ?? spec.signature,
        render: () => tTalent({ kind: 'talentSpec', spec, field: 'description' }),
      });
    }
  }
  return entries;
}

describe('talent tooltip accuracy for specs, masteries, and choice rows', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  const effects = effectEntries();
  const specs = specEntries();

  it('covers every class, every spec, and every choice row option', () => {
    expect(new Set(effects.map((e) => e.cls)).size).toBe(9);
    expect(specs).toHaveLength(27);
    expect(effects.length).toBe(27 + 9 * 6 * 3);
  });

  it('every spec tooltip names its signature ability', () => {
    const missing = specs
      .filter((entry) => !entry.render().includes(entry.abilityName))
      .map((entry) => `${entry.cls}:${entry.id} missing ${entry.abilityName}`);
    expect(missing).toEqual([]);
  });

  it('every mastery and row option describes a real effect', () => {
    const blank = effects.filter(
      (entry) => entry.render().trim() === NO_EFFECT || entry.render().trim() === '',
    );
    expect(blank.map((entry) => `${entry.cls}:${entry.id}`)).toEqual([]);
  });

  it('the rendered English tooltip states numbers when the effect has any', () => {
    const vague = effects
      .filter(
        (entry) =>
          hasNumericEffect(entry.effect) &&
          !/\d/.test(entry.render()) &&
          !expectedTokens(entry.effect).every((token) => entry.render().includes(token)),
      )
      .map((entry) => `${entry.cls}:${entry.id} -> "${entry.render()}"`);
    expect(vague).toEqual([]);
  });

  it('the tooltip is complete for every number the effect produces', () => {
    const incomplete: string[] = [];
    for (const entry of effects) {
      const text = entry.render();
      const missing = expectedTokens(entry.effect).filter((token) => !text.includes(token));
      if (missing.length) {
        incomplete.push(`${entry.cls}:${entry.id} missing ${missing.join(', ')} in "${text}"`);
      }
    }
    expect(incomplete, incomplete.join('\n')).toEqual([]);
  });

  it('no number in the rendered tooltip contradicts the effect data', () => {
    const bad: string[] = [];
    for (const entry of effects) {
      const legit = legitNumbers(entry.effect);
      const { pcts, bare } = descriptionNumbers(entry.render());
      for (const pct of pcts) {
        if (!legit.has(pct)) bad.push(`${entry.cls}:${entry.id} rendered "${pct}%" not in effect`);
      }
      for (const n of bare) {
        if (!legit.has(n)) bad.push(`${entry.cls}:${entry.id} rendered "${n}" not in effect`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the hand-written source description never states a number the effect does not produce', () => {
    const bad: string[] = [];
    for (const entry of effects) {
      const legit = legitNumbers(entry.effect);
      const { pcts, bare } = descriptionNumbers(entry.source);
      for (const pct of pcts) {
        if (!legit.has(pct)) bad.push(`${entry.cls}:${entry.id} source "${pct}%" not in effect`);
      }
      for (const n of bare) {
        if (!legit.has(n)) bad.push(`${entry.cls}:${entry.id} source "${n}" not in effect`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('regression locks: row and mastery tooltips state their real numbers', () => {
    setLanguage('en');
    const render = (cls: string, id: string) => {
      const entry = effects.find((candidate) => candidate.cls === cls && candidate.id.endsWith(id));
      if (!entry) throw new Error(`no talent entry matched for ${cls}:${id}`);
      return entry.render();
    };

    expect(render('warrior', 'war_row_crushing_charge')).toContain('50%');
    expect(render('warrior', 'war_row_bloodbath')).toContain('25%');
    const survival = render('hunter', 'survival.mastery');
    expect(survival).toContain('Agility');
    expect(survival).toContain('15%');
    // Balance pass: Quickblood is the evasive-skirmisher mastery now.
    expect(survival).toContain('dodge chance by 4%');
  });

  it('localized thorns procs identify the ward and reflected melee strike trigger', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    const entry = effects.find(
      (candidate) =>
        candidate.cls === 'shaman' && candidate.id.endsWith('sha_r5_improved_lightning_shield'),
    );
    if (!entry) throw new Error('missing Improved Thunder Ward talent entry');

    const rendered = entry.render();
    expect(rendered).toContain(tEntity({ kind: 'ability', id: 'lightning_shield', field: 'name' }));
    expect(rendered).toContain(
      'Protege a un aliado para que los atacantes cuerpo a cuerpo se hieran al golpearlo.',
    );
    setLanguage('en');
  });
});
