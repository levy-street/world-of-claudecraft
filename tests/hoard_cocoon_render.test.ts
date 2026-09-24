// Vysska's Cocoon on screen: the pure look, the pooled adapter, and the shipped
// Blender cocoons. The pin that matters most: the rescue ring IS the sim's clock.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/cocoon/build.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import { HoardCocoonFx } from '../src/render/hoard_cocoon';
import {
  COCOON_LOOK,
  cocoonEndLook,
  cocoonLook,
  makeCocoonLook,
  WEB_FLOATS,
  writeWeb,
} from '../src/render/hoard_cocoon_core';
import {
  BROOD_COCOON_TOTAL_SEC,
  COCOON,
  COCOON_TOTAL_SEC,
  cocoonUrgency,
} from '../src/sim/rift/hoard_cocoon_core';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

describe('the cocoon look (pure)', () => {
  it('closes the web on them through the warning, then hangs the cocoon', () => {
    const early = cocoonLook(0.4, COCOON_TOTAL_SEC, false, 0, makeCocoonLook());
    const late = cocoonLook(COCOON.warningSec - 0.05, COCOON_TOTAL_SEC, false, 0, makeCocoonLook());
    expect(early.web).toBeGreaterThan(0.3);
    expect(late.webScale).toBeLessThan(early.webScale);
    expect(early.strand).toBe(0);
    expect(early.ring).toBe(0);
    expect(early.feed).toBe(0);
    const hung = cocoonLook(COCOON.warningSec + 1, COCOON_TOTAL_SEC, false, 0.2, makeCocoonLook());
    expect(hung.web).toBe(0);
    expect(hung.strand).toBe(1);
    expect(hung.ring).toBe(1);
    expect(hung.feed).toBeGreaterThan(0);
  });

  it('runs the rescue ring down on exactly the sim clock, calm to urgent', () => {
    for (const elapsed of [COCOON.warningSec + 1, COCOON.warningSec + 6, COCOON_TOTAL_SEC - 0.5]) {
      const look = cocoonLook(elapsed, COCOON_TOTAL_SEC, false, 0, makeCocoonLook());
      expect(look.urgency).toBe(cocoonUrgency(elapsed, COCOON_TOTAL_SEC));
      expect(look.left).toBeCloseTo(1 - look.urgency, 12);
    }
    expect(cocoonLook(COCOON_TOTAL_SEC, COCOON_TOTAL_SEC, false, 0, makeCocoonLook()).left).toBe(0);
    // A brood cocoon runs its own, shorter window, and nobody is fed on.
    const brood = cocoonLook(
      COCOON.warningSec + COCOON.hatchSec / 2,
      BROOD_COCOON_TOTAL_SEC,
      true,
      0.2,
      makeCocoonLook(),
    );
    expect(brood.left).toBeCloseTo(0.5, 9);
    expect(brood.feed).toBe(0);
  });

  it('bursts and fades at the end', () => {
    const out = { burst: 0, spread: 0 };
    cocoonEndLook(0, out);
    expect(out.burst).toBe(1);
    cocoonEndLook(COCOON.endSec, out);
    expect(out.burst).toBe(0);
    expect(out.spread).toBeGreaterThan(2);
  });

  it('writes a whole web inside its unit circle', () => {
    const lines = new Float32Array(WEB_FLOATS);
    expect(writeWeb(lines)).toBe(WEB_FLOATS);
    for (let i = 0; i < lines.length; i += 3) {
      expect(lines[i + 1]).toBe(0);
      expect(Math.hypot(lines[i], lines[i + 2])).toBeLessThanOrEqual(1 + 1e-6);
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
    radius: COCOON.cocoonRadius,
    innerRadius: 0,
    targetId: 50,
    remaining: COCOON_TOTAL_SEC,
    total: COCOON_TOTAL_SEC,
    ...partial,
  } as HoardBossCueView;
}
const living = (elapsed: number, more: Partial<HoardBossCueView> = {}) =>
  cue({ variant: 'brood-cocoon', remaining: COCOON_TOTAL_SEC - elapsed, ...more });
const CALM_OFF = () => false;
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const shown = (scene: THREE.Scene, name: string) =>
  named(scene, name).filter((node) => node.visible).length;
const first = (scene: THREE.Scene, name: string) =>
  named(scene, name).find((node) => node.visible) as THREE.Mesh;
const bossWorld = (): IWorld =>
  ({
    riftFloor: {},
    entities: new Map([
      [
        9,
        {
          id: 9,
          kind: 'mob',
          templateId: 'rift_boss_venom',
          dead: false,
          pos: { x: 10, y: 0, z: 0 },
        },
      ],
    ]),
  }) as unknown as IWorld;
const make = (scene: THREE.Scene, world?: IWorld, tier: 'high' | 'low' = 'high') =>
  new HoardCocoonFx(scene, () => 0, world, undefined, CALM_OFF, tier);

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync([living(1), cue({ variant: 'brood-cocoon-end', cueId: 6 })]);
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.dispose();
  });

  it('shows the web on the player, then the strand, the ring and her feeding', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene, bossWorld());
    await fx.readyForEntry;
    fx.update(0.016);
    expect(shown(scene, 'CocoonWeb') + shown(scene, 'CocoonRing')).toBe(0);
    fx.sync([living(0.6)]);
    fx.update(0.016);
    expect(shown(scene, 'CocoonWeb')).toBe(1);
    expect(shown(scene, 'CocoonRing')).toBe(0);
    expect(first(scene, 'CocoonWeb').position.x).toBe(10);
    // It follows a player who runs during the warning.
    fx.sync([living(0.8, { x: 14 })]);
    fx.update(0.016);
    expect(first(scene, 'CocoonWeb').position.x).toBe(14);

    fx.sync([living(COCOON.warningSec + 3)]);
    fx.update(0.016);
    fx.update(0.3); // her place is polled, then the line is drawn
    expect(shown(scene, 'CocoonWeb')).toBe(0);
    expect(shown(scene, 'CocoonStrand')).toBe(1);
    expect(shown(scene, 'CocoonRing')).toBe(1);
    expect(shown(scene, 'CocoonFeed')).toBe(1);
    // The feeding line runs from the cocoon to HER.
    const feed = first(scene, 'CocoonFeed').geometry.getAttribute('position');
    expect(feed.getZ(0)).toBeCloseTo(-20, 5);
    expect(feed.getZ(feed.count - 1)).toBeCloseTo(0, 5);
    fx.sync([]);
    fx.update(0.016);
    expect(
      shown(scene, 'CocoonStrand') + shown(scene, 'CocoonRing') + shown(scene, 'CocoonFeed'),
    ).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('lights exactly the share of the ring the sim has left, and reddens it', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const share = (elapsed: number) => {
      fx.sync([living(elapsed)]);
      fx.update(0.016);
      const ring = first(scene, 'CocoonRing');
      const alpha = ring.geometry.getAttribute('alpha');
      let lit = 0;
      const columns = alpha.count / 2;
      for (let c = 0; c < columns; c++) if (alpha.getX(c * 2 + 1) > 0.5) lit++;
      const tint = (ring.material as THREE.ShaderMaterial).uniforms.tint.value as THREE.Color;
      return { lit: lit / columns, red: tint.r - tint.g };
    };
    const early = share(COCOON.warningSec + 1);
    const late = share(COCOON.warningSec + COCOON.drainSec * 0.75);
    expect(early.lit).toBeCloseTo(1 - cocoonUrgency(COCOON.warningSec + 1, COCOON_TOTAL_SEC), 1);
    expect(late.lit).toBeCloseTo(0.25, 1);
    expect(late.red).toBeGreaterThan(early.red);
    // The ring sits outside the cocoon, where it can be seen round it.
    const position = first(scene, 'CocoonRing').geometry.getAttribute('position');
    expect(Math.hypot(position.getX(1) - 10, position.getZ(1) + 20)).toBeCloseTo(
      COCOON_LOOK.ringRadius,
      4,
    );
    expect(COCOON_LOOK.ringRadius - COCOON_LOOK.ringWidth).toBeGreaterThan(COCOON.cocoonRadius);
    fx.dispose();
  });

  it('plays the end on the SAME rig, clean when cut open and red when she fed', async () => {
    for (const fed of [false, true]) {
      const scene = new THREE.Scene();
      const fx = make(scene);
      await fx.readyForEntry;
      fx.sync([living(COCOON.warningSec + 2)]);
      fx.update(0.016);
      fx.sync([
        cue({
          variant: 'brood-cocoon-end',
          innerRadius: fed ? 1 : 0,
          targetId: undefined,
          total: COCOON.endSec,
          remaining: COCOON.endSec - 0.1,
        }),
      ]);
      fx.update(0.016);
      expect(shown(scene, 'CocoonStrand')).toBe(0);
      expect(shown(scene, 'CocoonRing')).toBe(1);
      const tint = (first(scene, 'CocoonRing').material as THREE.ShaderMaterial).uniforms.tint
        .value as THREE.Color;
      expect(tint.getHex()).toBe(fed ? COCOON_LOOK.urgent : COCOON_LOOK.calm);
      fx.dispose();
    }
  });

  it('never carries the last cocoon onto a reused rig', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([living(COCOON.warningSec + 8)]);
    fx.update(0.016);
    fx.sync([]);
    fx.update(0.016);
    fx.sync([living(0.3, { instanceId: 2, x: 300, z: -60, innerRadius: 1, targetId: undefined })]);
    fx.update(0.016);
    expect(shown(scene, 'CocoonRing')).toBe(0);
    expect(shown(scene, 'CocoonStrand')).toBe(0);
    expect(first(scene, 'CocoonWeb').position.x).toBe(300);
    fx.dispose();
  });

  it('frees what it owns exactly once', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const counts = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      for (const thing of [mesh.geometry, mesh.material as THREE.Material]) {
        if (listening.has(thing.uuid)) continue;
        listening.add(thing.uuid);
        thing.addEventListener('dispose', () =>
          counts.set(thing.uuid, (counts.get(thing.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(counts.size).toBeGreaterThan(8);
    expect(counts.size).toBe(listening.size);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  it('on the low tier sheds her feeding and the shreds, never the web, strand or ring', async () => {
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const a = make(high, bossWorld(), 'high');
    const b = make(low, bossWorld(), 'low');
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    expect(named(high, 'CocoonFeed')).toHaveLength(2);
    expect(named(low, 'CocoonFeed')).toHaveLength(0);
    let points = 0;
    low.traverse((node) => {
      if (node.type === 'Points') points++;
    });
    expect(points).toBe(0);
    b.sync([living(0.5)]);
    b.update(0.016);
    expect(shown(low, 'CocoonWeb')).toBe(1);
    b.sync([living(COCOON.warningSec + 2)]);
    b.update(0.016);
    expect(shown(low, 'CocoonStrand')).toBe(1);
    expect(shown(low, 'CocoonRing')).toBe(1);
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender cocoons', () => {
  it('exist, keep their named parts, are small, and fit the numbers the game uses', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS.map((a) => a.target)).toEqual([
      `public/${VISUALS.mob_silk_cocoon.url}`,
      `public/${VISUALS.mob_brood_cocoon.url}`,
    ]);
    const tops = [COCOON_LOOK.silkTop, COCOON_LOOK.broodTop];
    for (let n = 0; n < ASSETS.length; n++) {
      const asset = ASSETS[n];
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
      expect(triangles).toBeLessThan(900);
      // The unoptimized export, in metres: it stands on the floor, its body stays
      // inside the cocoon's radius, and its top is where the strand is tied.
      const root = (
        await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(asset.source)
      ).getRoot();
      const v = [0, 0, 0];
      let top = 0;
      let low = Number.POSITIVE_INFINITY;
      for (const node of root.listNodes()) {
        const body = node.getName() === 'Silk_Wrap' || node.getName() === 'Brood_Sac';
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
          const position = primitive.getAttribute('POSITION');
          if (!position) continue;
          for (let i = 0; i < position.getCount(); i++) {
            position.getElement(i, v);
            top = Math.max(top, v[1]);
            low = Math.min(low, v[1]);
            if (body)
              expect(Math.hypot(v[0], v[2])).toBeLessThanOrEqual(COCOON.cocoonRadius * 1.08);
          }
        }
      }
      expect(low).toBeCloseTo(0, 1);
      expect(top).toBeCloseTo(tops[n], 1);
    }
    // The silk cocoon clears a standing player.
    expect(VISUALS.mob_silk_cocoon.height).toBeGreaterThan(3);
  });
});
