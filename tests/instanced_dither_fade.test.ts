// The dithered camera ghost for instanced decor (instanced_dither_fade.ts and
// the dithered arm of instanced_occluder_ghosts.ts): an occluding instance
// stays in its batch and drops fragments from a per-instance attribute inside
// the source material's one program. No zero-scale swap, no stand-in, no gate
// consult, no prewarm twin; the blended arm is pinned untouched beside it.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachInstancedDitherFade,
  disposeGhostHideGeometry,
  GHOST_HIDE_ATTRIBUTE,
  ghostHideAttribute,
  ghostHideGeometry,
  hasInstancedDitherFade,
  instancedDitherFadeInternalsForTest,
  withInstancedDitherFade,
  writeInstanceGhostAlpha,
} from '../src/render/instanced_dither_fade';
import {
  ghostFadeBatchMaterial,
  InstancedOccluderGhosts,
} from '../src/render/instanced_occluder_ghosts';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import { attachDitherFade, setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  installOccluderFadeGate,
  resetOccluderFadeGateForTest,
} from '../src/render/occluder_fade_gate';
import { stepTreeHide, type TreeHideable, updateTreeHides } from '../src/render/tree_hide_fade';

const ROOT = new URL('../', import.meta.url);
const read = (path: string): string =>
  readFileSync(new URL(path, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const KEY = instancedDitherFadeInternalsForTest.programCacheKey;
const HIDE = Math.fround(1 - OCCLUDER_FADE_ALPHA);

const STANDARD_VERTEX = [
  '#include <common>',
  'void main() {',
  '#include <begin_vertex>',
  '#include <project_vertex>',
  '}',
].join('\n');
const STANDARD_FRAGMENT = [
  '#include <common>',
  'void main() {',
  '#include <clipping_planes_fragment>',
  'vec4 diffuseColor = vec4( diffuse, opacity );',
  '}',
].join('\n');

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];
function compile(material: THREE.Material): Shader {
  const shader = {
    uniforms: {},
    vertexShader: STANDARD_VERTEX,
    fragmentShader: STANDARD_FRAGMENT,
  } as unknown as Shader;
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
}

function sourceGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  geometry.addGroup(0, 6, 0);
  geometry.setDrawRange(0, 30);
  geometry.userData.kit = 'oak';
  return geometry;
}

function batch(count = 4): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    ghostHideGeometry(sourceGeometry(), count),
    new THREE.MeshStandardMaterial(),
    count,
  );
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 0, 0));
  return mesh;
}

function fakeHost() {
  const compiles: object[] = [];
  return {
    compiles,
    host: {
      compile: (root: object) =>
        new Promise<void>(() => {
          compiles.push(root);
        }),
      schedule: () => () => undefined,
    },
  };
}

beforeEach(() => {
  setDitherFadeEnabledForTest(true);
  resetOccluderFadeGateForTest();
});
afterEach(() => {
  setDitherFadeEnabledForTest(null);
  resetOccluderFadeGateForTest();
});

