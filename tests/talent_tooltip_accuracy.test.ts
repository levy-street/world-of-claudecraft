import { beforeAll, describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { classAbilityNames } from '../src/ui/i18n.catalog/abilities';
import { grantAbilityMetadata, grantAbilityValues, tTalent } from '../src/ui/talent_i18n';

// Talent descriptions are generated from effect data outside English. English remains
// authored source text, so this suite keeps it numerically honest against the effect
// records that power specs, masteries, and the new choice rows.

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
  'critDmgPct',
  'dotDmgPct',
  'hotHealPct',
  'absorbPct',
  'critVsRooted',
  'spellHastePct',
  'petDmgPct',
  'petDmgSharePct',
  'secondWindPctPerSec',
  'secondWindHpBelow',
  'fearBreakPct',
  'onKillSpeedPct',
  'autoRagePct',
  'abilityRagePct',
  'battleRhythmRagePct',
  'battleRhythmDmgPct',
  'bloodbathPct',
  'bloodbathMaxPct',
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
      if (typeof value === 'number') {
        if (value === 0) continue;
        if (key === 'battleRhythm') continue;
        if (key === 'critDmgPct' && value === 0.5) {
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
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (key === 'battleRhythm') continue;
        add(value, PCT_FIELDS.has(key));
        // Cheat death leaves the player at 1 health: the floor is intrinsic to
        // the mechanic, so copy may state the 1.
        if (key === 'cheatDeathIcd') out.add(1);
        if (key === 'bonusCharges') out.add(value + 1);
        // A slow mult also legitimizes the stated slow percentage (mult 0.5 = 50%).
        if (key === 'mult' && value > 0 && value < 1) out.add(Math.round((1 - value) * 100));
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

const NO_EFFECT = 'Provides a specialization benefit.';

describe('talent tooltip accuracy for specs, masteries, and choice rows', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    await ensureLocaleLoaded('es');
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

    expect(render('warrior', 'war_r5_crushing_onrush')).toContain('50%');
    expect(render('warrior', 'war_r17_red_harvest')).toContain('any health');
    const survival = render('hunter', 'survival.mastery');
    expect(survival).toContain('Agility');
    expect(survival).toContain('15%');
    expect(survival).toContain('physical ability damage');
  });

  it('grant tooltips include localized cost, cast or channel, range, and cooldown metadata', () => {
    setLanguage('en');
    expect(grantAbilityMetadata('stormthrow')).toBe(
      '20 Rage · Instant · 20 yd range · 30 sec cooldown',
    );
    expect(grantAbilityMetadata('bladestorm')).toBe(
      '25 Rage · Channeled (4 sec) · 60 sec cooldown',
    );
    expect(grantAbilityMetadata('counter_shot')).toBe(
      '35 Mana · Instant · 8-35 yd range · 20 sec cooldown',
    );

    const option = CHOICE_ROWS.warrior.rows
      .flatMap((row) => row.options)
      .find((choice) => choice.id === 'war_r11_stormthrow');
    if (!option) throw new Error('missing Stormthrow choice');
    expect(tTalent({ kind: 'talentChoice', choice: option, field: 'description' })).toContain(
      grantAbilityMetadata('stormthrow'),
    );
  });

  it('extracts every defining value used by complex granted-ability descriptions', () => {
    setLanguage('en');
    expect(grantAbilityValues('holy_shield')).toMatchObject({
      min: '90',
      max: '110',
      damage: '90 to 110',
      jumps: '2',
      falloff: '70%',
      radius: '10',
    });
    expect(grantAbilityValues('aura_surge')).toMatchObject({
      min: '100',
      max: '120',
      damage: '100 to 120',
      jumps: '2',
      falloff: '75%',
      radius: '10',
      duration: '2',
    });
    expect(grantAbilityValues('evocation')).toMatchObject({ amount: '220' });
    expect(grantAbilityValues('meteor')).toMatchObject({
      damage: '100 to 130',
      overTime: '12 to 18',
      interval: '2',
      duration: '6',
      radius: '8',
    });
    expect(grantAbilityValues('avenging_wrath')).toMatchObject({
      attackPower: '60',
      spellPower: '30',
      duration: '20',
    });
    expect(grantAbilityValues('bloodlust')).toMatchObject({ buff: '30%', duration: '15' });
    expect(grantAbilityValues('aspect_of_the_wild')).toMatchObject({
      buff: '45',
      duration: '300',
      radius: '30',
    });
    expect(grantAbilityValues('frenzied_regeneration')).toMatchObject({
      damage: '180',
      duration: '10',
    });
  });

  it('falls back atomically when generated locale prose cannot express the complete effect', () => {
    const option = (cls: 'warrior' | 'hunter' | 'rogue', id: string) => {
      const found = CHOICE_ROWS[cls].rows
        .flatMap((row) => row.options)
        .find((choice) => choice.id === id);
      if (!found) throw new Error(`missing ${id}`);
      return found;
    };

    setLanguage('es');
    for (const choice of [
      option('warrior', 'war_r8_crippling_strikes'),
      option('hunter', 'hun_r5_improved_serpent_sting'),
      option('rogue', 'rog_r5_opportunist'),
    ]) {
      expect(tTalent({ kind: 'talentChoice', choice, field: 'description' })).toBe(
        choice.description,
      );
    }

    setLanguage('en');
  });

  it('English grant catalog states the complete shipped mechanics', () => {
    const abilities = classAbilityNames.en.entities.abilities;
    const renderCatalogDescription = (id: string) => {
      const template = abilities[id]?.description;
      if (!template) throw new Error(`missing English ability catalog entry for ${id}`);
      const values = grantAbilityValues(id);
      return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
        const value = values[name];
        return value === undefined ? match : String(value);
      });
    };
    expect(abilities.aura_surge).toEqual({
      name: 'Dawnward Ricochet',
      description:
        'Hurl a dawnforged aegis for {damage} Holy damage, silencing the primary target for 2 sec, then bouncing to up to {jumps} additional enemies within {radius} yards for {falloff} damage per bounce. (Paladin talent)',
    });
    expect(abilities.lingering_dread).toEqual({
      name: 'Lingering Dread',
      description:
        "Unleash a battle cry that fears enemies within 10 yards for 4 sec. The fear endures up to 20% of each target's maximum health in damage. (Warrior talent)",
    });
    expect(abilities.evocation.description).toBe('Instantly restores 220 mana. (Mage talent)');
    expect(abilities.meteor.description).toContain('12 to 18 Fire damage every 2 sec for 6 sec');
    expect(abilities.frenzied_regeneration.description).toBe(
      'Regenerates 180 health over 10 sec. Bruin Form only. (Druid talent)',
    );
    expect(abilities.tranquility.description).toBe(
      'Channels for 4 sec, healing you and allies within 30 yd for 42 to 52 each second. (Druid talent)',
    );

    expect(renderCatalogDescription('frenzied_regeneration')).toBe(
      'Regenerates 180 health over 10 sec. Bruin Form only. (Druid talent)',
    );
    expect(renderCatalogDescription('healing_stream')).toBe(
      'Restores 120 health to a friendly target over 12 sec. (Shaman talent)',
    );
    expect(renderCatalogDescription('tranquility')).toBe(
      'Channels for 4 sec, healing you and allies within 30 yd for 42 to 52 each second. (Druid talent)',
    );
  });
});
