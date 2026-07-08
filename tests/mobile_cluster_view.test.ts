import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import {
  CLUSTER_PLACEHOLDER_IDS,
  CLUSTER_ROLES,
  type ClusterSourceSlot,
  clusterMapEquals,
  deriveClusterMap,
  DRUID_FORM_CORE_KITS,
  emptyClusterMap,
  MOBILE_CORE_KITS,
  OVERRIDABLE_CLUSTER_ROLES,
  parseClusterOverrides,
  resolveMobileCoreKit,
} from '../src/ui/mobile_cluster_view';

const ability = (barSlot: number, abilityId?: string): ClusterSourceSlot => ({
  barSlot,
  kind: 'ability',
  abilityId,
});
const potion = (barSlot: number): ClusterSourceSlot => ({ barSlot, kind: 'potion' });
const other = (barSlot: number): ClusterSourceSlot => ({ barSlot, kind: 'other' });

const noForms = { form1: null, form2: null, form3: null };
const formToggles = ['bear_form', 'cat_form', 'travel_form'];

// Flatten a class's real ability roster (learn order) the way hud.ts seeds the
// default bar: for druids, form abilities plus the shapeshift toggles; for
// everyone else, the whole kit.
const barFor = (cls: keyof typeof CLASSES, form: 'bear' | 'cat' | 'normal'): ClusterSourceSlot[] =>
  CLASSES[cls].abilities
    .filter((id) => {
      if (formToggles.includes(id)) return true;
      const requires = ABILITIES[id]?.requiresForm;
      return form === 'normal' ? !requires : requires === form;
    })
    .map((id, i) => ability(i + 1, id));

describe('deriveClusterMap without a kit', () => {
  it('maps an empty bar to attack-toggle-only (every other role null)', () => {
    expect(deriveClusterMap([])).toEqual({
      attack: 0,
      skill1: null,
      skill2: null,
      skill3: null,
      utility: null,
      potion: null,
      ...noForms,
    });
  });

  it('fills skill1..3 in bar order, spills the next ability into utility', () => {
    expect(deriveClusterMap([ability(1), ability(2), ability(3), ability(4)])).toEqual({
      attack: 0,
      skill1: 1,
      skill2: 2,
      skill3: 3,
      utility: 4,
      potion: null,
      ...noForms,
    });
  });

  it('never lets non-ability bindings claim a button and picks the first potion slot', () => {
    expect(deriveClusterMap([other(1), ability(2), potion(3), potion(4)])).toEqual({
      attack: 0,
      skill1: 2,
      skill2: null,
      skill3: null,
      utility: null,
      potion: 3,
      ...noForms,
    });
  });

  it('routes shapeshift toggles onto the form buttons, never the skills', () => {
    const map = deriveClusterMap([
      ability(1, 'bear_form'),
      ability(2, 'wrath'),
      ability(3, 'cat_form'),
      ability(4, 'travel_form'),
    ]);
    expect([map.form1, map.form2, map.form3]).toEqual([1, 3, 4]);
    expect(map.skill1).toBe(2);
    expect([map.skill2, map.skill3, map.utility]).toEqual([null, null, null]);
  });
});

describe('deriveClusterMap with a curated kit', () => {
  const kit = {
    attack: ['basic'],
    skills: ['spam', 'control'],
    utility: ['heal'],
  };

  it('maps the curated basic attack onto the big button and keeps it exclusive', () => {
    const map = deriveClusterMap([ability(1, 'basic'), ability(2, 'spam')], kit);
    expect(map.attack).toBe(1);
    expect(map.skill1).toBe(2);
    expect([map.skill2, map.skill3]).toEqual([null, null]);
  });

  it('keeps attack 0 (the auto-attack toggle) when no curated attack is on the bar', () => {
    expect(deriveClusterMap([ability(1, 'spam')], kit).attack).toBe(0);
  });

  it('prefers curated skills in kit order over bar order', () => {
    const map = deriveClusterMap(
      [ability(1, 'filler'), ability(2, 'control'), ability(3, 'spam')],
      kit,
    );
    expect([map.skill1, map.skill2, map.skill3]).toEqual([3, 2, 1]);
  });

  it('prefers the curated utility and falls back to the next unclaimed ability', () => {
    expect(deriveClusterMap([ability(1, 'spam'), ability(2, 'heal')], kit).utility).toBe(2);
    const map = deriveClusterMap(
      [ability(1, 'spam'), ability(2, 'a'), ability(3, 'b'), ability(4, 'c'), ability(5, 'd')],
      kit,
    );
    expect(map.utility).not.toBeNull();
    expect([map.skill1, map.skill2, map.skill3]).not.toContain(map.utility);
  });

  it('placeholder candidates simply fall through to the next candidate', () => {
    const map = deriveClusterMap([ability(1, 'wrath')], {
      attack: ['moonkin_strike', 'wrath'],
      skills: [],
      utility: [],
    });
    expect(map.attack).toBe(1);
  });

  it('never double-books a bar slot across roles', () => {
    const map = deriveClusterMap([ability(1, 'spam')], {
      attack: ['spam'],
      skills: ['spam'],
      utility: ['spam'],
    });
    expect(map.attack).toBe(1);
    expect(map.skill1).toBeNull();
    expect(map.utility).toBeNull();
  });
});

