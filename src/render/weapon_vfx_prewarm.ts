import * as THREE from 'three';
import { setRenderCategory } from './renderer_diagnostics';
import {
  buildWeaponVfxPrewarmSkinGroup,
  disposeWeaponVfxPrewarmSkinGroups,
  WEAPON_VFX_PREWARM_KEYS,
} from './weapon_vfx';

/**
 * Owns the aggregate scene group used by the streamed weapon-skin prewarm
 * units. The renderer still owns when the group is compiled, while this
 * helper owns deduplication and the per-unit failure cleanup.
 *
 * The failure boundary is ONE SKIN, matching the unit boundary. The resume
 * lane reports errors per unit, so releasing the whole catalog on a single
 * failure would dispose the already-linked programs of every skin staged
 * before it (three drops a program with its last material), silently no-op
 * every remaining compile unit, and let the later build units re-stage into
 * a fresh group: dispose-then-relink churn in live frames, which is the very
 * stall class the streamed units exist to remove.
 */
export interface WeaponVfxPrewarmSkinStage {
  readonly group: THREE.Group | null;
  get(key: string): THREE.Group | undefined;
  stage(key: string): THREE.Group;
  /** Release only what the named resume unit owns. Unknown ids, and the
   *  shared-texture unit that owns no skin group, release nothing: the skins
   *  already staged stay valid and keep their linked programs. */
  disposeFailedUnit(unitId: string): void;
  dispose(): void;
}

/** The per-skin resume unit ids, the only two that own a staged skin group. */
const SKIN_UNIT_ID = /^weapon-skins:(?:build|compile):(.+)$/;

/** The skin key a resume unit owns, or null when it owns no skin group. */
export function weaponVfxPrewarmSkinUnitKey(unitId: string): string | null {
  return SKIN_UNIT_ID.exec(unitId)?.[1] ?? null;
}

export function createWeaponVfxPrewarmSkinStage(scene: THREE.Scene): WeaponVfxPrewarmSkinStage {
  let group: THREE.Group | null = null;
  const skinGroups = new Map<string, THREE.Group>();

  const ensureGroup = (): THREE.Group => {
    if (group) return group;
    group = new THREE.Group();
    group.name = 'weapon-vfx-program-prewarm';
    group.position.set(0, -1000, 0);
    group.visible = false;
    setRenderCategory(group, 'prewarm');
    scene.add(group);
    return group;
  };

  const clear = (releaseResources: boolean): void => {
    if (releaseResources) disposeWeaponVfxPrewarmSkinGroups(skinGroups.values());
    skinGroups.clear();
    if (!group) return;
    scene.remove(group);
    group.clear();
    group = null;
  };

  const releaseSkin = (key: string): void => {
    const skinGroup = skinGroups.get(key);
    if (!skinGroup) return;
    skinGroups.delete(key);
    group?.remove(skinGroup);
    disposeWeaponVfxPrewarmSkinGroups([skinGroup]);
  };

  return {
    get group() {
      return group;
    },
    get: (key) => skinGroups.get(key),
    stage: (key) => {
      const existing = skinGroups.get(key);
      if (existing) return existing;
      const aggregate = ensureGroup();
      const skinGroup = buildWeaponVfxPrewarmSkinGroup(key);
      aggregate.add(skinGroup);
      skinGroups.set(key, skinGroup);
      return skinGroup;
    },
    disposeFailedUnit: (unitId) => {
      const key = weaponVfxPrewarmSkinUnitKey(unitId);
      if (key !== null) releaseSkin(key);
    },
    // A successful prewarm intentionally keeps materials alive so their
    // linked programs remain cached. Removing the hidden group is enough.
    dispose: () => clear(false),
  };
}

/** One bounded piece of the streamed weapon-skin prewarm. */
export interface WeaponVfxPrewarmUnit {
  id: string;
  run: () => void | Promise<void>;
}

/** What the unit plan needs from the renderer. */
export interface WeaponVfxPrewarmUnitHost {
  /** Upload the catalog's shared sprite textures. */
  prewarmTextures: () => void;
  /** Link one staged skin group's colour programs. */
  compile: (group: THREE.Group) => Promise<void>;
  /** Publish the aggregate group back to the renderer's own bookkeeping. */
  publishGroup: (group: THREE.Group | null) => void;
}

/**
 * The resume plan: build one real catalog spec per unit, upload the shared
 * textures once between the phases, then link one spec per unit.
 *
 * The old single `weapon-skins:group` unit built every catalog spec
 * synchronously AFTER the loading cover had gone away, which is what made the
 * measured 534 ms resume unit a live-frame hitch. Splitting it per skin is what
 * lets a deadline drop resume in idle time instead of rerunning the lot; the
 * aggregate group stays hidden and remains the compile census owner for any
 * later world compile debt. The per-skin ids are also the failure boundary
 * (see `disposeFailedUnit`), so the two must keep the same shape.
 */
export function weaponVfxPrewarmUnits(
  stage: WeaponVfxPrewarmSkinStage,
  host: WeaponVfxPrewarmUnitHost,
  keys: readonly string[] = WEAPON_VFX_PREWARM_KEYS,
): WeaponVfxPrewarmUnit[] {
  return [
    ...keys.map((key) => ({
      id: `weapon-skins:build:${key}`,
      run: () => {
        stage.stage(key);
        host.publishGroup(stage.group);
      },
    })),
    { id: 'weapon-skins:textures', run: () => host.prewarmTextures() },
    ...keys.map((key) => ({
      id: `weapon-skins:compile:${key}`,
      run: async () => {
        const skinGroup = stage.get(key);
        if (skinGroup) await host.compile(skinGroup);
      },
    })),
  ];
}
