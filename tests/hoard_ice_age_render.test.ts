// Hoarfrost's Ice Age on screen: the pure look (src/render/hoard_ice_age_core.ts),
// the pooled adapter (src/render/hoard_ice_age.ts), and the shipped Blender
// pillars, including the pin that matters most: the lee painted on the floor is
// the sim's own cover test, and the model stays inside the cover it promises.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/ice_age/build.mjs';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import { HoardIceAgeFx, ICE_AGE_ASSET_URL } from '../src/render/hoard_ice_age';
import {
  type ChunkFlight,
  chunkFlight,
  ICE_AGE_LOOK,
  type IciclePose,
  iciclePose,
  type StormPose,
  stormPose,
  writeLeeStrip,
} from '../src/render/hoard_ice_age_core';
import {
  ICE_AGE,
  ICE_PILLAR_VARIANTS,
  iceAgeTimeline,
  iceAgeTotalSec,
  icePillarCovers,
  icePillarVariantOf,
} from '../src/sim/rift/hoard_ice_age_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const TOTAL = iceAgeTotalSec(1);
const LINE = iceAgeTimeline(TOTAL);
const blankIcicle = (): IciclePose => ({
  shadow: 0,
  shadowScale: 1,
  dust: 0,
  visible: false,
  drop: 0,
  impact: 0,
  lee: 0,
  crack: 0,
  shake: 0,
  shatter: 0,
  mist: 0,
});
const blankStorm = (): StormPose => ({
  gather: 0,
  frostRadius: 0,
  frost: 0,
  windSpeed: 0,
  wind: 0,
  waveRadius: 0,
  wave: 0,
  sheltering: false,
});

describe('the icicle look', () => {
  it('telegraphs with a growing shadow, then FALLS faster and faster into place', () => {
    const early = iciclePose(0.05, TOTAL, blankIcicle());
    const late = iciclePose(LINE.impactAt - 0.05, TOTAL, blankIcicle());
    expect(early.shadow).toBeGreaterThan(0);
    expect(late.shadow).toBeGreaterThan(early.shadow);
    expect(early.visible).toBe(false);
    // In view only for the tail of the warning, dropping from far overhead.
    const fallFrom = LINE.impactAt - ICE_AGE.pillarFallSec;
    const a = iciclePose(fallFrom + 0.1, TOTAL, blankIcicle());
    const b = iciclePose(fallFrom + 0.2, TOTAL, blankIcicle());
    const c = iciclePose(fallFrom + 0.3, TOTAL, blankIcicle());
    expect(a.visible).toBe(true);
    expect(a.drop).toBeGreaterThan(ICE_AGE_LOOK.dropHeight * 0.8);
    expect(a.drop - b.drop).toBeLessThan(b.drop - c.drop); // accelerating
    const landed = iciclePose(LINE.impactAt, TOTAL, blankIcicle());
    expect(landed).toMatchObject({ drop: 0, shadow: 0, visible: true });
    expect(landed.impact).toBeCloseTo(1, 9);
  });

  it('offers its lee from the landing to the break, brightest as the cast peaks', () => {
    expect(iciclePose(LINE.impactAt - 0.01, TOTAL, blankIcicle()).lee).toBe(0);
    const standing = iciclePose(LINE.castAt - 0.01, TOTAL, blankIcicle()).lee;
    const peak = iciclePose(LINE.blastAt - 0.01, TOTAL, blankIcicle()).lee;
    expect(standing).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(standing);
    // Still drawn while the storm is judged and lands; gone once the pillar breaks.
    expect(iciclePose(LINE.blastAt + 0.01, TOTAL, blankIcicle()).lee).toBeGreaterThan(0);
    expect(iciclePose(LINE.breakAt + 0.01, TOTAL, blankIcicle()).lee).toBe(0);
  });

  it('strains under the storm and only THEN breaks: never before the blast', () => {
    for (let t = 0; t < LINE.breakAt; t += 0.05) {
      expect(iciclePose(t, TOTAL, blankIcicle()).shatter).toBe(0);
    }
    expect(iciclePose(LINE.blastAt - 0.01, TOTAL, blankIcicle()).crack).toBeLessThan(0.5);
    expect(iciclePose(LINE.blastAt + 0.01, TOTAL, blankIcicle()).crack).toBe(1);
    expect(iciclePose(LINE.blastAt + 0.1, TOTAL, blankIcicle()).shake).toBeGreaterThan(0.1);
    const mid = iciclePose(LINE.breakAt + ICE_AGE.pillarShatterSec / 2, TOTAL, blankIcicle());
    expect(mid.shatter).toBeCloseTo(0.5, 6);
    expect(iciclePose(TOTAL, TOTAL, blankIcicle()).shatter).toBe(1);
  });

  it('throws the chunks on an arc that lands and fades: no physics, no sinking', () => {
    const flight: ChunkFlight = { x: 0, y: 0, z: 0, spin: 0, scale: 1 };
    expect(chunkFlight(0, 1, 0, 5, 1, flight)).toMatchObject({ x: 0, y: 0, z: 0, scale: 1 });
    let peak = 0;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      chunkFlight(p, 0.6, 0.8, 5, 1, flight);
      peak = Math.max(peak, flight.y);
      expect(flight.y).toBeGreaterThanOrEqual(-5 - 1e-9);
      expect(Math.hypot(flight.x, flight.z)).toBeCloseTo(
        ICE_AGE_LOOK.chunkSpeed * p * ICE_AGE.pillarShatterSec,
        6,
      );
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(chunkFlight(1, 1, 0, 5, 1, flight).scale).toBeCloseTo(0, 9);
    expect(chunkFlight(0.5, 1, 0, 5, 1, flight).scale).toBe(1);
  });
});

