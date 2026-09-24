// Collapsed-roof cavern dressing. Collision and floor height remain simulation-owned.
import {
  type HoardValleyLayoutInput,
  type HoardValleyPlan,
  type HoardValleyRockPlacement,
  hoardValleySpanAtZ,
} from './hoard_valley_core';

export interface CavernRoot {
  start: readonly [number, number, number];
  end: readonly [number, number, number];
  radius: number;
}

export interface HoardCavernShellPlan {
  ledges: HoardValleyRockPlacement[];
  roots: CavernRoot[];
  entryRoof: HoardValleyRockPlacement[];
  roofEndZ: number;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}
const AXES = ['x', 'y', 'z'] as const;

/** Keep the underside while walking underneath; cut away only an obstructing roof. */
export function hoardCavernSceneryVisible(
  camera: Point3,
  target: Point3,
  origin: Point3,
  bounds: { min: Point3; max: Point3 },
): boolean {
  let near = 0;
  let far = 1;
  for (const axis of AXES) {
    const start = camera[axis] - origin[axis];
    const delta = target[axis] - camera[axis];
    const min = bounds.min[axis] - 0.5;
    const max = bounds.max[axis] + 0.5;
    if (Math.abs(delta) < 1e-8) {
      if (start < min || start > max) return true;
      continue;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return true;
  }
  return false;
}

/** A short covered arrival followed by an open skylight, with roots only at its rim. */
export function buildHoardCavernShellPlan(
  layout: HoardValleyLayoutInput,
  valley: HoardValleyPlan,
): HoardCavernShellPlan {
  const ledges: HoardValleyRockPlacement[] = [];
  const roots: CavernRoot[] = [];
  const entryRoof: HoardValleyRockPlacement[] = [];
  const roofEndZ = Math.min(layout.zMin + 19, valley.revealZ - 15);
  // The cornice rides the wall's primaries (every third placement), as shelves
  // pressed into the cliff body rather than slabs hanging over the room.
  for (let i = 0; i < valley.cliffs.length; i += 3) {
    const rock = valley.cliffs[i];
    const span = hoardValleySpanAtZ(layout, Math.min(layout.zMax - 0.01, rock.z));
    const side = rock.x < (span.minX + span.maxX) / 2 ? -1 : 1;
    // Just under the top of its primary, so the rock below always carries it.
    const y = (rock.centerY ?? rock.scaleY * 0.74 - 0.7) + rock.scaleY * 0.78;
    ledges.push({
      ...rock,
      centerY: undefined,
      x: rock.x + side * 0.3,
      y,
      scaleX: rock.scaleX * 1.3,
      scaleY: 1.1 + rock.scaleX * 0.2,
      scaleZ: rock.scaleZ * 1.25,
      yaw: rock.yaw * 0.2,
    });
    if (i % 9 !== 0 || rock.z < roofEndZ || Math.abs(rock.x) < 12 || y < 10) continue;
    const x = rock.x - side * rock.scaleX * 0.85;
    const bend = x - side * 0.6;
    const length = 2.8 + rock.scaleX * 0.65;
    const knee = [bend, y - length * 0.55, rock.z + 0.35] as const;
    const end = [bend + side * 0.3, Math.max(6, y - length), rock.z + 0.8] as const;
    roots.push(
      { start: [x, y + 0.2, rock.z], end: knee, radius: 0.15 },
      { start: knee, end, radius: 0.09 },
      {
        start: knee,
        end: [bend - side * 0.65, Math.min(knee[1] - 0.3, end[1] + 0.8), rock.z - 0.2],
        radius: 0.055,
      },
    );
  }
  // Rock slabs sit above the chase camera. Their ends overlap the gorge walls.
  for (let z = layout.zMin + 2; z < roofEndZ; z += 4.8) {
    const span = hoardValleySpanAtZ(layout, z);
    entryRoof.push({
      x: (span.minX + span.maxX) / 2,
      y: 15.5,
      z,
      scaleX: (span.maxX - span.minX) * 0.65,
      scaleY: 2.4,
      scaleZ: 4.1,
      yaw: 0.06 * Math.sin(z),
      color: valley.zone.cliff,
      revealShoulder: false,
    });
  }
  return { ledges, roots, entryRoof, roofEndZ };
}
