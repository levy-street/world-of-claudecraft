import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WOC_KEYED_CLIP_NAMES } from '../src/render/characters/woc_keyed_animations';
import {
  buildAllClassSpellCatalogs,
  buildClassSpellCatalog,
  filterSpellCatalogEntries,
  optimalDummyDistanceForSpell,
  SPELL_LAB_LOADOUT_PRESETS,
} from '../src/render/spell_lab';
import { CLASSES } from '../src/sim/content/classes';
import { ROW_TREES } from '../src/sim/content/talent_rows';
import { TALENTS } from '../src/sim/content/talents';
import { ALL_CLASSES } from '../src/sim/types';

const VALID_WOC_CLIPS = new Set<string>([
  ...WOC_KEYED_CLIP_NAMES,
  'Attack',
  'Run',
  'Signature_storm_bolt',
]);

describe('spell_lab_catalog_core', () => {
  it('builds complete catalogs for all 9 classes and all 27 specs with valid WOC animation clips', () => {
    const catalogs = buildAllClassSpellCatalogs('default');
    expect(Object.keys(catalogs).sort()).toEqual([...ALL_CLASSES].sort());

    let totalSpecs = 0;
    for (const cls of ALL_CLASSES) {
      const cat = catalogs[cls];
      expect(cat.cls).toBe(cls);
      expect(cat.specs.length).toBe(3);
      totalSpecs += cat.specs.length;

      const entryIds = new Set(cat.entries.map((e) => e.id));

      // Every class kit ability is present
      for (const abId of CLASSES[cls].abilities) {
        expect(entryIds.has(abId), `${cls} missing class ability ${abId}`).toBe(true);
      }

      // Every spec signature ability is present and tagged as signature
      for (const spec of TALENTS[cls].specs) {
        const sigEntry = cat.entries.find((e) => e.id === spec.signature);
        expect(sigEntry, `${cls}/${spec.id} missing signature ${spec.signature}`).toBeDefined();
        expect(sigEntry?.isSpecSignature).toBe(true);
        expect(sigEntry?.specIds).toContain(spec.id);
      }

      // Every talent choice row ability grant is present
      for (const row of ROW_TREES[cls]) {
        for (const opt of row.options) {
          const granted = opt.effect.grant?.ability;
          if (granted) {
            expect(
              entryIds.has(granted),
              `${cls} row ${row.level} missing talent grant ${granted}`,
            ).toBe(true);
          }
        }
      }

      // Every entry resolves a valid WOC keyed animation clip, VFX metadata, and formatted description
      for (const entry of cat.entries) {
        expect(
          VALID_WOC_CLIPS.has(entry.resolvedClip.split('#')[0]),
          `${cls}:${entry.id} resolved unknown WOC clip "${entry.resolvedClip}"`,
        ).toBe(true);
        if (entry.castLoopClip) {
          expect(
            VALID_WOC_CLIPS.has(entry.castLoopClip.split('#')[0]),
            `${cls}:${entry.id} resolved unknown WOC loop clip "${entry.castLoopClip}"`,
          ).toBe(true);
        }
        expect(entry.vfxArchetype.length).toBeGreaterThan(0);
        expect(entry.vfxSchool.length).toBeGreaterThan(0);
        expect(entry.description).not.toMatch(/\$[dobt]\b/);
      }
    }
    expect(totalSpecs).toBe(27);

    // Spells, heals, shouts, and form abilities resolve to appropriate non-melee clips
    const mage = catalogs.mage;
    expect(mage.entries.find((e) => e.id === 'ice_lance')?.resolvedClip).toBe('Woc_Cast_Shoot');
    expect(mage.entries.find((e) => e.id === 'frost_armor')?.resolvedClip).toBe(
      'Woc_Cast_Omni_Release',
    );
    const paladin = catalogs.paladin;
    const holyLight = paladin.entries.find((e) => e.id === 'holy_light');
    expect(holyLight?.castLoopClip).toBe('Woc_Cast_Omni');
    expect(holyLight?.resolvedClip).toBe('Woc_Cast_Omni_Release');
    expect(paladin.entries.find((e) => e.id === 'dawnfall')?.vfxArchetype).toBe('paladinDawnfall');
    const warrior = catalogs.warrior;
    expect(warrior.entries.find((e) => e.id === 'battle_shout')?.resolvedClip).toBe('Woc_Shout');
    const druid = catalogs.druid;
    expect(druid.entries.find((e) => e.id === 'maul')?.resolvedClip).toBe('Attack');
  });

  it('updates resolved WOC animation clips when switching weapon loadout presets', () => {
    const swordShield = buildClassSpellCatalog('warrior', 'sword_shield');
    const twoHand = buildClassSpellCatalog('warrior', 'twohand_sword');
    const dual = buildClassSpellCatalog('warrior', 'dual_swords');

    expect(swordShield.resolvedLoadout).toBeNull();
    expect(twoHand.resolvedLoadout).toBe('twohand');
    expect(dual.resolvedLoadout).toBe('dual');

    const meleeShield = swordShield.entries.find((e) => e.id === '__auto_melee');
    const meleeDual = dual.entries.find((e) => e.id === '__auto_melee');
    const stanceShield = swordShield.entries.find((e) => e.id === '__pose_combat_idle');
    const stanceDual = dual.entries.find((e) => e.id === '__pose_combat_idle');
    const msShield = swordShield.entries.find((e) => e.id === 'mortal_strike');
    const ms2H = twoHand.entries.find((e) => e.id === 'mortal_strike');
    const msDual = dual.entries.find((e) => e.id === 'mortal_strike');

    expect(meleeShield?.resolvedClip).toBe('Woc_Attack_1H_0');
    expect(meleeDual?.resolvedClip).toBe('Woc_Attack_Offhand_Stab');
    expect(stanceShield?.resolvedClip).toBe('Woc_Combat_Idle_1H');
    expect(stanceDual?.resolvedClip).toBe('Woc_Combat_Idle_Dual');
    expect(msShield?.resolvedClip).toBe('Woc_Attack_2H_0');
    expect(ms2H?.resolvedClip).toBe('Woc_Attack_1H_0');
    expect(msDual?.resolvedClip).toBe('Woc_Attack_Dual');

    expect(SPELL_LAB_LOADOUT_PRESETS.length).toBeGreaterThanOrEqual(8);
  });

  it('filters catalog entries by spec, category, passive toggle, and search query', () => {
    const mage = buildClassSpellCatalog('mage', 'default');

    const fireExclusive = filterSpellCatalogEntries(mage.entries, {
      tab: 'fire',
      specExclusiveOnly: true,
      hidePassives: true,
    });
    expect(fireExclusive.length).toBeGreaterThan(0);
    expect(fireExclusive.every((e) => e.specIds.includes('fire'))).toBe(true);
    expect(fireExclusive.some((e) => e.id === 'pyroblast')).toBe(true);

    const basics = filterSpellCatalogEntries(mage.entries, {
      tab: 'basic',
    });
    expect(basics.some((e) => e.id === '__auto_wand')).toBe(true);
    expect(basics.every((e) => e.category === 'basic')).toBe(true);

    const omniSearch = filterSpellCatalogEntries(mage.entries, {
      tab: 'all',
      query: 'Woc_Cast_Omni',
    });
    expect(omniSearch.length).toBeGreaterThan(0);
  });

  it('computes optimal practice dummy distances for melee, caster, charge, and hunter ranged spells', () => {
    const hunter = buildClassSpellCatalog('hunter', 'default');
    const rangedAuto = hunter.entries.find((e) => e.id === '__auto_ranged');
    const meleeAuto = hunter.entries.find((e) => e.id === '__auto_melee');
    expect(rangedAuto).toBeDefined();
    expect(meleeAuto).toBeDefined();
    if (rangedAuto) expect(optimalDummyDistanceForSpell(rangedAuto)).toBeGreaterThanOrEqual(12);
    if (meleeAuto) expect(optimalDummyDistanceForSpell(meleeAuto)).toBeLessThanOrEqual(4);

    const warrior = buildClassSpellCatalog('warrior', 'default');
    const charge = warrior.entries.find((e) => e.id === 'charge');
    expect(charge).toBeDefined();
    if (charge) expect(optimalDummyDistanceForSpell(charge)).toBeGreaterThanOrEqual(12);
  });

  it('keeps all spell_lab files free of em dashes, en dashes, and emojis', () => {
    const banned = /[\u2013\u2014\u2015]|[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\uFE0F/u;
    const files = [
      'src/render/spell_lab/index.ts',
      'src/render/spell_lab/spell_lab_flag.ts',
      'src/render/spell_lab/spell_lab_catalog_core.ts',
      'src/render/spell_lab/spell_lab_panel.ts',
      'src/render/spell_lab/spell_lab_runtime.ts',
      'src/render/spell_lab/spell_lab_boot.ts',
      'src/render/spell_lab/CLAUDE.md',
    ];
    for (const rel of files) {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(banned.test(text), `${rel} contains banned dash or emoji`).toBe(false);
    }
  });
});