describe('the storm look', () => {
  it('builds through the cast and detonates at the blast', () => {
    expect(stormPose(LINE.castAt - 0.1, TOTAL, blankStorm())).toMatchObject({ wind: 0, gather: 0 });
    const early = stormPose(LINE.castAt + 0.5, TOTAL, blankStorm());
    const late = stormPose(LINE.blastAt - 0.1, TOTAL, blankStorm());
    expect(late.wind).toBeGreaterThan(early.wind);
    expect(late.windSpeed).toBeGreaterThan(early.windSpeed);
    expect(late.gather).toBeGreaterThan(0.95);
    expect(late.frostRadius).toBeGreaterThan(early.frostRadius);
    expect(late.wave).toBe(0);
    const blast = stormPose(LINE.blastAt + 0.05, TOTAL, blankStorm());
    expect(blast.wave).toBeGreaterThan(0.9);
    expect(blast.windSpeed).toBeGreaterThan(late.windSpeed * 2);
    expect(blast.wind).toBe(1);
    expect(blast.gather).toBe(0);
    expect(stormPose(TOTAL, TOTAL, blankStorm()).wind).toBeCloseTo(0, 6);
  });

  it('splits round the pillars exactly while they stand', () => {
    expect(stormPose(LINE.impactAt - 0.01, TOTAL, blankStorm()).sheltering).toBe(false);
    expect(stormPose(LINE.blastAt, TOTAL, blankStorm()).sheltering).toBe(true);
    expect(stormPose(LINE.breakAt + 0.01, TOTAL, blankStorm()).sheltering).toBe(false);
  });
});

