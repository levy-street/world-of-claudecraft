import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { TrinketRelics, trinketRelicsPreloadInternalsForTest } from '../src/render/trinket_relics';
import {
  createHammerPose,
  createOrbPose,
  createRelicScan,
  drainEmission,
  HAMMER_STRIKE_SEC,
  kindlingBoltDuration,
  LANTERN_LIGHT_PROFILE,
  LANTERN_LIGHT_RADIUS,
  lanternLightAlpha,
  RELIC_IGNITE,
  RELIC_LANTERN,
  RELIC_ORB,
  RELIC_PIERCE,
  RELIC_TEMPER,
  relicEmberRate,
  relicPresence,
  scanRelicAuras,
  writeHammerPose,
  writeKindlingBoltPoint,
  writeOrbPose,
} from '../src/render/trinket_relics_core';
import { TRINKET_AURA, TRINKET_SPECS } from '../src/sim/content/trinkets';
import type { Aura, Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/vfx/trinket_relics.glb');
// Re-pin on a deliberate re-export (scripts/assets/trinket_relics/
// build_trinket_relics.py, then build_assets.mjs with specs/trinket_relics.json):
// the exporter's vertex order is not byte-stable, the structure below is.
const ASSET_BYTES = 25_656;
const ASSET_SHA256 = '216d378566265de3629f40c3b81e4c04a834335bc58106105909108f711163d6';

function aura(id: string, remaining: number, extra: Partial<Aura> = {}): Aura {
  return { id, name: id, kind: 'buff', remaining, duration: 12, value: 0, ...extra } as Aura;
}

describe('trinket relic GLB (Blender-authored, texture-free)', () => {
  it('pins the shipped artifact: bytes, sha256 and a small ceiling', () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.length).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(bytes.length).toBeLessThanOrEqual(32 * 1024);
  });

  it('ships three named relics over two material buckets, meshopt, no textures', async () => {
    await MeshoptDecoder.ready;
    const document = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .read(ASSET_PATH);
    const root = document.getRoot();
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain(
      'EXT_meshopt_compression',
    );
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listMaterials().map((m) => m.getName())).toEqual(['Body', 'Glow']);
    const nodes = root.listScenes()[0].listChildren();
    expect(nodes.map((n) => n.getName())).toEqual([
      'KindlingOrb',
      'LastFlameLantern',
      'TemperHammer',
    ]);
    const tris: Record<string, [string, number][]> = {};
    for (const node of nodes) {
      const prims = node.getMesh()?.listPrimitives() ?? [];
      tris[node.getName()] = prims.map((p) => [
        p.getMaterial()?.getName() ?? '',
        (p.getIndices()?.getCount() ?? 0) / 3,
      ]);
      for (const p of prims) expect(p.getAttribute('COLOR_0'), node.getName()).toBeTruthy();
    }
    expect(tris).toEqual({
      KindlingOrb: [
        ['Body', 320],
        ['Glow', 80],
      ],
      LastFlameLantern: [
        ['Body', 260],
        ['Glow', 80],
      ],
      TemperHammer: [
        ['Body', 96],
        ['Glow', 84],
      ],
    });
  });

  it('is manifested, preloaded through the deferred lane, and built by a committed script', () => {
    const url = trinketRelicsPreloadInternalsForTest.modelUrl;
    expect(url).toBe('/models/vfx/trinket_relics.glb');
    expect(existsSync(path.join(REPO_ROOT, 'public', url))).toBe(true);
    expect(MEDIA_ASSETS[url.slice(1)]).toMatch(
      /^\/media\/models\/vfx\/trinket_relics\.[0-9a-f]+\.glb$/,
    );
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/trinket_relics.json'), 'utf8'),
    );
    expect(spec.items[0].out).toBe('models/vfx/trinket_relics.glb');
    const script = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/trinket_relics/build_trinket_relics.py'),
      'utf8',
    );
    expect(script).toContain(spec.items[0].src.split('/').pop());
    const painter = readFileSync(path.join(REPO_ROOT, 'src/render/trinket_relics.ts'), 'utf8');
    expect(painter).toContain('registerDeferredPreload(');
    expect(painter).not.toMatch(/\bregisterPreload\(/);
  });
});

