// Colorblind Mode on the Nythraxis hazard painters: the Options toggle reaches
// the tinted-at-build materials by REBUILDING the painters, and every rebuilt
// row keeps its authoritative geometry (radius, countdown) while its rim moves
// onto the colourblind-safe family. The classic path is the untouched default.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { NYTHRAXIS_GRAVE_ERUPTION_PALETTE } from '../src/render/nythraxis_grave_core';
import { NYTHRAXIS_GRAVE_FLAME_RIM_NAME } from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND,
  NYTHRAXIS_GRAVE_FLAME_PALETTE_COLORBLIND,
  NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND,
} from '../src/render/nythraxis_hazard_palette_core';
import {
  NythraxisMechanicVisuals,
  type NythraxisMechanicWorld,
} from '../src/render/nythraxis_mechanic_visuals';
import { NYTHRAXIS_SOUL_REND_RING_NAME } from '../src/render/nythraxis_soul_rend_marker';
import { NYTHRAXIS_SOUL_REND_AURA_ID } from '../src/render/nythraxis_soul_rend_marker_core';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import {
  type ActiveNythraxisGraveEruption,
  type ActiveNythraxisGraveFlame,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
} from '../src/sim/nythraxis_grave_eruption';

const ERUPTION: ActiveNythraxisGraveEruption = {
  id: '42:ge:7:0',
  x: 3,
  z: 9,
  radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  duration: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  remaining: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  warningLead: NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
};

const FIRE_WARNING = {
  id: 'ignivar:1',
  x: 1,
  z: 2,
  radius: 2.4,
  duration: 2.5,
  remaining: 2,
  warningLead: 0.75,
};

const FLAME: ActiveNythraxisGraveFlame = {
  id: '42:gf:3',
  sourceId: 42,
  kind: 'grave',
  x: 7,
  z: -5,
  radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  duration: 12,
  remaining: 12,
};

function meteorRoot(scene: THREE.Scene, persistentId: string): THREE.Group | undefined {
  return scene.children.find((child) => child.userData.persistentMeteorId === persistentId) as
    | THREE.Group
    | undefined;
}

function boundaryHex(root: THREE.Group): number {
  const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
  return (boundary.material as THREE.LineBasicMaterial).color.getHex();
}

function boundaryRadius(root: THREE.Group): number {
  const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
  const positions = boundary.geometry.getAttribute('position');
  let max = 0;
  for (let i = 0; i < positions.count; i++) {
    max = Math.max(max, Math.hypot(positions.getX(i), positions.getZ(i)));
  }
  return max;
}

function syncAll(fx: MageGroundFx, eruptions: ActiveNythraxisGraveEruption[]): void {
  fx.syncWorldMeteorWarnings({
    activeIgnivarMeteors: [FIRE_WARNING],
    activeVarkhulAnvilMeteors: [],
    activeVarkhulForgestormWarnings: [],
    activeNythraxisGraveEruptions: eruptions,
  });
}

describe('Colorblind Mode on the Grave Eruption telegraph', () => {
  it('rebuilds a live eruption in the new palette at the same radius, and leaves the fire meteor alone', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    syncAll(fx, [ERUPTION]);
    const classic = meteorRoot(scene, ERUPTION.id) as THREE.Group;
    expect(boundaryHex(classic)).toBe(NYTHRAXIS_GRAVE_ERUPTION_PALETTE.boundary);
    const fire = meteorRoot(scene, FIRE_WARNING.id) as THREE.Group;
    const fireHex = boundaryHex(fire);

    fx.setHazardPaletteMode('colorblind');
    // The flip drops the snapshot-managed grave telegraph; the fire one stays.
    expect(meteorRoot(scene, ERUPTION.id)).toBeUndefined();
    expect(meteorRoot(scene, FIRE_WARNING.id)).toBe(fire);

    // The next sync respawns it from the authoritative row in the new family.
    syncAll(fx, [ERUPTION]);
    const swapped = meteorRoot(scene, ERUPTION.id) as THREE.Group;
    expect(boundaryHex(swapped)).toBe(NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND.boundary);
    expect(boundaryRadius(swapped)).toBeCloseTo(boundaryRadius(classic), 5);
    expect(boundaryHex(fire)).toBe(fireHex);

    // Same mode again is a no-op: nothing is dropped.
    fx.setHazardPaletteMode('colorblind');
    expect(meteorRoot(scene, ERUPTION.id)).toBe(swapped);

    // And back to classic returns the owner-called purple.
    fx.setHazardPaletteMode('classic');
    syncAll(fx, [ERUPTION]);
    expect(boundaryHex(meteorRoot(scene, ERUPTION.id) as THREE.Group)).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE.boundary,
    );
    fx.dispose();
  });

  it('never recycles a classic pooled material into a colourblind telegraph', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    syncAll(fx, [ERUPTION]);
    // Retire the classic telegraph into the pool, then spawn under the other mode.
    syncAll(fx, []);
    fx.setHazardPaletteMode('colorblind');
    syncAll(fx, [ERUPTION]);
    expect(boundaryHex(meteorRoot(scene, ERUPTION.id) as THREE.Group)).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND.boundary,
    );
    fx.dispose();
  });
});

