// The Smith's Heart weapon-VFX families (src/render/weapon_vfx_raid_parts.ts): orbiting shards,
// rune rings, licking flames and the storm eye, plus the catalog-side levers they ride (a sprite
// lighting in turn, the reduced-motion calm). Pins the GPU contract each kind promises: built
// once, one program per kind whatever the authored numbers, the tuning and calm uniforms on
// every material, opaque shards that write depth and additive light that does not.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWeaponVfx, WEAPON_VFX, type WeaponVfxSpec } from '../src/render/weapon_vfx';
import {
  makeRaidPart,
  RAID_TUNE_KEY_BY_KIND,
  type WeaponVfxRaidComponent,
} from '../src/render/weapon_vfx_raid_parts';
import { weaponVfxSeqLevel } from '../src/render/weapon_vfx_seq_core';

const AT = new THREE.Vector3(0, 1, 0);
const TO = new THREE.Vector3(0, 1.6, 0);

const ORBITERS: WeaponVfxRaidComponent = {
  kind: 'orbiters',
  at: {},
  count: 7,
  radius: [0.6, 0.8],
  size: [0.1, 0.2],
  speed: [0.5, 0.7],
  spin: [0.5, 1.2],
  tilt: 0.2,
  shape: 'rock',
  color: 0xa07a4c,
  dark: 0x2e1f12,
  glow: 0xffb428,
};
const RING: WeaponVfxRaidComponent = {
  kind: 'runeRing',
  at: {},
  axis: [1, 0, 0],
  radius: 0.46,
  width: 0.14,
  speed: 0.08,
  color: 0xff9a10,
  core: 0xffe9a0,
};
const FLAMES: WeaponVfxRaidComponent = {
  kind: 'flames',
  line: [{}, {}],
  count: 12,
  spread: 0.12,
  lean: 0.4,
  height: [0.2, 0.3],
  width: [0.1, 0.15],
  rate: [1, 1.5],
  hot: 0xfff0b0,
  mid: 0xff8a1e,
  tip: 0xb8260a,
};
const VORTEX: WeaponVfxRaidComponent = {
  kind: 'vortex',
  at: {},
  axis: [0, 0, 1],
  radius: 0.17,
  arms: 3,
  speed: 0.6,
  twist: 1.2,
  outer: 0x2f8fe0,
  inner: 0xe8fbff,
};
const ALL = [ORBITERS, RING, FLAMES, VORTEX];

function build(c: WeaponVfxRaidComponent) {
  return makeRaidPart(c, AT.clone(), c.kind === 'flames' ? TO.clone() : null);
}

