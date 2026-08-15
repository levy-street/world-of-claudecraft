import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  baseScalpDecal,
  HAIR_STYLES,
  MODULAR_WARRIOR_KEY,
  type StubbleSelection,
} from '../src/render/characters/modular';
import {
  beardCoverage,
  beardLimit,
  buildDecalGeometry,
  DECAL_LIFT,
  decalTextureData,
  decalUv,
  headAngles,
  headFrame,
  isNoseUnderside,
  scalpCoverage,
  scalpLimit,
  stipple,
} from '../src/render/characters/stubble';
import { UNDERHAIR } from '../src/render/characters/underhair.generated';

// The masks are written in the head's own angular frame: theta 0 at the crown,
// 180 straight down, azimuth 0 dead ahead. Every landmark below was MEASURED
// off the shipped head's morph targets (`mouth_*` moves exactly the lip ring,
// `nose_up` exactly the nose, `cheeks_*` peaks on the cheekbone), so these are
// assertions about the real face, not about the numbers restating themselves.
const MOUTH = { theta: 122, az: 0 };
const CHEEKBONE = { theta: 94, az: 82 };
const CHIN = { theta: 143, az: 0 };
const NOSE_TIP = { theta: 108, az: 0 };
const BROW = { theta: 75, az: 0 };
const CROWN = { theta: 4, az: 0 };
const NAPE = { theta: 120, az: 175 };

describe('beard footprint', () => {
  it('covers the jaw and the cheek but not the lips, the nose or the nape', () => {
    for (const style of ['stubble', 'scruff'] as const) {
      expect(beardCoverage(style, CHIN.theta, CHIN.az), `${style} chin`).toBeGreaterThan(0.5);
      expect(beardCoverage(style, 130, 40), `${style} jaw`).toBeGreaterThan(0.5);
      // the cheekbone is where the sideburn tops out, just under it is growth
      expect(
        beardCoverage(style, CHEEKBONE.theta + 4, CHEEKBONE.az),
        `${style} sideburn`,
      ).toBeGreaterThan(0.2);
      expect(beardCoverage(style, MOUTH.theta, MOUTH.az), `${style} lips`).toBe(0);
      expect(beardCoverage(style, NOSE_TIP.theta, NOSE_TIP.az), `${style} nose`).toBe(0);
      expect(beardCoverage(style, BROW.theta, BROW.az), `${style} brow`).toBe(0);
      expect(beardCoverage(style, NAPE.theta, NAPE.az), `${style} nape`).toBe(0);
    }
  });

  it('leaves a moustache between the nose and the lip', () => {
    // The nose OVERHANGS the philtrum, so this band is only a few degrees wide
    // and is the first thing a careless beard line eats.
    expect(beardCoverage('stubble', 116, 0)).toBeGreaterThan(0.3);
    expect(beardCoverage('scruff', 116, 0)).toBeGreaterThan(0.3);
  });

  it('grows scruff up the cheek without letting it reach the nose', () => {
    for (let az = 0; az <= 100; az += 5) {
      expect(beardLimit('scruff', az), `az ${az}`).toBeLessThanOrEqual(beardLimit('stubble', az));
    }
    // ...but at the midline the extra growth is held back: the nose tip is at
    // 107 degrees and a flat grow would put stubble on the end of it
    expect(beardLimit('scruff', 0)).toBeGreaterThan(NOSE_TIP.theta + 2);
    expect(beardLimit('scruff', 60)).toBeLessThan(beardLimit('stubble', 60) - 3);
  });

  it('is symmetric across the midline', () => {
    for (let az = 0; az <= 180; az += 7) {
      for (const theta of [100, 120, 140, 160]) {
        expect(beardCoverage('scruff', theta, az)).toBeCloseTo(
          beardCoverage('scruff', theta, -az),
          10,
        );
      }
    }
  });
});

