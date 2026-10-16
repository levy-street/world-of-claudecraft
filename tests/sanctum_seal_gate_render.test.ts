// The Seal Gate's cosmetic layer: the pure plan (sanctum_seal_gate_core.ts:
// the mist flow, its tier thinning, the rime fan) and the painter's contract
// (sanctum_seal_gate.ts: one point light, two cull groups, one instanced mist
// draw on the shared clock, the floor ladder, the stand-in when no GLB loaded).
// Three.js runs headless in Node (no WebGL needed for the scene graph).
// The mountain surfaces (sanctum_seal_gate_surface.ts): the spur's Thornpeak
// rock and the glacier ice, toned to the terrain around them and lit like it,
// with the inside test pinned against the shipped GLB's own geometry.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { MIST_GATE_PROGRAM_CACHE_KEY } from '../src/render/ignivar_mist_gate';
import {
  buildSanctumSealGate,
  SANCTUM_MIST_PROGRAM_CACHE_KEY,
  sanctumSealGateInternalsForTest,
} from '../src/render/sanctum_seal_gate';
import {
  type LinearRgb,
  linearLuma,
  type MistPose,
  rimeFanAlpha,
  rimeFanVertex,
  SANCTUM_GLACIER_ICE,
  SANCTUM_MIST_FILM,
  SANCTUM_MIST_FLOW,
  SANCTUM_RIME_FAN,
  SANCTUM_RUNE_LIGHT,
  SANCTUM_THORNPEAK_ROCK,
  sanctumMistPose,
  sanctumMistPuff,
  sanctumMistPuffCount,
  sealGateIceEdge,
  sealGateRockInside,
  sealGateSnowCover,
} from '../src/render/sanctum_seal_gate_core';
import {
  SANCTUM_ICE_PROGRAM_KEY,
  SANCTUM_ROCK_PROGRAM_KEY,
  sealGateSurfaceInternalsForTest,
} from '../src/render/sanctum_seal_gate_surface';
import { DUNGEONS } from '../src/sim/data';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;

describe('the cold mist plan', () => {
  it('thins the puffs by the static effects tier, never to zero', () => {
    const counts = (['low', 'medium', 'high', 'ultra'] as const).map(sanctumMistPuffCount);
    expect(counts).toEqual([6, 12, 18, 24]);
  });

  it('pours out of the mouth over the plaza, widening, fading in and out', () => {
    const puff = sanctumMistPuff(3, 12);
    const pose: MistPose = { x: 0, y: 0, z: 0, scale: 0, alpha: 0 };
    const t0 = (1 - puff.phase) / puff.speed; // the moment its cycle restarts
    const born = { ...sanctumMistPose(puff, t0 + 0.001, pose) };
    const mid = { ...sanctumMistPose(puff, t0 + 0.5 / puff.speed, pose) };
    const dying = { ...sanctumMistPose(puff, t0 + 0.999 / puff.speed, pose) };
    expect(born.z).toBeCloseTo(SANCTUM_MIST_FLOW.startLz, 1);
    expect(mid.z).toBeLessThan(born.z);
    expect(dying.z).toBeCloseTo(SANCTUM_MIST_FLOW.endLz, 0);
    expect(mid.scale).toBeGreaterThan(born.scale);
    expect(born.alpha).toBeLessThan(0.05);
    expect(mid.alpha).toBeCloseTo(1, 5);
    expect(dying.alpha).toBeLessThan(0.05);
    // no random stream: the same index always gives the same puff
    expect(sanctumMistPuff(3, 12)).toEqual(puff);
  });

  it('every puff lane lies inside the fan and the film fills the mouth behind the trigger', () => {
    for (let i = 0; i < 24; i++) {
      const p = sanctumMistPuff(i, 24);
      expect(Math.abs(p.lane)).toBeLessThanOrEqual(1);
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(1);
    }
    // the film stands behind the door line (lz 0), where the trigger has
    // already taken a walker, and is wider than the 4yd lane
    expect(SANCTUM_MIST_FILM.lz).toBeGreaterThan(2);
    expect(SANCTUM_MIST_FILM.width).toBeGreaterThan(4);
  });
});