describe('the lee on the floor IS the cover test', () => {
  it('paints only ground the sim would shelter, and all of its width', () => {
    const out = new Float32Array((ICE_AGE_LOOK.leeSegments + 1) * 4);
    for (const pillar of [
      { x: 0, z: 15 },
      { x: -14, z: 9 },
      { x: 11, z: -18 },
    ]) {
      const rows = writeLeeStrip(2, -3, pillar.x, pillar.z, out);
      expect(rows).toBe(ICE_AGE_LOOK.leeSegments + 1);
      for (let row = 0; row < rows; row++) {
        const [lx, lz, rx, rz] = out.subarray(row * 4, row * 4 + 4);
        // Just inside each edge is cover; just outside it is not.
        for (const [x, z, ox, oz] of [
          [lx, lz, rx, rz],
          [rx, rz, lx, lz],
        ]) {
          const inX = x + (ox - x) * 0.02;
          const inZ = z + (oz - z) * 0.02;
          const outX = x - (ox - x) * 0.02;
          const outZ = z - (oz - z) * 0.02;
          // The first row sits ON the pillar's own line: nudge it into the lee.
          const nudge = row === 0 ? 0.05 : row === rows - 1 ? -0.05 : 0;
          const d = Math.hypot(pillar.x - 2, pillar.z + 3);
          const nx = ((pillar.x - 2) / d) * nudge;
          const nz = ((pillar.z + 3) / d) * nudge;
          expect(icePillarCovers(2, -3, pillar.x, pillar.z, inX + nx, inZ + nz)).toBe(true);
          expect(icePillarCovers(2, -3, pillar.x, pillar.z, outX + nx, outZ + nz)).toBe(false);
        }
      }
    }
    expect(writeLeeStrip(0, 0, 0, 0, out)).toBe(0);
  });
});

