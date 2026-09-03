import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  MOUNT_SKIN_VISUAL_SPECS,
  MOUNT_VISUAL_SPECS,
  mountSeatLiftFor,
  mountVisualSpec,
  mountVisualSpecFor,
} from '../src/render/mount_visuals';
import {
  isMountSkinId,
  MOUNT_SKIN_IDS,
  MOUNT_SKINS,
  mountPresentationKey,
  mountSkinDef,
  normalizeMountSkinId,
} from '../src/sim/content/mount_skins';
import { MOUNT_KEYS, MOUNTS } from '../src/sim/content/mounts';

// Mount skins are account cosmetics worn OVER a ridden mount: a look, never a
// catalog row. These pins keep the family disjoint from the mount catalog and
// the render specs in lockstep with the sim content.
describe('mount skin catalog', () => {
  it('ships exactly the two converted mounts, in store order', () => {
    expect(MOUNT_SKIN_IDS).toEqual(['mech_bird', 'chimeglass_tortoise']);
    expect(MOUNT_SKINS.mech_bird).toEqual({
      id: 'mech_bird',
      name: 'Cluckwork Mech Bird',
      rarity: 'rare',
      visualKey: 'mount_mech_bird',
      season: 1,
    });
    expect(MOUNT_SKINS.chimeglass_tortoise.rarity).toBe('epic');
    expect(MOUNT_SKINS.chimeglass_tortoise.visualKey).toBe('mount_chimeglass_tortoise');
  });

  it('is disjoint from the mount catalog: a skin id is never a MountKey', () => {
    for (const id of MOUNT_SKIN_IDS) {
      expect(id in MOUNTS).toBe(false);
      expect((MOUNT_KEYS as readonly string[]).includes(id)).toBe(false);
    }
    for (const key of MOUNT_KEYS) expect(isMountSkinId(key)).toBe(false);
  });

  it('carries no speed tier: a skin never changes what the ridden mount does', () => {
    for (const id of MOUNT_SKIN_IDS) {
      expect(Object.keys(MOUNT_SKINS[id]).sort()).toEqual(
        ['id', 'name', 'rarity', 'season', 'visualKey'].sort(),
      );
    }
  });

  it('resolves and normalizes ids strictly', () => {
    expect(mountSkinDef('mech_bird')?.name).toBe('Cluckwork Mech Bird');
    expect(mountSkinDef('valorsteed')).toBeNull();
    expect(mountSkinDef('')).toBeNull();
    expect(normalizeMountSkinId('chimeglass_tortoise')).toBe('chimeglass_tortoise');
    expect(normalizeMountSkinId('valorsteed')).toBeNull();
    expect(normalizeMountSkinId('')).toBeNull();
    expect(normalizeMountSkinId(null)).toBeNull();
    expect(normalizeMountSkinId(undefined)).toBeNull();
    expect(normalizeMountSkinId(7)).toBeNull();
  });
});

describe('mount presentation key (what a ridden mount looks and sounds like)', () => {
  it('is the worn skin while mounted, the mount key otherwise, and empty when dismounted', () => {
    expect(mountPresentationKey('valorsteed', 'mech_bird')).toBe('mech_bird');
    expect(mountPresentationKey('valorsteed', null)).toBe('valorsteed');
    expect(mountPresentationKey('valorsteed', undefined)).toBe('valorsteed');
    // An unknown skin id (a retired skin in an old save) falls back to the mount.
    expect(mountPresentationKey('valorsteed', 'retired_skin')).toBe('valorsteed');
    // Dismounted stays dismounted whatever is worn: no phantom cue set.
    expect(mountPresentationKey('', 'mech_bird')).toBe('');
    expect(mountPresentationKey('', null)).toBe('');
  });
});

describe('mount skin visual specs', () => {
  it('keeps one spec per skin whose visualKey matches the sim record and a lazy GLB', () => {
    expect(Object.keys(MOUNT_SKIN_VISUAL_SPECS).sort()).toEqual([...MOUNT_SKIN_IDS].sort());
    for (const id of MOUNT_SKIN_IDS) {
      const spec = MOUNT_SKIN_VISUAL_SPECS[id];
      expect(spec.visualKey).toBe(MOUNT_SKINS[id].visualKey);
      const def = VISUALS[spec.visualKey];
      expect(def, `VISUALS entry for ${id}`).toBeTruthy();
      expect(def?.lazyPreload).toBe(true);
      expect(def?.url).toBe(`models/mounts/${id}.glb`);
      expect(spec.seat).toBeGreaterThan(0.5);
      // Skins never live in the catalog spec table.
      expect(id in MOUNT_VISUAL_SPECS).toBe(false);
    }
  });

  it('resolves the worn skin over the ridden mount, and the mount alone otherwise', () => {
    const horse = mountVisualSpec('valorsteed');
    expect(horse).not.toBeNull();
    expect(mountVisualSpecFor('valorsteed', null)).toBe(horse);
    expect(mountVisualSpecFor('valorsteed', undefined)).toBe(horse);
    expect(mountVisualSpecFor('valorsteed', 'mech_bird')).toBe(MOUNT_SKIN_VISUAL_SPECS.mech_bird);
    expect(mountVisualSpecFor('grag_bear', 'chimeglass_tortoise')).toBe(
      MOUNT_SKIN_VISUAL_SPECS.chimeglass_tortoise,
    );
    // An unknown skin id is ignored, never a crash or a blank body.
    expect(mountVisualSpecFor('valorsteed', 'retired_skin')).toBe(horse);
    // Dismounted or riding an unknown key resolves to nothing, skin or not.
    expect(mountVisualSpecFor('', 'mech_bird')).toBeNull();
    expect(mountVisualSpecFor('', null)).toBeNull();
    expect(mountVisualSpecFor('not_a_mount', 'mech_bird')).toBeNull();
  });

  it('lifts the rider onto whatever the mount presents as', () => {
    expect(mountSeatLiftFor('valorsteed', null)).toBe(MOUNT_VISUAL_SPECS.valorsteed.seat);
    expect(mountSeatLiftFor('valorsteed', 'chimeglass_tortoise')).toBe(
      MOUNT_SKIN_VISUAL_SPECS.chimeglass_tortoise.seat,
    );
    expect(mountSeatLiftFor('', 'chimeglass_tortoise')).toBe(0);
  });
});