describe('the rime fan', () => {
  it('opens from the gate toward the plaza and fades out at its rim and sides', () => {
    const f = SANCTUM_RIME_FAN;
    for (let row = 0; row <= f.rows; row++) {
      for (let col = 0; col <= f.cols; col++) {
        const a = rimeFanAlpha(row, col);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(0.85);
        const { lz } = rimeFanVertex(row, col);
        // the fan lies in front of the gate, never under the pylons or inside
        expect(lz).toBeLessThan(0);
      }
      expect(rimeFanAlpha(row, 0)).toBe(0);
      expect(rimeFanAlpha(row, f.cols)).toBe(0);
    }
    for (let col = 0; col <= f.cols; col++) expect(rimeFanAlpha(f.rows, col)).toBe(0);
    // about 12 yd of rime in front of the gate
    const far = rimeFanVertex(f.rows, f.cols / 2);
    expect(Math.hypot(far.lx, far.lz)).toBeGreaterThan(11);
    expect(Math.hypot(far.lx, far.lz)).toBeLessThan(15);
  });
});

describe('the Seal Gate painter', () => {
  it('builds one rune light, two cull groups and the cosmetic layer on the door', () => {
    sanctumSealGateInternalsForTest.resetCaches();
    const view = buildSanctumSealGate(SEED);
    expect(view.glowLights).toHaveLength(1);
    const light = view.glowLights[0];
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.color.getHex()).toBe(SANCTUM_RUNE_LIGHT.color);
    const door = DUNGEONS.gravewyrm_sanctum.doorPos;
    const base = terrainHeight(door.x, door.z, SEED);
    expect(light.position.y).toBeCloseTo(base + SANCTUM_RUNE_LIGHT.y, 5);
    expect(view.cullGroups.map((g) => g.name)).toEqual(['sanctumSealGateBody', 'sanctumIceTongue']);
    const gate = view.cullGroups[0];
    expect(gate.position.x).toBe(door.x);
    expect(gate.position.z).toBe(door.z);
    expect(gate.position.y).toBeCloseTo(base, 6);
    let points = 0;
    view.group.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) points++;
    });
    expect(points, 'at most one point light, through the fire-light sink').toBe(1);
  });

  it('the cold mist is ONE instanced draw on the shared clock, on the ground band', () => {
    const view = buildSanctumSealGate(SEED);
    const mist = view.group.getObjectByName('sanctumColdMist') as THREE.InstancedMesh;
    expect(mist.isInstancedMesh).toBe(true);
    expect(mist.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    const rime = view.group.getObjectByName('sanctumRimeFan') as THREE.Mesh;
    expect(rime.renderOrder).toBe(floorVfxRenderOrder('ground', 0));
    const material = mist.material as THREE.MeshBasicMaterial;
    expect(material.customProgramCacheKey()).toBe(SANCTUM_MIST_PROGRAM_CACHE_KEY);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    material.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.uTime).toBe(sharedUniforms.uTime);
    expect(shader.vertexShader).toContain('attribute vec4 aPuff');
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= vPuffAlpha');
    // the vertex stage is the core's own flow, constant for constant
    const src = sanctumSealGateInternalsForTest.mistVertex;
    expect(src).toContain(SANCTUM_MIST_FLOW.spread.toFixed(2));
    expect(src).toContain(SANCTUM_MIST_FLOW.startLz.toFixed(2));
    expect(src).toContain(SANCTUM_MIST_FLOW.endLz.toFixed(2));
  });

  it('the mouth film reuses the mist gate family program (no new program for the portal look)', () => {
    const view = buildSanctumSealGate(SEED);
    const film = view.group.getObjectByName('sanctumMistFilm') as THREE.Group;
    expect(film.children).toHaveLength(2);
    for (const sheet of film.children as THREE.Mesh[]) {
      const material = sheet.material as THREE.MeshBasicMaterial;
      expect(material.customProgramCacheKey()).toBe(MIST_GATE_PROGRAM_CACHE_KEY);
      expect(material.depthWrite).toBe(false);
    }
  });

  it('without the GLBs (headless, pre-load) the pylons still draw as a stand-in', () => {
    const view = buildSanctumSealGate(SEED);
    const body = view.cullGroups[0];
    let blocks = 0;
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.geometry as THREE.BoxGeometry).type === 'BoxGeometry') blocks++;
    });
    expect(blocks).toBe(3);
  });

  it('the rime follows the live tier: Standard on PBR tiers, Lambert where the tier sheds it', () => {
    sanctumSealGateInternalsForTest.resetCaches();
    const built: THREE.Material[] = [];
    for (const standardMaterials of [true, false]) {
      const restore = gfxInternalsForTest.overrideSettings({ standardMaterials });
      try {
        const m = sanctumSealGateInternalsForTest.rimeMaterial();
        expect(m).toBeInstanceOf(
          standardMaterials ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial,
        );
        // each family is built once and reused
        expect(sanctumSealGateInternalsForTest.rimeMaterial()).toBe(m);
        built.push(m);
      } finally {
        restore();
      }
    }
    expect(built[0]).not.toBe(built[1]);
    for (const m of built) {
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.polygonOffset).toBe(true);
      expect(m.vertexColors).toBe(true);
    }
  });

  it('the mist matrices are seeded across the flow envelope (the fog sweep measures them)', () => {
    const view = buildSanctumSealGate(SEED);
    const mist = view.group.getObjectByName('sanctumColdMist') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let minZ = Infinity;
    let maxAbsX = 0;
    for (let i = 0; i < mist.count; i++) {
      mist.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      minZ = Math.min(minZ, p.z);
      maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
    }
    expect(minZ).toBeLessThan(SANCTUM_MIST_FLOW.endLz / 2);
    expect(maxAbsX).toBeGreaterThan(3);
  });

  it('the runes are unlit and dimmed (a faint glow, never a light source)', () => {
    sanctumSealGateInternalsForTest.resetCaches();
    const runes = sanctumSealGateInternalsForTest.kitMaterial('KitGlow') as THREE.MeshBasicMaterial;
    expect(runes).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(runes.vertexColors).toBe(true);
    expect(runes.color.r).toBeLessThan(1);
  });
});