describe('the per-instance dither shader layer', () => {
  it('declares the attribute under USE_INSTANCING only and writes the varying on every variant', () => {
    const shader = compile(attachInstancedDitherFade(new THREE.MeshStandardMaterial()));
    expect(shader.vertexShader).toMatch(
      /^#ifdef USE_INSTANCING\n\s*attribute float aGhostHide;\n#endif\nvarying float vGhostHide;\n/,
    );
    expect(shader.vertexShader).toMatch(
      /#include <begin_vertex>\n#ifdef USE_INSTANCING\n\s*vGhostHide = aGhostHide;\n#else\n\s*vGhostHide = 0\.0;\n#endif/,
    );
    // The attribute is named nowhere outside its guards.
    const unguarded = shader.vertexShader.replace(/#ifdef USE_INSTANCING[\s\S]*?#endif/g, '');
    expect(unguarded).not.toContain(GHOST_HIDE_ATTRIBUTE);
    expect(shader.fragmentShader.startsWith('varying float vGhostHide;\n')).toBe(true);
  });

  it('discards on the shared Bayer pattern, and never at hide 0 (a missing attribute)', () => {
    const shader = compile(attachInstancedDitherFade(new THREE.MeshStandardMaterial()));
    expect(shader.fragmentShader).toContain(
      '#include <clipping_planes_fragment>\n  if ( ( 1.0 - vGhostHide ) < 1.0 ) {',
    );
    expect(shader.fragmentShader).toContain(
      'if ( ( 1.0 - vGhostHide ) <= ( ghostBayer[ ghostIndex ] + 0.5 ) / 16.0 ) discard;',
    );
    // One source of the pattern: the building layer splices the same matrix.
    const building = new THREE.MeshStandardMaterial();
    attachDitherFade(building);
    const matrix = /float ghostBayer\[16\] = float\[16\]\([\s\S]*?\);/;
    expect(compile(building).fragmentShader.match(matrix)?.[0]).toBe(
      shader.fragmentShader.match(matrix)?.[0],
    );
    expect(read('src/render/instanced_dither_fade.ts')).not.toContain('ghostBayer');
  });

  it('chains the previous hook and key, and stays idempotent under a second compile', () => {
    const material = new THREE.MeshStandardMaterial();
    let calls = 0;
    material.onBeforeCompile = (shader) => {
      calls++;
      shader.vertexShader = `// wind\n${shader.vertexShader}`;
    };
    material.customProgramCacheKey = () => 'wind-v1';
    attachInstancedDitherFade(material);
    const hook = material.onBeforeCompile;
    attachInstancedDitherFade(material);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(`wind-v1|${KEY}`);
    // The dry-compile hook runs it again against a throwaway shader object.
    const first = compile(material);
    const second = compile(material);
    expect(calls).toBe(2);
    expect(second.vertexShader).toBe(first.vertexShader);
    expect(second.fragmentShader).toBe(first.fragmentShader);
    expect(first.vertexShader).toContain('// wind');
    expect(first.vertexShader.match(/varying float vGhostHide;/g)).toHaveLength(1);
  });

  it('keys a hook without a custom key on that hook source, not on its own', () => {
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = (shader) => {
      shader.vertexShader = `// a\n${shader.vertexShader}`;
    };
    const b = new THREE.MeshStandardMaterial();
    b.onBeforeCompile = (shader) => {
      shader.vertexShader = `// b\n${shader.vertexShader}`;
    };
    attachInstancedDitherFade(a);
    attachInstancedDitherFade(b);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey().endsWith(`|${KEY}`)).toBe(true);
  });

  it('is re-attached by cloneMaterialWithHooks, on the same composed key', () => {
    const source = attachInstancedDitherFade(new THREE.MeshStandardMaterial());
    const bare = source.clone();
    expect(hasInstancedDitherFade(bare)).toBe(true);
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
    const clone = cloneMaterialWithHooks(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(compile(clone).fragmentShader).toBe(compile(source).fragmentShader);
    // A clone of an undecorated source gains nothing.
    const plain = cloneMaterialWithHooks(new THREE.MeshStandardMaterial());
    expect(hasInstancedDitherFade(plain)).toBe(false);
  });

  it('follows the page style: untouched on the blended one', () => {
    setDitherFadeEnabledForTest(false);
    const material = new THREE.MeshStandardMaterial();
    const key = material.customProgramCacheKey();
    expect(withInstancedDitherFade(material)).toBe(material);
    expect(hasInstancedDitherFade(material)).toBe(false);
    expect(material.customProgramCacheKey()).toBe(key);
    const source = new THREE.MeshStandardMaterial();
    expect(ghostFadeBatchMaterial(source)).toBe(source);
  });

  it('gives a borrowed source ONE decorated clone for the page', () => {
    const source = new THREE.MeshStandardMaterial({ name: 'keep-wall' });
    const twin = ghostFadeBatchMaterial(source);
    expect(twin).not.toBe(source);
    expect(hasInstancedDitherFade(twin)).toBe(true);
    expect(hasInstancedDitherFade(source)).toBe(false);
    expect(ghostFadeBatchMaterial(source)).toBe(twin);
  });
});

describe('the geometry shell', () => {
  it('shares every attribute object and the index by identity, plus its own hide attribute at 0', () => {
    const source = sourceGeometry();
    const shell = ghostHideGeometry(source, 5);
    expect(shell).not.toBe(source);
    expect(shell.index).toBe(source.index);
    for (const name of Object.keys(source.attributes)) {
      expect(shell.getAttribute(name), name).toBe(source.getAttribute(name));
    }
    expect(source.getAttribute(GHOST_HIDE_ATTRIBUTE)).toBeUndefined();
    const hide = shell.getAttribute(GHOST_HIDE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
    expect(hide.isInstancedBufferAttribute).toBe(true);
    expect(hide.itemSize).toBe(1);
    expect(Array.from(hide.array)).toEqual([0, 0, 0, 0, 0]);
    expect(shell.groups).toEqual(source.groups);
    expect(shell.drawRange).toEqual(source.drawRange);
    expect(shell.userData.kit).toBe('oak');
    expect(shell.boundingSphere?.equals(source.boundingSphere as THREE.Sphere)).toBe(true);
    expect(shell.boundingSphere).not.toBe(source.boundingSphere);
    // Two batches of one source never share a hide attribute.
    const sibling = ghostHideGeometry(source, 5);
    expect(sibling.getAttribute(GHOST_HIDE_ATTRIBUTE)).not.toBe(hide);
    expect(sibling.getAttribute('position')).toBe(source.getAttribute('position'));
  });

  it('never deep-copies, and hands the source back on the blended style', () => {
    expect(read('src/render/instanced_dither_fade.ts')).not.toMatch(
      /\.clone\(\)\s*as|source\.clone\(/,
    );
    setDitherFadeEnabledForTest(false);
    const source = sourceGeometry();
    expect(ghostHideGeometry(source, 3)).toBe(source);
  });

  it('disposes with ONLY its own attribute attached, so live siblings keep their buffers', () => {
    const source = sourceGeometry();
    const shell = ghostHideGeometry(source, 2);
    const sibling = ghostHideGeometry(source, 2);
    // What three's WebGLGeometries.onGeometryDispose would delete: the index
    // and every attribute on the geometry at the moment of the event.
    const deleted: unknown[] = [];
    shell.addEventListener('dispose', () => {
      if (shell.index) deleted.push(shell.index);
      for (const name in shell.attributes) deleted.push(shell.attributes[name]);
    });
    const own = shell.getAttribute(GHOST_HIDE_ATTRIBUTE);
    disposeGhostHideGeometry(shell);
    expect(deleted).toEqual([own]);
    expect(sibling.getAttribute('position')).toBe(source.getAttribute('position'));
    expect(source.index).not.toBeNull();
    // A second call, or a geometry that is no shell, dispatches nothing.
    let events = 0;
    source.addEventListener('dispose', () => events++);
    shell.addEventListener('dispose', () => events++);
    disposeGhostHideGeometry(shell);
    disposeGhostHideGeometry(source);
    expect(events).toBe(0);
  });

  it('is flagged shared so a generic per-view disposal skips it', () => {
    expect(ghostHideGeometry(sourceGeometry(), 1).userData.sharedRendererResource).toBe(true);
  });

  it('every consumer that disposes its batches releases the shell through the safe path', () => {
    for (const file of ['src/render/yumi_maze.ts', 'src/render/battleground_placements.ts']) {
      const text = read(file);
      expect(text, file).toContain('ghostHideGeometry(');
      expect(text, file).toContain('disposeGhostHideGeometry(');
      expect(text, file).not.toMatch(/geometry\.dispose\(\)/);
    }
  });
});

describe('writing one instance', () => {
  it('uploads one float, only on a change', () => {
    const mesh = batch();
    const attribute = ghostHideAttribute(mesh) as THREE.InstancedBufferAttribute;
    const version = attribute.version;
    writeInstanceGhostAlpha(mesh, 2, OCCLUDER_FADE_ALPHA);
    expect(Array.from(attribute.array)).toEqual([0, 0, HIDE, 0]);
    expect(attribute.updateRanges).toEqual([{ start: 2, count: 1 }]);
    expect(attribute.version).toBe(version + 1);
    // A held ghost rewrites the same value every frame: nothing to upload.
    writeInstanceGhostAlpha(mesh, 2, OCCLUDER_FADE_ALPHA);
    expect(attribute.updateRanges).toHaveLength(1);
    expect(attribute.version).toBe(version + 1);
  });

  it('is inert on a batch whose geometry is no shell', () => {
    const mesh = new THREE.InstancedMesh(sourceGeometry(), new THREE.MeshStandardMaterial(), 2);
    expect(() => writeInstanceGhostAlpha(mesh, 0, 0.2)).not.toThrow();
  });
});

describe('the ghost pool on the dithered style', () => {
  it('hides through the attribute: no stand-in, no matrix swap', () => {
    const mesh = batch();
    const before = Array.from(mesh.instanceMatrix.array);
    const matrixVersion = mesh.instanceMatrix.version;
    const ghosts = new InstancedOccluderGhosts();
    expect(ghosts.dithered).toBe(true);
    const visible = new THREE.Matrix4().makeTranslation(1, 0, 0);
    const hide = ghosts.hide(mesh, 1, visible);
    expect(hide.standIn).toBeNull();
    ghosts.fade(hide, ghosts.step(1, true, 1 / 60, false));
    expect(mesh.children).toHaveLength(0);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(before);
    expect(mesh.instanceMatrix.version).toBe(matrixVersion);
    expect(Array.from(ghostHideAttribute(mesh)?.array ?? [])).toEqual([0, HIDE, 0, 0]);
    ghosts.show(hide);
    expect(Array.from(ghostHideAttribute(mesh)?.array ?? [])).toEqual([0, 0, 0, 0]);
    expect(mesh.instanceMatrix.version).toBe(matrixVersion);
  });

  it('restores in ONE step, where the blended style eases', () => {
    const dithered = new InstancedOccluderGhosts();
    expect(dithered.step(OCCLUDER_FADE_ALPHA, false, 1 / 60, false)).toBe(1);
    setDitherFadeEnabledForTest(false);
    const blended = new InstancedOccluderGhosts();
    const eased = blended.step(OCCLUDER_FADE_ALPHA, false, 1 / 60, false);
    expect(eased).toBeGreaterThan(OCCLUDER_FADE_ALPHA);
    expect(eased).toBeLessThan(1);
    expect(blended.step(OCCLUDER_FADE_ALPHA, false, 1 / 60, true)).toBe(1);
  });

  it('never consults the fade gate: ready at once, prefetch asks for nothing', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const ghosts = new InstancedOccluderGhosts();
    const parts = [{ mesh: batch() }, { mesh: batch() }];
    expect(ghosts.ready(parts[0].mesh)).toBe(true);
    expect(ghosts.allReady(parts)).toBe(true);
    ghosts.prefetchAll(parts);
    expect(compiles).toHaveLength(0);
    // The same calls on the blended style do reach the gate.
    setDitherFadeEnabledForTest(false);
    expect(new InstancedOccluderGhosts().allReady(parts)).toBe(false);
    expect(compiles.length).toBeGreaterThan(0);
  });

  it('recycles its handles, so a steady ghosting allocates nothing', () => {
    const mesh = batch();
    const ghosts = new InstancedOccluderGhosts();
    const first = ghosts.hide(mesh, 0, new THREE.Matrix4());
    ghosts.show(first);
    const visible = new THREE.Matrix4();
    const second = ghosts.hide(mesh, 3, visible);
    expect(second).toBe(first);
    expect(second.index).toBe(3);
    expect(second.visible).toBe(visible);
  });
});

describe('the ghost pool on the blended style', () => {
  beforeEach(() => setDitherFadeEnabledForTest(false));

  it('zero-scales the instance behind a stand-in and puts both back', () => {
    const mesh = new THREE.InstancedMesh(sourceGeometry(), new THREE.MeshStandardMaterial(), 3);
    const visible = new THREE.Matrix4().makeTranslation(4, 5, 6);
    for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, visible);
    const ghosts = new InstancedOccluderGhosts();
    expect(ghosts.dithered).toBe(false);
    const hide = ghosts.hide(mesh, 1, visible);
    const standIn = hide.standIn?.mesh as THREE.Mesh;
    expect(standIn.parent).toBe(mesh);
    expect(standIn.matrix.equals(visible)).toBe(true);
    const hidden = new THREE.Matrix4();
    mesh.getMatrixAt(1, hidden);
    expect(hidden.equals(visible.clone().scale(new THREE.Vector3(0, 0, 0)))).toBe(true);
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 16, count: 16 }]);
    ghosts.fade(hide, 0.5);
    expect((standIn.material as THREE.Material).opacity).toBe(0.5);
    expect((standIn.material as THREE.Material).transparent).toBe(true);
    ghosts.show(hide);
    expect(standIn.parent).toBeNull();
    mesh.getMatrixAt(1, hidden);
    expect(hidden.equals(visible)).toBe(true);
    expect(mesh.geometry.getAttribute(GHOST_HIDE_ATTRIBUTE)).toBeUndefined();
  });
});

