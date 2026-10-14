// A ship's motion (render/ship_motion.ts): which materials take the wind, which
// take the rock, and the shader patch it leaves on the SHARED template
// material - one program per material, gated in-shader on the player's
// distance so a harbour full of ships costs nothing past 100 yards (SPACEY's
// ask: animate inside 100, not out; and the rock "super low key").

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  attachShipMotion,
  SHIP_HEAVE_YD,
  SHIP_PITCH_RAD,
  SHIP_ROLL_RAD,
  SHIP_WATERLINE_YD,
  SHIP_WIND_FULL,
  SHIP_WIND_OFF,
  shipRockFrame,
  shipRockMaterial,
  shipWindKindForMaterial,
} from '../src/render/ship_motion';

function meshWith(name: string, withUv = true): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  if (!withUv) geo.deleteAttribute('uv');
  const mat = new THREE.MeshStandardMaterial();
  mat.name = name;
  return new THREE.Mesh(geo, mat);
}

/** A template the way the shipped galleon GLB parses: ONE quantized node
 *  carrying every material, scaled x24.456 and lifted 16 yards. */
function galleonLike(names: string[]): { root: THREE.Group; mats: Map<string, THREE.Material> } {
  const root = new THREE.Group();
  const node = new THREE.Group();
  node.position.set(3.251, 16, 0);
  node.scale.setScalar(24.456);
  const mats = new Map<string, THREE.Material>();
  for (const name of names) {
    const mesh = meshWith(name);
    mats.set(name, mesh.material as THREE.Material);
    node.add(mesh);
  }
  root.add(node);
  return { root, mats };
}

/** The vertex shader the material's hook produces, for asserting on the GLSL. */
function patchedVertexShader(mat: THREE.Material): string {
  const sh = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: '',
  };
  mat.onBeforeCompile(sh as never, null as never);
  return sh.vertexShader;
}

