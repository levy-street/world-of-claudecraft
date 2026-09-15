import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IGNIVAR_FRONTAL_VISUAL_NAME,
  IGNIVAR_SKYFIRE_VISUAL_NAME,
} from '../src/render/ignivar_encounter';
import { ignivarEncounterVisualPlan } from '../src/render/ignivar_encounter_core';
import {
  disposeRaidEncounterVisuals,
  raidEncounterEntityWantsTelegraph,
  syncRaidEncounterAnchorVisuals,
  syncRaidEncounterRigVisuals,
} from '../src/render/raid_encounter_visuals';
import { VARKHUL_BRAND_VISUAL_NAME } from '../src/render/varkhul_encounter';
import { varkhulEncounterVisualPlan } from '../src/render/varkhul_encounter_core';
import type { Vfx } from '../src/render/vfx';
import * as ignivarConstants from '../src/sim/encounters/ignivar';
import { IGNIVAR_FRONTAL_CAST_ID } from '../src/sim/encounters/ignivar';
import * as varkhulConstants from '../src/sim/encounters/varkhul';
import { VARKHUL_MAKERS_BRAND_AURA_ID } from '../src/sim/encounters/varkhul';
import * as chainConstants from '../src/sim/ignivar_forge_chains';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../src/sim/ignivar_forge_chains';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';
import * as pyreConstants from '../src/sim/varkhul_shared_pyre';

// syncRaidEncounterRigVisuals used to run the Ignivar and Varkhul telegraph
// syncs for every character rig on every frame, each a handful of recursive
// getObjectByName walks of the rig subtree, in zones with no raid boss and no
// telegraph anywhere (3.1 percent of the main thread with one rig, 5.9 percent
// with 51, on the iGPU campaign's profiles). A rig outside an encounter must
// pay nothing; a rig that carries or needs a telegraph must behave exactly as
// before.

const vfx = undefined as unknown as Vfx;

function rig(children = 40): { group: THREE.Group; bodyRoot: THREE.Group } {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'body';
  let parent: THREE.Object3D = bodyRoot;
  for (let i = 0; i < children; i++) {
    const bone = new THREE.Object3D();
    bone.name = `bone${i}`;
    parent.add(bone);
    if (i % 4 === 3) parent = bone;
  }
  group.add(bodyRoot);
  return { group, bodyRoot };
}

