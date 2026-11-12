// The Shift-held ability detail block (src/ui/ability_tooltip_detail_core.ts).
//
// The load-bearing claim is the scaling line: "Includes +N from your <stat>".
// The sweep below walks EVERY ability every class knows at max level in every
// spec and proves, for each effect that shows a bonus, that the named stat is
// the ONLY stat that bonus reads (keeping just that stat reproduces the whole
// bonus) and that the bonus moves when that stat moves (two power values, as
// docs/design/tooltip-writing.md requires for a scaling claim).
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { classSpecs, computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL } from '../src/sim/types';
import {
  type AbilityScaling,
  abilityDamageBonus,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilitySecondaryEffect,
} from '../src/ui/ability_damage';
import { abilityEffectText } from '../src/ui/ability_description';
import {
  type AbilityScalingStat,
  abilityScalingStatFor,
  abilityTooltipDetailLines,
} from '../src/ui/ability_tooltip_detail_core';

const SCALING: AbilityScaling = {
  spellPower: 210,
  healPower: 170,
  attackPower: 540,
  rangedPower: 460,
};

function only(stat: AbilityScalingStat, value: number): AbilityScaling {
  return { spellPower: 0, healPower: 0, attackPower: 0, rangedPower: 0, [stat]: value };
}

function everyKnownAbility(): { label: string; res: ResolvedAbility }[] {
  const out: { label: string; res: ResolvedAbility }[] = [];
  for (const cls of ALL_CLASSES) {
    const specs: (string | null)[] = [null, ...classSpecs(cls)];
    for (const spec of specs) {
      const mods = spec
        ? computeTalentModifiers(cls, { ...emptyAllocation(), spec } as never)
        : undefined;
      for (const known of abilitiesKnownAt(cls, MAX_LEVEL, mods)) {
        out.push({ label: `${cls}/${spec ?? 'none'}/${known.def.id}`, res: known });
      }
    }
  }
  return out;
}

