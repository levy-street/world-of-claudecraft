// The King of the Hill circle's warm twin (src/render/hill_ring.ts): the
// first hill a session sees hands a hidden twin, built by the live ring's own
// builder, to the renderer's compile gate, once, and keeps it for the session,
// while the live ring itself is never gated, hidden or delayed. The real-GL
// half (zero programs linked at the live ring's first draw, canvas and render
// target) is tests/browser/hill_ring_programs.browser.test.ts.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue } from '../src/render/background_gpu_queue';
import { HillRingVisuals } from '../src/render/hill_ring';
import { materialProgramSignature, prewarmProgramContentKeys } from '../src/render/prewarm_policy';
import type { HillInfo } from '../src/world_api/world_pvp';
import { stripComments } from './helpers/strip_comments';

function hill(over: Partial<HillInfo> = {}): HillInfo {
  return {
    zoneId: 'z',
    x: 120,
    z: -40,
    radius: 50,
    phase: 'warning',
    minutesLeft: 15,
    standing: 'counted',
    inZone: true,
    inside: false,
    holder: 'none',
    holderCount: 0,
    yourCount: 0,
    challenger: 'none',
    challengerCount: 0,
    contest: 0,
    ...over,
  };
}

const unevenGround = (x: number, z: number): number => Math.sin(x * 0.1) * 3 + Math.cos(z * 0.07);

function rig(withGate = true) {
  const scene = new THREE.Scene();
  const submitted: THREE.Object3D[] = [];
  const gate = withGate
    ? (target: THREE.Object3D) => {
        submitted.push(target);
        return Promise.resolve();
      }
    : undefined;
  const visuals = new HillRingVisuals(scene, gate, unevenGround);
  const liveRing = () => scene.getObjectByName('hill-ring') ?? null;
  return { scene, submitted, visuals, liveRing };
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) out.push(obj as THREE.Mesh);
  });
  return out;
}