describe('trinket relic core', () => {
  it('reads each relic state off the sim aura ids', () => {
    const scan = scanRelicAuras(
      [
        aura(TRINKET_AURA.kindlingOrb, 9),
        aura(TRINKET_AURA.temper, 4),
        aura(TRINKET_AURA.pierce, 4),
        aura(TRINKET_AURA.ignite, 2),
        aura(TRINKET_AURA.lantern, 7, { value2: 31, value3: -12 }),
      ],
      createRelicScan(),
    );
    expect(scan.flags).toBe(RELIC_ORB | RELIC_TEMPER | RELIC_PIERCE | RELIC_IGNITE | RELIC_LANTERN);
    expect(scan.orbRemaining).toBe(9);
    expect([scan.lanternX, scan.lanternZ, scan.lanternRemaining]).toEqual([31, -12, 7]);
  });

  it('never places a lantern without its stored position, nor reads a spent aura', () => {
    const scan = createRelicScan();
    expect(scanRelicAuras([aura(TRINKET_AURA.lantern, 5)], scan).flags).toBe(0);
    expect(scanRelicAuras([aura(TRINKET_AURA.kindlingOrb, 0)], scan).flags).toBe(0);
    expect(scanRelicAuras([aura('trinket_forge_heat', 5)], scan).flags).toBe(0);
  });

  it('draws the lantern light at the sim splash radius with its rim exactly there', () => {
    const use = TRINKET_SPECS.last_flame_lantern.use;
    expect(use.kind).toBe('lantern');
    expect(LANTERN_LIGHT_RADIUS).toBe((use as { radius: number }).radius);
    const rim = LANTERN_LIGHT_PROFILE.find(([frac]) => frac === 1);
    expect(rim?.[1]).toBeGreaterThan(0.5);
    const past = LANTERN_LIGHT_PROFILE[LANTERN_LIGHT_PROFILE.length - 1];
    expect(past[1]).toBe(0);
    expect((past[0] - 1) * LANTERN_LIGHT_RADIUS).toBeLessThanOrEqual(0.1);
    // readable for the whole burn, gone only once the aura is
    expect(lanternLightAlpha(11.9, 12)).toBeGreaterThanOrEqual(0.35);
    expect(lanternLightAlpha(0.05, 12)).toBeGreaterThanOrEqual(0.35);
    expect(lanternLightAlpha(0, 12)).toBe(0);
  });

  it('grows a relic in and shrinks it out without popping', () => {
    expect(relicPresence(12, 12)).toBe(0);
    expect(relicPresence(6, 12)).toBe(1);
    expect(relicPresence(0.2, 12)).toBeGreaterThan(0);
    expect(relicPresence(0.2, 12)).toBeLessThan(1);
    expect(relicPresence(0, 12)).toBe(0);
  });

  it('floats the orb off the right shoulder, turning with the wearer', () => {
    const pose = createOrbPose();
    writeOrbPose(pose, 0, 2, 0, 0, 0, 5, true);
    // facing +Z: the wearer's right is -X
    expect(pose.x).toBeLessThan(-0.5);
    expect(pose.y).toBeGreaterThan(2);
    writeOrbPose(pose, 0, 2, 0, Math.PI / 2, 0, 5, true);
    // facing +X: the right is +Z
    expect(pose.z).toBeGreaterThan(0.5);
    // deterministic: same inputs, same pose
    const a = writeOrbPose(createOrbPose(), 1, 1, 1, 0.3, 4.2, 9, false);
    const b = writeOrbPose(createOrbPose(), 1, 1, 1, 0.3, 4.2, 9, false);
    expect(a).toEqual(b);
  });

  it('flies a Kindling bolt from orb to target on a bounded clock', () => {
    expect(kindlingBoltDuration(0)).toBeGreaterThan(0);
    expect(kindlingBoltDuration(1000)).toBeLessThanOrEqual(0.7);
    const from = { x: 0, y: 2, z: 0 };
    const to = { x: 20, y: 1, z: 0 };
    const out = { x: 0, y: 0, z: 0 };
    expect(writeKindlingBoltPoint(out, from, to, 0)).toEqual(from);
    expect(writeKindlingBoltPoint(out, from, to, 1)).toEqual(to);
    writeKindlingBoltPoint(out, from, to, 0.5);
    expect(out.y).toBeGreaterThan(1.5);
  });

  it('swings the hammer down to its strike and lets it go', () => {
    const pose = createHammerPose();
    expect(writeHammerPose(pose, 0.01, false)).toBe(true);
    const raised = pose.swing;
    writeHammerPose(pose, HAMMER_STRIKE_SEC, false);
    expect(pose.swing).toBeGreaterThan(raised + 2);
    expect(writeHammerPose(pose, 5, false)).toBe(false);
    expect(pose.scale).toBe(0);
  });

  it('thins cosmetic embers with quality but never to zero, and caps a burst', () => {
    expect(relicEmberRate('orb', 0)).toBeGreaterThan(0);
    expect(relicEmberRate('orb', 0)).toBeLessThan(relicEmberRate('orb', 1));
    const acc = { value: 0 };
    expect(drainEmission(acc, 10, 0.05)).toBe(0);
    expect(drainEmission(acc, 10, 0.05)).toBe(1);
    expect(drainEmission({ value: 0 }, 1000, 1)).toBe(4);
  });
});

