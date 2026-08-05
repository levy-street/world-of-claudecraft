import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMotes } from '../src/render/motes';
import { freezeStaticMatrices } from '../src/render/static_matrix';
import { Weather } from '../src/render/weather';

function installCanvasStub(): void {
  const gradient = { addColorStop: vi.fn() };
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Three.js streaming buffer contracts', () => {
  it('computes and freezes an existing static hierarchy without freezing later children', () => {
    const root = new THREE.Group();
    root.position.set(3, 4, 5);
    const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    child.position.set(2, 0, 0);
    root.add(child);

    freezeStaticMatrices(root);

    expect(root.matrixAutoUpdate).toBe(false);
    expect(child.matrixAutoUpdate).toBe(false);
    expect(child.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([5, 4, 5]);

    const laterChild = new THREE.Group();
    laterChild.position.set(0, 6, 0);
    root.add(laterChild);
    root.updateMatrixWorld();
    expect(laterChild.matrixAutoUpdate).toBe(true);
    expect(laterChild.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([3, 10, 5]);
  });

  it('streams mote positions without re-uploading unchanged colors', () => {
    installCanvasStub();
    const view = buildMotes(0x5eed);
    const points = view.group.children[0] as THREE.Points;
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = points.geometry.getAttribute('color') as THREE.BufferAttribute;

    expect(position.usage).toBe(35048);

    view.update(0, 0, 1 / 60);
    const positionVersion = position.version;
    const colorVersion = color.version;
    expect(colorVersion).toBeGreaterThan(0);

    view.update(0, 0, 1 / 60);
    expect(position.version).toBeGreaterThan(positionVersion);
    expect(color.version).toBe(colorVersion);
  });

  it('declares the precipitation position stream dynamic before its first upload', () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const weather = new Weather(scene, true);
    const points = scene.children[0] as THREE.Points;
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const material = points.material as THREE.PointsMaterial;

    expect(position.usage).toBe(35048);

    const snowMap = material.map;
    const materialVersion = material.version;
    weather.update(new THREE.Vector3(), 1 / 60, 'marsh');
    expect(material.map).not.toBe(snowMap);
    expect(material.version).toBe(materialVersion);
  });
});
