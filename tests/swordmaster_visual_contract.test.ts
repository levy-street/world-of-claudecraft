import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  mechHeldWeaponOverride,
  SKINS,
  VISUALS,
  visualKeyFor,
} from '../src/render/characters/manifest';
import { isSpinAttackAbility } from '../src/render/characters/weapon_attack_style_core';
import { weaponAuraPlan } from '../src/render/characters/weapon_aura_core';
import { paintWeaponAura } from '../src/render/characters/weapon_aura_painter';
import {
  swordmasterDamageEventVisualPlan,
  swordmasterDamageVisualPlan,
  swordmasterSpellVisualPlan,
} from '../src/render/swordmaster_fx_core';
import { SwordmasterFxPainter } from '../src/render/swordmaster_fx_painter';
import { CLASS_DETAILS, SIGNATURE_ABILITIES } from '../src/ui/class_details_data';
import { hasCrestRecipe } from '../src/ui/icons';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');
const signatureShotsScript = readFileSync(
  new URL('../scripts/signature_shots.mjs', import.meta.url),
  'utf8',
);
const assetPipelineScript = readFileSync(
  new URL('../scripts/asset_pipeline/pipeline.mjs', import.meta.url),
  'utf8',
);

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function classRows(entry: string): string[][] {
  return [
    ...entry.matchAll(/<(?:div|ul) class="mini-class-row"[^>]*>([\s\S]*?)<\/(?:div|ul)>/g),
  ].map((match) => [...match[1].matchAll(/data-class="([^"]+)"/g)].map((button) => button[1]));
}

describe('SwordMaster character presentation', () => {
  it('resolves to its own cyan dual-sword rig instead of the Warrior fallback', () => {
    expect(visualKeyFor({ kind: 'player', templateId: 'swordmaster' } as never)).toBe(
      'player_swordmaster',
    );

    const visual = VISUALS.player_swordmaster;
    expect(visual.url).toBe('models/chars/players/rogue.glb');
    expect(visual.tint).toBe(0x22d3ee);
    expect(visual.attach).toEqual([
      { url: 'models/weapons/sword_1handed.glb', bone: 'handslot.r' },
      { url: 'models/weapons/sword_1handed.glb', bone: 'handslot.l' },
    ]);
    expect(visual.weaponSlots).toEqual([0]);
    expect(visual.offhandSlot).toBe(1);
    expect(mechHeldWeaponOverride('swordmaster' as never)).toMatchObject({
      weaponSlots: [0],
      offhandSlot: 1,
    });
    expect(SKINS.player_swordmaster).toEqual(SKINS.player_rogue);
  });

  it('routes fast dual-wield, double-cut, aura, and spin abilities to authored clips', () => {
    expect(VISUALS.player_swordmaster.clips.attack).toEqual([
      'Dualwield_Melee_Attack_Chop',
      '1H_Melee_Attack_Slice_Diagonal',
    ]);
    expect(VISUALS.player_swordmaster.clips.attackByHand).toEqual({
      dualwield: 'Dualwield_Melee_Attack_Chop',
    });
    expect(VISUALS.player_swordmaster.clips.attackByAbility).toMatchObject({
      twin_slash: 'Dualwield_Melee_Attack_Chop',
      duelist_flurry: 'Dualwield_Melee_Attack_Chop',
      crescent_sweep: '1H_Melee_Attack_Slice_Diagonal',
      sword_aura: 'Spellcast_Raise',
      blade_dance: 'Dualwield_Melee_Attack_Chop',
      blade_cyclone: 'Dualwield_Melee_Attack_Chop',
    });
    expect(isSpinAttackAbility('blade_dance')).toBe(true);
    expect(isSpinAttackAbility('blade_cyclone')).toBe(true);
    expect(isSpinAttackAbility('twin_slash')).toBe(false);
  });
});

describe('SwordMaster procedural VFX plans', () => {
  it('imbues both SwordMaster weapons blue while preserving Sanguine green mainhand', () => {
    expect(weaponAuraPlan([{ id: 'sword_aura' }])).toMatchObject({
      id: 'sword_aura',
      color: 0x22d3ee,
      slots: [0, 1],
    });
    expect(weaponAuraPlan([{ id: 'sanguine_aura' }])).toMatchObject({
      id: 'sanguine_aura',
      color: 0x45ff9a,
      slots: [0],
    });
    expect(weaponAuraPlan([{ id: 'sanguine_aura' }, { id: 'sword_aura' }])?.id).toBe('sword_aura');
    expect(weaponAuraPlan([], 'sword_aura')).toMatchObject({
      id: 'sword_aura_cast',
      color: 0x67e8f9,
      slots: [0, 1],
      opacity: 0.24,
    });
    expect(weaponAuraPlan([{ id: 'sanguine_aura' }], 'sword_aura')?.id).toBe('sword_aura_cast');
    expect(weaponAuraPlan([])).toBeNull();
  });

  it('paints and disposes both live Sword Aura hand shells', () => {
    const model = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.1, 1, 0.1);
    for (const [slot, tag] of [
      [0, 'swapWeaponHolder'],
      [1, 'swapOffhandHolder'],
    ] as const) {
      const holder = new THREE.Group();
      holder.userData[tag] = true;
      holder.userData.heldSlot = slot;
      const weapon = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      weapon.userData.weaponMesh = true;
      holder.add(weapon);
      model.add(holder);
    }

    const swordPlan = weaponAuraPlan([{ id: 'sword_aura' }]);
    expect(swordPlan).not.toBeNull();
    if (!swordPlan) throw new Error('Sword Aura plan missing');
    const handle = paintWeaponAura(model, swordPlan);
    expect(handle.meshCount).toBe(2);
    expect(
      model.children.map((holder) =>
        holder.children.filter((child) => child.userData.weaponAuraId),
      ),
    ).toEqual([
      [
        expect.objectContaining({
          userData: expect.objectContaining({ weaponAuraId: 'sword_aura' }),
        }),
      ],
      [
        expect.objectContaining({
          userData: expect.objectContaining({ weaponAuraId: 'sword_aura' }),
        }),
      ],
    ]);

    handle.dispose();
    expect(model.children.flatMap((holder) => holder.children)).toHaveLength(2);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material.dispose();
      }
    });
    geometry.dispose();
  });

  it('distinguishes double cuts from source-centered sword sweeps', () => {
    for (const abilityId of ['twin_slash', 'twin_finisher', 'duelist_flurry']) {
      expect(swordmasterDamageVisualPlan(abilityId)).toMatchObject({
        kind: 'twin-cut',
        anchor: 'target',
        color: 0x22d3ee,
        arcs: 2,
      });
    }
    expect(swordmasterDamageVisualPlan('crescent_sweep')).toMatchObject({
      kind: 'sweep',
      anchor: 'source',
      color: 0x22d3ee,
      radius: 6,
    });
    expect(swordmasterDamageVisualPlan('blade_dance')).toMatchObject({
      kind: 'cyclone',
      anchor: 'source',
      color: 0x22d3ee,
      radius: 7,
    });
    expect(swordmasterDamageVisualPlan('blade_cyclone')).toMatchObject({
      kind: 'cyclone',
      anchor: 'source',
      color: 0x22d3ee,
      radius: 9,
    });
    expect(swordmasterDamageVisualPlan('heroic_strike')).toBeNull();
  });

  it('paints area arcs from activation even without a hit and excludes later damage events', () => {
    expect(swordmasterSpellVisualPlan('flourish', 'crescent_sweep')).toMatchObject({
      kind: 'sweep',
      anchor: 'source',
    });
    expect(swordmasterSpellVisualPlan('flourish', 'blade_cyclone')).toMatchObject({
      kind: 'cyclone',
      anchor: 'source',
    });
    expect(swordmasterSpellVisualPlan('nova', 'blade_cyclone')).toBeNull();
    expect(swordmasterDamageEventVisualPlan('blade_cyclone')).toBeNull();
    expect(swordmasterDamageEventVisualPlan('twin_slash')).toMatchObject({
      kind: 'twin-cut',
      anchor: 'target',
    });
  });

  it('paints one two-arc pair for the paired mainhand and offhand damage events', () => {
    const scene = new THREE.Scene();
    const painter = new SwordmasterFxPainter(scene, (entityId, heightFraction) =>
      entityId === 1
        ? new THREE.Vector3(0, heightFraction * 2, 0)
        : new THREE.Vector3(2, heightFraction * 2, 0),
    );
    const plan = swordmasterDamageVisualPlan('twin_slash');
    if (!plan) throw new Error('Twin Slash VFX plan missing');

    painter.paint(plan, 1, 2);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(2);
    painter.paint(plan, 1, 2);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(2);

    painter.update(plan.duration + 0.01);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(0);
    painter.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('orients a source-centered Crescent Sweep to the live player facing', () => {
    const scene = new THREE.Scene();
    const painter = new SwordmasterFxPainter(
      scene,
      (_entityId, heightFraction) => new THREE.Vector3(0, heightFraction * 2, 0),
    );
    const plan = swordmasterDamageVisualPlan('crescent_sweep');
    if (!plan) throw new Error('Crescent Sweep VFX plan missing');
    const facing = Math.PI * 0.75;

    painter.paint(plan, 1, 1, facing);

    const arc = scene.children.find((child) => child.visible);
    expect(arc?.rotation.z).toBeCloseTo(facing, 8);
    painter.dispose();
  });
});

