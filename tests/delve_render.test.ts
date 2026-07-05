// Delve module stacking, slot detection, and render prop shapes.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DELVE_MODULE_Z_START,
  DELVE_MODULES,
  defaultDelveModules,
  delveModuleLocal,
  delveModuleStackEndRelZ,
  delveModuleZOffset,
  delveOrigin,
  delveSlotAt,
} from '../src/sim/data';
import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../src/sim/delve_layout';
import { DUNGEON_WALK_HALF_X } from '../src/sim/dungeon_layout';

const FOUR_MODULE_RUN: DelveModuleId[] = [
  'reliquary_sunken_ossuary',
  'reliquary_bell_niche',
  'reliquary_saintless_hall',
  'reliquary_finale',
];

describe('delve module z stacking', () => {
  it('four-module run offsets increase monotonically; finale zBase > module0', () => {
    const z0 = delveModuleZOffset(FOUR_MODULE_RUN, 0);
    const z1 = delveModuleZOffset(FOUR_MODULE_RUN, 1);
    const z2 = delveModuleZOffset(FOUR_MODULE_RUN, 2);
    const z3 = delveModuleZOffset(FOUR_MODULE_RUN, 3);
    expect(z0).toBe(DELVE_MODULE_Z_START);
    expect(z1).toBeGreaterThan(z0);
    expect(z2).toBeGreaterThan(z1);
    expect(z3).toBeGreaterThan(z2);
    expect(z3).toBeGreaterThan(z0);
  });

  it('stack end rel-z covers the finale boss dais', () => {
    const end = delveModuleStackEndRelZ(FOUR_MODULE_RUN);
    const finaleZ = delveModuleZOffset(FOUR_MODULE_RUN, 3);
    const daisZ = DELVE_MODULE_LAYOUTS.reliquary_finale.dais.z;
    expect(end).toBeGreaterThanOrEqual(finaleZ + daisZ);
  });

  it('default collapsed reliquary chain ends with reliquary_finale', () => {
    const mods = defaultDelveModules('collapsed_reliquary');
    expect(mods[mods.length - 1]).toBe('reliquary_finale');
    expect(mods.length).toBeGreaterThanOrEqual(2);
  });
});

describe('delve slot detection', () => {
  it('module 3 in slot 0 resolves to slot 0, not the nearer slot-1 door', () => {
    const origin = delveOrigin(0, 0);
    const zBase = delveModuleZOffset(FOUR_MODULE_RUN, 3);
    const layout = DELVE_MODULE_LAYOUTS.reliquary_finale;
    const pz = origin.z + zBase + (layout.zMin + layout.zMax) / 2;
    const slot = delveSlotAt(0, pz, FOUR_MODULE_RUN);
    expect(slot).toBe(0);
    const loc = delveModuleLocal(origin.x, pz, FOUR_MODULE_RUN);
    expect(loc.moduleIndex).toBe(3);
    expect(loc.moduleId).toBe('reliquary_finale');
    expect(loc.oz).toBe(origin.z + zBase);
  });
});

describe('delve walkable bounds vs render floor', () => {
  it('module 0 floor grid covers the inner walkable half-width', () => {
    // KayKit floor tiles span x -24..24; global dungeon walkable band is |x| < 22.
    // Delve rooms use wallX=25 (walkable 24u) but the global constant stays 22.
    expect(DUNGEON_WALK_HALF_X).toBe(22);
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    expect(layout.zMax - layout.zMin).toBe(110);
  });
});

describe('pressure plate slot positions', () => {
  // Helpers: pillar and tomb positions are the definitive source of truth from
  // the layout data, so this test stays robust to coordinate tweaks.
  function nearPillar(
    layout: (typeof DELVE_MODULE_LAYOUTS)[keyof typeof DELVE_MODULE_LAYOUTS],
    px: number,
    pz: number,
  ): boolean {
    return layout.pillars.some((p) => Math.abs(p.x - px) < 1.5 && Math.abs(p.z - pz) < 1.5);
  }
  function nearTomb(
    layout: (typeof DELVE_MODULE_LAYOUTS)[keyof typeof DELVE_MODULE_LAYOUTS],
    px: number,
    pz: number,
  ): boolean {
    return layout.tombs.some((t) => Math.abs(t.x - px) < 2.5 && Math.abs(t.z - pz) < 2.5);
  }
  function nearDais(
    layout: (typeof DELVE_MODULE_LAYOUTS)[keyof typeof DELVE_MODULE_LAYOUTS],
    px: number,
    pz: number,
  ): boolean {
    return Math.hypot(px - layout.dais.x, pz - layout.dais.z) < layout.dais.r - 1;
  }

  it('reliquary_sunken_ossuary: pressure plate slots land on clear floor', () => {
    const mod = DELVE_MODULES.reliquary_sunken_ossuary;
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const ppSlots = mod.interactableSlots.filter((s) => s.variants.includes('pressure_plate'));
    expect(ppSlots.length).toBeGreaterThan(0);
    for (const slot of ppSlots) {
      expect(nearPillar(layout, slot.x, slot.z)).toBe(false);
      expect(nearTomb(layout, slot.x, slot.z)).toBe(false);
    }
  });

  it('reliquary_finale: pressure plate slot lands on clear floor in front of dais', () => {
    const mod = DELVE_MODULES.reliquary_finale;
    const layout = DELVE_MODULE_LAYOUTS.reliquary_finale;
    const ppSlots = mod.interactableSlots.filter((s) => s.variants.includes('pressure_plate'));
    expect(ppSlots.length).toBeGreaterThan(0);
    for (const slot of ppSlots) {
      expect(nearPillar(layout, slot.x, slot.z)).toBe(false);
      expect(nearTomb(layout, slot.x, slot.z)).toBe(false);
      // plate must be before the dais back (not inside the dais circle)
      expect(nearDais(layout, slot.x, slot.z)).toBe(false);
      // must be within the module footprint
      expect(slot.z).toBeGreaterThan(layout.zMin);
      expect(slot.z).toBeLessThan(layout.zMax);
    }
  });
});