function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 1,
    kind: 'mark',
    phase: 'warning',
    x: 0,
    z: 0,
    radius: ICE_AGE.pillarRadius,
    remaining: TOTAL,
    total: TOTAL,
    ...partial,
  } as HoardBossCueView;
}
const CALM_OFF = () => false;
const at = (elapsed: number) => TOTAL - elapsed;
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const cast = (elapsed: number) => [
  cue({ cueId: 4, kind: 'sweep', variant: 'frost-iceage', x: 0, z: 0, remaining: at(elapsed) }),
  cue({ cueId: 5, variant: 'frost-pillar', x: 0, z: 15, remaining: at(elapsed) }),
  cue({ cueId: 6, variant: 'frost-pillar', x: -13, z: 12, remaining: at(elapsed) }),
];

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync(cast(0.2));
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.sync([cue({ cueId: 9, variant: 'buried-mark', radius: 3 })]);
    expect(root?.children.some((slot) => slot.visible)).toBe(true);
    generic.dispose();
  });

  it('shows shadow, then pillar and lee, then the storm, then nothing', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = new HoardIceAgeFx(
      scene,
      () => 0,
      undefined,
      CALM_OFF,
      (n) => shakes.push(n),
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    const visible = (name: string) => named(scene, name).filter((node) => node.visible).length;
    fx.update(0.016);
    expect(visible('IcePillar') + visible('IcicleShadow') + visible('IceLee')).toBe(0);

    fx.sync(cast(0.3));
    fx.update(0.016);
    expect(visible('IcicleShadow')).toBe(2);
    expect(visible('IcePillar')).toBe(0);
    expect(visible('IceLee')).toBe(0);

    fx.sync(cast(LINE.castAt + 1));
    fx.update(0.016);
    expect(visible('IcicleShadow')).toBe(0);
    expect(visible('IcePillar')).toBe(2);
    expect(visible('IceLee')).toBe(2);
    expect(visible('IceAgeSnow')).toBe(1);
    expect(visible('IceAgeWave')).toBe(0);
    // Each pillar wears the variant its cue id names.
    const standing = named(scene, 'IcePillar');
    expect(standing[icePillarVariantOf(5)].visible).toBe(true);
    expect(standing[icePillarVariantOf(6)].visible).toBe(true);
    // (To a hair: it trembles a little as the cast builds.)
    expect(standing[icePillarVariantOf(5)].position.z).toBeCloseTo(15, 1);

    fx.sync(cast(LINE.blastAt + 0.05));
    fx.update(0.016);
    expect(visible('IceAgeWave')).toBe(1);
    expect(visible('IceLee')).toBe(2);
    expect(shakes.some((n) => n > 0.2)).toBe(true);

    // The encounter cleared mid-storm: every piece goes with it.
    fx.sync([]);
    fx.update(0.016);
    expect(
      visible('IcePillar') +
        visible('IcicleShadow') +
        visible('IceLee') +
        visible('IceAgeSnow') +
        visible('IceAgeWave'),
    ).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('darkens the snow in a standing lee and nowhere else', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardIceAgeFx(
      scene,
      () => 0,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    fx.sync(cast(LINE.blastAt + 0.1));
    fx.update(0.016);
    fx.update(0.016);
    const snow = named(scene, 'IceAgeSnow')[0] as THREE.Points;
    const position = snow.geometry.getAttribute('position');
    const alpha = snow.geometry.getAttribute('alpha');
    let lit = 0;
    let sheltered = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const covered = icePillarCovers(0, 0, 0, 15, x, z) || icePillarCovers(0, 0, -13, 12, x, z);
      if (covered) {
        sheltered++;
        expect(alpha.getX(i)).toBe(0);
      } else if (alpha.getX(i) > 0) lit++;
    }
    expect(sheltered).toBeGreaterThan(3);
    expect(lit).toBeGreaterThan(200);
    fx.dispose();
  });

  it('puts the late Blender asset in place BEFORE the compile gate sees the root', async () => {
    const asset = new THREE.Group();
    for (const letter of ['A', 'B', 'C']) {
      const holder = new THREE.Group();
      holder.name = `IcePillar_${letter}_ROOT`;
      for (const part of ['Chunk_00', 'Chunk_01', 'Base']) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ name: part === 'Base' ? 'Frost' : 'Ice' }),
        );
        mesh.name = `IcePillar_${letter}_${part}`;
        mesh.position.set(part === 'Chunk_01' ? 1 : -1, 2, 0);
        holder.add(mesh);
      }
      asset.add(holder);
    }
    let deliver: (value: THREE.Group) => void = () => {};
    const late = new Promise<THREE.Group>((resolve) => {
      deliver = resolve;
    });
    const seen: number[] = [];
    const attachedAtGate: boolean[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      let boxes = 0;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry.getAttribute('position').count === 24) boxes++;
      });
      seen.push(boxes);
      // Recorded here, asserted after: the gate's own rejections are swallowed.
      attachedAtGate.push(root.parent !== null);
    };
    const fx = new HoardIceAgeFx(scene, () => 0, gate, CALM_OFF, undefined, 'high', late);
    expect(scene.children).toHaveLength(0);
    deliver(asset);
    await fx.readyForEntry;
    // Three variants of three parts each, all baked in before the gate ran.
    expect(seen).toEqual([ICE_PILLAR_VARIANTS * 3]);
    // The gated attach adds the root, THEN compiles it.
    expect(attachedAtGate).toEqual([true]);
    expect(scene.children).toHaveLength(1);
    // The cached asset is never mutated: the rigs wear baked copies.
    expect(asset.children).toHaveLength(3);
    expect(asset.children[0].children).toHaveLength(3);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("never paints another hoard's lee: cue ids restart with every instance", async () => {
    const scene = new THREE.Scene();
    const fx = new HoardIceAgeFx(
      scene,
      () => 0,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    const firstVertex = () => {
      const lee = named(scene, 'IceLee').find((node) => node.visible) as THREE.Mesh;
      const position = lee.geometry.getAttribute('position');
      return [position.getX(0), position.getZ(0)];
    };
    fx.sync(cast(LINE.castAt + 1));
    fx.update(0.016);
    const here = firstVertex();
    fx.sync([]);
    fx.update(0.016);
    // The same cue ids, another run, another room.
    const elsewhere = cast(LINE.castAt + 1).map((entry) => ({
      ...entry,
      instanceId: 2,
      x: entry.x + 300,
      z: entry.z - 40,
    }));
    fx.sync(elsewhere);
    fx.update(0.016);
    const there = firstVertex();
    expect(there[0] - here[0]).toBeCloseTo(300, 3);
    expect(there[1] - here[1]).toBeCloseTo(-40, 3);
    fx.dispose();
  });

  it('frees what it owns exactly once, and never the shared surface materials', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardIceAgeFx(
      scene,
      () => 0,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    const owned = new Map<string, number>();
    const shared = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      // One listener per resource: several meshes share a disc or a ring.
      if (!listening.has(mesh.geometry.uuid)) {
        listening.add(mesh.geometry.uuid);
        mesh.geometry.addEventListener('dispose', () =>
          owned.set(mesh.geometry.uuid, (owned.get(mesh.geometry.uuid) ?? 0) + 1),
        );
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        // The game's cached surface materials light the pillar; ours are unlit.
        const bucket =
          (material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          (material as THREE.MeshLambertMaterial).isMeshLambertMaterial
            ? shared
            : owned;
        if (listening.has(material.uuid)) continue;
        listening.add(material.uuid);
        material.addEventListener('dispose', () =>
          bucket.set(material.uuid, (bucket.get(material.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(owned.size).toBeGreaterThan(15);
    expect([...owned.values()].every((count) => count === 1)).toBe(true);
    expect(shared.size).toBe(0);
  });

  it('on the low tier sheds the flourish and keeps everything a player acts on', async () => {
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const blank = () => new THREE.Group();
    const a = new HoardIceAgeFx(high, () => 0, undefined, CALM_OFF, undefined, 'high', blank());
    const b = new HoardIceAgeFx(low, () => 0, undefined, CALM_OFF, undefined, 'low', blank());
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    expect(count(high, 'Points')).toBe(2);
    expect(count(low, 'Points')).toBe(1); // the snow stays: it is the storm
    // Fewer gusts, never none: on a snow floor they ARE the storm.
    const gusts = (scene: THREE.Scene) =>
      (named(scene, 'IceAgeGusts')[0] as THREE.Mesh).geometry.getAttribute('position').count / 4;
    expect(gusts(low)).toBeGreaterThan(20);
    expect(gusts(low)).toBeLessThan(gusts(high) / 2);
    for (const scene of [high, low]) {
      expect(named(scene, 'IcePillar')).toHaveLength(ICE_PILLAR_VARIANTS);
      expect(named(scene, 'IcicleShadow')).toHaveLength(ICE_PILLAR_VARIANTS);
      expect(named(scene, 'IceLee')).toHaveLength(ICE_PILLAR_VARIANTS);
      expect(named(scene, 'IceAgeWave')).toHaveLength(1);
    }
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender pillars', () => {
  it('exist, keep their named parts, and are small', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS.map((a) => a.target)).toEqual([`public${ICE_AGE_ASSET_URL}`]);
    for (const asset of ASSETS) {
      expect(existsSync(asset.source), asset.source).toBe(true);
      expect(existsSync(asset.target), asset.target).toBe(true);
      const root = (await io.read(asset.target)).getRoot();
      expect(
        root
          .listNodes()
          .map((node) => node.getName())
          .sort(),
      ).toEqual(asset.nodes);
      expect((root.getExtras() as { authoring?: string }).authoring).toBe('Blender');
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      let triangles = 0;
      for (const mesh of root.listMeshes())
        for (const primitive of mesh.listPrimitives())
          triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      expect(triangles).toBeLessThan(1500);
    }
  });

  it('every variant is destruction-ready, massive, and stays inside its own cover', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    // The unoptimized Blender export: plain float positions in metres.
    const root = (await io.read(ASSETS[0].source)).getRoot();
    const limit = ICE_AGE.pillarRadius * ICE_AGE.coverWidthMultiplier;
    const v = [0, 0, 0];
    for (const letter of ['A', 'B', 'C']) {
      const parts = root.listNodes().filter((n) => n.getName().startsWith(`IcePillar_${letter}_`));
      const chunks = parts.filter((n) => n.getName().includes('_Chunk_'));
      expect(chunks.length).toBeGreaterThanOrEqual(6);
      let top = 0;
      for (const node of parts) {
        const solid = !node.getName().endsWith('_Base');
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
          const position = primitive.getAttribute('POSITION');
          if (!position) continue;
          for (let i = 0; i < position.getCount(); i++) {
            position.getElement(i, v);
            top = Math.max(top, v[1]);
            // What reads as cover IS cover: nothing solid past the lee's own width.
            if (solid) expect(Math.hypot(v[0], v[2]), node.getName()).toBeLessThanOrEqual(limit);
          }
        }
      }
      // Several times a player's height: it has to read as cover from the chase camera.
      expect(top).toBeGreaterThan(8);
    }
  });
});
