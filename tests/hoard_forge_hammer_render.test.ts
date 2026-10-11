// Emberforge's Hammer of the Forge on screen: the pure look, the pooled adapter,
// and the shipped Blender hammer. The pin that matters most: the fire drawn is
// the fire that burns, and a drawn door is a safe door.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/forge_hammer/build.mjs';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import {
  FORGE_HAMMER_ASSET_URL,
  FORGE_HAMMER_RIGS,
  HoardForgeHammerFx,
} from '../src/render/hoard_forge_hammer';
import {
  FORGE_HAMMER_LOOK,
  type HammerPose,
  hammerPose,
  writeRingMask,
} from '../src/render/hoard_forge_hammer_core';
import {
  FORGE_HAMMER,
  FORGE_RING_LIFE_SEC,
  FORGE_STRIKE_TOTAL_SEC,
  forgeBearingInGap,
  forgeBeatSec,
  forgeRingBurns,
  forgeRingRadius,
} from '../src/sim/rift/hoard_forge_hammer_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const blank = (): HammerPose => ({
  shadow: 0,
  shadowScale: 1,
  visible: false,
  drop: 0,
  impact: 0,
  heat: 0,
  ringRadius: 0,
  ring: 0,
  doors: 0,
  scorch: 0,
});
const WARN = FORGE_HAMMER.warningSec;

describe('the hammer look', () => {
  it('marks the ground, FALLS faster and faster, lands, and is drawn back up', () => {
    const early = hammerPose(0.1, blank());
    const late = hammerPose(WARN - 0.05, blank());
    expect(early.shadow).toBeGreaterThan(0);
    expect(late.shadow).toBeGreaterThan(early.shadow);
    expect(early.visible).toBe(false);
    const from = WARN - FORGE_HAMMER.fallSec;
    const a = hammerPose(from + 0.1, blank()).drop;
    const b = hammerPose(from + 0.2, blank()).drop;
    const c = hammerPose(from + 0.3, blank()).drop;
    expect(a).toBeGreaterThan(FORGE_HAMMER_LOOK.dropHeight * 0.8);
    expect(a - b).toBeLessThan(b - c);
    const landed = hammerPose(WARN, blank());
    expect(landed).toMatchObject({ drop: 0, shadow: 0, visible: true });
    expect(landed.impact).toBeCloseTo(1, 9);
    // It rests in its crater, then leaves: the floor is clear for the dance.
    expect(hammerPose(WARN + FORGE_HAMMER_LOOK.restSec * 0.9, blank()).drop).toBe(0);
    const gone = hammerPose(
      WARN + FORGE_HAMMER_LOOK.restSec + FORGE_HAMMER_LOOK.liftSec + 0.01,
      blank(),
    );
    expect(gone.visible).toBe(false);
  });

  it('draws the ring exactly where the sim says it is, and shows the doors FIRST', () => {
    for (const since of [0.5, 1.5, 3]) {
      expect(hammerPose(WARN + since, blank()).ringRadius).toBe(forgeRingRadius(since));
    }
    // The doors are up during the warning, before any fire exists.
    const warning = hammerPose(WARN * 0.6, blank());
    expect(warning.doors).toBeGreaterThan(0.3);
    expect(warning.ring).toBe(0);
    expect(hammerPose(WARN + 1, blank()).ring).toBeCloseTo(1, 6);
    const spent = hammerPose(WARN + FORGE_RING_LIFE_SEC, blank());
    expect(spent.ring).toBe(0);
    expect(spent.doors).toBe(0);
    expect(FORGE_STRIKE_TOTAL_SEC).toBeCloseTo(WARN + FORGE_RING_LIFE_SEC, 9);
  });

  it('cuts the fire open exactly where the sim leaves a door', () => {
    const mask = new Float32Array(FORGE_HAMMER_LOOK.ringSegments + 1);
    for (const id of [3, 8, 21]) {
      writeRingMask(id, mask);
      let open = 0;
      for (let column = 0; column < mask.length; column++) {
        const bearing = (column / FORGE_HAMMER_LOOK.ringSegments) * Math.PI * 2;
        expect(mask[column]).toBe(forgeBearingInGap(id, bearing) ? 0 : 1);
        if (mask[column] === 0) open++;
      }
      // Two doors of about GAP_ANGLE_SIZE each: neither missing nor the whole ring.
      const share = open / mask.length;
      const want = (FORGE_HAMMER.gaps * FORGE_HAMMER.gapHalfAngle * 2) / (Math.PI * 2);
      expect(share).toBeGreaterThan(want * 0.8);
      expect(share).toBeLessThan(want * 1.25);
    }
  });
});