describe('SwordMaster character selector surface', () => {
  it('ships the class in online and offline selectors with the canonical color', () => {
    expect(occurrences(indexHtml, 'data-class="swordmaster"')).toBe(2);
    expect(occurrences(playHtml, 'data-class="swordmaster"')).toBe(1);
    for (const entry of [indexHtml, playHtml]) {
      expect(entry).toContain('data-i18n="classes.swordmaster"');
      expect(entry).toContain('data-i18n-aria="classes.swordmasterAria"');
    }
    expect(shellCss).toContain('[data-class="swordmaster"]');
    expect(shellCss).toContain('--class-color: #22d3ee');
    for (const row of [...classRows(indexHtml), ...classRows(playHtml)]) {
      expect(row).toHaveLength(10);
      expect(new Set(row).size).toBe(10);
      expect(row).toContain('swordmaster');
    }
    expect(shellCss).toContain('width: min(966px, calc(100vw - 32px))');
    expect(shellCss).toMatch(
      /mini-class\[data-class="swordmaster"\][\s\S]*?font-size: 11px;[\s\S]*?white-space: nowrap;/,
    );
    expect(shellCss).toMatch(
      /body\.mobile-touch #charcreate-panel \.mini-class-row\s*\{\s*grid-template-columns: repeat\(2/,
    );
    expect(shellCss).toMatch(
      /body\.mobile-touch #offline-select \.mini-class-row\s*\{\s*grid-template-columns: repeat\(2/,
    );
  });

  it('uses existing localized gear labels, three real signatures, and a bespoke crest', () => {
    expect(CLASS_DETAILS.swordmaster).toEqual({
      roleKey: 'classDetails.roles.swordmaster',
      roleType: 'dps',
      armorKey: 'classDetails.armor.leatherCloth',
      weaponsKey: 'classDetails.weapons.twinOneHanders',
    });
    expect(SIGNATURE_ABILITIES.swordmaster).toEqual([
      'crescent_sweep',
      'sword_aura',
      'blade_cyclone',
    ]);
    expect(hasCrestRecipe('class_swordmaster')).toBe(true);
  });

  it('registers SwordMaster with visual capture and asset-pipeline tooling', () => {
    expect(signatureShotsScript).toMatch(
      /swordmaster:\s*\[\s*\['tempest', 'blade_cyclone'\],\s*\['duelist', 'duelist_flurry'\],\s*\['azure_blade', 'azure_rush'\],\s*\]/,
    );
    expect(assetPipelineScript).toMatch(/swordmaster:\s*'rogue'/);
  });
});