describe('the raid VFX families', () => {
  it('build one mesh and one ShaderMaterial each, carrying time, tuning and calm uniforms', () => {
    for (const c of ALL) {
      const part = build(c);
      expect(part.mats, c.kind).toHaveLength(1);
      const mat = part.mats[0];
      for (const u of ['uTime', 'uOpacity', 'uCalm'])
        expect(mat.uniforms[u], `${c.kind} ${u}`).toBeDefined();
      expect((part.node as THREE.Mesh).isMesh, c.kind).toBe(true);
      // frustum culling would test the placeholder bounds, not the shader-placed geometry
      expect(part.node.frustumCulled, c.kind).toBe(false);
    }
  });

  it('draws the shards opaque (they write depth) and every other kind as additive light', () => {
    const shards = build(ORBITERS).mats[0];
    expect(shards.transparent).toBe(false);
    expect(shards.depthWrite).toBe(true);
    for (const c of [RING, FLAMES, VORTEX]) {
      const mat = build(c).mats[0];
      expect(mat.transparent, c.kind).toBe(true);
      expect(mat.depthWrite, c.kind).toBe(false);
      expect(mat.blending, c.kind).toBe(THREE.AdditiveBlending);
    }
  });

  it('draws every orbiting shard in ONE instanced draw', () => {
    const geo = (build(ORBITERS).node as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    expect(geo.isInstancedBufferGeometry).toBe(true);
    expect(geo.instanceCount).toBe(7);
    expect((geo.getAttribute('aOrbit') as THREE.InstancedBufferAttribute).count).toBe(7);
  });

  it('orbits on a circle unless a depth is authored, and carries the oval as a uniform', () => {
    // a circle by default, so every existing rig keeps its path
    expect(build(ORBITERS).mats[0].uniforms.uDepth.value).toBe(1);
    // an oval for a head longer than it is deep; the number rides a uniform, never the source
    const oval = build({ ...ORBITERS, depth: 0.57 }).mats[0];
    expect(oval.uniforms.uDepth.value).toBe(0.57);
    expect(oval.vertexShader).toBe(build(ORBITERS).mats[0].vertexShader);
    expect(oval.vertexShader).toContain('aOrbit.x * uDepth');
  });

  it('builds one quad per flame, placed by the shader', () => {
    const geo = (build(FLAMES).node as THREE.Mesh).geometry;
    expect(geo.getAttribute('position').count).toBe(12 * 4);
    expect(geo.getIndex()?.count).toBe(12 * 6);
  });

  it('links one program per kind: the authored numbers never reach shader source', () => {
    const tweak: Record<string, Partial<WeaponVfxRaidComponent>> = {
      orbiters: { count: 3, shape: 'ice', color: 0xffffff, seams: 0 },
      runeRing: { radius: 0.2, width: 0.05, speed: -0.3 },
      flames: { count: 4, spread: 0, height: [0.5, 0.6] },
      vortex: { arms: 5, twist: 0.2, radius: 0.4 },
    };
    for (const c of ALL) {
      const a = build(c).mats[0];
      const b = build({ ...c, ...tweak[c.kind] } as WeaponVfxRaidComponent).mats[0];
      expect(b.vertexShader, c.kind).toBe(a.vertexShader);
      expect(b.fragmentShader, c.kind).toBe(a.fragmentShader);
    }
  });

  it('answers each kind to a tuning channel the shed lever already scales', () => {
    expect(RAID_TUNE_KEY_BY_KIND).toEqual({
      orbiters: 'motes',
      runeRing: 'aurora',
      flames: 'mist',
      vortex: 'core',
    });
  });

  it('keeps every pow() base clamped in the new shaders', () => {
    for (const c of ALL) {
      const mat = build(c).mats[0];
      for (const src of [mat.vertexShader, mat.fragmentShader]) {
        for (const m of src.matchAll(/pow\(([^,]+),/g)) {
          expect(m[1].trim(), c.kind).toMatch(/^(clamp|max|abs)\(/);
        }
      }
    }
  });
});

describe('sprites that light in turn', () => {
  it('lights each slot fully at its moment and leaves the others banked', () => {
    // four slots at a round every 1 / 0.25 = 4 s: slot k peaks at t = k
    for (let k = 0; k < 4; k++) {
      expect(weaponVfxSeqLevel(k, k, 4, 0.25)).toBeCloseTo(1, 6);
      expect(weaponVfxSeqLevel(k, (k + 2) % 4, 4, 0.25)).toBe(0);
    }
    // halfway between two slots, both are half lit
    expect(weaponVfxSeqLevel(0.5, 0, 4, 0.25)).toBeCloseTo(0.5, 6);
    expect(weaponVfxSeqLevel(0.5, 1, 4, 0.25)).toBeCloseTo(0.5, 6);
    // and the round wraps
    expect(weaponVfxSeqLevel(4, 0, 4, 0.25)).toBeCloseTo(1, 6);
    expect(weaponVfxSeqLevel(3.5, 0, 4, 0.25)).toBeCloseTo(0.5, 6);
  });
});

// The factory paints its shared sprite textures on a 2d canvas; Node has none, so a stub that
// accepts every call stands in (the textures' pixels are not under test here).
let priorDocument: unknown;
beforeAll(() => {
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(
    { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    {
      get: (target, key) =>
        key in target
          ? (target as Record<string | symbol, unknown>)[key]
          : key === 'getImageData' || key === 'createImageData'
            ? (_x: number, _y: number, w = 1, h = 1) => ({
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
              })
            : () => {},
      set: () => true,
    },
  );
  const globals = globalThis as { document?: unknown };
  priorDocument = globals.document;
  globals.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = priorDocument;
});

/** A rig on a bare host (no map: deriveEmissive takes its flat-tint arm). */
function rigFor(spec: WeaponVfxSpec) {
  const host = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  return createWeaponVfx(host, spec, { grounded: false, withLight: false });
}

describe("the Smith's Heart rigs", () => {
  const RAID_MODELS = [
    'seamcaller_maul',
    'squallcrest',
    'rimelight_staff',
    'hearthbrand',
    'duskwick_staff',
  ];

  it('build through the live factory, run, and tear down', () => {
    for (const model of RAID_MODELS) {
      const rig = rigFor(WEAPON_VFX[model]);
      const names = new Set<string>();
      rig.group.traverse((o) => names.add(o.name));
      for (const c of WEAPON_VFX[model].fx) expect(names, model).toContain(`vfx_${c.kind}`);
      expect(() => {
        for (let i = 0; i < 30; i++) rig.update(1 / 60);
      }, model).not.toThrow();
      rig.dispose();
    }
  });

  it('caps every flash under reduced motion, and only writes when the setting moves', () => {
    for (const model of ['squallcrest', 'rimelight_staff', 'seamcaller_maul']) {
      const rig = rigFor(WEAPON_VFX[model]);
      const calmMats: THREE.ShaderMaterial[] = [];
      rig.group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (mat?.uniforms?.uCalm) calmMats.push(mat);
      });
      // the lightning, the star blinks and the running rune light all answer to it
      expect(calmMats.length, model).toBeGreaterThan(0);
      rig.setCalm(true);
      for (const m of calmMats) expect(m.uniforms.uCalm.value, model).toBe(1);
      // write-elided: a second call with the same setting touches nothing
      for (const m of calmMats) m.uniforms.uCalm.value = 0.5;
      rig.setCalm(true);
      for (const m of calmMats) expect(m.uniforms.uCalm.value, model).toBe(0.5);
      rig.setCalm(false);
      for (const m of calmMats) expect(m.uniforms.uCalm.value, model).toBe(0);
      rig.dispose();
    }
  });

  it('reads the calm lever in every shader that carries it (no dead uniform)', () => {
    for (const model of RAID_MODELS) {
      const rig = rigFor(WEAPON_VFX[model]);
      rig.group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (!mat?.uniforms?.uCalm) return;
        const src = mat.vertexShader + mat.fragmentShader;
        // declared AND used: more than the one declaration line
        expect(src.split('uCalm').length - 1, `${model} ${o.name}`).toBeGreaterThan(1);
      });
      rig.dispose();
    }
  });

  it('keeps each raid rig within a draw budget a crowded raid can carry', () => {
    // the heaviest pre-raid rig draws 9 additive parts; a raid rig may carry its element's
    // signature on top, but never a dozen more. Literal on purpose: a ratchet.
    const CEILING = 11;
    for (const model of RAID_MODELS) {
      const rig = rigFor(WEAPON_VFX[model]);
      let draws = 0;
      rig.group.traverse((o) => {
        const d = o as THREE.Mesh & THREE.Sprite & THREE.Points;
        if (d.isMesh || d.isSprite || d.isPoints) draws++;
      });
      expect(draws, model).toBeLessThanOrEqual(CEILING);
      rig.dispose();
    }
  });

  it('turns every storm eye with whole arms (a fractional count tears at the seam)', () => {
    for (const [key, spec] of Object.entries(WEAPON_VFX)) {
      for (const c of spec.fx) {
        if (c.kind === 'vortex') expect(Number.isInteger(c.arms), key).toBe(true);
      }
    }
  });

  it('allocates nothing per frame: the same uniform objects carry every update', () => {
    const rig = rigFor(WEAPON_VFX.duskwick_staff);
    const before: unknown[] = [];
    rig.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uTime) before.push(mat.uniforms.uTime);
    });
    rig.update(0.5);
    const after: unknown[] = [];
    rig.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uTime) after.push(mat.uniforms.uTime);
    });
    expect(after).toEqual(before);
    for (const u of after) expect((u as THREE.IUniform).value).toBeCloseTo(0.5, 6);
    rig.dispose();
  });
});