describe('scalp footprint', () => {
  it('covers the crown and stops at a hairline that is lower at the sides', () => {
    for (const style of ['buzz', 'crew'] as const) {
      expect(scalpCoverage(style, CROWN.theta, CROWN.az), `${style} crown`).toBeGreaterThan(0.8);
      expect(scalpCoverage(style, BROW.theta, BROW.az), `${style} brow`).toBe(0);
      expect(scalpCoverage(style, CHIN.theta, CHIN.az), `${style} chin`).toBe(0);
      // the cut rings the head lower at the sides and the back than at the front
      expect(scalpLimit(style, 0)).toBeLessThan(scalpLimit(style, 90));
      expect(scalpLimit(style, 90)).toBeCloseTo(scalpLimit(style, 175), 1);
    }
    // a buzz keeps its low hairline; a crew is lifted clear of the brow
    expect(scalpLimit('crew', 0)).toBeLessThan(scalpLimit('buzz', 0) - 10);
  });

  it('is symmetric across the midline', () => {
    for (let az = 0; az <= 180; az += 7) {
      expect(scalpCoverage('buzz', 80, az)).toBeCloseTo(scalpCoverage('buzz', 80, -az), 10);
    }
  });

  // The DEFAULT growth under a hair volume is the buzz decal itself, not a
  // lookalike: the stubble showing through a haircut has to be the same
  // stubble the picker gives you when buzz is the whole style. Asserted as an
  // identity rather than by two tables agreeing, because "they happen to match
  // today" is exactly what drifts.
  //
  // A style the Fit Studio authored an under-layer for (underhair.generated.ts,
  // written beside its anchor) wears THAT instead, and 'none' wears nothing:
  // the default is what an unauthored style falls back to, not a law.
  it('wears the BUZZ decal under every unauthored hair volume, not a lookalike', () => {
    for (const hair of HAIR_STYLES) {
      const under = baseScalpDecal(hair);
      if (hair === 'bald') expect(under, hair).toBeNull();
      else if (hair === 'buzz' || hair === 'crew') expect(under, hair).toBe(hair);
      else if (UNDERHAIR[hair] === 'none') expect(under, hair).toBeNull();
      else if (UNDERHAIR[hair]) expect(under, hair).toBe(UNDERHAIR[hair]);
      else expect(under, hair).toBe('buzz');
    }
    // and the map an UNAUTHORED volume gets is byte-for-byte the buzz cut's own
    const unauthored = HAIR_STYLES.find(
      (h) => h !== 'bald' && h !== 'buzz' && h !== 'crew' && !UNDERHAIR[h],
    );
    if (!unauthored) throw new Error('no unauthored hair style left to pin the default against');
    const under = decalTextureData({ scalp: baseScalpDecal(unauthored), beard: null }, 128);
    const buzz = decalTextureData({ scalp: 'buzz', beard: null }, 128);
    expect(Array.from(under)).toEqual(Array.from(buzz));
  });
});