describe('deriveClusterMap with per-player overrides', () => {
  const kit = {
    attack: ['basic'],
    skills: ['s1', 's2', 's3'],
    utility: ['heal'],
  };
  const bar = [
    ability(1, 'basic'),
    ability(2, 's1'),
    ability(3, 's2'),
    ability(4, 's3'),
    ability(5, 'heal'),
    ability(6, 'extra'),
  ];

  it('an override wins its exact role position', () => {
    const map = deriveClusterMap(bar, kit, { skill2: 'extra' });
    expect(map.skill2).toBe(6);
    // the remaining positions compact-fill from the curated list in kit order
    expect(map.skill1).toBe(2);
    expect(map.skill3).toBe(3);
  });

  it('attack and utility overrides win over the curated kit', () => {
    const map = deriveClusterMap(bar, kit, { attack: 'extra', utility: 's3' });
    expect(map.attack).toBe(6);
    expect(map.utility).toBe(4);
  });

  it('overrides for abilities not on the bar are ignored (curated default applies)', () => {
    const map = deriveClusterMap(bar, kit, { skill1: 'not_learned' });
    expect(map.skill1).toBe(2);
  });

  it('a form toggle can never be bound as an override', () => {
    const withToggle = [...bar, ability(7, 'bear_form')];
    const map = deriveClusterMap(withToggle, kit, { skill1: 'bear_form' });
    expect(map.skill1).toBe(2);
    expect(map.form1).toBe(7);
  });
});

describe('parseClusterOverrides', () => {
  it('keeps only valid role -> ability-id string pairs', () => {
    expect(
      parseClusterOverrides({
        skill1: 'fireball',
        potion: 'nope',
        form1: 'bear_form',
        attack: 42,
        utility: '',
        junk: 'x',
      }),
    ).toEqual({ skill1: 'fireball' });
    expect(parseClusterOverrides(null)).toBeNull();
    expect(parseClusterOverrides('str')).toBeNull();
    expect(parseClusterOverrides({ skill1: 'bear_form' })).toBeNull();
  });

  it('covers every overridable role', () => {
    const all = Object.fromEntries(OVERRIDABLE_CLUSTER_ROLES.map((r) => [r, 'x']));
    expect(parseClusterOverrides(all)).toEqual(all);
  });
});

describe('resolveMobileCoreKit', () => {
  it('is form-aware for druids and form-blind for everyone else', () => {
    expect(resolveMobileCoreKit('druid', 'bear')).toBe(DRUID_FORM_CORE_KITS.bear);
    expect(resolveMobileCoreKit('druid', 'cat')).toBe(DRUID_FORM_CORE_KITS.cat);
    expect(resolveMobileCoreKit('druid', 'normal')).toBe(MOBILE_CORE_KITS.druid);
    // unknown forms (e.g. a future one) fall back to the caster kit
    expect(resolveMobileCoreKit('druid', 'stealth')).toBe(MOBILE_CORE_KITS.druid);
    expect(resolveMobileCoreKit('rogue', 'stealth')).toBe(MOBILE_CORE_KITS.rogue);
    expect(resolveMobileCoreKit('gnome_inventor', 'normal')).toBeNull();
  });
});

describe('every class resolves a full RoV cluster from its real default bar', () => {
  it('maps a curated basic attack, three skills, and a utility for all classes', () => {
    for (const cls of Object.keys(CLASSES) as (keyof typeof CLASSES)[]) {
      const bar = barFor(cls, 'normal');
      const map = deriveClusterMap(bar, resolveMobileCoreKit(cls, 'normal'));
      const idAt = (slot: number | null) =>
        bar.find((s) => s.barSlot === slot)?.abilityId ?? null;
      expect(map.attack, `${cls} basic attack is an ability`).toBeGreaterThan(0);
      for (const role of ['skill1', 'skill2', 'skill3', 'utility'] as const) {
        expect(map[role], `${cls} ${role} mapped`).not.toBeNull();
        expect(formToggles, `${cls} ${role} is not a toggle`).not.toContain(idAt(map[role]));
      }
      // all mapped ability roles are distinct bar slots
      const slots = [map.attack, map.skill1, map.skill2, map.skill3, map.utility];
      expect(new Set(slots).size).toBe(slots.length);
    }
  });
});

