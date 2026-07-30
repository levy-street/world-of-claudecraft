import { describe, expect, it } from 'vitest';
import { DELVE_MODULES } from '../src/sim/data';
import {
  LITANY_MODULE_IDS,
  litanyModuleGeometry,
  litanyModuleLosColliders,
} from '../src/sim/delve_litany_layout';
import { riteSiteLocalOffsets } from '../src/sim/delves/drowned_litany_rite';
import { BAPTISTRY_EGG_SAC_SPOTS, BAPTISTRY_WAVES } from '../src/sim/delves/drowned_litany_rooms';

// Every authored Drowned Litany spawn (trash packs, baptistry waves, room
// interactables, and the finale rite objects) must sit on walkable floor: inside
// the outer walls and clear of the interior obstacle colliders (stubs, pillars,
// tombs, clutter). Blackwater hazards are deliberately NOT obstacles (they are
// shallow, walkable and damaging), so they are excluded here, matching
// litanyModuleLosColliders. Polygon-shell OBBs retain their authored rotation.
function blockedAt(
  cols: ReturnType<typeof litanyModuleLosColliders>,
  x: number,
  z: number,
  r: number,
): boolean {
  for (const c of cols) {
    if (c.type === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    } else if (c.type === 'obb') {
      const cos = Math.cos(-c.rot);
      const sin = Math.sin(-c.rot);
      const lx = (x - c.x) * cos + (z - c.z) * sin;
      const lz = -(x - c.x) * sin + (z - c.z) * cos;
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return true;
    }
  }
  return false;
}

describe('The Drowned Litany: every authored spawn is on walkable floor', () => {
  it('no mob spawn or interactable sits inside a wall or obstacle', () => {
    const issues: string[] = [];
    for (const m of LITANY_MODULE_IDS) {
      const def = DELVE_MODULES[m];
      const geo = litanyModuleGeometry(m);
      if (!def || !geo) continue;
      const obstacles = litanyModuleLosColliders(m);
      const wallX = geo.wallX;
      for (const set of def.spawnSets ?? []) {
        for (const sp of set.spawns) {
          if (Math.abs(sp.x) > wallX - 0.5 || sp.z < geo.zMin + 1 || sp.z > geo.zMax - 1)
            issues.push(`${m} spawn ${sp.mobId} (${sp.x},${sp.z}) outside walls`);
          if (blockedAt(obstacles, sp.x, sp.z, 1.0))
            issues.push(`${m} spawn ${sp.mobId} (${sp.x},${sp.z}) inside obstacle`);
        }
      }
      for (const slot of def.interactableSlots ?? []) {
        for (const variant of slot.variants) {
          if (variant === 'darkness_zone') continue;
          if (blockedAt(obstacles, slot.x, slot.z, 0.8))
            issues.push(`${m} interactable ${variant} (${slot.x},${slot.z}) inside obstacle`);
        }
      }
    }
    expect(issues, issues.join('\n')).toEqual([]);
  });

  it('baptistry waves spawn on the pit-rim walkway, clear of obstacles', () => {
    const obstacles = litanyModuleLosColliders('litany_baptistry');
    const issues: string[] = [];
    for (let w = 0; w < BAPTISTRY_WAVES.length; w++) {
      for (const sp of BAPTISTRY_WAVES[w]) {
        if (Math.abs(sp.x) > 24 || sp.z < -18 || sp.z > 90)
          issues.push(`wave${w} ${sp.mobId} (${sp.x},${sp.z}) outside walls`);
        if (blockedAt(obstacles, sp.x, sp.z, 1.0))
          issues.push(`wave${w} ${sp.mobId} (${sp.x},${sp.z}) inside obstacle`);
      }
    }
    expect(issues, issues.join('\n')).toEqual([]);
  });

  it('all Baptistry egg-sac fallback sites are clear for hatchlings', () => {
    const obstacles = litanyModuleLosColliders('litany_baptistry');
    for (const spot of BAPTISTRY_EGG_SAC_SPOTS) {
      expect(blockedAt(obstacles, spot.x, spot.z, 0.8), `egg sac (${spot.x},${spot.z})`).toBe(
        false,
      );
    }
  });

  it('the Drowned Reliquary Rite reliquary and four shrines clear the apse cover', () => {
    const geo = litanyModuleGeometry('litany_apse')!;
    const obstacles = litanyModuleLosColliders('litany_apse');
    // The REAL spawn sites (shared with spawnDrownedLitanyRite), so a change to
    // the rite offsets is re-checked here instead of silently drifting.
    const sites = riteSiteLocalOffsets(geo.dais);
    const rite: Array<[string, number, number]> = [
      ['reliquary', sites.reliquary.x, sites.reliquary.z],
      ...Object.entries(sites.shrines).map(([kind, off]): [string, number, number] => [
        kind,
        off.x,
        off.z,
      ]),
    ];
    const issues: string[] = [];
    for (const [name, x, z] of rite) {
      if (blockedAt(obstacles, x, z, 0.8)) issues.push(`rite ${name} (${x},${z}) inside obstacle`);
    }
    expect(issues, issues.join('\n')).toEqual([]);
  });
});