type Roster = NythraxisMechanicWorld['entities'];
type Raider = Roster extends ReadonlyMap<number, infer T> ? T : never;

function world(): NythraxisMechanicWorld {
  const marked: Raider = {
    id: 1,
    templateId: 'warrior',
    dead: false,
    scale: 1,
    pos: { x: DUNGEON_X_THRESHOLD + 50, y: 0, z: 0 },
    auras: [{ id: NYTHRAXIS_SOUL_REND_AURA_ID, remaining: 6, duration: 8 }],
  };
  return {
    activeNythraxisGraveFlames: [FLAME],
    activeNythraxisGravefires: [],
    activeNythraxisBindingSigils: [],
    entities: new Map<number, Raider>([[1, marked]]),
    player: { pos: { x: DUNGEON_X_THRESHOLD + 1 } },
  };
}

function rimHex(scene: THREE.Scene): number {
  const rim = scene.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME) as THREE.Mesh;
  return (rim.material as THREE.MeshBasicMaterial).color.getHex();
}

function soulRendRingHex(scene: THREE.Scene): number {
  const ring = scene.getObjectByName(NYTHRAXIS_SOUL_REND_RING_NAME) as THREE.Mesh;
  return (ring.material as THREE.MeshBasicMaterial).color.getHex();
}

describe('NythraxisMechanicVisuals.setPaletteMode', () => {
  it('rebuilds the hazard painters so the next sync repaints every live row', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisMechanicVisuals(scene, () => 0);
    expect(visuals.hazardPaletteMode).toBe('classic');
    visuals.syncWorld(world());
    const before = scene.children.length;
    const classicRim = rimHex(scene);
    const classicRing = soulRendRingHex(scene);

    visuals.setPaletteMode('colorblind');
    expect(visuals.hazardPaletteMode).toBe('colorblind');
    visuals.syncWorld(world());
    visuals.update(0.05, false);
    expect(scene.children.length).toBe(before);
    expect(rimHex(scene)).toBe(NYTHRAXIS_GRAVE_FLAME_PALETTE_COLORBLIND.rim);
    expect(rimHex(scene)).not.toBe(classicRim);
    expect(soulRendRingHex(scene)).toBe(NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND.ring);
    expect(soulRendRingHex(scene)).not.toBe(classicRing);

    // The same mode is a no-op (no rebuild, the live patch survives).
    const patch = scene.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME);
    visuals.setPaletteMode('colorblind');
    visuals.syncWorld(world());
    expect(scene.getObjectByName(NYTHRAXIS_GRAVE_FLAME_RIM_NAME)).toBe(patch);

    visuals.setPaletteMode('classic');
    visuals.syncWorld(world());
    expect(rimHex(scene)).toBe(classicRim);
    expect(soulRendRingHex(scene)).toBe(classicRing);
    visuals.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('starts in the constructor palette so a boot-time setting needs no flip', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisMechanicVisuals(scene, () => 0, 'colorblind');
    visuals.syncWorld(world());
    expect(rimHex(scene)).toBe(NYTHRAXIS_GRAVE_FLAME_PALETTE_COLORBLIND.rim);
    visuals.dispose();
  });
});
