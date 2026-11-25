// Direct unit pins for src/ui/ability_tooltip_view.ts, the ability and aura
// effect tooltip builders the HUD (Hud.abilityTooltip / Hud.auraEffectTooltipHtml)
// and the public encyclopedia (scripts/mediawiki/ability_hover.ts) share.
//
// The in-game path passes the live character, which is a different shape per
// world: the offline Sim hands a full createPlayer Entity, while the online
// ClientWorld mirror starts from blankEntity and may lack default-zero fields
// (an absent spellHaste) and the aura school the wire does not carry. Both
// shapes are driven here, against literal English output.
import { describe, expect, it } from 'vitest';
import { blankEntity } from '../src/net/blank_entity';
import { ABILITIES } from '../src/sim/data';
import { createPlayer } from '../src/sim/entity';
import type { ResolvedAbility } from '../src/sim/resolved_ability';
import type { AbilityDef, Aura, Entity } from '../src/sim/types';
import { abilityTooltipHtml, auraEffectTooltipHtml } from '../src/ui/ability_tooltip_view';

/** Rank-1 resolve of a def, the shape the HUD passes for an untalented ability. */
function resolved(def: AbilityDef): ResolvedAbility {
  return {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: def.threat?.flat ?? 0,
    threatMult: def.threat?.mult ?? 1,
    charges: def.maxCharges,
  };
}

/** The offline Sim's player: a real createPlayer Entity with its stat set. */
function offlinePlayer(spellHaste: number): Entity {
  const p = createPlayer(1, 'paladin', { x: 0, y: 0, z: 0 }, 'Offline');
  p.spellHaste = spellHaste;
  return p;
}

/** A spell-haste buff aura as the online mirror carries it: no school field. */
function mirroredHasteAura(value: number): Aura {
  return {
    id: 'qa_haste_buff',
    name: 'QA Haste',
    kind: 'buff_spellhaste',
    remaining: 10,
    duration: 10,
    value,
    sourceId: 2,
  } as Aura;
}

/** The online ClientWorld mirror: blankEntity with spellHaste omitted. */
function mirrorPlayer(auras: Aura[]): Entity {
  const p = blankEntity(2);
  delete (p as Partial<Entity>).spellHaste;
  p.auras = auras;
  return p;
}

const HOLY_LIGHT = resolved(ABILITIES.holy_light);

describe('abilityTooltipHtml cast line', () => {
  it('pins the unhasted base: Mending Light is a 1.5 sec cast', () => {
    expect(ABILITIES.holy_light.castTime).toBe(1.5);
    expect(abilityTooltipHtml(HOLY_LIGHT, 'mana', null)).toContain(
      '<div class="tt-stat">1.5 sec cast</div>',
    );
  });

  it('divides the cast time by the offline player spell haste', () => {
    const html = abilityTooltipHtml(HOLY_LIGHT, 'mana', null, offlinePlayer(0.5));
    expect(html).toContain('<div class="tt-stat">1 sec cast</div>');
    expect(html).not.toContain('1.5 sec cast');
  });

  it('folds buff_spellhaste auras on top of the stat haste', () => {
    const p = offlinePlayer(0.25);
    p.auras = [mirroredHasteAura(0.25)];
    expect(abilityTooltipHtml(HOLY_LIGHT, 'mana', null, p)).toContain(
      '<div class="tt-stat">1 sec cast</div>',
    );
  });

  it('reads an absent mirrored spellHaste as zero, never NaN, and keeps aura haste', () => {
    const bare = abilityTooltipHtml(HOLY_LIGHT, 'mana', null, mirrorPlayer([]));
    expect(bare).toContain('<div class="tt-stat">1.5 sec cast</div>');
    expect(bare).not.toContain('NaN');
    const hasted = abilityTooltipHtml(
      HOLY_LIGHT,
      'mana',
      null,
      mirrorPlayer([mirroredHasteAura(0.25)]),
    );
    expect(hasted).toContain('<div class="tt-stat">1.2 sec cast</div>');
  });

  it('floors a net-negative haste at zero like the sim', () => {
    expect(abilityTooltipHtml(HOLY_LIGHT, 'mana', null, offlinePlayer(-0.5))).toContain(
      '<div class="tt-stat">1.5 sec cast</div>',
    );
  });
});

