import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTER_LOD_RANGE_SQ } from '../src/render/crowd_lod';
import {
  buildWeaponVfxPrewarmGroup,
  createWeaponVfx,
  DEFAULT_TUNING,
  WEAPON_VFX,
  WEAPON_VFX_RENDER_CATEGORY,
  type WeaponVfxTuning,
} from '../src/render/weapon_vfx';
import {
  scaleWeaponVfxTuning,
  WEAPON_VFX_GOVERNOR_FLOOR,
  WEAPON_VFX_MIN_SHED_SCALE,
  WEAPON_VFX_TUNING_CHANNELS,
  weaponVfxShedScale,
} from '../src/render/weapon_vfx_shed_core';
import { WEAPON_VFX_TUNING } from '../src/render/weapon_vfx_tuning';

/** The distance arm's floor, pinned as a literal here so a retune in the core
 *  has to be restated rather than silently adopted by the assertions. */
const MIN_DISTANCE_SCALE_PIN = 0.4;

// The weapon-skin VFX rigs answer to a lever at last (viewer distance plus the
// frame-budget governor's vfx bucket), and they are visible to the ?perf scene
// census.
//
// The lever is a FADE and never a cull: `createWeaponVfx`'s applyTuning only
// stops drawing a part below a multiplier of 0.01, and the assertions below pin
// that the lever's floor stays clear of that against every shipped skin. What
// removes a rig is the character LOD swap, on inputs the whole render path
// already shares. Several cases here exist because a banded first draft failed
// in playtesting: the hard 1.0 -> 0.7 step at a boundary read as the rig
// switching off, so the fade is now continuous and anchored to the fixed
// pre-scaling LOD range rather than to the live crowd-adaptive band edge.

// The module draws its sprite textures on a 2d canvas; everything else in it is
// plain Three + math (same stub shape as weapon_vfx_rig_build.test.ts).
let priorDocument: unknown;

function stubContext() {
  const gradient = { addColorStop: () => {} };
  return {
    fillStyle: '',
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: () => {},
  };
}

beforeAll(() => {
  const globals = globalThis as { document?: unknown };
  priorDocument = globals.document;
  globals.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => stubContext() }),
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = priorDocument;
});

function weaponStub(): THREE.Object3D {
  const root = new THREE.Object3D();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  root.add(mesh);
  return root;
}

describe('weaponVfxShedScale', () => {
  const anchor = Math.sqrt(CHARACTER_LOD_RANGE_SQ);

  it('holds the authored look in close, then fades to its floor by the anchor', () => {
    expect(weaponVfxShedScale(0, 1)).toBe(1);
    // full strength out to 40% of the anchor, then easing
    expect(weaponVfxShedScale((anchor * 0.4) ** 2, 1)).toBe(1);
    const mid = weaponVfxShedScale((anchor * 0.7) ** 2, 1);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.4);
    expect(weaponVfxShedScale(CHARACTER_LOD_RANGE_SQ, 1)).toBeCloseTo(0.4, 5);
  });

  it('never increases as the wearer gets further away', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 200; d += 0.5) {
      const scale = weaponVfxShedScale(d * d, 1);
      expect(scale).toBeLessThanOrEqual(previous);
      previous = scale;
    }
  });

  it('advances in steps too small to read, so the fade cannot pop', () => {
    // The regression this guards is the one playtesting found in the banded
    // draft: a hard 1.0 -> 0.7 step at a boundary reads as the rig switching
    // off. No single yard of travel may move the scale by more than one
    // quantization step.
    let previous = weaponVfxShedScale(0, 1);
    for (let d = 1; d <= 120; d++) {
      const scale = weaponVfxShedScale(d * d, 1);
      expect(previous - scale).toBeLessThanOrEqual(0.05 + 1e-9);
      previous = scale;
    }
  });

  it('is anchored to the fixed LOD range, not to a live crowd-adaptive edge', () => {
    // Keying the fade to the live band edge would make a wearer's glow pulse on
    // crowd churn and differ between two viewers in the same spot; the anchor is
    // the pre-scaling constant precisely so it cannot.
    // still ramping a little inside the anchor (quantization has the last yard
    // or so already sitting on the floor, which is the point of quantizing)
    expect(weaponVfxShedScale((anchor * 0.85) ** 2, 1)).toBeGreaterThan(MIN_DISTANCE_SCALE_PIN);
    expect(weaponVfxShedScale(CHARACTER_LOD_RANGE_SQ, 1)).toBeCloseTo(MIN_DISTANCE_SCALE_PIN, 5);
    expect(weaponVfxShedScale(CHARACTER_LOD_RANGE_SQ * 1.001, 1)).toBeCloseTo(
      MIN_DISTANCE_SCALE_PIN,
      5,
    );
    // ...and it holds there however far out you go
    expect(weaponVfxShedScale(400 * 400, 1)).toBeCloseTo(MIN_DISTANCE_SCALE_PIN, 5);
  });

  it('never reaches zero on either arm: this fades, it does not cull', () => {
    // The far-LOD swap owns removal. A lever that could also remove would be
    // doing the same job on per-client inputs, which is what the fairness split
    // exists to avoid.
    for (const distanceSq of [0, 40 * 40, 80 * 80, 500 * 500]) {
      for (const level of [1, 0.5, 0]) {
        expect(weaponVfxShedScale(distanceSq, level)).toBeGreaterThanOrEqual(
          WEAPON_VFX_MIN_SHED_SCALE - 1e-9,
        );
      }
    }
  });

  it('lets the governor DIM a rig but never remove one', () => {
    for (const distanceSq of [0, 40 * 40, 80 * 80]) {
      const full = weaponVfxShedScale(distanceSq, 1);
      const crushed = weaponVfxShedScale(distanceSq, 0);
      expect(crushed).toBeGreaterThan(0);
      expect(crushed).toBeLessThan(full);
      expect(crushed / full).toBeCloseTo(WEAPON_VFX_GOVERNOR_FLOOR, 1);
    }
  });

  it('treats an absent or nonsense governor level as no pressure', () => {
    expect(weaponVfxShedScale(0, Number.NaN)).toBe(1);
    expect(weaponVfxShedScale(0, 5)).toBe(1);
    expect(weaponVfxShedScale(-1, 1)).toBe(1);
  });

  it('quantizes, so an unchanged frame elides the tuning write', () => {
    const a = weaponVfxShedScale(40 * 40, 0.831);
    const b = weaponVfxShedScale(40 * 40, 0.833);
    expect(a).toBe(b);
    expect(Math.round(a * 20)).toBeCloseTo(a * 20, 9);
  });
});

