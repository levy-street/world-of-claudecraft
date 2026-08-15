// Pins the three r165 internals the shadow-pass count gate relies on
// (src/render/shadow_pass_gate_core.ts, src/render/props.ts far-cell bakes).
// A three bump that changes any of these silently degrades the gate to
// double draws, missing shadows, or permanently culled meshes; this suite
// names the coupling so the bump re-verifies it (src/render/CLAUDE.md,
// "don't bump Three casually").

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachShadowPassOnlyGate } from '../src/render/shadow_pass_gate_core';

describe('three internals the shadow-pass gate relies on (r165)', () => {
  it('exposes the per-object shadow hooks the gate installs', () => {
    const obj = new THREE.Object3D();
    expect(typeof obj.onBeforeShadow).toBe('function');
    expect(typeof obj.onAfterShadow).toBe('function');
  });

  it('caches an EMPTY instanced bounding sphere when computed at count 0 (the hazard)', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 4);
    for (let i = 0; i < 4; i++) {
      im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 0, 0));
    }
    im.count = 0;
    im.computeBoundingSphere();
    // Empty sphere: radius -1, intersects nothing. This is why every gated
    // mesh must compute (or pin) its bounds BEFORE the count is zeroed.
    expect(im.boundingSphere?.radius).toBe(-1);
    im.count = 4;
    im.computeBoundingSphere();
    expect(im.boundingSphere && im.boundingSphere.radius > 0).toBe(true);
  });

  it('keeps a gated mesh frustum-visible when bounds are computed before attach', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 2);
    im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(200, 0, 200));
    im.setMatrixAt(1, new THREE.Matrix4().makeTranslation(210, 0, 200));
    im.computeBoundingSphere();
    attachShadowPassOnlyGate(im);
    expect(im.count).toBe(0);
    // A camera looking straight at the instances, far from the world origin.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    cam.position.set(205, 5, 150);
    cam.lookAt(205, 0, 200);
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    im.updateMatrixWorld();
    expect(frustum.intersectsObject(im)).toBe(true);
  });

  it('skips the instanced GL draw entirely at count 0 (the free color-pass skip)', async () => {
    // Drive three's internal instanced buffer renderer with a stub GL: at
    // primcount 0 it must neither issue the draw nor count it.
    const module = (await import(
      'three/src/renderers/webgl/WebGLBufferRenderer.js'
    )) as unknown as {
      WebGLBufferRenderer: new (
        gl: unknown,
        extensions: unknown,
        info: { update: (...args: unknown[]) => void },
      ) => {
        setMode(mode: unknown): void;
        renderInstances(start: number, count: number, primcount: number): void;
      };
    };
    const WebGLBufferRenderer = module.WebGLBufferRenderer;
    let draws = 0;
    let infoUpdates = 0;
    const gl = { drawArraysInstanced: () => draws++ };
    const info = { update: () => infoUpdates++ };
    const renderer = new WebGLBufferRenderer(gl, {}, info);
    renderer.setMode(4);
    renderer.renderInstances(0, 36, 0);
    expect(draws).toBe(0);
    expect(infoUpdates).toBe(0);
    renderer.renderInstances(0, 36, 2);
    expect(draws).toBe(1);
    expect(infoUpdates).toBe(1);
  });
});