describe('abilityScalingStatFor names the one stat combat reads', () => {
  const all = everyKnownAbility();

  it('covers a real spread of scaling abilities', () => {
    const scaled = all.filter(({ res }) => {
      const eff = abilityPrimaryEffect(res) ?? abilitySecondaryEffect(res);
      return eff !== undefined && abilityDamageBonus(res, eff, SCALING) > 0;
    });
    // Every class has scaling abilities; a collapse here means the sweep broke.
    expect(scaled.length).toBeGreaterThan(50);
  });

  it('for every scaling effect: the named stat alone reproduces the bonus and moves it', () => {
    const failures: string[] = [];
    for (const { label, res } of all) {
      const effects = [
        abilityPrimaryEffect(res) ?? abilitySecondaryEffect(res),
        abilityOverTimeEffect(res),
      ];
      for (const eff of effects) {
        if (!eff) continue;
        const bonus = abilityDamageBonus(res, eff, SCALING);
        if (bonus <= 0) continue;
        const stat = abilityScalingStatFor(res, eff, SCALING);
        if (!stat) {
          failures.push(`${label} ${eff.type}: bonus ${bonus} but no stat named`);
          continue;
        }
        const alone = abilityDamageBonus(res, eff, only(stat, SCALING[stat]));
        if (alone !== bonus) {
          failures.push(`${label} ${eff.type}: ${stat} alone gives ${alone}, full gives ${bonus}`);
        }
        const doubled = abilityDamageBonus(res, eff, only(stat, SCALING[stat] * 2));
        if (!(doubled > alone)) {
          failures.push(`${label} ${eff.type}: doubling ${stat} did not raise the bonus`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

function knownFor(cls: (typeof ALL_CLASSES)[number], id: string, spec?: string): ResolvedAbility {
  const mods = spec
    ? computeTalentModifiers(cls, { ...emptyAllocation(), spec } as never)
    : undefined;
  const known = abilitiesKnownAt(cls, MAX_LEVEL, mods).find((k) => k.def.id === id);
  if (!known) throw new Error(`missing ${cls} ability ${id}`);
  return known;
}

describe('abilityTooltipDetailLines', () => {
  it('Fireball: school and a Spell Power scaling line with the live rating', () => {
    const lines = abilityTooltipDetailLines(knownFor('mage', 'fireball'), SCALING);
    expect(lines).toContain('School: Fire');
    expect(lines.some((l) => /^Includes \+\d+ from your Spell Power \(210\)$/.test(l))).toBe(true);
  });

  it('a pure heal over time names Healing Power and states its tick cadence', () => {
    const res = knownFor('druid', 'rejuvenation');
    const hot = abilityOverTimeEffect(res);
    expect(hot?.type).toBe('hot');
    const lines = abilityTooltipDetailLines(res, SCALING);
    expect(lines.some((l) => l.includes('from your Healing Power (170)'))).toBe(true);
    if (!hot) return;
    const ticks = Math.round(hot.duration / hot.interval);
    expect(lines).toContain(
      `${ticks} ticks, one every ${hot.interval} sec over ${hot.duration} sec`,
    );
  });

  it('no scaling line at all when the character has no power', () => {
    const none: AbilityScaling = { spellPower: 0, healPower: 0, attackPower: 0, rangedPower: 0 };
    const lines = abilityTooltipDetailLines(knownFor('mage', 'fireball'), none);
    expect(lines.some((l) => l.startsWith('Includes'))).toBe(false);
  });

  it('every known AoE states its radius from the resolved effect', () => {
    const areas = everyKnownAbility().filter(({ res }) =>
      res.effects.some(
        (e) =>
          (e.type === 'aoeDamage' || e.type === 'aoeHeal' || e.type === 'groundAoE') &&
          e.radius > 0,
      ),
    );
    expect(areas.length).toBeGreaterThan(5);
    for (const { label, res } of areas) {
      const area = res.effects.find(
        (e) => e.type === 'aoeDamage' || e.type === 'aoeHeal' || e.type === 'groundAoE',
      ) as { radius: number };
      expect(abilityTooltipDetailLines(res, SCALING), label).toContain(`Radius: ${area.radius} yd`);
    }
  });

  it('ground zones, Frostglobe and channels never state a derived tick count', () => {
    // Their live pulse count does not follow duration / interval (a delayed
    // zone skips the on-cast pulse; Aether Darts changes its dart count), so
    // the detail block must say nothing rather than risk an off-by-one.
    const pulsed = everyKnownAbility().filter(
      ({ res }) =>
        res.def.channel !== undefined ||
        res.effects.some((e) => e.type === 'groundAoE' || e.type === 'frozenOrb'),
    );
    expect(pulsed.length).toBeGreaterThan(3);
    for (const { label, res } of pulsed) {
      if (abilityOverTimeEffect(res)) continue; // an aura rider keeps its own tick line
      const lines = abilityTooltipDetailLines(res, SCALING);
      expect(
        lines.some((l) => l.includes('ticks')),
        label,
      ).toBe(false);
    }
  });

  it('the Shift bonus always equals the "(+N)" the description shows for $d', () => {
    // Every class and spec, so ranked damageMult (Shadow Bolt) and the v0.42
    // spec factors are both in play. The description and the detail block
    // must name the same number, or say nothing in the details.
    let compared = 0;
    for (const { label, res } of everyKnownAbility()) {
      const shown = /\(\+([^)]+)\)/.exec(abilityEffectText(res, SCALING))?.[1];
      const detail = abilityTooltipDetailLines(res, SCALING)
        .map((l) => /^Includes \+(\S+) from/.exec(l)?.[1])
        .find((n) => n !== undefined);
      if (shown === undefined) continue;
      expect(detail, label).toBe(shown);
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('Shadow Bolt below max rank: the bonus carries the rank damageMult', () => {
    const res = knownFor('warlock', 'shadow_bolt');
    const bolt = abilityPrimaryEffect(res);
    if (bolt?.type !== 'directDamage') throw new Error('shadow_bolt has no direct hit');
    const ranked: ResolvedAbility = {
      ...res,
      effects: res.effects.map((e) => (e === bolt ? { ...bolt, damageMult: 0.8 } : e)),
    };
    const raw = abilityDamageBonus(ranked, bolt, SCALING);
    const lines = abilityTooltipDetailLines(ranked, SCALING);
    expect(lines.some((l) => l.startsWith(`Includes +${Math.round(raw * 0.8)} `))).toBe(true);
    expect(lines.some((l) => l.startsWith(`Includes +${raw} `))).toBe(false);
  });

  it('a spec healing factor on a pure HoT drops the separate bonus line', () => {
    // Restoration Druid scales the whole Rejuvenation tick, so the
    // description shows one combined total and the bonus cannot be split out.
    const lines = abilityTooltipDetailLines(
      knownFor('druid', 'rejuvenation', 'restoration'),
      SCALING,
    );
    expect(lines.some((l) => l.startsWith('Includes'))).toBe(false);
  });

  it('Dawnweave prayers fold into one combined heal, so no separate bonus line', () => {
    const res = knownFor('priest', 'prayer_of_healing', 'holy');
    const plain = abilityTooltipDetailLines(res, SCALING);
    expect(plain.some((l) => l.startsWith('Includes'))).toBe(true);
    const prepared = abilityTooltipDetailLines(res, {
      ...SCALING,
      auras: [{ id: 'priest_benison_prayers', stacks: 2 }],
    });
    expect(prepared.some((l) => l.startsWith('Includes'))).toBe(false);
  });

  it('charges show the resolved total cap, never cap plus bonus', () => {
    const charged = everyKnownAbility().filter(({ res }) => (res.charges ?? 1) > 1);
    expect(charged.length).toBeGreaterThan(3);
    for (const { label, res } of charged) {
      expect(abilityTooltipDetailLines(res, SCALING), label).toContain(`Charges: ${res.charges}`);
    }
    // An unlearned Talents preview has no resolved cap yet: the def's max.
    const preview = knownFor('warrior', 'overpower');
    const { charges: _c, bonusCharges: _b, ...unresolved } = preview;
    expect(abilityTooltipDetailLines(unresolved as ResolvedAbility, SCALING)).toContain(
      `Charges: ${preview.def.maxCharges}`,
    );
  });

  it('a damage-and-heal ability also names the Healing Power behind its heal half', () => {
    // Same numbers ability_description.test.ts pins for the {healing} splice.
    const scaling = { spellPower: 80, healPower: 200, attackPower: 0, rangedPower: 0 };
    const mercy = abilityTooltipDetailLines(
      knownFor('priest', 'scouring_mercy', 'discipline'),
      scaling,
    );
    expect(mercy).toContain('Includes +171 from your Healing Power (200)');
    const spore = abilityTooltipDetailLines(knownFor('druid', 'spore_burst', 'balance'), scaling);
    expect(spore.some((l) => l.endsWith('from your Healing Power (200)'))).toBe(true);
    expect(spore).toContain('Radius: 8 yd');
  });

  it('baseline pushback immunity (Ghost Wolf, uninterruptible channels) is stated', () => {
    const wolf = knownFor('shaman', 'ghost_wolf');
    // Bladestorm is a talent pick, so resolve its definition directly.
    const def = ABILITIES.bladestorm;
    const storm: ResolvedAbility = {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    for (const res of [wolf, storm]) {
      expect(res.damagePushbackImmune, res.def.id).not.toBe(true);
      expect(abilityTooltipDetailLines(res, SCALING), res.def.id).toContain(
        'Taking damage does not delay this cast',
      );
    }
  });

  it('threat lines come from the resolved threat fields only', () => {
    const base = knownFor('mage', 'fireball');
    expect(abilityTooltipDetailLines(base, SCALING).some((l) => l.includes('threat'))).toBe(false);
    const lines = abilityTooltipDetailLines({ ...base, threatMult: 2, threatFlat: 40 }, SCALING);
    expect(lines).toContain('Ability threat modifier: 200%');
    expect(lines).toContain('Bonus threat: +40');
  });
});