describe('the fade floor stays clear of the cull threshold', () => {
  it('cannot silently stop a part drawing, whatever the skin authored', () => {
    // applyTuning stops drawing a part at multiplier <= 0.01. The lever is a
    // FADE, so the smallest multiplier it can produce against the smallest
    // authored channel that ships must stay above that; if this ever fails the
    // lever has quietly become a cull and the module header is a lie.
    const authoredValues = Object.values(WEAPON_VFX_TUNING).flatMap((row) =>
      Object.values(row).filter((v): v is number => typeof v === 'number' && v > 0),
    );
    expect(authoredValues.length).toBeGreaterThan(20);
    const smallestAuthored = Math.min(...authoredValues);
    expect(smallestAuthored * WEAPON_VFX_MIN_SHED_SCALE).toBeGreaterThan(0.01);
  });
});

describe('scaleWeaponVfxTuning', () => {
  it('covers every tuning channel the rig defines', () => {
    expect([...WEAPON_VFX_TUNING_CHANNELS].sort()).toEqual(Object.keys(DEFAULT_TUNING).sort());
  });

  it('scales an authored row and defaults an absent channel to 1', () => {
    const authored: Partial<WeaponVfxTuning> = { glow: 2, light: 0.5 };
    const out = { ...DEFAULT_TUNING };
    scaleWeaponVfxTuning(authored, 0.4, out);
    expect(out.glow).toBeCloseTo(0.8, 6);
    expect(out.light).toBeCloseTo(0.2, 6);
    expect(out.motes).toBeCloseTo(0.4, 6);
    // re-deriving from the authored row never compounds
    scaleWeaponVfxTuning(authored, 1, out);
    expect(out.glow).toBe(2);
    expect(out.motes).toBe(1);
  });

  it('zeroes every channel at scale 0', () => {
    const out = { ...DEFAULT_TUNING };
    scaleWeaponVfxTuning({ glow: 2, shell: 1.5 }, 0, out);
    for (const channel of WEAPON_VFX_TUNING_CHANNELS) expect(out[channel]).toBe(0);
  });
});