describe('abilityTooltipHtml no-character path', () => {
  it('renders the reference card with title, rank, cost and range but no haste', () => {
    const html = abilityTooltipHtml(HOLY_LIGHT, 'mana', null);
    expect(html.startsWith('<div class="tt-title">Mending Light</div>')).toBe(true);
    expect(html).toContain('<div class="tt-sub">Rank 1</div>');
    expect(html).toContain('<div class="tt-stat">25 Mana &nbsp; 30 yd range</div>');
    expect(html).toContain('<div class="tt-sub">Friendly target</div>');
    expect(html).not.toMatch(/\b(?:undefined|NaN)\b/);
  });

  it('labels the cost with the resource the caller passes', () => {
    expect(abilityTooltipHtml(HOLY_LIGHT, 'energy', null)).toContain('25 Energy');
    // A null resource falls back to Mana.
    expect(abilityTooltipHtml(HOLY_LIGHT, null, null)).toContain('25 Mana');
  });
});

describe('abilityTooltipHtml aura effect line', () => {
  const SHIELD = resolved(ABILITIES.lightning_shield);

  it('resolves the thorns school from the source ability on the public path', () => {
    expect(ABILITIES.lightning_shield.school).toBe('nature');
    const html = abilityTooltipHtml(SHIELD, 'mana', null);
    expect(html).toContain('<div class="tt-effect">Deals 13 Nature damage to attackers</div>');
    expect(html).not.toContain('{school}');
  });

  it('resolves the same school with an online mirror character', () => {
    expect(abilityTooltipHtml(SHIELD, 'mana', null, mirrorPlayer([]))).toContain(
      '<div class="tt-effect">Deals 13 Nature damage to attackers</div>',
    );
  });
});

describe('abilityTooltipHtml spec requirement line', () => {
  const AMBUSH = resolved(ABILITIES.ambush);
  const SKULDUGGERY_LINE =
    '<div class="tt-sub">Requires stealth (not needed at 3 Gloam or during the Shadow Veil)</div>';
  const PLAIN_LINE = '<div class="tt-sub">Requires stealth</div>';

  it('shows the Skulduggery stealth bypass only for the subtlety spec', () => {
    const html = abilityTooltipHtml(AMBUSH, 'energy', 'subtlety');
    expect(html).toContain(SKULDUGGERY_LINE);
    expect(html).not.toContain(PLAIN_LINE);
  });

  it('shows the plain stealth line for another spec and for no spec', () => {
    for (const spec of ['assassination', null]) {
      const html = abilityTooltipHtml(AMBUSH, 'energy', spec);
      expect(html, String(spec)).toContain(PLAIN_LINE);
      expect(html, String(spec)).not.toContain('Shadow Veil');
    }
  });

  it('retires the stealth line when the resolved ability ignores it', () => {
    const html = abilityTooltipHtml(
      { ...AMBUSH, ignoreStealthRequirement: true },
      'energy',
      'subtlety',
    );
    expect(html).not.toContain('Requires stealth');
  });
});

describe('auraEffectTooltipHtml', () => {
  it('prefers the source ability school over the aura school', () => {
    // The online buff frame mirrors a wrong or default school; the ability id wins.
    expect(
      auraEffectTooltipHtml({
        kind: 'thorns',
        value: 13,
        school: 'physical',
        id: 'lightning_shield',
      }),
    ).toBe('<div class="tt-effect">Deals 13 Nature damage to attackers</div>');
  });

  it('falls back to the aura school when no source ability resolves', () => {
    expect(auraEffectTooltipHtml({ kind: 'thorns', value: 7, school: 'fire' })).toBe(
      '<div class="tt-effect">Deals 7 Fire damage to attackers</div>',
    );
    expect(
      auraEffectTooltipHtml({ kind: 'thorns', value: 7, school: 'frost', id: 'qa_unknown' }),
    ).toBe('<div class="tt-effect">Deals 7 Frost damage to attackers</div>');
  });

  it('renders nothing for a kind with no effect descriptor', () => {
    expect(auraEffectTooltipHtml({ kind: 'qa_not_a_kind' as Aura['kind'], value: 1 })).toBe('');
  });
});