function programKey(mesh: THREE.Mesh): string {
  const material = mesh.material as THREE.MeshBasicMaterial;
  const color = mesh.geometry.getAttribute('color');
  const [content] = prewarmProgramContentKeys(
    {
      isSkinnedMesh: (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
      isInstancedMesh: (mesh as THREE.InstancedMesh).isInstancedMesh === true,
      hasMorphPositions: mesh.geometry.morphAttributes.position !== undefined,
      hasTangents: mesh.geometry.getAttribute('tangent') !== undefined,
      hasNormals: mesh.geometry.getAttribute('normal') !== undefined,
      vertexColorItemSize: color ? color.itemSize : 0,
      castShadow: mesh.castShadow,
    },
    [materialProgramSignature(material)],
  );
  return `${content}|tm${material.toneMapped}|p${material.precision}|pa${material.premultipliedAlpha}`;
}

const keySet = (root: THREE.Object3D): string[] => [...new Set(meshesOf(root).map(programKey))];

const materialNames = (root: THREE.Object3D): string[] =>
  meshesOf(root)
    .map((mesh) => (mesh.material as THREE.Material).name)
    .sort();

function watchDisposals(root: THREE.Object3D): string[] {
  const disposed: string[] = [];
  for (const mesh of meshesOf(root)) {
    const material = mesh.material as THREE.Material;
    material.addEventListener('dispose', () => disposed.push(material.name));
    mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
  }
  return disposed;
}

const ringsIn = (scene: THREE.Scene): THREE.Object3D[] =>
  scene.children.filter((child) => child.name.startsWith('hill-ring'));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hill ring warm twin', () => {
  it('submits nothing while no hill has been seen', () => {
    const { submitted, visuals, liveRing } = rig();
    for (let i = 0; i < 5; i++) {
      visuals.sync(null);
      visuals.update(0.05);
    }
    expect(submitted).toHaveLength(0);
    expect(liveRing()).toBeNull();
  });

  it.each([
    ['the warning', hill()],
    ['an already risen hill (reconnect, /dev hill)', hill({ phase: 'active', holder: 'other' })],
  ])('compiles one hidden, detached twin at the first sighting of %s', (_arm, info) => {
    const { submitted, visuals, liveRing } = rig();
    visuals.sync(info);
    expect(submitted).toHaveLength(1);
    const twin = submitted[0];
    expect(twin.name).toBe('hill-ring-twin');
    expect(twin.visible).toBe(false);
    expect(twin.parent).toBeNull();
    expect(meshesOf(twin)).toHaveLength(2);
    expect(materialNames(twin)).toEqual(['hill-ring:fill', 'hill-ring:rim']);
    expect(liveRing()).not.toBeNull();
    expect(submitted).not.toContain(liveRing());
  });

  it('names the live ring materials by module and role', () => {
    const { visuals, liveRing } = rig();
    visuals.sync(hill());
    expect(materialNames(liveRing() as THREE.Object3D)).toEqual([
      'hill-ring:fill',
      'hill-ring:rim',
    ]);
  });

  it('never gates, hides or delays the live ring', () => {
    const { scene, submitted, visuals, liveRing } = rig();
    visuals.sync(hill());
    const live = liveRing();
    expect(live?.parent).toBe(scene);
    expect(live?.visible).toBe(true);
    for (const mesh of meshesOf(live as THREE.Object3D)) expect(mesh.visible).toBe(true);
    for (const target of submitted) {
      let reached = false;
      target.traverse((obj) => {
        if (obj === live) reached = true;
      });
      expect(reached).toBe(false);
    }
  });

  it('draws the live ring the same with or without a compile gate', () => {
    const gated = rig(true);
    const bare = rig(false);
    const create = vi.spyOn(
      HillRingVisuals.prototype as unknown as { create: () => unknown },
      'create',
    );
    try {
      for (const r of [gated, bare]) {
        r.visuals.sync(hill({ phase: 'active', holder: 'you', challenger: 'other' }));
        r.visuals.update(0.4);
      }
      const builds = (visuals: HillRingVisuals) =>
        create.mock.contexts.filter((ctx) => ctx === visuals).length;
      expect(builds(gated.visuals)).toBe(2);
      expect(builds(bare.visuals)).toBe(1);
      expect(ringsIn(bare.scene)).toEqual([bare.liveRing()]);
    } finally {
      create.mockRestore();
    }
    const summary = (root: THREE.Object3D | null) =>
      meshesOf(root as THREE.Object3D).map((m) => ({
        visible: m.visible,
        renderOrder: m.renderOrder,
        vertices: m.geometry.getAttribute('position').count,
        color: (m.material as THREE.MeshBasicMaterial).color.getHex(),
        opacity: (m.material as THREE.MeshBasicMaterial).opacity,
      }));
    expect(summary(gated.liveRing())).toEqual(summary(bare.liveRing()));
    expect(gated.liveRing()?.visible).toBe(true);
  });

  it('detaches the live ring when the hill ends', () => {
    const { scene, visuals, liveRing } = rig();
    visuals.sync(hill());
    const first = liveRing();
    expect(first?.parent).toBe(scene);
    visuals.sync(null);
    expect(scene.getObjectByName('hill-ring') ?? null).toBeNull();
    expect(first?.parent).toBeNull();
  });

  it('moves the ring to a new spot without a hill end in between', () => {
    const { scene, visuals, liveRing } = rig();
    visuals.sync(hill());
    const first = liveRing();
    visuals.sync(hill({ x: 9 }));
    const rings = scene.children.filter((child) => child.name === 'hill-ring');
    expect(rings).toHaveLength(1);
    expect(rings[0]).not.toBe(first);
    expect(first?.parent).toBeNull();
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(rings[0]).getCenter(center);
    expect(center.x).toBeCloseTo(9, 0);
    expect(center.z).toBeCloseTo(-40, 0);
  });

  it('compiles once per session and never disposes the twin across hills', () => {
    const { submitted, visuals, liveRing } = rig();
    visuals.sync(hill());
    const twin = submitted[0];
    const disposed: string[] = [];
    for (const mesh of meshesOf(twin)) {
      (mesh.material as THREE.Material).addEventListener('dispose', () => disposed.push('mat'));
      mesh.geometry.addEventListener('dispose', () => disposed.push('geo'));
    }
    const firstLive = liveRing();
    const firstLiveDisposed: string[] = [];
    for (const mesh of meshesOf(firstLive as THREE.Object3D)) {
      (mesh.material as THREE.Material).addEventListener('dispose', () =>
        firstLiveDisposed.push('mat'),
      );
    }
    visuals.sync(hill({ phase: 'active' }));
    visuals.sync(null);
    visuals.sync(hill({ x: -300, z: 410 }));
    visuals.sync(hill({ x: -300, z: 410, phase: 'active', holder: 'you' }));
    visuals.sync(null);
    expect(firstLiveDisposed).toHaveLength(2);
    expect(submitted).toHaveLength(1);
    expect(disposed).toHaveLength(0);
    expect(twin.parent).toBeNull();
  });

  it('shares the live ring program key in every live state', () => {
    const { submitted, visuals, liveRing } = rig();
    visuals.sync(hill());
    const twinKeys = keySet(submitted[0]);
    expect(twinKeys).toHaveLength(1);
    const states: HillInfo[] = [
      hill(),
      hill({ phase: 'active' }),
      hill({ phase: 'active', holder: 'you' }),
      hill({ phase: 'active', holder: 'other', challenger: 'you', contest: 4 }),
    ];
    for (const state of states) {
      visuals.sync(state);
      for (let i = 0; i < 7; i++) visuals.update(0.3);
      expect(keySet(liveRing() as THREE.Object3D)).toEqual(twinKeys);
    }
  });

  it('tells a different program apart (the parity pin can fail)', () => {
    const { submitted, visuals } = rig();
    visuals.sync(hill());
    const selectionShaped = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 32),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    expect(keySet(selectionShaped)).not.toEqual(keySet(submitted[0]));
  });

  it('disposes a rejected twin, warns once and retries only at the next hill', async () => {
    const scene = new THREE.Scene();
    const submitted: THREE.Object3D[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const visuals = new HillRingVisuals(
        scene,
        (target) => {
          submitted.push(target);
          return Promise.reject(new Error('link failed'));
        },
        unevenGround,
      );
      visuals.sync(hill());
      expect(submitted).toHaveLength(1);
      const disposed = watchDisposals(submitted[0]);
      expect(scene.getObjectByName('hill-ring')?.visible).toBe(true);
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect([...disposed].sort()).toEqual([
        'geometry',
        'geometry',
        'hill-ring:fill',
        'hill-ring:rim',
      ]);
      for (let frame = 0; frame < 5; frame++) visuals.sync(hill({ phase: 'active' }));
      await settle();
      expect(submitted).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      visuals.sync(null);
      visuals.sync(hill({ x: 9, z: 9 }));
      visuals.sync(hill({ x: 9, z: 9 }));
      expect(submitted).toHaveLength(2);
      expect(scene.getObjectByName('hill-ring')?.visible).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet when the rejection is a renderer shutdown', async () => {
    const scene = new THREE.Scene();
    const queue = createBackgroundGpuQueue();
    const submitted: THREE.Object3D[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const visuals = new HillRingVisuals(
        scene,
        (target) => {
          submitted.push(target);
          return queue.run(() => undefined, undefined, 'live-gate:hill-ring-twin');
        },
        unevenGround,
      );
      visuals.sync(hill());
      const disposed = watchDisposals(submitted[0]);
      void queue.shutdown(new Error('Renderer shut down'));
      await settle();
      expect(warn).not.toHaveBeenCalled();
      expect(disposed).toHaveLength(4);
    } finally {
      warn.mockRestore();
    }
  });

  it('hands the renderer world compile gate to the hill ring', () => {
    const source = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const call = /new HillRingVisuals\(\s*this\.scene,\s*(\w+),/.exec(source);
    expect(call).not.toBeNull();
    const argument = call?.[1] ?? '';
    const before = source.slice(0, call?.index ?? 0);
    const declaration = before.lastIndexOf(`const ${argument} =`);
    expect(declaration).toBeGreaterThanOrEqual(0);
    const between = source.slice(declaration, call?.index ?? 0);
    expect(between.startsWith(`const ${argument} = this.worldCompileGate();`)).toBe(true);
    expect(between).not.toMatch(/\n {2}\}/);
  });
});