describe('the shed applied to a live rig', () => {
  const spec = WEAPON_VFX.ice_fang;

  it('keeps every rig node drawing across the whole range of the lever', () => {
    // The lever is a fade: at its own floor the rig must still be drawing, or
    // it has become a cull competing with the far-LOD swap.
    expect(spec).toBeTruthy();
    const handle = createWeaponVfx(weaponStub(), spec, { grounded: false, backdrop: false });
    const nodes: THREE.Object3D[] = [];
    handle.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) nodes.push(o);
    });
    expect(nodes.length).toBeGreaterThan(0);

    const authored = WEAPON_VFX_TUNING.ice_fang;
    const scaled = { ...DEFAULT_TUNING };
    for (const scale of [1, 0.7, WEAPON_VFX_MIN_SHED_SCALE]) {
      handle.setTuning(scaleWeaponVfxTuning(authored, scale, scaled));
      handle.update(1 / 60);
      expect(nodes.every((n) => n.visible)).toBe(true);
      // the light dims WITHOUT losing its visible flag: three counts visible
      // point lights into every lit material's program cache key
      expect(handle.light.intensity).toBeGreaterThan(0);
      expect(handle.light.visible).toBe(true);
    }
    handle.dispose();
  });

  it('dims rather than hides at a partial scale', () => {
    const handle = createWeaponVfx(weaponStub(), spec, { grounded: false, backdrop: false });
    const scaled = { ...DEFAULT_TUNING };
    handle.setTuning(scaleWeaponVfxTuning({}, 1, scaled));
    handle.update(1 / 60);
    const bright = handle.light.intensity;
    handle.setTuning(scaleWeaponVfxTuning({}, 0.4, scaled));
    handle.update(1 / 60);
    expect(handle.light.intensity).toBeGreaterThan(0);
    expect(handle.light.intensity).toBeLessThan(bright);
    let visible = 0;
    handle.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) visible += o.visible ? 1 : 0;
    });
    expect(visible).toBeGreaterThan(0);
    handle.dispose();
  });
});

describe('scene-census tagging', () => {
  it('buckets a live rig under its own render category', () => {
    const handle = createWeaponVfx(weaponStub(), WEAPON_VFX.ice_fang, { grounded: false });
    expect(handle.group.userData.renderCategory).toBe(WEAPON_VFX_RENDER_CATEGORY);
    expect(handle.sceneExtras.userData.renderCategory).toBe(WEAPON_VFX_RENDER_CATEGORY);
    // the census inherits the tag down the subtree, so tagging the rig root is
    // what makes every additive node it owns countable
    expect(handle.group.children.length).toBeGreaterThan(0);
    handle.dispose();
  });

  it('leaves the boot prewarm rig in the prewarm bucket', () => {
    // Otherwise the synthetic warm-up rig would report as a live weapon skin
    // and the overlay would show a wearer nobody can see.
    const group = buildWeaponVfxPrewarmGroup();
    const categories = new Set<string>();
    group.traverse((o) => {
      const c = o.userData.renderCategory;
      if (typeof c === 'string') categories.add(c);
    });
    expect(categories.has(WEAPON_VFX_RENDER_CATEGORY)).toBe(false);
    expect(categories).toEqual(new Set(['prewarm']));
  });
});

describe('graphics-settings fairness', () => {
  it('sheds nothing but decoration: the renderer never hides the rig or its light', () => {
    // The rig's point light must keep its `visible` flag no matter how hard the
    // shed bites (three's visible point-light count is part of every lit
    // material's program cache key: dropping one recompiles the world). Pinned
    // as a source scan because the hazard is a future edit, not today's code.
    const visual = readFileSync('src/render/characters/visual.ts', 'utf8');
    const shedBlock = visual.slice(
      visual.indexOf('private applyWeaponVfxShed'),
      visual.indexOf('private applySkinOrientation'),
    );
    expect(shedBlock.length).toBeGreaterThan(0);
    expect(shedBlock).not.toMatch(/\.visible\s*=/);
    expect(shedBlock).toMatch(/setTuning/);
  });

  it('reads viewer distance and the vfx lever only, never a preset or tier', () => {
    const source = readFileSync('src/render/weapon_vfx_shed_core.ts', 'utf8');
    // no graphics tier, preset, or device profile reaches the policy
    expect(source).not.toMatch(/\bGFX\b|ui_effects_profile|gfx'|isMobile/);
    expect(weaponVfxShedScale.length).toBe(2);
    // ...nor the crowd-adaptive band plan, whose edges are per-client and
    // per-frame: only the fixed pre-scaling anchor may be read
    expect(source).toContain('CHARACTER_LOD_RANGE_SQ');
    expect(source).not.toMatch(/staticRangeSq|characterLodBands|crowdLodScaleSq|visibleRigs/);
  });

  it('skips a far rig only once a baked mesh is actually standing in for it', () => {
    // setFar leaves modelWrap VISIBLE when there is no baked mesh, while isFar
    // reads true either way: skipping on the flag alone would freeze a rig that
    // is still drawing. Pinned as a source scan because constructing a real
    // CharacterVisual needs the GLB assets.
    const visual = readFileSync('src/render/characters/visual.ts', 'utf8');
    const start = visual.indexOf('updateWeaponVfx(dt: number');
    const body = visual.slice(start, visual.indexOf('\n  }', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (this.far && this.farMesh) return;');
    // the orientation pins must keep running while far, or a bow snaps on return
    expect(body.indexOf('applySkinOrientation')).toBeLessThan(
      body.indexOf('if (this.far && this.farMesh) return;'),
    );
  });
});