function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 5,
    kind: 'mark',
    phase: 'warning',
    x: 10,
    z: -20,
    radius: FORGE_HAMMER.impactRadius,
    remaining: FORGE_STRIKE_TOTAL_SEC,
    total: FORGE_STRIKE_TOTAL_SEC,
    ...partial,
  } as HoardBossCueView;
}
const CALM_OFF = () => false;
const strike = (elapsed: number, more: Partial<HoardBossCueView> = {}) =>
  cue({ variant: 'ember-hammer-strike', remaining: FORGE_STRIKE_TOTAL_SEC - elapsed, ...more });
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const shown = (scene: THREE.Scene, name: string) =>
  named(scene, name).filter((node) => node.visible).length;
const make = (scene: THREE.Scene, tier: 'high' | 'low' = 'high', shake?: (n: number) => void) =>
  new HoardForgeHammerFx(scene, () => 0, undefined, CALM_OFF, shake, tier, new THREE.Group());

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync([cue({ cueId: 1, kind: 'sweep', variant: 'ember-hammer' }), strike(0.3)]);
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.dispose();
  });

  it('shows marker and doors, then the hammer, then a ring cut open at the doors', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = make(scene, 'high', (n) => shakes.push(n));
    await fx.readyForEntry;
    fx.update(0.016);
    expect(
      shown(scene, 'ForgeMarker') + shown(scene, 'ForgeHammer') + shown(scene, 'ForgeRing'),
    ).toBe(0);

    fx.sync([strike(0.8)]);
    fx.update(0.016);
    expect(shown(scene, 'ForgeMarker')).toBe(1);
    expect(shown(scene, 'ForgeDoor')).toBe(FORGE_HAMMER.gaps);
    expect(shown(scene, 'ForgeRing')).toBe(0);

    fx.sync([strike(WARN + 0.05)]);
    fx.update(0.016);
    expect(shown(scene, 'ForgeHammer')).toBe(1);
    expect(shown(scene, 'ForgeMarker')).toBe(0);
    expect(shakes.some((n) => n > 0.1)).toBe(true);

    const since = 2;
    fx.sync([strike(WARN + since)]);
    fx.update(0.016);
    expect(shown(scene, 'ForgeRing')).toBe(1);
    expect(shown(scene, 'ForgeWall')).toBe(1);
    const ring = named(scene, 'ForgeRing').find((node) => node.visible) as THREE.Mesh;
    const position = ring.geometry.getAttribute('position');
    const alpha = ring.geometry.getAttribute('alpha');
    // (A cue that refreshed this frame IS now: the clock does not also step.)
    const radius = forgeRingRadius(since);
    let lit = 0;
    let dark = 0;
    for (let column = 0; column <= FORGE_HAMMER_LOOK.ringSegments; column++) {
      const ix = position.getX(column * 2) - 10;
      const iz = position.getZ(column * 2) + 20;
      const ox = position.getX(column * 2 + 1) - 10;
      const oz = position.getZ(column * 2 + 1) + 20;
      // The band is as wide as the sim burns, centred on the sim's radius.
      expect(Math.hypot(ox, oz) - Math.hypot(ix, iz)).toBeCloseTo(FORGE_HAMMER.ringThickness, 3);
      expect((Math.hypot(ox, oz) + Math.hypot(ix, iz)) / 2).toBeCloseTo(radius, 2);
      // Lit exactly where standing on it would burn; dark exactly in a door.
      const mx = 10 + (ix + ox) / 2;
      const mz = -20 + (iz + oz) / 2;
      const burns = forgeRingBurns(5, 10, -20, radius - 0.3, radius, mx, mz);
      if (alpha.getX(column * 2) > 0) {
        lit++;
        expect(burns).toBe(true);
      } else {
        dark++;
        expect(burns).toBe(false);
      }
    }
    expect(lit).toBeGreaterThan(40);
    expect(dark).toBeGreaterThan(8);

    fx.sync([]);
    fx.update(0.016);
    expect(
      shown(scene, 'ForgeMarker') +
        shown(scene, 'ForgeHammer') +
        shown(scene, 'ForgeRing') +
        shown(scene, 'ForgeWall') +
        shown(scene, 'ForgeDoor'),
    ).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('has a rig for every strike that can be alive at once, so no telegraph is dropped', () => {
    // A strike lives FORGE_STRIKE_TOTAL_SEC; with two alternating hammers a new
    // one begins every half beat. However long the cast, that bounds the overlap.
    const alive = Math.ceil(FORGE_STRIKE_TOTAL_SEC / forgeBeatSec(2));
    expect(alive).toBeLessThanOrEqual(FORGE_HAMMER_RIGS);
    expect(Math.ceil(FORGE_STRIKE_TOTAL_SEC / forgeBeatSec(1))).toBeLessThanOrEqual(
      FORGE_HAMMER_RIGS,
    );
  });

  it('bakes the model once and shares it between rigs', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const hammers = named(scene, 'ForgeHammer') as THREE.Group[];
    expect(hammers).toHaveLength(FORGE_HAMMER_RIGS);
    for (const hammer of hammers) {
      expect((hammer.children[0] as THREE.Mesh).geometry).toBe(
        (hammers[0].children[0] as THREE.Mesh).geometry,
      );
    }
    fx.dispose();
  });

  it('marks each door with a short warm gate that travels with the ring, inside the gap', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const reach = (elapsed: number) => {
      fx.sync([strike(elapsed)]);
      fx.update(0.016);
      const door = named(scene, 'ForgeDoor').find((node) => node.visible) as THREE.Mesh;
      const position = door.geometry.getAttribute('position');
      const alpha = door.geometry.getAttribute('alpha');
      const radius = (i: number) => Math.hypot(position.getX(i) - 10, position.getZ(i) + 20);
      // Both edges of every row sit on the gap's own edges: inside it is safe.
      for (let i = 0; i < position.count; i++) {
        const bearing = Math.atan2(position.getX(i) - 10, position.getZ(i) + 20);
        const inside = bearing + (i % 2 === 0 ? 0.01 : -0.01);
        expect(forgeBearingInGap(5, inside)).toBe(true);
      }
      expect(alpha.getX(position.count - 1)).toBe(0);
      return { from: radius(0), to: radius(position.count - 1) };
    };
    // Through the marker: at the edge of the blow, a few yards long, never the whole room.
    const early = reach(0.8);
    expect(early.from).toBeCloseTo(FORGE_HAMMER.ringSafeRadius, 3);
    expect(early.to - early.from).toBeCloseTo(FORGE_HAMMER_LOOK.doorReach, 3);
    // Later it has moved out with the fire.
    const late = reach(WARN + 2);
    expect(late.from).toBeCloseTo(forgeRingRadius(2) - 0.6, 3);
    expect(late.to).toBeLessThanOrEqual(FORGE_HAMMER.ringMaxRadius + 1e-6);
    // Warm, never the cold blue of a hazard from another room.
    const tint = ((named(scene, 'ForgeDoor')[0] as THREE.Mesh).material as THREE.ShaderMaterial)
      .uniforms.tint.value as THREE.Color;
    expect(tint.r).toBeGreaterThan(tint.b);
    fx.dispose();
  });

  it('never reuses the last strike on a rig: a new run gets its own doors', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const firstDoor = () => {
      const door = named(scene, 'ForgeDoor').find((node) => node.visible) as THREE.Mesh;
      const position = door.geometry.getAttribute('position');
      return [position.getX(0), position.getZ(0)];
    };
    fx.sync([strike(0.8)]);
    fx.update(0.016);
    const here = firstDoor();
    fx.sync([]);
    fx.update(0.016);
    // The same cue id in another hoard, somewhere else.
    fx.sync([strike(0.8, { instanceId: 2, x: 310, z: -60 })]);
    fx.update(0.016);
    const there = firstDoor();
    expect(there[0] - here[0]).toBeCloseTo(300, 3);
    expect(there[1] - here[1]).toBeCloseTo(-40, 3);
    fx.dispose();
  });

  it('draws two alternating hammers and their rings at once', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([
      strike(WARN + 1.2, { cueId: 5, innerRadius: 0 }),
      strike(WARN - 0.2, { cueId: 6, x: -12, z: -30, innerRadius: 1 }),
    ]);
    fx.update(0.016);
    expect(shown(scene, 'ForgeRing')).toBe(1);
    expect(shown(scene, 'ForgeMarker')).toBe(1);
    expect(shown(scene, 'ForgeHammer')).toBe(2);
    fx.dispose();
  });

  it('puts the late Blender asset in place BEFORE the compile gate sees the root', async () => {
    const asset = new THREE.Group();
    const holder = new THREE.Group();
    holder.name = 'ForgeHammer_ROOT';
    for (const name of ['Hammer_Head', 'Hammer_Face']) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ name: name === 'Hammer_Face' ? 'Molten' : 'ForgeIron' }),
      );
      mesh.name = name;
      holder.add(mesh);
    }
    asset.add(holder);
    let deliver: (value: THREE.Group) => void = () => {};
    const late = new Promise<THREE.Group>((resolve) => {
      deliver = resolve;
    });
    const seen: number[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      let boxes = 0;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry.getAttribute('position').count === 24) boxes++;
      });
      seen.push(boxes);
    };
    const fx = new HoardForgeHammerFx(scene, () => 0, gate, CALM_OFF, undefined, 'high', late);
    expect(scene.children).toHaveLength(0);
    deliver(asset);
    await fx.readyForEntry;
    // Two parts on each of the six rigs, all baked in before the gate ran.
    expect(seen).toEqual([12]);
    expect(holder.children).toHaveLength(2); // the cached asset is never mutated
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('frees what it owns exactly once, and never the shared surface materials', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const owned = new Map<string, number>();
    const shared = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      if (!listening.has(mesh.geometry.uuid)) {
        listening.add(mesh.geometry.uuid);
        mesh.geometry.addEventListener('dispose', () =>
          owned.set(mesh.geometry.uuid, (owned.get(mesh.geometry.uuid) ?? 0) + 1),
        );
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (listening.has(material.uuid)) continue;
        listening.add(material.uuid);
        const lit =
          (material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          (material as THREE.MeshLambertMaterial).isMeshLambertMaterial;
        const bucket = lit ? shared : owned;
        material.addEventListener('dispose', () =>
          bucket.set(material.uuid, (bucket.get(material.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(owned.size).toBeGreaterThan(20);
    expect([...owned.values()].every((count) => count === 1)).toBe(true);
    expect(shared.size).toBe(0);
  });

  it('on the low tier sheds the embers and keeps everything a player acts on', async () => {
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const a = make(high, 'high');
    const b = make(low, 'low');
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    expect(count(high, 'Points')).toBe(1);
    expect(count(low, 'Points')).toBe(0);
    for (const scene of [high, low]) {
      expect(named(scene, 'ForgeMarker')).toHaveLength(6);
      expect(named(scene, 'ForgeHammer')).toHaveLength(6);
      expect(named(scene, 'ForgeRing')).toHaveLength(6);
      expect(named(scene, 'ForgeDoor')).toHaveLength(6 * FORGE_HAMMER.gaps);
    }
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender hammer', () => {
  it('exists, keeps its named parts, is small, and its head fits inside the blow', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS.map((a) => a.target)).toEqual([`public${FORGE_HAMMER_ASSET_URL}`]);
    const asset = ASSETS[0];
    expect(existsSync(asset.source)).toBe(true);
    expect(existsSync(asset.target)).toBe(true);
    const shipped = (await io.read(asset.target)).getRoot();
    expect(
      shipped
        .listNodes()
        .map((node) => node.getName())
        .sort(),
    ).toEqual(asset.nodes);
    expect((shipped.getExtras() as { authoring?: string }).authoring).toBe('Blender');
    expect(shipped.listTextures()).toHaveLength(0);
    let triangles = 0;
    for (const mesh of shipped.listMeshes())
      for (const primitive of mesh.listPrimitives())
        triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
    expect(triangles).toBeLessThan(1200);
    // The unoptimized export, in metres: the head stands ON the floor and inside
    // the impact radius, and the whole hammer towers over a player.
    const root = (
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(asset.source)
    ).getRoot();
    const v = [0, 0, 0];
    let top = 0;
    let low = Number.POSITIVE_INFINITY;
    for (const node of root.listNodes()) {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          top = Math.max(top, v[1]);
          low = Math.min(low, v[1]);
          if (node.getName() === 'Hammer_Head' || node.getName() === 'Hammer_Face') {
            expect(Math.hypot(v[0], v[2])).toBeLessThanOrEqual(FORGE_HAMMER.impactRadius);
          }
        }
      }
    }
    expect(low).toBeCloseTo(0, 3);
    expect(top).toBeGreaterThan(10);
  });
});