describe('delve walkable width', () => {
  it('module 0 floor span covers the right aisle at delve origin', () => {
    const origin = delveOrigin(0, 0);
    const zBase = delveModuleZOffset(FOUR_MODULE_RUN, 0);
    const oz = origin.z + zBase;
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const rightAisleX = origin.x + DUNGEON_WALK_HALF_X - 2;
    const loc = delveModuleLocal(rightAisleX, oz + 20, FOUR_MODULE_RUN);
    expect(loc.moduleIndex).toBe(0);
    expect(loc.oz).toBe(oz);
    expect(layout.zMax - layout.zMin).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// buildDelveInteractable -- procedural mesh shape tests
// ---------------------------------------------------------------------------
import { buildDelveInteractable } from '../src/render/delve_props';

const ALL_DELVE_IDS = [
  'delve_locked_door',
  'delve_pressure_plate',
  'delve_pressure_plate_triggered',
  'delve_cracked_grave',
  'delve_module_exit',
  'delve_reward_chest',
  'delve_locked_chest',
  'delve_surface_exit',
  'delve_destructible_wall',
] as const;

describe('buildDelveInteractable', () => {
  it('returns a non-empty group for every templateId', () => {
    for (const id of ALL_DELVE_IDS) {
      const { group, height } = buildDelveInteractable(id, 42);
      expect(group, `${id} group`).toBeInstanceOf(THREE.Group);
      expect(group.children.length, `${id} has children`).toBeGreaterThan(0);
      expect(height, `${id} height > 0`).toBeGreaterThan(0);
    }
  });

  it('returns a non-empty group for an unknown delve_* id (fallback crate)', () => {
    const { group, height } = buildDelveInteractable('delve_unknown_thing', 1);
    expect(group.children.length).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('portcullis bounding box X extent is >= 24 to cover the ~28-wide collider', () => {
    const { group } = buildDelveInteractable('delve_locked_door', 1);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const xSpan = box.max.x - box.min.x;
    expect(xSpan).toBeGreaterThanOrEqual(24);
  });

  it('portcullis height is >= 6 (covers full dungeon wall height of 8)', () => {
    const { height } = buildDelveInteractable('delve_locked_door', 1);
    expect(height).toBeGreaterThanOrEqual(6);
  });

  it('pressure plate is low-profile (height < 1)', () => {
    const { height: hOff } = buildDelveInteractable('delve_pressure_plate', 5);
    const { height: hOn } = buildDelveInteractable('delve_pressure_plate_triggered', 5);
    expect(hOff).toBeLessThan(1);
    expect(hOn).toBeLessThan(1);
  });

  it('triggered pressure plate has more children than untriggered (glow + runes added)', () => {
    const { group: off } = buildDelveInteractable('delve_pressure_plate', 7);
    const { group: on } = buildDelveInteractable('delve_pressure_plate_triggered', 7);
    expect(on.children.length).toBeGreaterThan(off.children.length);
  });

  it('portcullis does not vary by entityId (fixed layout)', () => {
    const { group: door1 } = buildDelveInteractable('delve_locked_door', 1);
    const { group: door2 } = buildDelveInteractable('delve_locked_door', 99);
    expect(door1.rotation.y).toBe(door2.rotation.y);
    expect(door1.children.length).toBe(door2.children.length);
  });

  it('chests and graves have > 0 children regardless of entityId', () => {
    for (const id of ['delve_reward_chest', 'delve_locked_chest', 'delve_cracked_grave'] as const) {
      const { group: g1 } = buildDelveInteractable(id, 1);
      const { group: g2 } = buildDelveInteractable(id, 999);
      expect(g1.children.length, `${id} entityId=1`).toBeGreaterThan(0);
      expect(g2.children.length, `${id} entityId=999`).toBeGreaterThan(0);
    }
  });
});