describe('the tree hide on the dithered style', () => {
  function tree(mesh: THREE.InstancedMesh, index: number): TreeHideable {
    return {
      x: 0,
      z: 0,
      r: 1,
      topY: 8,
      hidden: false,
      alpha: 1,
      ghosts: [],
      parts: [{ mesh, index, visibleMatrix: new THREE.Matrix4() }],
      prefetched: false,
    };
  }

  it('snaps in, holds, and comes back in one frame, all inside the batch', () => {
    const mesh = batch();
    const ghosts = new InstancedOccluderGhosts();
    const t = tree(mesh, 2);
    expect(stepTreeHide(t, ghosts, true, 1 / 60, false)).toBe(true);
    expect(t.hidden).toBe(true);
    expect(t.alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(Array.from(ghostHideAttribute(mesh)?.array ?? [])).toEqual([0, 0, HIDE, 0]);
    expect(mesh.children).toHaveLength(0);
    expect(stepTreeHide(t, ghosts, false, 1 / 60, false)).toBe(false);
    expect(t.alpha).toBe(1);
    expect(t.ghosts).toHaveLength(0);
    expect(Array.from(ghostHideAttribute(mesh)?.array ?? [])).toEqual([0, 0, 0, 0]);
  });

  it('skips the prefetch sweep: nothing is latched and the gate is never asked', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const trees = [tree(batch(), 0)];
    updateTreeHides(trees, new InstancedOccluderGhosts(), 50, 1, 50, 58, 4, 50, 1 / 60, false);
    expect(trees[0].prefetched).toBe(false);
    expect(compiles).toHaveLength(0);
  });
});

describe('where the layer is attached', () => {
  it('foliage decorates its tree materials where they are made, and shells every hideable batch', () => {
    const foliage = read('src/render/foliage.ts');
    const factory = foliage.slice(
      foliage.indexOf('function foliageMaterial('),
      foliage.indexOf('function toFloatAttribute('),
    );
    expect(factory).toMatch(
      /if \(role === 'tree'\) withInstancedDitherFade\(mat\);\s+materialCache\.set\(key, mat\);/,
    );
    expect(foliage).toContain('ghostHideGeometry(part.geometry, n)');
    expect(foliage).toContain('ghostHideGeometry(farTrunkGeo(part.geometry), n)');
  });

  it('the maze and the battleground build their batches on the decorated material', () => {
    for (const file of ['src/render/yumi_maze.ts', 'src/render/battleground_placements.ts']) {
      const text = read(file);
      expect(text, file).toContain('ghostFadeBatchMaterial(');
      expect(text, file).not.toContain('setMatrixAt(h.index');
      expect(text, file).not.toContain('ZERO_SCALE');
      expect(text, file).not.toMatch(/\.acquire\(|\.release\(/);
    }
  });
});
