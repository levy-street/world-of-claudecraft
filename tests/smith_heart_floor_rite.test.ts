// The Anvil of the World's rite marks (src/render/smith_heart/heart_floor_rite_core.ts,
// Jose's playtest of 2026-11-19): the four vein grooves and the arrival's socket
// pits belong to the boss's entrance (and its death) only. The rite's share rises
// with the scene and is 0 outside it; the floor's shader gates the grooves on it
// and lays every socket flush outside it, the sockets the kit's own
// (docs/design/raid/kit/quarter_geom.py SOCKETS); the quarter seams are not touched.

import fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { heartFloorMaterial, sampleHeartFloorSockets } from '../src/render/smith_heart/heart_floor';
import {
  HEART_FLOOR_VERT_BODY,
  HEART_FLOOR_VERT_HEAD,
  heartFloorFragHead,
  heartFloorPaint,
} from '../src/render/smith_heart/heart_floor_glsl';
import {
  HEART_FLOOR_SOCKET_SPECS,
  HEART_FLOOR_SOCKETS,
  heartFloorRite,
  heartFloorSocketAt,
  heartSocketZone,
} from '../src/render/smith_heart/heart_floor_rite_core';

describe('the rite share', () => {
  it('is 0 before, after and outside the scene, 1 through it, easing in and out', () => {
    expect(heartFloorRite(-1, 16, 0.6, 3)).toBe(0);
    expect(heartFloorRite(Number.NaN, 16, 0.6, 3)).toBe(0);
    expect(heartFloorRite(16, 16, 0.6, 3)).toBe(0);
    expect(heartFloorRite(40, 16, 0.6, 3)).toBe(0);
    expect(heartFloorRite(0.3, 16, 0.6, 3)).toBeCloseTo(0.5, 6);
    expect(heartFloorRite(5, 16, 0.6, 3)).toBe(1);
    const late = heartFloorRite(15, 16, 0.6, 3);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(0.5);
  });
});

describe('the sockets', () => {
  it("are the kit's own (quarter_geom.py SOCKETS) and never overlap", () => {
    const py = fs.readFileSync('docs/design/raid/kit/quarter_geom.py', 'utf8');
    const block = py.slice(py.indexOf('SOCKETS = ('), py.indexOf('\n)', py.indexOf('SOCKETS = (')));
    const rows = [...block.matchAll(/\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) =>
      m.slice(1, 4).map(Number),
    );
    expect(rows).toEqual(HEART_FLOOR_SOCKET_SPECS.map((r) => [...r]));
    expect(heartSocketZone(8)).toBeCloseTo(0.85 + 8 * 0.085 + 1.15, 9);
    for (let i = 0; i < HEART_FLOOR_SOCKETS.length; i++)
      for (let j = i + 1; j < HEART_FLOOR_SOCKETS.length; j++) {
        const a = HEART_FLOOR_SOCKETS[i];
        const b = HEART_FLOOR_SOCKETS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i} ${j}`).toBeGreaterThan(a.r + b.r);
      }
    // Bearing clockwise from north: the torso's socket (20 degrees, 43 out) lies north-east.
    const torso = HEART_FLOOR_SOCKETS[1];
    expect(heartFloorSocketAt(torso.x, torso.z)).toBe(1);
    expect(torso.x).toBeGreaterThan(0);
    expect(torso.z).toBeGreaterThan(0);
    expect(heartFloorSocketAt(0, 0)).toBe(-1);
  });

  it('a mended socket wears the paint sampled round it on the sheet', () => {
    const s = HEART_FLOOR_SOCKETS[0];
    // A sheet point just past the socket's reach, painted red; one inside it painted black.
    const pos = [s.x + s.r + 1, 0.02, s.z, s.x, -0.4, s.z];
    const nrm = [0, 1, 0, 0, 1, 0];
    const col = [0.9, 0.1, 0.1, 0, 0, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sampleHeartFloorSockets([g, undefined]);
    const m = heartFloorMaterial(false) as THREE.Material & {
      onBeforeCompile: (sh: {
        uniforms: Record<string, THREE.IUniform>;
        vertexShader: string;
        fragmentShader: string;
      }) => void;
    };
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader);
    const paint = shader.uniforms.uHfSockCol.value as THREE.Color[];
    expect(paint[0].r).toBeCloseTo(0.9, 5);
    expect(paint[0].g).toBeCloseTo(0.1, 5);
    // Every hook the mend needs landed in the program.
    expect(shader.uniforms.uHfRite).toBeDefined();
    expect(shader.vertexShader).toContain('hfSockets(position.xz)');
    expect(shader.vertexShader).toContain('objectNormal = normalize(mix(objectNormal');
    expect(shader.vertexShader).toContain('transformed.y = mix(transformed.y');
  });
});

describe('the shader', () => {
  it('gates the grooves on the rite and lays the sockets flush outside it', () => {
    const paint = heartFloorPaint(false);
    expect(paint).toMatch(/float gK = uHfRite \*/);
    expect(heartFloorFragHead(false)).toContain('uniform float uHfRite;');
    // The vertex mend: off while the rite shows, a test per socket.
    expect(HEART_FLOOR_VERT_HEAD).toContain('float k = 1.0 - uHfRite;');
    expect((HEART_FLOOR_VERT_HEAD.match(/hfMendCol = uHfSockCol\[/g) ?? []).length).toBe(
      HEART_FLOOR_SOCKETS.length,
    );
    expect(HEART_FLOOR_VERT_BODY).toContain('vHfUp = mix(normal.y, 1.0, hfMendK)');
  });
});