describe('druid form kits derive full clusters from the real form bars', () => {
  it('caster form: Wrath basic attack, Moonfire first skill, Rejuvenation utility', () => {
    const bar = barFor('druid', 'normal');
    const map = deriveClusterMap(bar, resolveMobileCoreKit('druid', 'normal'));
    const idAt = (slot: number | null) => bar.find((s) => s.barSlot === slot)?.abilityId;
    expect(idAt(map.attack)).toBe('wrath');
    expect(idAt(map.skill1)).toBe('moonfire');
    expect(idAt(map.skill2)).toBe('starfire'); // starsurge placeholder falls through
    expect(idAt(map.utility)).toBe('rejuvenation'); // swiftmend placeholder falls through
  });

  it('bear form: Maul basic attack, Growl utility, three real skills', () => {
    const bar = barFor('druid', 'bear');
    const map = deriveClusterMap(bar, resolveMobileCoreKit('druid', 'bear'));
    const idAt = (slot: number | null) => bar.find((s) => s.barSlot === slot)?.abilityId;
    expect(idAt(map.attack)).toBe('maul');
    expect(idAt(map.skill1)).toBe('swipe'); // mangle placeholder falls through
    expect(idAt(map.utility)).toBe('growl');
    expect(map.skill2).not.toBeNull();
    expect(map.skill3).not.toBeNull();
  });

  it('cat form: Claw basic attack, Rake/Rip skills, Dash utility', () => {
    const bar = barFor('druid', 'cat');
    const map = deriveClusterMap(bar, resolveMobileCoreKit('druid', 'cat'));
    const idAt = (slot: number | null) => bar.find((s) => s.barSlot === slot)?.abilityId;
    expect(idAt(map.attack)).toBe('claw');
    expect(idAt(map.skill1)).toBe('rake'); // shred placeholder falls through
    expect(idAt(map.skill2)).toBe('rip');
    expect(idAt(map.utility)).toBe('dash');
  });

  it('forms map to disjoint, fully-populated clusters with shapeshift buttons', () => {
    for (const form of ['bear', 'cat', 'normal'] as const) {
      const bar = barFor('druid', form);
      const map = deriveClusterMap(bar, resolveMobileCoreKit('druid', form));
      const slots = [
        map.attack,
        map.skill1,
        map.skill2,
        map.skill3,
        map.utility,
        map.form1,
        map.form2,
        map.form3,
      ].filter((s) => s !== null && s !== 0);
      expect(new Set(slots).size).toBe(slots.length);
      expect(map.attack).toBeGreaterThan(0);
      expect(map.form1).not.toBeNull();
      const idAt = (slot: number | null) => bar.find((s) => s.barSlot === slot)?.abilityId ?? '';
      for (const skill of [map.skill1, map.skill2, map.skill3]) {
        expect(formToggles).not.toContain(idAt(skill));
      }
    }
  });
});

describe('curated kit content', () => {
  const allKits = [
    ...Object.entries(MOBILE_CORE_KITS),
    ...Object.entries(DRUID_FORM_CORE_KITS).map(([form, kit]) => [`druid:${form}`, kit] as const),
  ];

  it('every curated id is a real ability or a documented placeholder', () => {
    for (const [name, kit] of allKits) {
      for (const id of [...(kit.attack ?? []), ...kit.skills, ...kit.utility]) {
        const real = ABILITIES[id] !== undefined;
        const placeholder = CLUSTER_PLACEHOLDER_IDS.has(id);
        expect(real || placeholder, `${name}: ${id} is real or a documented placeholder`).toBe(
          true,
        );
      }
    }
  });

  it('every role list resolves to at least one real ability (no dead buttons)', () => {
    for (const [name, kit] of allKits) {
      const lists: [string, readonly string[]][] = [
        ['skills', kit.skills],
        ['utility', kit.utility],
      ];
      if (kit.attack) lists.push(['attack', kit.attack]);
      for (const [role, ids] of lists) {
        expect(
          ids.some((id) => ABILITIES[id] !== undefined),
          `${name} ${role} has a real candidate`,
        ).toBe(true);
      }
    }
  });

  it('covers every class, and real curated ids belong to that class kit', () => {
    for (const cls of Object.keys(CLASSES)) {
      const kit = MOBILE_CORE_KITS[cls];
      expect(kit, `class ${cls} has a curated cluster kit`).toBeDefined();
      const classKit = CLASSES[cls as keyof typeof CLASSES].abilities;
      for (const id of [...(kit.attack ?? []), ...kit.skills, ...kit.utility]) {
        if (CLUSTER_PLACEHOLDER_IDS.has(id)) continue;
        expect(classKit, `${cls} kit contains ${id}`).toContain(id);
      }
    }
  });

  it("druid form kits only reference that form's real abilities (or placeholders)", () => {
    for (const form of ['bear', 'cat'] as const) {
      const kit = DRUID_FORM_CORE_KITS[form];
      for (const id of [...(kit.attack ?? []), ...kit.skills, ...kit.utility]) {
        if (CLUSTER_PLACEHOLDER_IDS.has(id)) continue;
        expect(
          ABILITIES[id]?.requiresForm,
          `druid:${form} candidate ${id} requires that form`,
        ).toBe(form);
      }
    }
  });
});

describe('clusterMapEquals', () => {
  it('compares every role', () => {
    for (const role of CLUSTER_ROLES) {
      const a = emptyClusterMap();
      const b = emptyClusterMap();
      b[role] = 7;
      expect(clusterMapEquals(a, b)).toBe(false);
    }
    expect(clusterMapEquals(emptyClusterMap(), emptyClusterMap())).toBe(true);
  });
});