describe('the unwrap', () => {
  it('puts the crown at the centre and the whole head inside the disc', () => {
    const [u, v] = decalUv(0, 0);
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
    for (let theta = 0; theta <= 180; theta += 3) {
      for (let az = -180; az <= 180; az += 7) {
        const [x, y] = decalUv(theta, az);
        expect(Math.hypot(x - 0.5, y - 0.5)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  // The reason for an azimuthal projection over the obvious lat-long one: a
  // lat-long seam down the back of the head lands inside a buzz cut's footprint,
  // and a triangle straddling it interpolates its UV across the whole texture.
  it('has no seam, neighbouring directions stay neighbours, including at ±180', () => {
    const step = 0.5;
    for (let theta = 5; theta <= 165; theta += 5) {
      for (let az = -180; az < 180; az += 3) {
        const a = decalUv(theta, az);
        const b = decalUv(theta, az + step);
        const c = decalUv(theta + step, az);
        // the azimuthal step in UV is the arc of a circle of radius theta/360,
        // the same everywhere on the ring, INCLUDING across ±180
        const arc = (theta / 360) * (step / (180 / Math.PI));
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `az ${az}`).toBeLessThan(arc * 1.001);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `az ${az}`).toBeGreaterThan(arc * 0.999);
        expect(Math.hypot(a[0] - c[0], a[1] - c[1]), `theta ${theta}`).toBeCloseTo(step / 360, 6);
      }
    }
  });
});

describe('the stipple', () => {
  it('is bounded, varies, and never leaves a whole region blank', () => {
    let hits = 0;
    let sum = 0;
    let n = 0;
    for (let theta = 96; theta < 160; theta += 0.31) {
      for (let az = -90; az < 90; az += 0.53) {
        const v = stipple(theta, az);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (v > 0.5) hits++;
        sum += v;
        n++;
      }
    }
    // dense enough to read as growth, sparse enough to read as dots
    expect(hits / n).toBeGreaterThan(0.1);
    expect(sum / n).toBeLessThan(0.75);
  });

  // The lattice closes on itself in azimuth, so the back of the head has no
  // discontinuity in the grain.
  it('is continuous across the ±180 azimuth wrap', () => {
    for (let theta = 20; theta < 160; theta += 1.7) {
      const a = stipple(theta, 179.999);
      const b = stipple(theta, -180 + 0.001);
      expect(Math.abs(a - b), `theta ${theta}`).toBeLessThan(0.02);
    }
  });
});

describe('the decal map', () => {
  const size = 256;

  it('is entirely empty when no style is selected', () => {
    const data = decalTextureData({ scalp: null, beard: null }, size);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(0);
  });

  // three multiplies the WHOLE texel into the fragment, so a transparent texel
  // left at black bleeds through bilinear filtering and rings every dot with a
  // dark halo. The colour channel has to stay valid outside the shape.
  it('carries a valid colour in every texel, covered or not', () => {
    const data = decalTextureData({ scalp: 'buzz', beard: 'scruff' }, size);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
    expect(dark).toBe(0);
  });

  it('paints the jaw and the scalp but never the lips or outside the disc', () => {
    const sel: StubbleSelection = { scalp: 'crew', beard: 'stubble' };
    const data = decalTextureData(sel, size);
    const at = (theta: number, az: number) => {
      const [u, v] = decalUv(theta, az);
      const x = Math.min(size - 1, Math.floor(u * size));
      const y = Math.min(size - 1, Math.floor(v * size));
      return data[(y * size + x) * 4 + 3];
    };
    // sample a small neighbourhood: the stipple can put any single texel between
    // two dots
    const near = (theta: number, az: number) => {
      let best = 0;
      for (let dt = -2; dt <= 2; dt++)
        for (let da = -2; da <= 2; da++) best = Math.max(best, at(theta + dt, az + da * 2));
      return best;
    };
    expect(near(CHIN.theta, CHIN.az)).toBeGreaterThan(40);
    expect(near(135, 45)).toBeGreaterThan(40);
    expect(near(20, 90)).toBeGreaterThan(40);
    expect(at(MOUTH.theta, MOUTH.az)).toBe(0);
    expect(at(BROW.theta, BROW.az)).toBe(0);
    // the corners of the square are outside the disc entirely
    expect(data[3]).toBe(0);
    expect(data[(size * size - 1) * 4 + 3]).toBe(0);
  });
});

// A synthetic head: an ellipsoid with one morph target, enough to exercise the
// trim / subdivide / unwrap / lift path without a GL context or the real asset.
function sphereHead(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 24, 18);
  geo.scale(1, 0.95, 1.1);
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const morph = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    skinIndex[i * 4] = 0;
    skinIndex[i * 4 + 1] = 1;
    skinWeight[i * 4] = 0.7;
    skinWeight[i * 4 + 1] = 0.3;
    morph[i * 3 + 1] = 0.05 * pos.getY(i);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.morphAttributes.position = [new THREE.BufferAttribute(morph, 3)];
  geo.morphTargetsRelative = true;
  return geo;
}

describe('decal geometry', () => {
  const head = sphereHead();
  const frame = headFrame(head.getAttribute('position') as THREE.BufferAttribute);

  it('is nothing at all when no style is selected', () => {
    expect(buildDecalGeometry(head, frame, { scalp: null, beard: null })).toBeNull();
  });

  // The trim is sized to the footprint, and a buzz hairline sits 11 degrees
  // lower than a crew one, so the surface a buzz needs is strictly bigger, and
  // the two cannot share a cache entry keyed on "has a scalp decal" or a buzz
  // gets the crew cut's surface and its hairline ends on a flat shelf.
  it('cuts a bigger surface for the styles that reach further', () => {
    const size = (sel: StubbleSelection) =>
      buildDecalGeometry(head, frame, sel)?.getAttribute('position').count ?? 0;
    expect(size({ scalp: 'buzz', beard: null })).toBeGreaterThan(
      size({ scalp: 'crew', beard: null }),
    );
    expect(size({ scalp: null, beard: 'scruff' })).toBeGreaterThanOrEqual(
      size({ scalp: null, beard: 'stubble' }),
    );
  });

  it('carries the skinning and the morphs the head it is cut from has', () => {
    const geo = buildDecalGeometry(head, frame, { scalp: 'buzz', beard: 'scruff' });
    expect(geo).toBeTruthy();
    if (!geo) return;
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      expect(geo.getAttribute(name), name).toBeTruthy();
    }
    expect(geo.morphAttributes.position).toHaveLength(1);
    expect(geo.morphTargetsRelative).toBe(true);
    expect(geo.morphAttributes.position[0].count).toBe(geo.getAttribute('position').count);
    const w = geo.getAttribute('skinWeight');
    for (let i = 0; i < w.count; i++) {
      expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
  });

  // Every vertex must land inside the disc, or it samples the unused corners of
  // the map; and none may reach the projection's singular direction.
  it('stays inside the disc and clear of the antipode', () => {
    const geo = buildDecalGeometry(head, frame, { scalp: 'buzz', beard: 'scruff' });
    if (!geo) throw new Error('no geometry');
    const uv = geo.getAttribute('uv');
    const pos = geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      expect(Math.hypot(uv.getX(i) - 0.5, uv.getY(i) - 0.5)).toBeLessThanOrEqual(0.5);
      const [theta] = headAngles(frame, pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(theta).toBeLessThan(172);
    }
  });

  it('floats off the surface rather than sitting in it', () => {
    const geo = buildDecalGeometry(head, frame, { beard: 'stubble', scalp: null });
    if (!geo) throw new Error('no geometry');
    const pos = geo.getAttribute('position');
    // the sphere has radius 1 along x, so a lifted vertex is measurably outside
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      maxR = Math.max(maxR, Math.hypot(pos.getX(i) / 1, pos.getY(i) / 0.95, pos.getZ(i) / 1.1));
    }
    expect(maxR).toBeGreaterThan(1.0005);
    expect(maxR).toBeLessThan(1.02);
  });
});

// The real asset. These are the assertions that would actually catch a
// regression on a player's face; the synthetic head above only proves the
// plumbing.
describe('decal geometry on the shipped head', () => {
  const path = fileURLToPath(
    new URL(`../public/${VISUALS[MODULAR_WARRIOR_KEY].url}`, import.meta.url),
  );

  const load = async (node: string) => {
    const { NodeIO } = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { MeshoptDecoder } = await import('meshoptimizer');
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path);
    const mesh = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === node)
      ?.getMesh();
    const prim = mesh?.listPrimitives()[0];
    if (!prim || !mesh) throw new Error(`${node} missing`);
    const grab = (name: string, size: number) => {
      const a = prim.getAttribute(name);
      if (!a) throw new Error(`${node} has no ${name}`);
      const out = new Float32Array(a.getCount() * size);
      const el = new Array(size).fill(0);
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, el);
        for (let c = 0; c < size; c++) out[i * size + c] = el[c];
      }
      return out;
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(grab('POSITION', 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(grab('NORMAL', 3), 3));
    const idx = prim.getIndices();
    if (idx) {
      const arr = new Uint32Array(idx.getCount());
      for (let i = 0; i < idx.getCount(); i++) arr[i] = idx.getScalar(i);
      geo.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    const names: string[] = (mesh.getExtras() as { targetNames?: string[] })?.targetNames ?? [];
    const targets = new Map<string, Float32Array>();
    prim.listTargets().forEach((t, i) => {
      const a = t.getAttribute('POSITION');
      if (!a || !names[i]) return;
      const out = new Float32Array(a.getCount() * 3);
      const el = [0, 0, 0];
      for (let k = 0; k < a.getCount(); k++) {
        a.getElement(k, el);
        out[k * 3] = el[0];
        out[k * 3 + 1] = el[1];
        out[k * 3 + 2] = el[2];
      }
      targets.set(names[i], out);
    });
    return { geo, targets };
  };

  // The head's own morph targets say where the face IS. `mouth_pout` moves
  // exactly the lip ring, so "the lips stay bare" is checkable rather than
  // asserted, this is the gate that stopped the wash burying the mouth line.
  it.each(['M_Head', 'F_Head'])('%s: no growth on the lips', async (node) => {
    const { geo, targets } = await load(node);
    const frame = headFrame(geo.getAttribute('position') as THREE.BufferAttribute);
    const pos = geo.getAttribute('position');
    const lip = targets.get('mouth_pout');
    expect(lip, 'mouth_pout target').toBeTruthy();
    if (!lip) return;
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(lip[i * 3], lip[i * 3 + 1], lip[i * 3 + 2]);
      if (d < 0.012) continue;
      checked++;
      const [theta, az] = headAngles(frame, pos.getX(i), pos.getY(i), pos.getZ(i));
      for (const style of ['stubble', 'scruff'] as const) {
        expect(beardCoverage(style, theta, az), `${node} ${style} lip vertex ${i}`).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it.each(['M_Head', 'F_Head'])('%s: growth all over the jaw', async (node) => {
    const { geo, targets } = await load(node);
    const frame = headFrame(geo.getAttribute('position') as THREE.BufferAttribute);
    const pos = geo.getAttribute('position');
    const jaw = targets.get('jaw_up');
    expect(jaw, 'jaw_up target').toBeTruthy();
    if (!jaw) return;
    let covered = 0;
    let total = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(jaw[i * 3], jaw[i * 3 + 1], jaw[i * 3 + 2]);
      if (d < 0.02) continue;
      const [theta, az] = headAngles(frame, pos.getX(i), pos.getY(i), pos.getZ(i));
      // the jaw morph reaches round to the nape; only the front of it is beard
      if (Math.abs(az) > 85) continue;
      total++;
      if (beardCoverage('scruff', theta, az) > 0.2) covered++;
    }
    expect(total).toBeGreaterThan(12);
    expect(covered / total, `${node} share of jaw covered`).toBeGreaterThan(0.75);
  });

  // The decal must never cover the underside of the nose: it overhangs the
  // philtrum, so both share a direction and the unwrap cannot tell them apart.
  // The surface is removed instead, and this is that invariant.
  it.each(['M_Head', 'F_Head'])('%s: no decal surface under the nose', async (node) => {
    const { geo } = await load(node);
    const frame = headFrame(geo.getAttribute('position') as THREE.BufferAttribute);
    const decal = buildDecalGeometry(geo, frame, { scalp: 'buzz', beard: 'scruff' });
    expect(decal).toBeTruthy();
    if (!decal) return;
    const pos = decal.getAttribute('position');
    const nrm = decal.getAttribute('normal');
    const index = decal.getIndex();
    if (!index) throw new Error('unindexed decal');
    let bad = 0;
    for (let t = 0; t < index.count; t += 3) {
      let theta = 0;
      let az = 0;
      let ny = 0;
      for (let k = 0; k < 3; k++) {
        const i = index.getX(t + k);
        const [th, a] = headAngles(frame, pos.getX(i), pos.getY(i), pos.getZ(i));
        theta += th / 3;
        az += a / 3;
        ny += nrm.getY(i) / 3;
      }
      if (isNoseUnderside(theta, az, ny)) bad++;
    }
    expect(bad, `${node} nose-underside faces in the decal`).toBe(0);
  });

  // The mask is analytic and the UV is per vertex, so how straight a beard line
  // comes out depends entirely on how far the interpolated UV drifts from the
  // true projection inside a triangle. The head's lower half is a handful of
  // very large faces; this is what the subdivision buys.
  // Same rule as the synthetic head, on the asset that ships: scruff climbs
  // 4.5 degrees further up the cheek than stubble, so it needs more surface.
  it.each(['M_Head', 'F_Head'])('%s: a longer style is cut a bigger surface', async (node) => {
    const { geo } = await load(node);
    const frame = headFrame(geo.getAttribute('position') as THREE.BufferAttribute);
    const size = (sel: StubbleSelection) =>
      buildDecalGeometry(geo, frame, sel)?.getAttribute('position').count ?? 0;
    expect(size({ scalp: 'buzz', beard: null })).toBeGreaterThan(
      size({ scalp: 'crew', beard: null }),
    );
    expect(size({ scalp: null, beard: 'scruff' })).toBeGreaterThanOrEqual(
      size({ scalp: null, beard: 'stubble' }),
    );
    expect(size({ scalp: 'buzz', beard: 'scruff' })).toBeGreaterThan(
      size({ scalp: 'buzz', beard: null }),
    );
  });

  it.each(['M_Head', 'F_Head'])('%s: interpolated UV tracks the projection', async (node) => {
    const { geo } = await load(node);
    const frame = headFrame(geo.getAttribute('position') as THREE.BufferAttribute);
    const decal = buildDecalGeometry(geo, frame, { scalp: 'buzz', beard: 'scruff' });
    if (!decal) throw new Error('no decal');
    const pos = decal.getAttribute('position');
    const nrm = decal.getAttribute('normal');
    const uv = decal.getAttribute('uv');
    const index = decal.getIndex();
    if (!index) throw new Error('unindexed decal');
    // Un-lift first: the UV is keyed to the SKIN under the decal, not to the
    // floated vertex, so the lift is not drift. Measuring it as drift hides the
    // thing this is actually gating, with the lift in, more subdivision looks
    // like it buys nothing (1.89 -> 1.82 degrees) when it in fact buys
    // everything (1.10 -> 0.30).
    const lift = frame.hy * 2 * DECAL_LIFT;
    const base = (i: number): [number, number, number] => [
      pos.getX(i) - nrm.getX(i) * lift,
      pos.getY(i) - nrm.getY(i) * lift,
      pos.getZ(i) - nrm.getZ(i) * lift,
    ];
    let worst = 0;
    for (let t = 0; t < index.count; t += 3) {
      for (const [p, q] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const a = index.getX(t + p);
        const b = index.getX(t + q);
        const pa = base(a);
        const pb = base(b);
        const [theta, az] = headAngles(
          frame,
          (pa[0] + pb[0]) / 2,
          (pa[1] + pb[1]) / 2,
          (pa[2] + pb[2]) / 2,
        );
        const [tu, tv] = decalUv(theta, az);
        const iu = (uv.getX(a) + uv.getX(b)) / 2;
        const iv = (uv.getY(a) + uv.getY(b)) / 2;
        worst = Math.max(worst, Math.hypot(tu - iu, tv - iv) * 360); // degrees of arc
      }
    }
    // Drop a subdivision level and this is 3.7 degrees. What is left is
    // concentrated in the mouth crease, where the head folds inward far enough
    // that a triangle across it spans a wide arc from the head centre, and it
    // is a SMOOTH deviation that is zero at every vertex, so a beard line
    // wanders slightly rather than turning into the sawtooth this replaced.
    expect(worst, `${node} worst UV drift (degrees)`).toBeLessThan(1.5);
  });
});
