import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { directHitBonus } from '../src/sim/spell_scaling';
import type { Entity } from '../src/sim/types';
import { abilityDamageBonus } from '../src/ui/ability_damage';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { impactCueForDamage, spellFxCue } from '../src/ui/combat_sfx';
import { tEntity } from '../src/ui/entity_i18n';
import { abilityIconRecipe, abilityImageUrl, hasExplicitAbilityIcon } from '../src/ui/icons';

describe('Void Rupture presentation', () => {
  it.each([0, 140])('shows the live instant damage at %i Spell Power', (spellPower) => {
    const res = abilitiesKnownAt('priest', 20, { ...emptyModifiers(), spec: 'shadow' }).find(
      (ability) => ability.def.id === 'void_rupture',
    );
    expect(res).toBeDefined();
    if (!res) throw new Error('Void Rupture missing from Shadow spellbook');
    const hit = res.effects.find((effect) => effect.type === 'directDamage');
    if (hit?.type !== 'directDamage') throw new Error('Void Rupture direct hit missing');
    const scaling = { spellPower, healPower: 0, attackPower: 0, rangedPower: 0 };
    const bonus = directHitBonus(spellPower, res.def, res.castTime);
    expect(abilityDamageBonus(res, hit, scaling)).toBe(bonus);
    const damage = abilityEffectText(res, scaling);
    const text = abilityDisplayDescription(res, damage, scaling);
    expect(text).toContain(`${damage} Shadow damage`);
    expect(text).toContain('Consume 3 Gloomtithe charges');
    expect(text).toContain('even if resisted');
    expect(text).toContain('Spell Power');
    expect(text).not.toMatch(/\{damage\}|\$d/);
    expect(tEntity({ kind: 'ability', id: 'void_rupture', field: 'name' })).toBe('Void Rupture');
  });

  it('uses painted art with a distinct fractured-eye fallback glyph', () => {
    expect(hasExplicitAbilityIcon('void_rupture')).toBe(true);
    expect(abilityImageUrl('void_rupture')).toBe('/ui/skills/priest/void_rupture.webp');
    const glyph = abilityIconRecipe('void_rupture');
    for (const id of ['mind_blast', 'vampiric_touch', 'spirit_bomb', 'summon_tithefiend']) {
      expect(glyph).not.toEqual(abilityIconRecipe(id));
    }
  });

  it('plays one shadow impact for damage without a duplicate sound on the visual tick', () => {
    expect(
      impactCueForDamage(
        {
          type: 'damage',
          sourceId: 1,
          targetId: 2,
          amount: 36,
          crit: false,
          kind: 'hit',
          school: 'shadow',
          abilityId: 'void_rupture',
          ability: 'Void Rupture',
        },
        { kind: 'mob', templateId: 'wolf' } as Entity,
      ),
    ).toBe('impact_shadow');
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'tick',
        ability: 'void_rupture',
      }),
    ).toBeNull();
  });
});