describe('ship wind', () => {
  it('takes the Warden kit canvas and nothing else', () => {
    expect(shipWindKindForMaterial('ship_sail')).toBe('sail');
    expect(shipWindKindForMaterial('ship_sail_crest')).toBe('sail');
    expect(shipWindKindForMaterial('ship_cloth')).toBe('flag');
    expect(shipWindKindForMaterial('wharf_cloth')).toBe('flag');
    // rigging, hull, decks: still
    expect(shipWindKindForMaterial('ship_rope_net')).toBeNull();
    expect(shipWindKindForMaterial('ship_hull')).toBeNull();
    // a catalogue GLB that happens to name a material "sail" keeps its look
    expect(shipWindKindForMaterial('sail')).toBeNull();
    expect(shipWindKindForMaterial('Boat_Sail_01')).toBeNull();
    expect(shipWindKindForMaterial(undefined)).toBeNull();
  });

  it('rests past 100 yards, full inside it', () => {
    expect(SHIP_WIND_OFF).toBe(100);
    expect(SHIP_WIND_FULL).toBeLessThan(SHIP_WIND_OFF);
    const sail = meshWith('ship_sail');
    attachShipMotion(sail);
    const glsl = patchedVertexShader(sail.material as THREE.Material);
    // the gate IS the distance from the mesh's world base to the player
    expect(glsl).toContain('uSwayPlayer');
    expect(glsl).toContain(
      `smoothstep(${SHIP_WIND_FULL.toFixed(4)}, ${SHIP_WIND_OFF.toFixed(4)}, distance(wocShipBase, uSwayPlayer))`,
    );
    // and every displacement statement rides that gate
    for (const stmt of glsl.split(';')) {
      if (!stmt.includes('transformed') || !stmt.includes('+=')) continue;
      expect(stmt, stmt.trim()).toContain('wocShipGate');
    }
  });

  it('bellies a sail forward only, off UVs that are zero on the bolt ropes', () => {
    const sail = meshWith('ship_sail');
    attachShipMotion(sail);
    const glsl = patchedVertexShader(sail.material as THREE.Material);
    expect(glsl).toContain('sin(PI * wocSailUv.x) * sin(PI * wocSailUv.y)');
    // the swell is ONE-SIDED, along +X: a sail hangs forward of its mast, so a
    // belly that can only deepen can never clip back through the pole
    expect(glsl).toContain('transformed.x += max(wocSailWave, 0.0)');
    expect(glsl).not.toContain('transformed += objectNormal');
    expect(glsl).not.toContain('transformed.x -=');
  });

  it('whips a pennant from the hoist, and falls back flat with no UVs', () => {
    const flag = meshWith('ship_cloth');
    attachShipMotion(flag);
    const glsl = patchedVertexShader(flag.material as THREE.Material);
    // weight grows from the hoist (u 0) to the fly (u 1), squared
    expect(glsl).toContain('clamp(uv.x, 0.0, 1.0)');
    expect(glsl).toContain('wocFlagW *= wocFlagW');
    // the two skins of a pennant move TOGETHER: model frame, not the normal
    expect(glsl).toContain('transformed.y +=');
    expect(glsl).not.toContain('transformed += objectNormal');
    // and the cloth is drawn back toward the hoist as it swings, so it keeps
    // its length instead of stretching out
    expect(glsl).toContain('wocFlagSnap * wocFlagSnap');
    // v is the per-pennant seed: three flags on ONE ship must not snap in
    // unison, so it shifts both the phase and the rate
    // the seed is SNAPPED so every vertex of one pennant shares it: read raw,
    // the two edges drift onto different rates and wring the flag out of shape
    expect(glsl).toContain('float wocFlagSeed = floor(uv.y * 16.0 + 0.5) / 16.0');
    expect(glsl).toContain('fract(wocFlagSeed * 7.7)');
    expect(glsl).toContain('fract(wocFlagSeed * 17.3)');

    const noUv = meshWith('wharf_cloth', false);
    attachShipMotion(noUv);
    const flat = patchedVertexShader(noUv.material as THREE.Material);
    expect(flat).not.toContain('clamp(uv.x');
    expect(flat).toContain('float wocFlagW = 0.2200');
  });

  it('patches each shared material once, and leaves other materials alone', () => {
    const sail = meshWith('ship_sail');
    const mat = sail.material as THREE.Material;
    attachShipMotion(sail);
    const first = mat.onBeforeCompile;
    const key = mat.customProgramCacheKey();
    attachShipMotion(sail); // a second view attaching to the same cached template
    expect(mat.onBeforeCompile).toBe(first);
    expect(mat.customProgramCacheKey()).toBe(key);

    // a lone hull-less timber mesh (no canvas, no ship) is not a ship's fabric
    const timber = meshWith('ship_timber');
    const timberMat = timber.material as THREE.Material;
    const before = timberMat.onBeforeCompile;
    attachShipMotion(timber);
    expect(timberMat.onBeforeCompile).toBe(before);
    expect(timberMat.userData.wocShipMotion).toBeUndefined();
  });

  it('has a renderer that actually writes the gate uniform every frame', () => {
    // The whole effect (and the placed-tree sway, which shares the uniform)
    // hangs off `uSwayPlayer`. It shipped with NO caller at all, so the gate
    // sat at its 1e6 start and nothing placed ever moved: sails, pennants and
    // every placed tree were silently frozen. Pin the call.
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    const calls = renderer.match(/updateTreeSwayPlayer\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // the prewarm frame and the live sync
    expect(renderer).toContain("import { updateTreeSwayPlayer } from './tree_sway'");
    // In the Studio the sim's dummy player rides the CAMERA, so a maker
    // inspecting a ship from 120 yards out saw it frozen: both call sites rank
    // from the free-cam look-at while the editor hosts the renderer (the same
    // rule the point-light budget uses).
    const lookAtCalls =
      renderer.match(
        /updateTreeSwayPlayer\(\s*this\.editorCam \? this\.cameraLookAt\.x : [\w.]+,\s*this\.editorCam \? this\.cameraLookAt\.z : [\w.]+,?\s*\)/g,
      ) ?? [];
    expect(lookAtCalls.length).toBe(calls.length);
  });
});

describe('ship rock', () => {
  it('is faint: a third of a degree of roll, less of pitch, a few cm of heave', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    expect(deg(SHIP_ROLL_RAD)).toBeLessThan(0.5);
    expect(deg(SHIP_PITCH_RAD)).toBeLessThan(deg(SHIP_ROLL_RAD));
    expect(SHIP_HEAVE_YD).toBeLessThan(0.05);
    // the axis is the waterline the float seat uses (editor/float_on_water_core.ts)
    expect(SHIP_WATERLINE_YD).toBe(1.72);
  });

  it('rocks every ship material of a template with a hull, canvas included', () => {
    const { root, mats } = galleonLike([
      'ship_hull',
      'ship_deck',
      'ship_timber',
      'ship_sail',
      'ship_cloth',
    ]);
    attachShipMotion(root);
    for (const [name, mat] of mats) {
      const glsl = patchedVertexShader(mat);
      expect(glsl, name).toContain('wocRockRoll');
      expect(glsl, name).toContain('wocRockPitch');
      expect(glsl, name).toContain('wocRockHeave');
      // every angle is gated, so a far ship is exactly still
      for (const line of glsl.split('\n')) {
        if (!/float wocRock(Roll|Pitch|Heave) =/.test(line) && !line.includes('* wocShipGate;'))
          continue;
      }
      expect(glsl.match(/wocRock(Roll|Pitch|Heave)[^;]*wocShipGate;/g)?.length, name).toBe(3);
    }
    // the canvas moves first and the rock carries it: wind before rock
    const sail = patchedVertexShader(mats.get('ship_sail') as THREE.Material);
    expect(sail.indexOf('wocSailWave')).toBeLessThan(sail.indexOf('wocRockRoll'));
    const flag = patchedVertexShader(mats.get('ship_cloth') as THREE.Material);
    expect(flag.indexOf('wocFlagSnap')).toBeLessThan(flag.indexOf('wocRockRoll'));
  });

  it('bakes the waterline and the heave into the quantized mesh frame', () => {
    const { root, mats } = galleonLike(['ship_hull']);
    attachShipMotion(root);
    const glsl = patchedVertexShader(mats.get('ship_hull') as THREE.Material);
    // the node lifts the unit-cube mesh 16 yards and scales it x24.456, so the
    // 1.72-yard waterline is at (1.72 - 16) / 24.456 in vertex units
    const pivot = (SHIP_WATERLINE_YD - 16) / 24.456;
    expect(glsl).toContain(`vec3(0.0, ${pivot.toFixed(4)}, 0.0)`);
    expect(glsl).toContain(`* ${(SHIP_HEAVE_YD / 24.456).toFixed(5)} * wocShipGate`);
    // the same numbers, from the frame helper
    const node = root.children[0];
    node.updateMatrixWorld(true);
    const frame = shipRockFrame(node.children[0]);
    expect(frame.pivotY).toBeCloseTo(pivot, 6);
    expect(frame.heave).toBeCloseTo(SHIP_HEAVE_YD / 24.456, 8);
  });

  it('never rocks the dock kit, nor a hull-less gangplank that shares the ship timber', () => {
    expect(shipRockMaterial('ship_timber')).toBe(true);
    expect(shipRockMaterial('wharf_cloth')).toBe(false);
    expect(shipRockMaterial('wharf_timber')).toBe(false);
    expect(shipRockMaterial(undefined)).toBe(false);
    // the gangplank: ship timber and rope, no hull -> still
    const { root, mats } = galleonLike(['ship_timber', 'ship_rope']);
    attachShipMotion(root);
    for (const [name, mat] of mats) {
      expect(mat.userData.wocShipMotion, name).toBeUndefined();
    }
    // a dock pennant flaps but stands on a pier that does not rock
    const pennant = meshWith('wharf_cloth');
    attachShipMotion(pennant);
    const glsl = patchedVertexShader(pennant.material as THREE.Material);
    expect(glsl).toContain('wocFlagSnap');
    expect(glsl).not.toContain('wocRockRoll');
  });

  it('keys programs by the patch content, so like materials still share one', () => {
    const { mats } = (() => {
      const t = galleonLike(['ship_hull', 'ship_deck']);
      attachShipMotion(t.root);
      return t;
    })();
    const a = (mats.get('ship_hull') as THREE.Material).customProgramCacheKey();
    const b = (mats.get('ship_deck') as THREE.Material).customProgramCacheKey();
    expect(a).toBe(b);
    expect(a).toContain('rock@');
    // canvas and hull differ, as they must
    const sail = meshWith('ship_sail');
    attachShipMotion(sail);
    expect((sail.material as THREE.Material).customProgramCacheKey()).not.toBe(a);
  });
});