describe('TrinketRelics painter', () => {
  function world(entities: Entity[]): IWorld {
    return {
      playerId: entities[0]?.id ?? 0,
      entities: new Map(entities.map((e) => [e.id, e])),
    } as unknown as IWorld;
  }

  function entity(id: number, auras: Aura[], x = 0): Entity {
    return { id, kind: 'player', dead: false, auras, pos: { x, y: 0, z: 0 } } as unknown as Entity;
  }

  function setup(entities: Entity[], ready = true) {
    const scene = new THREE.Scene();
    const views = new Map<number, { group: THREE.Group }>();
    for (const e of entities) {
      const group = new THREE.Group();
      group.position.set(e.pos.x, 0, 0);
      views.set(e.id, { group });
    }
    const w = { current: world(entities) };
    const burst = vi.fn();
    const gate = { ready };
    const relics = new TrinketRelics({
      scene,
      world: () => w.current,
      views,
      anchor: (id, frac, out) => {
        const view = views.get(id);
        if (!view) return null;
        return (out ?? new THREE.Vector3()).set(view.group.position.x, 2 * frac, 0);
      },
      ground: (x) => x * 0.01,
      vfx: { burst },
      time: () => 1,
      ready: () => gate.ready,
    });
    return { scene, views, w, burst, relics, gate };
  }

  it('builds every pool hidden, tagged for the vfx prewarm, and adds nothing later', () => {
    const h = setup([entity(1, [aura(TRINKET_AURA.kindlingOrb, 6)])]);
    const meshes: THREE.Mesh[] = [];
    h.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.userData.renderCategory).toBe('vfx');
    expect(h.relics.activeCounts()).toEqual({
      orbs: 0,
      lanterns: 0,
      lights: 0,
      hammers: 0,
      bolts: 0,
    });
    let count = 0;
    h.scene.traverse(() => count++);
    h.relics.update(0.2);
    h.relics.handleSpellfx(
      {
        sourceId: 1,
        targetId: 1,
        school: 'fire',
        fx: 'selfCast',
        ability: 'trinket_forgefathers_temper',
      },
      true,
    );
    h.relics.update(0.05);
    let after = 0;
    h.scene.traverse(() => after++);
    expect(after).toBe(count);
  });

  it('shows the orb while the aura lives and takes it away when it goes', () => {
    const h = setup([entity(1, [aura(TRINKET_AURA.kindlingOrb, 6)])]);
    h.relics.update(0.2);
    expect(h.relics.activeCounts().orbs).toBe(1);
    h.w.current = world([entity(1, [])]);
    h.relics.update(0.2);
    expect(h.relics.activeCounts().orbs).toBe(0);
  });

  it('holds the cosmetic orb behind a cold cast gate', () => {
    const h = setup([entity(1, [aura(TRINKET_AURA.kindlingOrb, 6)])], false);
    h.relics.update(0.2);
    expect(h.relics.activeCounts().orbs).toBe(0);
  });

  it('claims the Kindling bolt only when it can leave a live orb', () => {
    const h = setup([entity(1, [aura(TRINKET_AURA.kindlingOrb, 6)]), entity(2, [], 10)]);
    const bolt = {
      sourceId: 1,
      targetId: 2,
      school: 'fire',
      fx: 'projectile',
      ability: 'trinket_kindling_orb_bolt',
    };
    expect(h.relics.handleSpellfx(bolt, true)).toBe(false);
    h.relics.update(0.2);
    expect(h.relics.handleSpellfx(bolt, false)).toBe(false);
    expect(h.relics.handleSpellfx(bolt, true)).toBe(true);
    expect(h.relics.activeCounts().bolts).toBe(1);
    h.burst.mockClear();
    for (let i = 0; i < 20; i++) h.relics.update(0.05);
    expect(h.relics.activeCounts().bolts).toBe(0);
    // it bursts on arrival at the target
    expect(h.burst.mock.calls.some((c) => (c[0] as THREE.Vector3).x === 10 && c[2] > 1)).toBe(true);
  });

  it('stands the lantern of any wearer at its stored spot and lights it even on a cold gate', () => {
    const lantern = aura(TRINKET_AURA.lantern, 10, { value2: 40, value3: -6 });
    const h = setup([entity(1, []), entity(7, [lantern], 3)], false);
    h.relics.update(0.2);
    const counts = h.relics.activeCounts();
    expect(counts.lights).toBe(1);
    expect(counts.lanterns).toBe(0);
    const light = h.scene.getObjectByName('lantern-light') as THREE.Mesh;
    let found: THREE.Mesh | null = null;
    h.scene.traverse((o) => {
      if (o.name === 'lantern-light' && o.visible) found = o as THREE.Mesh;
    });
    expect(found ?? light).toBeTruthy();
    const lit = found as unknown as THREE.Mesh;
    expect(lit.position.x).toBe(40);
    expect(lit.position.z).toBe(-6);
    // draped: every vertex rides the ground under it (ground = x * 0.01)
    const pos = lit.geometry.getAttribute('position');
    for (const i of [0, 7, pos.count - 1]) {
      expect(pos.getY(i)).toBeCloseTo((40 + pos.getX(i)) * 0.01 + 0.09, 5);
    }
    h.gate.ready = true;
    h.relics.update(0.2);
    expect(h.relics.activeCounts().lanterns).toBe(1);
    h.w.current = world([entity(1, []), entity(7, [], 3)]);
    h.relics.update(0.2);
    expect(h.relics.activeCounts().lights).toBe(0);
  });

  it('brings the Forgefather hammer down once and bursts at the strike', () => {
    const h = setup([entity(1, [])]);
    expect(
      h.relics.handleSpellfx(
        {
          sourceId: 1,
          targetId: 1,
          school: 'fire',
          fx: 'selfCast',
          ability: 'trinket_forgefathers_temper',
        },
        true,
      ),
    ).toBe(false);
    h.relics.update(0.05);
    const strikes = () => h.burst.mock.calls.filter((c) => c[2] >= 8).length;
    expect(strikes()).toBe(0);
    for (let i = 0; i < 10; i++) h.relics.update(0.05);
    expect(strikes()).toBe(1);
    for (let i = 0; i < 20; i++) h.relics.update(0.05);
    expect(h.relics.activeCounts().hammers).toBe(0);
  });
});