const idlePlayer = { kind: 'player', templateId: 'player', castingAbility: null, auras: [] };
const idleMob = { kind: 'mob', templateId: 'fire_elemental', castingAbility: null, auras: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('raid telegraph rig walk', () => {
  it('walks nothing for a rig outside an encounter', () => {
    const { group, bodyRoot } = rig();
    const walks = vi.spyOn(THREE.Object3D.prototype, 'getObjectByName');
    const entities = new Map();
    // Presentation running, presentation skipped (the culled-body escape),
    // and a plain mob: none of them may walk the rig.
    syncRaidEncounterRigVisuals(group, idlePlayer, 0.1, vfx, bodyRoot, true, true, entities, false);
    syncRaidEncounterRigVisuals(
      group,
      idlePlayer,
      0.1,
      vfx,
      bodyRoot,
      false,
      false,
      entities,
      false,
    );
    syncRaidEncounterRigVisuals(group, idleMob, 0.1, vfx, bodyRoot, true, true, entities, false);
    // The anchor pass runs the player chain sync for every player every
    // frame; without a chain ever attached it must not walk either.
    const views = new Map();
    syncRaidEncounterAnchorVisuals(group, idlePlayer, views, 0.1, vfx, entities, false, true);
    syncRaidEncounterAnchorVisuals(group, idlePlayer, views, 0.1, vfx, entities, false, false);
    expect(walks).not.toHaveBeenCalled();
    expect(group.children).toHaveLength(1);
  });

  it('admits every player aura either encounter plan attaches a telegraph for', () => {
    // The predicate duplicates the aura ids the two plans read; a sixth mark
    // added to a plan but not here would silently never attach. Every
    // *_AURA_ID identifier the two core modules read is tried on a player,
    // and any the plans turn into a telegraph must be admitted.
    const cores = [
      readFileSync(new URL('../src/render/ignivar_encounter_core.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/render/varkhul_encounter_core.ts', import.meta.url), 'utf8'),
    ].join('\n');
    const names = new Set(cores.match(/\b[A-Z0-9_]+_AURA_ID\b/g) ?? []);
    expect(names.size).toBeGreaterThanOrEqual(5);
    const constants: Record<string, unknown> = {
      ...ignivarConstants,
      ...varkhulConstants,
      ...chainConstants,
      ...pyreConstants,
    };
    for (const name of names) {
      const id = constants[name];
      expect(typeof id, name).toBe('string');
      const player = {
        ...idlePlayer,
        id: 1,
        auras: [{ id: id as string, stacks: 3, remaining: 5, duration: 10, value2: 2 }],
      };
      const ignivar = ignivarEncounterVisualPlan(player);
      const varkhul = varkhulEncounterVisualPlan(player);
      const attaches =
        ignivar.branded ||
        varkhul.cinderOrbsVisible ||
        varkhul.makersBrandStacks > 0 ||
        varkhul.sharedPyreVisible ||
        id === IGNIVAR_FORGE_CHAINS_AURA_ID;
      if (attaches) expect(raidEncounterEntityWantsTelegraph(player), name).toBe(true);
    }
    // The set is not vacuous: the five known marks are among the names.
    for (const known of [
      'IGNIVAR_BRAND_AURA_ID',
      'IGNIVAR_FORGE_CHAINS_AURA_ID',
      'VARKHUL_CINDER_ORBS_AURA_ID',
      'VARKHUL_MAKERS_BRAND_AURA_ID',
      'VARKHUL_SHARED_PYRE_AURA_ID',
    ]) {
      expect(names.has(known), known).toBe(true);
    }
  });

  it('names exactly the entities the encounter syncs attach telegraphs to', () => {
    expect(raidEncounterEntityWantsTelegraph(idlePlayer)).toBe(false);
    expect(raidEncounterEntityWantsTelegraph(idleMob)).toBe(false);
    expect(raidEncounterEntityWantsTelegraph({ ...idleMob, templateId: IGNIVAR_BOSS_ID })).toBe(
      true,
    );
    expect(
      raidEncounterEntityWantsTelegraph({
        ...idlePlayer,
        auras: [{ id: VARKHUL_MAKERS_BRAND_AURA_ID, stacks: 1 }],
      }),
    ).toBe(true);
    // The aura ids are per kind: a mob carrying a player mark attaches nothing.
    expect(
      raidEncounterEntityWantsTelegraph({
        ...idleMob,
        auras: [{ id: VARKHUL_MAKERS_BRAND_AURA_ID, stacks: 1 }],
      }),
    ).toBe(false);
  });

  it('attaches the boss telegraphs and keeps syncing them once the cast ends', () => {
    const { group, bodyRoot } = rig();
    const entities = new Map();
    const casting = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_FRONTAL_CAST_ID,
      castRemaining: 1.2,
      castTotal: 2.4,
      auras: [],
    };
    syncRaidEncounterRigVisuals(group, casting, 0.1, vfx, bodyRoot, true, true, entities, false);
    const frontal = group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME) as THREE.Group;
    expect(frontal.visible).toBe(true);
    expect(group.getObjectByName(IGNIVAR_SKYFIRE_VISUAL_NAME)).toBeDefined();

    // Cast over, body culled: the sync still runs so the telegraph is put away.
    const idleBoss = { ...casting, castingAbility: null };
    syncRaidEncounterRigVisuals(group, idleBoss, 0.1, vfx, bodyRoot, false, false, entities, false);
    expect(frontal.visible).toBe(false);
    // And the boss keeps its sync for the rest of its life: a new cast shows
    // the same telegraph again without a rebuild.
    syncRaidEncounterRigVisuals(group, casting, 0.1, vfx, bodyRoot, true, true, entities, false);
    expect(group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME)).toBe(frontal);
    expect(frontal.visible).toBe(true);
  });

  it('keeps syncing a player rig after its mark ends, until the view is disposed', () => {
    const { group, bodyRoot } = rig();
    const entities = new Map();
    const marked = {
      ...idlePlayer,
      auras: [{ id: VARKHUL_MAKERS_BRAND_AURA_ID, stacks: 2, remaining: 5, duration: 8 }],
    };
    syncRaidEncounterRigVisuals(group, marked, 0.1, vfx, bodyRoot, true, true, entities, false);
    const brand = group.getObjectByName(VARKHUL_BRAND_VISUAL_NAME) as THREE.Group;
    expect(brand.visible).toBe(true);

    // Mark gone: the entity no longer asks for a telegraph, but the attached
    // one must still be synced (hidden), exactly as before the skip existed.
    syncRaidEncounterRigVisuals(group, idlePlayer, 0.1, vfx, bodyRoot, true, true, entities, false);
    expect(brand.visible).toBe(false);

    // Disposal (the view is pooled or dropped) clears the mark, so the pooled
    // group walks nothing again for its next idle tenant.
    disposeRaidEncounterVisuals(group);
    expect(group.getObjectByName(VARKHUL_BRAND_VISUAL_NAME)).toBeUndefined();
    const walks = vi.spyOn(THREE.Object3D.prototype, 'getObjectByName');
    syncRaidEncounterRigVisuals(group, idlePlayer, 0.1, vfx, bodyRoot, true, true, entities, false);
    expect(walks).not.toHaveBeenCalled();
  });

  it('marks a group whose telegraphs were attached by the rigless anchor pass', () => {
    const group = new THREE.Group();
    const views = new Map();
    const entities = new Map();
    const casting = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_FRONTAL_CAST_ID,
      castRemaining: 1.2,
      castTotal: 2.4,
      auras: [],
    };
    syncRaidEncounterAnchorVisuals(group, casting, views, 0.1, vfx, entities, false, false);
    const frontal = group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME) as THREE.Group;
    expect(frontal.visible).toBe(true);
    // The rig arrives after the cast ended: the rig sync still owns the
    // attached telegraph and puts it away.
    const bodyRoot = new THREE.Group();
    group.add(bodyRoot);
    const idleBoss = { ...casting, castingAbility: null };
    syncRaidEncounterRigVisuals(group, idleBoss, 0.1, vfx, bodyRoot, false, false, entities, false);
    expect(frontal.visible).toBe(false);
  });
});
