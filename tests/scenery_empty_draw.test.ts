import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { preserveSceneryShadow } from '../src/render/scenery_detail_shadow';
import { skipEmptySceneryDraws } from '../src/render/scenery_empty_draw';

// Three's shadow path passes null here despite the narrower declarations.
const noScene = null as unknown as THREE.Scene;
const noGroup = null as unknown as THREE.GeometryGroup;

describe('owned scenery empty submissions', () => {
  it('skips empty colour owners but submits their restored native shadow representation', () => {
    const source = new THREE.BoxGeometry();
    const geometry = source.clone();
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 4);
    mesh.count = 0;
    const submitted: number[] = [];
    const original = vi.fn(() => {
      submitted.push(mesh.count);
    });
    const renderer = { renderBufferDirect: original } as Pick<
      THREE.WebGLRenderer,
      'renderBufferDirect'
    >;
    const restoreDraw = skipEmptySceneryDraws(renderer, (object) => object === mesh);
    const restoreShadow = preserveSceneryShadow(mesh, source, 4);
    const camera = new THREE.PerspectiveCamera();
    const draw = () =>
      renderer.renderBufferDirect(camera, noScene, geometry, mesh.material, mesh, noGroup);
    const shadowArgs = [
      renderer,
      mesh,
      camera,
      camera,
      geometry,
      mesh.material,
      null,
    ] as unknown as Parameters<typeof mesh.onBeforeShadow>;
    draw();
    expect(submitted).toEqual([]);
    mesh.onBeforeShadow(...shadowArgs);
    draw();
    expect(submitted).toEqual([4]);
    mesh.onAfterShadow(...shadowArgs);
    draw();
    expect(submitted).toEqual([4]);
    expect(mesh.count).toBe(0);
    restoreShadow();
    restoreDraw();
    expect(renderer.renderBufferDirect).toBe(original);
  });

  it('retains unrelated empty draws and resumes a populated owned draw immediately', () => {
    const geometry = new THREE.BoxGeometry();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const other = new THREE.Mesh(geometry, mesh.material);
    const original = vi.fn();
    const renderer = { renderBufferDirect: original } as Pick<
      THREE.WebGLRenderer,
      'renderBufferDirect'
    >;
    const restore = skipEmptySceneryDraws(renderer, (object) => object === mesh);
    const camera = new THREE.PerspectiveCamera();
    geometry.setDrawRange(0, 0);
    renderer.renderBufferDirect(camera, noScene, geometry, mesh.material, mesh, noGroup);
    expect(original).not.toHaveBeenCalled();
    renderer.renderBufferDirect(camera, noScene, geometry, other.material, other, noGroup);
    expect(original).toHaveBeenLastCalledWith(
      camera,
      noScene,
      geometry,
      other.material,
      other,
      noGroup,
    );
    geometry.setDrawRange(0, 36);
    renderer.renderBufferDirect(camera, noScene, geometry, mesh.material, mesh, noGroup);
    expect(original).toHaveBeenCalledTimes(2);
    expect(original.mock.contexts.every((context) => context === renderer)).toBe(true);
    restore();
  });

  it('submits an ordinary source shadow while its colour geometry has an empty range', () => {
    const source = new THREE.BoxGeometry();
    source.setDrawRange(0, 36);
    const geometry = source.clone();
    geometry.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const submitted: number[] = [];
    const renderer = {
      renderBufferDirect: () => {
        submitted.push(geometry.drawRange.count);
      },
    } as Pick<THREE.WebGLRenderer, 'renderBufferDirect'>;
    const restoreDraw = skipEmptySceneryDraws(renderer, (object) => object === mesh);
    const restoreShadow = preserveSceneryShadow(mesh, source, 1);
    const camera = new THREE.PerspectiveCamera();
    const draw = () =>
      renderer.renderBufferDirect(camera, noScene, geometry, mesh.material, mesh, noGroup);
    const args = [
      renderer,
      mesh,
      camera,
      camera,
      geometry,
      mesh.material,
      null,
    ] as unknown as Parameters<typeof mesh.onBeforeShadow>;
    draw();
    mesh.onBeforeShadow(...args);
    draw();
    mesh.onAfterShadow(...args);
    draw();
    expect(submitted).toEqual([36]);
    expect(geometry.drawRange.count).toBe(0);
    restoreShadow();
    restoreDraw();
  });

  it('disables its retained callback without replacing a later renderer owner', () => {
    const original = vi.fn();
    const renderer = { renderBufferDirect: original } as Pick<
      THREE.WebGLRenderer,
      'renderBufferDirect'
    >;
    const restore = skipEmptySceneryDraws(renderer, () => true);
    const retained = renderer.renderBufferDirect;
    const later: THREE.WebGLRenderer['renderBufferDirect'] = function (
      this: Pick<THREE.WebGLRenderer, 'renderBufferDirect'>,
      ...args
    ) {
      retained.apply(this, args);
    };
    renderer.renderBufferDirect = later;
    restore();
    expect(renderer.renderBufferDirect).toBe(later);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    mesh.count = 0;
    renderer.renderBufferDirect(
      new THREE.PerspectiveCamera(),
      noScene,
      mesh.geometry,
      mesh.material,
      mesh,
      noGroup,
    );
    expect(original).toHaveBeenCalledOnce();
  });
});
