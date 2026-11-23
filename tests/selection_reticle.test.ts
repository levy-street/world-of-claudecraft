import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linkPiecesOf } from '../src/render/compile_gate_pieces';
import {
  noteRendererContextLost,
  noteRendererContextRestored,
} from '../src/render/context_generation';
import { markProgramReady } from '../src/render/linked_program_readiness';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import { disposeRendererPrewarmAndGroundFx } from '../src/render/renderer_resource_lifecycle';
import { createSelectionReticle, SelectionReticle } from '../src/render/selection_reticle';

const ground = { terrain: () => 0, support: () => 0, sample: () => 0 };
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function sync(reticle: SelectionReticle, hostile = true, heavy = true) {
  reticle.sync(0, 0, 0, 1, hostile, heavy, 0.05, 0, 1);
}

function heavyGroup(reticle: SelectionReticle): THREE.Object3D {
  const group = reticle.group.getObjectByName('selection-reticle-heavy');
  if (!group) throw new Error('missing heavy reticle group');
  return group;
}

describe('selection reticle preparation and lifecycle', () => {
  it('names each owned material by module and role without changing program signatures', () => {
    const reticle = new SelectionReticle(
      new THREE.Scene(),
      ground,
      async () => true,
      () => 0,
    );
    const materials = new Set<THREE.Material>();
    reticle.group.traverse((node) => {
      if (node instanceof THREE.Mesh) materials.add(node.material);
    });
    expect([...materials].map((material) => material.name).sort()).toEqual([
      'selection-reticle:dashes',
      'selection-reticle:disc',
      'selection-reticle:ring',
    ]);
    for (const material of materials) {
      const signature = materialProgramSignature(material);
      const name = material.name;
      material.name = '';
      expect(materialProgramSignature(material)).toBe(signature);
      material.name = name;
    }
    reticle.dispose();
  });

  it.each(['removed', 'childremoved'] as const)(
    'continues terminal cleanup after actual %s dispatch throws',
    async (event) => {
      const scene = new THREE.Scene();
      let complete!: (ready: boolean) => void;
      const prepare = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            complete = resolve;
          }),
      );
      const reticle = new SelectionReticle(scene, ground, prepare, () => 0);
      sync(reticle);
      await flush();
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      reticle.group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        resources.add(node.geometry);
        resources.add(node.material);
      });
      expect(resources.size).toBe(8);
      const calls = [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
      calls[0].mockImplementation(() => {
        throw new Error('resource failure');
      });
      const detachFailure = () => {
        throw new Error('detach failure');
      };
      if (event === 'removed') reticle.group.addEventListener('removed', detachFailure);
      else scene.addEventListener('childremoved', detachFailure);
      // Clearing one child must not prevent attempts to clear its siblings either.
      reticle.group.addEventListener('childremoved', () => {
        throw new Error('clear failure');
      });
      const laterCleanup = vi.fn();
      const errors: unknown[] = [];
      const owner = {
        prewarmDepthMaterials: new Map(),
        selectionReticle: reticle,
        farmPatchVisuals: { dispose: laterCleanup },
      };
      const bestEffort = (cleanup: () => void) => {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      };
      disposeRendererPrewarmAndGroundFx(owner, bestEffort);
      for (const call of calls) expect(call).toHaveBeenCalledOnce();
      expect(laterCleanup).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(AggregateError);
      expect((errors[0] as AggregateError).errors).toHaveLength(5); // detach, resource, three children
      expect(reticle.group.parent).toBeNull();
      expect(reticle.group.children).toHaveLength(0);
      complete(true);
      await flush();
      sync(reticle);
      reticle.hide();
      expect(reticle.group.visible).toBe(false);
      expect(prepare).toHaveBeenCalledOnce();
      expect(() => reticle.dispose()).not.toThrow();
      for (const call of calls) expect(call).toHaveBeenCalledOnce();
    },
  );

  it('keeps the classic ring until exact heavy preparation succeeds, once per context', async () => {
    let complete: (ready: boolean) => void = () => {};
    let generation = 0;
    const prepare = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    const reticle = new SelectionReticle(new THREE.Scene(), ground, prepare, () => generation);
    sync(reticle);
    sync(reticle);
    await flush();
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]).toHaveLength(1);
    expect(heavyGroup(reticle).visible).toBe(false);
    expect(reticle.group.children[0].visible).toBe(true);
    complete(true);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(true);
    expect(reticle.group.children[0].visible).toBe(false);
    generation++;
    sync(reticle);
    await flush();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(heavyGroup(reticle).visible).toBe(false);
    expect(reticle.group.children[0].visible).toBe(true);
  });

  it.each(['unproved', 'rejected'] as const)('never reveals after a %s gate', async (outcome) => {
    const reticle = new SelectionReticle(
      new THREE.Scene(),
      ground,
      () => (outcome === 'unproved' ? Promise.resolve(false) : Promise.reject(new Error('gate'))),
      () => 0,
    );
    sync(reticle);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(false);
    expect(reticle.group.children[0].visible).toBe(true);
  });

  it('leaves friendly and default-off selection gold and never requests heavy work', () => {
    const prepare = vi.fn(() => Promise.resolve(true));
    const reticle = new SelectionReticle(new THREE.Scene(), ground, prepare, () => 0);
    sync(reticle, true, false);
    sync(reticle, false, true);
    expect(prepare).not.toHaveBeenCalled();
    expect(heavyGroup(reticle).visible).toBe(false);
    const base = reticle.group.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(base.visible).toBe(true);
    expect(base.material.color.getHex()).toBe(0xd4af37);
  });

  it('prepares the exact live heavy mesh/material variants and requires recorded program proof', async () => {
    const records = new Map<object, unknown>();
    let prove = false;
    let compiled: THREE.Object3D | undefined;
    let signatures: string[] = [];
    const compile = vi.fn(async (root: THREE.Object3D) => {
      compiled = root;
      signatures = linkPiecesOf(root).map(([node]) =>
        materialProgramSignature((node as THREE.Mesh).material as THREE.Material),
      );
      if (!prove) return;
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const program = { getUniforms: () => ({}), getAttributes: () => ({}) };
        markProgramReady(program);
        records.set(node.material, { programs: new Map([['live', program]]) });
      });
    });
    const webgl = { properties: { get: (material: object) => records.get(material) } };
    const reticle = createSelectionReticle(new THREE.Scene(), 42, () => 0, compile, webgl);
    sync(reticle);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(false); // resolved promise is not proof
    prove = true;
    noteRendererContextLost(webgl);
    noteRendererContextRestored(webgl);
    sync(reticle);
    await flush();
    sync(reticle);
    expect(compiled).toBe(heavyGroup(reticle));
    if (!compiled) throw new Error('reticle did not submit its preparation root');
    expect(linkPiecesOf(compiled)).toHaveLength(3);
    expect(
      linkPiecesOf(compiled).map(([node]) => {
        const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        return [
          mesh.material.side,
          mesh.geometry.hasAttribute('normal'),
          mesh.geometry.hasAttribute('uv'),
        ];
      }),
    ).toEqual([
      [THREE.FrontSide, true, true],
      [THREE.DoubleSide, true, true],
      [THREE.DoubleSide, false, false],
    ]);
    expect(signatures).toEqual(
      linkPiecesOf(compiled).map(([node]) =>
        materialProgramSignature((node as THREE.Mesh).material as THREE.Material),
      ),
    );
    expect((compiled.children[1] as THREE.Mesh).material).toMatchObject({
      side: THREE.DoubleSide,
    });
    expect((compiled.children[2] as THREE.Mesh).material).toMatchObject({
      side: THREE.DoubleSide,
    });
    expect(heavyGroup(reticle).visible).toBe(true);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain("(root) => this.compileGate(root, true, 'selection-reticle-heavy')");
    expect(renderer).not.toContain('contextRestoredCount');
  });

  it('rechecks replacement properties on the current renderer context before heavy reveal', async () => {
    let records = new Map<object, unknown>();
    const propertiesFor = (map: Map<object, unknown>) => ({
      get: (material: object) => map.get(material),
    });
    const webgl = { properties: propertiesFor(records) };
    let publish = true;
    const compile = vi.fn(async (root: THREE.Object3D) => {
      if (!publish) return;
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const program = { getUniforms: () => ({}), getAttributes: () => ({}) };
        markProgramReady(program);
        records.set(node.material, { programs: new Map([['context', program]]) });
      });
    });
    const reticle = createSelectionReticle(new THREE.Scene(), 42, () => 0, compile, webgl);
    sync(reticle);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(true);
    noteRendererContextLost(webgl);
    records = new Map();
    webgl.properties = propertiesFor(records);
    noteRendererContextRestored(webgl);
    publish = false;
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(false);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(false);
    expect(reticle.group.children[0].visible).toBe(true);
    publish = true;
    sync(reticle, true, false);
    sync(reticle);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(true);
    expect(compile).toHaveBeenCalledTimes(3);
    reticle.dispose();
  });

  it('ignores stale completion after context reset or terminal disposal', async () => {
    const completions: Array<(ready: boolean) => void> = [];
    let generation = 0;
    const reticle = new SelectionReticle(
      new THREE.Scene(),
      ground,
      () =>
        new Promise<boolean>((resolve) => {
          completions.push(resolve);
        }),
      () => generation,
    );
    sync(reticle);
    await flush();
    generation++;
    sync(reticle);
    await flush();
    completions[0](true);
    await flush();
    sync(reticle);
    expect(heavyGroup(reticle).visible).toBe(false);
    reticle.dispose();
    completions[1](true);
    await flush();
    sync(reticle);
    reticle.hide();
    expect(reticle.group.visible).toBe(false);
    expect(reticle.group.children).toHaveLength(0);
  });

  it('disposes every unique owned resource once through renderer cleanup, even if one throws', () => {
    const scene = new THREE.Scene();
    const reticle = new SelectionReticle(
      scene,
      ground,
      () => Promise.resolve(true),
      () => 0,
    );
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    reticle.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      resources.add(node.geometry);
      resources.add(node.material);
    });
    expect(resources.size).toBe(8); // five geometries, three materials; shared ticks deduped
    const calls = [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
    calls[0].mockImplementation(() => {
      throw new Error('geometry');
    });
    const errors: unknown[] = [];
    const owner = { prewarmDepthMaterials: new Map(), selectionReticle: reticle };
    const bestEffort = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };
    disposeRendererPrewarmAndGroundFx(owner, bestEffort);
    disposeRendererPrewarmAndGroundFx(owner, bestEffort);
    for (const call of calls) expect(call).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(scene.children).not.toContain(reticle.group);
    expect(() =>
      disposeRendererPrewarmAndGroundFx({ prewarmDepthMaterials: new Map() }, bestEffort),
    ).not.toThrow(); // partial renderer construction has no reticle yet
  });
});