// ---- the mountain surfaces ----------------------------------------------------------

/** max / min channel: 1 is grey, the old glacier blue was 3.8. */
function chroma(c: LinearRgb): number {
  return Math.max(...c) / Math.min(...c);
}

interface FakeShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

function compileHook(material: THREE.Material, lib: 'standard' | 'lambert'): FakeShader {
  const shader: FakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader;
}

describe('the Thornpeak rock and glacier ice plan', () => {
  it('keeps the tunnel inside dark and tones every outer face as the mountain', () => {
    // the tunnel floor, its walls and vault, and the flags in front of the mouth
    expect(sealGateRockInside(0, 0.5, 10)).toBe(true);
    expect(sealGateRockInside(3.5, 6, 12)).toBe(true);
    expect(sealGateRockInside(0, 10.5, 4)).toBe(true);
    expect(sealGateRockInside(1, 0.2, 0)).toBe(true);
    // the crest above the vault, the flanks, the facade round the mouth, the
    // rock behind the tunnel's end and the ice tongue's cheeks are mountain
    expect(sealGateRockInside(0, 14, 4)).toBe(false);
    expect(sealGateRockInside(0, 21, 26)).toBe(false);
    expect(sealGateRockInside(8, 5, 10)).toBe(false);
    expect(sealGateRockInside(2, 6, 2.2)).toBe(false);
    expect(sealGateRockInside(0, 8, 30)).toBe(false);
    expect(sealGateRockInside(-18, 40, 45)).toBe(false);
  });

  it('the inside test matches the shipped tunnel: dark slate in, mountain rock out', async () => {
    await MeshoptDecoder.ready;
    const doc = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(
        readFileSync(path.join(__dirname, '..', 'public/models/props/sanctum_seal_gate.glb')),
      );
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'Entrance_Tunnel');
    if (!node) throw new Error('Entrance_Tunnel missing from the gate GLB');
    const t = node.getTranslation();
    const sc = node.getScale();
    const prim = node.getMesh()?.listPrimitives()[0];
    const pos = prim?.getAttribute('POSITION');
    const col = prim?.getAttribute('COLOR_0');
    if (!pos || !col) throw new Error('the tunnel lost its positions or colours');
    const p: number[] = [];
    const c: number[] = [];
    let inside = 0;
    let outside = 0;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      col.getElement(i, c);
      const lx = p[0] * sc[0] + t[0];
      const y = p[1] * sc[1] + t[1];
      const lz = p[2] * sc[2] + t[2];
      const luma = linearLuma([c[0], c[1], c[2]]);
      if (sealGateRockInside(lx, y, lz)) {
        inside++;
        // the builder lit only the rimed floor by the mouth inside the tunnel
        if (luma >= 0.09) {
          expect(y, `bright inside vertex ${lx},${y},${lz}`).toBeLessThan(2.5);
          expect(lz).toBeLessThan(8);
        }
      } else {
        outside++;
        // every outer face is the mountain's tone, bar the mouth's rim ring
        if (luma < 0.09) {
          expect(lz, `dark outer vertex ${lx},${y},${lz}`).toBeLessThanOrEqual(
            SANCTUM_THORNPEAK_ROCK.insideFrontLz,
          );
        }
      }
    }
    expect(inside).toBeGreaterThan(1000);
    expect(outside).toBeGreaterThan(1000);
  });

  it('the rock and ice sit at the mountain snow and rock values, never a saturated glow', () => {
    const r = SANCTUM_THORNPEAK_ROCK;
    const i = SANCTUM_GLACIER_ICE;
    // cool grey granite under a near-neutral snow, like the terrain's
    expect(linearLuma(r.snow)).toBeGreaterThan(linearLuma(r.rock) * 2.5);
    expect(linearLuma(r.rockDark)).toBeLessThan(linearLuma(r.rock));
    for (const c of [r.rock, r.rockDark, r.snow]) expect(chroma(c)).toBeLessThan(1.2);
    // the frost on the ice is the same snow, the faces a step under it, the
    // crevasses the one deep blue; the body ice stays well under the old
    // saturated glacier blue (chroma 3.8)
    expect(Math.abs(linearLuma(i.frost) - linearLuma(r.snow))).toBeLessThan(0.08);
    expect(chroma(i.frost)).toBeLessThan(1.25);
    for (const c of [i.clear, i.bubbly, i.edge]) {
      expect(chroma(c)).toBeLessThan(3);
      expect(linearLuma(c)).toBeGreaterThan(linearLuma(r.rock) * 2);
    }
    expect(linearLuma(i.clear)).toBeLessThan(linearLuma(i.bubbly));
    expect(linearLuma(i.bubbly)).toBeLessThan(linearLuma(i.frost));
    // the scattering thin edge brightens toward the snow, never past it by much
    expect(linearLuma(i.edge)).toBeGreaterThan(linearLuma(i.bubbly));
    expect(linearLuma(i.edge)).toBeLessThan(linearLuma(i.frost) * 1.15);
    expect(linearLuma(i.deep)).toBeLessThan(linearLuma(i.clear) / 2);
  });

  it('snow lies on upward faces, and the thin-edge scatter lives at the silhouette', () => {
    expect(sealGateSnowCover(1, 0.5)).toBe(1);
    expect(sealGateSnowCover(0, 0.5)).toBe(0);
    expect(sealGateSnowCover(0.6, 0.5)).toBeGreaterThan(sealGateSnowCover(0.5, 0.5));
    expect(sealGateIceEdge(0)).toBe(1);
    expect(sealGateIceEdge(1)).toBe(0);
    expect(sealGateIceEdge(-1)).toBe(0);
    expect(sealGateIceEdge(0.3)).toBeGreaterThan(sealGateIceEdge(0.6));
  });
});

describe('the mountain surface materials', () => {
  it('routes the spur and the tongue cheeks to the rock, every KitIce to the glacier ice', () => {
    sanctumSealGateInternalsForTest.resetCaches();
    sealGateSurfaceInternalsForTest.reset();
    const { kitMaterial } = sanctumSealGateInternalsForTest;
    const rock = kitMaterial('KitStone', 'Entrance_Tunnel');
    expect(rock.name).toBe('SanctumThornpeakRock');
    expect(kitMaterial('KitStone', 'Entrance_IceTongue')).toBe(rock);
    // the Smith's masonry and the props keep the plain lit stone
    expect(kitMaterial('KitStone', 'Entrance_Pylons')).not.toBe(rock);
    expect(kitMaterial('KitStone', 'Entrance_PlazaProps')).not.toBe(rock);
    const ice = kitMaterial('KitIce', 'Entrance_Lintel') as THREE.MeshStandardMaterial;
    expect(ice.name).toBe('SanctumGlacierIce');
    expect(kitMaterial('KitIce', 'Entrance_IceTongue')).toBe(ice);
    // lit like the terrain: no self-glow at night
    expect(ice.emissive.getHex()).toBe(0);
    expect(ice.vertexColors).toBe(true);
    expect(rock.customProgramCacheKey()).toContain(SANCTUM_ROCK_PROGRAM_KEY);
    expect(ice.customProgramCacheKey()).toContain(SANCTUM_ICE_PROGRAM_KEY);
  });

  it('the gate seats the shared door origin both programs read', () => {
    const view = buildSanctumSealGate(SEED);
    const door = DUNGEONS.gravewyrm_sanctum.doorPos;
    const origin = sealGateSurfaceInternalsForTest.origin.value;
    expect(origin.x).toBe(door.x);
    expect(origin.z).toBe(door.z);
    expect(origin.y).toBeCloseTo(view.cullGroups[0].position.y, 6);
  });

  it('the hooks splice the core constants, deterministically, on the PBR tier', () => {
    sealGateSurfaceInternalsForTest.reset();
    sanctumSealGateInternalsForTest.resetCaches();
    const { kitMaterial } = sanctumSealGateInternalsForTest;
    const rock = kitMaterial('KitStone', 'Entrance_Tunnel');
    const ice = kitMaterial('KitIce');
    const a = compileHook(rock, 'standard');
    const b = compileHook(rock, 'standard');
    // a dry compile and the real link see the same program (no caching, no
    // appending across calls)
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(b.vertexShader).toBe(a.vertexShader);
    expect(a.uniforms.uSealOrigin).toBe(sealGateSurfaceInternalsForTest.origin);
    const r = SANCTUM_THORNPEAK_ROCK;
    for (const v of [r.insideHalfWidth, r.insideEndLz, r.insideFrontLz, r.roofY0, r.roofSlope]) {
      expect(a.fragmentShader).toContain(v.toFixed(4));
    }
    expect(a.fragmentShader).toContain(r.snow.map((v) => v.toFixed(4)).join(', '));
    expect(a.fragmentShader).toContain('sealPerturb( - vViewPosition');
    expect(a.vertexShader).toContain('vSealWPos');
    const iceShader = compileHook(ice, 'standard');
    const g = SANCTUM_GLACIER_ICE;
    expect(iceShader.fragmentShader).toContain(g.deep.map((v) => v.toFixed(4)).join(', '));
    expect(iceShader.fragmentShader).toContain(g.stepHeight.toFixed(4));
    expect(iceShader.fragmentShader).toContain('roughnessFactor = mix(');
  });

  it('the Lambert tier gets the same tone in a lighter program (no bump, no roughness)', () => {
    sealGateSurfaceInternalsForTest.reset();
    sanctumSealGateInternalsForTest.resetCaches();
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const { kitMaterial } = sanctumSealGateInternalsForTest;
      const rock = kitMaterial('KitStone', 'Entrance_Tunnel');
      const ice = kitMaterial('KitIce');
      expect(rock).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(ice).toBeInstanceOf(THREE.MeshLambertMaterial);
      for (const m of [rock, ice]) {
        const sh = compileHook(m, 'lambert');
        expect(sh.fragmentShader).toContain('diffuseColor.rgb = ');
        expect(sh.fragmentShader).not.toContain('sealPerturb( - vViewPosition');
        expect(sh.fragmentShader).not.toContain('roughnessFactor = mix(');
        expect(m.customProgramCacheKey()).toContain(':lite');
      }
      expect(compileHook(rock, 'lambert').fragmentShader).toContain(
        SANCTUM_THORNPEAK_ROCK.snow.map((v) => v.toFixed(4)).join(', '),
      );
    } finally {
      restore();
      sealGateSurfaceInternalsForTest.reset();
    }
  });
});
